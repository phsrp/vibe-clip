import { useEffect, useRef, useState } from 'react'
import type { ProfileSource, SourceTransform } from '@shared/types'
import { useOverlayOpen } from '../lib/overlay'
import { snapBox, sourceBox, transformForBox, type Box } from '../lib/canvasBox'

function cssColor(name: string): { r: number; g: number; b: number } {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(v)
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 }
}

type Corner = 'nw' | 'ne' | 'sw' | 'se'

interface Props {
  canvas: { width: number; height: number }
  /** Sources of the active profile, top first (when given, the preview can be edited with the mouse). */
  sources?: ProfileSource[]
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  /** done = false while dragging, true when the mouse is released. */
  onTransform?: (id: string, t: SourceTransform, done: boolean) => void
}

/**
 * A rectangle where OBS draws the live output. We keep telling the background process where the
 * rectangle is (it moves when the window resizes). OBS's preview lets mouse clicks pass through,
 * so a transparent layer on top handles selecting, moving and resizing sources, like in OBS.
 */
export function ObsPreview({ canvas, sources, selectedId, onSelect, onTransform }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const overlay = useOverlayOpen()
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const sizes = useRef<Record<string, { width: number; height: number }>>({})
  const [cursor, setCursor] = useState('default')
  const aspect = canvas.width / canvas.height

  // ----- Keep OBS's preview over our rectangle -----
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (overlay) {
      window.api.preview.hide()
      return
    }
    let last = ''
    const update = () => {
      const r = el.getBoundingClientRect()
      let w = r.width
      let h = w / aspect
      if (h > r.height) {
        h = r.height
        w = h * aspect
      }
      const area = { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, width: w, height: h }
      const key = JSON.stringify(area) + document.documentElement.dataset.theme
      if (key === last) return
      last = key
      setRect({ left: area.x - r.left, top: area.y - r.top, width: w, height: h })
      if (r.width < 4 || r.height < 4 || r.bottom < 0) window.api.preview.hide()
      else window.api.preview.show(area, cssColor('--bg-window'))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    const t = setInterval(update, 300)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
      clearInterval(t)
      window.api.preview.hide()
    }
  }, [aspect, overlay])

  // ----- Source sizes (needed to know where each source is) -----
  const ids = (sources ?? []).map((s) => s.id).join(',')
  useEffect(() => {
    if (!sources) return
    let alive = true
    const load = () =>
      window.api.preview.sourceSizes(sources.map((s) => s.id)).then((s) => {
        if (alive) sizes.current = s
      })
    load()
    const t = setInterval(load, 1500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [ids])

  // Tell OBS which source to draw the red selection box around.
  useEffect(() => {
    if (sources) window.api.preview.select(selectedId ?? null)
  }, [selectedId, ids])
  useEffect(() => () => window.api.preview.select(null), [])

  const editable = !!(sources && onSelect && onTransform && rect)
  const scale = rect ? rect.width / canvas.width : 1
  const toCanvas = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: (clientX - r.left - rect!.left) / scale, y: (clientY - r.top - rect!.top) / scale }
  }
  const boxOf = (s: ProfileSource) => sourceBox(s, sizes.current[s.id], canvas)

  /** Which corner handle (if any) of the selected source is under the pointer. */
  const cornerAt = (p: { x: number; y: number }): Corner | null => {
    const sel = sources?.find((s) => s.id === selectedId)
    const b = sel && boxOf(sel)
    if (!b) return null
    const tol = 9 / scale
    const near = (ax: number, ay: number) => Math.abs(p.x - ax) <= tol && Math.abs(p.y - ay) <= tol
    if (near(b.x, b.y)) return 'nw'
    if (near(b.x + b.w, b.y)) return 'ne'
    if (near(b.x, b.y + b.h)) return 'sw'
    if (near(b.x + b.w, b.y + b.h)) return 'se'
    return null
  }

  const hit = (p: { x: number; y: number }): ProfileSource | null => {
    // The selected source wins when it's under the pointer (so you can drag it even if covered).
    const sel = sources?.find((s) => s.id === selectedId)
    const sb = sel && boxOf(sel)
    if (sel && sb && p.x >= sb.x && p.x <= sb.x + sb.w && p.y >= sb.y && p.y <= sb.y + sb.h) return sel
    for (const s of sources ?? []) {
      const b = boxOf(s)
      if (b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return s
    }
    return null
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!editable || e.buttons) return
    const p = toCanvas(e.clientX, e.clientY)
    const c = cornerAt(p)
    setCursor(c ? (c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize') : hit(p) ? 'move' : 'default')
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable || e.button !== 0) return
    ref.current?.focus()
    const start = toCanvas(e.clientX, e.clientY)
    const corner = cornerAt(start)
    const target = corner ? sources!.find((s) => s.id === selectedId)! : hit(start)
    onSelect!(target?.id ?? null)
    if (!target) return
    const startBox = boxOf(target)
    if (!startBox) return
    e.preventDefault()
    const size = sizes.current[target.id]
    const ratio = startBox.w / startBox.h
    let latest: SourceTransform | null = null
    let frame = 0

    const move = (ev: PointerEvent) => {
      const p = toCanvas(ev.clientX, ev.clientY)
      let box: Box
      if (!corner) {
        box = { ...startBox, x: startBox.x + (p.x - start.x), y: startBox.y + (p.y - start.y) }
        if (!ev.altKey) box = snapBox(box, canvas, 10 / scale)
      } else {
        // The opposite corner stays where it is.
        const ax = corner.includes('w') ? startBox.x + startBox.w : startBox.x
        const ay = corner.includes('n') ? startBox.y + startBox.h : startBox.y
        let w = Math.max(8, Math.abs(p.x - ax))
        let h = Math.max(8, Math.abs(p.y - ay))
        if (!ev.shiftKey) {
          // Keep the shape: follow whichever direction moved further.
          if (w / ratio > h) h = w / ratio
          else w = h * ratio
        }
        box = { x: corner.includes('w') ? ax - w : ax, y: corner.includes('n') ? ay - h : ay, w, h }
      }
      latest = transformForBox(target, box, size)
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          if (latest) onTransform!(target.id, latest, false)
        })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (frame) cancelAnimationFrame(frame)
      if (latest) onTransform!(target.id, latest, true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!editable || !selectedId) return
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (!d) return
    e.preventDefault()
    const s = sources!.find((x) => x.id === selectedId)
    const b = s && boxOf(s)
    if (!s || !b) return
    const step = e.shiftKey ? 10 : 1
    onTransform!(s.id, transformForBox(s, { ...b, x: b.x + d[0] * step, y: b.y + d[1] * step }, sizes.current[s.id]), true)
  }

  return (
    <div ref={ref} className="obs-preview" tabIndex={editable ? 0 : -1} onKeyDown={onKeyDown}>
      {overlay && <span className="preview-paused">Preview paused while a menu is open</span>}
      {editable && rect && !overlay && (
        <div
          className="preview-hit"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
        />
      )}
    </div>
  )
}
