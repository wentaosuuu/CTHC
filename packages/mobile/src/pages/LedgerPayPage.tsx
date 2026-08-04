import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

type LedgerPayDetail = {
  id: string
  displayNo: string
  contractNo: string
  billNo: string | null
  houseNo: string | null
  tenantName: string
  idCardNo: string | null
  tenantPhone: string | null
  amount: number
  rentAmount: number
  performanceDeposit: number
  utilityDeposit: number
  cleaningDeposit: number
  propertyFee: number
  electricityFee: number
  waterFee: number
  lateFee: number
  receivingAccountName: string | null
  receivingBankName: string | null
  receivingAccountNo: string | null
  remark: string | null
  status: string
  payChannel: string | null
  paidAt: string | null
  createdAt: string
}

function channelLabel(ch: string | null) {
  if (ch === 'WECHAT') return '微信支付'
  if (ch === 'ALIPAY') return '支付宝'
  return '—'
}

function statusLabel(status: string) {
  if (status === 'PENDING') return '待付款'
  if (status === 'PAID') return '已支付'
  if (status === 'CANCELLED') return '已取消'
  return status
}

function fmtDt(iso: string | null) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return iso
  }
}

function fmtMoney(n: number | null | undefined) {
  if (n == null || n === 0) return null
  return `¥${n.toLocaleString()}`
}

const FEE_ROWS: { key: keyof LedgerPayDetail; label: string }[] = [
  { key: 'rentAmount', label: '租金' },
  { key: 'performanceDeposit', label: '履约保证金' },
  { key: 'utilityDeposit', label: '水电押金' },
  { key: 'cleaningDeposit', label: '卫生保洁押金' },
  { key: 'propertyFee', label: '物业费' },
  { key: 'electricityFee', label: '电费' },
  { key: 'waterFee', label: '水费' },
  { key: 'lateFee', label: '滞纳金' },
]

