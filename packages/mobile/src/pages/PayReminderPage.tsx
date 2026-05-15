import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiGet, getTenantPhone } from '../api'

type Contract = {
  id: string
  contractNo: string
  status: string
  apartmentName: string
  storeName: string
  houseNo: string
  tenant: { name: string; phone: string }
  rentMonthly: number
  deposit: number
  confirmedAt: string | null
  stampedAt: string | null
  payment: { id: string; amount: number; status: string; paidAt: string | null } | null
}

const DEADLINE_HOURS = 24

function formatHms(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export function PayReminderPage() {
  const { contractId } = useParams()
  const phone = getTenantPhone()
  const headers = useMemo(() => ({ 'x-tenant-phone': phone }), [phone])

  const [contract, setContract] = useState<Contract | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  async function load() {
    if (!contractId) return
    setError('')
    setLoading(true)
    const r = await apiGet<Contract>(`/api/contracts/${contractId}`, { headers })
    setLoading(false)
    if (!r.ok) return setError(r.error)
    setContract(r.data)
  }

  useEffect(() => {
    if (!contractId) return
    void load()
    const t = window.setInterval(() => {
      void load()
    }, 10_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId, phone])

  const deadlineMs = useMemo(() => {
    if (!contract || !contract.stampedAt) return null
    const stamped = new Date(contract.stampedAt).getTime()
    if (Number.isNaN(stamped)) return null
    return stamped + DEADLINE_HOURS * 3600 * 1000
  }, [contract])

  const remainingMs = useMemo(() => {
    if (!deadlineMs) return null
    return deadlineMs - now
  }, [deadlineMs, now])

  const expired =
    contract?.status === 'VOID' ||
    contract?.status === 'TERMINATED' ||
    (remainingMs != null ? remainingMs <= 0 : false)

  const stampedText = contract?.stampedAt ? new Date(contract.stampedAt).toLocaleString('zh-CN') : ''

  if (!contractId) return <div className="m-card m-error">缺少合同ID</div>

  if (error && !contract) {
    return (
      <div className="m-col">
        <div className="m-card m-error">加载失败：{error}</div>
        <div className="m-card m-muted" style={{ padding: 12 }}>
          可能原因：未在上一步填写租客手机号（权限头缺失）。
        </div>
      </div>
    )
  }

  return (
    <div className="m-col">
      <div className="m-card">
        <div className="m-h1">付款提醒（24h 倒计时）</div>
        <div className="m-muted" style={{ marginTop: 6 }}>
          {expired
            ? '合同已失效：盖章后 24 小时未支付。'
            : contract?.status === 'PENDING_PAYMENT'
              ? '合同已盖章，请在倒计时结束前完成付款。'
              : contract?.status === 'WAIT_STAMP'
                ? '合同已确认，正在等待盖章完成。'
                : contract?.status === 'ACTIVE'
                  ? '合同已生效。'
                  : '请等待系统流转到待付款状态。'}
        </div>
        {contract ? (
          <div className="m-kv" style={{ marginTop: 10 }}>
            <div className="m-k">合同号</div>
            <div>{contract.contractNo}</div>
            <div className="m-k">当前状态</div>
            <div>{contract.status}</div>
            <div className="m-k">盖章时间</div>
            <div>{contract.stampedAt ? stampedText : '-'}</div>
          </div>
        ) : null}
      </div>

      {loading && !contract ? <div className="m-card">加载中…</div> : null}

      {contract && contract.status === 'PENDING_PAYMENT' && !expired ? (
        <div className="m-card">
          <div style={{ fontWeight: 900 }}>倒计时</div>
          {remainingMs != null && deadlineMs != null ? (
            <>
              <div style={{ fontSize: 28, fontWeight: 900, marginTop: 10, color: '#1d4ed8' }}>
                {formatHms(remainingMs)}
              </div>
              <div className="m-muted" style={{ marginTop: 6 }}>
                还剩时间：倒计时结束后合同将自动失效（24h 规则）。
              </div>
              <div className="m-muted" style={{ marginTop: 6 }}>
                支付截止：{new Date(deadlineMs).toLocaleString('zh-CN')}
              </div>
            </>
          ) : (
            <div className="m-muted" style={{ marginTop: 8 }}>
              正在获取盖章时间，倒计时即将显示…
            </div>
          )}

          <div className="m-row" style={{ marginTop: 12 }}>
            <Link className="m-btn" to={`/pay/${contract.id}`}>
              立即支付
            </Link>
            <Link className="m-btn ghost" to={`/contracts/${contract.id}`}>
              返回合同
            </Link>
          </div>
        </div>
      ) : null}

      {contract && contract.status === 'WAIT_STAMP' ? (
        <div className="m-card">
          <div style={{ fontWeight: 900 }}>盖章处理中</div>
          <div className="m-muted" style={{ marginTop: 8 }}>
            系统会在电子章完成后自动切换到“待付款”状态。你可以继续停留在此页，倒计时会自动出现。
          </div>
          <div className="m-row" style={{ marginTop: 12 }}>
            <button className="m-btn secondary" type="button" onClick={() => void load()}>
              刷新状态
            </button>
            <Link className="m-btn ghost" to={`/contracts/${contract.id}`}>
              返回合同
            </Link>
          </div>
        </div>
      ) : null}

      {contract && contract.status === 'ACTIVE' ? (
        <div className="m-card">
          <div style={{ fontWeight: 900 }}>支付已完成</div>
          <div className="m-success" style={{ marginTop: 8 }}>
            合同已生效，无需再付款。
          </div>
          <div className="m-row" style={{ marginTop: 12 }}>
            <Link className="m-btn" to={`/contracts/${contract.id}`}>
              查看合同
            </Link>
          </div>
        </div>
      ) : null}

      {contract && expired ? (
        <div className="m-card">
          <div style={{ fontWeight: 900 }}>合同已失效</div>
          <div className="m-muted" style={{ marginTop: 8 }}>
            由于盖章后 24 小时未完成付款，合同已自动作废（页面会在后台刷新最新状态）。
          </div>
          <div className="m-row" style={{ marginTop: 12 }}>
            <Link className="m-btn" to={`/contracts/${contract.id}`}>
              返回合同
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}

