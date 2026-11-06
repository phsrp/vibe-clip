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
    baseResolution: 'auto',
    outputResolution: '1080',
    downscaleFilter: 'bicubic',
    fps: 60,
    fpsDen: 1,
    encoder: 'auto',
    bitrate: 30000,
    encoderOverrides: null,
    recordingFormat: 'mp4',
    filenameFormat: '%CCYY-%MM-%DD %hh-%mm-%ss',
    recordTracks: 0b000111,
    splitRecording: { enabled: false, type: 'time', minutes: 15, megabytes: 2048 },
    replayEnabled: true,
    replaySeconds: 180,
    replayTracks: 0b000111,
    sampleRate: 48000,
    channels: 'stereo',
    tracks: [
      { name: 'Everything', bitrate: 192 },
      { name: 'Desktop audio', bitrate: 192 },
      { name: 'Microphone', bitrate: 192 },
      { name: 'Track 4', bitrate: 160 },
      { name: 'Track 5', bitrate: 160 },
      { name: 'Track 6', bitrate: 160 }
    ],
    monitoringDevice: 'default',
    disableDucking: true,
    colorFormat: 'NV12',
    colorSpace: '709',
    colorRange: 'partial',
    stream: {
      serviceType: 'rtmp_common',
      service: 'Twitch',
      server: 'auto',
      keyEncrypted: '',
      encoder: 'same',
      bitrate: 6000,
      encoderOverrides: null,
      track: 1,
      rescale: 'none',
      reconnect: { enabled: true, delaySec: 2, maxRetries: 25 },
      delaySec: 0
    },
    hotkeys: {
      saveReplay: 'Alt+F10',
      toggleRecording: 'Alt+F9',
      screenshot: 'Alt+F12',
      toggleReplay: '',
      toggleStream: '',
      muteMic: ''
    },
    minimizeToTray: true,
    startWithWindows: false,
    customGames: []
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
      current = {
        ...base,
        ...saved,
        hotkeys: { ...base.hotkeys, ...(saved.hotkeys ?? {}) },
        stream: { ...base.stream, ...(saved.stream ?? {}), reconnect: { ...base.stream.reconnect, ...(saved.stream?.reconnect ?? {}) } },
        splitRecording: { ...base.splitRecording, ...(saved.splitRecording ?? {}) },
        tracks: base.tracks.map((t, i) => ({ ...t, ...(saved.tracks?.[i] ?? {}) }))
      }
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
