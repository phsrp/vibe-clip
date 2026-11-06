import { app, BrowserWindow, ipcMain, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { createLogger, logPath } from './logger'
import { startEngine, stopEngine, osn } from './engine/obs'
import { availableEncoders } from './engine/encoders'
import { getSettings, updateSettings } from './settings'
import { BUILT_IN_GAMES } from './games/games'
import { mockLibrary } from './library/mock'
import type { CaptureStatus, EngineStatus } from '@shared/types'

const log = createLogger('app')
let win: BrowserWindow | null = null
const status: EngineStatus = { running: false, error: null, encoders: [], inputTypes: [] }

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 800,
    minWidth: 960,
    minHeight: 580,
    backgroundColor: '#111114',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#111114', symbolColor: '#9a9aa5', height: 34 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))

  // Developer helper: VIBE_CAPTURE=<file.png> saves a screenshot of the window and quits.
  const capture = process.env['VIBE_CAPTURE']
  if (capture) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win!.webContents.capturePage()
        fs.writeFileSync(capture, img.toPNG())
        app.quit()
      }, Number(process.env['VIBE_CAPTURE_DELAY'] ?? 3000))
    })
  }
}

function registerIpc(): void {
  const idle: CaptureStatus = { replayActive: false, replaySeconds: 0, recording: false, recordingSince: null, game: null, gameName: null }
  ipcMain.handle('engine:status', () => status)
  ipcMain.on('window:titlebar', (_e, bg: string, fg: string) => {
    try {
      win?.setTitleBarOverlay({ color: bg, symbolColor: fg, height: 34 })
    } catch {
      /* not supported on this platform */
    }
  })
  ipcMain.handle('library:get', () => mockLibrary())
  ipcMain.handle('capture:status', () => idle)
  ipcMain.handle('capture:options', () => ({ monitors: [], desktopAudioDevices: [], micDevices: [], encoders: status.encoders }))
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch) => updateSettings(patch))
  ipcMain.handle('settings:openLogs', () => shell.showItemInFolder(logPath()))
  ipcMain.handle('games:builtIn', () => BUILT_IN_GAMES)
  for (const ch of [
    'library:rename',
    'library:remove',
    'library:reveal',
    'library:createCollection',
    'library:deleteCollection',
    'library:addToCollection',
    'library:removeFromCollection',
    'capture:toggleReplay',
    'capture:toggleRecording',
    'capture:saveReplay',
    'capture:screenshot',
    'settings:pickFolder',
    'settings:pauseHotkeys'
  ])
    ipcMain.handle(ch, () => null)
}

app.whenReady().then(() => {
  log.info(`App starting. Log file: ${logPath()}`)
  try {
    startEngine()
    status.running = true
    status.encoders = availableEncoders()
    status.inputTypes = osn.InputFactory.types()
  } catch (e) {
    status.error = e instanceof Error ? e.message : String(e)
    log.error('Engine failed to start', e)
  }
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => stopEngine())
