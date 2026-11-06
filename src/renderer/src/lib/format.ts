import type { Clip } from '@shared/types'

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} kB`
}

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function dayLabel(dayStart: number): string {
  const today = startOfDay(Date.now())
  if (dayStart === today) return 'Today'
  if (dayStart === today - 86400000 || today - dayStart === 86400000) return 'Yesterday'
  const d = new Date(dayStart)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  })
}

export interface DayGroup {
  key: number
  label: string
  clips: Clip[]
}

/** Groups clips by calendar day, keeping the order they came in. */
export function groupByDay(clips: Clip[]): DayGroup[] {
  const groups: DayGroup[] = []
  const byKey = new Map<number, DayGroup>()
  for (const clip of clips) {
    const key = startOfDay(clip.createdAt)
    let g = byKey.get(key)
    if (!g) {
      g = { key, label: dayLabel(key), clips: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.clips.push(clip)
  }
  return groups
}

export function countLabel(clips: Clip[]): string {
  const shots = clips.filter((c) => c.kind === 'screenshot').length
  const vids = clips.length - shots
  const parts: string[] = []
  if (vids) parts.push(`${vids} clip${vids === 1 ? '' : 's'}`)
  if (shots) parts.push(`${shots} screenshot${shots === 1 ? '' : 's'}`)
  return parts.join(', ')
}
