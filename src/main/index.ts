// App entry point: starts the OBS engine, the library, hotkeys, game detection and the tray,
// and opens the window.
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
import { createTray, destroyTray, resourcePath, updateTray } from './tray'
import type { EngineStatus } from '@shared/types'

const log = createLogger('app')
let win: BrowserWindow | null = null
const engine: EngineStatus = { running: false, error: null, encoders: [], inputTypes: [] }
const capture = new CaptureService()
const detector = new GameDetector()
let quitting = false
let trayHintShown = false

// Developer helper: VIBE_DATA_DIR=<folder> keeps settings, database and logs separate (for testing).
if (process.env['VIBE_DATA_DIR']) app.setPath('userData', process.env['VIBE_DATA_DIR'])

// Only one copy of the app may run (two would fight over the engine and hotkeys).
if (!process.env['VIBE_CAPTURE'] && !app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}
app.on('second-instance', () => showWindow())

registerMediaScheme()

process.on('uncaughtException', (e) => log.error('Uncaught exception', e))
process.on('unhandledRejection', (e) => log.error('Unhandled promise rejection', e))

function showWindow(): void {
  if (!win) createWindow()
  if (win!.isMinimized()) win!.restore()
  win!.show()
  win!.focus()
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 800,
    minWidth: 960,
    minHeight: 580,
    backgroundColor: '#111114',
    show: false,
    icon: resourcePath('icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#111114', symbolColor: '#9a9aa5', height: 34 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  setMainWindow(win)
  const startHidden = process.argv.includes('--hidden')
  win.once('ready-to-show', () => {
    if (!startHidden) win?.show()
  })

  // Closing the window hides it to the tray (the replay buffer keeps running).
  win.on('close', (e) => {
    if (quitting) return
    if (getSettings().minimizeToTray) {
      e.preventDefault()
      win?.hide()
      if (!trayHintShown) {
        trayHintShown = true
        showOverlayToast({ id: 0, kind: 'info', title: 'Vibe Clip is still running', detail: 'In the tray, with the replay buffer on' })
      }
    } else {
      app.quit()
    }
  })
  win.on('closed', () => {
    win = null
    setMainWindow(null)
  })

  // If the UI crashes, log it and reload instead of leaving a blank window.
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error(`UI process crashed: ${details.reason}`)
    if (details.reason !== 'clean-exit') setTimeout(() => win?.reload(), 500)
  })

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))

  // Developer helper: VIBE_CAPTURE=<file.png> saves a screenshot of the window and quits.
  const shot = process.env['VIBE_CAPTURE']
  if (shot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (process.env['VIBE_CAPTURE_JS']) await win!.webContents.executeJavaScript(process.env['VIBE_CAPTURE_JS'])
        await new Promise((r) => setTimeout(r, 800))
        // A hidden window can't be captured, so just quit in that case.
        if (win!.isVisible()) {
          const img = await win!.webContents.capturePage()
          fs.writeFileSync(shot, img.toPNG())
        }
        quitting = true
        app.quit()
      }, Number(process.env['VIBE_CAPTURE_DELAY'] ?? 3000))
    })
  }
}

function report(what: string) {
  return (e: unknown) => toast('error', `Couldn't ${what}`, e instanceof Error ? e.message : String(e))
}

app.whenReady().then(async () => {
  log.info(`App starting (v${app.getVersion()}). Log file: ${logPath()}`)
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

  const actions = {
    saveReplay: () => void capture.saveReplay().catch(report('save the clip')),
    toggleRecording: () => void capture.toggleRecording().catch(report('start or stop recording')),
    screenshot: () => void capture.screenshot().catch(report('take a screenshot'))
  } satisfies HotkeyActions
  registerHotkeys(getSettings().hotkeys, actions)

  createTray({
    show: showWindow,
    saveClip: actions.saveReplay,
    toggleRecording: actions.toggleRecording,
    screenshot: actions.screenshot,
    toggleReplay: () => void capture.toggleReplay().catch(report('toggle the replay buffer')),
    quit: () => app.quit()
  })
  capture.onStatus = (s) => {
    send('capture:status', s)
    updateTray(s, getSettings().hotkeys)
  }
  updateTray(capture.status(), getSettings().hotkeys)

  onSettingsChange((next, prev) => {
    if (JSON.stringify(next.hotkeys) !== JSON.stringify(prev.hotkeys)) {
      registerHotkeys(next.hotkeys, actions)
      updateTray(capture.status(), next.hotkeys)
    }
    if (next.outputFolder !== prev.outputFolder) library.scan(next.outputFolder).catch((e) => log.error('Library scan failed', e))
    if (engine.running) capture.applySettings(next, prev).catch(report('apply settings'))
  })

  await library.scan(getSettings().outputFolder).catch((e) => log.error('Library scan failed', e))
  library.repairThumbnails()

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
  if (quitting && !capture.outputs.recordingActive && !capture.outputs.replayActive) return
  e.preventDefault()
  quitting = true
  detector.stop()
  capture
    .shutdown()
    .catch((err) => log.error('Shutdown error', err))
    .finally(() => {
      capture.outputs.recordingActive = false
      capture.outputs.replayActive = false
      app.quit()
    })
})

// The tray keeps the app alive when the window is closed.
app.on('window-all-closed', () => {
  if (quitting || !getSettings().minimizeToTray) app.quit()
})

app.on('will-quit', () => {
  unregisterHotkeys()
  destroyOverlay()
  destroyTray()
  stopEngine()
  closeDb()
})
