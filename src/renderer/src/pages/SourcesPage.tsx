import { useEffect, useMemo, useState } from 'react'
import {
  IconAppWindow,
  IconArrowDown,
  IconArrowUp,
  IconBrowser,
  IconCamera,
  IconCopy,
  IconDeviceDesktop,
  IconDeviceGamepad2,
  IconEye,
  IconEyeOff,
  IconMicrophone,
  IconMovie,
  IconPalette,
  IconPencil,
  IconPhoto,
  IconPlus,
  IconSlideshow,
  IconTarget,
  IconTextSize,
  IconTrash,
  IconVolume,
  IconWand
} from '@tabler/icons-react'
import type { AppSettings, EngineStatus, ProfileSource, ProfilesState, SourceKind, SourceTypeInfo } from '@shared/types'
import { ObsPreview } from '../components/ObsPreview'
import { Mixer } from '../components/Mixer'
import { SourceInspector } from '../components/SourceInspector'
import { PropertyForm } from '../components/PropertyForm'
import { ContextMenu, type MenuItem } from '../components/ContextMenu'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { HotkeyInput, NumberInput } from '../components/Controls'
import { activeProfile, cloneSource, findSource, mapProfile, removeSource, rid, uniqueName } from '../lib/profiles'

export const KIND_ICONS: Record<SourceKind, typeof IconEye> = {
  auto_game: IconWand,
  display: IconDeviceDesktop,
  window: IconAppWindow,
  game: IconDeviceGamepad2,
  webcam: IconCamera,
  mic: IconMicrophone,
  desktop_audio: IconVolume,
  app_audio: IconVolume,
  image: IconPhoto,
  slideshow: IconSlideshow,
  text: IconTextSize,
  media: IconMovie,
  browser: IconBrowser,
  color: IconPalette,
  other: IconTarget
}

interface Props {
  profiles: ProfilesState
  onProfiles: (next: ProfilesState) => void
  settings: AppSettings
  engine: EngineStatus | null
}

