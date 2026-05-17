import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPatch } from '../api'
import { Pagination, paginate } from '../components/Pagination'

type CreditTier = 'A' | 'B' | 'C' | 'D'

type TenantRow = {
  id: string
  name: string
  phone: string
  wechat: string | null
  idDocType: string
  idNumberMasked: string
  creditTier: CreditTier
  enteredAt: string
  orderCount: number
  contractCount: number
}

const DOC_ZH: Record<string, string> = {
  IDCARD: '身份证',
  PASSPORT: '护照',
  HKM_TW_PERMIT: '港澳台通行证',
  USCC: '统一社会信用代码',
}

function fmtEntered(iso: string) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${day} ${hh}:${mm}`
  } catch {
    return iso
  }
}

export function TenantProfilesPage() {
  const [items, setItems] = useState<TenantRow[]>([])
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [q, setQ] = useState('')
  const [tierFilter, setTierFilter] = useState<CreditTier | ''>('')

  async function load() {
    setError('')
    const r = await apiGet<{
      items: TenantRow[]
    }>('/api/admin/tenants')
    if (!r.ok) return setError(r.error)
    setItems(r.data.items ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function saveTier(id: string, creditTier: CreditTier) {
    setError('')
    setSavingId(id)
    const r = await apiPatch<{ ok: true; item: TenantRow }>(`/api/admin/tenants/${encodeURIComponent(id)}`, {
      creditTier,
    })
    setSavingId(null)
    if (!r.ok) return setError(r.error)
    setItems((prev) => prev.map((x) => (x.id === id ? r.data.item : x)))
  }

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return items.filter((x) => {
      if (tierFilter && x.creditTier !== tierFilter) return false
      if (!kw) return true
      const hay = `${x.name} ${x.phone} ${x.wechat ?? ''} ${x.idNumberMasked} ${x.idDocType}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, tierFilter])

  const pageData = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize])

  useEffect(() => {
    setPage(1)
  }, [q, tierFilter, pageSize])

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">租客档案</div>
      </div>

      {error ? (
        <div className="a-card a-error" style={{ marginTop: 12 }}>
          加载或保存失败：{error}
        </div>
      ) : null}

      <div className="a-card" style={{ marginTop: 12 }}>
        <div className="a-row" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <input
            className="a-input"
            style={{ minWidth: 220, flex: '1 1 200px' }}
            placeholder="按姓名、手机、证件尾号搜索…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="a-input"
            style={{ width: 140 }}
            value={tierFilter}
            onChange={(e) => setTierFilter((e.target.value || '') as CreditTier | '')}
          >
            <option value="">全部等级</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="D">D</option>
          </select>
        </div>

        <div className="a-table-wrap" style={{ marginTop: 14 }}>
          <table className="a-table" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th>姓名</th>
                <th>手机号</th>
                <th>证件类型</th>
                <th>证件号</th>
                <th>信誉度</th>
                <th>入档时间</th>
                <th>订单</th>
                <th>合同</th>
                <th style={{ minWidth: 140 }}>调整等级</th>
              </tr>
            </thead>
            <tbody>
              {pageData.items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="a-muted">
                    暂无租客档案（租客在 H5 下单并经后台审核通过后会出现）。
                  </td>
                </tr>
              ) : (
                pageData.items.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 800 }}>{row.name}</td>
                    <td>{row.phone}</td>
                    <td>{DOC_ZH[row.idDocType] ?? row.idDocType}</td>
                    <td className="a-muted" style={{ fontSize: 12 }}>
                      {row.idNumberMasked}
                    </td>
                    <td>
                      <span className={`a-tier-badge a-tier-${row.creditTier.toLowerCase()}`}>{row.creditTier}</span>
                    </td>
                    <td className="a-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {fmtEntered(row.enteredAt)}
                    </td>
                    <td>{row.orderCount}</td>
                    <td>{row.contractCount}</td>
                    <td>
                      <div className="a-row" style={{ gap: 6, alignItems: 'center' }}>
                        <select
                          className="a-input"
                          style={{ width: 72, padding: '6px 8px', fontSize: 13 }}
                          value={row.creditTier}
                          disabled={savingId === row.id}
                          onChange={(e) => {
                            const v = e.target.value as CreditTier
                            if (v !== row.creditTier) void saveTier(row.id, v)
                          }}
                        >
                          <option value="A">A</option>
                          <option value="B">B</option>
                          <option value="C">C</option>
                          <option value="D">D</option>
                        </select>
                        {savingId === row.id ? <span className="a-muted" style={{ fontSize: 12 }}>保存中…</span> : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
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
    </div>
  )
}
