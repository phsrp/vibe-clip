// Turns the Video / Advanced settings into the numbers OBS wants.
import { screen } from 'electron'
import type { AppSettings } from '@shared/types'
import type { VideoConfig } from '../engine/scenes'

const SCALE = { bilinear: 3, bicubic: 2, lanczos: 4, area: 5 } as const
const FORMAT = { NV12: 2, I420: 1, I444: 10, BGRA: 7 } as const
const SPACE = { '601': 1, '709': 2, sRGB: 3, '2100PQ': 4, '2100HLG': 5 } as const
const RANGE = { partial: 1, full: 2 } as const

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2)
}

export function parseSize(s: string): { width: number; height: number } | null {
  const m = /^(\d{2,5})\s*x\s*(\d{2,5})$/i.exec(s.trim())
  return m ? { width: even(Number(m[1])), height: even(Number(m[2])) } : null
}

export function primaryDisplaySize(): { width: number; height: number } {
  const d = screen.getPrimaryDisplay()
  return { width: even(d.size.width * d.scaleFactor), height: even(d.size.height * d.scaleFactor) }
}

/** Output size: a height like "1080" keeps the canvas shape; "WxH" is exact; "native" = canvas. */
export function outputSize(baseW: number, baseH: number, out: string): { width: number; height: number } {
  const exact = parseSize(out)
  if (exact) return exact
  if (out === 'native') return { width: baseW, height: baseH }
  const h = Number(out)
  if (!h || h >= baseH) return { width: baseW, height: baseH }
  return { width: even((baseW * h) / baseH), height: even(h) }
}

export function videoConfig(s: AppSettings): VideoConfig {
  const base = (s.baseResolution !== 'auto' && parseSize(s.baseResolution)) || primaryDisplaySize()
  const out = outputSize(base.width, base.height, String(s.outputResolution))
  return {
    baseWidth: base.width,
    baseHeight: base.height,
    outputWidth: out.width,
    outputHeight: out.height,
    // fps/fpsDen is the frame rate as a fraction: 60/1, or 60000/1001 for 59.94.
    fpsNum: Math.max(1, Math.round(s.fps)),
    fpsDen: Math.max(1, Math.round(s.fpsDen || 1)),
    format: FORMAT[s.colorFormat] ?? 2,
    colorspace: SPACE[s.colorSpace] ?? 2,
    range: RANGE[s.colorRange] ?? 1,
    scaleType: SCALE[s.downscaleFilter] ?? 2
  }
}

export const SPEAKERS = { mono: 1, stereo: 2, '2.1': 3, '4.0': 4, '4.1': 5, '5.1': 6, '7.1': 8 } as const
