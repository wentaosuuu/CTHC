import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { clearAdminToken, getAdminToken } from '../auth'
import { apiGet } from '../api'
import { ADMIN_NAVIGATION, isAdminMenuActive } from '../adminNavigation'
import './admin.css'

export function AdminLayout({ children }: { children: ReactNode }) {
  const loc = useLocation()
  const nav = useNavigate()
  const authed = Boolean(getAdminToken())
  const isLoginPage = loc.pathname === '/login'
  // 所有 Hook 必须在任何 return 之前调用，否则登录/退出切换时会出现 "Rendered fewer hooks than expected"
  const [menuExpansion, setMenuExpansion] = useState<{ pathname: string; openIds: Set<string> } | null>(null)
  const [meName, setMeName] = useState<string>('管理员')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!authed) return
    let alive = true
    apiGet<{ name: string }>('/api/admin/me').then((r) => {
      if (!alive) return
      if (r.ok && r.data.name) setMeName(r.data.name)
    })
    return () => {
      alive = false
    }
  }, [authed])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      const el = menuRef.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const defaultOpenIds = ADMIN_NAVIGATION.filter(
    (entry) => 'children' in entry && entry.children.some((item) => isAdminMenuActive(loc.pathname, item.path)),
  ).map((entry) => entry.id)
  const openGroupIds = menuExpansion?.pathname === loc.pathname ? menuExpansion.openIds : new Set(defaultOpenIds)

  const toggleMenuGroup = (id: string) => {
    const openIds = new Set(openGroupIds)
    if (openIds.has(id)) openIds.delete(id)
    else openIds.add(id)
    setMenuExpansion({ pathname: loc.pathname, openIds })
  }

  // 登录页不需要顶部+侧边框架，保持简单
  if (isLoginPage) {
    return <div className="a-login-shell">{children}</div>
  }

  return (
    <div className="a-shell">
      <div className="a-topbar">
        <div className="a-brand-row">
          <img className="a-brand-logo" src="/logo.png" alt="南宁产投华创" />
          <div className="a-brand">南宁产投华创投资发展集团有限责任公司信息化管理系统</div>
        </div>
        <div className="a-top-spacer" />
        {authed ? (
          <div className="a-top-user" ref={menuRef}>
            <span className="a-muted">管理员：{meName}</span>
            <button
              type="button"
              className="a-icon-btn"
              aria-label="打开用户菜单"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              title="菜单"
            >
              <span className="a-hamburger" aria-hidden />
            </button>
            {menuOpen ? (
              <div className="a-top-menu" role="menu" aria-label="用户菜单">
                <button
                  type="button"
                  className="a-top-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    nav('/me')
                  }}
                >
                  个人中心
                </button>
                <button
                  type="button"
                  className="a-top-menu-item danger"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    clearAdminToken()
                    nav('/login', { replace: true })
                  }}
                >
                  退出
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="a-main">
        <aside className="a-sidebar">
          <nav className="a-menu" aria-label="后台业务导航">
            {ADMIN_NAVIGATION.map((entry) => {
              if (!('children' in entry)) {
                const active = isAdminMenuActive(loc.pathname, entry.path)
                return (
                  <Link key={entry.id} className={active ? 'a-menu-item active' : 'a-menu-item'}
                    to={entry.path} aria-current={active ? 'page' : undefined}>
                    {entry.label}
                  </Link>
                )
              }
              const open = openGroupIds.has(entry.id)
              const panelId = `admin-menu-${entry.id}`
              return (
                <div className="a-accordion" key={entry.id}>
                  <button type="button" className={open ? 'a-accordion-header open' : 'a-accordion-header'}
                    onClick={() => toggleMenuGroup(entry.id)} aria-expanded={open} aria-controls={panelId}>
                    <span>{entry.label}</span>
                    <span className="a-accordion-chevron" aria-hidden>
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </span>
                  </button>
                  <div id={panelId} className={open ? 'a-accordion-panel open' : 'a-accordion-panel'} hidden={!open}>
                    <div className="a-menu a-menu-nested">
                      {entry.children.map((item) => {
                        const active = isAdminMenuActive(loc.pathname, item.path)
                        return (
                          <Link key={item.id} className={active ? 'a-menu-item active' : 'a-menu-item'}
                            to={item.path} aria-current={active ? 'page' : undefined}>
                            {item.label}
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </nav>
        </aside>

        <main className="a-content">{children}</main>
      </div>
    </div>
  )
}

