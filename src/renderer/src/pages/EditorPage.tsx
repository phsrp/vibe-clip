// Clip editor: trim the ends, split at the playhead, remove parts, crop, and export a new clip.
// Simplified from the Vibe Video Editor's timeline (same ruler / playhead / trim-handle style).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCrop,
  IconDeviceFloppy,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconRestore,
  IconScissors,
  IconTrash,
  IconX,
  IconZoomIn
} from '@tabler/icons-react'
import type { Clip, CropRect, EditSegment, EditStrip } from '@shared/types'

interface EditState {
  segments: EditSegment[]
  crop: CropRect | null
}

const ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16 (vertical)', ratio: 9 / 16 },
  { id: '1:1', label: '1:1 (square)', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 }
]

function fmt(t: number, precise = true): string {
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return precise ? `${m}:${sec.toFixed(2).padStart(5, '0')}` : `${m}:${String(Math.floor(sec)).padStart(2, '0')}`
}

export function EditorPage({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [strip, setStrip] = useState<EditStrip | null>(null)
  const [edit, setEdit] = useState<EditState>({ segments: [], crop: null })
  const [past, setPast] = useState<EditState[]>([])
  const [future, setFuture] = useState<EditState[]>([])
  const [selected, setSelected] = useState(0)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(1) // 1 = fit the whole clip
  const [cropMode, setCropMode] = useState(false)
  const [aspect, setAspect] = useState('free')
  const [progress, setProgress] = useState<number | null>(null)
  const duration = strip?.duration ?? clip.duration

  useEffect(() => {
    setStrip(null)
    window.api.editor.strip(clip.id).then((s) => {
      if (!s) return
      setStrip(s)
      setEdit({ segments: [{ start: 0, end: s.duration }], crop: null })
      setPast([])
      setFuture([])
      setSelected(0)
    })
  }, [clip.id])

  useEffect(() => window.api.editor.onProgress((p) => setProgress(p)), [])

  /** Every change goes through here so it can be undone. */
  const commit = useCallback((next: EditState) => {
    setEdit((prev) => {
      setPast((p) => [...p.slice(-99), prev])
      setFuture([])
      return next
    })
  }, [])
  const undo = () => {
    if (!past.length) return
    setFuture((f) => [edit, ...f])
    setEdit(past[past.length - 1])
    setPast((p) => p.slice(0, -1))
  }
  const redo = () => {
    if (!future.length) return
    setPast((p) => [...p, edit])
    setEdit(future[0])
    setFuture((f) => f.slice(1))
  }

  // ----- Playback that skips removed parts -----
  const seek = (t: number) => {
    const v = videoRef.current
    const c = Math.max(0, Math.min(duration, t))
    if (v) v.currentTime = c
    setTime(c)
  }
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const v = videoRef.current
      if (v) {
        const t = v.currentTime
        const segs = edit.segments
        const inside = segs.find((s) => t >= s.start - 0.01 && t < s.end)
        if (!inside) {
          const next = segs.find((s) => s.start > t)
          if (next) v.currentTime = next.start
          else {
            v.pause()
            setPlaying(false)
          }
        }
        setTime(v.currentTime)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, edit.segments])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      const segs = edit.segments
      const last = segs[segs.length - 1]
      if (!last) return
      if (time >= last.end - 0.05 || !segs.some((s) => time >= s.start && time < s.end)) {
        const next = segs.find((s) => s.start >= time) ?? segs[0]
        v.currentTime = next.start
      }
      v.play()
      setPlaying(true)
    } else {
      v.pause()
      setPlaying(false)
    }
  }

  // ----- Editing actions -----
  const split = () => {
    const i = edit.segments.findIndex((s) => time > s.start + 0.05 && time < s.end - 0.05)
    if (i < 0) return
    const s = edit.segments[i]
    const segments = [...edit.segments.slice(0, i), { start: s.start, end: time }, { start: time, end: s.end }, ...edit.segments.slice(i + 1)]
    commit({ ...edit, segments })
    setSelected(i + 1)
  }
  const removeSelected = () => {
    if (edit.segments.length <= 1) return
    const segments = edit.segments.filter((_, i) => i !== selected)
    commit({ ...edit, segments })
    setSelected(Math.max(0, selected - 1))
  }
  const reset = () => commit({ segments: [{ start: 0, end: duration }], crop: null })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (e.key.toLowerCase() === 's' && !e.ctrlKey) split()
      else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected()
      else if (e.key.toLowerCase() === 'c' && !e.ctrlKey) setCropMode((c) => !c)
      else if (e.ctrlKey && e.key.toLowerCase() === 'z') (e.shiftKey ? redo : undo)()
      else if (e.ctrlKey && e.key.toLowerCase() === 'y') redo()
      else if (e.key === 'ArrowLeft') seek(time - (e.shiftKey ? 1 : 1 / 60))
      else if (e.key === 'ArrowRight') seek(time + (e.shiftKey ? 1 : 1 / 60))
      else if (e.key === 'Escape') setCropMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const kept = edit.segments.reduce((t, s) => t + (s.end - s.start), 0)

  const doExport = async () => {
    setProgress(0)
    videoRef.current?.pause()
    setPlaying(false)
    const id = await window.api.editor.export({ clipId: clip.id, segments: edit.segments, crop: edit.crop })
    setProgress(null)
    if (id) onClose()
  }

  return (
    <div className="page editor-page">
      <div className="editor-head">
        <div className="editor-title">
          <strong>{clip.title}</strong>
          <span className="muted">
            {clip.gameName} · keeps {fmt(kept, false)} of {fmt(duration, false)}
            {edit.crop ? ` · cropped to ${Math.round(edit.crop.width)}×${Math.round(edit.crop.height)}` : ''}
          </span>
        </div>
        <button className="btn" onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">
          <IconArrowBackUp size={15} />
        </button>
        <button className="btn" onClick={redo} disabled={!future.length} title="Redo (Ctrl+Y)">
          <IconArrowForwardUp size={15} />
        </button>
        <button className="btn" onClick={reset} title="Undo all edits">
          <IconRestore size={15} /> Reset
        </button>
        {progress === null ? (
          <button className="btn btn-accent" onClick={doExport} disabled={!strip || !edit.segments.length}>
            <IconDeviceFloppy size={15} /> Save as new clip
          </button>
        ) : (
          <div className="export-progress">
            <div className="bar">
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span>{Math.round(progress * 100)}%</span>
            <button className="btn" onClick={() => window.api.editor.cancel()}>
              Cancel
            </button>
          </div>
        )}
        <button className="icon-btn" onClick={onClose} title="Close editor">
          <IconX size={18} />
        </button>
      </div>

      <div className="editor-stage">
        <video ref={videoRef} src={clip.url} onLoadedMetadata={() => seek(0)} onPause={() => setPlaying(false)} onClick={togglePlay} />
        {cropMode && strip && (
          <CropOverlay
            video={videoRef}
            source={{ width: strip.width, height: strip.height }}
            crop={edit.crop ?? { x: 0, y: 0, width: strip.width, height: strip.height }}
            ratio={ASPECTS.find((a) => a.id === aspect)?.ratio ?? null}
            onChange={(crop, done) => (done ? commit({ ...edit, crop }) : setEdit((e) => ({ ...e, crop })))}
          />
        )}
      </div>

      <div className="editor-tools">
        <button className="icon-btn big" onClick={togglePlay} title="Play / pause (Space)">
          {playing ? <IconPlayerPauseFilled size={20} /> : <IconPlayerPlayFilled size={20} />}
        </button>
        <span className="timecode">
          {fmt(time)} <span className="muted">/ {fmt(duration)}</span>
        </span>
        <div className="tool-sep" />
        <button className="btn" onClick={split} title="Split at the playhead (S)">
          <IconScissors size={15} /> Split
        </button>
        <button className="btn" onClick={removeSelected} disabled={edit.segments.length <= 1} title="Remove the selected part (Delete)">
          <IconTrash size={15} /> Remove part
        </button>
        <div className="tool-sep" />
        <button className={'btn' + (cropMode ? ' btn-accent' : '')} onClick={() => setCropMode(!cropMode)} title="Crop (C)">
          <IconCrop size={15} /> Crop
        </button>
        {cropMode && (
          <>
            <select
              className="select"
              value={aspect}
              onChange={(e) => {
                setAspect(e.target.value)
                const r = ASPECTS.find((a) => a.id === e.target.value)?.ratio
                if (r && strip) {
                  // Biggest centred box with that shape.
                  let w = strip.width
                  let h = w / r
                  if (h > strip.height) {
                    h = strip.height
                    w = h * r
                  }
                  commit({ ...edit, crop: { x: (strip.width - w) / 2, y: (strip.height - h) / 2, width: w, height: h } })
                }
              }}
            >
              {ASPECTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <button className="btn ghost" onClick={() => commit({ ...edit, crop: null })} disabled={!edit.crop}>
              Remove crop
            </button>
          </>
        )}
        <div className="spacer" />
        <IconZoomIn size={15} className="muted" />
        <input type="range" className="range small" min={1} max={20} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} title="Zoom the timeline" />
      </div>

      {strip ? (
        <Timeline
          duration={duration}
          strip={strip}
          segments={edit.segments}
          selected={selected}
          time={time}
          zoom={zoom}
          onSelect={setSelected}
          onSeek={seek}
          onTrim={(segments, done) => (done ? commit({ ...edit, segments }) : setEdit((e) => ({ ...e, segments })))}
        />
      ) : (
        <div className="timeline loading">Preparing the timeline…</div>
      )}
      <p className="editor-help">
        Drag the ends of a part to trim it. <kbd>S</kbd> splits at the playhead, <kbd>Delete</kbd> removes the selected part, <kbd>C</kbd> crops,{' '}
        <kbd>Space</kbd> plays, <kbd>←</kbd>/<kbd>→</kbd> step one frame. The original clip is never changed.
      </p>
    </div>
  )
}

