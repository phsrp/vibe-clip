import { useEffect, useState } from 'react'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import type { AppSettings, CaptureOptions, EngineStatus, GameDefinition } from '@shared/types'
import { Field, Section, Select, Toggle } from '../components/Controls'

interface Props {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  engine: EngineStatus | null
}

export function SourcesPage({ settings: s, onChange, engine }: Props) {
  const [options, setOptions] = useState<CaptureOptions | null>(null)
  const [builtIn, setBuiltIn] = useState<GameDefinition[]>([])

  useEffect(() => {
    window.api.capture.options().then(setOptions)
    window.api.games.builtIn().then(setBuiltIn)
  }, [])

  const devices = (list: { id: string; name: string }[] | undefined) =>
    (list?.length ? list : [{ id: 'default', name: 'Default' }]).map((d) => ({ value: d.id, label: d.name }))

  return (
    <div className="page">
      <div className="page-scroll">
        <h1 className="page-title">Sources</h1>
        {engine?.error && <div className="banner error">The recording engine isn't running: {engine.error}</div>}

        <Section title="Video" description="What gets recorded. Profiles with several sources come in a later version.">
          <Field
            label="Capture"
            hint={
              s.captureMode === 'auto'
                ? 'Captures the game directly when a known game is running (best quality, works in fullscreen). Otherwise captures your display.'
                : 'Always captures the whole display.'
            }
          >
            <Select
              value={s.captureMode}
              options={[
                { value: 'auto', label: 'Game when detected, else display' },
                { value: 'display', label: 'Display only' }
              ]}
              onChange={(v) => onChange({ captureMode: v })}
            />
          </Field>
          <Field label="Display">
            <Select
              value={s.monitorId}
              options={[{ value: '', label: 'Primary display' }, ...(options?.monitors ?? []).map((m) => ({ value: m.id, label: m.name }))]}
              onChange={(v) => onChange({ monitorId: v })}
            />
          </Field>
        </Section>

        <Section title="Audio" description="Saved as separate tracks too: track 1 is everything mixed, track 2 is desktop audio, track 3 is your mic.">
          <Field label="Desktop audio" hint="Game sound, music, voice chat: everything you hear.">
            <span className="row">
              <Select value={s.desktopAudioDevice} options={devices(options?.desktopAudioDevices)} onChange={(v) => onChange({ desktopAudioDevice: v })} />
              <Toggle checked={s.desktopAudio} onChange={(v) => onChange({ desktopAudio: v })} />
            </span>
          </Field>
          <Field label="Microphone">
            <span className="row">
              <Select value={s.micDevice} options={devices(options?.micDevices)} onChange={(v) => onChange({ micDevice: v })} />
              <Toggle checked={s.mic} onChange={(v) => onChange({ mic: v })} />
            </span>
          </Field>
        </Section>

        <Section title="Games" description="Clips are tagged with the game that was running. Add a game by its .exe name (find it in Task Manager → Details).">
          {builtIn.map((g) => (
            <Field key={g.id} label={g.name} hint={g.processes.join(', ')}>
              <span className="muted small">Built in</span>
            </Field>
          ))}
          {s.customGames.map((g) => (
            <Field key={g.id} label={g.name} hint={g.processes.join(', ')}>
              <button
                className="icon-btn"
                title="Remove"
                onClick={() => onChange({ customGames: s.customGames.filter((x) => x.id !== g.id) })}
              >
                <IconTrash size={16} />
              </button>
            </Field>
          ))}
          <AddGame
            onAdd={(g) => {
              if ([...builtIn, ...s.customGames].some((x) => x.id === g.id)) return
              onChange({ customGames: [...s.customGames, g] })
            }}
          />
        </Section>
      </div>
    </div>
  )
}

function AddGame({ onAdd }: { onAdd: (g: GameDefinition) => void }) {
  const [name, setName] = useState('')
  const [exe, setExe] = useState('')
  const valid = name.trim() && exe.trim()
  const add = () => {
    if (!valid) return
    const process = exe.trim().toLowerCase().endsWith('.exe') ? exe.trim() : exe.trim() + '.exe'
    const id = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    onAdd({ id: id || process, name: name.trim(), processes: [process] })
    setName('')
    setExe('')
  }
  return (
    <div className="field add-game">
      <input className="text-input" placeholder="Game name (e.g. Valorant)" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        className="text-input"
        placeholder="Process (e.g. VALORANT-Win64-Shipping.exe)"
        value={exe}
        onChange={(e) => setExe(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
      />
      <button className="btn" disabled={!valid} onClick={add}>
        <IconPlus size={15} /> Add
      </button>
    </div>
  )
}
