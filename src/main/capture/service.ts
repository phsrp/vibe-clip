// Connects the recording engine to your settings, profiles, the clip library and the UI.
// The engine (src/main/engine) knows nothing about the UI; this file is the glue.
import * as fs from 'fs'
import * as path from 'path'
import type {
  AppSettings,
  CaptureOptions,
  CaptureStatus,
  EncoderInfo,
  ProfilesState,
  PropertyTarget,
  SerializedProperty
} from '@shared/types'
import { createLogger } from '../logger'
import { SceneManager } from '../engine/scenes'
import { Outputs, type StreamConfig } from '../engine/outputs'
import { osn } from '../engine/obs'
import { serializeProperties, clickButton } from '../engine/properties'
import { formatDurationShort } from '../util'
import { availableEncoders, encoderSettings, resolveEncoder } from '../engine/encoders'
import { getSettings, updateSettings } from '../settings'
import { getProfiles, mapSource, setProfiles } from '../profiles/store'
import { toast } from '../notify'
import * as library from '../library/library'
import { remux } from '../library/media'
import { DESKTOP } from '../games/games'
import { DisplayMethod } from '../engine/constants'
import { detailFromTitle, parseWindowString, type RunningGame } from '../games/detector'
import { videoConfig, outputSize, SPEAKERS } from './videoConfig'
import { decryptSecret, encryptSecret } from '../secrets'

const log = createLogger('capture')

export interface ActiveGame {
  id: string
  name: string
  /** Text from the game's window title (e.g. the song in osu!), used to name clips. */
  detail: string | null
}

/** Settings that need the encoder/outputs rebuilt (only possible while not recording). */
const RESTART_KEYS: (keyof AppSettings)[] = [
  'baseResolution',
  'outputResolution',
  'downscaleFilter',
  'fps',
  'fpsDen',
  'encoder',
  'bitrate',
  'encoderOverrides',
  'replaySeconds',
  'replayTracks',
  'recordTracks',
  'outputFolder',
  'tracks',
  'filenameFormat',
  'splitRecording',
  'colorFormat',
  'colorSpace',
  'colorRange',
  'sampleRate',
  'channels'
]

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

function timeLabel(d = new Date()): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

