import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '../api'
import { Pagination, paginate } from '../components/Pagination'

type OverdueItem = {
  billId: string
  contractNo: string
  houseBizId: string
  apartmentName: string
  houseNo: string
  storeName: string
  tenantName: string
  tenantPhone: string
  period: string
  dueDate: string
  totalAmount: number
  daysOverdue: number
  penalty: number
}

type BillDetail = {
  id: string
  contractNo: string
  apartmentName: string
  houseNo: string
  storeName: string
  tenantName: string
  tenantPhone: string
  period: string
  dueDate: string
  totalAmount: number
  amountReceived: number
  amountRemaining: number
  status: string
  items: { name: string; amount: number }[]
}

type PeriodDetail = BillDetail & {
  daysOverdue: number
  penalty: number
}

type DetailModal = {
  contractNo: string
  apartmentName: string
  houseNo: string
  storeName: string
  tenantName: string
  tenantPhone: string
  periods: PeriodDetail[]
  focusBillId: string
}

function formatContractNo(contractNo: string) {
  const digits = (contractNo || '').replace(/\D/g, '')
  return digits ? `HT${digits}` : contractNo
}

function sortOverdueRows(a: OverdueItem, b: OverdueItem) {
  return a.period.localeCompare(b.period) || a.dueDate.localeCompare(b.dueDate)
}

