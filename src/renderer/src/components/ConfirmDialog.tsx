import { useEffect } from 'react'

export function ConfirmDialog(p: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onCancel()
      if (e.key === 'Enter') p.onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && p.onCancel()}>
      <div className="dialog">
        <h3>{p.title}</h3>
        <p>{p.message}</p>
        <div className="dialog-actions">
          <button className="btn" onClick={p.onCancel}>
            Cancel
          </button>
          <button className={'btn ' + (p.danger ? 'btn-danger' : 'btn-accent')} onClick={p.onConfirm} autoFocus>
            {p.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