/** Moves a file into a folder, adding " (2)" etc. if the name is taken. */
function moveInto(file: string, folder: string, baseName: string): string {
  fs.mkdirSync(folder, { recursive: true })
  const ext = path.extname(file)
  let target = path.join(folder, baseName + ext)
  for (let i = 2; fs.existsSync(target); i++) target = path.join(folder, `${baseName} (${i})${ext}`)
  fs.renameSync(file, target)
  return target
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export class CaptureService {
  private scenes: SceneManager | null = null
  readonly outputs = new Outputs()
  private encoders: EncoderInfo[] = []
  private encoderId = 'obs_x264'
  private pendingReconfigure = false
  private busy: Promise<unknown> = Promise.resolve()
  private statsTimer: NodeJS.Timeout | null = null
  private audioSig = ''
  game: ActiveGame | null = null
  /** The game that was running when the current recording started. */
  private recordingGame: ActiveGame | null = null
  private recordingStarted: Date | null = null
  private recordingPart = 0
  private currentRecordingFile = ''
  onStatus: ((s: CaptureStatus) => void) | null = null
  onLevels: ((levels: Record<string, number[]>) => void) | null = null

  /** Runs actions one after another so e.g. two quick hotkey presses can't overlap. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.busy.then(fn, fn)
    this.busy = p.catch(() => undefined)
    return p
  }

  status(): CaptureStatus {
    const stats = this.outputs.streamStats()
    const state = getProfiles()
    return {
      replayActive: this.outputs.replayActive,
      replaySeconds: this.outputs.config?.replaySeconds ?? getSettings().replaySeconds,
      recording: this.outputs.recordingActive,
      recordingSince: this.outputs.recordingSince,
      game: this.game?.id ?? null,
      gameName: this.game?.name ?? null,
      stream: {
        live: this.outputs.streamActive,
        starting: this.outputs.streamStarting,
        since: this.outputs.streamSince,
        ...stats
      },
      activeProfile: state.profiles.find((p) => p.id === state.activeId)?.name ?? null
    }
  }

  private emit(): void {
    this.onStatus?.(this.status())
  }

  getScenes(): SceneManager | null {
    return this.scenes
  }

  async init(): Promise<void> {
    const s = getSettings()
    this.encoders = availableEncoders()
    this.applyAudioContext(s, true)
    this.scenes = new SceneManager(videoConfig(s))
    this.scenes.onLevels = (l) => this.onLevels?.(l)
    this.scenes.sync(getProfiles())
    this.outputs.onStateChange = () => {
      this.emit()
      this.updateStatsTimer()
    }
    this.outputs.onUnexpectedStop = (type, message) => {
      const what = type === 'recording' ? 'Recording' : type === 'streaming' ? 'The stream' : 'The replay buffer'
      toast('error', `${what} stopped unexpectedly`, message)
    }
    this.outputs.onFileSplit = (newFile) => this.onRecordingSplit(newFile)
    await this.configureOutputs(s)
    if (s.replayEnabled) await this.startReplaySafe()
    setTimeout(() => this.checkForBlackCapture(), 4000)
  }

  /** Sample rate / speaker layout, monitoring device, ducking. */
  private applyAudioContext(s: AppSettings, force = false): void {
    const sig = JSON.stringify([s.sampleRate, s.channels, s.monitoringDevice, s.disableDucking])
    if (!force && sig === this.audioSig) return
    try {
      osn.AudioFactory.audioContext = { sampleRate: s.sampleRate, speakers: SPEAKERS[s.channels] as unknown as import('obs-studio-node').ESpeakerLayout }
    } catch (e) {
      log.warn('Could not set sample rate / channels', e)
    }
    try {
      const dev = osn.AudioFactory.monitoringDevices.find((d) => d.id === s.monitoringDevice)
      if (dev) osn.AudioFactory.monitoringDevice = dev
      osn.AudioFactory.disableAudioDucking = s.disableDucking
    } catch (e) {
      log.warn('Could not set the monitoring device', e)
    }
    this.audioSig = sig
  }

  private async configureOutputs(s: AppSettings): Promise<void> {
    this.encoderId = resolveEncoder(s.encoder)
    fs.mkdirSync(s.outputFolder, { recursive: true })
    this.outputs.configure({
      video: this.scenes!.video,
      encoderId: this.encoderId,
      bitrate: s.bitrate,
      encoderOverrides: s.encoderOverrides?.id === this.encoderId ? s.encoderOverrides.settings : null,
      replaySeconds: s.replaySeconds,
      folder: s.outputFolder,
      tracks: s.tracks,
      recordTracks: s.recordTracks,
      replayTracks: s.replayTracks,
      fileFormat: s.filenameFormat || '%CCYY-%MM-%DD %hh-%mm-%ss',
      split: s.splitRecording
    })
  }

  /** Starts the replay buffer; if a GPU encoder fails, falls back to x264 so you still get clips. */
  private async startReplaySafe(): Promise<void> {
    try {
      await this.outputs.startReplay()
      log.info('Replay buffer running')
    } catch (e) {
      const detail = [errText(e), this.outputs.encoderError()].filter(Boolean).join(' — ')
      if (this.encoderId !== 'obs_x264') {
        log.warn(`Replay buffer failed with ${this.encoderId}, retrying with x264: ${detail}`)
        toast('error', `${this.encoderLabel()} failed to start`, `Using x264 (CPU) instead. Details: ${detail}`)
        const s = getSettings()
        this.encoderId = 'obs_x264'
        this.outputs.configure({
          video: this.scenes!.video,
          encoderId: 'obs_x264',
          bitrate: s.bitrate,
          replaySeconds: s.replaySeconds,
          folder: s.outputFolder,
          tracks: s.tracks,
          recordTracks: s.recordTracks,
          replayTracks: s.replayTracks,
          fileFormat: s.filenameFormat,
          split: s.splitRecording
        })
        try {
          await this.outputs.startReplay()
          return
        } catch (e2) {
          toast('error', "The replay buffer couldn't start", errText(e2))
          return
        }
      }
      toast('error', "The replay buffer couldn't start", detail)
    } finally {
      this.emit()
    }
  }

  private encoderLabel(): string {
    return this.encoders.find((e) => e.id === this.encoderId)?.label ?? this.encoderId
  }

  /**
   * If a display source produces no image, switch it to the other capture method (and remember
   * that), then tell the user how to fix it if it's still black.
   */
  private checkForBlackCapture(attempt = 0): void {
    const black = this.scenes?.blackDisplaySources() ?? []
    if (black.length === 0) {
      log.info('Display capture OK')
      return
    }
    if (attempt === 0) {
      let state = getProfiles()
      for (const src of black) {
        const method = Number(src.settings.method ?? 0)
        const next = method === DisplayMethod.WGC ? DisplayMethod.DXGI : DisplayMethod.WGC
        log.warn(`Display "${src.name}" is black, switching capture method to ${next === DisplayMethod.WGC ? 'WGC' : 'DXGI'}`)
        state = mapSource(state, src.id, (s) => ({ ...s, settings: { ...s.settings, method: next } }))
      }
      setProfiles(state)
      setTimeout(() => this.checkForBlackCapture(1), 3000)
      return
    }
    toast(
      'error',
      'Display capture is black',
      `"${black[0].name}" couldn't capture your screen with either method. On laptops with two GPUs, set Vibe Clip to use the same GPU as your display in Windows Settings → System → Display → Graphics.`
    )
  }

  options(): CaptureOptions {
    return { monitors: [], desktopAudioDevices: [], micDevices: [], encoders: this.encoders }
  }

  // ----- Profiles -----

  applyProfiles(next: ProfilesState, prev: ProfilesState): void {
    if (!this.scenes) return
    this.scenes.sync(next)
    if (next.activeId !== prev.activeId) {
      this.emit()
      // The new profile may have an auto game capture: point it at the running game.
      this.gameWindow = null
    }
  }

  audioSourceIds(): string[] {
    const state = getProfiles()
    const all = [...state.profiles.flatMap((p) => p.sources), ...state.globalAudio]
    return all.filter((s) => this.scenes?.hasAudio(s.id)).map((s) => s.id)
  }

  // ----- Settings -----

  async applySettings(next: AppSettings, prev: AppSettings): Promise<void> {
    if (!this.scenes) return
    const changed = (k: keyof AppSettings) => JSON.stringify(next[k]) !== JSON.stringify(prev[k])
    if (changed('monitoringDevice') || changed('disableDucking')) this.applyAudioContext(next)
    const needsRestart = RESTART_KEYS.some(changed)
    if (needsRestart) {
      if (this.outputs.recordingActive || this.outputs.streamActive) {
        this.pendingReconfigure = true
        toast('info', 'Settings saved', 'Video and encoder changes apply when recording and streaming stop.')
      } else {
        await this.serial(() => this.reconfigure())
      }
    } else if (changed('replayEnabled')) {
      await this.serial(async () => {
        if (next.replayEnabled) await this.startReplaySafe()
        else await this.outputs.stopReplay()
      })
    }
  }

  private async reconfigure(): Promise<void> {
    const s = getSettings()
    log.info('Applying new output settings')
    await this.outputs.stopReplay()
    this.applyAudioContext(s)
    this.scenes!.setVideo(videoConfig(s))
    await this.configureOutputs(s)
    if (s.replayEnabled) await this.startReplaySafe()
    this.pendingReconfigure = false
    this.emit()
  }

  // ----- Replay / recording -----

  toggleReplay(): Promise<void> {
    return this.serial(async () => {
      if (this.outputs.replayActive) await this.outputs.stopReplay()
      else await this.startReplaySafe()
    })
  }

  toggleRecording(): Promise<void> {
    return this.serial(async () => {
      if (this.outputs.recordingActive) await this.finishRecording()
      else await this.beginRecording()
    })
  }

  private async beginRecording(): Promise<void> {
    if (!this.scenes) throw new Error('The recording engine is not running')
    this.recordingGame = this.game
    this.recordingStarted = new Date()
    this.recordingPart = 1
    try {
      await this.outputs.startRecording()
    } catch (e) {
      toast('error', "Recording couldn't start", [errText(e), this.outputs.encoderError()].filter(Boolean).join(' — '))
      return
    }
    this.currentRecordingFile = this.outputs.recordingFile()
    toast('info', 'Recording started', this.recordingGame ? this.recordingGame.name : 'Desktop')
  }

  /** With "split recordings" on, each finished part is converted and added to the library. */
  private onRecordingSplit(newFile: string): void {
    const finished = this.currentRecordingFile
    this.currentRecordingFile = newFile
    if (!finished) return
    const game = this.recordingGame ?? { id: DESKTOP.id, name: DESKTOP.name, detail: null }
    const part = this.recordingPart++
    void this.storeRecording(finished, game, this.recordingStarted ?? new Date(), part)
  }

  private async finishRecording(): Promise<void> {
    const game = this.recordingGame ?? { id: DESKTOP.id, name: DESKTOP.name, detail: null }
    const started = this.recordingStarted ?? new Date()
    let file: string
    try {
      file = await this.outputs.stopRecording()
    } catch (e) {
      toast('error', 'Recording failed to save', errText(e))
      return
    }
    if (this.pendingReconfigure && !this.outputs.streamActive) await this.reconfigure()
    log.info(`Recording written: ${file}`)
    const part = getSettings().splitRecording.enabled && this.recordingPart > 1 ? this.recordingPart : 0
    this.currentRecordingFile = ''
    void this.storeRecording(file, game, started, part)
  }

  /** Converts the crash-safe MKV into the chosen format (no quality loss) and files it under the game. */
  private async storeRecording(mkv: string, game: ActiveGame, started: Date, part: number): Promise<void> {
    const s = getSettings()
    const folder = path.join(s.outputFolder, library.gameFolderName(game.name))
    const name = `Recording ${stamp(started)}${part ? ` part ${part}` : ''}`
    fs.mkdirSync(folder, { recursive: true })
    let target: string
    library.markBusy(mkv, true)
    try {
      if (s.recordingFormat === 'mkv') {
        target = moveInto(mkv, folder, name)
      } else {
        target = path.join(folder, `${name}.${s.recordingFormat}`)
        for (let i = 2; fs.existsSync(target); i++) target = path.join(folder, `${name} (${i}).${s.recordingFormat}`)
        library.markBusy(target, true)
        try {
          await remux(mkv, target)
          fs.rmSync(mkv, { force: true })
        } catch (e) {
          log.error('Converting the recording failed, keeping the MKV', e)
          fs.rmSync(target, { force: true })
          library.markBusy(target, false)
          target = moveInto(mkv, folder, name)
        }
      }
    } finally {
      library.markBusy(mkv, false)
    }
    library.markBusy(target, false)
    const title = (game.detail ? `${game.detail} · ${timeLabel(started)}` : `Recording ${timeLabel(started)}`) + (part ? ` (part ${part})` : '')
    await library.addFile(target, { kind: 'recording', game: game.id, gameName: game.name, title, createdAt: started.getTime() })
    toast('success', 'Recording saved', `${game.name} · ${path.basename(target)}`)
  }

  saveReplay(): Promise<void> {
    return this.serial(async () => {
      if (!this.outputs.replayActive) {
        toast('error', "Couldn't save clip", 'The replay buffer is off. Turn it on with the button at the top right.')
        return
      }
      const game = this.game ?? { id: DESKTOP.id, name: DESKTOP.name, detail: null }
      const now = new Date()
      const raw = await this.outputs.saveReplay()
      library.markBusy(raw, true)
      let file: string
      try {
        file = moveInto(path.normalize(raw), path.join(getSettings().outputFolder, library.gameFolderName(game.name)), `Clip ${stamp(now)}`)
      } finally {
        library.markBusy(raw, false)
      }
      log.info(`Clip saved: ${file}`)
      const title = game.detail ? `${game.detail} · ${timeLabel(now)}` : timeLabel(now)
      toast('success', 'Clip saved', `${game.name} · last ${formatDurationShort(this.outputs.config?.replaySeconds ?? 0)}`)
      void library.addFile(file, { kind: 'clip', game: game.id, gameName: game.name, title, createdAt: now.getTime() })
    })
  }

  /** Saves the current frame (full canvas resolution) as a PNG. */
  screenshot(): Promise<void> {
    return this.serial(async () => {
      if (!this.scenes) throw new Error('The recording engine is not running')
      const game = this.game ?? { id: DESKTOP.id, name: DESKTOP.name, detail: null }
      const now = new Date()
      const root = getSettings().outputFolder
      fs.mkdirSync(root, { recursive: true })
      const result = await osn.NodeObs.OBS_content_takeScreenshot(this.scenes.video, root, stamp(now))
      library.markBusy(result.path, true)
      let file: string
      try {
        file = moveInto(path.normalize(result.path), path.join(root, library.gameFolderName(game.name)), `Screenshot ${stamp(now)}`)
      } finally {
        library.markBusy(result.path, false)
      }
      log.info(`Screenshot saved: ${file} (${result.width}x${result.height})`)
      const title = game.detail ? `${game.detail} · ${timeLabel(now)}` : `Screenshot ${timeLabel(now)}`
      toast('success', 'Screenshot saved', `${game.name} · ${result.width}×${result.height}`)
      void library.addFile(file, { kind: 'screenshot', game: game.id, gameName: game.name, title, createdAt: now.getTime() })
    })
  }

  // ----- Streaming -----

  toggleStream(): Promise<void> {
    return this.serial(async () => {
      if (this.outputs.streamActive || this.outputs.streamStarting) {
        await this.outputs.stopStream()
        toast('info', 'Stream ended')
        if (this.pendingReconfigure && !this.outputs.recordingActive) await this.reconfigure()
        return
      }
      await this.startStream()
    })
  }

  private streamServiceSettings(s: AppSettings): Record<string, unknown> {
    const key = decryptSecret(s.stream.keyEncrypted)
    if (s.stream.serviceType === 'rtmp_common') return { service: s.stream.service, server: s.stream.server || 'auto', key }
    if (s.stream.serviceType === 'whip_custom') return { server: s.stream.server, bearer_token: key }
    return { server: s.stream.server, key }
  }

  private async startStream(): Promise<void> {
    if (!this.scenes) throw new Error('The recording engine is not running')
    const s = getSettings()
    if (!s.stream.keyEncrypted && s.stream.serviceType !== 'whip_custom') {
      toast('error', 'No stream key', 'Add your stream key in Settings → Streaming first.')
      return
    }
    const encoderId = s.stream.encoder === 'same' ? this.encoderId : resolveEncoder(s.stream.encoder)
    const v = this.scenes.getVideoConfig()
    const rescale = s.stream.rescale !== 'none' ? outputSize(v.baseWidth, v.baseHeight, s.stream.rescale) : null
    const cfg: StreamConfig = {
      video: this.scenes.video,
      encoderId,
      bitrate: s.stream.bitrate,
      encoderOverrides: s.stream.encoderOverrides,
      serviceType: s.stream.serviceType,
      serviceSettings: this.streamServiceSettings(s),
      track: s.stream.track,
      rescale,
      reconnect: s.stream.reconnect,
      delaySec: s.stream.delaySec
    }
    toast('info', 'Connecting to the stream server…')
    try {
      await this.outputs.startStream(cfg)
      toast('success', "You're live", s.stream.serviceType === 'rtmp_common' ? s.stream.service : 'Custom server')
    } catch (e) {
      toast('error', "The stream couldn't start", errText(e))
    }
  }

  private updateStatsTimer(): void {
    const live = this.outputs.streamActive
    if (live && !this.statsTimer) this.statsTimer = setInterval(() => this.emit(), 2000)
    if (!live && this.statsTimer) {
      clearInterval(this.statsTimer)
      this.statsTimer = null
    }
  }

  // ----- Properties (the generic settings forms) -----

  getProperties(target: PropertyTarget): SerializedProperty[] {
    const sc = this.scenes
    if (target.kind === 'source') return sc?.sourceProperties(target.sourceId) ?? []
    if (target.kind === 'filter') return sc?.filterProperties(target.sourceId, target.filterId) ?? []
    if (target.kind === 'transition') return sc?.transitionProperties() ?? []
    if (target.kind === 'encoder') {
      const id = target.encoderId === 'auto' ? this.encoderId : target.encoderId
      const enc = osn.VideoEncoderFactory.create(id, `props_${Date.now()}`, this.encoderSettingsFor(target.use, id))
      try {
        return serializeProperties(enc.properties)
      } finally {
        enc.release()
      }
    }
    if (target.kind === 'service') {
      const s = getSettings()
      const settings = { ...this.streamServiceSettings(s), key: '' }
      const svc = osn.ServiceFactory.create(target.serviceType, `props_${Date.now()}`, settings)
      try {
        // The key is handled separately (encrypted); never send it to the UI.
        return serializeProperties(svc.properties)
          .filter((p) => p.name !== 'key' && p.name !== 'bearer_token')
          .map((p) => (p.name === 'service' && s.stream.serviceType === 'rtmp_common' ? { ...p, value: s.stream.service } : p))
      } finally {
        osn.ServiceFactory.destroy(svc)
      }
    }
    return []
  }

  private encoderSettingsFor(use: 'record' | 'stream', id: string): Record<string, unknown> {
    const s = getSettings()
    if (use === 'stream') return { ...encoderSettings(id, s.stream.bitrate), ...(s.stream.encoderOverrides ?? {}), bitrate: s.stream.bitrate }
    const ov = s.encoderOverrides?.id === id ? s.encoderOverrides.settings : {}
    return { ...encoderSettings(id, s.bitrate), ...ov, bitrate: s.bitrate }
  }

  /** Changes one setting in a form and returns the refreshed form (some settings show/hide others). */
  setProperty(target: PropertyTarget, name: string, value: unknown): SerializedProperty[] {
    if (target.kind === 'source') {
      setProfiles(mapSource(getProfiles(), target.sourceId, (s) => ({ ...s, settings: { ...s.settings, [name]: value } })))
      this.scenes?.sourceModified(target.sourceId, name)
    } else if (target.kind === 'filter') {
      setProfiles(
        mapSource(getProfiles(), target.sourceId, (s) => ({
          ...s,
          filters: s.filters.map((f) => (f.id === target.filterId ? { ...f, settings: { ...f.settings, [name]: value } } : f))
        }))
      )
      this.scenes?.filterModified(target.sourceId, target.filterId, name)
    } else if (target.kind === 'transition') {
      const st = getProfiles()
      setProfiles({ ...st, transition: { ...st.transition, settings: { ...st.transition.settings, [name]: value } } })
    } else if (target.kind === 'encoder') {
      const s = getSettings()
      const id = target.encoderId === 'auto' ? this.encoderId : target.encoderId
      if (target.use === 'stream') {
        const patch = name === 'bitrate' ? { bitrate: Number(value) } : {}
        updateSettings({ stream: { ...s.stream, ...patch, encoderOverrides: { ...(s.stream.encoderOverrides ?? {}), [name]: value } } })
      } else {
        const prev = s.encoderOverrides?.id === id ? s.encoderOverrides.settings : {}
        updateSettings({
          ...(name === 'bitrate' ? { bitrate: Number(value) } : {}),
          encoderOverrides: { id, settings: { ...prev, [name]: value } }
        })
      }
    } else if (target.kind === 'service') {
      const s = getSettings()
      if (name === 'service') updateSettings({ stream: { ...s.stream, service: String(value), server: 'auto' } })
      else if (name === 'server') updateSettings({ stream: { ...s.stream, server: String(value) } })
    }
    return this.getProperties(target)
  }

  pressButton(target: PropertyTarget, name: string): void {
    if (target.kind === 'source') this.scenes?.sourceButton(target.sourceId, name)
    else if (target.kind === 'filter') this.scenes?.filterButton(target.sourceId, target.filterId, name)
  }

  setStreamKey(key: string): void {
    const s = getSettings()
    updateSettings({ stream: { ...s.stream, keyEncrypted: encryptSecret(key.trim()) } })
  }

  // ----- Game detection -----

  private gameWindow: string | null = null
  private hookWarned = new Set<string>()
  private hookCheck: NodeJS.Timeout | null = null

  /** Called every few seconds by the game detector with the running game (or null). */
  updateGame(running: RunningGame | null): void {
    if (!this.scenes) return
    if (!running) {
      if (this.game) {
        this.game = null
        this.gameWindow = null
        this.scenes.setAutoGameWindow(null)
        this.emit()
      }
      return
    }
    const changed = this.game?.id !== running.def.id
    let win: { raw: string; title: string } | null = null
    try {
      const match = this.scenes.listGameWindows().find((w) => parseWindowString(w.id).exe.toLowerCase() === running.exe.toLowerCase())
      if (match) win = { raw: match.id, title: parseWindowString(match.id).title }
    } catch (e) {
      log.warn('Could not list game windows', e)
    }
    const detail = win ? detailFromTitle(win.title, running.def.name) : null
    this.game = { id: running.def.id, name: running.def.name, detail }
    if (changed) this.emit()

    if (win && win.raw !== this.gameWindow) {
      // Only re-target the hook when the window itself changes, not just its title.
      const sameWindow = this.gameWindow && parseWindowString(this.gameWindow).cls === parseWindowString(win.raw).cls
      if (!sameWindow) {
        this.scenes.setAutoGameWindow(win.raw)
        if (this.scenes.hasAutoGameInActiveProfile()) this.scheduleHookCheck(running.def.id, running.def.name)
      }
      this.gameWindow = win.raw
    }
  }

  /** A few seconds after targeting a game, check the hook worked; if not, explain what's happening. */
  private scheduleHookCheck(id: string, name: string): void {
    if (this.hookCheck) clearTimeout(this.hookCheck)
    this.hookCheck = setTimeout(() => {
      const size = this.scenes?.gameSize()
      if (!size || this.game?.id !== id) return
      if (size.width > 0) {
        log.info(`Game capture hooked into ${name} (${size.width}x${size.height})`)
      } else if (!this.hookWarned.has(id)) {
        this.hookWarned.add(id)
        log.warn(`Game capture could not hook into ${name}`)
        toast(
          'info',
          `Recording your display for ${name}`,
          "Game capture couldn't hook into the game yet (it may still be loading, or it runs as administrator). Clips will show your whole display instead."
        )
      }
    }, 8000)
  }

  async shutdown(): Promise<void> {
    if (this.statsTimer) clearInterval(this.statsTimer)
    await this.outputs.shutdown()
    this.scenes?.destroy()
    this.scenes = null
  }
}
