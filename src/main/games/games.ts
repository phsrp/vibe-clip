// Games we recognise by their process name. To add a built-in game, add a line here.
// (You can also add games from the Sources page without touching code.)
import type { GameDefinition } from '@shared/types'
import { getSettings } from '../settings'

export const BUILT_IN_GAMES: GameDefinition[] = [
  { id: 'osu', name: 'osu!', processes: ['osu!.exe'] },
  { id: 'cs2', name: 'Counter-Strike 2', processes: ['cs2.exe'] },
  { id: 'geometry-dash', name: 'Geometry Dash', processes: ['GeometryDash.exe'] }
]

export const DESKTOP = { id: 'desktop', name: 'Desktop' }

export function allGames(): GameDefinition[] {
  return [...BUILT_IN_GAMES, ...getSettings().customGames]
}

export function gameName(id: string): string {
  if (id === DESKTOP.id) return DESKTOP.name
  return allGames().find((g) => g.id === id)?.name ?? id
}
