import { useEffect, useState } from 'react'
import { IconArrowDown, IconArrowUp, IconEye, IconEyeOff, IconPlus, IconTrash } from '@tabler/icons-react'
import type { AppSettings, FilterConfig, ProfileSource, ProfilesState, SourceTransform } from '@shared/types'
import { PropertyForm } from './PropertyForm'
import { ContextMenu } from './ContextMenu'
import { Toggle } from './Controls'
import { isGlobal, mapSource, posToVol, rid, volToDb, volToPos } from '../lib/profiles'

type Tab = 'settings' | 'position' | 'audio' | 'filters'

interface Props {
  source: ProfileSource
  state: ProfilesState
  hasAudio: boolean
  canvas: { width: number; height: number }
  trackNames: AppSettings['tracks']
  onChange: (next: ProfilesState) => void
}

const AUDIO_ONLY = ['mic', 'desktop_audio', 'app_audio']

export function SourceInspector({ source, state, hasAudio, canvas, trackNames, onChange }: Props) {
  const audioOnly = AUDIO_ONLY.includes(source.kind)
  const tabs: { id: Tab; label: string }[] = [
    { id: 'settings', label: 'Settings' },
    ...(!audioOnly && !isGlobal(state, source.id) ? [{ id: 'position' as Tab, label: 'Position' }] : []),
    ...(hasAudio || audioOnly ? [{ id: 'audio' as Tab, label: 'Audio' }] : []),
    { id: 'filters', label: 'Filters' }
  ]
  const [tab, setTab] = useState<Tab>('settings')
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab('settings')
  }, [source.id])

  const update = (fn: (s: ProfileSource) => ProfileSource) => onChange(mapSource(state, source.id, fn))

  return (
    <div className="inspector-body">
      <input
        className="inspector-title"
        value={source.name}
        onChange={(e) => update((s) => ({ ...s, name: e.target.value }))}
        onBlur={(e) => !e.target.value.trim() && update((s) => ({ ...s, name: 'Source' }))}
      />
      <div className="seg tabs-seg">
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="inspector-scroll">
        {tab === 'settings' &&
          (source.kind === 'auto_game' ? (
            <div className="form-note">
              This follows whichever known game is running (see the Games list on the Clips page). Nothing to set up here.
              <PropertyForm target={{ kind: 'source', sourceId: source.id }} hide={['capture_mode', 'window', 'priority']} />
            </div>
          ) : (
            <PropertyForm target={{ kind: 'source', sourceId: source.id }} />
          ))}
        {tab === 'position' && <TransformEditor t={source.transform} canvas={canvas} onChange={(transform) => update((s) => ({ ...s, transform }))} />}
        {tab === 'audio' && <AudioEditor source={source} trackNames={trackNames} onChange={(audio) => update((s) => ({ ...s, audio }))} />}
        {tab === 'filters' && <FiltersEditor source={source} audioOnly={audioOnly} hasAudio={hasAudio} onChange={(filters) => update((s) => ({ ...s, filters }))} />}
      </div>
    </div>
  )
}

function Num({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(Math.round(value * 1000) / 1000)), [value])
  const commit = () => {
    const n = Number(text)
    if (Number.isFinite(n) && n !== value) onChange(n)
    else setText(String(value))
  }
  return (
    <label className="num-cell">
      <span>{label}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            onChange(Math.round((value + (e.key === 'ArrowUp' ? step : -step)) * 1000) / 1000)
          }
        }}
      />
    </label>
  )
}

