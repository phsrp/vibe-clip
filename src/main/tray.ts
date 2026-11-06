// System tray icon (next to the clock). The app keeps running here, with the replay buffer on,
// after you close the window.
import { app, Menu, nativeImage, Tray } from 'electron'
import * as path from 'path'
import type { CaptureStatus, Hotkeys } from '@shared/types'
import { formatDurationShort } from './util'

export interface TrayActions {
  show: () => void
  saveClip: () => void
  toggleRecording: () => void
  screenshot: () => void
  toggleReplay: () => void
  quit: () => void
}

let tray: Tray | null = null
let actions: TrayActions | null = null

export function resourcePath(name: string): string {
  // In development the resources folder is next to package.json; when packaged it's beside app.asar.
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(app.getAppPath(), 'resources', name)
}

export function createTray(a: TrayActions): void {
  actions = a
  tray = new Tray(nativeImage.createFromPath(resourcePath('tray.png')))
  tray.setToolTip('Vibe Clip')
  tray.on('click', () => a.show())
  tray.on('double-click', () => a.show())
}

export function updateTray(status: CaptureStatus, hotkeys: Hotkeys): void {
  if (!tray || !actions) return
  const a = actions
  const hint = (k: string) => (k ? `  (${k})` : '')
  tray.setImage(nativeImage.createFromPath(resourcePath(status.recording ? 'tray-recording.png' : 'tray.png')))
  const parts = ['Vibe Clip']
  if (status.recording) parts.push('● Recording')
  parts.push(status.replayActive ? `Replay buffer on (${formatDurationShort(status.replaySeconds)})` : 'Replay buffer off')
  if (status.gameName) parts.push(status.gameName)
  tray.setToolTip(parts.join(' · '))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Vibe Clip', click: a.show },
      { type: 'separator' },
      { label: 'Save clip' + hint(hotkeys.saveReplay), click: a.saveClip, enabled: status.replayActive },
      { label: (status.recording ? 'Stop recording' : 'Start recording') + hint(hotkeys.toggleRecording), click: a.toggleRecording },
      { label: 'Take screenshot' + hint(hotkeys.screenshot), click: a.screenshot },
      { type: 'separator' },
      { label: 'Replay buffer', type: 'checkbox', checked: status.replayActive, click: a.toggleReplay },
      { type: 'separator' },
      { label: 'Quit', click: a.quit }
    ])
  )
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