// ---------------- Timeline ----------------

function Timeline(p: {
  duration: number
  strip: EditStrip
  segments: EditSegment[]
  selected: number
  time: number
  zoom: number
  onSelect: (i: number) => void
  onSeek: (t: number) => void
  onTrim: (segments: EditSegment[], done: boolean) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const PAD = 16
  const pxPerSec = ((width - PAD * 2) / Math.max(p.duration, 0.1)) * p.zoom
  const total = p.duration * pxPerSec
  const x = (t: number) => PAD + t * pxPerSec
  const tAt = (clientX: number) => {
    const el = scrollRef.current!
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(p.duration, (clientX - r.left + el.scrollLeft - PAD) / pxPerSec))
  }

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || p.zoom <= 1) return
    const px = x(p.time)
    if (px < el.scrollLeft + 40 || px > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = px - el.clientWidth / 2
  }, [p.time])

  const ticks = useMemo(() => {
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
    const step = steps.find((s) => s * pxPerSec >= 70) ?? 600
    const out: number[] = []
    for (let t = 0; t <= p.duration + 0.001; t += step) out.push(t)
    return out
  }, [pxPerSec, p.duration])

  const scrub = (e: React.PointerEvent) => {
    p.onSeek(tAt(e.clientX))
    const move = (ev: PointerEvent) => p.onSeek(tAt(ev.clientX))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startTrim = (e: React.PointerEvent, i: number, edge: 'start' | 'end') => {
    e.stopPropagation()
    p.onSelect(i)
    const segs = p.segments
    const min = edge === 'start' ? (i > 0 ? segs[i - 1].end : 0) : segs[i].start + 0.1
    const max = edge === 'start' ? segs[i].end - 0.1 : i < segs.length - 1 ? segs[i + 1].start : p.duration
    let latest = segs
    const move = (ev: PointerEvent) => {
      const t = Math.max(min, Math.min(max, tAt(ev.clientX)))
      latest = segs.map((s, j) => (j === i ? { ...s, [edge]: t } : s))
      p.onTrim(latest, false)
      p.onSeek(t)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      p.onTrim(latest, true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const stripStyle = { backgroundImage: `url("${p.strip.strip}")`, backgroundSize: `${total}px 100%` }

  return (
    <div className="timeline">
      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-inner" style={{ width: total + PAD * 2 }}>
          <div className="tl-ruler" onPointerDown={scrub}>
            {ticks.map((t) => (
              <span key={t} className="tick" style={{ left: x(t) }}>
                {fmt(t, false)}
              </span>
            ))}
          </div>
          <div className="tl-lane" onPointerDown={scrub}>
            <div className="tl-ghost" style={{ left: PAD, width: total, ...stripStyle }} />
            {p.segments.map((s, i) => (
              <div
                key={i}
                className={'tl-seg' + (i === p.selected ? ' selected' : '')}
                style={{ left: x(s.start), width: Math.max(2, (s.end - s.start) * pxPerSec), ...stripStyle, backgroundPosition: `${-s.start * pxPerSec}px 0` }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  p.onSelect(i)
                  scrub(e)
                }}
              >
                <span className="seg-label">{fmt(s.end - s.start, false)}</span>
                <span className="tl-handle left" onPointerDown={(e) => startTrim(e, i, 'start')} />
                <span className="tl-handle right" onPointerDown={(e) => startTrim(e, i, 'end')} />
              </div>
            ))}
          </div>
          {p.strip.wave && (
            <div className="tl-wave" onPointerDown={scrub}>
              <img src={p.strip.wave} style={{ left: PAD, width: total }} alt="" draggable={false} />
              {p.segments.map((s, i) => (
                <span key={i} className="wave-keep" style={{ left: x(s.start), width: (s.end - s.start) * pxPerSec }} />
              ))}
            </div>
          )}
          <div className="tl-playhead" style={{ left: x(p.time) }}>
            <span className="knob" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------- Crop overlay ----------------

type Drag = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

function CropOverlay(p: {
  video: React.RefObject<HTMLVideoElement | null>
  source: { width: number; height: number }
  crop: CropRect
  ratio: number | null
  onChange: (crop: CropRect, done: boolean) => void
}) {
  const [box, setBox] = useState({ left: 0, top: 0, width: 1, height: 1 })
  useEffect(() => {
    const v = p.video.current
    if (!v) return
    const update = () => {
      // Where the picture actually is inside the <video> element (it's letterboxed).
      const r = v.getBoundingClientRect()
      const parent = v.parentElement!.getBoundingClientRect()
      const scale = Math.min(r.width / p.source.width, r.height / p.source.height)
      const w = p.source.width * scale
      const h = p.source.height * scale
      setBox({ left: r.left - parent.left + (r.width - w) / 2, top: r.top - parent.top + (r.height - h) / 2, width: w, height: h })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(v)
    return () => ro.disconnect()
  }, [p.source.width, p.source.height])

  const s = box.width / p.source.width
  const c = p.crop

  const start = (e: React.PointerEvent, mode: Drag) => {
    e.stopPropagation()
    e.preventDefault()
    const x0 = e.clientX
    const y0 = e.clientY
    const orig = { ...c }
    let latest = orig
    const W = p.source.width
    const H = p.source.height
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / s
      const dy = (ev.clientY - y0) / s
      let { x, y, width, height } = orig
      if (mode === 'move') {
        x = Math.max(0, Math.min(W - width, orig.x + dx))
        y = Math.max(0, Math.min(H - height, orig.y + dy))
      } else {
        if (mode.includes('e')) width = Math.max(32, Math.min(W - x, orig.width + dx))
        if (mode.includes('s')) height = Math.max(32, Math.min(H - y, orig.height + dy))
        if (mode.includes('w')) {
          const nx = Math.max(0, Math.min(orig.x + orig.width - 32, orig.x + dx))
          width = orig.width + (orig.x - nx)
          x = nx
        }
        if (mode.includes('n')) {
          const ny = Math.max(0, Math.min(orig.y + orig.height - 32, orig.y + dy))
          height = orig.height + (orig.y - ny)
          y = ny
        }
        if (p.ratio) {
          // Keep the chosen shape: follow the dragged side, fit inside the picture.
          if (mode === 'n' || mode === 's') width = height * p.ratio
          else height = width / p.ratio
          if (x + width > W) {
            width = W - x
            height = width / p.ratio
          }
          if (y + height > H) {
            height = H - y
            width = height * p.ratio
          }
          if (mode.includes('n')) y = orig.y + orig.height - height
          if (mode.includes('w')) x = orig.x + orig.width - width
        }
      }
      latest = { x, y, width, height }
      p.onChange(latest, false)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      p.onChange(latest, true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const handles: Drag[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
  return (
    <div className="crop-layer" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      <div className="crop-box" style={{ left: c.x * s, top: c.y * s, width: c.width * s, height: c.height * s }} onPointerDown={(e) => start(e, 'move')}>
        <span className="crop-grid" />
        {handles.map((h) => (
          <span key={h} className={`crop-h ${h}`} onPointerDown={(e) => start(e, h)} />
        ))}
        <span className="crop-size">
          {Math.round(c.width)}×{Math.round(c.height)}
        </span>
      </div>
    </div>
  )
}
