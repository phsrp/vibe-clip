import { useEffect, useState, type ReactNode } from 'react'

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {description && <p className="section-desc">{description}</p>}
      <div className="settings-card">{children}</div>
    </section>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-text">
        <span className="field-label">{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </div>
      <div className="field-control">{children}</div>
    </div>
  )
}

export function Select<T extends string | number>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <select
      className="select"
      value={String(value)}
      onChange={(e) => {
        const found = options.find((o) => String(o.value) === e.target.value)
        if (found) onChange(found.value)
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked} className={'toggle' + (checked ? ' on' : '')} onClick={() => onChange(!checked)}>
      <span className="knob" />
    </button>
  )
}

/** Number box that only saves when you leave it or press Enter. */
export function NumberInput({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange
}: {
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (v: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const n = Number(text)
    if (!Number.isFinite(n)) return setText(String(value))
    const clamped = Math.min(max, Math.max(min, Math.round(n / step) * step))
    setText(String(clamped))
    if (clamped !== value) onChange(clamped)
  }
  return (
    <span className="number-input">
      <input value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  )
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

/** Converts a key press into an Electron accelerator string like "Alt+F10". */
function toAccelerator(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let key = e.code
  if (key.startsWith('Key')) key = key.slice(3)
  else if (key.startsWith('Digit')) key = key.slice(5)
  else if (key.startsWith('Numpad')) key = 'num' + key.slice(6).toLowerCase()
  else if (key === 'Space') key = 'Space'
  else if (/^F\d+$/.test(key)) key = key
  else if (['Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Pause', 'PrintScreen', 'ScrollLock'].includes(key))
    key = key === 'Pause' ? 'Pause' : key
  else if (key.startsWith('Arrow')) key = key.slice(5)
  else if (key === 'Backquote') key = '`'
  else if (key === 'Minus') key = '-'
  else if (key === 'Equal') key = '='
  else return null
  parts.push(key)
  return parts.join('+')
}

export function HotkeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [listening, setListening] = useState(false)

  useEffect(() => {
    if (!listening) return
    window.api.settings.pauseHotkeys(true)
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setListening(false)
      if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey) {
        onChange('')
        return setListening(false)
      }
      const acc = toAccelerator(e)
      if (acc) {
        onChange(acc)
        setListening(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.api.settings.pauseHotkeys(false)
    }
  }, [listening, onChange])

  return (
    <button className={'hotkey' + (listening ? ' listening' : '')} onClick={() => setListening(!listening)} onBlur={() => setListening(false)}>
      {listening ? 'Press keys… (Esc cancels, Backspace clears)' : value || 'Not set'}
    </button>
  )
}
