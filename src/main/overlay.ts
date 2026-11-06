// A small "Clip saved" pop-up in the top-right corner of the screen, shown over your game.
// It never takes focus and clicks pass through it, so it can't interrupt gameplay.
// (Works over borderless/windowed games. Exclusive-fullscreen games can hide it; you'll
//  still see the result in the app.)
import { BrowserWindow, screen } from 'electron'
import type { ToastMessage } from '@shared/types'
import { getSettings } from './settings'

let win: BrowserWindow | null = null
let hideTimer: NodeJS.Timeout | null = null

const COLORS: Record<string, { bg: string; text: string; muted: string; accent: string; ok: string; err: string }> = {
  default: { bg: '#202025', text: '#ececf1', muted: '#9a9aa5', accent: '#8b5cf6', ok: '#22c55e', err: '#ef4444' },
  gruvbox: { bg: '#32302f', text: '#ebdbb2', muted: '#a89984', accent: '#fe8019', ok: '#b8bb26', err: '#fb4934' },
  'rose-pine': { bg: '#26233a', text: '#e0def4', muted: '#908caa', accent: '#c4a7e7', ok: '#9ccfd8', err: '#eb6f92' },
  'default-light': { bg: '#ffffff', text: '#1c1c23', muted: '#5d5d6a', accent: '#7c3aed', ok: '#16a34a', err: '#dc2626' },
  'gruvbox-light': { bg: '#fbf1c7', text: '#3c3836', muted: '#665c54', accent: '#af3a03', ok: '#79740e', err: '#9d0006' },
  'rose-pine-light': { bg: '#fffaf3', text: '#575279', muted: '#797593', accent: '#907aa9', ok: '#286983', err: '#b4637a' }
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    width: 340,
    height: 84,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    webPreferences: { sandbox: true, javascript: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true)
  win.setVisibleOnAllWorkspaces(true)
  return win
}

export function showOverlayToast(msg: ToastMessage): void {
  const s = getSettings()
  const c = (s.themeMode === 'light' ? COLORS[`${s.theme}-light`] : COLORS[s.theme]) ?? COLORS.default
  const stripe = msg.kind === 'success' ? c.ok : msg.kind === 'error' ? c.err : c.accent
  // How long it stays, then it slides back out to the right (all in CSS: this window runs no scripts).
  const shown = msg.kind === 'error' ? 6000 : 2800
  const slide = 300
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent;overflow:hidden;font-family:'Montserrat','Segoe UI',sans-serif}
    .t{margin:8px;padding:12px 14px;background:${c.bg};color:${c.text};border-radius:10px;border-left:4px solid ${stripe};
       animation:in ${slide}ms cubic-bezier(.22,1,.36,1), out ${slide}ms cubic-bezier(.55,0,1,.45) ${shown - slide}ms forwards}
    b{display:block;font-size:13px} span{display:block;margin-top:3px;font-size:12px;color:${c.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    @keyframes in{from{transform:translateX(110%);opacity:0}}
    @keyframes out{to{transform:translateX(110%);opacity:0}}
  </style></head><body><div class="t"><b>${escape(msg.title)}</b>${msg.detail ? `<span>${escape(msg.detail)}</span>` : ''}</div></body></html>`
  const w = ensureWindow()
  const area = screen.getPrimaryDisplay().workArea
  w.setBounds({ x: area.x + area.width - 340 - 16, y: area.y + 16, width: 340, height: 84 })
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).then(() => {
    w.showInactive()
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => w.hide(), shown + 50)
  })
}

export function destroyOverlay(): void {
  win?.destroy()
  win = null
}
