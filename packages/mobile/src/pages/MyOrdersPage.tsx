import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getMyOrders, type MyOrderSummary } from '../api'

type OrderQuickFilter = 'ALL' | 'PENDING_REVIEW' | 'WAIT_CONFIRM' | 'SIGNED'

function classifyOrderStatus(order: MyOrderSummary): OrderQuickFilter {
  const text = order.statusText ?? ''
  if (text.includes('已签约')) return 'SIGNED'
  if (text.includes('确认订单')) return 'WAIT_CONFIRM'
  return 'PENDING_REVIEW'
}

function filterText(filter: OrderQuickFilter) {
  if (filter === 'ALL') return '全部'
  if (filter === 'PENDING_REVIEW') return '待审核'
  if (filter === 'WAIT_CONFIRM') return '待确认'
  return '已签约'
}

export function MyOrdersPage() {
  const orders = useMemo<MyOrderSummary[]>(() => getMyOrders(), [])
  const [quickFilter, setQuickFilter] = useState<OrderQuickFilter>('ALL')
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterStartDate, setFilterStartDate] = useState<string>('')
  const [filterEndDate, setFilterEndDate] = useState<string>('')

  const filteredOrders = useMemo(() => {
    const byStatus = quickFilter === 'ALL' ? orders : orders.filter((o) => classifyOrderStatus(o) === quickFilter)
    return byStatus.filter((o) => {
      const t = new Date(o.createdAt).getTime()
      if (Number.isNaN(t)) return false

      if (filterStartDate) {
        const startMs = new Date(`${filterStartDate}T00:00:00`).getTime()
        if (t < startMs) return false
      }
      if (filterEndDate) {
        const endMs = new Date(`${filterEndDate}T23:59:59`).getTime()
        if (t > endMs) return false
      }
      return true
    })
  }, [orders, quickFilter, filterStartDate, filterEndDate])

  const counts = useMemo(() => {
    const c: Record<OrderQuickFilter, number> = {
      ALL: orders.length,
      PENDING_REVIEW: 0,
      WAIT_CONFIRM: 0,
      SIGNED: 0,
    }
    orders.forEach((o) => {
      c[classifyOrderStatus(o)] += 1
    })
    return c
  }, [orders])

  return (
    <div className="m-col">
      <div className="m-card m-filter">
        <button
          type="button"
          className="m-filter-header"
          onClick={() => setFilterOpen((o) => !o)}
          aria-expanded={filterOpen}
        >
          <span className="m-filter-title">时间筛选</span>
          <span className="m-filter-chevron">{filterOpen ? '▼' : '▶'}</span>
        </button>
        {filterOpen && (
          <div className="m-filter-body">
            <div className="m-filter-row m-filter-rent-range">
              <label className="m-filter-label">提交时间</label>
              <div className="m-filter-rent-inputs">
                <input
                  className="m-filter-input"
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                />
                <span className="m-filter-rent-sep">~</span>
                <input
                  className="m-filter-input"
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                />
              </div>
            </div>
            {(filterStartDate || filterEndDate) && (
              <button
                type="button"
                className="m-filter-clear"
                onClick={() => {
                  setFilterStartDate('')
                  setFilterEndDate('')
                }}
              >
                清除时间筛选
              </button>
            )}
          </div>
        )}
      </div>

      <div className="m-quick-filters">
        {(['ALL', 'PENDING_REVIEW', 'WAIT_CONFIRM', 'SIGNED'] as OrderQuickFilter[]).map((k) => (
          <button
            key={k}
            type="button"
            className={`m-quick-filter-btn ${quickFilter === k ? 'active' : ''}`}
            onClick={() => setQuickFilter(k)}
          >
            {filterText(k)}（{counts[k]}）
          </button>
        ))}
      </div>

      {orders.length === 0 ? (
        <div className="m-card">
          <div className="m-h1">我的订单</div>
          <div style={{ height: 8 }} />
          <div className="m-muted">暂无订单，可以先在房源详情页发起下单。</div>
        </div>
      ) : (
        <div className="m-col">
          {filteredOrders.map((o) => (
            <Link
              key={o.id}
              to={`/me/orders/${encodeURIComponent(o.id)}`}
              className="m-card"
              style={{ textDecoration: 'none' }}
            >
              <div className="m-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div className="m-col">
                  <span style={{ fontWeight: 700, fontSize: 15 }}>
                    {o.houseTitle ?? `订单号：${o.id}`}
                  </span>
                  <span className="m-muted">{o.houseSubtitle ?? `订单号：${o.id}`}</span>
                  <span className="m-muted">提交时间：{new Date(o.createdAt).toLocaleString()}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {o.rentMonthly ? <div className="m-house-card-rent">¥{o.rentMonthly}/月</div> : null}
                  <div className="m-muted" style={{ marginTop: 2 }}>
                    {o.statusText ?? '已提交，等待管理员审核'}
                  </div>
                </div>
              </div>
            </Link>
          ))}
          {filteredOrders.length === 0 ? (
            <div className="m-card">
              <div style={{ fontWeight: 800 }}>暂无符合条件的订单</div>
              <div className="m-muted" style={{ marginTop: 4 }}>
                当前筛选：{filterText(quickFilter)}
                {filterStartDate || filterEndDate ? `，并按提交时间范围筛选` : '；可以切换其它条件查看。'}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
