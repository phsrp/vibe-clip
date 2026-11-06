// Connects the UI's requests (from preload/index.ts) to the background modules.
import { dialog, ipcMain, shell } from 'electron'
import { logPath } from './logger'
import { getSettings, updateSettings } from './settings'
import { BUILT_IN_GAMES } from './games/games'
import * as library from './library/library'
import { getMainWindow, toast } from './notify'
import type { AppSettings, CaptureOptions, CaptureStatus, EngineStatus } from '@shared/types'

export interface CaptureApi {
  status(): CaptureStatus
  options(): CaptureOptions
  toggleReplay(): Promise<void>
  toggleRecording(): Promise<void>
  saveReplay(): Promise<void>
  screenshot(): Promise<void>
}

export interface IpcDeps {
  engine: () => EngineStatus
  capture: CaptureApi
  pauseHotkeys: (paused: boolean) => void
}

/** Wraps a handler so any error is logged and shown to you instead of failing silently. */
function safe<A extends unknown[], R>(what: string, fn: (...args: A) => R | Promise<R>) {
  return async (_e: unknown, ...args: A): Promise<R | undefined> => {
    try {
      return await fn(...args)
    } catch (e) {
      toast('error', `Couldn't ${what}`, e instanceof Error ? e.message : String(e))
      return undefined
    }
  }
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle('engine:status', () => deps.engine())
  ipcMain.on('window:titlebar', (_e, bg: string, fg: string) => {
    try {
      getMainWindow()?.setTitleBarOverlay({ color: bg, symbolColor: fg, height: 34 })
    } catch {
      /* not supported */
    }
  })

  ipcMain.handle('library:get', safe('load the library', () => library.snapshot()))
  ipcMain.handle('library:rename', safe('rename the clip', (id: number, title: string) => library.rename(id, title)))
  ipcMain.handle(
    'library:remove',
    safe('delete', async (ids: number[]) => {
      const errors = await library.remove(ids)
      if (errors.length) toast('error', "Some files couldn't be deleted", errors.join('\n'))
    })
  )
  ipcMain.handle('library:reveal', safe('open the folder', (id: number) => library.reveal(id)))
  ipcMain.handle('library:createCollection', safe('create the collection', (name: string) => library.createCollection(name)))
  ipcMain.handle('library:deleteCollection', safe('delete the collection', (id: number) => library.deleteCollection(id)))
  ipcMain.handle(
    'library:addToCollection',
    safe('add to the collection', (ids: number[], col: number) => library.addToCollection(ids, col))
  )
  ipcMain.handle(
    'library:removeFromCollection',
    safe('remove from the collection', (ids: number[], col: number) => library.removeFromCollection(ids, col))
  )

  ipcMain.handle('capture:status', () => deps.capture.status())
  ipcMain.handle('capture:options', safe('list capture devices', () => deps.capture.options()))
  ipcMain.handle('capture:toggleReplay', safe('toggle the replay buffer', () => deps.capture.toggleReplay()))
  ipcMain.handle('capture:toggleRecording', safe('start or stop recording', () => deps.capture.toggleRecording()))
  ipcMain.handle('capture:saveReplay', safe('save the clip', () => deps.capture.saveReplay()))
  ipcMain.handle('capture:screenshot', safe('take a screenshot', () => deps.capture.screenshot()))

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', safe('save settings', (patch: Partial<AppSettings>) => updateSettings(patch)))
  ipcMain.handle('settings:pickFolder', async () => {
    const w = getMainWindow()
    const opts = { title: 'Choose where to save clips', defaultPath: getSettings().outputFolder, properties: ['openDirectory', 'createDirectory'] as const }
    const res = w ? await dialog.showOpenDialog(w, { ...opts, properties: [...opts.properties] }) : await dialog.showOpenDialog({ ...opts, properties: [...opts.properties] })
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('settings:openLogs', () => shell.showItemInFolder(logPath()))
  ipcMain.handle('settings:pauseHotkeys', (_e, paused: boolean) => deps.pauseHotkeys(paused))
  ipcMain.handle('games:builtIn', () => BUILT_IN_GAMES)
}
