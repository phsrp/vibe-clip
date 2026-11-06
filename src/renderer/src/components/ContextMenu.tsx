import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
  /** Sub-items shown in a nested menu. */
  children?: MenuItem[]
  separator?: boolean
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [openSub, setOpenSub] = useState<number | null>(null)

  useLayoutEffect(() => {
    // Keep the menu inside the window.
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8)
    })
  }, [x, y])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="menu-sep" />
        ) : (
          <div key={i} className="menu-row" onMouseEnter={() => setOpenSub(item.children ? i : null)}>
            <button
              className={'menu-item' + (item.danger ? ' danger' : '')}
              disabled={item.disabled}
              onClick={() => {
                if (item.children) return setOpenSub(i)
                item.onClick?.()
                onClose()
              }}
            >
              <span className="menu-icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.children && <span className="menu-arrow">›</span>}
            </button>
            {item.children && openSub === i && (
              <div className="menu submenu">
                {item.children.length === 0 && <div className="menu-empty">Nothing here yet</div>}
                {item.children.map((sub, j) => (
                  <button
                    key={j}
                    className="menu-item"
                    disabled={sub.disabled}
                    onClick={() => {
                      sub.onClick?.()
                      onClose()
                    }}
                  >
                    <span className="menu-icon">{sub.icon}</span>
                    <span>{sub.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}
