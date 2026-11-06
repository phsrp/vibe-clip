import { useState } from 'react'
import { IconCheck, IconDownload, IconMinus } from '@tabler/icons-react'
import type { AppSettings, ObsCollectionPreview, ObsProfilePreview } from '@shared/types'
import { Section, Toggle } from './Controls'

/** "Import from OBS": your OBS profile (settings) and scene collections (as profiles). */
export function ObsImport({ onImported }: { onImported: (patch: Partial<AppSettings>) => void }) {
  return (
    <Section
      title="Import from OBS"
      description="Brings over your OBS setup from this PC. Your OBS files are only read, never changed. Check the list before importing."
    >
      <ProfileImport onImported={onImported} />
      <CollectionImport />
    </Section>
  )
}

function Lines({ imported, skipped, heading }: { imported: string[]; skipped: string[]; heading: string }) {
  return (
    <div className="import-list">
      <strong className="import-heading">{heading}</strong>
      {imported.map((line) => (
        <span key={line} className="import-line">
          <IconCheck size={13} className="ok" /> {line}
        </span>
      ))}
      {skipped.length > 0 && <strong className="import-heading">Not imported</strong>}
      {skipped.map((line) => (
        <span key={line} className="import-line">
          <IconMinus size={13} /> {line}
        </span>
      ))}
    </div>
  )
}

function ProfileImport({ onImported }: { onImported: (patch: Partial<AppSettings>) => void }) {
  const [profiles, setProfiles] = useState<ObsProfilePreview[] | null>(null)
  const [selected, setSelected] = useState(0)
  const [done, setDone] = useState<string | null>(null)
  const p = profiles?.[selected]
  return (
    <>
      <div className="field">
        <div className="field-text">
          <span className="field-label">Settings (OBS profile)</span>
          <span className="field-hint">
            {profiles === null
              ? 'Video, encoder, audio tracks, replay buffer, streaming and hotkeys.'
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
        <button
          className="btn"
          onClick={async () => {
            setDone(null)
            setProfiles((await window.api.obs.listProfiles()) ?? [])
            setSelected(0)
          }}
        >
          {profiles === null ? 'Find OBS profiles' : 'Refresh'}
        </button>
      </div>
      {p && (
        <>
          <Lines heading={`Will import from "${p.name}"`} imported={p.imported} skipped={p.skipped} />
          <div className="field">
            <div className="field-text">{done && <span className="field-hint ok">{done}</span>}</div>
            <button
              className="btn btn-accent"
              onClick={() => {
                onImported(p.patch)
                setDone(`Imported "${p.name}". Recording restarted with the new settings.`)
              }}
            >
              <IconDownload size={15} /> Import settings
            </button>
          </div>
        </>
      )}
    </>
  )
}

function CollectionImport() {
  const [cols, setCols] = useState<ObsCollectionPreview[] | null>(null)
  const [selected, setSelected] = useState(0)
  const [replaceAudio, setReplaceAudio] = useState(true)
  const [done, setDone] = useState<string | null>(null)
  const c = cols?.[selected]
  return (
    <>
      <div className="field">
        <div className="field-text">
          <span className="field-label">Scenes (OBS scene collection)</span>
          <span className="field-hint">
            {cols === null
              ? 'Each OBS scene becomes a profile, with its sources, positions, filters and audio-track routing.'
              : cols.length === 0
                ? 'No OBS scene collections found on this PC.'
                : `${cols.length} collection${cols.length === 1 ? '' : 's'} found.`}
          </span>
        </div>
        {cols && cols.length > 1 && (
          <select className="select" value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
            {cols.map((x, i) => (
              <option key={x.file} value={i}>
                {x.name}
              </option>
            ))}
          </select>
        )}
        <button
          className="btn"
          onClick={async () => {
            setDone(null)
            setCols((await window.api.obs.listCollections()) ?? [])
            setSelected(0)
          }}
        >
          {cols === null ? 'Find scene collections' : 'Refresh'}
        </button>
      </div>
      {c && (
        <>
          <Lines heading={`Will import from "${c.name}"`} imported={c.imported} skipped={c.skipped} />
          <div className="field">
            <div className="field-text">
              <span className="field-label">Use OBS's desktop audio and mic setup</span>
              <span className="field-hint">Replaces your always-on audio devices with the ones from OBS.</span>
            </div>
            <Toggle checked={replaceAudio} onChange={setReplaceAudio} />
          </div>
          <div className="field">
            <div className="field-text">{done && <span className="field-hint ok">{done}</span>}</div>
            <button
              className="btn btn-accent"
              onClick={async () => {
                const r = await window.api.obs.importCollection(c.file, replaceAudio)
                if (r) setDone(`Added ${c.profiles.length} profile${c.profiles.length === 1 ? '' : 's'}. Find them on the Sources page.`)
              }}
            >
              <IconDownload size={15} /> Import as profiles
            </button>
          </div>
        </>
      )}
    </>
  )
}