function OverduePeriodAccordion({
  period,
  expanded,
  onToggle,
  highlighted,
}: {
  period: PeriodDetail
  expanded: boolean
  onToggle: () => void
  highlighted: boolean
}) {
  const remaining =
    period.amountRemaining ?? Math.max(0, period.totalAmount - (period.amountReceived ?? 0))
  const totalDue = remaining + period.penalty

  return (
    <div className={`a-overdue-period-card${highlighted ? ' is-focus' : ''}`}>
      <button
        type="button"
        className="a-overdue-period-card-head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="a-overdue-period-chevron" aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
        <span className="a-overdue-period-badge">账期 {period.period}</span>
        <span className="a-overdue-period-head-meta">到期 {period.dueDate}</span>
        <span className="a-overdue-period-head-meta">逾期 {period.daysOverdue} 天</span>
        {period.penalty > 0 ? (
          <span className="a-overdue-period-head-meta">滞纳金 ¥{period.penalty}</span>
        ) : null}
        <span className="a-overdue-period-head-due">待缴 ¥{totalDue}</span>
      </button>
      {expanded ? (
        <div className="a-overdue-period-card-body">
          <div className="a-overdue-period-summary">
            <span>账单 ¥{period.totalAmount}</span>
            {(period.amountReceived ?? 0) > 0 ? (
              <span>已收 ¥{period.amountReceived} · 尚欠 ¥{remaining}</span>
            ) : null}
            {period.penalty > 0 ? <span>含滞纳金 ¥{period.penalty}</span> : null}
          </div>
          {(period.items ?? []).length > 0 ? (
            <table className="a-overdue-fee-table">
              <thead>
                <tr>
                  <th>收费项目</th>
                  <th style={{ textAlign: 'right', width: 120 }}>金额</th>
                </tr>
              </thead>
              <tbody>
                {period.items.map((it) => (
                  <tr key={it.name}>
                    <td>{it.name}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>¥{it.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="a-muted" style={{ fontSize: 13, padding: '4px 0' }}>
              暂无分项明细
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

export function OverduePage() {
  const [items, setItems] = useState<OverdueItem[]>([])
  const [error, setError] = useState('')
  const [rule, setRule] = useState('')
  const [msg, setMsg] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [q, setQ] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [apartmentFilter, setApartmentFilter] = useState('')
  const [overdueRange, setOverdueRange] = useState('')

  const [detailModal, setDetailModal] = useState<DetailModal | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [expandedPeriodIds, setExpandedPeriodIds] = useState<Set<string>>(() => new Set())

  function resetOverdueFilters() {
    setQ('')
    setStoreFilter('')
    setApartmentFilter('')
    setOverdueRange('')
    setPage(1)
  }

  function closeDetailModal() {
    setDetailModal(null)
    setDetailError('')
    setExpandedPeriodIds(new Set())
  }

  const [smsModal, setSmsModal] = useState<{
    item: OverdueItem
    message: string
  } | null>(null)
  const [smsSubmitting, setSmsSubmitting] = useState(false)

  async function load() {
    setError('')
    setMsg('')
    const r = await apiGet<{ items: OverdueItem[]; rule: string }>('/api/admin/bills/overdue')
    if (!r.ok) return setError(r.error)
    setItems(r.data.items)
    setRule(r.data.rule)
  }

  async function openDetail(row: OverdueItem) {
    setDetailError('')
    setDetailLoading(true)
    setDetailModal(null)
    setExpandedPeriodIds(new Set([row.billId]))

    const contractRows = items.filter((x) => x.contractNo === row.contractNo).sort(sortOverdueRows)
    const rowsToLoad = contractRows.length > 0 ? contractRows : [row]

    const results = await Promise.all(
      rowsToLoad.map(async (r) => {
        const res = await apiGet<BillDetail>(`/api/admin/bills/${r.billId}`)
        if (!res.ok) return { ok: false as const, error: res.error, billId: r.billId }
        return {
          ok: true as const,
          period: {
            ...res.data,
            amountRemaining:
              res.data.amountRemaining ?? Math.max(0, res.data.totalAmount - (res.data.amountReceived ?? 0)),
            daysOverdue: r.daysOverdue,
            penalty: r.penalty,
          },
        }
      }),
    )

    setDetailLoading(false)

    const failed = results.find((x) => !x.ok)
    if (failed && !failed.ok) {
      setDetailError(failed.error)
      return
    }

    const periods = results
      .filter((x): x is { ok: true; period: PeriodDetail } => x.ok)
      .map((x) => x.period)
      .sort((a, b) => a.period.localeCompare(b.period) || a.dueDate.localeCompare(b.dueDate))

    const sample = periods[0] ?? null
    setDetailModal({
      contractNo: row.contractNo,
      apartmentName: sample?.apartmentName ?? row.apartmentName,
      houseNo: sample?.houseNo ?? row.houseNo,
      storeName: sample?.storeName ?? row.storeName,
      tenantName: sample?.tenantName ?? row.tenantName,
      tenantPhone: sample?.tenantPhone ?? row.tenantPhone,
      periods,
      focusBillId: row.billId,
    })
    setExpandedPeriodIds(new Set([row.billId]))
  }

  function togglePeriodExpand(billId: string) {
    setExpandedPeriodIds((prev) => {
      const next = new Set(prev)
      if (next.has(billId)) next.delete(billId)
      else next.add(billId)
      return next
    })
  }

  useEffect(() => {
    load()
  }, [])

  const filterOptions = useMemo(() => {
    const stores = Array.from(new Set(items.map((x) => x.storeName).filter(Boolean))).sort()
    const apartments = Array.from(new Set(items.map((x) => x.apartmentName).filter(Boolean))).sort()
    return { stores, apartments }
  }, [items])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return items.filter((x) => {
      if (storeFilter && x.storeName !== storeFilter) return false
      if (apartmentFilter && x.apartmentName !== apartmentFilter) return false
      if (overdueRange) {
        const d = x.daysOverdue
        if (overdueRange === '7' && d > 7) return false
        if (overdueRange === '30' && (d <= 7 || d > 30)) return false
        if (overdueRange === '90' && (d <= 30 || d > 90)) return false
        if (overdueRange === '90+' && d <= 90) return false
      }
      if (!kw) return true
      const hay = `${x.contractNo} ${x.houseBizId} ${x.storeName} ${x.apartmentName} ${x.houseNo} ${x.tenantName} ${x.tenantPhone} ${x.period}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, storeFilter, apartmentFilter, overdueRange])

  const pageData = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize])

  const detailTotals = useMemo(() => {
    if (!detailModal) return null
    let billRemaining = 0
    let penalty = 0
    detailModal.periods.forEach((p) => {
      const rem = p.amountRemaining ?? Math.max(0, p.totalAmount - (p.amountReceived ?? 0))
      billRemaining += rem
      penalty += p.penalty
    })
    return { billRemaining, penalty, total: billRemaining + penalty, count: detailModal.periods.length }
  }, [detailModal])

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">欠费预警</div>
        <div className="a-muted">{rule}</div>
      </div>

      {error ? <div className="a-card a-error">加载失败：{error}</div> : null}
      {msg ? <div className="a-card a-success">{msg}</div> : null}

      <div className="a-card a-row" style={{ justifyContent: 'space-between' }}>
        <div className="a-filterbar" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="a-filter-label">筛选</span>
          <input
            className="a-filter-input"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1) }}
            placeholder="搜索：合同号/房源ID/租客/手机号/门店/房号/账期"
            style={{ minWidth: 160 }}
          />
          <select
            className="a-filter-select"
            value={storeFilter}
            onChange={(e) => { setStoreFilter(e.target.value); setPage(1) }}
            title="所属门店"
          >
            <option value="">全部门店</option>
            {filterOptions.stores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            className="a-filter-select"
            value={apartmentFilter}
            onChange={(e) => { setApartmentFilter(e.target.value); setPage(1) }}
            title="公寓"
          >
            <option value="">全部公寓</option>
            {filterOptions.apartments.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select
            className="a-filter-select"
            value={overdueRange}
            onChange={(e) => { setOverdueRange(e.target.value); setPage(1) }}
            title="逾期天数"
          >
            <option value="">全部逾期</option>
            <option value="7">7 天内</option>
            <option value="30">7～30 天</option>
            <option value="90">30～90 天</option>
            <option value="90+">90 天以上</option>
          </select>
          <button className="a-btn ghost" onClick={() => setPage(1)} title="使用当前筛选条件进行查询">
            查询
          </button>
          <button className="a-btn ghost" onClick={resetOverdueFilters} title="清空筛选条件">
            重置
          </button>
          <span className="a-muted">逾期账单 {filtered.length} 条</span>
        </div>
        <button className="a-btn ghost" onClick={load}>
          刷新
        </button>
      </div>

      <div className="a-card">
        <div className="a-table-wrap">
        <table className="a-table a-table-sticky-op">
          <thead>
            <tr>
              <th>合同</th>
              <th>房源ID</th>
              <th>公寓</th>
              <th>房号</th>
              <th>所属门店</th>
              <th>租客</th>
              <th>手机号</th>
              <th>账期</th>
              <th>到期日</th>
              <th>金额</th>
              <th>逾期天数</th>
              <th>滞纳金</th>
              <th className="a-op-col">操作</th>
            </tr>
          </thead>
          <tbody>
            {pageData.items.map((x) => (
              <tr key={x.billId}>
                <td>
                  <span style={{ fontWeight: 600 }}>{formatContractNo(x.contractNo)}</span>
                </td>
                <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{x.houseBizId}</td>
                <td style={{ fontWeight: 600 }}>{x.apartmentName}</td>
                <td style={{ fontWeight: 600 }}>{x.houseNo}</td>
                <td className="a-muted">{x.storeName}</td>
                <td>{x.tenantName}</td>
                <td>{x.tenantPhone}</td>
                <td>{x.period}</td>
                <td>{x.dueDate}</td>
                <td>¥{x.totalAmount}</td>
                <td>{x.daysOverdue}</td>
                <td>¥{x.penalty}</td>
                <td className="a-op-cell">
                  <div className="a-op-actions">
                    <button
                      type="button"
                      className="a-btn ghost"
                      onClick={() => void openDetail(x)}
                    >
                      查看明细
                    </button>
                    <button
                      type="button"
                      className="a-btn ghost"
                      onClick={() => {
                        const totalDue = x.totalAmount + x.penalty
                        const tpl =
                          `【公寓租赁】${x.tenantName}，您好！您合同 ${formatContractNo(x.contractNo)} 的账单（账期 ${x.period}）已逾期 ${x.daysOverdue} 天，` +
                          `应缴合计 ¥${totalDue}（账单¥${x.totalAmount} + 滞纳金¥${x.penalty}）。请尽快完成缴费，如已支付请忽略。`
                        setSmsModal({ item: x, message: tpl })
                      }}
                    >
                      发催租短信
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={13} className="a-muted">
                  暂无逾期账单（你也可以把本机日期往后调来模拟）。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        </div>

        <Pagination
          total={pageData.total}
          page={pageData.page}
          pageSize={pageData.pageSize}
          onChange={(p) => {
            setPage(p.page)
            setPageSize(p.pageSize)
          }}
        />
      </div>

      {(detailModal || detailLoading || detailError) && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDetailModal()
          }}
        >
          <div className="a-modal a-overdue-detail-modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">
                {detailModal
                  ? `欠费明细 · ${formatContractNo(detailModal.contractNo)}`
                  : '欠费明细'}
              </div>
              <button type="button" className="a-modal-close" onClick={closeDetailModal}>
                关闭
              </button>
            </div>
            <div className="a-modal-body a-overdue-detail-body">
              {detailLoading ? <div className="a-muted">加载中…</div> : null}
              {detailError ? <div className="a-error">加载失败：{detailError}</div> : null}
              {detailModal ? (
                <>
                  <div className="a-overdue-detail-summary">
                    <div className="a-overdue-detail-summary-row">
                      <span className="label">房源</span>
                      <span className="value">
                        {detailModal.apartmentName} {detailModal.houseNo}（{detailModal.storeName}）
                      </span>
                    </div>
                    <div className="a-overdue-detail-summary-row">
                      <span className="label">租客</span>
                      <span className="value">
                        {detailModal.tenantName} {detailModal.tenantPhone}
                      </span>
                    </div>
                    {detailTotals ? (
                      <div className="a-overdue-detail-summary-row total">
                        <span className="label">欠费合计</span>
                        <span className="value">
                          ¥{detailTotals.total}
                          <em>
                            {detailTotals.count} 期 · 账单 ¥{detailTotals.billRemaining}
                            {detailTotals.penalty > 0 ? ` + 滞纳金 ¥${detailTotals.penalty}` : ''}
                          </em>
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="a-overdue-detail-section-title">逾期账期（点击行展开收费明细）</div>
                  <div className="a-overdue-period-list">
                    {detailModal.periods.map((p) => (
                      <OverduePeriodAccordion
                        key={p.id}
                        period={p}
                        expanded={expandedPeriodIds.has(p.id)}
                        onToggle={() => togglePeriodExpand(p.id)}
                        highlighted={p.id === detailModal.focusBillId}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {smsModal && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setSmsModal(null)}
        >
          <div className="a-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">
                发催租短信 · {smsModal.item.tenantName} {smsModal.item.period}
              </div>
              <button type="button" className="a-modal-close" onClick={() => setSmsModal(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">发送对象</div>
                  <div className="a-kv-v">
                    {smsModal.item.tenantName}（{smsModal.item.tenantPhone}）
                    <span className="a-muted" style={{ marginLeft: 8 }}>
                      合同：{formatContractNo(smsModal.item.contractNo)}
                    </span>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">短信内容</div>
                  <div className="a-kv-v">
                    <textarea
                      className="a-filter-input"
                      value={smsModal.message}
                      onChange={(e) => setSmsModal({ ...smsModal, message: e.target.value })}
                      style={{ width: '100%', minHeight: 120, resize: 'vertical' }}
                      placeholder="可编辑短信内容（仅记录台账，不会真实发出）"
                    />
                    <div className="a-muted" style={{ marginTop: 6, fontSize: 12 }}>
                      提示：点击发送将写入「催租记录」台账；正式环境需对接短信网关。
                    </div>
                  </div>
                </div>
              </div>

              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <button
                  type="button"
                  className="a-btn"
                  disabled={smsSubmitting || !smsModal.message.trim()}
                  onClick={async () => {
                    setSmsSubmitting(true)
                    setError('')
                    setMsg('')
                    const r = await apiPost<{ ok: true; id: string; sentAt: string }>(
                      `/api/admin/bills/${smsModal.item.billId}/send-rent-reminder`,
                      { message: smsModal.message.trim(), penaltySnapshot: smsModal.item.penalty },
                    )
                    setSmsSubmitting(false)
                    if (!r.ok) {
                      setError(r.error)
                      return
                    }
                    setMsg('已发送并写入催租记录')
                    setSmsModal(null)
                  }}
                >
                  {smsSubmitting ? '发送中…' : '确认发送'}
                </button>
                <button type="button" className="a-btn ghost" onClick={() => setSmsModal(null)} disabled={smsSubmitting}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
