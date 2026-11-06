// Keeps OBS in sync with your profiles. Each profile is an OBS scene; each of its sources is an
// OBS input placed in that scene. Global audio (desktop audio, mics) lives on OBS's audio
// channels so it is recorded whatever the profile. Switching profile plays the chosen transition.
//
// `sync(state)` is called with the whole profiles state whenever anything changes; it works out
// what is different and only touches those parts of OBS.
import type * as OSN from 'obs-studio-node'
import { osn } from './obs'
import { createLogger } from '../logger'
import type { Profile, ProfileSource, ProfilesState, SerializedProperty, SourceTransform, TransitionSettings } from '@shared/types'
import { serializeProperties, notifyModified, clickButton } from './properties'

const log = createLogger('scenes')

export interface VideoConfig {
  baseWidth: number
  baseHeight: number
  outputWidth: number
  outputHeight: number
  fpsNum: number
  fpsDen: number
  format: number
  colorspace: number
  range: number
  scaleType: number
}

interface InputEntry {
  input: OSN.IInput
  obsType: string
  settingsSig: string
  audioSig: string
  filterOrder: string
  filters: Map<string, { filter: OSN.IFilter; sig: string }>
  volmeter: OSN.IVolmeter | null
}

interface SceneEntry {
  scene: OSN.IScene
  items: Map<string, { item: OSN.ISceneItem; sig: string }>
  order: string
}

const AUDIO_FLAG = 2 // OBS_SOURCE_AUDIO

function allSources(state: ProfilesState): ProfileSource[] {
  return [...state.profiles.flatMap((p) => p.sources), ...state.globalAudio]
}

export class SceneManager {
  readonly video: OSN.IVideo
  private config: VideoConfig
  private inputs = new Map<string, InputEntry>()
  private scenes = new Map<string, SceneEntry>()
  private transition: OSN.ITransition | null = null
  private transitionType = ''
  private transitionSettingsSig = ''
  private activeId: string | null = null
  private channels: (string | null)[] = [null, null, null, null, null, null]
  private state: ProfilesState | null = null
  private autoGameWindow: string | null = null
  /** Called ~20 times a second with audio levels: { sourceId: [peak dB per channel] }. */
  onLevels: ((levels: Record<string, number[]>) => void) | null = null

  constructor(config: VideoConfig) {
    this.config = config
    this.video = osn.VideoFactory.create()
    this.applyVideo(config)
    // The engine's callback worker only runs once a source callback is registered.
    osn.NodeObs.RegisterSourceCallback(() => {})
    osn.NodeObs.RegisterVolmeterCallback((items: { sourceName: string; peak: number[] }[]) => {
      if (!this.onLevels) return
      const levels: Record<string, number[]> = {}
      for (const i of items) levels[i.sourceName] = i.peak
      this.onLevels(levels)
    })
  }

  // ----- Video -----

  private applyVideo(c: VideoConfig): void {
    this.video.video = {
      fpsNum: c.fpsNum,
      fpsDen: c.fpsDen,
      baseWidth: c.baseWidth,
      baseHeight: c.baseHeight,
      outputWidth: c.outputWidth,
      outputHeight: c.outputHeight,
      outputFormat: c.format as unknown as OSN.EVideoFormat,
      colorspace: c.colorspace as unknown as OSN.EColorSpace,
      range: c.range as unknown as OSN.ERangeType,
      scaleType: c.scaleType as unknown as OSN.EScaleType,
      fpsType: 2 as unknown as OSN.EFPSType
    }
  }

  /** Changes canvas/output size, fps or colors. Only call while nothing is recording. */
  setVideo(c: VideoConfig): void {
    const canvasChanged = c.baseWidth !== this.config.baseWidth || c.baseHeight !== this.config.baseHeight
    this.config = c
    this.applyVideo(c)
    if (canvasChanged) {
      // "Fit"/"Stretch" sources depend on the canvas size.
      for (const se of this.scenes.values()) for (const ie of se.items.values()) ie.sig = ''
      if (this.state) this.sync(this.state)
    }
    log.info(`Video: ${c.baseWidth}x${c.baseHeight} -> ${c.outputWidth}x${c.outputHeight} @ ${(c.fpsNum / c.fpsDen).toFixed(2)}fps`)
  }

  getVideoConfig(): VideoConfig {
    return this.config
  }

  // ----- Syncing profiles to OBS -----

