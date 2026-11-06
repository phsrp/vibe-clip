// The recording and replay-buffer outputs. They share one video encoder, exactly like OBS's
// "Advanced" output mode, so having the replay buffer on while recording costs nothing extra.
import type * as OSN from 'obs-studio-node'
import { osn } from './obs'
import { createLogger } from '../logger'
import { encoderSettings } from './encoders'
import { OutputCode, Tracks } from './constants'

const log = createLogger('outputs')

export interface OutputConfig {
  video: OSN.IVideo
  encoderId: string
  bitrate: number
  replaySeconds: number
  /** Extra encoder settings in OBS's format (e.g. imported from an OBS profile). */
  encoderOverrides?: Record<string, unknown> | null
  /** Folder files are first written to. */
  folder: string
}

type Signal = OSN.EOutputSignal
type Waiter = { type: string; signals: string[]; resolve: (s: Signal) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

export class OutputError extends Error {}

function describe(s: Signal): string {
  const meaning = OutputCode[s.code] ?? `code ${s.code}`
  return s.error ? `${meaning} (${s.error})` : meaning
}

export class Outputs {
  private encoder: OSN.IVideoEncoder | null = null
  private recording: OSN.IAdvancedRecording | null = null
  private replay: OSN.IAdvancedReplayBuffer | null = null
  private waiters: Waiter[] = []
  private tracksReady = false
  replayActive = false
  recordingActive = false
  recordingSince: number | null = null
  config: OutputConfig | null = null

  /** Called when an output stops on its own (error, disk full...). */
  onUnexpectedStop: ((type: 'recording' | 'replay-buffer', message: string) => void) | null = null
  onStateChange: (() => void) | null = null

  private handleSignal = (s: Signal): void => {
    log.info(`signal ${s.type}/${s.signal} code=${s.code}${s.error ? ' error=' + s.error : ''}`)
    const isStop = s.signal === 'stop'
    if (isStop) {
      if (s.type === 'recording') {
        this.recordingActive = false
        this.recordingSince = null
      }
      if (s.type === 'replay-buffer') this.replayActive = false
      this.onStateChange?.()
    }
    // Resolve anyone waiting for this signal; a failing stop rejects them.
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
    const expected = this.stopping.has(s.type)
    if (isStop) this.stopping.delete(s.type)
    if (isStop && !expected && s.code !== 0) this.onUnexpectedStop?.(s.type as 'recording' | 'replay-buffer', describe(s))
  }

  private stopping = new Set<string>()

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

  private setupTracks(): void {
    if (this.tracksReady) return
    // Track numbers are 1-based here. 1 = everything, 2 = desktop audio, 3 = mic.
    osn.AudioTrackFactory.setAtIndex(osn.AudioTrackFactory.create(192, 'Mixed'), 1)
    osn.AudioTrackFactory.setAtIndex(osn.AudioTrackFactory.create(192, 'Desktop'), 2)
    osn.AudioTrackFactory.setAtIndex(osn.AudioTrackFactory.create(192, 'Mic'), 3)
    this.tracksReady = true
  }

  /** (Re)creates the encoder and outputs. Only call while nothing is running. */
  configure(cfg: OutputConfig): void {
    if (this.replayActive || this.recordingActive) throw new Error('Stop recording and the replay buffer before changing output settings')
    this.destroyOutputs()
    this.setupTracks()
    this.config = cfg
    // Our defaults, then any exact settings imported from OBS, then the bitrate from Settings.
    const settings = { ...encoderSettings(cfg.encoderId, cfg.bitrate), ...(cfg.encoderOverrides ?? {}), bitrate: cfg.bitrate }
    this.encoder = osn.VideoEncoderFactory.create(cfg.encoderId, 'Vibe Clip Encoder', settings)
    if (!this.encoder) throw new Error(`Could not create the ${cfg.encoderId} encoder`)

    const rec = osn.AdvancedRecordingFactory.create()
    rec.path = cfg.folder
    rec.format = 'mkv' as OSN.ERecordingFormat // crash-safe while recording; turned into MP4 afterwards
    rec.fileFormat = '%CCYY-%MM-%DD %hh-%mm-%ss'
    rec.prefix = 'Recording'
    rec.overwrite = false
    rec.noSpace = false
    rec.useStreamEncoders = false
    rec.videoEncoder = this.encoder
    rec.video = cfg.video
    rec.mixer = Tracks.Mixed | Tracks.Desktop | Tracks.Mic
    rec.signalHandler = this.handleSignal
    this.recording = rec

    const rb = osn.AdvancedReplayBufferFactory.create()
    rb.path = cfg.folder
    rb.format = 'mp4' as OSN.ERecordingFormat // written in one go when saved, so MP4 is safe here
    rb.fileFormat = '%CCYY-%MM-%DD %hh-%mm-%ss'
    rb.prefix = 'Clip'
    rb.overwrite = false
    rb.noSpace = false
    rb.duration = cfg.replaySeconds
    rb.usesStream = false
    rb.video = cfg.video
    rb.mixer = Tracks.Mixed | Tracks.Desktop | Tracks.Mic
    rb.signalHandler = this.handleSignal
    rb.recording = rec
    this.replay = rb
    log.info(`Outputs configured: ${cfg.encoderId} @ ${cfg.bitrate} kbps, replay ${cfg.replaySeconds}s, folder ${cfg.folder}`)
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

  encoderError(): string {
    return this.encoder?.lastError ?? ''
  }

  private destroyOutputs(): void {
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
    await this.stopReplay()
    this.destroyOutputs()
  }
}
