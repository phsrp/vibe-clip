import { useEffect, useRef, useState } from 'react'
import { IconDownload } from '@tabler/icons-react'
import type { AppSettings, CaptureStatus, Clip, EngineStatus, LibrarySnapshot, ProfilesState, UpdateStatus } from '@shared/types'
import { UpdateDialog } from './components/UpdateDialog'
import { IconRail, type Page } from './components/IconRail'
import { Toasts } from './components/Toasts'
import { ClipsPage } from './pages/ClipsPage'
import { SourcesPage } from './pages/SourcesPage'
import { SettingsPage } from './pages/SettingsPage'
import { EditorPage } from './pages/EditorPage'
import { applyTheme } from './theme/themes'

const EMPTY_LIBRARY: LibrarySnapshot = { clips: [], games: [], collections: [] }
const IDLE: CaptureStatus = {
  replayActive: false,
  replaySeconds: 0,
  recording: false,
  recordingSince: null,
  game: null,
  gameName: null,
  stream: { live: false, starting: false, since: null, kbps: 0, droppedFrames: 0, totalFrames: 0 },
  activeProfile: null
}

export default function App() {
  const [page, setPage] = useState<Page>('clips')
  const [library, setLibrary] = useState<LibrarySnapshot>(EMPTY_LIBRARY)
  const [capture, setCapture] = useState<CaptureStatus>(IDLE)
  const [engine, setEngine] = useState<EngineStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [profiles, setProfiles] = useState<ProfilesState | null>(null)
  const [editing, setEditing] = useState<Clip | null>(null)
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })
  const [updateHidden, setUpdateHidden] = useState(false)
  const [version, setVersion] = useState('')
  // Ignore the echo of our own profile changes so typing/dragging doesn't jump back.
  const pendingProfiles = useRef(0)

  useEffect(() => {
    window.api.library.get().then((l) => l && setLibrary(l))
    window.api.capture.status().then(setCapture)
    window.api.engineStatus().then(setEngine)
    window.api.profiles.get().then(setProfiles)
    window.api.appVersion().then(setVersion)
    window.api.update.status().then(setUpdate)
    window.api.settings.get().then((s) => {
      setSettings(s)
      applyTheme(s.theme)
    })
    const offs = [
      window.api.library.onChange(setLibrary),
      window.api.capture.onStatus(setCapture),
      window.api.settings.onChange(setSettings),
      window.api.update.onStatus((s) => {
        setUpdate(s)
        if (s.state === 'available' || s.state === 'ready' || s.state === 'error') setUpdateHidden(false)
      }),
      window.api.profiles.onChange((p) => {
        if (pendingProfiles.current > 0) return
        setProfiles(p)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const updateSettings = async (patch: Partial<AppSettings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    const next = await window.api.settings.set(patch)
    if (next) setSettings(next)
    if (patch.theme) applyTheme(patch.theme)
  }

  const updateProfiles = async (next: ProfilesState) => {
    setProfiles(next)
    pendingProfiles.current++
    try {
      const saved = await window.api.profiles.set(next)
      if (saved && pendingProfiles.current === 1) setProfiles(saved)
    } finally {
      pendingProfiles.current--
    }
  }

  const showUpdatePopup =
    !updateHidden && (['available', 'downloading', 'ready'].includes(update.state) || (update.state === 'error' && update.during === 'download'))
  const updatePending = update.state === 'snoozed' || (updateHidden && ['available', 'downloading', 'ready'].includes(update.state))

  const openEditor = (clip: Clip) => {
    setEditing(clip)
    setPage('editor')
  }

  return (
    <div className="app">
      <div className="titlebar">
        <span className="titlebar-name">Vibe Clip</span>
        {updatePending && (
          <button
            className="upd-badge"
            title="A new version is available"
            onClick={() => {
              setUpdateHidden(false)
              if (update.state === 'snoozed') window.api.update.check()
            }}
          >
            <IconDownload size={12} /> {update.state === 'ready' ? `Restart to update to ${update.version}` : update.state === 'downloading' ? `Downloading ${update.percent ?? 0}%` : `Update ${update.version}`}
          </button>
        )}
      </div>
      <IconRail page={page} onChange={setPage} showEditor={!!editing} />
      {page === 'clips' && (
        <ClipsPage library={library} capture={capture} engineError={engine?.error ?? null} onEdit={openEditor} />
      )}
      {page === 'sources' && profiles && settings && (
        <SourcesPage profiles={profiles} onProfiles={updateProfiles} settings={settings} engine={engine} />
      )}
      {page === 'settings' && settings && <SettingsPage settings={settings} onChange={updateSettings} engine={engine} update={update} version={version} />}
      {showUpdatePopup && (
        <UpdateDialog
          update={update}
          onDownload={() => window.api.update.download()}
          onLater={() => {
            window.api.update.snooze()
            setUpdateHidden(true)
          }}
          onHide={() => setUpdateHidden(true)}
          onInstall={() => window.api.update.install()}
        />
      )}
      {page === 'editor' && editing && (
        <EditorPage
          clip={library.clips.find((c) => c.id === editing.id) ?? editing}
          onClose={() => {
            setEditing(null)
            setPage('clips')
          }}
        />
      )}
      <Toasts />
    </div>
  )
}
