import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { createLogger, logPath } from './logger'
import { startEngine, stopEngine, osn } from './engine/obs'
import { availableEncoders } from './engine/encoders'
import { getSettings, onSettingsChange } from './settings'
import * as library from './library/library'
import { registerMediaScheme, handleMediaProtocol } from './library/protocol'
import { closeDb } from './library/db'
import { registerIpc, type CaptureApi } from './ipc'
import { send, setMainWindow } from './notify'
import type { CaptureStatus, EngineStatus } from '@shared/types'

const log = createLogger('app')
let win: BrowserWindow | null = null
const engine: EngineStatus = { running: false, error: null, encoders: [], inputTypes: [] }

// Developer helper: VIBE_DATA_DIR=<folder> keeps settings, database and logs separate (for testing).
if (process.env['VIBE_DATA_DIR']) app.setPath('userData', process.env['VIBE_DATA_DIR'])

registerMediaScheme()

process.on('uncaughtException', (e) => log.error('Uncaught exception', e))
process.on('unhandledRejection', (e) => log.error('Unhandled promise rejection', e))

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
  setMainWindow(win)
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
    setMainWindow(null)
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))

  // Developer helper: VIBE_CAPTURE=<file.png> saves a screenshot of the window and quits.
  const capture = process.env['VIBE_CAPTURE']
  if (capture) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (process.env['VIBE_CAPTURE_JS']) await win!.webContents.executeJavaScript(process.env['VIBE_CAPTURE_JS'])
        await new Promise((r) => setTimeout(r, 800))
        const img = await win!.webContents.capturePage()
        fs.writeFileSync(capture, img.toPNG())
        app.quit()
      }, Number(process.env['VIBE_CAPTURE_DELAY'] ?? 3000))
    })
  }
}

// Placeholder until the recording engine is wired up (Step 3).
const idle: CaptureStatus = { replayActive: false, replaySeconds: 0, recording: false, recordingSince: null, game: null, gameName: null }
const captureApi: CaptureApi = {
  status: () => idle,
  options: () => ({ monitors: [], desktopAudioDevices: [], micDevices: [], encoders: engine.encoders }),
  toggleReplay: async () => {},
  toggleRecording: async () => {},
  saveReplay: async () => {},
  screenshot: async () => {}
}

app.whenReady().then(async () => {
  log.info(`App starting. Log file: ${logPath()}`)
  try {
    startEngine()
    engine.running = true
    engine.encoders = availableEncoders()
    engine.inputTypes = osn.InputFactory.types()
  } catch (e) {
    engine.error = e instanceof Error ? e.message : String(e)
    log.error('Engine failed to start', e)
  }

  handleMediaProtocol((file) => library.isLibraryPath(file, getSettings().outputFolder))
  library.onLibraryChange((snap) => send('library:changed', snap))
  registerIpc({ engine: () => engine, capture: captureApi, pauseHotkeys: () => {} })
  createWindow()

  const settings = getSettings()
  await library.scan(settings.outputFolder).catch((e) => log.error('Library scan failed', e))
  library.repairThumbnails()
  onSettingsChange((next, prev) => {
    if (next.outputFolder !== prev.outputFolder) library.scan(next.outputFolder).catch((e) => log.error('Library scan failed', e))
  })
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  stopEngine()
  closeDb()
})
