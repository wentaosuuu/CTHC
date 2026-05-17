import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPost, getTenantPhone, type MyBillSummary } from '../api'
import { shortPayBlockedHint } from '../billPayHint'
import { buildMergedDemoBaseLineItems } from '../mergedDemoBill'

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
  const [selectedBillIds, setSelectedBillIds] = useState<Set<string>>(() => new Set())
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchMsg, setBatchMsg] = useState('')

  const phone = getTenantPhone()

  const reloadBills = useCallback(async () => {
    if (!phone) {
      setItems(buildDemoBills())
      return
    }
    setError('')
    const r = await apiGet<{ items: MyBillSummary[] }>('/api/bills', {
      headers: { 'x-tenant-phone': phone },
    })
    if (!r.ok) {
      setError(r.error)
      setItems(buildDemoBills())
      return
    }
    const list = r.data.items
    if (!list || list.length === 0) {
      setItems(buildDemoBills())
    } else {
      setItems(dedupeBillsById(augmentApiBillsWithMergedDemo(list)))
    }
  }, [phone])

  useEffect(() => {
    void reloadBills()
  }, [reloadBills])

  useEffect(() => {
    setSelectedBillIds(new Set())
  }, [phone])

  const batchTotal = useMemo(() => {
    let s = 0
    items.forEach((b) => {
      if (!selectedBillIds.has(b.id)) return
      if (b.status === 'PAID') return
      const rem = typeof b.amountRemaining === 'number' ? b.amountRemaining : b.totalAmount
      s += rem
    })
    return s
  }, [items, selectedBillIds])

  function toggleBillSelect(id: string) {
    setSelectedBillIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function paySelectedBills() {
    if (!phone) return
    setBatchMsg('')
    const ids = [...selectedBillIds]
    if (ids.length === 0) return
    if (ids.some((id) => id.startsWith('DEMO-'))) {
      setBatchMsg('演示账单不支持合并支付，请取消勾选以「DEMO-」开头的项，或在各账单详情页单笔支付。')
      return
    }
    setBatchLoading(true)
    const r = await apiPost<{ ok: true; paidCount: number; totalAmount: number; paidAt: string }>(
      '/api/bills/pay-batch',
      { billIds: ids },
      { headers: { 'x-tenant-phone': phone } },
    )
    setBatchLoading(false)
    if (!r.ok) {
      setBatchMsg(typeof r.error === 'string' ? r.error : '合并支付失败')
      return
    }
    setSelectedBillIds(new Set())
    setBatchMsg(`已合并支付 ${r.data.paidCount} 笔，合计 ¥${r.data.totalAmount}。`)
    await reloadBills()
  }

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
    <div className={`m-col${phone && selectedBillIds.size > 0 ? ' m-col--batch-dock' : ''}`}>
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

      {phone ? (
        <div className="m-card m-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
          每笔账单需在详情页<strong>一次性缴清该单全部收费项</strong>。同一合同须<strong>先结清更早账期欠费</strong>，再支付较新账单。列表可勾选多笔待付账单合并支付（须含全部更早欠费）。
        </div>
      ) : null}

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
        <ContractGroup
          key={g.key}
          bills={g.bills}
          sample={g.sample}
          selectedBillIds={selectedBillIds}
          onToggleBill={toggleBillSelect}
        />
      ))}

      {phone && selectedBillIds.size > 0 ? (
        <div className="m-batch-pay-dock">
          <div className="m-batch-pay-dock-inner">
            <div className="m-batch-pay-meta">
              <div style={{ fontWeight: 800 }}>已选 {selectedBillIds.size} 笔</div>
              <div className="m-muted" style={{ fontSize: 13 }}>
                合计 ¥{batchTotal}
              </div>
            </div>
            <button
              type="button"
              className="m-btn m-batch-pay-btn"
              disabled={batchLoading}
              onClick={() => void paySelectedBills()}
            >
              {batchLoading ? '支付中…' : '合并支付'}
            </button>
          </div>
        </div>
      ) : null}

      {batchMsg ? (
        <div className="m-card" style={{ fontSize: 14 }}>
          {batchMsg}
        </div>
      ) : null}
    </div>
  )
}

function statusText(status: string) {
  if (status === 'UNPAID') return '待支付'
  if (status === 'PAID') return '已支付'
  if (status === 'OVERDUE') return '已逾期'
  return status
}

