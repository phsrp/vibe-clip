// Connects the recording engine to your settings, the clip library and the UI.
// The engine (src/main/engine) knows nothing about the UI; this file is the glue.
import { screen } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { AppSettings, CaptureOptions, CaptureStatus, EncoderInfo } from '@shared/types'
import { createLogger } from '../logger'
import { CaptureGraph, outputSize, type VideoConfig } from '../engine/capture'
import { Outputs } from '../engine/outputs'
import { osn } from '../engine/obs'
import { formatDurationShort } from '../util'
import { availableEncoders, resolveEncoder } from '../engine/encoders'
import { getSettings } from '../settings'
import { toast } from '../notify'
import * as library from '../library/library'
import { remux } from '../library/media'
import { DESKTOP } from '../games/games'
import { DisplayMethod } from '../engine/constants'
import { detailFromTitle, parseWindowString, type RunningGame } from '../games/detector'

const log = createLogger('capture')

export interface ActiveGame {
  id: string
  name: string
  /** Text from the game's window title (e.g. the song in osu!), used to name clips. */
  detail: string | null
}

const RESTART_KEYS: (keyof AppSettings)[] = ['outputResolution', 'fps', 'encoder', 'bitrate', 'replaySeconds', 'monitorId', 'outputFolder']

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

export class CaptureService {
  private graph: CaptureGraph | null = null
  readonly outputs = new Outputs()
  private encoders: EncoderInfo[] = []
  private encoderId = 'obs_x264'
  private pendingReconfigure = false
  private busy: Promise<unknown> = Promise.resolve()
  game: ActiveGame | null = null
  /** The game that was running when the current recording started. */
  private recordingGame: ActiveGame | null = null
  onStatus: ((s: CaptureStatus) => void) | null = null