export function SourcesPage({ profiles: state, onProfiles, settings, engine }: Props) {
  const [types, setTypes] = useState<SourceTypeInfo[]>([])
  const [audioIds, setAudioIds] = useState<string[]>([])
  const [canvas, setCanvas] = useState({ width: 1920, height: 1080 })
  const [selected, setSelected] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [renamingProfile, setRenamingProfile] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => void } | null>(null)

  useEffect(() => {
    window.api.profiles.sourceTypes().then(setTypes)
    window.api.profiles.canvas().then(setCanvas)
  }, [])
  // Which sources have sound (asked again whenever sources change).
  const sourceKey = useMemo(() => [...state.profiles.flatMap((p) => p.sources), ...state.globalAudio].map((s) => s.id + s.obsType).join(), [state])
  useEffect(() => {
    const t = setTimeout(() => window.api.mixer.audioIds().then(setAudioIds), 250)
    return () => clearTimeout(t)
  }, [sourceKey])

  const profile = activeProfile(state)
  const selectedSource = findSource(state, selected)

  const addSource = async (info: SourceTypeInfo) => {
    const name = uniqueName(info.kind === 'auto_game' ? 'Game' : info.label, profile.sources.map((s) => s.name))
    const src = await window.api.profiles.newSource(info.kind, name)
    if (!src) return
    onProfiles(mapProfile(state, profile.id, (p) => ({ ...p, sources: [src, ...p.sources] })))
    setSelected(src.id)
  }

  const moveSource = (i: number, d: number) =>
    onProfiles(
      mapProfile(state, profile.id, (p) => {
        const sources = [...p.sources]
        const [s] = sources.splice(i, 1)
        sources.splice(i + d, 0, s)
        return { ...p, sources }
      })
    )

  const sourceMenu = (s: ProfileSource, i: number): MenuItem[] => [
    { label: s.visible ? 'Hide' : 'Show', icon: s.visible ? <IconEyeOff size={15} /> : <IconEye size={15} />, onClick: () => toggleVisible(s) },
    {
      label: 'Duplicate',
      icon: <IconCopy size={15} />,
      onClick: () => {
        const copy = cloneSource(s, uniqueName(s.name, profile.sources.map((x) => x.name)))
        onProfiles(mapProfile(state, profile.id, (p) => ({ ...p, sources: [...p.sources.slice(0, i), copy, ...p.sources.slice(i)] })))
        setSelected(copy.id)
      }
    },
    {
      label: 'Copy to profile',
      icon: <IconCopy size={15} />,
      children: state.profiles
        .filter((p) => p.id !== profile.id)
        .map((p) => ({ label: p.name, onClick: () => onProfiles(mapProfile(state, p.id, (x) => ({ ...x, sources: [cloneSource(s), ...x.sources] }))) }))
    },
    { label: 'Move up', icon: <IconArrowUp size={15} />, disabled: i === 0, onClick: () => moveSource(i, -1) },
    { label: 'Move down', icon: <IconArrowDown size={15} />, disabled: i === profile.sources.length - 1, onClick: () => moveSource(i, 1) },
    { separator: true, label: '' },
    {
      label: 'Remove',
      icon: <IconTrash size={15} />,
      danger: true,
      onClick: () => {
        if (selected === s.id) setSelected(null)
        onProfiles(removeSource(state, s.id))
      }
    }
  ]

  const toggleVisible = (s: ProfileSource) =>
    onProfiles(mapProfile(state, profile.id, (p) => ({ ...p, sources: p.sources.map((x) => (x.id === s.id ? { ...x, visible: !x.visible } : x)) })))

  const profileMenu = (id: string): MenuItem[] => {
    const p = state.profiles.find((x) => x.id === id)!
    return [
      { label: 'Rename', icon: <IconPencil size={15} />, onClick: () => setRenamingProfile(id) },
      {
        label: 'Duplicate',
        icon: <IconCopy size={15} />,
        onClick: () => {
          const copy = { ...p, id: rid('prof'), name: uniqueName(p.name, state.profiles.map((x) => x.name)), hotkey: '', sources: p.sources.map((s) => cloneSource(s)) }
          onProfiles({ ...state, profiles: [...state.profiles, copy] })
        }
      },
      { separator: true, label: '' },
      {
        label: 'Delete',
        icon: <IconTrash size={15} />,
        danger: true,
        disabled: state.profiles.length === 1,
        onClick: () =>
          setConfirm({
            title: `Delete "${p.name}"?`,
            message: 'Its sources and their settings are removed. Your clips are not affected.',
            run: () => onProfiles({ ...state, profiles: state.profiles.filter((x) => x.id !== id) })
          })
      }
    ]
  }

  return (
    <div className="page sources-page">
      <aside className="profiles-col">
        <div className="col-header">
          <h1>Profiles</h1>
          <button
            className="icon-btn"
            title="New profile"
            onClick={() => {
              const p = { id: rid('prof'), name: uniqueName('Profile', state.profiles.map((x) => x.name)), sources: [], hotkey: '' }
              onProfiles({ ...state, profiles: [...state.profiles, p], activeId: p.id })
              setRenamingProfile(p.id)
            }}
          >
            <IconPlus size={18} />
          </button>
        </div>
        <div className="sidebar-scroll">
          {state.profiles.map((p) =>
            renamingProfile === p.id ? (
              <div key={p.id} className="side-item editing">
                <input
                  autoFocus
                  className="side-input"
                  defaultValue={p.name}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setRenamingProfile(null)
                  }}
                  onBlur={(e) => {
                    const name = e.target.value.trim()
                    if (name) onProfiles(mapProfile(state, p.id, (x) => ({ ...x, name })))
                    setRenamingProfile(null)
                  }}
                />
              </div>
            ) : (
              <button
                key={p.id}
                className={'side-item profile-item' + (p.id === state.activeId ? ' active' : '')}
                onClick={() => {
                  if (p.id !== state.activeId) onProfiles({ ...state, activeId: p.id })
                  setSelected(null)
                }}
                onDoubleClick={() => setRenamingProfile(p.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, items: profileMenu(p.id) })
                }}
              >
                <span className={'live-dot' + (p.id === state.activeId ? ' on' : '')} />
                <span className="side-label">{p.name}</span>
                {p.hotkey && <kbd>{p.hotkey}</kbd>}
                <span className="side-count">{p.sources.length}</span>
              </button>
            )
          )}
          <p className="side-hint">Click a profile to switch to it (that's what gets recorded). Right-click to rename, duplicate or delete.</p>
        </div>
      </aside>

      <div className="studio">
        {engine?.error && <div className="banner error">The recording engine isn't running: {engine.error}</div>}
        <div className="preview-wrap">
          <ObsPreview aspect={canvas.width / canvas.height} />
        </div>
        <div className="studio-bottom">
          <section className="panel">
            <div className="panel-head">
              <h2>Sources · {profile.name}</h2>
              <button
                className="btn btn-accent small"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setMenu({
                    x: r.left,
                    y: r.bottom + 4,
                    items: types.map((t) => {
                      const Icon = KIND_ICONS[t.kind]
                      return { label: t.label, icon: <Icon size={15} />, onClick: () => addSource(t) }
                    })
                  })
                }}
              >
                <IconPlus size={14} /> Add
              </button>
            </div>
            <div className="source-list">
              {profile.sources.length === 0 && <div className="panel-empty">This profile is empty. Add a display, game or webcam to start.</div>}
              {profile.sources.map((s, i) => {
                const Icon = KIND_ICONS[s.kind] ?? IconTarget
                return (
                  <div
                    key={s.id}
                    className={'source-row' + (selected === s.id ? ' selected' : '') + (s.visible ? '' : ' hidden-src')}
                    onClick={() => setSelected(s.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setSelected(s.id)
                      setMenu({ x: e.clientX, y: e.clientY, items: sourceMenu(s, i) })
                    }}
                  >
                    <Icon size={15} className="source-icon" />
                    <span className="source-name">{s.name}</span>
                    {s.filters.length > 0 && <span className="tag">{s.filters.length} filter{s.filters.length === 1 ? '' : 's'}</span>}
                    <button className="icon-btn small" title={s.visible ? 'Hide' : 'Show'} onClick={(e) => (e.stopPropagation(), toggleVisible(s))}>
                      {s.visible ? <IconEye size={15} /> : <IconEyeOff size={15} />}
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Mixer</h2>
            </div>
            <Mixer state={state} audioIds={audioIds} selectedId={selected} onChange={onProfiles} onSelect={setSelected} />
          </section>
        </div>
      </div>

      <aside className="inspector">
        {selectedSource ? (
          <SourceInspector
            key={selectedSource.id}
            source={selectedSource}
            state={state}
            hasAudio={audioIds.includes(selectedSource.id)}
            canvas={canvas}
            trackNames={settings.tracks}
            onChange={onProfiles}
          />
        ) : (
          <ProfileSettings state={state} onChange={onProfiles} />
        )}
      </aside>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.run()
            setConfirm(null)
          }}
        />
      )}
    </div>
  )
}

