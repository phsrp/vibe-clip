// The kinds of sources you can add to a profile, and their starting settings.
import { randomUUID } from 'crypto'
import type { AudioSettings, ProfileSource, SourceKind, SourceTransform, SourceTypeInfo } from '@shared/types'

export const SOURCE_TYPES: SourceTypeInfo[] = [
  { kind: 'auto_game', obsType: 'game_capture', label: 'Auto game capture', description: 'Follows whichever known game is running.', audioOnly: false },
  { kind: 'display', obsType: 'monitor_capture', label: 'Display', description: 'A whole monitor.', audioOnly: false },
  { kind: 'window', obsType: 'window_capture', label: 'Window', description: 'One program window.', audioOnly: false },
  { kind: 'game', obsType: 'game_capture', label: 'Game capture', description: 'A specific game (or any fullscreen app).', audioOnly: false },
  { kind: 'webcam', obsType: 'dshow_input', label: 'Webcam / capture card', description: 'A camera or capture device.', audioOnly: false },
  { kind: 'mic', obsType: 'wasapi_input_capture', label: 'Microphone', description: 'An input device.', audioOnly: true },
  { kind: 'desktop_audio', obsType: 'wasapi_output_capture', label: 'Desktop audio', description: 'Everything an output device plays.', audioOnly: true },
  { kind: 'app_audio', obsType: 'wasapi_process_output_capture', label: 'App audio', description: 'Sound from one program only.', audioOnly: true },
  { kind: 'image', obsType: 'image_source', label: 'Image', description: 'A picture file.', audioOnly: false },
  { kind: 'slideshow', obsType: 'slideshow_v2', label: 'Image slideshow', description: 'Several pictures in turn.', audioOnly: false },
  { kind: 'text', obsType: 'text_gdiplus_v3', label: 'Text', description: 'Text on screen.', audioOnly: false },
  { kind: 'media', obsType: 'ffmpeg_source', label: 'Media file', description: 'A video or sound file.', audioOnly: false },
  { kind: 'browser', obsType: 'browser_source', label: 'Browser', description: 'A web page (alerts, overlays...).', audioOnly: false },
  { kind: 'color', obsType: 'color_source_v3', label: 'Color', description: 'A solid color block.', audioOnly: false }
]

const DEFAULT_SETTINGS: Partial<Record<SourceKind, Record<string, unknown>>> = {
  display: { capture_cursor: true, method: 2 },
  window: { capture_cursor: true, method: 0 },
  game: { capture_mode: 'any_fullscreen', capture_cursor: true, anti_cheat_hook: true },
  auto_game: { capture_mode: 'window', priority: 2, capture_cursor: true, anti_cheat_hook: true },
  mic: { device_id: 'default' },
  desktop_audio: { device_id: 'default' },
  text: { text: 'Your text', font: { face: 'Montserrat', size: 72, style: 'Bold', flags: 1 } },
  browser: { url: 'https://example.com', width: 800, height: 600 },
  color: { color: 0xfff65c8b, width: 400, height: 200 } // OBS colors are ABGR
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 10)}`
}

export function fitTransform(): SourceTransform {
  return {
    fit: 'fit',
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    alignment: 5,
    boundsType: 2,
    boundsWidth: 0,
    boundsHeight: 0,
    boundsAlignment: 0,
    crop: { left: 0, top: 0, right: 0, bottom: 0 }
  }
}

export function customTransform(x = 0, y = 0): SourceTransform {
  return { ...fitTransform(), fit: 'custom', x, y, boundsType: 0 }
}

/** Bottom-right corner, a quarter of the screen: a good starting place for a webcam. */
export function cornerTransform(canvasW: number, canvasH: number, corner: 'tl' | 'tr' | 'bl' | 'br', size = 0.25): SourceTransform {
  const w = Math.round(canvasW * size)
  const h = Math.round(canvasH * size)
  const m = Math.round(canvasH * 0.02)
  const x = corner.endsWith('l') ? m : canvasW - w - m
  const y = corner.startsWith('t') ? m : canvasH - h - m
  return { ...fitTransform(), fit: 'custom', x, y, boundsType: 2, boundsWidth: w, boundsHeight: h, boundsAlignment: 0 }
}

export function defaultAudio(kind: SourceKind): AudioSettings {
  const mic = kind === 'mic'
  return { volume: 1, muted: false, mixers: 1 | (mic ? 4 : 2), monitoring: 0, syncOffsetMs: 0, mono: false, balance: 0.5 }
}

export function createSource(kind: SourceKind, name: string, canvasW: number, canvasH: number, settings: Record<string, unknown> = {}): ProfileSource {
  const info = SOURCE_TYPES.find((t) => t.kind === kind)!
  let transform = fitTransform()
  if (kind === 'webcam') transform = cornerTransform(canvasW, canvasH, 'br')
  else if (['text', 'image', 'color', 'browser', 'slideshow', 'media'].includes(kind)) transform = customTransform(40, 40)
  return {
    id: newId('src'),
    name,
    obsType: info.obsType,
    kind,
    settings: { ...(DEFAULT_SETTINGS[kind] ?? {}), ...settings },
    visible: true,
    transform,
    audio: defaultAudio(kind),
    filters: []
  }
}

/** Which UI kind an OBS input id belongs to (for imported sources). */
export function kindForObsType(obsType: string): SourceKind {
  const base = obsType.replace(/_v\d+$/, '')
  const found = SOURCE_TYPES.find((t) => t.obsType.replace(/_v\d+$/, '') === base && t.kind !== 'auto_game')
  return found?.kind ?? 'other'
}
