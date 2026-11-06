// Updates (installed app only), same scheme as Vibe Editing Suite and Hearth:
// new versions are published as GitHub Releases. Nothing is downloaded until you say so.
// With "Automatic updates" on (the default) the app checks once, a couple of seconds after it
// opens, and asks. "Remind me later" snoozes the question for 4 hours. You can always check by hand
// in Settings. A downloaded update installs when you click "Restart now", or the next time you quit.
import { app, ipcMain } from 'electron'
import type { UpdateStatus } from '@shared/types'
import { createLogger } from './logger'
import { getSettings } from './settings'
import { send } from './notify'

const log = createLogger('updater')
const SNOOZE_MS = 4 * 60 * 60 * 1000

type AutoUpdater = typeof import('electron-updater').autoUpdater

let status: UpdateStatus = { state: 'idle' }
let updater: AutoUpdater | null = null
let checkTimer: NodeJS.Timeout | null = null
let snoozedUntil = 0
let manualCheck = false
/** Called before installing: stops recording and the OBS engine so its files can be replaced. */
let prepareForInstall: () => Promise<void> = async () => {}

/** GitHub release notes arrive as HTML (or text, or a list): boil them down to short bullet lines. */
function notesToList(n: unknown): string[] {
  let text = ''
  if (Array.isArray(n)) text = n.map((x) => (x && (x as { note?: string }).note) || '').join('\n')
  else if (typeof n === 'string') text = n
  const items: string[] = []
  const lis = text.match(/<li[^>]*>[\s\S]*?<\/li>/gi)
  if (lis) lis.forEach((l) => items.push(l))
  else text.split(/\r?\n/).forEach((l) => /^\s*[-*]\s+/.test(l) && items.push(l.replace(/^\s*[-*]\s+/, '')))
  return items
    .map((s) =>
      s
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .slice(0, 12)
}

function setStatus(s: UpdateStatus): void {
  status = s
  send('update:status', s)
}

export function updateReady(): boolean {
  return status.state === 'ready'
}

function runCheck(manual: boolean): void {
  if (!updater) return setStatus({ state: 'dev' })
  manualCheck = manual
  updater.checkForUpdates().catch((e) => {
    log.warn('Update check failed', e)
    if (manualCheck) setStatus({ state: 'error', during: 'check' })
    manualCheck = false
  })
}

/** (Re)starts the schedule according to the setting: one check, right as the app opens. */
export function applyUpdateSchedule(): void {
  if (checkTimer) clearTimeout(checkTimer)
  checkTimer = null
  if (!updater || !getSettings().autoUpdate) return
  // A short wait lets the window finish loading so it can show the popup.
  checkTimer = setTimeout(() => runCheck(false), 2000)
}

export function setupUpdater(prepare: () => Promise<void>): void {
  prepareForInstall = prepare
  registerIpc()
  // Updates only work in the installed app (and never during automated tests).
  if (!app.isPackaged || (process.env['VIBE_CAPTURE'] && !process.env['VIBE_UPDATE_URL'])) return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
  updater = autoUpdater
  autoUpdater.logger = { info: (m: unknown) => log.info(String(m)), warn: (m: unknown) => log.warn(String(m)), error: (m: unknown) => log.error(String(m)), debug: () => {} }
  // Developer helper: VIBE_UPDATE_URL=<url> checks a local test server instead of GitHub.
  if (process.env['VIBE_UPDATE_URL']) autoUpdater.setFeedURL({ provider: 'generic', url: process.env['VIBE_UPDATE_URL'] })
  autoUpdater.autoDownload = false // ask first
  autoUpdater.disableWebInstaller = true
  autoUpdater.autoInstallOnAppQuit = false // we install ourselves on quit, after the OBS engine has stopped
  autoUpdater.on('checking-for-update', () => manualCheck && setStatus({ state: 'checking' }))
  autoUpdater.on('update-available', (i) => {
    const ask = manualCheck || Date.now() > snoozedUntil
    log.info(`Update available: ${i.version}`)
    setStatus({ state: ask ? 'available' : 'snoozed', version: i.version, current: app.getVersion(), notes: notesToList(i.releaseNotes) })
    manualCheck = false
  })
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) setStatus({ state: 'uptodate' })
    manualCheck = false
  })
  autoUpdater.on('download-progress', (p) => setStatus({ state: 'downloading', version: status.version, percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => {
    log.info(`Update ${i.version} downloaded`)
    setStatus({ state: 'ready', version: i.version })
  })
  autoUpdater.on('error', (e) => {
    log.warn('Updater error', e)
    if (status.state === 'downloading') setStatus({ state: 'error', during: 'download' })
    else if (manualCheck) setStatus({ state: 'error', during: 'check' })
    manualCheck = false
  })
  applyUpdateSchedule()
}

/**
 * Installs the downloaded update: stops recording and the OBS engine first (its files are part
 * of the update and can't be replaced while it runs), then runs the installer, which reopens the app.
 */
export async function installUpdate(silent = false, reopen = true): Promise<void> {
  if (!updater || status.state !== 'ready') return
  log.info(`Installing update${silent ? ' quietly on quit' : ''}`)
  if (!silent) await prepareForInstall()
  updater.quitAndInstall(silent, reopen)
}

function registerIpc(): void {
  ipcMain.handle('update:status', () => status)
  ipcMain.handle('update:check', () => runCheck(true))
  ipcMain.handle('update:download', () =>
    updater?.downloadUpdate().catch((e) => {
      log.warn('Update download failed', e)
      setStatus({ state: 'error', during: 'download' })
    })
  )
  ipcMain.handle('update:snooze', () => {
    snoozedUntil = Date.now() + SNOOZE_MS
    setStatus({ state: 'snoozed', version: status.version, current: app.getVersion(), notes: status.notes })
  })
  ipcMain.handle('update:install', () => installUpdate(false))
  // For automated UI tests only.
  ipcMain.handle('update:debug', (_e, s: UpdateStatus) => process.env['VIBE_CAPTURE'] && setStatus(s))
  ipcMain.handle('app:version', () => app.getVersion())
}
