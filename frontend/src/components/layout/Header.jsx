import { NotificationsDropdown } from '@/components/layout/NotificationsDropdown'
import { UserMenu } from '@/components/layout/UserMenu'

export function Header() {
  return (
    <header className="header">
      <NotificationsDropdown />
      <UserMenu />
    </header>
  )
}
