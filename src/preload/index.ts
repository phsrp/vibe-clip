// The safe bridge between the UI and the background process.
// The UI can only call the functions listed here.
import { contextBridge, ipcRenderer } from 'electron'
import type { EngineStatus } from '@shared/types'

const api = {
  engineStatus: (): Promise<EngineStatus> => ipcRenderer.invoke('engine:status')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
