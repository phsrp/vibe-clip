import { useEffect, useRef, useState } from 'react'
import { IconFileText, IconFolder, IconKey, IconPlus, IconTrash } from '@tabler/icons-react'
import type { AppSettings, CaptureOptions, EngineStatus, GameDefinition, Hotkeys } from '@shared/types'
import { Field, HotkeyInput, NumberInput, Section, Select, Toggle } from '../components/Controls'
import { PropertyForm } from '../components/PropertyForm'
import { THEMES } from '../theme/themes'
import { ObsImport } from '../components/ObsImport'

interface Props {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  engine: EngineStatus | null
}

const SECTIONS = [
  ['general', 'General'],
  ['video', 'Video'],
  ['recording', 'Recording'],
  ['replay', 'Replay buffer'],
  ['audio', 'Audio'],
  ['streaming', 'Streaming'],
  ['advanced', 'Advanced'],
  ['hotkeys', 'Hotkeys'],
  ['games', 'Games'],
  ['import', 'Import from OBS']
] as const

const CANVAS = ['auto', '3840x2160', '2560x1440', '1920x1080', '1600x900', '1280x720', '1080x1920']
const OUTPUTS = ['native', '2160', '1440', '1080', '900', '720', '1080x1920', '720x1280']
const FPS: { label: string; num: number; den: number }[] = [
  { label: '24', num: 24, den: 1 },
  { label: '25', num: 25, den: 1 },
  { label: '29.97', num: 30000, den: 1001 },
  { label: '30', num: 30, den: 1 },
  { label: '48', num: 48, den: 1 },
  { label: '50', num: 50, den: 1 },
  { label: '59.94', num: 60000, den: 1001 },
  { label: '60', num: 60, den: 1 },
  { label: '90', num: 90, den: 1 },
  { label: '120', num: 120, den: 1 },
  { label: '144', num: 144, den: 1 },
  { label: '165', num: 165, den: 1 },
  { label: '240', num: 240, den: 1 }
]
const REPLAY = [15, 30, 60, 120, 180, 300, 600, 900, 1200]

function sizeLabel(v: string): string {
  if (v === 'auto') return 'Same as your main display'
  if (v === 'native') return 'Same as canvas (no scaling)'
  if (/^\d+$/.test(v)) return `${v}p`
  const [w, h] = v.split('x')
  return `${w}×${h}${Number(h) > Number(w) ? ' (vertical)' : ''}`
}

/** A size picker with presets plus "Custom…" for any WxH. */
function SizeSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const [custom, setCustom] = useState(!options.includes(value))
  const [text, setText] = useState(options.includes(value) ? '' : value)
  return (
    <span className="row">
      <select
        className="select"
        value={custom ? '__custom' : value}
        onChange={(e) => {
          if (e.target.value === '__custom') return setCustom(true)
          setCustom(false)
          onChange(e.target.value)
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {sizeLabel(o)}
          </option>
        ))}
        <option value="__custom">Custom…</option>
      </select>
      {custom && (
        <input
          className="text-input small-input"
          placeholder="1920x1080"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => /^\d{2,5}x\d{2,5}$/i.test(text.trim()) && onChange(text.trim().toLowerCase())}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )}
    </span>
  )
}

function TrackPicker({ value, names, onChange }: { value: number; names: AppSettings['tracks']; onChange: (v: number) => void }) {
  return (
    <div className="track-row">
      {names.map((t, i) => {
        const bit = 1 << i
        return (
          <label key={i} className={'track-chip' + (value & bit ? ' on' : '')} title={t.name}>
            <input type="checkbox" checked={!!(value & bit)} onChange={(e) => onChange(e.target.checked ? value | bit : value & ~bit || 1)} />
            <b>{i + 1}</b>
            <span>{t.name}</span>
          </label>
        )
      })}
    </div>
  )
}

