import { useEffect, useRef, useState } from 'react'
import type { AppSettings, CaptureStatus, Clip, EngineStatus, LibrarySnapshot, ProfilesState } from '@shared/types'
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
  // Ignore the echo of our own profile changes so typing/dragging doesn't jump back.
  const pendingProfiles = useRef(0)

  useEffect(() => {
    window.api.library.get().then((l) => l && setLibrary(l))
    window.api.capture.status().then(setCapture)
    window.api.engineStatus().then(setEngine)
    window.api.profiles.get().then(setProfiles)
    window.api.settings.get().then((s) => {
      setSettings(s)
      applyTheme(s.theme)
    })
    const offs = [
      window.api.library.onChange(setLibrary),
      window.api.capture.onStatus(setCapture),
      window.api.settings.onChange(setSettings),
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

  const openEditor = (clip: Clip) => {
    setEditing(clip)
    setPage('editor')
  }

  return (
    <div className="app">
      <div className="titlebar">
        <span className="titlebar-name">Vibe Clip</span>
      </div>
      <IconRail page={page} onChange={setPage} showEditor={!!editing} />
      {page === 'clips' && (
        <ClipsPage library={library} capture={capture} engineError={engine?.error ?? null} onEdit={openEditor} />
      )}
      {page === 'sources' && profiles && settings && (
        <SourcesPage profiles={profiles} onProfiles={updateProfiles} settings={settings} engine={engine} />
      )}
      {page === 'settings' && settings && <SettingsPage settings={settings} onChange={updateSettings} engine={engine} />}
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
