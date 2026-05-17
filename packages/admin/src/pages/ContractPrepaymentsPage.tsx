import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '../api'

type CreditRow = {
  contractId: string
  contractNo: string
  tenantName: string
  tenantPhone: string
  storeName: string
  apartmentName: string
  houseNo: string
  balanceAmount: number
  updatedAt: string
}

type LedgerEntry = {
  id: string
  deltaAmount: number
  balanceAfterAmount: number
  kind: string
  billId: string | null
  remark: string | null
  createdAt: string
}

function formatContractNo(contractNo: string) {
  const digits = (contractNo || '').replace(/\D/g, '')
  return digits ? `HT${digits}` : contractNo
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

export function ContractPrepaymentsPage() {
  const [items, setItems] = useState<CreditRow[]>([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [q, setQ] = useState('')

  const [ledgerContractId, setLedgerContractId] = useState<string | null>(null)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerBalance, setLedgerBalance] = useState(0)
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([])

  async function load() {
    setError('')
    const r = await apiGet<{ items: CreditRow[] }>('/api/admin/contract-credits')
    if (!r.ok) return setError(r.error)
    setItems(r.data.items ?? [])
    setMsg('')
  }

  useEffect(() => {
    load()
  }, [])

  async function openLedger(contractId: string) {
    setLedgerContractId(contractId)
    setLedgerLoading(true)
    setError('')
    const r = await apiGet<{ balanceAmount: number; entries: LedgerEntry[] }>(`/api/admin/contract-credits/${contractId}/ledger`)
    setLedgerLoading(false)
    if (!r.ok) {
      setError(r.error)
      setLedgerContractId(null)
      return
    }
    setLedgerBalance(r.data.balanceAmount ?? 0)
    setLedgerEntries(r.data.entries ?? [])
  }

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return items
    return items.filter((x) => {
      const hay =
        `${x.contractNo} ${formatContractNo(x.contractNo)} ${x.tenantName} ${x.tenantPhone} ${x.storeName} ${x.apartmentName} ${x.houseNo}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q])

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">合同预收款</div>
        <div className="a-muted">
          当线下核销金额<strong>超过</strong>账单剩余应付时，超出部分自动记入对应合同的「预收余额」，用于后续抵扣或人工对账。本页列出<strong>余额大于 0</strong>的合同；点击「流水」查看入账明细。
        </div>
      </div>

      {error ? <div className="a-card a-error">加载失败：{error}</div> : null}
      {msg ? <div className="a-card a-success">{msg}</div> : null}

      <div className="a-card a-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div className="a-filterbar" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="a-filter-label">搜索</span>
          <input
            className="a-filter-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="合同号 / 租客 / 手机号 / 门店 / 房号"
            style={{ minWidth: 240 }}
          />
          <span className="a-muted">共 {filtered.length} 条</span>
        </div>
        <button className="a-btn ghost" type="button" onClick={load}>
          刷新
        </button>
      </div>

      <div className="a-card">
        <div className="a-table-wrap">
          <table className="a-table a-table-sticky-op">
            <thead>
              <tr>
                <th>合同</th>
                <th>租客</th>
                <th>手机号</th>
                <th>门店</th>
                <th>公寓</th>
                <th>房号</th>
                <th>预收余额</th>
                <th>更新时间</th>
                <th className="a-op-col">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((x) => (
                <tr key={x.contractId}>
                  <td style={{ fontWeight: 700 }}>{formatContractNo(x.contractNo)}</td>
                  <td>{x.tenantName}</td>
                  <td className="a-muted">{x.tenantPhone}</td>
                  <td className="a-muted">{x.storeName}</td>
                  <td className="a-muted">{x.apartmentName}</td>
                  <td style={{ fontWeight: 700 }}>{x.houseNo}</td>
                  <td style={{ fontWeight: 900, color: '#0369a1' }}>¥{x.balanceAmount}</td>
                  <td className="a-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {fmtDt(x.updatedAt)}
                  </td>
                  <td className="a-op-cell">
                    <div className="a-op-actions">
                      <button type="button" className="a-btn ghost" onClick={() => openLedger(x.contractId)}>
                        流水
                      </button>
                      <Link className="a-btn ghost" to="/transactions">
                        交易记录
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="a-muted">
                    暂无预收余额。线下核销金额大于账单应付时，系统将自动在此累计。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {ledgerContractId ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && !ledgerLoading && setLedgerContractId(null)}
        >
          <div className="a-modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">预收流水 · 合同 {formatContractNo(items.find((i) => i.contractId === ledgerContractId)?.contractNo ?? '')}</div>
              <button type="button" className="a-modal-close" onClick={() => setLedgerContractId(null)} disabled={ledgerLoading}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              {ledgerLoading ? (
                <div className="a-muted">加载中…</div>
              ) : (
                <>
                  <div style={{ marginBottom: 12, fontSize: 15 }}>
                    当前余额：<strong style={{ color: '#0369a1' }}>¥{ledgerBalance}</strong>
                  </div>
                  <div className="a-table-wrap">
                    <table className="a-table">
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>变动</th>
                          <th>余额</th>
                          <th>类型</th>
                          <th>备注</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerEntries.map((e) => (
                          <tr key={e.id}>
                            <td className="a-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                              {fmtDt(e.createdAt)}
                            </td>
                            <td style={{ fontWeight: 800, color: e.deltaAmount >= 0 ? '#047857' : '#b91c1c' }}>
                              {e.deltaAmount >= 0 ? '+' : ''}¥{e.deltaAmount}
                            </td>
                            <td style={{ fontVariantNumeric: 'tabular-nums' }}>¥{e.balanceAfterAmount}</td>
                            <td className="a-muted" style={{ fontSize: 12 }}>
                              {e.kind === 'OVERPAY_OFFLINE' ? '核销超额' : e.kind}
                            </td>
                            <td className="a-muted" style={{ fontSize: 12, maxWidth: 260 }}>
                              {e.remark ?? '—'}
                            </td>
                          </tr>
                        ))}
                        {ledgerEntries.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="a-muted">
                              暂无流水。
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <Link className="a-btn" to="/bills">
                  去账单管理
                </Link>
                <button type="button" className="a-btn ghost" onClick={() => setLedgerContractId(null)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
