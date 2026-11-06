// Draws any OBS settings list (sources, filters, transitions, encoders, streaming services)
// as a form. OBS describes each setting (type, range, choices); this turns that into controls.
import { useEffect, useRef, useState } from 'react'
import { IconFolder, IconRefresh } from '@tabler/icons-react'
import type { PropertyTarget, SerializedProperty } from '@shared/types'
import { Toggle } from './Controls'

/** OBS colors are 32-bit ABGR numbers. */
function obsToHex(v: unknown): string {
  const n = Number(v) >>> 0
  const r = n & 0xff
  const g = (n >> 8) & 0xff
  const b = (n >> 16) & 0xff
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}
function obsAlpha(v: unknown): number {
  return ((Number(v) >>> 0) >>> 24) & 0xff
}
function hexToObs(hex: string, alpha = 255): number {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return ((alpha << 24) | (b << 16) | (g << 8) | r) >>> 0
}

/** Loads a settings form for `target` and keeps it up to date as you change things. */
export function useProperties(target: PropertyTarget | null) {
  const [props, setProps] = useState<SerializedProperty[] | null>(null)
  const key = JSON.stringify(target)
  useEffect(() => {
    setProps(null)
    if (!target) return
    let alive = true
    window.api.props.get(target).then((p) => alive && setProps(p ?? []))
    return () => {
      alive = false
    }
  }, [key])
  const set = async (name: string, value: unknown) => {
    if (!target) return
    // Show the change straight away, then take the engine's answer (it may show/hide other settings).
    setProps((list) => list?.map((p) => (p.name === name ? { ...p, value } : p)) ?? null)
    const fresh = await window.api.props.set(target, name, value)
    if (fresh) setProps(fresh)
  }
  const reload = async () => target && setProps((await window.api.props.get(target)) ?? [])
  return { props, set, reload }
}

export function PropertyForm({ target, hide = [] }: { target: PropertyTarget; hide?: string[] }) {
  const { props, set, reload } = useProperties(target)
  if (!props) return <div className="form-loading">Loading settings…</div>
  const visible = props.filter((p) => p.visible && !hide.includes(p.name))
  if (visible.length === 0) return <div className="form-empty">This has no settings.</div>
  return (
    <div className="prop-form">
      {visible.map((p) => (
        <PropertyRow
          key={p.name}
          prop={p}
          onChange={(v) => set(p.name, v)}
          onButton={async () => {
            await window.api.props.button(target, p.name)
            reload()
          }}
        />
      ))}
    </div>
  )
}

function DebouncedText({ value, multiline, password, onChange }: { value: string; multiline?: boolean; password?: boolean; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)
  const timer = useRef<number>(0)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(value)
  }, [value])
  const change = (v: string) => {
    setText(v)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => onChange(v), 350)
  }
  const common = {
    value: text,
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false
      clearTimeout(timer.current)
      if (text !== value) onChange(text)
    }
  }
  return multiline ? (
    <textarea className="text-input textarea" rows={4} {...common} onChange={(e) => change(e.target.value)} />
  ) : (
    <input className="text-input" type={password ? 'password' : 'text'} {...common} onChange={(e) => change(e.target.value)} />
  )
}

function NumberField({ p, onChange }: { p: SerializedProperty; onChange: (v: number) => void }) {
  const value = Number(p.value ?? 0)
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const isInt = p.type === 'int'
  const commit = (raw: string | number) => {
    let n = Number(raw)
    if (!Number.isFinite(n)) return setText(String(value))
    if (p.min !== undefined) n = Math.max(p.min, n)
    if (p.max !== undefined) n = Math.min(p.max, n)
    if (isInt) n = Math.round(n)
    setText(String(n))
    if (n !== value) onChange(n)
  }
  return (
    <span className="number-field">
      {p.slider && p.min !== undefined && p.max !== undefined && (
        <input
          type="range"
          className="range"
          min={p.min}
          max={p.max}
          step={p.step || (isInt ? 1 : 0.01)}
          value={Number(text) || 0}
          onChange={(e) => setText(e.target.value)}
          onMouseUp={(e) => commit((e.target as HTMLInputElement).value)}
          onKeyUp={(e) => commit((e.target as HTMLInputElement).value)}
        />
      )}
      <span className="number-input">
        <input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => commit(text)} onKeyDown={(e) => e.key === 'Enter' && commit(text)} />
      </span>
    </span>
  )
}

