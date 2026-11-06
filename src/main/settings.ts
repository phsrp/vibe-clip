// App settings, saved as a JSON file in the app's data folder.
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { AppSettings } from '@shared/types'
import { createLogger } from './logger'

const log = createLogger('settings')

function defaults(): AppSettings {
  return {
    theme: 'default',
    outputFolder: path.join(app.getPath('videos'), 'Vibe Clip'),
    outputResolution: '1080',
    fps: 60,
    encoder: 'auto',
    bitrate: 30000,
    replayEnabled: true,
    replaySeconds: 180,
    captureMode: 'auto',
    monitorId: '',
    desktopAudio: true,
    desktopAudioDevice: 'default',
    mic: true,
    micDevice: 'default',
    hotkeys: { saveReplay: 'Alt+F10', toggleRecording: 'Alt+F9', screenshot: 'Alt+F12' },
    minimizeToTray: true,
    customGames: [],
    encoderOverrides: null
  }
}

type Listener = (next: AppSettings, prev: AppSettings) => void

let current: AppSettings | null = null
const listeners: Listener[] = []

function file(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): AppSettings {
  if (current) return current
  const base = defaults()
  try {
    if (fs.existsSync(file())) {
      const saved = JSON.parse(fs.readFileSync(file(), 'utf8'))
      current = { ...base, ...saved, hotkeys: { ...base.hotkeys, ...(saved.hotkeys ?? {}) } }
    }
  } catch (e) {
    log.error('Settings file was unreadable, using defaults', e)
  }
  current ??= base
  return current
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const prev = getSettings()
  const next = { ...prev, ...patch }
  current = next
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true })
    fs.writeFileSync(file(), JSON.stringify(next, null, 2))
  } catch (e) {
    log.error('Could not save settings', e)
  }
  log.info('Settings changed: ' + Object.keys(patch).join(', '))
  for (const l of listeners) {
    try {
      l(next, prev)
    } catch (e) {
      log.error('Settings listener failed', e)
    }
  }
  return next
}

export function onSettingsChange(l: Listener): void {
  listeners.push(l)
}
