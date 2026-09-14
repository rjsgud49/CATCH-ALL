import { NavLink } from 'react-router-dom'

type Props = {
  libraryCount: number
  onHelp: () => void
}

export function AppShellNav({ libraryCount, onHelp }: Props) {
  return (
    <header className="topbar">
      <div className="topbar-brand-wrap">
        <NavLink to="/" className="topbar-brand">
          CATCH-ALL
        </NavLink>
        <span className="topbar-tagline">따서 모으고, 꺼내 쓴다.</span>
      </div>
      <nav className="topbar-nav" aria-label="주요 메뉴">
        <NavLink
          to="/"
          className={({ isActive }) => (isActive ? 'nav-link nav-link--on' : 'nav-link')}
          end
        >
          Catch
        </NavLink>
        <NavLink
          to="/library"
          className={({ isActive }) => (isActive ? 'nav-link nav-link--on' : 'nav-link')}
        >
          Library{libraryCount > 0 ? ` · ${libraryCount}` : ''}
        </NavLink>
        <button type="button" className="nav-link nav-link--btn" onClick={onHelp}>
          안내
        </button>
      </nav>
    </header>
  )
}
