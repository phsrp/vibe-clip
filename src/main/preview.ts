// Live preview: OBS draws the program output straight into a rectangle of the app window
// (no copying frames around, so it's smooth and cheap). The UI tells us where the rectangle is.
//
// Important: the preview is never destroyed while the app runs. OBS's preview is a child window
// owned by the engine process; destroying it needs this (blocked) main thread to answer Windows
// messages, which deadlocks the app. Instead "hiding" parks it off-screen at 1×1 pixel, and it
// goes away together with the engine process when the app quits.
import { BrowserWindow, screen } from 'electron'
import type * as OSN from 'obs-studio-node'
import { osn } from './engine/obs'
import { createLogger } from './logger'

const log = createLogger('preview')
const NAME = 'vibe-preview'
let created = false
let visible = false
let lastKey = ''

export interface PreviewRect {
  x: number
  y: number
  width: number
  height: number
}

export function showPreview(win: BrowserWindow, video: OSN.IVideo, rect: PreviewRect, bg: { r: number; g: number; b: number }): void {
  try {
    if (!created) {
      osn.NodeObs.OBS_content_createDisplay(win.getNativeWindowHandle(), NAME, 0, false, video)
      try {
        osn.NodeObs.OBS_content_setShouldDrawUI(NAME, false)
      } catch {
        /* older engine */
      }
      created = true
      log.info('Preview created')
    }
    const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor * win.webContents.getZoomFactor()
    const x = Math.round(rect.x * scale)
    const y = Math.round(rect.y * scale)
    const w = Math.max(1, Math.round(rect.width * scale))
    const h = Math.max(1, Math.round(rect.height * scale))
    const key = [x, y, w, h, bg.r, bg.g, bg.b].join(',')
    if (visible && key === lastKey) return
    osn.NodeObs.OBS_content_setPaddingColor(NAME, bg.r, bg.g, bg.b)
    osn.NodeObs.OBS_content_resizeDisplay(NAME, w, h)
    osn.NodeObs.OBS_content_moveDisplay(NAME, x, y)
    visible = true
    lastKey = key
  } catch (e) {
    log.error('Preview failed', e)
  }
}

/** Parks the preview off-screen (see the note at the top for why it isn't destroyed). */
export function hidePreview(): void {
  if (!created || !visible) return
  try {
    osn.NodeObs.OBS_content_moveDisplay(NAME, -32000, -32000)
    osn.NodeObs.OBS_content_resizeDisplay(NAME, 1, 1)
  } catch (e) {
    log.warn('Hiding the preview failed', e)
  }
  visible = false
}
