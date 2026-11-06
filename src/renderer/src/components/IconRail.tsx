import { IconCut, IconMovie, IconStack2, IconSettings } from '@tabler/icons-react'

export type Page = 'clips' | 'sources' | 'settings' | 'editor'

const ITEMS = [
  { id: 'clips' as const, label: 'Clips', Icon: IconMovie },
  { id: 'sources' as const, label: 'Sources', Icon: IconStack2 },
  { id: 'editor' as const, label: 'Editor', Icon: IconCut },
  { id: 'settings' as const, label: 'Settings', Icon: IconSettings }
]

export function IconRail({ page, onChange, showEditor }: { page: Page; onChange: (p: Page) => void; showEditor: boolean }) {
  return (
    <nav className="rail">
      {ITEMS.filter((i) => i.id !== 'editor' || showEditor).map(({ id, label, Icon }) => (
        <button key={id} className={'rail-item' + (page === id ? ' active' : '')} onClick={() => onChange(id)}>
          <span className="rail-icon">
            <Icon size={20} stroke={1.75} />
          </span>
          <span className="rail-label">{label}</span>
        </button>
      ))}
    </nav>
  )
}