function PropertyRow({ prop: p, onChange, onButton }: { prop: SerializedProperty; onChange: (v: unknown) => void; onButton: () => void }) {
  const disabled = !p.enabled
  const label = <span className="prop-label" title={p.description || undefined}>{p.label}</span>

  switch (p.type) {
    case 'bool':
      return (
        <div className={'prop-row inline' + (disabled ? ' disabled' : '')}>
          {label}
          <Toggle checked={!!p.value} onChange={onChange} />
        </div>
      )
    case 'int':
    case 'float':
      return (
        <div className={'prop-row' + (disabled ? ' disabled' : '')}>
          {label}
          <NumberField p={p} onChange={onChange} />
        </div>
      )
    case 'text':
      if (p.textMode === 'info')
        return (
          <div className="prop-row">
            <span className="prop-info">{String(p.value ?? p.label)}</span>
          </div>
        )
      return (
        <div className={'prop-row' + (disabled ? ' disabled' : '')}>
          {label}
          <DebouncedText value={String(p.value ?? '')} multiline={p.textMode === 'multiline'} password={p.textMode === 'password'} onChange={onChange} />
        </div>
      )
    case 'path':
      return (
        <div className={'prop-row' + (disabled ? ' disabled' : '')}>
          {label}
          <span className="path-field">
            <DebouncedText value={String(p.value ?? '')} onChange={onChange} />
            <button
              className="btn"
              onClick={async () => {
                const picked = await window.api.props.pickPath(p.pathMode ?? 'file', p.filter ?? '', String(p.value ?? ''))
                if (picked) onChange(picked)
              }}
            >
              <IconFolder size={14} /> Browse
            </button>
          </span>
        </div>
      )
    case 'list': {
      const items = p.items ?? []
      const current = items.find((i) => String(i.value) === String(p.value))
      return (
        <div className={'prop-row' + (disabled ? ' disabled' : '')}>
          {label}
          <select
            className="select wide"
            value={String(p.value ?? '')}
            onChange={(e) => {
              const item = items.find((i) => String(i.value) === e.target.value)
              onChange(item ? item.value : e.target.value)
            }}
          >
            {!current && <option value={String(p.value ?? '')}>{p.value ? String(p.value) : 'Choose…'}</option>}
            {items.map((i) => (
              <option key={String(i.value)} value={String(i.value)} disabled={!i.enabled}>
                {i.label}
              </option>
            ))}
          </select>
        </div>
      )
    }
    case 'color':
    case 'color_alpha':
      return (
        <div className={'prop-row inline' + (disabled ? ' disabled' : '')}>
          {label}
          <span className="color-field">
            <input type="color" value={obsToHex(p.value)} onChange={(e) => onChange(hexToObs(e.target.value, p.type === 'color' ? 255 : obsAlpha(p.value)))} />
            {p.type === 'color_alpha' && (
              <input
                type="range"
                className="range small"
                min={0}
                max={255}
                value={obsAlpha(p.value)}
                title="Opacity"
                onChange={(e) => onChange(hexToObs(obsToHex(p.value), Number(e.target.value)))}
              />
            )}
          </span>
        </div>
      )
    case 'button':
      return (
        <div className="prop-row inline">
          <span />
          <button className="btn" disabled={disabled} onClick={onButton}>
            <IconRefresh size={14} /> {p.label}
          </button>
        </div>
      )
    case 'font': {
      const f = (p.value ?? {}) as { face?: string; size?: number; style?: string; flags?: number }
      return (
        <div className={'prop-row' + (disabled ? ' disabled' : '')}>
          {label}
          <span className="font-field">
            <DebouncedText value={f.face ?? 'Arial'} onChange={(face) => onChange({ ...f, face })} />
            <span className="number-input">
              <input
                defaultValue={f.size ?? 36}
                onBlur={(e) => onChange({ ...f, size: Math.max(4, Number(e.target.value) || 36) })}
                onKeyDown={(e) => e.key === 'Enter' && onChange({ ...f, size: Math.max(4, Number(e.currentTarget.value) || 36) })}
              />
            </span>
            <label className="check">
              <input type="checkbox" checked={!!((f.flags ?? 0) & 1)} onChange={(e) => onChange({ ...f, flags: ((f.flags ?? 0) & ~1) | (e.target.checked ? 1 : 0) })} />
              Bold
            </label>
            <label className="check">
              <input type="checkbox" checked={!!((f.flags ?? 0) & 2)} onChange={(e) => onChange({ ...f, flags: ((f.flags ?? 0) & ~2) | (e.target.checked ? 2 : 0) })} />
              Italic
            </label>
          </span>
        </div>
      )
    }
    case 'editable_list': {
      const list = Array.isArray(p.value) ? (p.value as { value: string }[]) : []
      return (
        <div className={'prop-row' + (disabled ? ' disabled' : '')}>
          {label}
          <DebouncedText
            multiline
            value={list.map((x) => x.value).join('\n')}
            onChange={(t) =>
              onChange(
                t
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((value) => ({ value, selected: false, hidden: false }))
              )
            }
          />
          <span className="field-hint">One per line (file paths or addresses).</span>
        </div>
      )
    }
    case 'group':
      return <div className="prop-group">{p.label}</div>
    default:
      return null
  }
}
