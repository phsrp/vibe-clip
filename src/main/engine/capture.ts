// What OBS captures: a video canvas with one scene in it (display capture, plus game capture
// from Step 5), and the desktop-audio and microphone sources.
// Phase 2 (scenes/profiles) will replace the single fixed scene with user-defined ones.
import type * as OSN from 'obs-studio-node'
import { osn } from './obs'
import { createLogger } from '../logger'
import { BoundsType, Channel, ColorSpace, DisplayMethod, FPSType, RangeType, ScaleType, Tracks, VideoFormat, Alignment } from './constants'
import type { DeviceOption } from '@shared/types'

const log = createLogger('capture')

export interface VideoConfig {
  baseWidth: number
  baseHeight: number
  outputWidth: number
  outputHeight: number
  fps: number
}

export interface AudioConfig {
  desktopEnabled: boolean
  desktopDevice: string
  micEnabled: boolean
  micDevice: string
}

function listItems(input: OSN.IInput, prop: string): DeviceOption[] {
  try {
    const p = input.properties.get(prop) as OSN.IListProperty | undefined
    return (p?.details?.items ?? []).map((i) => ({ id: String(i.value), name: i.name }))
  } catch (e) {
    log.warn(`Could not read ${prop} list`, e)
    return []
  }
}

/** Picks the output size: the chosen height (never bigger than the display), keeping the display's shape. */
export function outputSize(baseW: number, baseH: number, targetHeight: number | 'native'): { width: number; height: number } {
  if (targetHeight === 'native' || targetHeight >= baseH) return { width: baseW, height: baseH }
  const h = targetHeight
  const w = Math.round((baseW * h) / baseH / 2) * 2
  return { width: w, height: h }
}

export class CaptureGraph {
  readonly video: OSN.IVideo
  readonly scene: OSN.IScene
  private display: OSN.IInput
  private displayItem: OSN.ISceneItem
  private game: OSN.IInput | null = null
  private gameItem: OSN.ISceneItem | null = null
  private desktop: OSN.IInput
  private mic: OSN.IInput
  private config: VideoConfig

  constructor(config: VideoConfig, monitorId: string, audio: AudioConfig) {
    this.config = config
    this.video = osn.VideoFactory.create()
    this.applyVideo(config)

    this.scene = osn.SceneFactory.create('Vibe Clip Scene')
    // Method 2 = Windows Graphics Capture. OBS's "auto" picks DXGI, which silently returns
    // nothing on some PCs (seen with hardware GPU scheduling on). We fall back if WGC is black.
    this.display = osn.InputFactory.create('monitor_capture', 'Display Capture', { capture_cursor: true, method: DisplayMethod.WGC })
    this.selectMonitor(monitorId)
    this.displayItem = this.scene.add(this.display)
    this.displayItem.video = this.video
    this.fit(this.displayItem)
    osn.Global.setOutputSource(Channel.Video, this.scene)

    this.desktop = osn.InputFactory.create('wasapi_output_capture', 'Desktop Audio', { device_id: audio.desktopDevice || 'default' })
    this.desktop.audioMixers = Tracks.Mixed | Tracks.Desktop
    osn.Global.setOutputSource(Channel.DesktopAudio, this.desktop)

    this.mic = osn.InputFactory.create('wasapi_input_capture', 'Microphone', { device_id: audio.micDevice || 'default' })
    this.mic.audioMixers = Tracks.Mixed | Tracks.Mic
    osn.Global.setOutputSource(Channel.Mic, this.mic)

    this.setAudio(audio)
    log.info(`Capture ready: ${config.baseWidth}x${config.baseHeight} -> ${config.outputWidth}x${config.outputHeight} @ ${config.fps}fps`)
  }

  private applyVideo(c: VideoConfig): void {
    const info: OSN.IVideoInfo = {
      fpsNum: c.fps,
      fpsDen: 1,
      baseWidth: c.baseWidth,
      baseHeight: c.baseHeight,
      outputWidth: c.outputWidth,
      outputHeight: c.outputHeight,
      outputFormat: VideoFormat.NV12 as unknown as OSN.EVideoFormat,
      colorspace: ColorSpace.CS709 as unknown as OSN.EColorSpace,
      range: RangeType.Partial as unknown as OSN.ERangeType,
      scaleType: ScaleType.Bicubic as unknown as OSN.EScaleType,
      fpsType: FPSType.Fractional as unknown as OSN.EFPSType
    }
    this.video.video = info
  }

  /** Changes resolution / fps. Only call when nothing is recording. */
  setVideo(c: VideoConfig): void {
    this.config = c
    this.applyVideo(c)
    this.fit(this.displayItem)
    if (this.gameItem) this.fit(this.gameItem)
    log.info(`Video changed: ${c.baseWidth}x${c.baseHeight} -> ${c.outputWidth}x${c.outputHeight} @ ${c.fps}fps`)
  }

