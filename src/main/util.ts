/** 180 -> "3 min", 45 -> "45 s", 90 -> "1.5 min". */
export function formatDurationShort(seconds: number): string {
  if (seconds >= 60) return `${Math.round((seconds / 60) * 10) / 10} min`
  return `${seconds} s`
}
