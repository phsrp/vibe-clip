// The recording, replay-buffer and streaming outputs.
// Recording and replay buffer share one video encoder (like OBS's "Advanced" output mode), so
// having the replay buffer on while recording costs nothing extra. Streaming gets its own encoder
// so it can use a lower bitrate than your recordings.
import type * as OSN from 'obs-studio-node'
import { osn } from './obs'
import { createLogger } from '../logger'
import { encoderSettings } from './encoders'
import { OutputCode } from './constants'

const log = createLogger('outputs')

export interface TrackConfig {
  name: string
  bitrate: number
}

export interface OutputConfig {
  video: OSN.IVideo
  encoderId: string
  bitrate: number
  /** Extra encoder settings in OBS's format (every option the encoder offers). */
  encoderOverrides?: Record<string, unknown> | null
  replaySeconds: number
  /** Folder files are first written to. */
  folder: string
  tracks: TrackConfig[]
  recordTracks: number
  replayTracks: number
  fileFormat: string
  split: { enabled: boolean; type: 'time' | 'size'; minutes: number; megabytes: number }
}

export interface StreamConfig {
  video: OSN.IVideo
  encoderId: string
  bitrate: number
  encoderOverrides?: Record<string, unknown> | null
  serviceType: string
  serviceSettings: Record<string, unknown>
  /** 1-6 */
  track: number
  rescale: { width: number; height: number } | null
  reconnect: { enabled: boolean; delaySec: number; maxRetries: number }
  delaySec: number
}