  getVideoConfig(): VideoConfig {
    return this.config
  }

  /** Scales a source to fill the canvas (keeping its shape). */
  private fit(item: OSN.ISceneItem): void {
    item.position = { x: 0, y: 0 }
    item.alignment = Alignment.TopLeft as unknown as OSN.EAlignment
    item.boundsType = BoundsType.ScaleInner as unknown as OSN.EBoundsType
    item.boundsAlignment = Alignment.Center
    item.bounds = { x: this.config.baseWidth, y: this.config.baseHeight }
  }

  listMonitors(): DeviceOption[] {
    return listItems(this.display, 'monitor_id')
  }

  /** Returns the monitor actually used (and its size if we could read it). */
  selectMonitor(monitorId: string): { id: string; name: string; width: number; height: number } | null {
    const monitors = this.listMonitors()
    if (monitors.length === 0) {
      log.warn('OBS reported no monitors')
      return null
    }
    const chosen =
      monitors.find((m) => m.id === monitorId) ?? monitors.find((m) => /primary/i.test(m.name)) ?? monitors[0]
    this.display.update({ monitor_id: chosen.id })
    const size = /(\d{3,5})\s*x\s*(\d{3,5})/.exec(chosen.name)
    log.info(`Display capture: ${chosen.name}`)
    return { id: chosen.id, name: chosen.name, width: size ? Number(size[1]) : 0, height: size ? Number(size[2]) : 0 }
  }

  listDesktopDevices(): DeviceOption[] {
    return listItems(this.desktop, 'device_id')
  }

  listMicDevices(): DeviceOption[] {
    return listItems(this.mic, 'device_id')
  }

  setAudio(a: AudioConfig): void {
    if (this.desktop.settings.device_id !== a.desktopDevice) this.desktop.update({ device_id: a.desktopDevice || 'default' })
    if (this.mic.settings.device_id !== a.micDevice) this.mic.update({ device_id: a.micDevice || 'default' })
    this.desktop.muted = !a.desktopEnabled
    this.mic.muted = !a.micEnabled
  }

  // ----- Game capture (used from Step 5) -----

  /**
   * Captures a game's window directly (hooks into the game, like OBS's Game Capture).
   * `window` is OBS's window string "Title:Class:exe". The display capture stays underneath,
   * so if the hook fails you still get the display instead of a black video.
   */
  setGame(window: string | null): void {
    if (!window) {
      if (this.gameItem) this.gameItem.visible = false
      this.game?.update({ window: '' })
      return
    }
    const settings = {
      capture_mode: 'window',
      window,
      priority: 2, // match by executable, so the game's window title can change (e.g. song names in osu!)
      capture_cursor: true,
      allow_transparency: false,
      anti_cheat_hook: true,
      hook_rate: 1
    }
    if (!this.game) {
      this.game = osn.InputFactory.create('game_capture', 'Game Capture', settings)
      this.gameItem = this.scene.add(this.game)
      this.gameItem.video = this.video
      this.fit(this.gameItem)
    } else {
      this.game.update(settings)
    }
    this.gameItem!.visible = true
    log.info(`Game capture target: ${window}`)
  }

  /** The window strings OBS's game capture can see right now. */
  listGameWindows(): DeviceOption[] {
    let temp: OSN.IInput | null = null
    try {
      const input = this.game ?? (temp = osn.InputFactory.create('game_capture', 'Game Capture (probe)', { capture_mode: 'window' }))
      return listItems(input, 'window')
    } finally {
      temp?.release()
    }
  }

  /** Switches how the display is captured (WGC or DXGI). */
  setDisplayMethod(method: number): void {
    this.display.update({ method })
    log.info(`Display capture method: ${method === DisplayMethod.WGC ? 'Windows Graphics Capture' : 'DXGI'}`)
  }

  displayMethod(): number {
    return Number(this.display.settings.method ?? 0)
  }

  /** Width/height of the display capture (0 means it isn't producing an image). */
  displaySize(): { width: number; height: number } {
    return { width: this.display.width, height: this.display.height }
  }

  /** Width/height of the hooked game (0 if not hooked yet). */
  gameSize(): { width: number; height: number } {
    return { width: this.game?.width ?? 0, height: this.game?.height ?? 0 }
  }

  destroy(): void {
    try {
      // Scene items must be removed before the video canvas they belong to.
      this.gameItem?.remove()
      this.displayItem.remove()
      osn.Global.setOutputSource(Channel.Video, null as unknown as OSN.ISource)
      osn.Global.setOutputSource(Channel.DesktopAudio, null as unknown as OSN.ISource)
      osn.Global.setOutputSource(Channel.Mic, null as unknown as OSN.ISource)
      this.game?.release()
      this.display.release()
      this.desktop.release()
      this.mic.release()
      this.scene.release()
      this.video.destroy()
    } catch (e) {
      log.warn('Error while tearing down capture', e)
    }
  }
}
