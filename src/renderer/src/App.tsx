import { useEffect, useState } from 'react'
import type { AppSettings, CaptureStatus, EngineStatus, LibrarySnapshot } from '@shared/types'
import { IconRail, type Page } from './components/IconRail'
import { Toasts } from './components/Toasts'
import { ClipsPage } from './pages/ClipsPage'
import { SourcesPage } from './pages/SourcesPage'
import { SettingsPage } from './pages/SettingsPage'
import { applyTheme } from './theme/themes'

const EMPTY_LIBRARY: LibrarySnapshot = { clips: [], games: [], collections: [] }
const IDLE: CaptureStatus = {
  replayActive: false,
  replaySeconds: 0,
  recording: false,
  recordingSince: null,
  game: null,
  gameName: null
}

export default function App() {
  const [page, setPage] = useState<Page>('clips')
  const [library, setLibrary] = useState<LibrarySnapshot>(EMPTY_LIBRARY)
  const [capture, setCapture] = useState<CaptureStatus>(IDLE)
  const [engine, setEngine] = useState<EngineStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    window.api.library.get().then(setLibrary)
    window.api.capture.status().then(setCapture)
    window.api.engineStatus().then(setEngine)
    window.api.settings.get().then((s) => {
      setSettings(s)
      applyTheme(s.theme)
    })
    const offs = [window.api.library.onChange(setLibrary), window.api.capture.onStatus(setCapture)]
    return () => offs.forEach((off) => off())
  }, [])

  const updateSettings = async (patch: Partial<AppSettings>) => {
    const next = await window.api.settings.set(patch)
    setSettings(next)
    if (patch.theme) applyTheme(next.theme)
  }

  return (
    <div className="app">
      <div className="titlebar">
        <span className="titlebar-name">Vibe Clip</span>
      </div>
      <IconRail page={page} onChange={setPage} />
      {page === 'clips' && <ClipsPage library={library} capture={capture} engineError={engine?.error ?? null} />}
      {page === 'sources' && settings && <SourcesPage settings={settings} onChange={updateSettings} engine={engine} />}
      {page === 'settings' && settings && <SettingsPage settings={settings} onChange={updateSettings} engine={engine} />}
      <Toasts />
    </div>
  )
}
