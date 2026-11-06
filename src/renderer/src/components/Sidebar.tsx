import { useEffect, useRef, useState } from 'react'
import { IconFolder, IconLayoutGrid, IconPlus, IconSearch, IconX } from '@tabler/icons-react'
import type { Collection, GameSummary, LibraryView } from '@shared/types'
import { GameIcon } from './GameIcon'

interface Props {
  view: LibraryView
  onView: (v: LibraryView) => void
  total: number
  games: GameSummary[]
  collections: Collection[]
  search: string
  onSearch: (s: string) => void
  onCreateCollection: (name: string) => void
  onCollectionMenu: (c: Collection, x: number, y: number) => void
}

export function Sidebar(p: Props) {
  const searchRef = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const is = (v: LibraryView) => JSON.stringify(v) === JSON.stringify(p.view)

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Clips</h1>
        <label className="search">
          <IconSearch size={14} />
          <input
            ref={searchRef}
            placeholder="Search"
            value={p.search}
            onChange={(e) => p.onSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && p.onSearch('')}
          />
          {p.search ? (
            <button className="search-clear" onClick={() => p.onSearch('')} title="Clear search">
              <IconX size={12} />
            </button>
          ) : (
            <kbd>Ctrl F</kbd>
          )}
        </label>
      </div>

      <div className="sidebar-scroll">
        <SideItem active={is({ type: 'all' })} icon={<IconLayoutGrid size={16} />} label="All" count={p.total} onClick={() => p.onView({ type: 'all' })} />

        <div className="side-section">Games</div>
        {p.games.length === 0 && <div className="side-empty">Games you play show up here</div>}
        {p.games.map((g) => (
          <SideItem
            key={g.id}
            active={is({ type: 'game', id: g.id })}
            icon={<GameIcon id={g.id} name={g.name} icon={g.icon} size={18} />}
            label={g.name}
            count={g.count}
            onClick={() => p.onView({ type: 'game', id: g.id })}
          />
        ))}

        <div className="side-section">Collections</div>
        {p.collections.map((c) => (
          <SideItem
            key={c.id}
            active={is({ type: 'collection', id: c.id })}
            icon={c.cover ? <img className="collection-cover" src={c.cover} alt="" /> : <IconFolder size={16} />}
            label={c.name}
            count={c.count}
            onClick={() => p.onView({ type: 'collection', id: c.id })}
            onContextMenu={(e) => {
              e.preventDefault()
              p.onCollectionMenu(c, e.clientX, e.clientY)
            }}
          />
        ))}
        {creating ? (
          <NewCollectionInput
            onDone={(name) => {
              setCreating(false)
              if (name) p.onCreateCollection(name)
            }}
          />
        ) : (
          <button className="side-item muted" onClick={() => setCreating(true)}>
            <span className="side-icon">
              <IconPlus size={16} />
            </span>
            <span className="side-label">New collection</span>
          </button>
        )}
      </div>
    </aside>
  )
}

function SideItem(props: {
  active: boolean
  icon: React.ReactNode
  label: string
  count: number
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  return (
    <button className={'side-item' + (props.active ? ' active' : '')} onClick={props.onClick} onContextMenu={props.onContextMenu}>
      <span className="side-icon">{props.icon}</span>
      <span className="side-label">{props.label}</span>
      <span className="side-count">{props.count}</span>
    </button>
  )
}

function NewCollectionInput({ onDone }: { onDone: (name: string | null) => void }) {
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <div className="side-item editing">
      <span className="side-icon">
        <IconFolder size={16} />
      </span>
      <input
        autoFocus
        className="side-input"
        placeholder="Collection name"
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(e.currentTarget.value.trim() || null)
          if (e.key === 'Escape') finish(null)
        }}
        onBlur={(e) => finish(e.currentTarget.value.trim() || null)}
      />
    </div>
  )
}
