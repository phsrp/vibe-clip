// Starts and stops the OBS engine (libobs, via Streamlabs' obs-studio-node).
// obs-studio-node runs OBS in a helper process (obs64.exe) and talks to it over a pipe,
// so an OBS crash can't take the whole app down with it.
import * as osn from 'obs-studio-node'
import * as path from 'path'
import { app } from 'electron'
import { createLogger } from '../logger'
import { InitCode } from './constants'

const log = createLogger('engine')

let started = false

export function engineDir(): string {
  // Folder containing obs64.exe, the OBS plugins, ffmpeg.exe and ffprobe.exe.
  const dir = path.dirname(require.resolve('obs-studio-node'))
  // When packaged, native files live outside the asar archive.
  return dir.replace('app.asar', 'app.asar.unpacked')
}

export function startEngine(): void {
  if (started) return
  const dataPath = path.join(app.getPath('userData'), 'obs-data')
  const pipe = `vibe-clip-${process.pid}-${Date.now()}`
  log.info(`Starting OBS engine from ${engineDir()}`)

  const hostResult = osn.NodeObs.IPC.host(pipe) as unknown as number
  if (hostResult !== 0) {
    throw new Error(
      hostResult === 253
        ? 'Could not start obs64.exe (missing file or blocked by antivirus).'
        : hostResult === 254
          ? 'The OBS engine is missing a dependency (try reinstalling the Visual C++ runtime).'
          : `The OBS engine helper failed to start (code ${hostResult}).`
    )
  }
  osn.NodeObs.SetWorkingDirectory(engineDir())

  const result = osn.NodeObs.OBS_API_initAPI({
    language: 'en-US',
    appDataPath: dataPath,
    version: app.getVersion(),
    crashServerUrl: ''
  }) as unknown as number

  if (result !== 0) {
    try {
      osn.NodeObs.IPC.disconnect()
    } catch {
      /* ignore */
    }
    throw new Error(InitCode[result] ?? `OBS engine failed to start (code ${result}).`)
  }
  started = true
  log.info('OBS engine started')
}

export function stopEngine(): void {
  if (!started) return
  log.info('Stopping OBS engine')
  try {
    osn.NodeObs.OBS_service_removeCallback()
  } catch (e) {
    log.warn('removeCallback failed', e)
  }
  try {
    osn.NodeObs.IPC.disconnect()
  } catch (e) {
    log.warn('IPC disconnect failed', e)
  }
  started = false
}

export function isEngineRunning(): boolean {
  return started
}

export { osn }
