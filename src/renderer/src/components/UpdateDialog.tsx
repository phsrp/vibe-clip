import { IconDownload, IconRefresh } from '@tabler/icons-react'
import type { UpdateStatus } from '@shared/types'
import { useOverlay } from '../lib/overlay'

// Pops up when a new version exists. Nothing is downloaded until you click Download.
// (Same flow as Vibe Editing Suite.)
export function UpdateDialog({
  update,
  onDownload,
  onLater,
  onHide,
  onInstall
}: {
  update: UpdateStatus
  onDownload: () => void
  onLater: () => void
  onHide: () => void
  onInstall: () => void
}) {
  useOverlay(true)
  return (
    <div className="modal-backdrop">
      <div className="dialog update-dialog">
        {update.state === 'available' && (
          <>
            <h3>A new version is available</h3>
            <p>
              Vibe Clip <b>{update.version}</b> is ready to download. You have {update.current}.
            </p>
            {update.notes && update.notes.length > 0 && (
              <>
                <div className="upd-new">What's new</div>
                <ul className="upd-notes">
                  {update.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="upd-hint">Your clips, profiles and settings are not affected.</p>
            <div className="dialog-actions">
              <button className="btn" onClick={onLater}>
                Remind me later
              </button>
              <button className="btn btn-accent" onClick={onDownload}>
                <IconDownload size={15} /> Download
              </button>
            </div>
          </>
        )}

        {update.state === 'downloading' && (
          <>
            <h3>Downloading {update.version}…</h3>
            <div className="upd-bar">
              <div style={{ width: `${update.percent || 0}%` }} />
            </div>
            <p className="upd-pct">{update.percent || 0}%</p>
            <div className="dialog-actions">
              <button className="btn" onClick={onHide}>
                Hide (keeps downloading)
              </button>
            </div>
          </>
        )}

        {update.state === 'ready' && (
          <>
            <h3>Ready to install</h3>
            <p>
              Version <b>{update.version}</b> has been downloaded. Vibe Clip will close, update and reopen.
            </p>
            <p className="upd-hint">
              If you choose later, it installs when you next quit Vibe Clip. A recording in progress is saved first.
            </p>
            <div className="dialog-actions">
              <button className="btn" onClick={onHide}>
                Later
              </button>
              <button className="btn btn-accent" onClick={onInstall}>
                <IconRefresh size={15} /> Restart now
              </button>
            </div>
          </>
        )}

        {update.state === 'error' && (
          <>
            <h3>Update problem</h3>
            <p>The update could not be downloaded. Check your internet connection and try again later.</p>
            <div className="dialog-actions">
              <button className="btn btn-accent" onClick={onHide}>
                OK
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
