import { useState } from 'react'
import { IconCheck, IconDownload, IconMinus } from '@tabler/icons-react'
import type { AppSettings, ObsProfilePreview } from '@shared/types'
import { Section } from './Controls'

/** "Import from OBS": finds your OBS profiles, shows what would change, and applies it. */
export function ObsImport({ onImported }: { onImported: (patch: Partial<AppSettings>) => void }) {
  const [profiles, setProfiles] = useState<ObsProfilePreview[] | null>(null)
  const [selected, setSelected] = useState(0)
  const [done, setDone] = useState<string | null>(null)

  const find = async () => {
    setDone(null)
    setProfiles((await window.api.obs.listProfiles()) ?? [])
    setSelected(0)
  }
  const p = profiles?.[selected]

  return (
    <Section
      title="Import from OBS"
      description="Copies your OBS profile's recording settings: save folder, resolution, frame rate, encoder and its exact settings, bitrate, replay buffer and hotkeys. Your OBS files are only read, never changed."
    >
      <div className="field">
        <div className="field-text">
          <span className="field-label">OBS profile</span>
          <span className="field-hint">
            {profiles === null
              ? 'Looks in %APPDATA%\\obs-studio on this PC.'
              : profiles.length === 0
                ? 'No OBS profiles found on this PC.'
                : `${profiles.length} profile${profiles.length === 1 ? '' : 's'} found.`}
          </span>
        </div>
        {profiles && profiles.length > 1 && (
          <select className="select" value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
            {profiles.map((x, i) => (
              <option key={x.folder} value={i}>
                {x.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn" onClick={find}>
          {profiles === null ? 'Find OBS profiles' : 'Refresh'}
        </button>
      </div>
      {p && (
        <>
          <div className="import-list">
            <strong className="import-heading">Will import from "{p.name}"</strong>
            {p.imported.map((line) => (
              <span key={line} className="import-line">
                <IconCheck size={13} className="ok" /> {line}
              </span>
            ))}
            {p.skipped.length > 0 && <strong className="import-heading">Not imported</strong>}
            {p.skipped.map((line) => (
              <span key={line} className="import-line">
                <IconMinus size={13} /> {line}
              </span>
            ))}
          </div>
          <div className="field">
            <div className="field-text">
              {done && <span className="field-hint ok">{done}</span>}
            </div>
            <button
              className="btn btn-accent"
              onClick={() => {
                onImported(p.patch)
                setDone(`Imported "${p.name}". The replay buffer restarted with the new settings.`)
              }}
            >
              <IconDownload size={15} /> Import these settings
            </button>
          </div>
        </>
      )}
    </Section>
  )
}
