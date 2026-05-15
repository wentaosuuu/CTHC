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

function formatContractNo(contractNo: string) {
  const digits = (contractNo || '').replace(/\D/g, '')
  return digits ? `HT${digits}` : contractNo
}

// 账单编号展示：ZD + 固定长度数字（演示用，可替换为后端真实编号规则）
function formatBillNo(billId: string, digits = 10) {
  let h = 0
  for (let i = 0; i < billId.length; i += 1) h = (h * 31 + billId.charCodeAt(i)) >>> 0
  const s = String(h).padStart(digits, '0')
  return `ZD${s.slice(-digits)}`
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
  const [overdueRange, setOverdueRange] = useState('') // '' | '7' | '30' | '90': 7天内 / 7-30天 / 30-90天 / 90天以上

  function resetOverdueFilters() {
    setQ('')
    setStoreFilter('')
    setApartmentFilter('')
    setOverdueRange('')
    setPage(1)
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
              <th>账单编号</th>
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
                  <span style={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {formatBillNo(x.billId)}
                  </span>
                </td>
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
                <td colSpan={14} className="a-muted">
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

      {/* 发催租短信弹窗 */}
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
                      placeholder="可编辑短信内容（演示版不会真实发出，仅记录台账）"
                    />
                    <div className="a-muted" style={{ marginTop: 6, fontSize: 12 }}>
                      提示：这里是 demo 演示，点击发送会写入「催租记录」台账；真实项目会在服务端对接短信网关。
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
                    setMsg('已发送（演示）并写入催租记录')
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

