// Global hotkeys: they work even while a game has focus.
import { globalShortcut } from 'electron'
import type { Hotkeys } from '@shared/types'
import { createLogger } from './logger'
import { toast } from './notify'

const log = createLogger('hotkeys')

export type HotkeyActions = Record<keyof Hotkeys, () => void>

const LABELS: Record<keyof Hotkeys, string> = {
  saveReplay: 'Save clip',
  toggleRecording: 'Start / stop recording',
  screenshot: 'Screenshot'
}

let current: Hotkeys | null = null
let actions: HotkeyActions | null = null
let paused = false

export function registerHotkeys(keys: Hotkeys, acts: HotkeyActions): void {
  current = keys
  actions = acts
  if (!paused) apply()
}

function apply(): void {
  globalShortcut.unregisterAll()
  if (!current || !actions) return
  const failed: string[] = []
  for (const name of Object.keys(current) as (keyof Hotkeys)[]) {
    const accel = current[name]
    if (!accel) continue
    const action = actions[name]
    let ok = false
    try {
      ok = globalShortcut.register(accel, () => {
        log.info(`Hotkey ${accel} -> ${name}`)
        try {
          action()
        } catch (e) {
          log.error(`Hotkey action ${name} failed`, e)
        }
      })
    } catch (e) {
      log.error(`Invalid hotkey ${accel}`, e)
    }
    if (ok) log.info(`Registered ${accel} for ${name}`)
    else failed.push(`${LABELS[name]} (${accel})`)
  }
  if (failed.length) {
    toast('error', "Some hotkeys couldn't be registered", `Another app may already use them: ${failed.join(', ')}. Pick different keys in Settings.`)
  }
}

/** While you're typing a new hotkey in Settings, the old ones are switched off. */
export function pauseHotkeys(p: boolean): void {
  paused = p
  if (p) globalShortcut.unregisterAll()
  else apply()
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll()
}