  sync(state: ProfilesState): void {
    this.state = state
    const wanted = new Set<string>()
    for (const src of allSources(state)) {
      wanted.add(src.id)
      try {
        this.syncInput(src)
      } catch (e) {
        log.error(`Could not set up source "${src.name}" (${src.obsType})`, e)
      }
    }
    for (const p of state.profiles) {
      try {
        this.syncScene(p)
      } catch (e) {
        log.error(`Could not set up profile "${p.name}"`, e)
      }
    }
    for (const [pid, se] of [...this.scenes]) {
      if (!state.profiles.some((p) => p.id === pid)) {
        for (const ie of se.items.values()) ie.item.remove()
        se.scene.release()
        this.scenes.delete(pid)
      }
    }
    for (const id of [...this.inputs.keys()]) if (!wanted.has(id)) this.destroyInput(id)

    // Global audio on OBS channels 1-6.
    for (let i = 0; i < 6; i++) {
      const src = state.globalAudio[i]
      const want = src ? src.id : null
      if (this.channels[i] !== want) {
        const entry = want ? this.inputs.get(want) : null
        osn.Global.setOutputSource(i + 1, (entry?.input ?? null) as unknown as OSN.ISource)
        this.channels[i] = want
      }
    }

    this.syncTransition(state.transition)
    if (state.activeId !== this.activeId) this.activate(state.activeId)
  }

  private effectiveSettings(src: ProfileSource): Record<string, unknown> {
    if (src.kind !== 'auto_game') return src.settings
    return { ...src.settings, capture_mode: 'window', priority: 2, window: this.autoGameWindow ?? '' }
  }

  private syncInput(src: ProfileSource): void {
    let e = this.inputs.get(src.id)
    const settings = this.effectiveSettings(src)
    const sig = JSON.stringify(settings)
    if (!e || e.obsType !== src.obsType) {
      if (e) this.destroyInput(src.id)
      const input = osn.InputFactory.create(src.obsType, src.id, settings)
      if (!input) throw new Error(`OBS could not create a "${src.obsType}" source (plugin missing?)`)
      e = { input, obsType: src.obsType, settingsSig: sig, audioSig: '', filterOrder: '', filters: new Map(), volmeter: null }
      this.inputs.set(src.id, e)
      if ((input.outputFlags & AUDIO_FLAG) !== 0) {
        e.volmeter = osn.VolmeterFactory.create(1 as unknown as OSN.EFaderType)
        e.volmeter.attach(input)
      }
      log.info(`Created source "${src.name}" (${src.obsType})`)
    } else if (e.settingsSig !== sig) {
      e.input.update(settings)
      e.settingsSig = sig
    }

    const a = src.audio
    const audioSig = JSON.stringify(a)
    if (audioSig !== e.audioSig) {
      e.input.volume = a.volume
      e.input.muted = a.muted
      e.input.audioMixers = a.mixers
      e.input.monitoringType = a.monitoring as unknown as OSN.EMonitoringType
      const ns = Math.round(a.syncOffsetMs * 1e6)
      e.input.syncOffset = { sec: Math.trunc(ns / 1e9), nsec: ns % 1e9 }
      e.audioSig = audioSig
    }
    this.syncFilters(e, src)
  }

  private syncFilters(e: InputEntry, src: ProfileSource): void {
    const order = src.filters.map((f) => f.id + ':' + f.type).join('|')
    if (order !== e.filterOrder) {
      for (const fe of e.filters.values()) {
        try {
          e.input.removeFilter(fe.filter)
          fe.filter.release()
        } catch {
          /* already gone */
        }
      }
      e.filters.clear()
      for (const f of src.filters) {
        try {
          const filter = osn.FilterFactory.create(f.type, `${src.id}:${f.id}`, f.settings)
          filter.enabled = f.enabled
          e.input.addFilter(filter)
          e.filters.set(f.id, { filter, sig: JSON.stringify([f.settings, f.enabled]) })
        } catch (err) {
          log.error(`Could not add filter "${f.name}" (${f.type}) to "${src.name}"`, err)
        }
      }
      e.filterOrder = order
      return
    }
    for (const f of src.filters) {
      const fe = e.filters.get(f.id)
      const sig = JSON.stringify([f.settings, f.enabled])
      if (fe && fe.sig !== sig) {
        fe.filter.update(f.settings)
        fe.filter.enabled = f.enabled
        fe.sig = sig
      }
    }
  }

