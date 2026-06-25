import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  cartHasMixedLanes,
  cartLaneLabel,
  clearCart,
  filterCartByLane,
  getCart,
  removeFromCart,
  subscribeCart,
  type CartCheckoutLane,
  type CartLine,
} from '../cartStorage'

function CartLineRow({ line, onRemove }: { line: CartLine; onRemove: () => void }) {
  return (
    <div className="m-cart-line">
      <div className="m-cart-line-top">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="m-cart-line-title">{line.title}</div>
          <div className="m-cart-line-sub" title={line.subtitle}>
            {line.subtitle} · {line.assetType}
          </div>
        </div>
        <div className="m-cart-line-price">¥{line.rentMonthly}</div>
      </div>
      <div className="m-cart-line-actions">
        <button type="button" className="m-cart-line-remove" onClick={onRemove}>
          移除
        </button>
      </div>
    </div>
  )
}

function CartLaneSection({
  lane,
  lines,
  onRemoveLine,
  onCheckout,
}: {
  lane: CartCheckoutLane
  lines: CartLine[]
  onRemoveLine: (houseId: string) => void
  onCheckout: (lane: CartCheckoutLane) => void
}) {
  const total = lines.reduce((s, l) => s + l.rentMonthly, 0)
  if (!lines.length) return null
  return (
    <div className="m-cart-lane">
      <div className="m-cart-lane-head">
        <span className="m-cart-lane-title">{cartLaneLabel(lane)}</span>
        <span className="m-cart-lane-count">{lines.length} 套</span>
      </div>
      {lines.map((l) => (
        <CartLineRow key={l.houseId} line={l} onRemove={() => onRemoveLine(l.houseId)} />
      ))}
      <div className="m-cart-lane-foot">
        <div className="m-cart-lane-total">¥{total.toLocaleString('zh-CN')}</div>
        <button type="button" className="m-btn m-cart-lane-checkout" onClick={() => onCheckout(lane)}>
          结算本类（{lines.length} 套）
        </button>
      </div>
    </div>
  )
}

export function CartPage() {
  const nav = useNavigate()
  const [lines, setLines] = useState<CartLine[]>(() => getCart())

  const bowanLines = useMemo(() => filterCartByLane(lines, 'bowan'), [lines])
  const otherLines = useMemo(() => filterCartByLane(lines, 'other'), [lines])
  const mixed = useMemo(() => cartHasMixedLanes(lines), [lines])
  const totalRent = useMemo(() => lines.reduce((s, l) => s + l.rentMonthly, 0), [lines])

  function refresh() {
    setLines(getCart())
  }

  useEffect(() => {
    return subscribeCart(refresh)
  }, [])

  function removeLine(houseId: string) {
    removeFromCart(houseId)
    refresh()
  }

  function goCheckout(lane: CartCheckoutLane) {
    if (!filterCartByLane(lines, lane).length) return
    nav(`/checkout?lane=${lane}`)
  }

  const rootClass = lines.length > 0 ? 'm-col m-cart-page--has-footer' : 'm-col'

  return (
    <div className={rootClass}>
      <div className="m-card" style={{ padding: '10px 12px' }}>
        <div className="m-h1" style={{ fontSize: 17, marginBottom: 4 }}>
          购物车
        </div>
        <p className="m-cart-tip">
          泊湾公寓与商铺/厂房/住宅合同模板不同，须<strong>分开结算</strong>。下一步选择合同形式后填写租期与起租日：多对一统一一套日期，一对一各套分别填写。
        </p>
        {mixed ? (
          <p className="m-cart-tip m-cart-tip--warn">
            当前购物车含两类资产，请分别点击各类下方的「结算本类」。
          </p>
        ) : null}
      </div>

      {lines.length === 0 ? (
        <div className="m-card m-muted" style={{ textAlign: 'center', padding: '20px 14px' }}>
          暂无房源，请在列表或详情页加入购物车。
          <div style={{ height: 14 }} />
          <Link className="m-btn" to="/">
            去选房
          </Link>
        </div>
      ) : (
        <>
          <div className="m-card" style={{ padding: '10px 12px 12px' }}>
            <CartLaneSection lane="bowan" lines={bowanLines} onRemoveLine={removeLine} onCheckout={goCheckout} />
            <CartLaneSection lane="other" lines={otherLines} onRemoveLine={removeLine} onCheckout={goCheckout} />
          </div>

          <div className="m-muted" style={{ textAlign: 'center', fontSize: 12 }}>
            <Link to="/">继续选房</Link>
          </div>
        </>
      )}

      {lines.length > 0 ? (
        <div className="m-cart-checkout-bar">
          <div className="m-cart-checkout-bar-inner">
            <div className="m-cart-checkout-meta">
              <div className="m-cart-checkout-total">¥{totalRent.toLocaleString('zh-CN')}</div>
              <div className="m-cart-checkout-sub">
                月租合计 · 共 {lines.length} 套
                {mixed ? ' · 请分两类结算' : ''}
              </div>
            </div>
            <div className="m-cart-checkout-actions">
              <button
                type="button"
                className="m-btn-ghost-sm"
                onClick={() => {
                  if (!confirm('清空购物车？')) return
                  clearCart()
                  refresh()
                }}
              >
                清空
              </button>
              {!mixed && lines.length > 0 ? (
                <button
                  type="button"
                  className="m-btn"
                  onClick={() => goCheckout(bowanLines.length ? 'bowan' : 'other')}
                >
                  去结算
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