export function LedgerPayPage() {
  const { id } = useParams()
  const [data, setData] = useState<LedgerPayDetail | null>(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [paying, setPaying] = useState<'WECHAT' | 'ALIPAY' | ''>('')

  async function load() {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/public/ledger-payments/${encodeURIComponent(id)}`)
      if (!res.ok) {
        const text = await res.text()
        let err = text
        try {
          const j = JSON.parse(text) as { error?: string }
          if (j.error) err = j.error
        } catch {
          /* ignore */
        }
        setError(err === 'NOT_FOUND' ? '收款单不存在或已失效' : err || `加载失败（${res.status}）`)
        setData(null)
        return
      }
      setData((await res.json()) as LedgerPayDetail)
    } catch {
      setError('网络异常，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function pay(channel: 'WECHAT' | 'ALIPAY') {
    if (!id) return
    setPaying(channel)
    setError('')
    setMsg('')
    try {
      const res = await fetch(`/api/public/ledger-payments/${encodeURIComponent(id)}/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payChannel: channel }),
      })
      const text = await res.text()
      let body: any = null
      try {
        body = JSON.parse(text)
      } catch {
        body = null
      }
      if (!res.ok) {
        const err = body?.error || text || `支付失败（${res.status}）`
        if (err === 'CANCELLED') setError('该收款单已取消，无法支付')
        else setError(String(err))
        return
      }
      if (body?.alreadyPaid) {
        setMsg('该笔款项此前已支付成功。')
      } else {
        setMsg(`支付成功（演示）：${channelLabel(channel)} ¥${body?.amount ?? data?.amount}`)
      }
      await load()
    } catch {
      setError('网络异常，请稍后重试')
    } finally {
      setPaying('')
    }
  }

  if (!id) {
    return <div className="m-card m-error">缺少收款单 ID。</div>
  }

  return (
    <div className="m-col">
      <div className="m-card">
        <div className="m-h1">扫码付款</div>
        <div className="m-muted">南宁产投华创 · 记账本收款（演示环境，支付为模拟成功）</div>
      </div>

      {error ? <div className="m-card m-error">{error}</div> : null}
      {msg ? <div className="m-card m-success">{msg}</div> : null}
      {loading && !data ? <div className="m-card">加载中…</div> : null}

      {data ? (
        <>
          <div className="m-card" style={{ textAlign: 'center' }}>
            <div className="m-muted">应付金额</div>
            <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 0.5, marginTop: 4 }}>
              ¥{(data.amount ?? 0).toLocaleString()}
            </div>
            <div className="m-muted" style={{ marginTop: 8 }}>
              {statusLabel(data.status)}
              {data.status === 'PAID' ? ` · ${channelLabel(data.payChannel)}` : ''}
            </div>
          </div>

          <div className="m-card">
            <div className="m-kv">
              <div className="m-k">流水号</div>
              <div>{data.displayNo}</div>
              {data.receivingAccountName ? (
                <>
                  <div className="m-k">收款账户</div>
                  <div>
                    {data.receivingAccountName}
                    {data.receivingBankName || data.receivingAccountNo ? (
                      <div className="m-muted" style={{ fontSize: 12, marginTop: 2 }}>
                        {[data.receivingBankName, data.receivingAccountNo].filter(Boolean).join(' · ')}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
              {data.houseNo ? (
                <>
                  <div className="m-k">房号</div>
                  <div>{data.houseNo}</div>
                </>
              ) : null}
              {data.tenantName ? (
                <>
                  <div className="m-k">租户名称</div>
                  <div>{data.tenantName}</div>
                </>
              ) : null}
              {data.idCardNo ? (
                <>
                  <div className="m-k">身份证号</div>
                  <div>{data.idCardNo}</div>
                </>
              ) : null}
              {data.contractNo ? (
                <>
                  <div className="m-k">合同编号</div>
                  <div>{data.contractNo}</div>
                </>
              ) : null}
              {data.billNo ? (
                <>
                  <div className="m-k">账单编号</div>
                  <div>{data.billNo}</div>
                </>
              ) : null}
              {FEE_ROWS.map((row) => {
                const text = fmtMoney(data[row.key] as number)
                if (!text) return null
                return (
                  <div key={row.key} style={{ display: 'contents' }}>
                    <div className="m-k">{row.label}</div>
                    <div>{text}</div>
                  </div>
                )
              })}
              {data.remark ? (
                <>
                  <div className="m-k">备注</div>
                  <div>{data.remark}</div>
                </>
              ) : null}
              {data.status === 'PAID' ? (
                <>
                  <div className="m-k">付款时间</div>
                  <div>{fmtDt(data.paidAt)}</div>
                </>
              ) : null}
            </div>
          </div>

          {data.status === 'PENDING' ? (
            <div className="m-card">
              <div className="m-muted" style={{ marginBottom: 12, lineHeight: 1.5 }}>
                请选择支付方式完成付款（演示：点击即模拟支付成功，实际环境将跳转微信/支付宝）。
              </div>
              <div className="m-row" style={{ flexDirection: 'column', gap: 10 }}>
                <button
                  type="button"
                  className="m-btn"
                  style={{ width: '100%', background: '#07c160', borderColor: '#07c160' }}
                  disabled={Boolean(paying)}
                  onClick={() => void pay('WECHAT')}
                >
                  {paying === 'WECHAT' ? '支付中…' : '微信支付'}
                </button>
                <button
                  type="button"
                  className="m-btn"
                  style={{ width: '100%', background: '#1677ff', borderColor: '#1677ff' }}
                  disabled={Boolean(paying)}
                  onClick={() => void pay('ALIPAY')}
                >
                  {paying === 'ALIPAY' ? '支付中…' : '支付宝支付'}
                </button>
              </div>
            </div>
          ) : data.status === 'PAID' ? (
            <div className="m-card">
              <div className="m-success">支付已完成，感谢您的付款。</div>
            </div>
          ) : (
            <div className="m-card m-error">该收款单已取消，无法支付。</div>
          )}
        </>
      ) : null}
    </div>
  )
}
