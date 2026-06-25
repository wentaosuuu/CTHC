import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api'
import { Pagination, paginate } from '../components/Pagination'

type RentReminderItem = {
  id: string
  sentAt: string
  billId: string
  contractId: string
  period: string
  dueDate: string
  billAmount: number
  penalty: number
  totalDue: number
  tenantName: string
  tenantPhone: string
  storeName: string
  apartmentName: string
  houseNo: string
  message: string
}

// 账单编号展示：ZD + 固定长度数字（演示用，可替换为后端真实编号规则）
function formatBillNo(billId: string, digits = 10) {
  let h = 0
  for (let i = 0; i < billId.length; i += 1) h = (h * 31 + billId.charCodeAt(i)) >>> 0
  const s = String(h).padStart(digits, '0')
  return `ZD${s.slice(-digits)}`
}

function fmtDt(iso: string) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${dd} ${hh}:${mm}`
  } catch {
    return iso
  }
}

function shortText(s: string, max = 40) {
  const t = (s || '').trim()
  if (!t) return '—'
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function csvEscape(v: unknown) {
  const s = String(v ?? '')
  const needs = /[",\n\r]/.test(s)
  const escaped = s.replace(/"/g, '""')
  return needs ? `"${escaped}"` : escaped
}

export function RentRemindersPage() {
  const [items, setItems] = useState<RentReminderItem[]>([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [q, setQ] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [apartmentFilter, setApartmentFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState('')

  const [detail, setDetail] = useState<RentReminderItem | null>(null)

  function resetRentReminderFilters() {
    setQ('')
    setStoreFilter('')
    setApartmentFilter('')
    setPeriodFilter('')
    setPage(1)
  }

  async function load() {
    setError('')
    const r = await apiGet<{ items: RentReminderItem[] }>('/api/admin/rent-reminders')
    if (!r.ok) return setError(r.error)
    setItems(r.data.items ?? [])
    setMsg('')
  }

  useEffect(() => {
    load()
  }, [])

  const filterOptions = useMemo(() => {
    const stores = Array.from(new Set(items.map((x) => x.storeName).filter(Boolean))).sort()
    const apartments = Array.from(new Set(items.map((x) => x.apartmentName).filter(Boolean))).sort()
    const periods = Array.from(new Set(items.map((x) => x.period).filter(Boolean))).sort().reverse()
    return { stores, apartments, periods }
  }, [items])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return items.filter((x) => {
      if (storeFilter && x.storeName !== storeFilter) return false
      if (apartmentFilter && x.apartmentName !== apartmentFilter) return false
      if (periodFilter && x.period !== periodFilter) return false
      if (!kw) return true
      const hay =
        `${x.tenantName} ${x.tenantPhone} ${x.storeName} ${x.apartmentName} ${x.houseNo} ${x.period} ${x.message}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, storeFilter, apartmentFilter, periodFilter])

  const pageData = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize])

  function exportCsv() {
    const rows = filtered
    const header = [
      '账单编号',
      '发送时间',
      '门店',
      '公寓',
      '房号',
      '租客',
      '手机号',
      '账期',
      '到期日',
      '账单金额',
      '滞纳金',
      '应缴合计',
      '短信内容',
    ]
    const lines = [
      header.map(csvEscape).join(','),
      ...rows.map((x) =>
        [
          formatBillNo(x.billId),
          fmtDt(x.sentAt),
          x.storeName,
          x.apartmentName,
          x.houseNo,
          x.tenantName,
          x.tenantPhone,
          x.period,
          x.dueDate,
          x.billAmount,
          x.penalty,
          x.totalDue,
          x.message,
        ].map(csvEscape).join(','),
      ),
    ]
    const bom = '\uFEFF' // 兼容 Excel 直接打开中文
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const ymd = new Date().toISOString().slice(0, 10)
    a.download = `催租记录_${ymd}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setMsg(`已导出 ${rows.length} 条（当前筛选结果）`)
  }

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">催租记录</div>
        <div className="a-muted">
          系统对欠费租客发送的催缴短信台账（仅记录发送内容与时间）。可按门店/公寓/账期筛选，点击查看可看到完整短信内容。
        </div>
      </div>

      {error ? <div className="a-card a-error">加载失败：{error}</div> : null}
      {msg ? <div className="a-card a-success">{msg}</div> : null}

      <div className="a-card a-row" style={{ justifyContent: 'space-between' }}>
        <div className="a-filterbar" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="a-filter-label">筛选</span>
          <input
            className="a-filter-input"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
            placeholder="搜索：租客/手机号/门店/房号/短信内容"
            style={{ minWidth: 220 }}
          />
          <select
            className="a-filter-select"
            value={storeFilter}
            onChange={(e) => {
              setStoreFilter(e.target.value)
              setPage(1)
            }}
            title="所属门店"
          >
            <option value="">全部门店</option>
            {filterOptions.stores.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="a-filter-select"
            value={apartmentFilter}
            onChange={(e) => {
              setApartmentFilter(e.target.value)
              setPage(1)
            }}
            title="公寓"
          >
            <option value="">全部公寓</option>
            {filterOptions.apartments.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            className="a-filter-select"
            value={periodFilter}
            onChange={(e) => {
              setPeriodFilter(e.target.value)
              setPage(1)
            }}
            title="账期"
          >
            <option value="">全部账期</option>
            {filterOptions.periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button className="a-btn ghost" onClick={() => setPage(1)} title="使用当前筛选条件进行查询">
            查询
          </button>
          <button className="a-btn ghost" onClick={resetRentReminderFilters} title="清空筛选条件">
            重置
          </button>
          <span className="a-muted">共 {filtered.length} 条</span>
        </div>

        <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            className="a-btn ghost"
            onClick={exportCsv}
            title="导出当前筛选结果为 CSV（可用 Excel 打开）"
          >
            导出
          </button>
          <button className="a-btn ghost" onClick={load}>
            刷新
          </button>
        </div>
      </div>

      <div className="a-card">
        <div className="a-table-wrap">
        <table className="a-table a-table-sticky-op">
          <thead>
            <tr>
              <th>账单编号</th>
              <th>发送时间</th>
              <th>门店</th>
              <th>公寓</th>
              <th>房号</th>
              <th>租客</th>
              <th>手机号</th>
              <th>账期</th>
              <th>到期日</th>
              <th>账单金额</th>
              <th>滞纳金</th>
              <th>应缴合计</th>
              <th>短信内容</th>
              <th className="a-op-col">操作</th>
            </tr>
          </thead>
          <tbody>
            {pageData.items.map((x) => (
              <tr key={x.id}>
                <td style={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {formatBillNo(x.billId)}
                </td>
                <td className="a-muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                  {fmtDt(x.sentAt)}
                </td>
                <td className="a-muted">{x.storeName}</td>
                <td className="a-muted">{x.apartmentName}</td>
                <td style={{ fontWeight: 700 }}>{x.houseNo}</td>
                <td>{x.tenantName}</td>
                <td className="a-muted">{x.tenantPhone}</td>
                <td>{x.period}</td>
                <td>{x.dueDate}</td>
                <td style={{ whiteSpace: 'nowrap' }}>¥{x.billAmount}</td>
                <td style={{ whiteSpace: 'nowrap' }}>¥{x.penalty}</td>
                <td style={{ whiteSpace: 'nowrap', fontWeight: 900 }}>¥{x.totalDue}</td>
                <td className="a-muted" style={{ maxWidth: 360, fontSize: 12 }}>
                  {shortText(x.message)}
                </td>
                <td className="a-op-cell">
                  <div className="a-op-actions">
                    <button type="button" className="a-btn ghost" onClick={() => setDetail(x)}>
                      查看
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={14} className="a-muted">
                  暂无催租记录。请在「欠费预警」里对某条欠费账单点击「发催租短信」。
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

      {detail && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setDetail(null)}
        >
          <div className="a-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">催租短信详情 · {detail.tenantName} {detail.period}</div>
              <button type="button" className="a-modal-close" onClick={() => setDetail(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">发送时间</div>
                  <div className="a-kv-v">{fmtDt(detail.sentAt)}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">租客手机号</div>
                  <div className="a-kv-v">{detail.tenantPhone}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">应缴合计</div>
                  <div className="a-kv-v">¥{detail.totalDue}（账单¥{detail.billAmount} + 滞纳金¥{detail.penalty}）</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">短信内容</div>
                  <div className="a-kv-v">
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{detail.message}</div>
                  </div>
                </div>
              </div>

              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <button type="button" className="a-btn ghost" onClick={() => setDetail(null)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