type Signal = OSN.EOutputSignal
type Waiter = { type: string; signals: string[]; resolve: (s: Signal) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

export class OutputError extends Error {}

function describe(s: Signal): string {
  const meaning = OutputCode[s.code] ?? `code ${s.code}`
  if (s.type === 'streaming' && s.code === -3) return 'The stream key or server was rejected. Check your stream key.'
  if (s.type === 'streaming' && s.code === -2) return "Couldn't connect to the streaming server. Check your internet and the server address."
  return s.error ? `${meaning} (${s.error})` : meaning
}

export class Outputs {
  private encoder: OSN.IVideoEncoder | null = null
  private recording: OSN.IAdvancedRecording | null = null
  private replay: OSN.IAdvancedReplayBuffer | null = null
  private stream: OSN.IAdvancedStreaming | null = null
  private streamEncoder: OSN.IVideoEncoder | null = null
  private waiters: Waiter[] = []
  private stopping = new Set<string>()
  replayActive = false
  recordingActive = false
  recordingSince: number | null = null
  streamActive = false
  streamStarting = false
  streamSince: number | null = null
  config: OutputConfig | null = null

  /** Called when an output stops on its own (error, disk full, connection lost...). */
  onUnexpectedStop: ((type: 'recording' | 'replay-buffer' | 'streaming', message: string) => void) | null = null
  onStateChange: (() => void) | null = null
  /** Called with each new file when recordings are split into parts. */
  onFileSplit: ((file: string) => void) | null = null

  private handleSignal = (s: Signal): void => {
    log.info(`signal ${s.type}/${s.signal} code=${s.code}${s.error ? ' error=' + s.error : ''}`)
    const isStop = s.signal === 'stop'
    // A stream that fails while connecting is reported by startStream itself.
    const wasConnecting = s.type === 'streaming' && this.streamStarting
    if (isStop) {
      if (s.type === 'recording') {
        this.recordingActive = false
        this.recordingSince = null
      }
      if (s.type === 'replay-buffer') this.replayActive = false
      if (s.type === 'streaming') {
        this.streamActive = false
        this.streamStarting = false
        this.streamSince = null
      }
      this.onStateChange?.()
    }
    if (s.type === 'streaming' && s.signal === 'reconnect') this.onStateChange?.()
    if (s.type === 'recording' && s.signal === 'file_changed') this.onFileSplit?.(this.recording?.lastFile() ?? '')
    for (const w of [...this.waiters]) {
      if (w.type !== s.type) continue
      if (w.signals.includes(s.signal)) {
        this.removeWaiter(w)
        w.resolve(s)
      } else if ((isStop && s.code !== 0) || s.signal === 'writing_error') {
        this.removeWaiter(w)
        w.reject(new OutputError(describe(s)))
      }
    }
    const expected = this.stopping.has(s.type) || wasConnecting
    if (isStop) this.stopping.delete(s.type)
    if (isStop && !expected && s.code !== 0) this.onUnexpectedStop?.(s.type as 'recording' | 'replay-buffer' | 'streaming', describe(s))
  }

  private removeWaiter(w: Waiter): void {
    clearTimeout(w.timer)
    this.waiters = this.waiters.filter((x) => x !== w)
  }

  private waitFor(type: string, signals: string[], timeoutMs: number, what: string): Promise<Signal> {
    return new Promise((resolve, reject) => {
      const w: Waiter = {
        type,
        signals,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removeWaiter(w)
          reject(new OutputError(`Timed out waiting for ${what}`))
        }, timeoutMs)
      }
      this.waiters.push(w)
    })
  }

  /** Sets up the 6 audio tracks (names and bitrates). Track numbers are 1-based here. */
  private setupTracks(tracks: TrackConfig[]): void {
    tracks.slice(0, 6).forEach((t, i) => osn.AudioTrackFactory.setAtIndex(osn.AudioTrackFactory.create(t.bitrate, t.name), i + 1))
  }

  /** (Re)creates the encoder, recording and replay buffer. Only call while they are stopped. */
  configure(cfg: OutputConfig): void {
    if (this.replayActive || this.recordingActive) throw new Error('Stop recording and the replay buffer before changing output settings')
    this.destroyRecordingOutputs()
    this.setupTracks(cfg.tracks)
    this.config = cfg
    // Our defaults, then the exact settings from the encoder settings screen / OBS import, then the bitrate.
    const settings = { ...encoderSettings(cfg.encoderId, cfg.bitrate), ...(cfg.encoderOverrides ?? {}), bitrate: cfg.bitrate }
    this.encoder = osn.VideoEncoderFactory.create(cfg.encoderId, 'Recording encoder', settings)
    if (!this.encoder) throw new Error(`Could not create the ${cfg.encoderId} encoder`)

    const rec = osn.AdvancedRecordingFactory.create()
    rec.path = cfg.folder
    rec.format = 'mkv' as OSN.ERecordingFormat // crash-safe while recording; converted when it finishes
    rec.fileFormat = cfg.fileFormat
    rec.prefix = 'Recording'
    rec.overwrite = false
    rec.noSpace = false
    rec.useStreamEncoders = false
    rec.videoEncoder = this.encoder
    rec.video = cfg.video
    rec.mixer = cfg.recordTracks || 1
    rec.enableFileSplit = cfg.split.enabled
    if (cfg.split.enabled) {
      rec.splitType = (cfg.split.type === 'time' ? 0 : 1) as unknown as OSN.ERecSplitType
      rec.splitTime = cfg.split.minutes * 60
      rec.splitSize = cfg.split.megabytes
    }
    rec.signalHandler = this.handleSignal
    this.recording = rec

    const rb = osn.AdvancedReplayBufferFactory.create()
    rb.path = cfg.folder
    rb.format = 'mp4' as OSN.ERecordingFormat // written in one go when saved, so MP4 is safe here
    rb.fileFormat = cfg.fileFormat
    rb.prefix = 'Clip'
    rb.overwrite = false
    rb.noSpace = false
    rb.duration = cfg.replaySeconds
    rb.usesStream = false
    rb.video = cfg.video
    rb.mixer = cfg.replayTracks || 1
    rb.signalHandler = this.handleSignal
    rb.recording = rec
    this.replay = rb
    log.info(`Outputs configured: ${cfg.encoderId} @ ${cfg.bitrate} kbps, replay ${cfg.replaySeconds}s, tracks rec=${cfg.recordTracks} replay=${cfg.replayTracks}`)
  }

  async startReplay(): Promise<void> {
    if (!this.replay || this.replayActive) return
    const started = this.waitFor('replay-buffer', ['start'], 15000, 'the replay buffer to start')
    this.replay.start()
    await started
    this.replayActive = true
    this.onStateChange?.()
  }

  async stopReplay(): Promise<void> {
    if (!this.replay || !this.replayActive) return
    this.stopping.add('replay-buffer')
    const stopped = this.waitFor('replay-buffer', ['stop'], 15000, 'the replay buffer to stop')
    this.replay.stop()
    await stopped.catch((e) => log.warn('Replay buffer stop', e))
    this.replayActive = false
    this.onStateChange?.()
  }

  /** Saves the replay buffer to a file and returns its path. */
  async saveReplay(): Promise<string> {
    if (!this.replay || !this.replayActive) throw new OutputError('The replay buffer is off')
    const wrote = this.waitFor('replay-buffer', ['wrote'], 60000, 'the clip to be written')
    this.replay.save()
    await wrote
    return this.replay.lastFile()
  }

  async startRecording(): Promise<void> {
    if (!this.recording || this.recordingActive) return
    const started = this.waitFor('recording', ['start'], 15000, 'the recording to start')
    this.recording.start()
    await started
    this.recordingActive = true
    this.recordingSince = Date.now()
    this.onStateChange?.()
  }

  /** Stops recording and returns the file it wrote. */
  async stopRecording(): Promise<string> {
    if (!this.recording || !this.recordingActive) throw new OutputError('Not recording')
    this.stopping.add('recording')
    const wrote = this.waitFor('recording', ['wrote'], 60000, 'the recording to finish writing')
    this.recording.stop()
    await wrote
    this.recordingActive = false
    this.recordingSince = null
    this.onStateChange?.()
    return this.recording.lastFile()
  }

  /** The file the recording is currently writing. */
  recordingFile(): string {
    try {
      return this.recording?.lastFile() ?? ''
    } catch {
      return ''
    }
  }

  encoderError(): string {
    return this.encoder?.lastError ?? ''
  }

  /** The live recording encoder (for reading its settings list). */
  getEncoder(): OSN.IVideoEncoder | null {
    return this.encoder
  }

  // ----- Streaming -----

  async startStream(cfg: StreamConfig): Promise<void> {
    if (this.streamActive || this.streamStarting) return
    this.destroyStream()
    const settings = { ...encoderSettings(cfg.encoderId, cfg.bitrate), ...(cfg.encoderOverrides ?? {}), bitrate: cfg.bitrate }
    this.streamEncoder = osn.VideoEncoderFactory.create(cfg.encoderId, 'Streaming encoder', settings)
    const st = osn.AdvancedStreamingFactory.create()
    st.video = cfg.video
    st.videoEncoder = this.streamEncoder
    st.service = osn.ServiceFactory.create(cfg.serviceType, 'Stream service', cfg.serviceSettings)
    st.enforceServiceBitrate = false
    st.audioTrack = cfg.track
    st.twitchTrack = 0
    st.rescaling = !!cfg.rescale
    if (cfg.rescale) {
      st.outputWidth = cfg.rescale.width
      st.outputHeight = cfg.rescale.height
    }
    const delay = osn.DelayFactory.create()
    delay.enabled = cfg.delaySec > 0
    delay.delaySec = cfg.delaySec
    delay.preserveDelay = true
    st.delay = delay
    const reconnect = osn.ReconnectFactory.create()
    reconnect.enabled = cfg.reconnect.enabled
    reconnect.retryDelay = cfg.reconnect.delaySec
    reconnect.maxRetries = cfg.reconnect.maxRetries
    st.reconnect = reconnect
    st.network = osn.NetworkFactory.create()
    st.signalHandler = this.handleSignal
    this.stream = st

    this.streamStarting = true
    this.onStateChange?.()
    const started = this.waitFor('streaming', ['start'], 30000, 'the stream to connect')
    st.start()
    try {
      await started
      this.streamActive = true
      this.streamSince = Date.now()
    } finally {
      this.streamStarting = false
      this.onStateChange?.()
    }
  }

  async stopStream(): Promise<void> {
    if (!this.stream || (!this.streamActive && !this.streamStarting)) return
    this.stopping.add('streaming')
    const stopped = this.waitFor('streaming', ['stop'], 20000, 'the stream to end')
    this.stream.stop()
    await stopped.catch((e) => log.warn('Stream stop', e))
    this.streamActive = false
    this.streamSince = null
    this.onStateChange?.()
    this.destroyStream()
  }

  streamStats(): { kbps: number; droppedFrames: number; totalFrames: number } {
    if (!this.stream || !this.streamActive) return { kbps: 0, droppedFrames: 0, totalFrames: 0 }
    try {
      return { kbps: Math.round(this.stream.kbitsPerSec), droppedFrames: this.stream.droppedFrames, totalFrames: this.stream.totalFrames }
    } catch {
      return { kbps: 0, droppedFrames: 0, totalFrames: 0 }
    }
  }

  private destroyStream(): void {
    try {
      if (this.stream) osn.AdvancedStreamingFactory.destroy(this.stream)
      this.streamEncoder?.release()
    } catch (e) {
      log.warn('Error destroying stream output', e)
    }
    this.stream = null
    this.streamEncoder = null
  }

  private destroyRecordingOutputs(): void {
    try {
      if (this.replay) osn.AdvancedReplayBufferFactory.destroy(this.replay)
      if (this.recording) osn.AdvancedRecordingFactory.destroy(this.recording)
      this.encoder?.release()
    } catch (e) {
      log.warn('Error destroying outputs', e)
    }
    this.replay = null
    this.recording = null
    this.encoder = null
  }

  async shutdown(): Promise<void> {
    if (this.recordingActive) await this.stopRecording().catch((e) => log.warn('Stop recording on shutdown', e))
    await this.stopStream().catch(() => undefined)
    await this.stopReplay()
    this.destroyRecordingOutputs()
  }
}
