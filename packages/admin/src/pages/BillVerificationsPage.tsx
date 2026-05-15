import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api'
import { Pagination, paginate } from '../components/Pagination'
import { Link } from 'react-router-dom'

type VerifyItem = {
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
  status: string
  paidAt: string | null
  offlineVerifiedAt: string | null
  offlineVerifiedRemark: string | null
  offlineVerifyAttachments: { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }[]
}

// 合同号展示：HT + 数字（与账单页保持一致）
function formatContractNo(contractNo: string) {
  const digits = (contractNo || '').replace(/\D/g, '')
  return digits ? `HT${digits}` : contractNo
}

function fmtDt(iso: string | null) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

function shortText(s: string | null | undefined, max = 28) {
  const t = String(s ?? '').trim()
  if (!t) return '—'
  return t.length > max ? `${t.slice(0, max)}…` : t
}

export function BillVerificationsPage() {
  const [items, setItems] = useState<VerifyItem[]>([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [q, setQ] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [apartmentFilter, setApartmentFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState('')

  const [detail, setDetail] = useState<VerifyItem | null>(null)

  function resetBillVerificationFilters() {
    setQ('')
    setStoreFilter('')
    setApartmentFilter('')
    setPeriodFilter('')
    setPage(1)
  }

  async function load() {
    setError('')
    const r = await apiGet<{ items: VerifyItem[] }>('/api/admin/bills/offline-verifications')
    if (!r.ok) return setError(r.error)
    setItems(r.data.items ?? [])
    setMsg('')
  }

  useEffect(() => {
    load()
  }, [])

  const filterOptions = useMemo(() => {
    const stores = Array.from(new Set(items.map((b) => b.storeName).filter(Boolean))).sort()
    const apartments = Array.from(new Set(items.map((b) => b.apartmentName).filter(Boolean))).sort()
    const periods = Array.from(new Set(items.map((b) => b.period).filter(Boolean))).sort().reverse()
    return { stores, apartments, periods }
  }, [items])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return items.filter((b) => {
      if (storeFilter && b.storeName !== storeFilter) return false
      if (apartmentFilter && b.apartmentName !== apartmentFilter) return false
      if (periodFilter && b.period !== periodFilter) return false
      if (!kw) return true
      const hay =
        `${b.contractNo} ${b.houseBizId} ${b.tenantName} ${b.tenantPhone} ${b.storeName} ${b.apartmentName} ${b.houseNo} ${b.period} ${b.offlineVerifiedRemark ?? ''}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, storeFilter, apartmentFilter, periodFilter])

  const pageData = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize])

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">核销记录</div>
        <div className="a-muted">
          这里汇总所有「线下核销」操作记录，用于追溯收款凭证与备注。点击某条记录可查看当时上传的附件。
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
            placeholder="搜索：合同号/租客/手机号/门店/房号/备注"
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
          <button className="a-btn ghost" onClick={resetBillVerificationFilters} title="清空筛选条件">
            重置
          </button>
          <span className="a-muted">共 {filtered.length} 条</span>
        </div>

        <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
              <th>核销时间</th>
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
              <th>备注</th>
              <th>附件</th>
              <th className="a-op-col">操作</th>
            </tr>
          </thead>
          <tbody>
            {pageData.items.map((b) => (
              <tr key={b.billId}>
                <td className="a-muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                  {fmtDt(b.offlineVerifiedAt)}
                </td>
                <td style={{ fontWeight: 700 }}>{formatContractNo(b.contractNo)}</td>
                <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{b.houseBizId}</td>
                <td className="a-muted">{b.apartmentName}</td>
                <td style={{ fontWeight: 700 }}>{b.houseNo}</td>
                <td className="a-muted">{b.storeName}</td>
                <td>{b.tenantName}</td>
                <td className="a-muted">{b.tenantPhone}</td>
                <td>{b.period}</td>
                <td>{b.dueDate}</td>
                <td style={{ whiteSpace: 'nowrap', fontWeight: 900 }}>¥{b.totalAmount}</td>
                <td className="a-muted" style={{ maxWidth: 260, fontSize: 12 }}>
                  {shortText(b.offlineVerifiedRemark)}
                </td>
                <td className="a-muted" style={{ whiteSpace: 'nowrap' }}>
                  {b.offlineVerifyAttachments?.length ?? 0} 个
                </td>
                <td className="a-op-cell">
                  <div className="a-op-actions">
                    <button type="button" className="a-btn ghost" onClick={() => setDetail(b)}>
                      查看
                    </button>
                    <Link className="a-btn ghost" to="/bills" title="跳转到账单管理，可查看账单详情">
                      去账单页
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={14} className="a-muted">
                  暂无核销记录。你可以在「账单管理」中对未支付/逾期账单执行「线下核销」。
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

      {/* 核销详情弹窗 */}
      {detail && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setDetail(null)}
        >
          <div className="a-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">
                核销详情 · {formatContractNo(detail.contractNo)} {detail.period}
              </div>
              <button type="button" className="a-modal-close" onClick={() => setDetail(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">核销时间</div>
                  <div className="a-kv-v">{fmtDt(detail.offlineVerifiedAt)}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">金额</div>
                  <div className="a-kv-v">¥{detail.totalAmount}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">房源</div>
                  <div className="a-kv-v">
                    {detail.apartmentName} {detail.houseNo}（{detail.storeName}）
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">租客</div>
                  <div className="a-kv-v">
                    {detail.tenantName} {detail.tenantPhone}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">备注</div>
                  <div className="a-kv-v">{detail.offlineVerifiedRemark?.trim() ? detail.offlineVerifiedRemark : '—'}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">附件</div>
                  <div className="a-kv-v">
                    {(detail.offlineVerifyAttachments?.length ?? 0) > 0 ? (
                      <div className="a-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                        {detail.offlineVerifyAttachments.map((a) => (
                          <a
                            key={a.id}
                            className="a-btn ghost"
                            href={a.previewUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="点击预览；右键可另存为"
                          >
                            {a.name}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="a-muted">未上传</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <Link className="a-btn" to="/bills">
                  去账单管理
                </Link>
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

