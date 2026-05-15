import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './mobile.css'

export function MobileLayout({ children }: { children: ReactNode }) {
  const loc = useLocation()
  const nav = useNavigate()
  const isRoot = loc.pathname === '/' || loc.pathname === '/me'
  const isMe = loc.pathname.startsWith('/me')
  const isBills = loc.pathname.startsWith('/bills')

  let title = '产投华创房产'
  if (loc.pathname === '/me') title = '我的'
  else if (loc.pathname.startsWith('/me/orders')) title = '我的订单'
  else if (loc.pathname.startsWith('/me/verify')) title = '实名认证'
  else if (isBills) title = '我的账单'

  return (
    <div className="m-shell">
      <div className="m-topbar">
        {!isRoot ? (
          <button
            type="button"
            className="m-topbar-back"
            onClick={() => nav(-1)}
            aria-label="返回"
          >
            ← 返回
          </button>
        ) : (
          <span />
        )}
        <div className="m-title">{title}</div>
        <span />
      </div>

      <div className="m-content">{children}</div>

      <div className="m-tabbar">
        <button
          type="button"
          className={`m-tabbar-btn ${!isMe ? 'm-tabbar-btn-active' : ''}`}
          onClick={() => nav('/')}
        >
          <span className="m-tabbar-btn-label">房源</span>
        </button>
        <button
          type="button"
          className={`m-tabbar-btn ${isMe ? 'm-tabbar-btn-active' : ''}`}
          onClick={() => nav('/me')}
        >
          <span className="m-tabbar-btn-label">我的</span>
        </button>
      </div>
    </div>
  )
}