  private syncScene(p: Profile): void {
    let se = this.scenes.get(p.id)
    if (!se) {
      se = { scene: osn.SceneFactory.create(`profile_${p.id}`), items: new Map(), order: '' }
      this.scenes.set(p.id, se)
    }
    const present = new Set(p.sources.map((s) => s.id))
    for (const [sid, ie] of [...se.items]) {
      if (!present.has(sid)) {
        ie.item.remove()
        se.items.delete(sid)
      }
    }
    for (const s of p.sources) {
      const input = this.inputs.get(s.id)?.input
      if (!input) continue
      let ie = se.items.get(s.id)
      if (!ie) {
        const item = se.scene.add(input)
        item.video = this.video
        ie = { item, sig: '' }
        se.items.set(s.id, ie)
        se.order = ''
      }
      const visible = s.visible && (s.kind !== 'auto_game' || !!this.autoGameWindow)
      const sig = JSON.stringify([visible, s.transform])
      if (sig !== ie.sig) {
        this.applyTransform(ie.item, s.transform)
        ie.item.visible = visible
        ie.sig = sig
      }
    }
    // The first source in the list is drawn on top (like OBS). OBS order index 0 is the bottom.
    const order = p.sources.map((s) => s.id).join('|')
    if (order !== se.order) {
      ;[...p.sources].reverse().forEach((s, i) => se!.items.get(s.id)?.item.move(i))
      se.order = order
    }
  }

  private applyTransform(item: OSN.ISceneItem, t: SourceTransform): void {
    const { baseWidth: W, baseHeight: H } = this.config
    if (t.fit === 'fit' || t.fit === 'stretch') {
      item.position = { x: 0, y: 0 }
      item.rotation = 0
      item.scale = { x: 1, y: 1 }
      item.alignment = 5 as unknown as OSN.EAlignment
      item.boundsType = (t.fit === 'fit' ? 2 : 1) as unknown as OSN.EBoundsType
      item.boundsAlignment = 0
      item.bounds = { x: W, y: H }
    } else {
      item.alignment = t.alignment as unknown as OSN.EAlignment
      item.boundsType = t.boundsType as unknown as OSN.EBoundsType
      item.boundsAlignment = t.boundsAlignment
      if (t.boundsType) item.bounds = { x: t.boundsWidth, y: t.boundsHeight }
      item.scale = { x: t.scaleX, y: t.scaleY }
      item.position = { x: t.x, y: t.y }
      item.rotation = t.rotation
    }
    item.crop = { left: t.crop.left, right: t.crop.right, top: t.crop.top, bottom: t.crop.bottom }
  }

  private syncTransition(t: TransitionSettings): void {
    const sig = JSON.stringify(t.settings)
    if (!this.transition || this.transitionType !== t.type) {
      const old = this.transition
      try {
        this.transition = osn.TransitionFactory.create(t.type, 'Profile transition', t.settings)
      } catch (e) {
        log.error(`Transition "${t.type}" failed, using a cut`, e)
        this.transition = osn.TransitionFactory.create('cut_transition', 'Profile transition', {})
      }
      this.transitionType = t.type
      this.transitionSettingsSig = sig
      osn.Global.setOutputSource(0, this.transition)
      const active = this.activeId ? this.scenes.get(this.activeId) : null
      if (active) this.transition.set(active.scene)
      try {
        old?.release()
      } catch {
        /* ignore */
      }
    } else if (sig !== this.transitionSettingsSig) {
      this.transition.update(t.settings)
      this.transitionSettingsSig = sig
    }
  }

  private activate(id: string): void {
    const se = this.scenes.get(id)
    if (!se || !this.transition) return
    if (!this.activeId) this.transition.set(se.scene)
    else this.transition.start(this.state?.transition.durationMs ?? 300, se.scene)
    this.activeId = id
    log.info(`Active profile: ${this.state?.profiles.find((p) => p.id === id)?.name ?? id}`)
  }

  private destroyInput(id: string): void {
    const e = this.inputs.get(id)
    if (!e) return
    try {
      e.volmeter?.detach()
      e.volmeter?.destroy()
      for (const fe of e.filters.values()) fe.filter.release()
      e.input.release()
    } catch (err) {
      log.warn(`Error removing source ${id}`, err)
    }
    this.inputs.delete(id)
  }

  // ----- Auto game capture -----