function TransformEditor({ t, canvas, onChange }: { t: SourceTransform; canvas: { width: number; height: number }; onChange: (t: SourceTransform) => void }) {
  const set = (patch: Partial<SourceTransform>) => onChange({ ...t, ...patch })
  const place = (corner: 'tl' | 'tr' | 'bl' | 'br' | 'center', size: number) => {
    const w = Math.round(canvas.width * size)
    const h = Math.round(canvas.height * size)
    const m = Math.round(canvas.height * 0.02)
    const x = corner === 'center' ? Math.round((canvas.width - w) / 2) : corner.endsWith('l') ? m : canvas.width - w - m
    const y = corner === 'center' ? Math.round((canvas.height - h) / 2) : corner.startsWith('t') ? m : canvas.height - h - m
    onChange({ ...t, fit: 'custom', x, y, scaleX: 1, scaleY: 1, rotation: 0, alignment: 5, boundsType: 2, boundsWidth: w, boundsHeight: h, boundsAlignment: 0 })
  }
  return (
    <div className="transform">
      <div className="form-section">Size</div>
      <div className="seg">
        {(['fit', 'stretch', 'custom'] as const).map((f) => (
          <button key={f} className={t.fit === f ? 'on' : ''} onClick={() => set({ fit: f, ...(f === 'custom' && t.boundsType === 2 && !t.boundsWidth ? { boundsWidth: canvas.width, boundsHeight: canvas.height } : {}) })}>
            {f === 'fit' ? 'Fit screen' : f === 'stretch' ? 'Stretch' : 'Custom'}
          </button>
        ))}
      </div>
      <div className="form-section">Quick placement</div>
      <div className="place-grid">
        <button className="btn" onClick={() => place('tl', 0.25)}>Top left</button>
        <button className="btn" onClick={() => place('tr', 0.25)}>Top right</button>
        <button className="btn" onClick={() => place('center', 0.5)}>Center</button>
        <button className="btn" onClick={() => place('bl', 0.25)}>Bottom left</button>
        <button className="btn" onClick={() => place('br', 0.25)}>Bottom right</button>
        <button className="btn" onClick={() => set({ fit: 'fit' })}>Full screen</button>
      </div>
      {t.fit === 'custom' && (
        <>
          <div className="form-section">Position (pixels on the {canvas.width}×{canvas.height} canvas)</div>
          <div className="num-grid">
            <Num label="X" value={t.x} onChange={(x) => set({ x })} />
            <Num label="Y" value={t.y} onChange={(y) => set({ y })} />
            <Num label="Rotation°" value={t.rotation} onChange={(rotation) => set({ rotation })} />
          </div>
          <div className="form-section">Box size {t.boundsType ? '' : '(off: uses the scale below)'}</div>
          <div className="num-grid">
            <Num
              label="Width"
              value={t.boundsType ? t.boundsWidth : 0}
              onChange={(w) => set(w > 0 ? { boundsType: t.boundsType || 2, boundsWidth: w, boundsHeight: t.boundsHeight || Math.round((w * canvas.height) / canvas.width) } : { boundsType: 0 })}
            />
            <Num label="Height" value={t.boundsType ? t.boundsHeight : 0} onChange={(h) => set(h > 0 ? { boundsType: t.boundsType || 2, boundsHeight: h } : { boundsType: 0 })} />
            <label className="num-cell">
              <span>In the box</span>
              <select className="select" value={t.boundsType} onChange={(e) => set({ boundsType: Number(e.target.value) })}>
                <option value={0}>No box</option>
                <option value={2}>Fit inside</option>
                <option value={3}>Fill (crop)</option>
                <option value={1}>Stretch</option>
                <option value={4}>Fit width</option>
                <option value={5}>Fit height</option>
                <option value={6}>Shrink only</option>
              </select>
            </label>
          </div>
          {!t.boundsType && (
            <div className="num-grid">
              <Num label="Scale X" value={t.scaleX} step={0.05} onChange={(scaleX) => set({ scaleX })} />
              <Num label="Scale Y" value={t.scaleY} step={0.05} onChange={(scaleY) => set({ scaleY })} />
            </div>
          )}
        </>
      )}
      <div className="form-section">Crop (pixels)</div>
      <div className="num-grid four">
        {(['left', 'top', 'right', 'bottom'] as const).map((k) => (
          <Num key={k} label={k[0].toUpperCase() + k.slice(1)} value={t.crop[k]} onChange={(v) => set({ crop: { ...t.crop, [k]: Math.max(0, Math.round(v)) } })} />
        ))}
      </div>
    </div>
  )
}