  /** Runs actions one after another so e.g. two quick hotkey presses can't overlap. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.busy.then(fn, fn)
    this.busy = p.catch(() => undefined)
    return p
  }

  status(): CaptureStatus {
    return {
      replayActive: this.outputs.replayActive,
      replaySeconds: this.outputs.config?.replaySeconds ?? getSettings().replaySeconds,
      recording: this.outputs.recordingActive,
      recordingSince: this.outputs.recordingSince,
      game: this.game?.id ?? null,
      gameName: this.game?.name ?? null
    }
  }

  private emit(): void {
    this.onStatus?.(this.status())
  }

  async init(): Promise<void> {
    const s = getSettings()
    this.encoders = availableEncoders()
    this.graph = new CaptureGraph(this.videoConfig(s, null), s.monitorId, this.audioConfig(s))
    // Now that the monitor is known, size the canvas to it.
    this.graph.setVideo(this.videoConfig(s, this.graph))
    this.outputs.onStateChange = () => this.emit()
    this.outputs.onUnexpectedStop = (type, message) => {
      toast('error', type === 'recording' ? 'Recording stopped unexpectedly' : 'Replay buffer stopped unexpectedly', message)
    }
    await this.configureOutputs(s)
    if (s.replayEnabled) await this.startReplaySafe()
    setTimeout(() => this.checkForBlackCapture(), 4000)
  }

  private videoConfig(s: AppSettings, graph: CaptureGraph | null): VideoConfig {
    let baseW = 0
    let baseH = 0
    const mon = graph?.selectMonitor(s.monitorId)
    if (mon && mon.width && mon.height) {
      baseW = mon.width
      baseH = mon.height
    } else {
      const d = screen.getPrimaryDisplay()
      baseW = Math.round(d.size.width * d.scaleFactor)
      baseH = Math.round(d.size.height * d.scaleFactor)
    }
    baseW -= baseW % 2
    baseH -= baseH % 2
    const out = outputSize(baseW, baseH, s.outputResolution === 'native' ? 'native' : Number(s.outputResolution))
    return { baseWidth: baseW, baseHeight: baseH, outputWidth: out.width, outputHeight: out.height, fps: s.fps }
  }

  private audioConfig(s: AppSettings) {
    return { desktopEnabled: s.desktopAudio, desktopDevice: s.desktopAudioDevice, micEnabled: s.mic, micDevice: s.micDevice }
  }

  private async configureOutputs(s: AppSettings): Promise<void> {
    this.encoderId = resolveEncoder(s.encoder)
    fs.mkdirSync(s.outputFolder, { recursive: true })
    this.outputs.configure({
      video: this.graph!.video,
      encoderId: this.encoderId,
      bitrate: s.bitrate,
      replaySeconds: s.replaySeconds,
      folder: s.outputFolder
    })
  }

  /** Starts the replay buffer; if a GPU encoder fails, falls back to x264 so you still get clips. */
  private async startReplaySafe(): Promise<void> {
    try {
      await this.outputs.startReplay()
      log.info('Replay buffer running')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const detail = [msg, this.outputs.encoderError()].filter(Boolean).join(' — ')
      if (this.encoderId !== 'obs_x264') {
        log.warn(`Replay buffer failed with ${this.encoderId}, retrying with x264: ${detail}`)
        toast('error', `${this.encoderLabel()} failed to start`, `Using x264 (CPU) instead. Details: ${detail}`)
        this.encoderId = 'obs_x264'
        const s = getSettings()
        this.outputs.configure({ video: this.graph!.video, encoderId: 'obs_x264', bitrate: s.bitrate, replaySeconds: s.replaySeconds, folder: s.outputFolder })
        try {
          await this.outputs.startReplay()
          return
        } catch (e2) {
          toast('error', "The replay buffer couldn't start", e2 instanceof Error ? e2.message : String(e2))
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
   * If the display capture produces no image, try the other capture method first,
   * then tell the user how to fix it instead of silently recording black.
   */
  private checkForBlackCapture(triedFallback = false): void {
    const graph = this.graph
    if (!graph) return
    const size = graph.displaySize()
    if (size.width > 0) {
      log.info(`Display capture OK (${size.width}x${size.height})`)
      return
    }
    if (!triedFallback) {
      const next = graph.displayMethod() === DisplayMethod.WGC ? DisplayMethod.DXGI : DisplayMethod.WGC
      log.warn('Display capture is black, trying the other capture method')
      graph.setDisplayMethod(next)
      setTimeout(() => this.checkForBlackCapture(true), 3000)
      return
    }
    toast(
      'error',
      'Display capture is black',
      'OBS could not capture your screen with either method. On laptops with two GPUs, set Vibe Clip to use the same GPU as your display in Windows Settings → System → Display → Graphics. Details are in the log file.'
    )
  }

  options(): CaptureOptions {
    return {
      monitors: this.graph?.listMonitors() ?? [],
      desktopAudioDevices: this.graph?.listDesktopDevices() ?? [],
      micDevices: this.graph?.listMicDevices() ?? [],
      encoders: this.encoders
    }
  }

  async applySettings(next: AppSettings, prev: AppSettings): Promise<void> {
    if (!this.graph) return
    this.graph.setAudio(this.audioConfig(next))
    if (next.captureMode !== prev.captureMode) this.applyCaptureMode(next.captureMode)
    const needsRestart = RESTART_KEYS.some((k) => JSON.stringify(next[k]) !== JSON.stringify(prev[k]))
    if (needsRestart) {
      if (this.outputs.recordingActive) {
        this.pendingReconfigure = true
        toast('info', 'Settings saved', 'They will apply when the current recording stops.')
      } else {
        await this.serial(() => this.reconfigure())
      }
    }
    if (next.replayEnabled !== prev.replayEnabled && !needsRestart) {
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
    this.graph!.setVideo(this.videoConfig(s, this.graph))
    await this.configureOutputs(s)
    if (s.replayEnabled) await this.startReplaySafe()
    this.pendingReconfigure = false
    this.emit()
  }

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
    if (!this.graph) throw new Error('The recording engine is not running')
    this.recordingGame = this.game
    try {
      await this.outputs.startRecording()
    } catch (e) {
      const detail = [e instanceof Error ? e.message : String(e), this.outputs.encoderError()].filter(Boolean).join(' — ')
      toast('error', "Recording couldn't start", detail)
      return
    }
    toast('info', 'Recording started', this.recordingGame ? this.recordingGame.name : 'Desktop')
  }

  private async finishRecording(): Promise<void> {
    const game = this.recordingGame ?? { id: DESKTOP.id, name: DESKTOP.name, detail: null }
    const started = new Date(this.outputs.recordingSince ?? Date.now())
    let file: string
    try {
      file = await this.outputs.stopRecording()
    } catch (e) {
      toast('error', 'Recording failed to save', e instanceof Error ? e.message : String(e))
      return
    }
    if (this.pendingReconfigure) await this.reconfigure()
    log.info(`Recording written: ${file}`)
    // Turn the crash-safe MKV into an MP4 (no quality loss, just a container change).
    void this.storeRecording(file, game, started)
  }

  private async storeRecording(mkv: string, game: ActiveGame, started: Date): Promise<void> {
    const folder = path.join(getSettings().outputFolder, library.gameFolderName(game.name))
    const name = `Recording ${stamp(started)}`
    fs.mkdirSync(folder, { recursive: true })
    let target = path.join(folder, name + '.mp4')
    for (let i = 2; fs.existsSync(target); i++) target = path.join(folder, `${name} (${i}).mp4`)
    library.markBusy(mkv, true)
    library.markBusy(target, true)
    try {
      await remux(mkv, target)
      fs.rmSync(mkv, { force: true })
    } catch (e) {
      log.error('Remux to MP4 failed, keeping the MKV', e)
      fs.rmSync(target, { force: true })
      target = moveInto(mkv, folder, name)
    } finally {
      library.markBusy(mkv, false)
      library.markBusy(target, false)
    }
    const title = game.detail ? `${game.detail} · ${timeLabel(started)}` : `Recording ${timeLabel(started)}`
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
        file = moveInto(raw, path.join(getSettings().outputFolder, library.gameFolderName(game.name)), `Clip ${stamp(now)}`)
      } finally {
        library.markBusy(raw, false)
      }
      log.info(`Clip saved: ${file}`)
      const title = game.detail ? `${game.detail} · ${timeLabel(now)}` : timeLabel(now)
      toast('success', 'Clip saved', `${game.name} · last ${formatDurationShort(this.outputs.config?.replaySeconds ?? 0)}`)
      void library.addFile(file, { kind: 'clip', game: game.id, gameName: game.name, title, createdAt: now.getTime() })
    })
  }

  /** Saves the current frame (full canvas resolution, e.g. 2560x1440) as a PNG. */
  screenshot(): Promise<void> {
    return this.serial(async () => {
      if (!this.graph) throw new Error('The recording engine is not running')
      const game = this.game ?? { id: DESKTOP.id, name: DESKTOP.name, detail: null }
      const now = new Date()
      const root = getSettings().outputFolder
      fs.mkdirSync(root, { recursive: true })
      const result = await osn.NodeObs.OBS_content_takeScreenshot(this.graph.video, root, stamp(now))
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

  // ----- Game detection (Step 5) -----

  private gameWindow: string | null = null
  private hookWarned = new Set<string>()
  private hookCheck: NodeJS.Timeout | null = null

  /** Called every few seconds by the game detector with the running game (or null). */
  updateGame(running: RunningGame | null): void {
    if (!running) {
      if (this.game) {
        this.game = null
        this.gameWindow = null
        this.graph?.setGame(null)
        this.emit()
      }
      return
    }
    const changed = this.game?.id !== running.def.id
    // Find the game's window among the ones OBS can capture.
    let win: { raw: string; title: string } | null = null
    try {
      const match = (this.graph?.listGameWindows() ?? []).find((w) => parseWindowString(w.id).exe.toLowerCase() === running.exe.toLowerCase())
      if (match) win = { raw: match.id, title: parseWindowString(match.id).title }
    } catch (e) {
      log.warn('Could not list game windows', e)
    }
    const detail = win ? detailFromTitle(win.title, running.def.name) : null
    this.game = { id: running.def.id, name: running.def.name, detail }
    if (changed) this.emit()

    if (getSettings().captureMode === 'auto' && win && win.raw !== this.gameWindow) {
      // Only switch the hook target when the window itself changes, not just its title.
      const sameWindow = this.gameWindow && parseWindowString(this.gameWindow).cls === parseWindowString(win.raw).cls
      if (!sameWindow) {
        this.graph?.setGame(win.raw)
        this.scheduleHookCheck(running.def.id, running.def.name)
      }
      this.gameWindow = win.raw
    }
  }

  /** A few seconds after targeting a game, check the hook worked; if not, explain what's happening. */
  private scheduleHookCheck(id: string, name: string): void {
    if (this.hookCheck) clearTimeout(this.hookCheck)
    this.hookCheck = setTimeout(() => {
      const size = this.graph?.gameSize()
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

  /** Applies the "Capture" setting (auto game capture vs display only). */
  private applyCaptureMode(mode: AppSettings['captureMode']): void {
    if (mode === 'display') {
      this.graph?.setGame(null)
      this.gameWindow = null
    }
    // In "auto" mode the next detector tick picks the game up again.
  }

  getGraph(): CaptureGraph | null {
    return this.graph
  }

  async shutdown(): Promise<void> {
    await this.outputs.shutdown()
    this.graph?.destroy()
    this.graph = null
  }
}