export function SettingsPage({ settings: s, onChange, engine }: Props) {
  const [options, setOptions] = useState<CaptureOptions | null>(null)
  const [monitors, setMonitors] = useState<{ id: string; name: string }[]>([])
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [builtIn, setBuiltIn] = useState<GameDefinition[]>([])
  const [streamKey, setStreamKey] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.capture.options().then((o) => o && setOptions(o))
    window.api.settings.monitoringDevices().then(setMonitors)
    window.api.settings.hotkeyLabels().then(setLabels)
    window.api.games.builtIn().then(setBuiltIn)
  }, [])

  const encoders = options?.encoders ?? engine?.encoders ?? []
  const best = encoders[0]
  const fpsValue = FPS.find((f) => f.num === s.fps && f.den === (s.fpsDen || 1))?.label ?? `${s.fps}/${s.fpsDen}`
  const st = s.stream

  return (
    <div className="page">
      <div className="settings-nav">
        {SECTIONS.map(([id, label]) => (
          <button key={id} className="nav-chip" onClick={() => document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            {label}
          </button>
        ))}
      </div>
      <div className="page-scroll" ref={scrollRef}>
        <h1 className="page-title">Settings</h1>

        <div id="set-general">
          <Section title="General">
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
            <Field label="Theme">
              <Select value={s.theme} options={THEMES.map((t) => ({ value: t.id as string, label: t.name }))} onChange={(v) => onChange({ theme: v })} />
            </Field>
            <Field label="Close to tray" hint="Closing the window keeps the app (and the replay buffer) running in the system tray.">
              <Toggle checked={s.minimizeToTray} onChange={(v) => onChange({ minimizeToTray: v })} />
            </Field>
            <Field label="Start with Windows" hint="Starts hidden in the tray, with the replay buffer on.">
              <Toggle checked={s.startWithWindows} onChange={(v) => onChange({ startWithWindows: v })} />
            </Field>
            <Field label="Log file" hint="Useful when something goes wrong.">
              <button className="btn" onClick={() => window.api.settings.openLogs()}>
                <IconFileText size={15} /> Open logs
              </button>
            </Field>
          </Section>
        </div>

        <div id="set-video">
          <Section title="Video" description="The canvas is the space your profiles are laid out on. The output is the size that gets saved and streamed.">
            <Field label="Canvas (base) resolution">
              <SizeSelect value={s.baseResolution} options={CANVAS} onChange={(v) => onChange({ baseResolution: v })} />
            </Field>
            <Field label="Output (scaled) resolution" hint="Smaller output = smaller files and less GPU work.">
              <SizeSelect value={String(s.outputResolution)} options={OUTPUTS} onChange={(v) => onChange({ outputResolution: v })} />
            </Field>
            <Field label="Downscale filter" hint="How the picture is shrunk. Lanczos is sharpest, bilinear is fastest.">
              <Select
                value={s.downscaleFilter}
                options={[
                  { value: 'bilinear', label: 'Bilinear (fastest)' },
                  { value: 'area', label: 'Area' },
                  { value: 'bicubic', label: 'Bicubic (sharpened)' },
                  { value: 'lanczos', label: 'Lanczos (sharpest)' }
                ]}
                onChange={(v) => onChange({ downscaleFilter: v })}
              />
            </Field>
            <Field label="Frame rate (FPS)">
              <Select
                value={fpsValue}
                options={FPS.map((f) => ({ value: f.label, label: `${f.label} fps` }))}
                onChange={(v) => {
                  const f = FPS.find((x) => x.label === v)
                  if (f) onChange({ fps: f.num, fpsDen: f.den })
                }}
              />
            </Field>
          </Section>
        </div>

        <div id="set-recording">
          <Section title="Recording" description="Used for recordings and clips (they share one encoder, like OBS's Advanced output mode).">
            <Field label="Encoder" hint={best ? `Auto picks ${best.label} on this PC. GPU encoders barely affect game performance.` : 'Detecting…'}>
              <Select
                value={s.encoder}
                options={[{ value: 'auto', label: 'Auto (recommended)' }, ...encoders.map((e) => ({ value: e.id, label: e.label }))]}
                onChange={(v) => onChange({ encoder: v })}
              />
            </Field>
            <div className="field column">
              <div className="field-text">
                <span className="field-label">Encoder settings</span>
                <span className="field-hint">Every option the encoder offers (rate control, bitrate, preset, profile, B-frames…).</span>
              </div>
              <div className="embedded-form">
                <PropertyForm key={`rec-${s.encoder}`} target={{ kind: 'encoder', encoderId: s.encoder, use: 'record' }} />
              </div>
            </div>
            <Field label="Recording format" hint="Recordings are written as MKV (safe if the PC crashes) and converted when they finish.">
              <Select
                value={s.recordingFormat}
                options={[
                  { value: 'mp4', label: 'MP4 (plays everywhere)' },
                  { value: 'mov', label: 'MOV' },
                  { value: 'mkv', label: 'MKV (keep as recorded)' }
                ]}
                onChange={(v) => onChange({ recordingFormat: v })}
              />
            </Field>
            <Field label="Audio tracks in recordings" hint="Which of the 6 tracks are saved. Choose what goes to each track in the Sources page mixer.">
              <TrackPicker value={s.recordTracks} names={s.tracks} onChange={(v) => onChange({ recordTracks: v })} />
            </Field>
            <Field label="File name format" hint="OBS codes: %CCYY year, %MM month, %DD day, %hh hour, %mm minute, %ss second.">
              <input
                className="text-input fixed"
                defaultValue={s.filenameFormat}
                onBlur={(e) => e.target.value.trim() && e.target.value !== s.filenameFormat && onChange({ filenameFormat: e.target.value.trim() })}
              />
            </Field>
            <Field label="Split recordings" hint="Start a new file every so often (handy for very long sessions).">
              <span className="row">
                {s.splitRecording.enabled && (
                  <>
                    <Select
                      value={s.splitRecording.type}
                      options={[
                        { value: 'time', label: 'Every' },
                        { value: 'size', label: 'At size' }
                      ]}
                      onChange={(type) => onChange({ splitRecording: { ...s.splitRecording, type } })}
                    />
                    {s.splitRecording.type === 'time' ? (
                      <NumberInput value={s.splitRecording.minutes} min={1} max={600} suffix="min" onChange={(minutes) => onChange({ splitRecording: { ...s.splitRecording, minutes } })} />
                    ) : (
                      <NumberInput value={s.splitRecording.megabytes} min={50} max={100000} step={50} suffix="MB" onChange={(megabytes) => onChange({ splitRecording: { ...s.splitRecording, megabytes } })} />
                    )}
                  </>
                )}
                <Toggle checked={s.splitRecording.enabled} onChange={(enabled) => onChange({ splitRecording: { ...s.splitRecording, enabled } })} />
              </span>
            </Field>
          </Section>
        </div>

        <div id="set-replay">
          <Section title="Replay buffer" description="Keeps the last few minutes in memory so you can save a clip after something happens.">
            <Field label="Always on" hint="Starts automatically with the app.">
              <Toggle checked={s.replayEnabled} onChange={(v) => onChange({ replayEnabled: v })} />
            </Field>
            <Field label="Clip length" hint="How much is saved when you press the clip hotkey. Longer uses more memory.">
              <Select
                value={s.replaySeconds}
                options={(REPLAY.includes(s.replaySeconds) ? REPLAY : [...REPLAY, s.replaySeconds].sort((a, b) => a - b)).map((v) => ({
                  value: v,
                  label: v < 60 ? `${v} seconds` : `${v / 60} minute${v === 60 ? '' : 's'}`
                }))}
                onChange={(v) => onChange({ replaySeconds: v })}
              />
            </Field>
            <Field label="Audio tracks in clips">
              <TrackPicker value={s.replayTracks} names={s.tracks} onChange={(v) => onChange({ replayTracks: v })} />
            </Field>
          </Section>
        </div>

        <div id="set-audio">
          <Section title="Audio" description="Devices and volumes are in the Sources page mixer.">
            <Field label="Sample rate">
              <Select
                value={s.sampleRate}
                options={[
                  { value: 48000, label: '48 kHz' },
                  { value: 44100, label: '44.1 kHz' }
                ]}
                onChange={(v) => onChange({ sampleRate: v as 44100 | 48000 })}
              />
            </Field>
            <Field label="Channels">
              <Select
                value={s.channels}
                options={(['mono', 'stereo', '2.1', '4.0', '4.1', '5.1', '7.1'] as const).map((c) => ({ value: c, label: c === 'mono' ? 'Mono' : c === 'stereo' ? 'Stereo' : c }))}
                onChange={(v) => onChange({ channels: v })}
              />
            </Field>
            <Field label="Monitoring device" hint="Where sources set to “listen” play.">
              <Select
                value={s.monitoringDevice}
                options={(monitors.length ? monitors : [{ id: 'default', name: 'Default' }]).map((m) => ({ value: m.id, label: m.name }))}
                onChange={(v) => onChange({ monitoringDevice: v })}
              />
            </Field>
            <Field label="Stop Windows lowering other sounds" hint="Windows can turn other apps down while a mic is in use (ducking).">
              <Toggle checked={s.disableDucking} onChange={(v) => onChange({ disableDucking: v })} />
            </Field>
            <div className="field column">
              <div className="field-text">
                <span className="field-label">Audio tracks</span>
                <span className="field-hint">Names and quality of the 6 tracks.</span>
              </div>
              <div className="tracks-table">
                {s.tracks.map((t, i) => (
                  <div key={i} className="track-line">
                    <b>{i + 1}</b>
                    <input
                      className="text-input"
                      defaultValue={t.name}
                      onBlur={(e) => e.target.value !== t.name && onChange({ tracks: s.tracks.map((x, j) => (j === i ? { ...x, name: e.target.value || `Track ${i + 1}` } : x)) })}
                    />
                    <select
                      className="select"
                      value={t.bitrate}
                      onChange={(e) => onChange({ tracks: s.tracks.map((x, j) => (j === i ? { ...x, bitrate: Number(e.target.value) } : x)) })}
                    >
                      {[64, 96, 128, 160, 192, 224, 256, 320].map((b) => (
                        <option key={b} value={b}>
                          {b} kbps
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        </div>

        <div id="set-streaming">
          <Section title="Streaming" description="Go live from the button at the top of the Clips page, the tray menu, or a hotkey.">
            <Field label="Service type">
              <Select
                value={st.serviceType}
                options={[
                  { value: 'rtmp_common', label: 'A streaming platform (Twitch, YouTube, Kick…)' },
                  { value: 'rtmp_custom', label: 'Custom RTMP server' },
                  { value: 'whip_custom', label: 'WHIP (WebRTC)' }
                ]}
                onChange={(serviceType) => onChange({ stream: { ...st, serviceType, server: serviceType === 'rtmp_common' ? 'auto' : '' } })}
              />
            </Field>
            {st.serviceType === 'rtmp_common' ? (
              <div className="field column">
                <div className="embedded-form">
                  <PropertyForm key={`svc-${st.serviceType}`} target={{ kind: 'service', serviceType: st.serviceType }} />
                </div>
              </div>
            ) : (
              <Field label="Server">
                <input
                  className="text-input fixed"
                  placeholder={st.serviceType === 'whip_custom' ? 'https://…/whip' : 'rtmp://…'}
                  defaultValue={st.server}
                  onBlur={(e) => e.target.value !== st.server && onChange({ stream: { ...st, server: e.target.value.trim() } })}
                />
              </Field>
            )}
            <Field
              label={st.serviceType === 'whip_custom' ? 'Bearer token' : 'Stream key'}
              hint={st.keyEncrypted ? 'A key is saved (encrypted with Windows). Type a new one to replace it.' : 'Find it in your platform’s creator dashboard. Never share it.'}
            >
              <span className="row">
                <input
                  className="text-input fixed"
                  type="password"
                  placeholder={st.keyEncrypted ? '•••••••• (saved)' : 'Paste your stream key'}
                  value={streamKey}
                  onChange={(e) => {
                    setStreamKey(e.target.value)
                    setKeySaved(false)
                  }}
                />
                <button
                  className="btn"
                  disabled={!streamKey}
                  onClick={async () => {
                    await window.api.stream.setKey(streamKey)
                    setStreamKey('')
                    setKeySaved(true)
                    const fresh = await window.api.settings.get()
                    onChange({ stream: fresh.stream })
                  }}
                >
                  <IconKey size={14} /> {keySaved ? 'Saved' : 'Save key'}
                </button>
              </span>
            </Field>
            <Field label="Stream encoder" hint="Streams use their own encoder so they can have a lower bitrate than recordings.">
              <Select
                value={st.encoder}
                options={[{ value: 'same', label: 'Same type as recording' }, ...encoders.map((e) => ({ value: e.id, label: e.label }))]}
                onChange={(encoder) => onChange({ stream: { ...st, encoder, encoderOverrides: null } })}
              />
            </Field>
            <div className="field column">
              <div className="field-text">
                <span className="field-label">Stream encoder settings</span>
                <span className="field-hint">Twitch recommends CBR at 6000 kbps or lower.</span>
              </div>
              <div className="embedded-form">
                <PropertyForm key={`str-${st.encoder}-${s.encoder}`} target={{ kind: 'encoder', encoderId: st.encoder === 'same' ? s.encoder : st.encoder, use: 'stream' }} />
              </div>
            </div>
            <Field label="Audio track sent to the stream">
              <Select value={st.track} options={s.tracks.map((t, i) => ({ value: i + 1, label: `${i + 1}: ${t.name}` }))} onChange={(track) => onChange({ stream: { ...st, track } })} />
            </Field>
            <Field label="Scale the stream down" hint="Stream at a smaller size than you record.">
              <Select
                value={st.rescale}
                options={[{ value: 'none', label: 'No (same as output)' }, ...['1440', '1080', '936', '900', '720', '480'].map((h) => ({ value: h, label: `${h}p` }))]}
                onChange={(rescale) => onChange({ stream: { ...st, rescale } })}
              />
            </Field>
            <Field label="Reconnect automatically" hint="If the connection drops, try again.">
              <span className="row">
                {st.reconnect.enabled && (
                  <>
                    <NumberInput value={st.reconnect.delaySec} min={1} max={60} suffix="s wait" onChange={(delaySec) => onChange({ stream: { ...st, reconnect: { ...st.reconnect, delaySec } } })} />
                    <NumberInput value={st.reconnect.maxRetries} min={1} max={10000} suffix="tries" onChange={(maxRetries) => onChange({ stream: { ...st, reconnect: { ...st.reconnect, maxRetries } } })} />
                  </>
                )}
                <Toggle checked={st.reconnect.enabled} onChange={(enabled) => onChange({ stream: { ...st, reconnect: { ...st.reconnect, enabled } } })} />
              </span>
            </Field>
            <Field label="Stream delay" hint="Delays what viewers see (stops stream sniping). 0 = off.">
              <NumberInput value={st.delaySec} min={0} max={1800} suffix="s" onChange={(delaySec) => onChange({ stream: { ...st, delaySec } })} />
            </Field>
          </Section>
        </div>

        <div id="set-advanced">
          <Section title="Advanced" description="Leave these alone unless you know you need them.">
            <Field label="Color format">
              <Select
                value={s.colorFormat}
                options={[
                  { value: 'NV12', label: 'NV12 (default)' },
                  { value: 'I420', label: 'I420' },
                  { value: 'I444', label: 'I444 (full color, large files)' },
                  { value: 'BGRA', label: 'BGRA (8-bit RGB)' }
                ]}
                onChange={(v) => onChange({ colorFormat: v })}
              />
            </Field>
            <Field label="Color space">
              <Select
                value={s.colorSpace}
                options={[
                  { value: '709', label: 'Rec. 709 (default)' },
                  { value: '601', label: 'Rec. 601' },
                  { value: 'sRGB', label: 'sRGB' },
                  { value: '2100PQ', label: 'Rec. 2100 (PQ, HDR)' },
                  { value: '2100HLG', label: 'Rec. 2100 (HLG, HDR)' }
                ]}
                onChange={(v) => onChange({ colorSpace: v })}
              />
            </Field>
            <Field label="Color range">
              <Select
                value={s.colorRange}
                options={[
                  { value: 'partial', label: 'Limited (default)' },
                  { value: 'full', label: 'Full' }
                ]}
                onChange={(v) => onChange({ colorRange: v })}
              />
            </Field>
          </Section>
        </div>

        <div id="set-hotkeys">
          <Section title="Hotkeys" description="These work everywhere, even while a game is focused. Click a box and press the keys. Profile hotkeys are set on the Sources page.">
            {(Object.keys(s.hotkeys) as (keyof Hotkeys)[]).map((k) => (
              <Field key={k} label={labels[k] ?? k}>
                <HotkeyInput value={s.hotkeys[k]} onChange={(v) => onChange({ hotkeys: { ...s.hotkeys, [k]: v } })} />
              </Field>
            ))}
          </Section>
        </div>

        <div id="set-games">
          <Section title="Games" description="Clips are tagged with the game that was running, and “Auto game capture” follows it. Add a game by its .exe name (Task Manager → Details).">
            {builtIn.map((g) => (
              <Field key={g.id} label={g.name} hint={g.processes.join(', ')}>
                <span className="muted small">Built in</span>
              </Field>
            ))}
            {s.customGames.map((g) => (
              <Field key={g.id} label={g.name} hint={g.processes.join(', ')}>
                <button className="icon-btn" title="Remove" onClick={() => onChange({ customGames: s.customGames.filter((x) => x.id !== g.id) })}>
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

        <div id="set-import">
          <ObsImport onImported={onChange} />
        </div>
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
