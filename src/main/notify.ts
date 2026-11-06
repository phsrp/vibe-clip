// Sends messages from the background process to the UI window, and shows toasts.
import { BrowserWindow, Notification } from 'electron'
import type { ToastKind, ToastMessage } from '@shared/types'
import { createLogger } from './logger'

const log = createLogger('notify')
let win: BrowserWindow | null = null
let nextId = 1

export function setMainWindow(w: BrowserWindow | null): void {
  win = w
}

export function getMainWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

export function send(channel: string, value: unknown): void {
  const w = getMainWindow()
  if (w) w.webContents.send(channel, value)
}

/**
 * Shows a toast. If the window is hidden (in the tray, or you're in a game),
 * a small overlay toast is shown instead so you still know it worked.
 */
export function toast(kind: ToastKind, title: string, detail?: string): void {
  const msg: ToastMessage = { id: nextId++, kind, title, detail }
  if (kind === 'error') log.error(`${title}${detail ? ': ' + detail : ''}`)
  send('toast', msg)
  const w = getMainWindow()
  const visible = w && w.isVisible() && !w.isMinimized() && w.isFocused()
  if (!visible) overlayToast?.(msg)
}

/** Set by the overlay module (Step 4) so toasts show up over games. */
let overlayToast: ((msg: ToastMessage) => void) | null = (msg) => {
  // Fallback: Windows notification.
  if (Notification.isSupported()) new Notification({ title: msg.title, body: msg.detail ?? '', silent: true }).show()
}

export function setOverlayToast(fn: (msg: ToastMessage) => void): void {
  overlayToast = fn
}
