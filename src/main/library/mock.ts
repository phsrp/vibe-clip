// TEMPORARY fake clips so the UI can be checked before the real library exists (Step 1 only).
import type { Clip, LibrarySnapshot } from '@shared/types'

const GAMES = [
  { id: 'osu', name: 'osu!' },
  { id: 'cs2', name: 'Counter-Strike 2' },
  { id: 'geometry-dash', name: 'Geometry Dash' },
  { id: 'desktop', name: 'Desktop' }
]
const TITLES = ['Dance Number', 'Shoujo A [Lost]', 'Flower Dance [Titania]', 'clutch 1v3', 'Burning Star', 'magic rock', 'polygon [heptagon]']

export function mockLibrary(): LibrarySnapshot {
  const clips: Clip[] = []
  const now = Date.now()
  for (let i = 0; i < 40; i++) {
    const g = GAMES[i % 7 === 0 ? 3 : i % 3]
    const created = now - i * 3.1 * 3600 * 1000
    const shot = i % 9 === 4
    clips.push({
      id: i + 1,
      path: '',
      title: g.id === 'desktop' ? new Date(created).toLocaleTimeString() : `${TITLES[i % TITLES.length]} · ${new Date(created).toLocaleTimeString()}`,
      kind: shot ? 'screenshot' : 'clip',
      game: g.id,
      gameName: g.name,
      createdAt: created,
      duration: shot ? 0 : i % 4 === 0 ? 96 : 180,
      size: shot ? 290_000 : (220 + ((i * 37) % 200)) * 1024 * 1024,
      width: 1920,
      height: 1080,
      thumb: null,
      url: '',
      shared: i === 3,
      collections: i === 5 ? [1] : []
    })
  }
  const count = (id: string) => clips.filter((c) => c.game === id).length
  return {
    clips,
    games: GAMES.map((g) => ({ ...g, count: count(g.id), icon: null })),
    collections: [{ id: 1, name: 'crazy cs', count: 1, cover: null }]
  }
}
