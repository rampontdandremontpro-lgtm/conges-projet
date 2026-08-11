import { Icon } from '@/components/ui/Icon'

export function Header({ title, onToggleSidebar, onOpenMobile }) {
  return (
    <header className="header">
      <div className="header__left">
        <button
          type="button"
          className="icon-button header__toggle-desktop"
          onClick={onToggleSidebar}
          aria-label="Réduire ou agrandir le menu"
        >
          <Icon name="chevronLeft" />
        </button>
        <button
          type="button"
          className="icon-button header__toggle-mobile"
          onClick={onOpenMobile}
          aria-label="Ouvrir le menu"
        >
          <Icon name="menu" />
        </button>
        <h1 className="header__title">{title}</h1>
      </div>
      <div className="header__right">
        <div className="header__avatar" aria-hidden="true">
          <Icon name="user" size={18} />
        </div>
      </div>
    </header>
  )
}
