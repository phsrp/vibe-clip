// Global hotkeys: they work even while a game has focus.
import { globalShortcut } from 'electron'
import type { Hotkeys } from '@shared/types'
import { createLogger } from './logger'
import { toast } from './notify'

const log = createLogger('hotkeys')

export type HotkeyActions = Record<keyof Hotkeys, () => void>

/** Extra hotkeys that come from profiles ("switch to this profile"). */
export interface ExtraHotkey {
  accelerator: string
  label: string
  action: () => void
}

export const HOTKEY_LABELS: Record<keyof Hotkeys, string> = {
  saveReplay: 'Save clip',
  toggleRecording: 'Start / stop recording',
  screenshot: 'Screenshot',
  toggleReplay: 'Turn replay buffer on / off',
  toggleStream: 'Start / stop streaming',
  muteMic: 'Mute / unmute microphone'
}

let current: Hotkeys | null = null
let actions: HotkeyActions | null = null
let extras: ExtraHotkey[] = []
let paused = false
let lastFailed = ''

export function registerHotkeys(keys: Hotkeys, acts: HotkeyActions, extra: ExtraHotkey[] = extras): void {
  current = keys
  actions = acts
  extras = extra
  if (!paused) apply()
}

function apply(): void {
  globalShortcut.unregisterAll()
  if (!current || !actions) return
  const list: ExtraHotkey[] = [
    ...(Object.keys(current) as (keyof Hotkeys)[]).map((k) => ({ accelerator: current![k], label: HOTKEY_LABELS[k] ?? k, action: actions![k] })),
    ...extras
  ]
  const failed: string[] = []
  const used = new Map<string, string>()
  for (const h of list) {
    if (!h.accelerator || !h.action) continue
    if (used.has(h.accelerator)) {
      failed.push(`${h.label} (${h.accelerator}, also used by ${used.get(h.accelerator)})`)
      continue
    }
    let ok = false
    try {
      ok = globalShortcut.register(h.accelerator, () => {
        log.info(`Hotkey ${h.accelerator} -> ${h.label}`)
        try {
          h.action()
        } catch (e) {
          log.error(`Hotkey action ${h.label} failed`, e)
        }
      })
    } catch (e) {
      log.error(`Invalid hotkey ${h.accelerator}`, e)
    }
    if (ok) used.set(h.accelerator, h.label)
    else failed.push(`${h.label} (${h.accelerator})`)
  }
  const key = failed.join(',')
  if (failed.length && key !== lastFailed) {
    toast('error', "Some hotkeys couldn't be registered", `Another app may already use them: ${failed.join(', ')}. Pick different keys in Settings.`)
  }
  lastFailed = key
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
