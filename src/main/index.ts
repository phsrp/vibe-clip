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
import { registerIpc } from './ipc'
import { send, setMainWindow, setOverlayToast, toast } from './notify'
import { pauseHotkeys, registerHotkeys, unregisterHotkeys, type HotkeyActions } from './hotkeys'
import { destroyOverlay, showOverlayToast } from './overlay'
import { GameDetector, savedIcons } from './games/detector'
import { CaptureService } from './capture/service'
import type { EngineStatus } from '@shared/types'

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

const capture = new CaptureService()
const detector = new GameDetector()
capture.onStatus = (s) => send('capture:status', s)
let quitting = false

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
  registerIpc({ engine: () => engine, capture, pauseHotkeys })
  setOverlayToast(showOverlayToast)
  createWindow()

  const hotkeyActions: HotkeyActions = {
    saveReplay: () => void capture.saveReplay().catch((e) => toast('error', "Couldn't save clip", String(e?.message ?? e))),
    toggleRecording: () => void capture.toggleRecording().catch((e) => toast('error', "Couldn't toggle recording", String(e?.message ?? e))),
    screenshot: () => void capture.screenshot().catch((e) => toast('error', "Couldn't take screenshot", String(e?.message ?? e)))
  }
  registerHotkeys(getSettings().hotkeys, hotkeyActions)
  onSettingsChange((next, prev) => {
    if (JSON.stringify(next.hotkeys) !== JSON.stringify(prev.hotkeys)) registerHotkeys(next.hotkeys, hotkeyActions)
  })

  const settings = getSettings()
  await library.scan(settings.outputFolder).catch((e) => log.error('Library scan failed', e))
  library.repairThumbnails()
  onSettingsChange((next, prev) => {
    if (next.outputFolder !== prev.outputFolder) library.scan(next.outputFolder).catch((e) => log.error('Library scan failed', e))
    if (engine.running) capture.applySettings(next, prev).catch((e) => toast('error', "Couldn't apply settings", String(e)))
  })

  if (engine.running) {
    try {
      await capture.init()
    } catch (e) {
      engine.error = 'The capture setup failed: ' + (e instanceof Error ? e.message : String(e))
      log.error('Capture init failed', e)
      toast('error', "Recording couldn't be set up", engine.error)
    }
  }

  // Game detection: tags clips with the game and switches to game capture.
  library.setGameIcons(savedIcons())
  detector.onIcon = () => library.setGameIcons(savedIcons())
  detector.onTick = (game) => {
    try {
      if (engine.running) capture.updateGame(game)
    } catch (e) {
      log.error('Game update failed', e)
    }
  }
  detector.start()
})

// Stop recording cleanly (so the file is saved) before the app exits.
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  detector.stop()
  capture
    .shutdown()
    .catch((err) => log.error('Shutdown error', err))
    .finally(() => app.quit())
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  unregisterHotkeys()
  destroyOverlay()
  stopEngine()
  closeDb()
})
