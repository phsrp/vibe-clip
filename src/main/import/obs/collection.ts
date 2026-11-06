// Imports an OBS scene collection (%APPDATA%/obs-studio/basic/scenes/*.json) as profiles.
// Every OBS scene becomes a profile; its sources keep their exact OBS settings, position, size,
// crop, filters, volume, mute, monitoring, sync offset and audio-track routing. OBS's global
// audio devices become your always-on audio devices. Your OBS files are only read.
import * as fs from 'fs'
import * as path from 'path'
import type { FilterConfig, ObsCollectionPreview, Profile, ProfileSource, ProfilesState, SourceTransform } from '@shared/types'
import { createLogger } from '../../logger'
import { obsConfigDir } from './profile'
import { kindForObsType, newId, defaultAudio } from '../../profiles/sourceTypes'
import { TRANSITION_NAMES } from '../../profiles/filterNames'

const log = createLogger('obs-import')

interface ObsSource {
  name: string
  uuid?: string
  id: string
  versioned_id?: string
  settings?: Record<string, unknown> & { items?: ObsItem[] }
  mixers?: number
  sync?: number
  volume?: number
  muted?: boolean
  monitoring_type?: number
  balance?: number
  filters?: { name: string; id: string; versioned_id?: string; enabled?: boolean; settings?: Record<string, unknown> }[]
  hotkeys?: Record<string, { key: string; alt?: boolean; control?: boolean; shift?: boolean }[]>
}

interface ObsItem {
  name: string
  source_uuid?: string
  visible?: boolean
  rot?: number
  align?: number
  bounds_type?: number
  bounds_align?: number
  crop_left?: number
  crop_top?: number
  crop_right?: number
  crop_bottom?: number
  pos?: { x: number; y: number }
  scale?: { x: number; y: number }
  bounds?: { x: number; y: number }
}

interface ObsCollection {
  name?: string
  sources: ObsSource[]
  scene_order?: { name: string }[]
  current_scene?: string
  current_transition?: string
  transition_duration?: number
  transitions?: { name: string; id: string; settings?: Record<string, unknown> }[]
  resolution?: { x: number; y: number }
  [key: string]: unknown
}

const GLOBAL_KEYS = ['DesktopAudioDevice1', 'DesktopAudioDevice2', 'AuxAudioDevice1', 'AuxAudioDevice2', 'AuxAudioDevice3', 'AuxAudioDevice4']

function hotkey(bindings: ObsSource['hotkeys'], name: string): string {
  const b = bindings?.[name]?.[0]
  if (!b?.key) return ''
  let key = b.key.replace(/^OBS_KEY_/, '')
  if (/^NUM\d$/.test(key)) key = 'num' + key.slice(3)
  else if (!/^(F\d{1,2}|[A-Z]|\d)$/.test(key)) return ''
  return [b.control && 'Ctrl', b.alt && 'Alt', b.shift && 'Shift', key].filter(Boolean).join('+')
}

function readCollection(file: string): ObsCollection {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as ObsCollection
}

function convertFilters(src: ObsSource): FilterConfig[] {
  return (src.filters ?? []).map((f) => ({
    id: newId('flt'),
    name: f.name,
    type: f.versioned_id || f.id,
    enabled: f.enabled !== false,
    settings: f.settings ?? {}
  }))
}

