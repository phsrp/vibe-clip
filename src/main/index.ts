import { app, BrowserWindow, ipcMain } from 'electron'
import * as path from 'path'
import { createLogger, logPath } from './logger'
import { startEngine, stopEngine, osn } from './engine/obs'
import { availableEncoders } from './engine/encoders'
import type { EngineStatus } from '@shared/types'

const log = createLogger('app')
let win: BrowserWindow | null = null
const status: EngineStatus = { running: false, error: null, encoders: [], inputTypes: [] }

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#16161a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  log.info(`App starting. Log file: ${logPath()}`)
  try {
    startEngine()
    status.running = true
    status.encoders = availableEncoders()
    status.inputTypes = osn.InputFactory.types()
    log.info('Input types: ' + status.inputTypes.join(', '))
  } catch (e) {
    status.error = e instanceof Error ? e.message : String(e)
    log.error('Engine failed to start', e)
  }
  ipcMain.handle('engine:status', () => status)
  createWindow()
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => stopEngine())
