import type { Clip } from '@shared/types'

// Replaced in Phase 3 (clip editor).
export function EditorPage({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  return (
    <div className="page">
      <p>Editor for {clip.title}</p>
      <button className="btn" onClick={onClose}>
        Close
      </button>
    </div>
  )
}
