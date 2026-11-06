import { useEffect, useRef } from 'react'
import { useOverlayOpen } from '../lib/overlay'

function cssColor(name: string): { r: number; g: number; b: number } {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(v)
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 }
}

/**
 * A rectangle where OBS draws the live output. We keep telling the background process where the
 * rectangle is (it moves when the window resizes or the page scrolls).
 */
export function ObsPreview({ aspect }: { aspect: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const overlay = useOverlayOpen()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (overlay) {
      window.api.preview.hide()
      return
    }
    let last = ''
    const update = () => {
      const r = el.getBoundingClientRect()
      // Fit a box of the canvas shape inside the element.
      let w = r.width
      let h = w / aspect
      if (h > r.height) {
        h = r.height
        w = h * aspect
      }
      const rect = { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, width: w, height: h }
      const key = JSON.stringify(rect) + document.documentElement.dataset.theme
      if (key === last) return
      last = key
      if (r.width < 4 || r.height < 4 || r.bottom < 0) window.api.preview.hide()
      else window.api.preview.show(rect, cssColor('--bg-window'))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    // Layout can shift without a resize (e.g. panels opening): check a few times a second.
    const t = setInterval(update, 300)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
      clearInterval(t)
      window.api.preview.hide()
    }
  }, [aspect, overlay])

  return (
    <div ref={ref} className="obs-preview">
      {overlay && <span className="preview-paused">Preview paused while a menu is open</span>}
    </div>
  )
}
