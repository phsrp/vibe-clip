import { memo, useEffect, useRef, useState } from 'react'
import { IconCamera, IconLink, IconMovie, IconPhoto, IconVideo } from '@tabler/icons-react'
import type { Clip } from '@shared/types'
import { formatDuration, formatSize } from '../lib/format'
import { GameIcon } from './GameIcon'

interface Props {
  clip: Clip
  gameIcon: string | null
  selected: boolean
  renaming: boolean
  onSelect: (clip: Clip) => void
  onOpen: (clip: Clip) => void
  onMenu: (clip: Clip, x: number, y: number) => void
  onRename: (clip: Clip, title: string | null) => void
}

export const ClipCard = memo(function ClipCard({ clip, gameIcon, selected, renaming, onSelect, onOpen, onMenu, onRename }: Props) {
  const [broken, setBroken] = useState(false)
  const KindIcon = clip.kind === 'screenshot' ? IconPhoto : clip.kind === 'recording' ? IconVideo : IconMovie

  return (
    <div
      className={'card' + (selected ? ' selected' : '')}
      onClick={() => onSelect(clip)}
      onDoubleClick={() => onOpen(clip)}
      onContextMenu={(e) => {
        e.preventDefault()
        onSelect(clip)
        onMenu(clip, e.clientX, e.clientY)
      }}
    >
      <div className="thumb">
        {clip.thumb && !broken ? (
          <img src={clip.thumb} loading="lazy" draggable={false} alt="" onError={() => setBroken(true)} />
        ) : (
          <div className="thumb-placeholder">
            <KindIcon size={28} stroke={1.5} />
          </div>
        )}
        {clip.shared && (
          <span className="badge badge-left">
            <IconLink size={12} /> Shared
          </span>
        )}
        <span className="badge">
          {clip.kind === 'screenshot' ? <IconCamera size={13} /> : formatDuration(clip.duration)}
        </span>
      </div>
      {renaming ? (
        <RenameInput initial={clip.title} onDone={(t) => onRename(clip, t)} />
      ) : (
        <div className="card-title" title={clip.title}>
          {clip.title}
        </div>
      )}
      <div className="card-meta">
        <GameIcon id={clip.game} name={clip.gameName} icon={gameIcon} size={14} />
        <span className="card-game">{clip.gameName}</span>
        <span>·</span>
        <span className="nowrap">{formatSize(clip.size)}</span>
      </div>
    </div>
  )
})

function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <input
      ref={ref}
      className="rename-input"
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value.trim() || null)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value.trim() || null)}
    />
  )
}
