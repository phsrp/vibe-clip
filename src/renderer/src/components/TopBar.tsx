import { useEffect, useState } from 'react'
import {
  IconArrowsSort,
  IconBroadcast,
  IconBroadcastOff,
  IconCheck,
  IconFoldDown,
  IconFoldUp,
  IconMovie,
  IconPhoto,
  IconPlayerRecordFilled,
  IconPlayerStopFilled
} from '@tabler/icons-react'
import type { CaptureStatus, KindFilter, SortOrder } from '@shared/types'
import { formatDuration } from '../lib/format'
import { ContextMenu } from './ContextMenu'

const SORT_LABELS: Record<SortOrder, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  largest: 'Largest first',
  longest: 'Longest first'
}

interface Props {
  filter: KindFilter
  onFilter: (f: KindFilter) => void
  clipCount: number
  shotCount: number
  sort: SortOrder
  onSort: (s: SortOrder) => void
  allCollapsed: boolean
  onToggleCollapse: () => void
  capture: CaptureStatus
  engineError: string | null
  onToggleReplay: () => void
  onToggleRecording: () => void
}

export function TopBar(p: Props) {
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null)

  return (
    <header className="topbar">
      <button className={'tab' + (p.filter === 'all' ? ' active' : '')} onClick={() => p.onFilter('all')}>
        All
      </button>
      <button className={'tab' + (p.filter === 'clips' ? ' active' : '')} onClick={() => p.onFilter('clips')}>
        <IconMovie size={15} /> {p.clipCount} clip{p.clipCount === 1 ? '' : 's'}
      </button>
      <button className={'tab' + (p.filter === 'screenshots' ? ' active' : '')} onClick={() => p.onFilter('screenshots')}>
        <IconPhoto size={15} /> {p.shotCount} screenshot{p.shotCount === 1 ? '' : 's'}
      </button>
      <button
        className="tab"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setSortMenu({ x: r.left, y: r.bottom + 4 })
        }}
      >
        <IconArrowsSort size={15} /> {SORT_LABELS[p.sort]}
      </button>
      <button className="tab" onClick={p.onToggleCollapse}>
        {p.allCollapsed ? <IconFoldDown size={15} /> : <IconFoldUp size={15} />}
        {p.allCollapsed ? 'Expand all' : 'Collapse all'}
      </button>

      <div className="spacer" />

      {p.engineError ? (
        <span className="status-pill error" title={p.engineError}>
          <span className="dot" /> Engine error
        </span>
      ) : (
        <button
          className={'status-pill' + (p.capture.replayActive ? ' live' : '')}
          onClick={p.onToggleReplay}
          title={p.capture.replayActive ? 'Replay buffer is on. Click to turn it off.' : 'Replay buffer is off. Click to turn it on.'}
        >
          <span className="dot" />
          {p.capture.replayActive ? `Replay ${formatDuration(p.capture.replaySeconds)}` : 'Replay off'}
          {p.capture.gameName && <span className="pill-game">· {p.capture.gameName}</span>}
        </button>
      )}
      <StreamButton capture={p.capture} disabled={!!p.engineError} />
      <RecordButton capture={p.capture} disabled={!!p.engineError} onClick={p.onToggleRecording} />

      {sortMenu && (
        <ContextMenu
          x={sortMenu.x}
          y={sortMenu.y}
          onClose={() => setSortMenu(null)}
          items={(Object.keys(SORT_LABELS) as SortOrder[]).map((s) => ({
            label: SORT_LABELS[s],
            icon: s === p.sort ? <IconCheck size={14} /> : null,
            onClick: () => p.onSort(s)
          }))}
        />
      )}
    </header>
  )
}

function useClock(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [active])
  return now
}

function StreamButton({ capture, disabled }: { capture: CaptureStatus; disabled: boolean }) {
  const s = capture.stream
  const now = useClock(s.live)
  if (s.starting) {
    return (
      <button className="btn btn-stream starting" onClick={() => window.api.stream.toggle()}>
        <IconBroadcast size={14} /> Connecting…
      </button>
    )
  }
  if (s.live) {
    const secs = s.since ? (now - s.since) / 1000 : 0
    const dropped = s.totalFrames ? (s.droppedFrames / s.totalFrames) * 100 : 0
    return (
      <span className="live-group">
        <span className="status-pill live stream-pill" title={`${s.kbps} kbps · ${s.droppedFrames} dropped frames (${dropped.toFixed(1)}%)`}>
          <span className="dot" /> Live {formatDuration(secs)}
          <span className="pill-game">· {s.kbps} kbps</span>
        </span>
        <button className="btn btn-accent" onClick={() => window.api.stream.toggle()}>
          <IconBroadcastOff size={14} /> End stream
        </button>
      </span>
    )
  }
  return (
    <button className="btn btn-stream" disabled={disabled} onClick={() => window.api.stream.toggle()} title="Start streaming (set up in Settings → Streaming)">
      <IconBroadcast size={14} /> Go live
    </button>
  )
}

function RecordButton({ capture, disabled, onClick }: { capture: CaptureStatus; disabled: boolean; onClick: () => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!capture.recording) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [capture.recording])

  if (capture.recording) {
    const secs = capture.recordingSince ? (now - capture.recordingSince) / 1000 : 0
    return (
      <button className="btn btn-record active" onClick={onClick}>
        <IconPlayerStopFilled size={14} /> Stop {formatDuration(secs)}
      </button>
    )
  }
  return (
    <button className="btn btn-accent" onClick={onClick} disabled={disabled}>
      <IconPlayerRecordFilled size={14} /> Record
    </button>
  )
}
