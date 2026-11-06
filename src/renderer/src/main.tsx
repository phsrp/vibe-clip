import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import type { EngineStatus } from '@shared/types'

// Step 0 test screen: shows whether the OBS engine started and which encoders it found.
function EngineTest() {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  useEffect(() => {
    window.api.engineStatus().then(setStatus)
  }, [])
  if (!status) return <p>Starting…</p>
  return (
    <div style={{ fontFamily: 'sans-serif', color: '#eee', padding: 24 }}>
      <h2>OBS engine: {status.running ? '✅ running' : '❌ failed'}</h2>
      {status.error && <p style={{ color: '#f66' }}>{status.error}</p>}
      <h3>Encoders found</h3>
      <ul>
        {status.encoders.map((e) => (
          <li key={e.id}>
            {e.label} {e.hardware ? '(GPU)' : '(CPU)'} — <code>{e.id}</code>
          </li>
        ))}
      </ul>
      <h3>Capture sources available: {status.inputTypes.length}</h3>
      <p style={{ opacity: 0.6 }}>{status.inputTypes.join(', ')}</p>
    </div>
  )
}

document.body.style.background = '#16161a'
createRoot(document.getElementById('root')!).render(<EngineTest />)
