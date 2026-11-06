import { useEffect, useRef, useState } from 'react'
import { IconMicrophone, IconPlus, IconSettings, IconVolume, IconVolume3 } from '@tabler/icons-react'
import type { ProfileSource, ProfilesState, SourceKind } from '@shared/types'
import { activeProfile, mapSource, posToVol, uniqueName, volToDb, volToPos } from '../lib/profiles'
import { ContextMenu } from './ContextMenu'

interface Props {
  state: ProfilesState
  audioIds: string[]
  selectedId: string | null
  onChange: (next: ProfilesState) => void
  onSelect: (id: string) => void
}

/** Audio mixer: one strip per audio source with a live level meter, volume fader and mute. */
export function Mixer({ state, audioIds, selectedId, onChange, onSelect }: Props) {
  const meters = useRef(new Map<string, HTMLDivElement>())
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const channels: (ProfileSource & { global: boolean })[] = [
    ...state.globalAudio.map((s) => ({ ...s, global: true })),
    ...activeProfile(state)
      .sources.filter((s) => audioIds.includes(s.id))
      .map((s) => ({ ...s, global: false }))
  ]

  useEffect(
    () =>
      window.api.mixer.onLevels((levels) => {
        for (const [id, el] of meters.current) {
          const peaks = levels[id] ?? []
          const db = peaks.length ? Math.max(...peaks) : -Infinity
          const pct = Number.isFinite(db) ? Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) : 0
          el.style.setProperty('--level', `${pct}%`)
        }
      }),
    []
  )

  const addGlobal = async (kind: SourceKind, label: string) => {
    const src = await window.api.profiles.newSource(kind, uniqueName(label, state.globalAudio.map((s) => s.name)))
    if (!src) return
    if (state.globalAudio.length >= 6) return
    onChange({ ...state, globalAudio: [...state.globalAudio, src] })
    onSelect(src.id)
  }

  return (
    <div className="mixer">
      {channels.length === 0 && <div className="panel-empty">No audio sources.</div>}
      {channels.map((c) => {
        const db = volToDb(c.audio.volume)
        return (
          <div key={c.id} className={'strip' + (c.audio.muted ? ' muted' : '') + (selectedId === c.id ? ' selected' : '')}>
            <div className="strip-head">
              <button className="strip-name" onClick={() => onSelect(c.id)} title="Show settings">
                {c.kind === 'mic' ? <IconMicrophone size={14} /> : <IconVolume size={14} />}
                <span>{c.name}</span>
                {c.global && <span className="tag">Always on</span>}
              </button>
              <span className="strip-db">{Number.isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB'}</span>
              <button
                className={'icon-btn small' + (c.audio.muted ? ' danger' : '')}
                title={c.audio.muted ? 'Unmute' : 'Mute'}
                onClick={() => onChange(mapSource(state, c.id, (s) => ({ ...s, audio: { ...s.audio, muted: !s.audio.muted } })))}
              >
                {c.audio.muted ? <IconVolume3 size={15} /> : <IconVolume size={15} />}
              </button>
              <button className="icon-btn small" title="Audio settings" onClick={() => onSelect(c.id)}>
                <IconSettings size={15} />
              </button>
            </div>
            <div
              className="meter"
              ref={(el) => {
                if (el) meters.current.set(c.id, el)
                else meters.current.delete(c.id)
              }}
            >
              <div className="meter-fill" />
            </div>
            <input
              type="range"
              className="range fader"
              min={0}
              max={1}
              step={0.001}
              value={volToPos(c.audio.volume)}
              onChange={(e) => onChange(mapSource(state, c.id, (s) => ({ ...s, audio: { ...s.audio, volume: posToVol(Number(e.target.value)) } })))}
              onDoubleClick={() => onChange(mapSource(state, c.id, (s) => ({ ...s, audio: { ...s.audio, volume: 1 } })))}
              title="Volume (double-click resets to 0 dB)"
            />
          </div>
        )
      })}
      <button
        className="btn ghost add-audio"
        disabled={state.globalAudio.length >= 6}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu({ x: r.left, y: r.bottom + 4 })
        }}
      >
        <IconPlus size={14} /> Add always-on audio device
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Microphone / input', onClick: () => addGlobal('mic', 'Microphone') },
            { label: 'Desktop audio / output', onClick: () => addGlobal('desktop_audio', 'Desktop audio') },
            { label: 'App audio (one program)', onClick: () => addGlobal('app_audio', 'App audio') }
          ]}
        />
      )}
    </div>
  )
}
