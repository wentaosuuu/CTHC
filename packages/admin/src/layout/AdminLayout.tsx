import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { clearAdminToken, getAdminToken } from '../auth'
import { apiGet } from '../api'
import './admin.css'

export function AdminLayout({ children }: { children: ReactNode }) {
  const loc = useLocation()
  const nav = useNavigate()
  const authed = Boolean(getAdminToken())
  const isLoginPage = loc.pathname === '/login'
  const inSystem = loc.pathname.startsWith('/system/')

  // 所有 Hook 必须在任何 return 之前调用，否则登录/退出切换时会出现 "Rendered fewer hooks than expected"
  const [systemOpen, setSystemOpen] = useState(inSystem)
  const [meName, setMeName] = useState<string>('管理员')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (inSystem) setSystemOpen(true)
  }, [inSystem])

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
      if (el.contains(e.target as any)) return
      setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const systemItems = useMemo(
    () => [
      { to: '/system/departments', label: '部门管理', active: loc.pathname.startsWith('/system/departments') },
      { to: '/system/roles', label: '角色管理', active: loc.pathname.startsWith('/system/roles') },
      { to: '/system/users', label: '用户管理', active: loc.pathname.startsWith('/system/users') },
    ],
    [loc.pathname],
  )

  // 登录页不需要顶部+侧边框架，保持简单
  if (isLoginPage) {
    return <div className="a-login-shell">{children}</div>
  }

  return (
    <div className="a-shell">
      <div className="a-topbar">
        <div className="a-brand">公寓租赁管理后台</div>
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
          <nav className="a-menu">
            <Link className={loc.pathname === '/' ? 'a-menu-item active' : 'a-menu-item'} to="/">
              首页
            </Link>
            <Link className={loc.pathname.startsWith('/houses') ? 'a-menu-item active' : 'a-menu-item'} to="/houses">
              资产管理
            </Link>
            <Link className={loc.pathname.startsWith('/orders') ? 'a-menu-item active' : 'a-menu-item'} to="/orders">
              订单管理
            </Link>
            <Link className={loc.pathname.startsWith('/contracts') ? 'a-menu-item active' : 'a-menu-item'} to="/contracts">
              合同管理
            </Link>
            <Link
              className={loc.pathname.startsWith('/tenant-profiles') ? 'a-menu-item active' : 'a-menu-item'}
              to="/tenant-profiles"
            >
              租客档案
            </Link>
            <Link
              className={loc.pathname.startsWith('/transactions') ? 'a-menu-item active' : 'a-menu-item'}
              to="/transactions"
            >
              交易记录
            </Link>
            <Link
              className={loc.pathname.startsWith('/contract-prepayments') ? 'a-menu-item active' : 'a-menu-item'}
              to="/contract-prepayments"
            >
              合同预收款
            </Link>
            <Link className={loc.pathname.startsWith('/bills') ? 'a-menu-item active' : 'a-menu-item'} to="/bills">
              账单管理
            </Link>
            <Link className={loc.pathname.startsWith('/overdue') ? 'a-menu-item active' : 'a-menu-item'} to="/overdue">
              欠费预警
            </Link>
            <Link
              className={loc.pathname.startsWith('/rent-reminders') ? 'a-menu-item active' : 'a-menu-item'}
              to="/rent-reminders"
            >
              催租记录
            </Link>
            <Link
              className={loc.pathname.startsWith('/reports') ? 'a-menu-item active' : 'a-menu-item'}
              to="/reports"
            >
              报表管理
            </Link>
          </nav>

          <div className="a-accordion">
            <button
              type="button"
              className={systemOpen ? 'a-accordion-header open' : 'a-accordion-header'}
              onClick={() => setSystemOpen((v) => !v)}
              aria-expanded={systemOpen}
            >
              <span>系统管理</span>
              <span className="a-accordion-chevron" aria-hidden>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </button>
            <div className={systemOpen ? 'a-accordion-panel open' : 'a-accordion-panel'}>
              <nav className="a-menu a-menu-nested">
                {systemItems.map((it) => (
                  <Link key={it.to} className={it.active ? 'a-menu-item active' : 'a-menu-item'} to={it.to}>
                    {it.label}
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        </aside>

        <main className="a-content">{children}</main>
      </div>
    </div>
  )
}

