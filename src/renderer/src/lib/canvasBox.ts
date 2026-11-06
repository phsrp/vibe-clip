// Where a source sits on the canvas, worked out the same way OBS does from its transform.
import type { ProfileSource, SourceTransform } from '@shared/types'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

const LEFT = 1
const RIGHT = 2
const TOP = 4
const BOTTOM = 8

const AUDIO_ONLY = ['mic', 'desktop_audio', 'app_audio']

/** The source's box on the canvas (ignoring rotation), or null if it has no picture. */
export function sourceBox(s: ProfileSource, size: { width: number; height: number } | undefined, canvas: { width: number; height: number }): Box | null {
  if (AUDIO_ONLY.includes(s.kind) || !s.visible) return null
  const t = s.transform
  if (t.fit === 'fit' || t.fit === 'stretch') return { x: 0, y: 0, w: canvas.width, h: canvas.height }
  let w: number
  let h: number
  if (t.boundsType) {
    w = t.boundsWidth
    h = t.boundsHeight
  } else {
    if (!size || !size.width || !size.height) return null
    w = Math.max(1, size.width - t.crop.left - t.crop.right) * Math.abs(t.scaleX)
    h = Math.max(1, size.height - t.crop.top - t.crop.bottom) * Math.abs(t.scaleY)
  }
  const x = t.alignment & LEFT ? t.x : t.alignment & RIGHT ? t.x - w : t.x - w / 2
  const y = t.alignment & TOP ? t.y : t.alignment & BOTTOM ? t.y - h : t.y - h / 2
  return { x, y, w, h }
}

/** A transform that puts the source exactly in `box` (top-left aligned), keeping how it fills the box. */
export function transformForBox(s: ProfileSource, box: Box, size: { width: number; height: number } | undefined): SourceTransform {
  const t = s.transform
  const base: SourceTransform = { ...t, fit: 'custom', alignment: LEFT | TOP, x: Math.round(box.x), y: Math.round(box.y) }
  if (t.fit === 'fit' || t.fit === 'stretch' || t.boundsType) {
    return {
      ...base,
      boundsType: t.fit === 'stretch' ? 1 : t.fit === 'fit' ? 2 : t.boundsType,
      boundsAlignment: t.fit === 'custom' ? t.boundsAlignment : 0,
      boundsWidth: Math.max(2, Math.round(box.w)),
      boundsHeight: Math.max(2, Math.round(box.h)),
      scaleX: 1,
      scaleY: 1
    }
  }
  const cw = Math.max(1, (size?.width ?? box.w) - t.crop.left - t.crop.right)
  const ch = Math.max(1, (size?.height ?? box.h) - t.crop.top - t.crop.bottom)
  return { ...base, scaleX: Math.max(0.01, box.w / cw) * Math.sign(t.scaleX || 1), scaleY: Math.max(0.01, box.h / ch) * Math.sign(t.scaleY || 1) }
}

/**
 * Nudges a box so its edges or centre line up with the canvas edges or centre when they're
 * within `threshold` canvas pixels.
 */
export function snapBox(b: Box, canvas: { width: number; height: number }, threshold: number): Box {
  const snap1 = (pos: number, size: number, total: number): number => {
    const candidates = [
      { at: 0, edge: pos },
      { at: total, edge: pos + size },
      { at: total / 2, edge: pos + size / 2 }
    ]
    let best: { d: number; shift: number } | null = null
    for (const c of candidates) {
      const d = Math.abs(c.at - c.edge)
      if (d <= threshold && (!best || d < best.d)) best = { d, shift: c.at - c.edge }
    }
    return best ? pos + best.shift : pos
  }
  return { ...b, x: snap1(b.x, b.w, canvas.width), y: snap1(b.y, b.h, canvas.height) }
}
