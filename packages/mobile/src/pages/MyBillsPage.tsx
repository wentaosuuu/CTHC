import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, getTenantPhone, type MyBillSummary } from '../api'

export function MyBillsPage() {
  const [items, setItems] = useState<MyBillSummary[]>([])
  const [error, setError] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterPeriod, setFilterPeriod] = useState<string>('')
  const [filterStore, setFilterStore] = useState<string>('')
  const [filterDueStartDate, setFilterDueStartDate] = useState<string>('')
  const [filterDueEndDate, setFilterDueEndDate] = useState<string>('')
  const [quickFilter, setQuickFilter] = useState<'ALL' | 'UNPAID' | 'PAID'>('ALL')

  const phone = getTenantPhone()

  useEffect(() => {
    let alive = true
    async function load() {
      if (!phone) {
        // 没有手机号时，直接给一组本地 Demo 账单，方便演示 UI
        const demo = buildDemoBills()
        setItems(demo)
        return
      }

      setError('')
      const r = await apiGet<{ items: MyBillSummary[] }>('/api/bills', {
        headers: { 'x-tenant-phone': phone },
      })
      if (!alive) return
      if (!r.ok) {
        // 接口失败时，也退回到本地 Demo 数据
        setError(r.error)
        setItems(buildDemoBills())
        return
      }
      const list = r.data.items
      if (!list || list.length === 0) {
        setItems(buildDemoBills())
      } else {
        setItems(list)
      }
    }

    load()
    return () => {
      alive = false
    }
  }, [phone])

  const allPeriods = useMemo(() => {
    const set = new Set(items.map((b) => b.period))
    return Array.from(set).sort().reverse()
  }, [items])

  const allStores = useMemo(() => {
    const set = new Set(items.map((b) => b.storeName))
    return Array.from(set).sort()
  }, [items])

  const filtered = useMemo(() => {
    return items.filter((b) => {
      if (filterStatus === 'UNPAID_OR_OVERDUE') {
        if (b.status === 'PAID') return false
      } else if (filterStatus && b.status !== filterStatus) return false
      if (filterPeriod && b.period !== filterPeriod) return false
      if (filterStore && b.storeName !== filterStore) return false

      if (filterDueStartDate || filterDueEndDate) {
        const dueMs = new Date(`${b.dueDate}T00:00:00`).getTime()
        if (Number.isNaN(dueMs)) return false

        if (filterDueStartDate) {
          const startMs = new Date(`${filterDueStartDate}T00:00:00`).getTime()
          if (dueMs < startMs) return false
        }
        if (filterDueEndDate) {
          const endMs = new Date(`${filterDueEndDate}T23:59:59`).getTime()
          if (dueMs > endMs) return false
        }
      }
      return true
    })
  }, [items, filterStatus, filterPeriod, filterStore, filterDueStartDate, filterDueEndDate])

  const groupedByContract = useMemo(() => {
    const map = new Map<string, MyBillSummary[]>()
    filtered.forEach((b) => {
      const key = b.contractId || b.contractNo || 'UNKNOWN'
      const list = map.get(key) ?? []
      list.push(b)
      map.set(key, list)
    })
    const keys = Array.from(map.keys()).sort()
    return keys.map((key) => {
      const bills = (map.get(key) ?? []).slice().sort((a, b) => (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0))
      const sample = bills[0]
      return { key, bills, sample }
    })
  }, [filtered])

  const quickCounts = useMemo(() => {
    const unpaid = items.filter((b) => b.status !== 'PAID').length
    const paid = items.filter((b) => b.status === 'PAID').length
    return { ALL: items.length, UNPAID: unpaid, PAID: paid }
  }, [items])

  function applyQuickFilter(next: 'ALL' | 'UNPAID' | 'PAID') {
    setQuickFilter(next)
    if (next === 'ALL') {
      setFilterStatus('')
      return
    }
    if (next === 'UNPAID') {
      // “未缴费”包含待支付和已逾期
      setFilterStatus('UNPAID_OR_OVERDUE')
      return
    }
    setFilterStatus('PAID')
  }

  return (
    <div className="m-col">
      {/* 筛选区域：可展开/折叠 */}
      <div className="m-card m-filter">
        <button
          type="button"
          className="m-filter-header"
          onClick={() => setFilterOpen((o) => !o)}
          aria-expanded={filterOpen}
        >
          <span className="m-filter-title">筛选条件</span>
          <span className="m-filter-chevron">{filterOpen ? '▼' : '▶'}</span>
        </button>
        {filterOpen && (
          <div className="m-filter-body">
            <div className="m-filter-row">
              <label className="m-filter-label">账单状态</label>
              <select
                className="m-filter-select"
                value={filterStatus}
                onChange={(e) => {
                  const next = e.target.value
                  setFilterStatus(next)
                  if (!next) setQuickFilter('ALL')
                  else if (next === 'PAID') setQuickFilter('PAID')
                  else setQuickFilter('UNPAID')
                }}
              >
                <option value="">全部</option>
                <option value="UNPAID_OR_OVERDUE">未缴费（待支付+已逾期）</option>
                <option value="UNPAID">待支付</option>
                <option value="OVERDUE">已逾期</option>
                <option value="PAID">已支付</option>
              </select>
            </div>
            <div className="m-filter-row">
              <label className="m-filter-label">账期（月）</label>
              <select
                className="m-filter-select"
                value={filterPeriod}
                onChange={(e) => setFilterPeriod(e.target.value)}
              >
                <option value="">全部</option>
                {allPeriods.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="m-filter-row">
              <label className="m-filter-label">门店</label>
              <select
                className="m-filter-select"
                value={filterStore}
                onChange={(e) => setFilterStore(e.target.value)}
              >
                <option value="">全部</option>
                {allStores.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="m-filter-row m-filter-rent-range">
              <label className="m-filter-label">应缴日期</label>
              <div className="m-filter-rent-inputs">
                <input
                  className="m-filter-input"
                  type="date"
                  value={filterDueStartDate}
                  onChange={(e) => setFilterDueStartDate(e.target.value)}
                />
                <span className="m-filter-rent-sep">~</span>
                <input
                  className="m-filter-input"
                  type="date"
                  value={filterDueEndDate}
                  onChange={(e) => setFilterDueEndDate(e.target.value)}
                />
              </div>
            </div>
            {(filterStatus || filterPeriod || filterStore || filterDueStartDate || filterDueEndDate) && (
              <button
                type="button"
                className="m-filter-clear"
                onClick={() => {
                  setFilterStatus('')
                  setFilterPeriod('')
                  setFilterStore('')
                  setFilterDueStartDate('')
                  setFilterDueEndDate('')
                  setQuickFilter('ALL')
                }}
              >
                清除筛选
              </button>
            )}
          </div>
        )}
      </div>

      {/* 快速筛选标签 */}
      <div className="m-quick-filters">
        <button
          type="button"
          className={`m-quick-filter-btn ${quickFilter === 'ALL' ? 'active' : ''}`}
          onClick={() => applyQuickFilter('ALL')}
        >
          全部（{quickCounts.ALL}）
        </button>
        <button
          type="button"
          className={`m-quick-filter-btn ${quickFilter === 'UNPAID' ? 'active' : ''}`}
          onClick={() => applyQuickFilter('UNPAID')}
        >
          未缴费（{quickCounts.UNPAID}）
        </button>
        <button
          type="button"
          className={`m-quick-filter-btn ${quickFilter === 'PAID' ? 'active' : ''}`}
          onClick={() => applyQuickFilter('PAID')}
        >
          已缴费（{quickCounts.PAID}）
        </button>
      </div>

      {error ? <div className="m-card m-error">加载失败：{error}</div> : null}

      {filtered.length === 0 && !error ? (
        <div className="m-card">
          <div style={{ fontWeight: 800 }}>暂无账单</div>
          <div className="m-muted" style={{ marginTop: 4 }}>
            没有符合当前筛选条件的账单，可以尝试修改筛选。
          </div>
        </div>
      ) : null}

      {groupedByContract.map((g) => (
        <ContractGroup key={g.key} bills={g.bills} sample={g.sample} />
      ))}
    </div>
  )
}

function statusText(status: string) {
  if (status === 'UNPAID') return '待支付'
  if (status === 'PAID') return '已支付'
  if (status === 'OVERDUE') return '已逾期'
  return status
}

function ContractGroup({ bills, sample }: { bills: MyBillSummary[]; sample?: MyBillSummary }) {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const { current, future, history } = useMemo(() => {
    const current: MyBillSummary[] = []
    const future: MyBillSummary[] = []
    const history: MyBillSummary[] = []
    bills.forEach((b) => {
      if (b.period === currentMonth) current.push(b)
      else if (b.period > currentMonth) future.push(b)
      else history.push(b)
    })
    return { current, future, history }
  }, [bills, currentMonth])

  if (!sample) return null

  return (
    <div className="m-col">
      <div className="m-card m-bill-contract">
        <div className="m-bill-contract-title">
          {sample.apartmentName} · {sample.houseNo}
        </div>
        <div className="m-bill-contract-meta">
          {sample.storeName} · 合同号：{sample.contractNo}
        </div>
      </div>

      {current.length > 0 ? (
        <div className="m-col">
          <div className="m-bill-section-title">本月账单</div>
          {current.map((b) => (
            <Link
              key={b.id}
              to={`/bills/${encodeURIComponent(b.id)}`}
              className="m-card m-bill-card"
              style={{ textDecoration: 'none' }}
            >
              <BillRow bill={b} />
            </Link>
          ))}
        </div>
      ) : null}

      {future.length > 0 ? (
        <div className="m-col">
          <div className="m-bill-section-title">未来账单（可提前缴费）</div>
          {future.map((b) => (
            <Link
              key={b.id}
              to={`/bills/${encodeURIComponent(b.id)}`}
              className="m-card m-bill-card"
              style={{ textDecoration: 'none' }}
            >
              <BillRow bill={b} />
            </Link>
          ))}
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="m-col">
          <div className="m-bill-section-title">历史账单</div>
          {history.map((b) => (
            <Link
              key={b.id}
              to={`/bills/${encodeURIComponent(b.id)}`}
              className="m-card m-bill-card"
              style={{ textDecoration: 'none' }}
            >
              <BillRow bill={b} />
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function BillRow({ bill }: { bill: MyBillSummary }) {
  const kindTag = bill.kind === 'ADJUSTMENT' ? '补缴' : bill.kind === 'BASE' ? '租金' : ''
  return (
    <div className="m-bill-row">
      <div className="m-bill-left">
        <div className="m-bill-period">
          <span>{bill.period}</span>
          {kindTag ? <span className="m-bill-pill">{kindTag}</span> : null}
        </div>
        <div className="m-bill-sub">应缴日期：{bill.dueDate}</div>
      </div>
      <div className="m-bill-right">
        <div className="m-bill-amount">¥{bill.totalAmount}</div>
        <div className={`m-bill-status ${statusClass(bill.status)}`}>{statusText(bill.status)}</div>
      </div>
    </div>
  )
}

function statusClass(status: string) {
  if (status === 'PAID') return 'paid'
  if (status === 'OVERDUE') return 'overdue'
  return 'unpaid'
}

function buildDemoBills(): MyBillSummary[] {
  // 演示：一个租客租期 1 年（12 期），租金固定；水电等不确定费用在 BASE 中先按 0
  const contractId = 'DEMO-CONTRACT-001'
  const contractNo = 'HT20260316001'
  const apartmentName = '良庆·悦居公寓'
  const houseNo = '330'
  const storeName = '南宁市-良庆区'
  const rentMonthly = 4200

  // 以当前月为起始月，往后生成 12 期
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const fmtPeriod = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const fmtYmd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1)

  const items: MyBillSummary[] = []

  for (let i = 0; i < 12; i += 1) {
    const monthStart = addMonths(start, i)
    const period = fmtPeriod(monthStart)
    const dueDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), 5) // 每月 5 号应缴
    items.push({
      id: `DEMO-BILL-${period}-BASE`,
      period,
      dueDate: fmtYmd(dueDate),
      totalAmount: rentMonthly,
      status: i === 0 ? 'UNPAID' : 'UNPAID', // 默认都待支付，方便演示提前缴费
      kind: 'BASE',
      contractId,
      contractNo,
      apartmentName,
      houseNo,
      storeName,
    })
  }

  // 为了演示“补缴”，给第 2 个月/第 5 个月各生成一条补缴情单
  const adj1Period = fmtPeriod(addMonths(start, 1))
  items.push({
    id: `DEMO-BILL-${adj1Period}-ADJ`,
    period: adj1Period,
    dueDate: fmtYmd(new Date(start.getFullYear(), start.getMonth() + 1, 20)),
    totalAmount: 260,
    status: 'UNPAID',
    kind: 'ADJUSTMENT',
    contractId,
    contractNo,
    apartmentName,
    houseNo,
    storeName,
  })

  const adj2Period = fmtPeriod(addMonths(start, 4))
  items.push({
    id: `DEMO-BILL-${adj2Period}-ADJ`,
    period: adj2Period,
    dueDate: fmtYmd(new Date(start.getFullYear(), start.getMonth() + 4, 20)),
    totalAmount: 318,
    status: 'UNPAID',
    kind: 'ADJUSTMENT',
    contractId,
    contractNo,
    apartmentName,
    houseNo,
    storeName,
  })

  // 按应缴日期倒序，和真实接口保持一致
  return items.sort((a, b) => (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0))
}


