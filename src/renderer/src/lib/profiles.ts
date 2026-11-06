// Small helpers for changing the profiles state in the UI.
import type { Profile, ProfileSource, ProfilesState } from '@shared/types'

export function rid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`
}

export function activeProfile(state: ProfilesState): Profile {
  return state.profiles.find((p) => p.id === state.activeId) ?? state.profiles[0]
}

export function findSource(state: ProfilesState, id: string | null): ProfileSource | null {
  if (!id) return null
  for (const p of state.profiles) {
    const s = p.sources.find((x) => x.id === id)
    if (s) return s
  }
  return state.globalAudio.find((s) => s.id === id) ?? null
}

export function isGlobal(state: ProfilesState, id: string): boolean {
  return state.globalAudio.some((s) => s.id === id)
}

export function mapSource(state: ProfilesState, id: string, fn: (s: ProfileSource) => ProfileSource): ProfilesState {
  return {
    ...state,
    profiles: state.profiles.map((p) => ({ ...p, sources: p.sources.map((s) => (s.id === id ? fn(s) : s)) })),
    globalAudio: state.globalAudio.map((s) => (s.id === id ? fn(s) : s))
  }
}

export function mapProfile(state: ProfilesState, id: string, fn: (p: Profile) => Profile): ProfilesState {
  return { ...state, profiles: state.profiles.map((p) => (p.id === id ? fn(p) : p)) }
}

export function removeSource(state: ProfilesState, id: string): ProfilesState {
  return {
    ...state,
    profiles: state.profiles.map((p) => ({ ...p, sources: p.sources.filter((s) => s.id !== id) })),
    globalAudio: state.globalAudio.filter((s) => s.id !== id)
  }
}

/** A copy of a source with new ids (for duplicating). */
export function cloneSource(s: ProfileSource, name = s.name): ProfileSource {
  return { ...structuredClone(s), id: rid('src'), name, filters: s.filters.map((f) => ({ ...structuredClone(f), id: rid('flt') })) }
}

export function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`
}

/** Linear volume <-> slider position (cubic, like OBS's fader feel). */
export const volToPos = (v: number) => Math.cbrt(Math.max(0, v))
export const posToVol = (p: number) => Math.pow(Math.max(0, p), 3)
export const volToDb = (v: number) => (v <= 0.0001 ? -Infinity : 20 * Math.log10(v))
