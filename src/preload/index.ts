// The safe bridge between the UI and the background process.
// The UI can only call the functions listed here.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AppSettings,
  CaptureOptions,
  CaptureStatus,
  EngineStatus,
  GameDefinition,
  LibrarySnapshot,
  ObsProfilePreview,
  ToastMessage
} from '@shared/types'

function listen<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  engineStatus: (): Promise<EngineStatus> => ipcRenderer.invoke('engine:status'),
  setTitleBarColors: (bg: string, fg: string): void => ipcRenderer.send('window:titlebar', bg, fg),

  library: {
    get: (): Promise<LibrarySnapshot> => ipcRenderer.invoke('library:get'),
    rename: (id: number, title: string): Promise<void> => ipcRenderer.invoke('library:rename', id, title),
    remove: (ids: number[]): Promise<void> => ipcRenderer.invoke('library:remove', ids),
    reveal: (id: number): Promise<void> => ipcRenderer.invoke('library:reveal', id),
    createCollection: (name: string): Promise<void> => ipcRenderer.invoke('library:createCollection', name),
    deleteCollection: (id: number): Promise<void> => ipcRenderer.invoke('library:deleteCollection', id),
    addToCollection: (clipIds: number[], collectionId: number): Promise<void> =>
      ipcRenderer.invoke('library:addToCollection', clipIds, collectionId),
    removeFromCollection: (clipIds: number[], collectionId: number): Promise<void> =>
      ipcRenderer.invoke('library:removeFromCollection', clipIds, collectionId),
    onChange: (cb: (snap: LibrarySnapshot) => void) => listen('library:changed', cb)
  },

  capture: {
    status: (): Promise<CaptureStatus> => ipcRenderer.invoke('capture:status'),
    options: (): Promise<CaptureOptions> => ipcRenderer.invoke('capture:options'),
    toggleReplay: (): Promise<void> => ipcRenderer.invoke('capture:toggleReplay'),
    toggleRecording: (): Promise<void> => ipcRenderer.invoke('capture:toggleRecording'),
    saveReplay: (): Promise<void> => ipcRenderer.invoke('capture:saveReplay'),
    screenshot: (): Promise<void> => ipcRenderer.invoke('capture:screenshot'),
    onStatus: (cb: (s: CaptureStatus) => void) => listen('capture:status', cb)
  },

  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('settings:set', patch),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('settings:pickFolder'),
    openLogs: (): Promise<void> => ipcRenderer.invoke('settings:openLogs'),
    /** Temporarily turn off global hotkeys while the user is typing a new one. */
    pauseHotkeys: (paused: boolean): Promise<void> => ipcRenderer.invoke('settings:pauseHotkeys', paused)
  },

  obs: {
    /** Finds OBS Studio profiles on this PC and previews what would be imported. */
    listProfiles: (): Promise<ObsProfilePreview[] | undefined> => ipcRenderer.invoke('obs:listProfiles')
  },

  games: {
    builtIn: (): Promise<GameDefinition[]> => ipcRenderer.invoke('games:builtIn')
  },

  onToast: (cb: (t: ToastMessage) => void) => listen('toast', cb)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