function BillCardSelectable({
  bill,
  selected,
  onToggle,
  rowKey,
}: {
  bill: MyBillSummary
  selected: boolean
  onToggle: () => void
  /** 避免不同分组下重复 bill.id 导致 React key 冲突 */
  rowKey: string
}) {
  const payable = bill.status === 'UNPAID' || bill.status === 'OVERDUE'
  const selectable = payable && !bill.payBlockedReason
  const inputId = `bill-sel-${rowKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  return (
    <div className="m-card m-bill-card">
      <div className="m-bill-card-inner">
        {selectable ? (
          <label className="m-bill-select-hit" htmlFor={inputId} onClick={(e) => e.stopPropagation()}>
            <input
              id={inputId}
              type="checkbox"
              checked={selected}
              onChange={() => onToggle()}
              onClick={(e) => e.stopPropagation()}
              aria-label="选择合并支付"
            />
          </label>
        ) : null}
        <Link
          to={`/bills/${encodeURIComponent(bill.id)}`}
          className="m-bill-card-body m-bill-card-link"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <BillRow bill={bill} />
        </Link>
      </div>
    </div>
  )
}

function ContractGroup({
  bills,
  sample,
  selectedBillIds,
  onToggleBill,
}: {
  bills: MyBillSummary[]
  sample?: MyBillSummary
  selectedBillIds: Set<string>
  onToggleBill: (id: string) => void
}) {
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
          {sample.mergedUnits && sample.mergedUnits.length > 1
            ? `合并合同 · ${sample.mergedUnits.length} 套房源`
            : `${sample.apartmentName} · ${sample.houseNo}`}
        </div>
        {sample.mergedUnits && sample.mergedUnits.length > 1 ? (
          <div className="m-bill-bundle-units">
            {sample.mergedUnits.map((u) => (
              <div key={`${u.apartmentName}-${u.houseNo}`}>
                {u.apartmentName} · {u.houseNo}
              </div>
            ))}
          </div>
        ) : null}
        <div className="m-bill-contract-meta">
          {sample.storeName} · 合同号：{sample.contractNo}
        </div>
      </div>

      {current.length > 0 ? (
        <div className="m-col">
          <div className="m-bill-section-title">本月账单</div>
          {current.map((b) => (
            <BillCardSelectable
              key={`cur-${b.id}`}
              rowKey={`cur-${b.id}`}
              bill={b}
              selected={selectedBillIds.has(b.id)}
              onToggle={() => onToggleBill(b.id)}
            />
          ))}
        </div>
      ) : null}

      {future.length > 0 ? (
        <div className="m-col">
          <div className="m-bill-section-title">未来账单（可提前缴费）</div>
          {future.map((b) => (
            <BillCardSelectable
              key={`fut-${b.id}`}
              rowKey={`fut-${b.id}`}
              bill={b}
              selected={selectedBillIds.has(b.id)}
              onToggle={() => onToggleBill(b.id)}
            />
          ))}
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="m-col">
          <div className="m-bill-section-title">历史账单</div>
          {history.map((b) => (
            <BillCardSelectable
              key={`hist-${b.id}`}
              rowKey={`hist-${b.id}`}
              bill={b}
              selected={selectedBillIds.has(b.id)}
              onToggle={() => onToggleBill(b.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function BillRow({ bill }: { bill: MyBillSummary }) {
  const kindTag = bill.kind === 'ADJUSTMENT' ? '补缴' : bill.kind === 'BASE' ? '账单' : ''
  return (
    <div className="m-bill-row">
      <div className="m-bill-left">
        <div className="m-bill-period">
          <span>{bill.period}</span>
          {kindTag ? <span className="m-bill-pill">{kindTag}</span> : null}
        </div>
        {bill.mergedUnits && bill.mergedUnits.length > 1 ? (
          <div className="m-bill-sub">合并合同 · {bill.mergedUnits.length} 套房源</div>
        ) : null}
        <div className="m-bill-sub">应缴日期：{bill.dueDate}</div>
        {bill.payBlockedReason ? (
          <div className="m-bill-pay-blocked">{shortPayBlockedHint(bill.payBlockedReason)}</div>
        ) : null}
        {bill.status !== 'PAID' && typeof bill.amountRemaining === 'number' && bill.amountRemaining > 0 && (bill.amountReceived ?? 0) > 0 ? (
          <div className="m-bill-sub">已收 ¥{bill.amountReceived ?? 0} · 尚欠 ¥{bill.amountRemaining}</div>
        ) : null}
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

function billDemoMonthHelpers() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const fmtPeriod = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const fmtYmd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1)
  return { start, fmtPeriod, fmtYmd, addMonths }
}

/** 多套合并一单的本地样例（与接口字段 mergedUnits 对齐） */
function buildDemoMergedBillsOnly(): MyBillSummary[] {
  const { start, fmtPeriod, fmtYmd, addMonths } = billDemoMonthHelpers()
  const mergedUnits: { apartmentName: string; houseNo: string }[] = [
    { apartmentName: '江南·梧桐公寓', houseNo: '624' },
    { apartmentName: '西乡塘·青年社区', houseNo: '927' },
    { apartmentName: '邕宁·花园公寓', houseNo: '514' },
  ]
  const mergedContractId = 'DEMO-CONTRACT-MRG'
  const mergedContractNo = 'HT20260288118'
  const mergedPrimaryApt = mergedUnits[0]!.apartmentName
  const mergedPrimaryNo = mergedUnits[0]!.houseNo
  const mergedStore = '南宁市-江南区'
  const mergedBaseTotal = buildMergedDemoBaseLineItems().totalAmount
  const items: MyBillSummary[] = []

  for (let i = 0; i < 6; i += 1) {
    const monthStart = addMonths(start, i)
    const period = fmtPeriod(monthStart)
    const dueDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), 8)
    items.push({
      id: `DEMO-BILL-MRG-${period}-BASE`,
      period,
      dueDate: fmtYmd(dueDate),
      totalAmount: mergedBaseTotal,
      status: 'UNPAID',
      kind: 'BASE',
      contractId: mergedContractId,
      contractNo: mergedContractNo,
      apartmentName: mergedPrimaryApt,
      houseNo: mergedPrimaryNo,
      storeName: mergedStore,
      mergedUnits,
    })
  }

  const mrgAdjPeriod = fmtPeriod(addMonths(start, 2))
  items.push({
    id: `DEMO-BILL-MRG-${mrgAdjPeriod}-ADJ`,
    period: mrgAdjPeriod,
    dueDate: fmtYmd(new Date(start.getFullYear(), start.getMonth() + 2, 22)),
    totalAmount: 186,
    status: 'UNPAID',
    kind: 'ADJUSTMENT',
    contractId: mergedContractId,
    contractNo: mergedContractNo,
    apartmentName: mergedPrimaryApt,
    houseNo: mergedPrimaryNo,
    storeName: mergedStore,
    mergedUnits,
  })

  return items
}

function listHasMergedBundle(list: MyBillSummary[]) {
  return list.some(
    (b) =>
      (b.mergedUnits && b.mergedUnits.length > 1) ||
      b.contractNo === 'HT20260288118' ||
      b.contractId === 'DEMO-CONTRACT-MRG',
  )
}

function dedupeBillsById(list: MyBillSummary[]): MyBillSummary[] {
  const seen = new Set<string>()
  const out: MyBillSummary[] = []
  for (const b of list) {
    if (seen.has(b.id)) continue
    seen.add(b.id)
    out.push(b)
  }
  return out
}

function augmentApiBillsWithMergedDemo(list: MyBillSummary[]): MyBillSummary[] {
  if (listHasMergedBundle(list)) return list
  return [...buildDemoMergedBillsOnly(), ...list].sort((a, b) =>
    a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0,
  )
}

function buildDemoBills(): MyBillSummary[] {
  const contractId = 'DEMO-CONTRACT-001'
  const contractNo = 'HT20260316001'
  const apartmentName = '良庆·悦居公寓'
  const houseNo = '330'
  const storeName = '南宁市-良庆区'
  const rentMonthly = 4200

  const { start, fmtPeriod, fmtYmd, addMonths } = billDemoMonthHelpers()

  const items: MyBillSummary[] = []

  for (let i = 0; i < 12; i += 1) {
    const monthStart = addMonths(start, i)
    const period = fmtPeriod(monthStart)
    const dueDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), 5)
    items.push({
      id: `DEMO-BILL-${period}-BASE`,
      period,
      dueDate: fmtYmd(dueDate),
      totalAmount: rentMonthly,
      status: 'UNPAID',
      kind: 'BASE',
      contractId,
      contractNo,
      apartmentName,
      houseNo,
      storeName,
    })
  }

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

  return [...buildDemoMergedBillsOnly(), ...items].sort((a, b) =>
    a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0,
  )
}