  /** Points every "Auto game capture" source at the game's window (or hides them). */
  setAutoGameWindow(window: string | null): void {
    if (window === this.autoGameWindow) return
    this.autoGameWindow = window
    if (this.state) this.sync(this.state)
    log.info(`Auto game capture target: ${window ?? 'none'}`)
  }

  private activeAutoGameInput(): OSN.IInput | null {
    const p = this.state?.profiles.find((x) => x.id === this.activeId)
    const src = p?.sources.find((s) => s.kind === 'auto_game' && s.visible)
    return src ? (this.inputs.get(src.id)?.input ?? null) : null
  }

  hasAutoGameInActiveProfile(): boolean {
    return !!this.activeAutoGameInput()
  }

  /** The window strings OBS's game capture can see right now. */
  listGameWindows(): { id: string; name: string }[] {
    let temp: OSN.IInput | null = null
    try {
      const input = this.activeAutoGameInput() ?? (temp = osn.InputFactory.create('game_capture', `probe_${Date.now()}`, { capture_mode: 'window' }))
      const p = input.properties.get('window') as OSN.IListProperty | undefined
      return (p?.details?.items ?? []).map((i) => ({ id: String(i.value), name: i.name }))
    } finally {
      temp?.release()
    }
  }

  gameSize(): { width: number; height: number } {
    const i = this.activeAutoGameInput()
    return { width: i?.width ?? 0, height: i?.height ?? 0 }
  }

  // ----- Inspecting sources -----

  /** Display sources in the active profile that produce no image (black). */
  blackDisplaySources(): ProfileSource[] {
    const p = this.state?.profiles.find((x) => x.id === this.activeId)
    return (p?.sources ?? []).filter((s) => s.kind === 'display' && s.visible && (this.inputs.get(s.id)?.input.width ?? 1) === 0)
  }

  sourceSize(id: string): { width: number; height: number } {
    const i = this.inputs.get(id)?.input
    return { width: i?.width ?? 0, height: i?.height ?? 0 }
  }

  hasAudio(id: string): boolean {
    const i = this.inputs.get(id)?.input
    return !!i && (i.outputFlags & AUDIO_FLAG) !== 0
  }

  sourceProperties(id: string): SerializedProperty[] {
    return serializeProperties(this.inputs.get(id)?.input.properties)
  }

  sourceModified(id: string, name: string): void {
    const i = this.inputs.get(id)?.input
    if (i) notifyModified(i, name)
  }

  sourceButton(id: string, name: string): void {
    const i = this.inputs.get(id)?.input
    if (i) clickButton(i, name)
  }

  filterProperties(sourceId: string, filterId: string): SerializedProperty[] {
    return serializeProperties(this.inputs.get(sourceId)?.filters.get(filterId)?.filter.properties)
  }

  filterModified(sourceId: string, filterId: string, name: string): void {
    const f = this.inputs.get(sourceId)?.filters.get(filterId)?.filter
    if (f) notifyModified(f, name)
  }

  filterButton(sourceId: string, filterId: string, name: string): void {
    const f = this.inputs.get(sourceId)?.filters.get(filterId)?.filter
    if (f) clickButton(f, name)
  }

  /** The filters OBS has, split into ones for video and ones for audio. */
  filterTypes(): string[] {
    return osn.FilterFactory.types()
  }

  transitionTypes(): string[] {
    return osn.TransitionFactory.types()
  }

  transitionProperties(): SerializedProperty[] {
    return serializeProperties(this.transition?.properties)
  }

  /** Current (live) settings of a source, including OBS defaults. */
  sourceSettings(id: string): Record<string, unknown> {
    return (this.inputs.get(id)?.input.settings as Record<string, unknown>) ?? {}
  }

  destroy(): void {
    try {
      for (const se of this.scenes.values()) {
        for (const ie of se.items.values()) ie.item.remove()
        se.items.clear()
      }
      osn.Global.setOutputSource(0, null as unknown as OSN.ISource)
      for (let i = 1; i <= 6; i++) osn.Global.setOutputSource(i, null as unknown as OSN.ISource)
      for (const id of [...this.inputs.keys()]) this.destroyInput(id)
      for (const se of this.scenes.values()) se.scene.release()
      this.scenes.clear()
      this.transition?.release()
    } catch (e) {
      log.warn('Error while tearing down scenes', e)
    }
    try {
      this.video.destroy()
    } catch {
      // Expected when the live preview was used: the canvas goes away with the engine on quit.
    }
  }
}