function AudioEditor({ source, trackNames, onChange }: { source: ProfileSource; trackNames: AppSettings['tracks']; onChange: (a: ProfileSource['audio']) => void }) {
  const a = source.audio
  const db = volToDb(a.volume)
  return (
    <div className="audio-editor">
      <div className="prop-row">
        <span className="prop-label">Volume ({Number.isFinite(db) ? db.toFixed(1) : '-∞'} dB)</span>
        <input type="range" className="range" min={0} max={1} step={0.001} value={volToPos(a.volume)} onChange={(e) => onChange({ ...a, volume: posToVol(Number(e.target.value)) })} />
      </div>
      <div className="prop-row inline">
        <span className="prop-label">Muted</span>
        <Toggle checked={a.muted} onChange={(muted) => onChange({ ...a, muted })} />
      </div>
      <div className="prop-row">
        <span className="prop-label">Listen (monitoring)</span>
        <select className="select wide" value={a.monitoring} onChange={(e) => onChange({ ...a, monitoring: Number(e.target.value) })}>
          <option value={0}>Off</option>
          <option value={1}>Monitor only (not recorded)</option>
          <option value={2}>Monitor and record</option>
        </select>
      </div>
      <div className="prop-row">
        <span className="prop-label">Sync offset (ms)</span>
        <Num label="" value={a.syncOffsetMs} step={10} onChange={(syncOffsetMs) => onChange({ ...a, syncOffsetMs })} />
      </div>
      <div className="form-section">Audio tracks this goes to</div>
      <div className="tracks">
        {trackNames.map((t, i) => {
          const bit = 1 << i
          return (
            <label key={i} className={'track-chip' + (a.mixers & bit ? ' on' : '')}>
              <input type="checkbox" checked={!!(a.mixers & bit)} onChange={(e) => onChange({ ...a, mixers: e.target.checked ? a.mixers | bit : a.mixers & ~bit })} />
              <b>{i + 1}</b> {t.name}
            </label>
          )
        })}
      </div>
      <p className="form-note">Track 1 is what the built-in player and most apps play. Which tracks get saved is set in Settings → Audio tracks.</p>
    </div>
  )
}

function FiltersEditor({ source, audioOnly, hasAudio, onChange }: { source: ProfileSource; audioOnly: boolean; hasAudio: boolean; onChange: (f: FilterConfig[]) => void }) {
  const [types, setTypes] = useState<{ id: string; label: string; audio: boolean }[]>([])
  const [selected, setSelected] = useState<string | null>(source.filters[0]?.id ?? null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    window.api.profiles.filterTypes().then(setTypes)
  }, [])
  useEffect(() => setSelected(source.filters[0]?.id ?? null), [source.id])

  const available = types.filter((t) => (t.audio ? hasAudio || audioOnly : !audioOnly))
  const filters = source.filters
  const move = (i: number, d: number) => {
    const next = [...filters]
    const [f] = next.splice(i, 1)
    next.splice(i + d, 0, f)
    onChange(next)
  }
  const current = filters.find((f) => f.id === selected) ?? null

  return (
    <div className="filters">
      <div className="filter-list">
        {filters.length === 0 && <div className="panel-empty">No filters yet. Filters change how a source looks or sounds (green screen, color, noise suppression…).</div>}
        {filters.map((f, i) => (
          <div key={f.id} className={'filter-row' + (f.id === selected ? ' selected' : '')} onClick={() => setSelected(f.id)}>
            <button className="icon-btn small" title={f.enabled ? 'Turn off' : 'Turn on'} onClick={(e) => (e.stopPropagation(), onChange(filters.map((x) => (x.id === f.id ? { ...x, enabled: !x.enabled } : x))))}>
              {f.enabled ? <IconEye size={14} /> : <IconEyeOff size={14} />}
            </button>
            <span className="filter-name">{f.name}</span>
            <button className="icon-btn small" disabled={i === 0} onClick={(e) => (e.stopPropagation(), move(i, -1))}>
              <IconArrowUp size={14} />
            </button>
            <button className="icon-btn small" disabled={i === filters.length - 1} onClick={(e) => (e.stopPropagation(), move(i, 1))}>
              <IconArrowDown size={14} />
            </button>
            <button className="icon-btn small" title="Remove" onClick={(e) => (e.stopPropagation(), onChange(filters.filter((x) => x.id !== f.id)))}>
              <IconTrash size={14} />
            </button>
          </div>
        ))}
        <button
          className="btn ghost"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setMenu({ x: r.left, y: r.bottom + 4 })
          }}
        >
          <IconPlus size={14} /> Add filter
        </button>
      </div>
      {current && (
        <div className="filter-settings">
          <div className="form-section">{current.name}</div>
          <PropertyForm key={current.id} target={{ kind: 'filter', sourceId: source.id, filterId: current.id }} />
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={available.map((t) => ({
            label: t.label + (t.audio ? ' (audio)' : ''),
            onClick: () => {
              const f: FilterConfig = { id: rid('flt'), name: t.label, type: t.id, enabled: true, settings: {} }
              onChange([...filters, f])
              setSelected(f.id)
            }
          }))}
        />
      )}
    </div>
  )
}
