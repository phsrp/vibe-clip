import { useEffect, useState } from 'react'
import { IconFolder, IconFileText } from '@tabler/icons-react'
import type { AppSettings, CaptureOptions, EngineStatus, OutputResolution } from '@shared/types'
import { Field, HotkeyInput, NumberInput, Section, Select, Toggle } from '../components/Controls'
import { THEMES } from '../theme/themes'
import { ObsImport } from '../components/ObsImport'

interface Props {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  engine: EngineStatus | null
}

const RESOLUTIONS: { value: OutputResolution; label: string }[] = [
  { value: 'native', label: 'Same as display' },
  { value: '2160', label: '2160p (4K)' },
  { value: '1440', label: '1440p' },
  { value: '1080', label: '1080p' },
  { value: '900', label: '900p' },
  { value: '720', label: '720p' }
]

const REPLAY_LENGTHS = [15, 30, 60, 120, 180, 300, 600]

export function SettingsPage({ settings: s, onChange, engine }: Props) {
  const [options, setOptions] = useState<CaptureOptions | null>(null)
  useEffect(() => {
    window.api.capture.options().then(setOptions)
  }, [])

  const encoders = options?.encoders ?? engine?.encoders ?? []
  const best = encoders[0]

  return (
    <div className="page">
      <div className="page-scroll">
        <h1 className="page-title">Settings</h1>

        <Section title="Recording" description="Applies to clips, recordings and the replay buffer.">
          <Field label="Save folder" hint={s.outputFolder}>
            <button
              className="btn"
              onClick={async () => {
                const folder = await window.api.settings.pickFolder()
                if (folder) onChange({ outputFolder: folder })
              }}
            >
              <IconFolder size={15} /> Change
            </button>
          </Field>
          <Field label="Resolution" hint="The size of the saved video. Your display is scaled down if needed.">
            <Select value={s.outputResolution} options={RESOLUTIONS} onChange={(v) => onChange({ outputResolution: v })} />
          </Field>
          <Field label="Frame rate">
            <Select
              value={s.fps}
              options={[30, 60, 120, 144, 165, 240].map((v) => ({ value: v, label: `${v} fps` }))}
              onChange={(v) => onChange({ fps: v })}
            />
          </Field>
          <Field
            label="Encoder"
            hint={best ? `Auto picks ${best.label} on this PC. GPU encoders barely affect game performance.` : 'Detecting…'}
          >
            <Select
              value={s.encoder}
              options={[{ value: 'auto', label: 'Auto (recommended)' }, ...encoders.map((e) => ({ value: e.id, label: e.label }))]}
              onChange={(v) => onChange({ encoder: v })}
            />
          </Field>
          <Field label="Bitrate" hint="Higher means better quality and bigger files. 20–40 Mbps is good for 1080p60 gameplay.">
            <NumberInput value={s.bitrate / 1000} min={1} max={150} suffix="Mbps" onChange={(v) => onChange({ bitrate: v * 1000 })} />
          </Field>
        </Section>

        <Section title="Replay buffer" description="Keeps the last few minutes in memory so you can save a clip after something happens.">
          <Field label="Always on" hint="Starts automatically with the app.">
            <Toggle checked={s.replayEnabled} onChange={(v) => onChange({ replayEnabled: v })} />
          </Field>
          <Field label="Clip length" hint="How much is saved when you press the clip hotkey. Longer uses more memory.">
            <Select
              value={s.replaySeconds}
              options={(REPLAY_LENGTHS.includes(s.replaySeconds) ? REPLAY_LENGTHS : [...REPLAY_LENGTHS, s.replaySeconds].sort((a, b) => a - b)).map(
                (v) => ({ value: v, label: v < 60 ? `${v} seconds` : `${v / 60} minute${v === 60 ? '' : 's'}` })
              )}
              onChange={(v) => onChange({ replaySeconds: v })}
            />
          </Field>
        </Section>

        <Section title="Hotkeys" description="These work everywhere, even while a game is focused. Click a box and press the keys.">
          <Field label="Save clip">
            <HotkeyInput value={s.hotkeys.saveReplay} onChange={(v) => onChange({ hotkeys: { ...s.hotkeys, saveReplay: v } })} />
          </Field>
          <Field label="Start / stop recording">
            <HotkeyInput value={s.hotkeys.toggleRecording} onChange={(v) => onChange({ hotkeys: { ...s.hotkeys, toggleRecording: v } })} />
          </Field>
          <Field label="Screenshot">
            <HotkeyInput value={s.hotkeys.screenshot} onChange={(v) => onChange({ hotkeys: { ...s.hotkeys, screenshot: v } })} />
          </Field>
        </Section>

        <Section title="Appearance">
          <Field label="Theme">
            <Select value={s.theme} options={THEMES.map((t) => ({ value: t.id as string, label: t.name }))} onChange={(v) => onChange({ theme: v })} />
          </Field>
        </Section>

        <Section title="App">
          <Field label="Close to tray" hint="Closing the window keeps the app (and the replay buffer) running in the system tray.">
            <Toggle checked={s.minimizeToTray} onChange={(v) => onChange({ minimizeToTray: v })} />
          </Field>
          <Field label="Log file" hint="Useful when something goes wrong.">
            <button className="btn" onClick={() => window.api.settings.openLogs()}>
              <IconFileText size={15} /> Open logs
            </button>
          </Field>
        </Section>

        <ObsImport onImported={onChange} />
      </div>
    </div>
  )
}
