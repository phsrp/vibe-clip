// Picks the best available video encoder: NVIDIA (NVENC) > AMD (AMF) > Intel (QuickSync) > x264 (CPU).
// OBS only registers hardware encoders that passed its own hardware test, so if an ID is
// in the list, that encoder actually works on this PC.
import { osn } from './obs'
import { createLogger } from '../logger'
import type { EncoderInfo } from '@shared/types'

const log = createLogger('encoders')

export const KNOWN_ENCODERS: EncoderInfo[] = [
  { id: 'obs_nvenc_h264_tex', label: 'NVIDIA NVENC H.264', hardware: true },
  { id: 'jim_nvenc', label: 'NVIDIA NVENC H.264 (legacy)', hardware: true },
  { id: 'h264_texture_amf', label: 'AMD AMF H.264', hardware: true },
  { id: 'obs_qsv11_v2', label: 'Intel QuickSync H.264', hardware: true },
  { id: 'obs_qsv11', label: 'Intel QuickSync H.264 (legacy)', hardware: true },
  { id: 'obs_x264', label: 'x264 (CPU)', hardware: false }
]

let cached: EncoderInfo[] | null = null

export function availableEncoders(): EncoderInfo[] {
  if (cached) return cached
  let ids: string[] = []
  try {
    ids = osn.VideoEncoderFactory.types()
  } catch (e) {
    log.error('Could not list encoders', e)
  }
  log.info('Encoders registered by OBS: ' + ids.join(', '))
  const found = KNOWN_ENCODERS.filter((e) => ids.includes(e.id))
  if (!found.some((e) => e.id === 'obs_x264')) found.push(KNOWN_ENCODERS[KNOWN_ENCODERS.length - 1])
  // Only one entry per vendor in the menu (the newest API).
  cached = found.filter((e) => !(e.id === 'jim_nvenc' && ids.includes('obs_nvenc_h264_tex')) && !(e.id === 'obs_qsv11' && ids.includes('obs_qsv11_v2')))
  return cached
}

/** "auto" means: the first (best) available encoder. */
export function resolveEncoder(preferred: string): string {
  const list = availableEncoders()
  if (preferred !== 'auto' && list.some((e) => e.id === preferred)) return preferred
  if (preferred !== 'auto') log.warn(`Encoder ${preferred} not available, falling back`)
  return list[0].id
}

/** Encoder settings in OBS's own format (same keys as OBS's recordEncoder.json). */
export function encoderSettings(id: string, bitrateKbps: number): Record<string, unknown> {
  const common = { rate_control: 'CBR', bitrate: bitrateKbps, keyint_sec: 2 }
  if (id === 'obs_x264') return { ...common, preset: 'veryfast', profile: 'high' }
  if (id.includes('nvenc')) return { ...common, preset2: 'p5', tune: 'hq', multipass: 'qres', profile: 'high' }
  if (id.includes('amf')) return { ...common, preset: 'quality', profile: 'high' }
  if (id.includes('qsv')) return { ...common, target_usage: 'TU4', profile: 'high' }
  return common
}
