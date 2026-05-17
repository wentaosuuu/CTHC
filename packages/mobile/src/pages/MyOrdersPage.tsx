import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  getDemoSyntheticContract,
  getMyOrders,
  getTenantPhone,
  matchContractForOrder,
  resolveContractForOrderDisplay,
  type MyOrderSummary,
  type TenantContractItem,
} from '../api'
import { formatCountdownHms, formatSignCountdownShort, pendingFirstPayDeadlineMs } from '../countdownFormat'
import { useTenantContractItems } from '../hooks/useTenantContractItems'

type OrderQuickFilter = 'ALL' | 'PENDING_REVIEW' | 'WAIT_CONFIRM' | 'SIGNED'

function classifyOrderStatus(order: MyOrderSummary): OrderQuickFilter {
  const text = order.statusText ?? ''
  if (text.includes('已签约')) return 'SIGNED'
  if (
    text.includes('确认订单') ||
    (text.includes('审核通过') && text.includes('请确认')) ||
    text.includes('首期款') ||
    text.includes('待支付首期')
  ) {
    return 'WAIT_CONFIRM'
  }
  return 'PENDING_REVIEW'
}

function filterText(filter: OrderQuickFilter) {
  if (filter === 'ALL') return '全部'
  if (filter === 'PENDING_REVIEW') return '待审核'
  if (filter === 'WAIT_CONFIRM') return '待确认'
  return '已签约'
}

function OrderCountdownBlock(props: {
  contract: TenantContractItem | undefined
  now: number
  showDemoBadge: boolean
}) {
  const { contract, now, showDemoBadge } = props

  if (!contract) return null

  const demoTag = showDemoBadge ? (
    <div className="m-order-deadline__demo">演示数据 · 非真实后台</div>
  ) : null

  if (contract.status === 'VOID' || contract.status === 'TERMINATED') return null

  if (contract.status === 'WAIT_TENANT_SIGN' && contract.tenantSignDeadlineAt) {
    const end = new Date(contract.tenantSignDeadlineAt).getTime()
    const left = end - now
    if (left <= 0) {
      return (
        <div className="m-order-deadline m-order-deadline--expired">
          {demoTag}
          确认与签字已超时，订单将失效（下拉刷新可同步状态）。
        </div>
      )
    }
    return (
      <div className="m-order-deadline m-order-deadline--sign">
        {demoTag}
        <div className="m-order-deadline__label">合同确认与签字 · 剩余</div>
        <div className="m-order-deadline__time">{formatSignCountdownShort(left)}</div>
        <div className="m-order-deadline__sub">
          截止 {new Date(contract.tenantSignDeadlineAt).toLocaleString('zh-CN')} · 含确认与电子签字，逾期订单取消
        </div>
        <div className="m-order-deadline__actions">
          <Link className="m-btn ghost m-order-deadline__btn" to={`/contracts/${contract.id}`}>
            去合同页
          </Link>
        </div>
      </div>
    )
  }

  if (contract.status === 'WAIT_STAMP') {
    return null
  }

  if (contract.status === 'PENDING_PAYMENT' && contract.stampedAt) {
    const endMs = pendingFirstPayDeadlineMs(contract)
    if (endMs == null) return null
    const left = endMs - now
    if (left <= 0) {
      return (
        <div className="m-order-deadline m-order-deadline--expired">
          {demoTag}
          首期款支付时限已过，合同将自动作废（下拉刷新可同步状态）。
        </div>
      )
    }
    return (
      <div className="m-order-deadline m-order-deadline--pay">
        {demoTag}
        <div className="m-order-deadline__label">首期款支付 · 剩余</div>
        <div className="m-order-deadline__time">{formatCountdownHms(left)}</div>
        <div className="m-order-deadline__sub">
          截止 {new Date(endMs).toLocaleString('zh-CN')}
          {contract.renewedFromId ? ' · 续签须在起租首日起 24h 内付清首期（与盖章后 24h 取较早截止）' : ' · 进入待付款后 24 小时内需完成首期款'}
        </div>
        <div className="m-order-deadline__actions">
          <Link className="m-btn m-order-deadline__btn" to={`/pay/${contract.id}`}>
            去支付
          </Link>
        </div>
      </div>
    )
  }

  return null
}

export function MyOrdersPage() {
  const location = useLocation()
  const orders = useMemo(() => getMyOrders(), [location.key])
  const { items: contracts, now, loadError } = useTenantContractItems(location.key)
  const [quickFilter, setQuickFilter] = useState<OrderQuickFilter>('ALL')
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterStartDate, setFilterStartDate] = useState<string>('')
  const [filterEndDate, setFilterEndDate] = useState<string>('')

  const phone = getTenantPhone()
  const hasPhone = Boolean(phone.trim())

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
      {!hasPhone ? (
        <div className="m-card m-order-deadline m-order-deadline--muted">
          <div style={{ fontWeight: 800 }}>提示：绑定手机号</div>
          <div style={{ marginTop: 6 }}>
            列表中<strong>橙色 / 紫色 / 蓝色</strong>区块为<strong>演示用倒计时</strong>，便于向客户讲解流程。填写与下单一致的手机号后，可与后台<strong>真实合同</strong>进度同步展示。
          </div>
          <div style={{ marginTop: 10 }}>
            <Link className="m-btn" to="/me/profile">
              去填写手机号
            </Link>
          </div>
        </div>
      ) : null}

      {hasPhone && loadError ? (
        <div className="m-card m-error" style={{ fontSize: 13 }}>
          合同列表加载失败：{loadError}
        </div>
      ) : null}

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
          {filteredOrders.map((o) => {
            const real = matchContractForOrder(o, contracts)
            const display = resolveContractForOrderDisplay(o, contracts)
            const showDemoBadge = !real && Boolean(getDemoSyntheticContract(o))
            return (
              <div key={o.id} className="m-card" style={{ paddingBottom: 14 }}>
                <Link
                  to={`/me/orders/${encodeURIComponent(o.id)}`}
                  style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                >
                  <div className="m-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div className="m-col">
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{o.houseTitle ?? `订单号：${o.id}`}</span>
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
                <OrderCountdownBlock contract={display} now={now} showDemoBadge={showDemoBadge} />
              </div>
            )
          })}
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
