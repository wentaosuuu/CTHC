import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { cartCount, cartHasMixedLanes, filterCartByLane, getCart, subscribeCart } from '../cartStorage'
import './mobile.css'

function pathShowsCartDock(pathname: string) {
  if (pathname === '/' || pathname === '/map') return true
  if (/^\/houses\/[^/]+$/.test(pathname)) return true
  return false
}

export function MobileLayout({ children }: { children: ReactNode }) {
  const loc = useLocation()
  const nav = useNavigate()
  const isRoot = loc.pathname === '/' || loc.pathname === '/me'
  const isMe = loc.pathname.startsWith('/me')
  const isBills = loc.pathname.startsWith('/bills')
  const [cartTick, setCartTick] = useState(0)
  const showCartDock = pathShowsCartDock(loc.pathname)
  const nCartLive = useMemo(() => cartCount(), [cartTick])

  useEffect(() => {
    return subscribeCart(() => setCartTick((x) => x + 1))
  }, [])

  let title = '南宁产投华创投资发展集团有限责任公司信息化管理系统'
  if (loc.pathname === '/me') title = '我的'
  else if (loc.pathname === '/cart') title = '购物车'
  else if (loc.pathname === '/checkout') title = '结算下单'
  else if (loc.pathname.startsWith('/me/orders')) title = '我的订单'
  else if (loc.pathname.startsWith('/me/verify')) title = '实名认证'
  else if (isBills) title = '我的账单'
  else if (loc.pathname.startsWith('/ledger-pay/')) title = '扫码付款'
  else if (loc.pathname.startsWith('/order/')) title = '在线下单'
  else if (loc.pathname.startsWith('/houses/')) title = '资产详情'

  const cartSummary = useMemo(() => {
    const lines = getCart()
    if (!lines.length) return '暂无房源'
    if (lines.length === 1) return lines[0].title
    if (cartHasMixedLanes(lines)) {
      const bowanN = filterCartByLane(lines, 'bowan').length
      const otherN = filterCartByLane(lines, 'other').length
      return `泊湾 ${bowanN} 套 · 其他 ${otherN} 套（分两次结算）`
    }
    return `已选 ${lines.length} 套房源`
  }, [cartTick])

  return (
    <div className={`m-shell${showCartDock ? ' m-shell--cart-dock' : ''}`}>
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
        <span style={{ minWidth: 44 }} aria-hidden />
      </div>

      <div className="m-content">{children}</div>

      {showCartDock ? (
        <div className="m-cart-dock">
          <Link to="/cart" className="m-cart-dock-link" aria-label="打开购物车">
            <div className="m-cart-dock-left">
              <div className="m-cart-dock-title">购物车</div>
              <div className="m-cart-dock-sub">{cartSummary}</div>
            </div>
            <div className="m-cart-dock-right">
              {nCartLive > 0 ? <span className="m-cart-dock-badge">{nCartLive}</span> : null}
              <span className="m-cart-dock-chev" aria-hidden>
                ›
              </span>
            </div>
          </Link>
        </div>
      ) : null}

      <div className="m-tabbar">
        <button
          type="button"
          className={`m-tabbar-btn ${!isMe ? 'm-tabbar-btn-active' : ''}`}
          onClick={() => nav('/')}
        >
          <span className="m-tabbar-btn-label">资产</span>
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