function convertSource(src: ObsSource, name: string): ProfileSource {
  const obsType = src.versioned_id || src.id
  const kind = kindForObsType(obsType)
  return {
    id: newId('src'),
    name,
    obsType,
    kind,
    settings: src.settings ?? {},
    visible: true,
    transform: { fit: 'custom', x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alignment: 5, boundsType: 0, boundsWidth: 0, boundsHeight: 0, boundsAlignment: 0, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    audio: {
      ...defaultAudio(kind),
      volume: src.volume ?? 1,
      muted: !!src.muted,
      mixers: (src.mixers ?? 1) & 63, // OBS keeps unused bits above its 6 tracks
      monitoring: src.monitoring_type ?? 0,
      syncOffsetMs: Math.round((src.sync ?? 0) / 1e6),
      balance: src.balance ?? 0.5
    },
    filters: convertFilters(src)
  }
}

function convertTransform(item: ObsItem, factor: number, canvas: { width: number; height: number }): SourceTransform {
  const t: SourceTransform = {
    fit: 'custom',
    x: Math.round((item.pos?.x ?? 0) * factor),
    y: Math.round((item.pos?.y ?? 0) * factor),
    scaleX: (item.scale?.x ?? 1) * factor,
    scaleY: (item.scale?.y ?? 1) * factor,
    rotation: item.rot ?? 0,
    alignment: item.align ?? 5,
    boundsType: item.bounds_type ?? 0,
    boundsWidth: Math.round((item.bounds?.x ?? 0) * factor),
    boundsHeight: Math.round((item.bounds?.y ?? 0) * factor),
    boundsAlignment: item.bounds_align ?? 0,
    crop: { left: item.crop_left ?? 0, top: item.crop_top ?? 0, right: item.crop_right ?? 0, bottom: item.crop_bottom ?? 0 }
  }
  // A source scaled to exactly fill the canvas is shown as "Fit screen".
  if (t.boundsType === 2 && t.x === 0 && t.y === 0 && t.boundsWidth === canvas.width && t.boundsHeight === canvas.height && !t.rotation) {
    return { ...t, fit: 'fit' }
  }
  return t
}

interface Converted {
  profiles: Profile[]
  globalAudio: ProfileSource[]
  transition: ProfilesState['transition'] | null
  activeName: string | null
  imported: string[]
  skipped: string[]
}

function convert(col: ObsCollection, canvas: { width: number; height: number }, inputTypes: string[]): Converted {
  const byName = new Map(col.sources.map((s) => [s.name, s]))
  const byUuid = new Map(col.sources.filter((s) => s.uuid).map((s) => [s.uuid!, s]))
  const obsW = col.resolution?.x ?? canvas.width
  const factor = canvas.width / obsW
  const imported: string[] = []
  const skippedSet = new Set<string>()
  const order = col.scene_order?.map((s) => s.name) ?? col.sources.filter((s) => s.id === 'scene').map((s) => s.name)
  const profiles: Profile[] = []

  for (const sceneName of order) {
    const scene = byName.get(sceneName)
    if (!scene || scene.id !== 'scene') continue
    const sources: ProfileSource[] = []
    // OBS lists items bottom-to-top; our lists go top-to-bottom.
    for (const item of [...(scene.settings?.items ?? [])].reverse()) {
      const src = (item.source_uuid && byUuid.get(item.source_uuid)) || byName.get(item.name)
      if (!src) continue
      const type = src.versioned_id || src.id
      if (src.id === 'scene' || src.id === 'group') {
        skippedSet.add(`"${src.name}" in "${sceneName}": profiles inside profiles (nested scenes/groups) aren't supported yet`)
        continue
      }
      if (!inputTypes.includes(type)) {
        skippedSet.add(`"${src.name}" (${type}): that kind of source needs an OBS plugin Vibe Clip doesn't have`)
        continue
      }
      const ps = convertSource(src, src.name)
      ps.visible = item.visible !== false
      ps.transform = convertTransform(item, factor, canvas)
      sources.push(ps)
    }
    profiles.push({ id: newId('prof'), name: sceneName, sources, hotkey: hotkey(scene.hotkeys, 'OBSBasic.SelectScene') })
    imported.push(`Profile "${sceneName}": ${sources.length} source${sources.length === 1 ? '' : 's'}`)
  }

  const globalAudio: ProfileSource[] = []
  for (const key of GLOBAL_KEYS) {
    const src = col[key] as ObsSource | undefined
    if (!src?.id) continue
    const ps = convertSource(src, src.name || (key.startsWith('Aux') ? 'Microphone' : 'Desktop audio'))
    globalAudio.push(ps)
    imported.push(`Always-on audio: ${ps.name} (tracks ${[1, 2, 3, 4, 5, 6].filter((t) => ps.audio.mixers & (1 << (t - 1))).join(', ') || 'none'})`)
  }

  let transition: Converted['transition'] = null
  const tName = col.current_transition
  if (tName) {
    const custom = col.transitions?.find((t) => t.name === tName)
    const id = custom?.id ?? (tName.toLowerCase() === 'cut' ? 'cut_transition' : 'fade_transition')
    transition = { type: TRANSITION_NAMES[id] ? id : 'fade_transition', durationMs: col.transition_duration ?? 300, settings: custom?.settings ?? {} }
    imported.push(`Transition: ${TRANSITION_NAMES[transition.type]} (${transition.durationMs} ms)`)
  }
  if (factor !== 1) imported.push(`Positions scaled from ${obsW} wide to your ${canvas.width} wide canvas`)
  return { profiles, globalAudio, transition, activeName: col.current_scene ?? null, imported, skipped: [...skippedSet] }
}

export function listCollections(canvas: { width: number; height: number }, inputTypes: string[]): ObsCollectionPreview[] {
  const dir = path.join(obsConfigDir(), 'basic', 'scenes')
  if (!fs.existsSync(dir)) return []
  const out: ObsCollectionPreview[] = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    const file = path.join(dir, f)
    try {
      const col = readCollection(file)
      const c = convert(col, canvas, inputTypes)
      out.push({
        name: col.name ?? path.parse(f).name,
        file,
        profiles: c.profiles.map((p) => ({ name: p.name, sources: p.sources.length })),
        imported: c.imported,
        skipped: c.skipped
      })
    } catch (e) {
      log.error(`Could not read OBS scene collection ${f}`, e)
    }
  }
  return out
}

/** Returns the new profiles state with the collection's profiles added (and global audio replaced if asked). */
export function importCollection(
  file: string,
  current: ProfilesState,
  canvas: { width: number; height: number },
  inputTypes: string[],
  replaceAudio: boolean
): ProfilesState {
  const c = convert(readCollection(file), canvas, inputTypes)
  const taken = new Set(current.profiles.map((p) => p.name))
  const profiles = c.profiles.map((p) => {
    let name = p.name
    for (let i = 2; taken.has(name); i++) name = `${p.name} (${i})`
    taken.add(name)
    return { ...p, name }
  })
  const active = profiles.find((p) => p.name === c.activeName) ?? profiles[0]
  log.info(`Imported ${profiles.length} profiles from ${file}`)
  return {
    ...current,
    profiles: [...current.profiles, ...profiles],
    activeId: active?.id ?? current.activeId,
    globalAudio: replaceAudio && c.globalAudio.length ? c.globalAudio : current.globalAudio,
    transition: c.transition ?? current.transition
  }
}
