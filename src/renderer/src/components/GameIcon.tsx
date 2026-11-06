import { IconDeviceDesktop } from '@tabler/icons-react'

/** Small game icon: the game's real icon when we have it, otherwise a colored letter. */
export function GameIcon({ id, name, icon, size = 16 }: { id: string; name: string; icon?: string | null; size?: number }) {
  if (icon) return <img className="game-icon" src={icon} width={size} height={size} alt="" />
  if (id === 'desktop')
    return (
      <span className="game-icon generic" style={{ width: size, height: size }}>
        <IconDeviceDesktop size={size - 4} stroke={2} />
      </span>
    )
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 360
  return (
    <span
      className="game-icon letter"
      style={{ width: size, height: size, fontSize: size * 0.6, background: `hsl(${hash} 55% 45%)` }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )
}