/** Shown in the inspector when no source is selected: the profile's hotkey and the switch animation. */
function ProfileSettings({ state, onChange }: { state: ProfilesState; onChange: (s: ProfilesState) => void }) {
  const profile = activeProfile(state)
  const [transitions, setTransitions] = useState<{ id: string; label: string }[]>([])
  useEffect(() => {
    window.api.profiles.transitionTypes().then(setTransitions)
  }, [])
  return (
    <div className="inspector-body">
      <div className="inspector-heading">{profile.name}</div>
      <div className="inspector-scroll">
        <div className="form-section">Profile</div>
        <div className="prop-row">
          <span className="prop-label">Hotkey to switch to this profile</span>
          <HotkeyInput value={profile.hotkey} onChange={(hotkey) => onChange(mapProfile(state, profile.id, (p) => ({ ...p, hotkey })))} />
        </div>
        <div className="form-section">Switching animation (transition)</div>
        <div className="prop-row">
          <span className="prop-label">Type</span>
          <select
            className="select wide"
            value={state.transition.type}
            onChange={(e) => onChange({ ...state, transition: { ...state.transition, type: e.target.value, settings: {} } })}
          >
            {transitions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {state.transition.type !== 'cut_transition' && (
          <div className="prop-row">
            <span className="prop-label">Duration</span>
            <NumberInput
              value={state.transition.durationMs}
              min={50}
              max={20000}
              step={50}
              suffix="ms"
              onChange={(durationMs) => onChange({ ...state, transition: { ...state.transition, durationMs } })}
            />
          </div>
        )}
        <PropertyForm key={state.transition.type} target={{ kind: 'transition' }} />
        <p className="form-note">Select a source on the left to change its settings, position, audio and filters.</p>
      </div>
    </div>
  )
}
