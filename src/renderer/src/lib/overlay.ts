// The live preview is drawn by OBS on top of the page, so menus and dialogs would end up
// underneath it. Anything that floats over the page calls useOverlay(true) while it's open,
// and the preview hides itself during that time.
import { useEffect, useSyncExternalStore } from 'react'

let count = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function useOverlay(active = true): void {
  useEffect(() => {
    if (!active) return
    count++
    emit()
    return () => {
      count--
      emit()
    }
  }, [active])
}

export function useOverlayOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => count > 0
  )
}
