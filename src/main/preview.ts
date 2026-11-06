// Live preview: OBS draws the program output straight into a rectangle of the app window
// (no copying frames around, so it's smooth and cheap). The UI tells us where the rectangle is.
import { BrowserWindow, screen } from 'electron'
import type * as OSN from 'obs-studio-node'
import { osn } from './engine/obs'
import { createLogger } from './logger'

const log = createLogger('preview')
const NAME = 'vibe-preview'
let created = false
let createdFor: OSN.IVideo | null = null

export interface PreviewRect {
  x: number
  y: number
  width: number
  height: number
}

export function showPreview(win: BrowserWindow, video: OSN.IVideo, rect: PreviewRect, bg: { r: number; g: number; b: number }): void {
  try {
    if (created && createdFor !== video) hidePreview()
    if (!created) {
      osn.NodeObs.OBS_content_createDisplay(win.getNativeWindowHandle(), NAME, 0, false, video)
      try {
        osn.NodeObs.OBS_content_setShouldDrawUI(NAME, false)
      } catch {
        /* older engine */
      }
      created = true
      createdFor = video
      log.info('Preview created')
    }
    const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor * win.webContents.getZoomFactor()
    osn.NodeObs.OBS_content_setPaddingColor(NAME, bg.r, bg.g, bg.b)
    osn.NodeObs.OBS_content_moveDisplay(NAME, Math.round(rect.x * scale), Math.round(rect.y * scale))
    osn.NodeObs.OBS_content_resizeDisplay(NAME, Math.max(1, Math.round(rect.width * scale)), Math.max(1, Math.round(rect.height * scale)))
  } catch (e) {
    log.error('Preview failed', e)
  }
}

export function hidePreview(): void {
  if (!created) return
  try {
    osn.NodeObs.OBS_content_destroyDisplay(NAME)
  } catch (e) {
    log.warn('Destroying preview failed', e)
  }
  created = false
  createdFor = null
}
