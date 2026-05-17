import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api'
import { Pagination, paginate } from '../components/Pagination'

type ReportTab = 'receivable' | 'collected'

type AdminStore = { id: string; name: string }

type ReceivableRow = {
  billId: string
  storeName: string
  apartmentName: string
  houseNo: string
  houseBizId: string
  contractNo: string
  tenantName: string
  tenantPhone: string
  period: string
  dueDate: string
  totalAmount: number
  amountReceived: number
  amountRemaining: number
  status: string
}

type ReceivableSummary = {
  billCount: number
  totalReceivable: number
  totalReceived: number
  totalRemaining: number
  paidCount: number
  unpaidCount: number
  overdueCount: number
}

type CollectedRow = {
  id: string
  occurredAt: string
  channel: 'ONLINE' | 'OFFLINE'
  channelLabel: string
  amount: number
  storeName: string
  apartmentName: string
  houseNo: string
  houseBizId: string
  contractNo: string
  tenantName: string
  period: string
  dueDate: string
  note: string
}

type CollectedSummary = {
  txCount: number
  totalCollected: number
  onlineCount: number
  onlineAmount: number
  offlineCount: number
  offlineAmount: number
}

function currentPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthStartYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatContractNo(contractNo: string) {
  const digits = (contractNo || '').replace(/\D/g, '')
  return digits ? `HT${digits}` : contractNo
}

function fmtMoney(n: number) {
  return `¥${n.toLocaleString('zh-CN')}`
}

function fmtDt(iso: string) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

function statusLabel(status: string) {
  if (status === 'PAID') return '已支付'
  if (status === 'OVERDUE') return '逾期'
  if (status === 'UNPAID') return '待支付'
  return status
}

function statusClass(status: string) {
  if (status === 'PAID') return 'paid'
  if (status === 'OVERDUE') return 'overdue'
  return 'unpaid'
}

