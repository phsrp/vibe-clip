// Your profiles (what OBS calls scenes): saved as profiles.json in the app's data folder.
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { ProfilesState } from '@shared/types'
import { createLogger } from '../logger'
import { getSettings } from '../settings'
import { createSource, newId } from './sourceTypes'

const log = createLogger('profiles')

type Listener = (next: ProfilesState, prev: ProfilesState) => void
let current: ProfilesState | null = null
const listeners: Listener[] = []

function file(): string {
  return path.join(app.getPath('userData'), 'profiles.json')
}

/** First run: builds a "Gaming" profile from the Phase 1 capture settings. */
function initialState(): ProfilesState {
  const s = getSettings()
  const game = createSource('auto_game', 'Game', 1920, 1080)
  const display = createSource('display', 'Display', 1920, 1080, s.monitorId ? { monitor_id: s.monitorId } : {})
  if (s.captureMode === 'display') game.visible = false
  const desktop = createSource('desktop_audio', 'Desktop audio', 1920, 1080, { device_id: s.desktopAudioDevice || 'default' })
  desktop.audio.muted = s.desktopAudio === false
  const mic = createSource('mic', 'Microphone', 1920, 1080, { device_id: s.micDevice || 'default' })
  mic.audio.muted = s.mic === false
  const profile = { id: newId('prof'), name: 'Gaming', sources: [game, display], hotkey: '' }
  return {
    profiles: [profile],
    activeId: profile.id,
    globalAudio: [desktop, mic],
    transition: { type: 'fade_transition', durationMs: 300, settings: {} }
  }
}

export function getProfiles(): ProfilesState {
  if (current) return current
  try {
    if (fs.existsSync(file())) {
      const saved = JSON.parse(fs.readFileSync(file(), 'utf8')) as ProfilesState
      if (saved.profiles?.length) current = saved
    }
  } catch (e) {
    log.error('profiles.json was unreadable, starting fresh (the broken file is kept as profiles.broken.json)', e)
    try {
      fs.copyFileSync(file(), file().replace('.json', '.broken.json'))
    } catch {
      /* ignore */
    }
  }
  if (!current) {
    current = initialState()
    save(current)
    log.info('Created the first profile from your capture settings')
  }
  if (!current.profiles.some((p) => p.id === current!.activeId)) current.activeId = current.profiles[0].id
  return current
}

let saveTimer: NodeJS.Timeout | null = null

/** Writes profiles.json shortly after the last change (dragging a fader changes it many times a second). */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (current) save(current)
  }, 400)
}

/** Writes any pending change immediately (called on quit). */
export function flushProfiles(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    if (current) save(current)
  }
}

function save(state: ProfilesState): void {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true })
    const tmp = file() + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
    fs.renameSync(tmp, file())
  } catch (e) {
    log.error('Could not save profiles', e)
  }
}

export function setProfiles(next: ProfilesState): ProfilesState {
  const prev = getProfiles()
  if (!next.profiles.length) throw new Error('You need at least one profile')
  if (!next.profiles.some((p) => p.id === next.activeId)) next = { ...next, activeId: next.profiles[0].id }
  current = next
  scheduleSave()
  for (const l of listeners) {
    try {
      l(next, prev)
    } catch (e) {
      log.error('Profiles listener failed', e)
    }
  }
  return next
}

export function onProfilesChange(l: Listener): void {
  listeners.push(l)
}

/** Finds a source (in any profile or the global audio list). */
export function findSource(state: ProfilesState, id: string) {
  for (const p of state.profiles) {
    const s = p.sources.find((x) => x.id === id)
    if (s) return s
  }
  return state.globalAudio.find((x) => x.id === id) ?? null
}

/** Returns a copy of the state with one source changed (wherever it lives). */
export function mapSource(state: ProfilesState, id: string, fn: (s: import('@shared/types').ProfileSource) => import('@shared/types').ProfileSource): ProfilesState {
  return {
    ...state,
    profiles: state.profiles.map((p) => ({ ...p, sources: p.sources.map((s) => (s.id === id ? fn(s) : s)) })),
    globalAudio: state.globalAudio.map((s) => (s.id === id ? fn(s) : s))
  }
}
