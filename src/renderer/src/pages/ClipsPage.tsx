import { useCallback, useMemo, useState } from 'react'
import {
  IconChevronDown,
  IconFolderOpen,
  IconFolderPlus,
  IconFolderMinus,
  IconPencil,
  IconPlayerPlay,
  IconTrash,
  IconMovie,
  IconCut
} from '@tabler/icons-react'
import type { CaptureStatus, Clip, Collection, KindFilter, LibrarySnapshot, LibraryView, SortOrder } from '@shared/types'
import { Sidebar } from '../components/Sidebar'
import { TopBar } from '../components/TopBar'
import { ClipCard } from '../components/ClipCard'
import { ContextMenu, type MenuItem } from '../components/ContextMenu'
import { Player } from '../components/Player'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { countLabel, groupByDay } from '../lib/format'

interface Props {
  library: LibrarySnapshot
  capture: CaptureStatus
  engineError: string | null
  onEdit: (clip: Clip) => void
}

type Menu = { kind: 'clip'; clip: Clip; x: number; y: number } | { kind: 'collection'; col: Collection; x: number; y: number }

export function ClipsPage({ library, capture, engineError, onEdit }: Props) {
  const [view, setView] = useState<LibraryView>({ type: 'all' })
  const [filter, setFilter] = useState<KindFilter>('all')
  const [sort, setSort] = useState<SortOrder>('newest')
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<number | null>(null)
  const [renaming, setRenaming] = useState<number | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [playing, setPlaying] = useState<Clip | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Clip | null>(null)

  const gameIcons = useMemo(() => new Map(library.games.map((g) => [g.id, g.icon])), [library.games])

  // Clips in the current sidebar view (before the All / clips / screenshots filter).
  const inView = useMemo(() => {
    const q = search.trim().toLowerCase()
    return library.clips.filter((c) => {
      if (view.type === 'shared' && !c.shared) return false
      if (view.type === 'game' && c.game !== view.id) return false
      if (view.type === 'collection' && !c.collections.includes(view.id)) return false
      if (q && !`${c.title} ${c.gameName}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [library.clips, view, search])

  const visible = useMemo(() => {
    const list = inView.filter((c) =>
      filter === 'all' ? true : filter === 'screenshots' ? c.kind === 'screenshot' : c.kind !== 'screenshot'
    )
    const sorted = [...list]
    if (sort === 'newest') sorted.sort((a, b) => b.createdAt - a.createdAt)
    if (sort === 'oldest') sorted.sort((a, b) => a.createdAt - b.createdAt)
    if (sort === 'largest') sorted.sort((a, b) => b.size - a.size)
    if (sort === 'longest') sorted.sort((a, b) => b.duration - a.duration)
    return sorted
  }, [inView, filter, sort])

  // Day grouping only makes sense when sorted by date.
  const groups = useMemo(
    () =>
      sort === 'newest' || sort === 'oldest'
        ? groupByDay(visible)
        : [{ key: -1, label: sort === 'largest' ? 'Largest first' : 'Longest first', clips: visible }],
    [visible, sort]
  )
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.key))

  const shotCount = inView.filter((c) => c.kind === 'screenshot').length

  const onSelect = useCallback((c: Clip) => setSelected(c.id), [])
  const onOpen = useCallback((c: Clip) => setPlaying(c), [])
  const onMenu = useCallback((clip: Clip, x: number, y: number) => setMenu({ kind: 'clip', clip, x, y }), [])
  const onRename = useCallback((clip: Clip, title: string | null) => {
    setRenaming(null)
    if (title && title !== clip.title) window.api.library.rename(clip.id, title)
  }, [])

  const clipMenu = (clip: Clip): MenuItem[] => [
    { label: 'Play', icon: <IconPlayerPlay size={15} />, onClick: () => setPlaying(clip) },
    ...(clip.kind !== 'screenshot' ? [{ label: 'Edit (trim, split, crop)', icon: <IconCut size={15} />, onClick: () => onEdit(clip) }] : []),
    { label: 'Rename', icon: <IconPencil size={15} />, onClick: () => setRenaming(clip.id) },
    {
      label: 'Add to collection',
      icon: <IconFolderPlus size={15} />,
      children: library.collections.map((col) => ({
        label: col.name,
        disabled: clip.collections.includes(col.id),
        onClick: () => window.api.library.addToCollection([clip.id], col.id)
      }))
    },
    ...(view.type === 'collection'
      ? [
          {
            label: 'Remove from this collection',
            icon: <IconFolderMinus size={15} />,
            onClick: () => window.api.library.removeFromCollection([clip.id], view.id)
          }
        ]
      : []),
    { label: 'Show in folder', icon: <IconFolderOpen size={15} />, onClick: () => window.api.library.reveal(clip.id) },
    { separator: true, label: '' },
    { label: 'Delete', icon: <IconTrash size={15} />, danger: true, onClick: () => setConfirmDelete(clip) }
  ]

  const collectionMenu = (col: Collection): MenuItem[] => [
    {
      label: 'Delete collection',
      icon: <IconTrash size={15} />,
      danger: true,
      onClick: () => {
        if (view.type === 'collection' && view.id === col.id) setView({ type: 'all' })
        window.api.library.deleteCollection(col.id)
      }
    }
  ]

  return (
    <>
      <Sidebar
        view={view}
        onView={setView}
        total={library.clips.length}
        sharedCount={library.clips.filter((c) => c.shared).length}
        games={library.games}
        collections={library.collections}
        search={search}
        onSearch={setSearch}
        onCreateCollection={(name) => window.api.library.createCollection(name)}
        onCollectionMenu={(col, x, y) => setMenu({ kind: 'collection', col, x, y })}
      />
      <main className="main">
        <TopBar
          filter={filter}
          onFilter={setFilter}
          clipCount={inView.length - shotCount}
          shotCount={shotCount}
          sort={sort}
          onSort={setSort}
          allCollapsed={allCollapsed}
          onToggleCollapse={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.key)))}
          capture={capture}
          engineError={engineError}
          onToggleReplay={() => window.api.capture.toggleReplay()}
          onToggleRecording={() => window.api.capture.toggleRecording()}
        />
        {engineError && (
          <div className="banner error">
            <strong>The recording engine couldn't start.</strong> {engineError} Your existing clips still work.
          </div>
        )}
        <div className="grid-scroll" onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
          {visible.length === 0 && <EmptyState hasClips={library.clips.length > 0} />}
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.key)
            return (
              <section key={g.key} className="day">
                <button
                  className="day-header"
                  onClick={() => {
                    const next = new Set(collapsed)
                    if (isCollapsed) next.delete(g.key)
                    else next.add(g.key)
                    setCollapsed(next)
                  }}
                >
                  <IconChevronDown size={14} className={'chev' + (isCollapsed ? ' closed' : '')} />
                  <span className="day-label">{g.label}</span>
                  <span className="day-count">{countLabel(g.clips)}</span>
                </button>
                {!isCollapsed && (
                  <div className="grid">
                    {g.clips.map((c) => (
                      <ClipCard
                        key={c.id}
                        clip={c}
                        gameIcon={gameIcons.get(c.game) ?? null}
                        selected={selected === c.id}
                        renaming={renaming === c.id}
                        onSelect={onSelect}
                        onOpen={onOpen}
                        onMenu={onMenu}
                        onRename={onRename}
                      />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </main>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={menu.kind === 'clip' ? clipMenu(menu.clip) : collectionMenu(menu.col)}
        />
      )}
      {playing && (
        <Player
          clip={library.clips.find((c) => c.id === playing.id) ?? playing}
          list={visible}
          onNavigate={setPlaying}
          onClose={() => setPlaying(null)}
          onEdit={(c) => {
            setPlaying(null)
            onEdit(c)
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this clip?"
          message={`"${confirmDelete.title}" will be moved to the Recycle Bin.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            window.api.library.remove([confirmDelete.id])
            setConfirmDelete(null)
          }}
        />
      )}
    </>
  )
}

function EmptyState({ hasClips }: { hasClips: boolean }) {
  return (
    <div className="empty">
      <IconMovie size={40} stroke={1.25} />
      {hasClips ? (
        <p>No clips match this view.</p>
      ) : (
        <>
          <p>No clips yet.</p>
          <p className="muted">Press your clip hotkey while playing to save the last few minutes, or hit Record.</p>
        </>
      )}
    </div>
  )
}