function buildQuery(params: Record<string, string | undefined>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    const t = (v ?? '').trim()
    if (t) p.set(k, t)
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>('receivable')
  const [stores, setStores] = useState<AdminStore[]>([])
  const [storeId, setStoreId] = useState('')
  const [periodFrom, setPeriodFrom] = useState(currentPeriod)
  const [periodTo, setPeriodTo] = useState(currentPeriod)
  const [collectedFrom, setCollectedFrom] = useState(monthStartYmd)
  const [collectedTo, setCollectedTo] = useState(todayYmd)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)

  const [receivableRows, setReceivableRows] = useState<ReceivableRow[]>([])
  const [receivableSummary, setReceivableSummary] = useState<ReceivableSummary | null>(null)
  const [collectedRows, setCollectedRows] = useState<CollectedRow[]>([])
  const [collectedSummary, setCollectedSummary] = useState<CollectedSummary | null>(null)

  useEffect(() => {
    apiGet<{ items: AdminStore[] }>('/api/admin/stores').then((r) => {
      if (r.ok) setStores(r.data.items ?? [])
    })
  }, [])

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    setPage(1)
    const base = { storeId: storeId || undefined, periodFrom: periodFrom || undefined, periodTo: periodTo || undefined }
    if (tab === 'receivable') {
      const r = await apiGet<{ rows: ReceivableRow[]; summary: ReceivableSummary }>(
        `/api/admin/reports/receivable${buildQuery(base)}`,
      )
      setLoading(false)
      if (!r.ok) return setError(r.error)
      setReceivableRows(r.data.rows ?? [])
      setReceivableSummary(r.data.summary ?? null)
    } else {
      const r = await apiGet<{ rows: CollectedRow[]; summary: CollectedSummary }>(
        `/api/admin/reports/collected${buildQuery({
          ...base,
          collectedFrom: collectedFrom || undefined,
          collectedTo: collectedTo || undefined,
        })}`,
      )
      setLoading(false)
      if (!r.ok) return setError(r.error)
      setCollectedRows(r.data.rows ?? [])
      setCollectedSummary(r.data.summary ?? null)
    }
  }, [tab, storeId, periodFrom, periodTo, collectedFrom, collectedTo])

  useEffect(() => {
    load()
  }, [tab])

  const activeRows = tab === 'receivable' ? receivableRows : collectedRows
  const pageData = useMemo(() => paginate(activeRows, page, 20), [activeRows, page])

  function resetFilters() {
    setStoreId('')
    setPeriodFrom(currentPeriod())
    setPeriodTo(currentPeriod())
    setCollectedFrom(monthStartYmd())
    setCollectedTo(todayYmd())
    setPage(1)
  }

  function exportCsv() {
    if (!activeRows.length) return
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    let header: string[]
    let lines: string[]
    if (tab === 'receivable') {
      header = ['门店', '公寓', '房号', '房源ID', '合同', '租客', '手机号', '账期', '到期日', '应收', '已收', '待收', '状态']
      lines = receivableRows.map((r) =>
        [
          r.storeName,
          r.apartmentName,
          r.houseNo,
          r.houseBizId,
          formatContractNo(r.contractNo),
          r.tenantName,
          r.tenantPhone,
          r.period,
          r.dueDate,
          r.totalAmount,
          r.amountReceived,
          r.amountRemaining,
          statusLabel(r.status),
        ]
          .map(esc)
          .join(','),
      )
    } else {
      header = ['收款时间', '渠道', '金额', '门店', '公寓', '房号', '合同', '租客', '账期', '到期日', '备注']
      lines = collectedRows.map((r) =>
        [
          fmtDt(r.occurredAt),
          r.channelLabel,
          r.amount,
          r.storeName,
          r.apartmentName,
          r.houseNo,
          formatContractNo(r.contractNo),
          r.tenantName,
          r.period,
          r.dueDate,
          r.note,
        ]
          .map(esc)
          .join(','),
      )
    }
    const csv = '\uFEFF' + [header.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${tab === 'receivable' ? '应收报表' : '实收报表'}_${todayYmd()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">报表管理</div>
        <div className="a-muted">
          按门店与账期查看经营数据。当前为系统根据账单与收款流水自动生成的模板，业主正式报表模板到位后可替换导出格式。
        </div>
      </div>

      <div className="a-card a-report-tabs-card">
        <div className="a-report-tabs" role="tablist" aria-label="报表类型">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'receivable'}
            className={`a-report-tab${tab === 'receivable' ? ' is-active' : ''}`}
            onClick={() => setTab('receivable')}
          >
            应收报表
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'collected'}
            className={`a-report-tab${tab === 'collected' ? ' is-active' : ''}`}
            onClick={() => setTab('collected')}
          >
            实收报表
          </button>
        </div>
        <div className="a-muted a-report-tab-desc">
          {tab === 'receivable'
            ? '按账期列出各合同账单的应收、已收与待收金额，不含暂停计费合同。'
            : '按收款发生日统计线上支付与线下核销实收，可与应收报表账期筛选联动。'}
        </div>
      </div>

      {error ? <div className="a-card a-error">加载失败：{error}</div> : null}
      <div className="a-card a-row" style={{ justifyContent: 'space-between' }}>
        <div className="a-filterbar" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="a-filter-label">筛选</span>
          <select
            className="a-filter-select"
            value={storeId}
            onChange={(e) => {
              setStoreId(e.target.value)
              setPage(1)
            }}
          >
            <option value="">全部门店</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="a-filter-label">账期</span>
          <input
            type="month"
            className="a-filter-input"
            value={periodFrom}
            onChange={(e) => {
              setPeriodFrom(e.target.value)
              setPage(1)
            }}
            title="账期起"
          />
          <span className="a-muted">至</span>
          <input
            type="month"
            className="a-filter-input"
            value={periodTo}
            onChange={(e) => {
              setPeriodTo(e.target.value)
              setPage(1)
            }}
            title="账期止"
          />
          {tab === 'collected' ? (
            <>
              <span className="a-filter-label">收款日</span>
              <input
                type="date"
                className="a-filter-input"
                value={collectedFrom}
                onChange={(e) => {
                  setCollectedFrom(e.target.value)
                  setPage(1)
                }}
              />
              <span className="a-muted">至</span>
              <input
                type="date"
                className="a-filter-input"
                value={collectedTo}
                onChange={(e) => {
                  setCollectedTo(e.target.value)
                  setPage(1)
                }}
              />
            </>
          ) : null}
          <button type="button" className="a-btn ghost" onClick={load} disabled={loading}>
            {loading ? '查询中…' : '查询'}
          </button>
          <button
            type="button"
            className="a-btn ghost"
            onClick={() => {
              resetFilters()
            }}
          >
            重置
          </button>
          <span className="a-muted">共 {activeRows.length} 条</span>
        </div>

        <div className="a-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="a-btn ghost" onClick={exportCsv}>
            导出
          </button>
          <button type="button" className="a-btn ghost" onClick={load} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {tab === 'receivable' && receivableSummary ? (
        <div className="a-report-summary-grid">
          <article className="a-report-kpi">
            <p className="a-report-kpi-label">应收合计</p>
            <p className="a-report-kpi-num">{fmtMoney(receivableSummary.totalReceivable)}</p>
            <p className="a-report-kpi-foot">{receivableSummary.billCount} 笔账单</p>
          </article>
          <article className="a-report-kpi a-report-kpi--green">
            <p className="a-report-kpi-label">已收合计</p>
            <p className="a-report-kpi-num">{fmtMoney(receivableSummary.totalReceived)}</p>
            <p className="a-report-kpi-foot">已支付 {receivableSummary.paidCount} 笔</p>
          </article>
          <article className="a-report-kpi a-report-kpi--amber">
            <p className="a-report-kpi-label">待收合计</p>
            <p className="a-report-kpi-num">{fmtMoney(receivableSummary.totalRemaining)}</p>
            <p className="a-report-kpi-foot">
              待付 {receivableSummary.unpaidCount} · 逾期 {receivableSummary.overdueCount}
            </p>
          </article>
        </div>
      ) : null}

      {tab === 'collected' && collectedSummary ? (
        <div className="a-report-summary-grid">
          <article className="a-report-kpi a-report-kpi--green">
            <p className="a-report-kpi-label">实收合计</p>
            <p className="a-report-kpi-num">{fmtMoney(collectedSummary.totalCollected)}</p>
            <p className="a-report-kpi-foot">{collectedSummary.txCount} 笔收款</p>
          </article>
          <article className="a-report-kpi">
            <p className="a-report-kpi-label">线上支付</p>
            <p className="a-report-kpi-num">{fmtMoney(collectedSummary.onlineAmount)}</p>
            <p className="a-report-kpi-foot">{collectedSummary.onlineCount} 笔</p>
          </article>
          <article className="a-report-kpi a-report-kpi--slate">
            <p className="a-report-kpi-label">线下核销</p>
            <p className="a-report-kpi-num">{fmtMoney(collectedSummary.offlineAmount)}</p>
            <p className="a-report-kpi-foot">{collectedSummary.offlineCount} 笔</p>
          </article>
        </div>
      ) : null}

      <div className="a-card">
        {tab === 'receivable' ? (
          <div className="a-table-wrap">
            <table className="a-table a-table-sticky-op">
              <thead>
                <tr>
                  <th>门店</th>
                  <th>公寓</th>
                  <th>房号</th>
                  <th>合同</th>
                  <th>租客</th>
                  <th>账期</th>
                  <th>到期日</th>
                  <th>应收</th>
                  <th>已收</th>
                  <th>待收</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {pageData.items.map((r) => (
                  <tr key={r.billId}>
                    <td className="a-muted">{r.storeName}</td>
                    <td>{r.apartmentName}</td>
                    <td style={{ fontWeight: 700 }}>{r.houseNo}</td>
                    <td style={{ fontWeight: 700 }}>{formatContractNo(r.contractNo)}</td>
                    <td>{r.tenantName}</td>
                    <td>{r.period}</td>
                    <td>{r.dueDate}</td>
                    <td style={{ fontWeight: 800 }}>{fmtMoney(r.totalAmount)}</td>
                    <td className="a-muted">{fmtMoney(r.amountReceived)}</td>
                    <td style={{ fontWeight: 800, color: r.amountRemaining > 0 ? '#b45309' : '#64748b' }}>
                      {fmtMoney(r.amountRemaining)}
                    </td>
                    <td>
                      <span className={`a-badge status-${statusClass(r.status)}`}>{statusLabel(r.status)}</span>
                    </td>
                  </tr>
                ))}
                {!loading && pageData.items.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="a-muted">
                      当前筛选条件下暂无账单数据。可调整账期或门店后重新查询。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="a-table-wrap">
            <table className="a-table a-table-sticky-op">
              <thead>
                <tr>
                  <th>收款时间</th>
                  <th>渠道</th>
                  <th>金额</th>
                  <th>门店</th>
                  <th>公寓</th>
                  <th>房号</th>
                  <th>合同</th>
                  <th>租客</th>
                  <th>账期</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {pageData.items.map((r) => (
                  <tr key={r.id}>
                    <td className="a-muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                      {fmtDt(r.occurredAt)}
                    </td>
                    <td>
                      <span className={`a-badge ${r.channel === 'ONLINE' ? 'status-paid' : 'status-wait-stamp'}`}>
                        {r.channelLabel}
                      </span>
                    </td>
                    <td style={{ fontWeight: 800 }}>{fmtMoney(r.amount)}</td>
                    <td className="a-muted">{r.storeName}</td>
                    <td>{r.apartmentName}</td>
                    <td style={{ fontWeight: 700 }}>{r.houseNo}</td>
                    <td style={{ fontWeight: 700 }}>{formatContractNo(r.contractNo)}</td>
                    <td>{r.tenantName}</td>
                    <td>{r.period}</td>
                    <td className="a-muted" style={{ fontSize: 12, maxWidth: 160 }}>
                      {r.note}
                    </td>
                  </tr>
                ))}
                {!loading && pageData.items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="a-muted">
                      当前筛选条件下暂无收款记录。可扩大收款日范围或调整账期后查询。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} totalPages={pageData.totalPages} onPageChange={setPage} />
      </div>
    </div>
  )
}
