import { useEffect, useState } from 'react'
import { IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconX } from '@tabler/icons-react'
import type { ToastMessage } from '@shared/types'

/** In-app notifications (bottom-right). Errors stay until closed; others fade after a few seconds. */
export function Toasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  useEffect(
    () =>
      window.api.onToast((t) => {
        setToasts((list) => [...list.slice(-4), t])
        if (t.kind !== 'error') setTimeout(() => dismiss(t.id), 4000)
      }),
    []
  )

  const dismiss = (id: number) => setToasts((list) => list.filter((t) => t.id !== id))

  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind}>
          <span className="toast-icon">
            {t.kind === 'success' ? <IconCircleCheck size={18} /> : t.kind === 'error' ? <IconAlertTriangle size={18} /> : <IconInfoCircle size={18} />}
          </span>
          <div className="toast-body">
            <strong>{t.title}</strong>
            {t.detail && <span>{t.detail}</span>}
          </div>
          <button className="icon-btn small" onClick={() => dismiss(t.id)}>
            <IconX size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
