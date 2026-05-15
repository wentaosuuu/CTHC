import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiPost, getTenantPhone } from '../api'

export function PaymentPage() {
  const { contractId } = useParams()
  const nav = useNavigate()
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const phone = getTenantPhone()
  const headers = useMemo(() => ({ 'x-tenant-phone': phone }), [phone])

  async function pay() {
    if (!contractId) return
    setMsg('')
    setError('')
    const r = await apiPost<{ ok: true; amount: number; contractStatus: string }>(
      '/api/payments',
      { contractId },
      { headers },
    )
    if (!r.ok) return setError(r.error)
    setMsg(`支付成功（模拟），金额 ¥${r.data.amount}，合同状态：${r.data.contractStatus}`)
  }

  return (
    <div className="m-col">
      <div className="m-card">
        <div className="m-h1">在线支付（MVP）</div>
        <div className="m-muted">支付时限/真实支付渠道在后续接入，这里先做“24h 规则 + 模拟成功”。</div>
      </div>

      {error ? <div className="m-card m-error">支付失败：{error}</div> : null}
      {msg ? (
        <div className="m-card">
          <div className="m-success">{msg}</div>
          <div className="m-muted" style={{ marginTop: 6 }}>
            下一步：后台会在次日自动报备，你也可以让店长在后台手动触发一次报备。
          </div>
        </div>
      ) : null}

      <div className="m-row">
        <button className="m-btn" onClick={pay} disabled={!contractId}>
          立即支付（模拟成功）
        </button>
        {contractId ? (
          <Link className="m-btn ghost" to={`/contracts/${contractId}`}>
            返回合同
          </Link>
        ) : null}
        <button className="m-btn secondary" onClick={() => nav(-1)}>
          返回上一页
        </button>
      </div>
    </div>
  )
}

