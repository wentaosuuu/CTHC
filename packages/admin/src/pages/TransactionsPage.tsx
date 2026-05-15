import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api'
import { Pagination, paginate } from '../components/Pagination'

type TxItem = {
  id: string
  txNo: string
  orderId: string
  type: 'BILL_PAYMENT' | 'REFUND'
  amount: number
  occurredAt: string
  contractId: string
  contractNo: string
  tenant: { name: string; phone: string }
  house: { storeName: string; apartmentName: string; houseNo: string }
  note: string
}

const TYPE_ZH: Record<TxItem['type'], string> = {
  BILL_PAYMENT: '收款',
  REFUND: '退款',
}

function fmtMoney(n: number) {
  const sign = n < 0 ? '-' : ''
  const v = Math.abs(n)
  return `${sign}¥${v.toLocaleString('zh-CN')}`
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

export function TransactionsPage() {
  const [items, setItems] = useState<TxItem[]>([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  function resetTransactionFilters() {
    setQ('')
    setTypeFilter('')
    setStoreFilter('')
    setPage(1)
  }

  async function load() {
    setError('')
    const r = await apiGet<{ items: TxItem[] }>('/api/admin/transactions')
    if (!r.ok) return setError(r.error)
    setItems(r.data.items ?? [])
    setMsg('')
    setSelectedIds(new Set())
  }

  useEffect(() => {
    load()
  }, [])

  const filterOptions = useMemo(() => {
    const stores = Array.from(new Set(items.map((x) => x.house.storeName).filter(Boolean))).sort()
    return { stores }
  }, [items])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return items.filter((x) => {
      if (typeFilter && x.type !== typeFilter) return false
      if (storeFilter && x.house.storeName !== storeFilter) return false
      if (!kw) return true
      const hay =
        `${x.txNo} ${x.orderId} ${x.contractNo} ${x.tenant.name} ${x.tenant.phone} ${x.house.storeName} ${x.house.apartmentName} ${x.house.houseNo} ${x.note}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, typeFilter, storeFilter])

  const pageData = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize])

  const visibleIds = useMemo(() => pageData.items.map((x) => x.id), [pageData.items])
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id))

  async function exportReceipts() {
    setError('')
    setMsg('')
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return setError('请先勾选要导出的收据')

    // demo: 模板未提供，先仅做演示提示
    setMsg(`（Demo）将导出 ${ids.length} 条收据。后续接入业主提供的模板后可启用真实导出。`)
  }

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">交易记录</div>
        <div className="a-muted">
          这里记录系统内发生的交易流水（当前包含：账单收款、退款）。可用筛选快速定位到某一份合同或租客。
        </div>
      </div>

      {error ? <div className="a-card a-error">加载失败：{error}</div> : null}
      {msg ? <div className="a-card a-success">{msg}</div> : null}

      <div className="a-card">
        <div className="a-row" style={{ justifyContent: 'space-between' }}>
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
              style={{ minWidth: 210 }}
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
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value)
                setPage(1)
              }}
              title="交易类型"
            >
              <option value="">全部类型</option>
              <option value="BILL_PAYMENT">收款</option>
              <option value="REFUND">退款</option>
            </select>
            <button className="a-btn ghost" onClick={() => setPage(1)} title="使用当前筛选条件进行查询">
              查询
            </button>
            <button className="a-btn ghost" onClick={resetTransactionFilters} title="清空筛选条件">
              重置
            </button>
            <span className="a-muted">共 {filtered.length} 条</span>
          </div>

          <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              className="a-btn ghost"
              onClick={() => setMsg('导出功能待业主提供模板后开启')}
              title="等待业主提供导出模板"
            >
              导出
            </button>
            <button className="a-btn ghost" onClick={exportReceipts} title="导出所选数据收据（Demo）">
              导出收据
            </button>
            <button className="a-btn ghost" onClick={load}>
              刷新
            </button>
          </div>
        </div>

        <div style={{ height: 10 }} />
        <div className="a-table-wrap">
        <table className="a-table">
          <thead>
            <tr>
              <th style={{ width: 48 }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected
                  }}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setSelectedIds((prev) => {
                      const next = new Set(prev)
                      for (const id of visibleIds) {
                        if (checked) next.add(id)
                        else next.delete(id)
                      }
                      return next
                    })
                  }}
                  aria-label="全选当前页数据"
                />
              </th>
              <th>时间</th>
              <th>流水号</th>
              <th>订单号</th>
              <th>类型</th>
              <th>金额</th>
              <th>合同</th>
              <th>租客</th>
              <th>手机号</th>
              <th>门店</th>
              <th>公寓</th>
              <th>房号</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {pageData.items.map((x) => (
              <tr key={x.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(x.id)}
                    onChange={(e) => {
                      const checked = e.target.checked
                      setSelectedIds((prev) => {
                        const next = new Set(prev)
                        if (checked) next.add(x.id)
                        else next.delete(x.id)
                        return next
                      })
                    }}
                    aria-label={`选择收据 ${x.txNo}`}
                  />
                </td>
                <td className="a-muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                  {fmtDt(x.occurredAt)}
                </td>
                <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{x.txNo}</td>
                <td className="a-muted" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {x.orderId}
                </td>
                <td style={{ whiteSpace: 'nowrap', fontWeight: 800 }}>{TYPE_ZH[x.type]}</td>
                <td style={{ whiteSpace: 'nowrap', fontWeight: 900, color: x.amount < 0 ? '#b91c1c' : '#047857' }}>
                  {fmtMoney(x.amount)}
                </td>
                <td style={{ fontWeight: 700 }}>{x.contractNo}</td>
                <td>{x.tenant.name}</td>
                <td className="a-muted">{x.tenant.phone}</td>
                <td className="a-muted">{x.house.storeName}</td>
                <td className="a-muted">{x.house.apartmentName}</td>
                <td style={{ fontWeight: 700 }}>{x.house.houseNo}</td>
                <td className="a-muted" style={{ maxWidth: 360, fontSize: 12 }}>
                  {x.note}
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={13} className="a-muted">
                  暂无交易记录。
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
    </div>
  )
}

