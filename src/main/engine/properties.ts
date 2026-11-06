// Turns OBS "properties" (the settings any OBS source, filter, transition, encoder or service
// offers) into plain data the UI can draw as a form. This is how the app exposes every OBS
// setting without hand-writing a screen for each one.
import type * as OSN from 'obs-studio-node'
import type { SerializedProperty } from '@shared/types'
import { createLogger } from '../logger'

const log = createLogger('properties')

const TYPES: SerializedProperty['type'][] = [
  'unknown',
  'bool',
  'int',
  'float',
  'text',
  'path',
  'list',
  'color',
  'button',
  'font',
  'editable_list',
  'frame_rate',
  'group',
  'color_alpha',
  'capture'
]

type AnyDetails = {
  type?: number
  min?: number
  max?: number
  step?: number
  filter?: string
  format?: number
  items?: { name: string; value: string | number; enabled?: boolean }[]
}

export function serializeProperties(props: OSN.IProperties | null | undefined): SerializedProperty[] {
  const out: SerializedProperty[] = []
  if (!props) return out
  let p: OSN.IProperty | null = null
  try {
    p = props.first()
  } catch {
    return out
  }
  let guard = 0
  while (p && guard++ < 500) {
    try {
      const type = TYPES[p.type as unknown as number] ?? 'unknown'
      const d = ((p as unknown as { details?: AnyDetails }).details ?? {}) as AnyDetails
      const sp: SerializedProperty = {
        name: p.name,
        label: p.description || p.name,
        description: p.longDescription || '',
        type,
        visible: p.visible,
        enabled: p.enabled,
        value: p.value
      }
      if (type === 'int' || type === 'float') {
        sp.min = d.min
        sp.max = d.max
        sp.step = d.step
        sp.slider = d.type === 1
      }
      if (type === 'text') sp.textMode = (['default', 'password', 'multiline', 'info'] as const)[d.type ?? 0] ?? 'default'
      if (type === 'path') {
        sp.pathMode = (['file', 'save', 'dir'] as const)[d.type ?? 0] ?? 'file'
        sp.filter = d.filter
      }
      if (type === 'list' || type === 'editable_list') {
        sp.items = (d.items ?? []).map((i) => ({ label: i.name, value: i.value, enabled: i.enabled !== false }))
        sp.editable = d.type === 1 // OBS_COMBO_TYPE_EDITABLE
      }
      if (type === 'editable_list') sp.filter = d.filter
      out.push(sp)
    } catch (e) {
      log.warn('Skipping a property that could not be read', e)
    }
    try {
      if (p.is_last()) break
      p = p.next()
    } catch {
      break
    }
  }
  return out
}

/** Presses a button property (e.g. "Refresh" in a browser source). */
export function clickButton(target: OSN.ISource | OSN.IVideoEncoder | OSN.IService, name: string): void {
  const prop = target.properties.get(name) as OSN.IButtonProperty | undefined
  prop?.buttonClicked(target as unknown as object)
}

/**
 * After a setting changes, OBS may need to run its "modified" logic (which shows or hides
 * related settings). Asking for that is harmless if the property has none.
 */
export function notifyModified(target: { properties: OSN.IProperties }, name: string): void {
  try {
    target.properties.get(name)?.modified()
  } catch {
    /* not supported for this property */
  }
}
