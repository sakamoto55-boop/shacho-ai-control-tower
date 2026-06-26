import type { Screen } from '../types'
import { actionItems } from '../data/mockData'

const unreadA = actionItems.filter((i: { priority: string; isRead: boolean }) => i.priority === 'A' && !i.isRead).length

const NAV_ITEMS: {
  screen: Screen
  icon: string
  label: string
  badge?: number
}[] = [
  { screen: 'home',      icon: '🏠', label: 'ホーム' },
  { screen: 'cockpit',   icon: '🎯', label: 'コックピット' },
  { screen: 'actions',   icon: '⚡', label: '要対応', badge: unreadA },
  { screen: 'create',    icon: '✍️', label: '作成' },
  { screen: 'dashboard', icon: '📈', label: '経営' },
]

interface Props {
  current: Screen
  onNavigate: (screen: Screen) => void
}

export default function Navigation({ current, onNavigate }: Props) {
  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.screen}
          className={`nav-item ${current === item.screen ? 'active' : ''}`}
          onClick={() => onNavigate(item.screen)}
          style={{ fontSize: 9 }}
        >
          <span className="nav-item-icon" style={{ fontSize: 19 }}>{item.icon}</span>
          {item.badge && item.badge > 0 ? (
            <span className="nav-badge">{item.badge}</span>
          ) : null}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}
