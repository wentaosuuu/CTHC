import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiGet, getTenantPhone } from '../api'
import { pendingFirstPayDeadlineMs } from '../countdownFormat'

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
  tenantSignDeadlineAt: string | null
  renewedFromId?: string | null
  payment: { id: string; amount: number; status: string; paidAt: string | null } | null
}

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

  const payDeadlineMs = useMemo(() => {
    if (!contract || !contract.stampedAt) return null
    return pendingFirstPayDeadlineMs(contract)
  }, [contract])

  const signDeadlineMs = useMemo(() => {
    if (!contract?.tenantSignDeadlineAt) return null
    const t = new Date(contract.tenantSignDeadlineAt).getTime()
    return Number.isNaN(t) ? null : t
  }, [contract])

  const payRemainingMs = useMemo(() => {
    if (!payDeadlineMs) return null
    return payDeadlineMs - now
  }, [payDeadlineMs, now])

  const signRemainingMs = useMemo(() => {
    if (!signDeadlineMs || contract?.status !== 'WAIT_TENANT_SIGN') return null
    return signDeadlineMs - now
  }, [signDeadlineMs, contract?.status, now])

  const payExpired =
    contract?.status === 'PENDING_PAYMENT' &&
    payRemainingMs != null &&
    payRemainingMs <= 0

  const signExpired =
    contract?.status === 'WAIT_TENANT_SIGN' && signRemainingMs != null && signRemainingMs <= 0

  const expired =
    contract?.status === 'VOID' ||
    contract?.status === 'TERMINATED' ||
    payExpired ||
    signExpired

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
        <div className="m-h1">合同流程与倒计时</div>
        <div className="m-muted" style={{ marginTop: 6 }}>
          {expired
            ? contract?.status === 'VOID' && !contract.stampedAt
              ? '合同已失效：未在约定期限内完成确认与签字（或订单已被系统取消）。'
              : contract?.status === 'VOID' && contract.stampedAt
                ? contract.renewedFromId
                  ? '合同已失效：续签新合同未在起租首日起 24 小时内完成首期款。'
                  : '合同已失效：待付款后的 24 小时内未完成首期款支付。'
                : signExpired
                  ? '已超过确认与签字截止时间，订单将失效（请刷新以同步状态）。'
                  : payExpired
                    ? contract?.renewedFromId
                      ? '已超过续签首期款支付期限，合同将失效（请刷新以同步状态）。'
                      : '已超过待付款后 24 小时付款期限，合同将失效（请刷新以同步状态）。'
                    : '当前状态已结束倒计时。'
            : contract?.status === 'PENDING_PAYMENT'
              ? '已进入待付款：请在倒计时结束前完成首期款支付。'
              : contract?.status === 'WAIT_STAMP'
                ? '合同已确认，系统处理中；请稍后刷新，进入待付款后将显示首期款支付倒计时。'
              : contract?.status === 'WAIT_TENANT_SIGN'
                ? contract?.renewedFromId
                  ? '续签新合同：请在下方倒计时内完成确认与签字；须在同一截止时点前完成首期款支付（起租首日起 24 小时）。'
                  : '请在下方倒计时内完成合同确认与签字；超时订单失效、房源重新开放。'
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
            <div className="m-k">确认/签字截止</div>
            <div>
              {contract.tenantSignDeadlineAt
                ? new Date(contract.tenantSignDeadlineAt).toLocaleString('zh-CN')
                : '-'}
            </div>
            <div className="m-k">待付款起始</div>
            <div>{contract.stampedAt ? stampedText : '-'}</div>
          </div>
        ) : null}
        {contract?.status === 'WAIT_STAMP' ? (
          <div className="m-row" style={{ marginTop: 12 }}>
            <button className="m-btn secondary" type="button" onClick={() => void load()}>
              刷新
            </button>
            <Link className="m-btn ghost" to={`/contracts/${contract.id}`}>
              返回合同
            </Link>
          </div>
        ) : null}
      </div>

      {loading && !contract ? <div className="m-card">加载中…</div> : null}

      {contract && contract.status === 'WAIT_TENANT_SIGN' && !expired ? (
        <div className="m-card">
          <div style={{ fontWeight: 900 }}>
            确认与签字倒计时{contract.renewedFromId ? '（续签：起租首日起 24 小时）' : '（3 天）'}
          </div>
          {signRemainingMs != null ? (
            <>
              <div style={{ fontSize: 28, fontWeight: 900, marginTop: 10, color: '#b45309' }}>
                {formatHms(signRemainingMs)}
              </div>
              <div className="m-muted" style={{ marginTop: 6 }}>
                请在截止前于合同页完成「确认合同信息」（含电子签字）；超时订单失效、房源重新开放。
              </div>
            </>
          ) : (
            <div className="m-muted" style={{ marginTop: 8 }}>未获取到截止时间，请返回合同页或联系门店。</div>
          )}
          <div className="m-row" style={{ marginTop: 12 }}>
            <Link className="m-btn" to={`/contracts/${contract.id}`}>
              去合同页确认
            </Link>
            <button className="m-btn secondary" type="button" onClick={() => void load()}>
              刷新
            </button>
          </div>
        </div>
      ) : null}

      {contract && contract.status === 'PENDING_PAYMENT' && !expired ? (
        <div className="m-card">
          <div style={{ fontWeight: 900 }}>
            首期款倒计时（24 小时{contract.renewedFromId ? ' · 续签与起租首日整体截止取较早' : ''}）
          </div>
          {payRemainingMs != null && payDeadlineMs != null ? (
            <>
              <div style={{ fontSize: 28, fontWeight: 900, marginTop: 10, color: '#1d4ed8' }}>
                {formatHms(payRemainingMs)}
              </div>
              <div className="m-muted" style={{ marginTop: 6 }}>
                还剩时间：倒计时结束后合同将自动失效
                {contract.renewedFromId ? '（续签须遵守起租首日起 24 小时规则）。' : '（24h 规则）。'}
              </div>
              <div className="m-muted" style={{ marginTop: 6 }}>
                支付截止：{new Date(payDeadlineMs).toLocaleString('zh-CN')}
              </div>
            </>
          ) : (
            <div className="m-muted" style={{ marginTop: 8 }}>
              正在获取待付款起始时间，倒计时即将显示…
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
            {contract.status === 'VOID' && !contract.stampedAt
              ? '未在约定期限内完成确认与签字，或订单已被系统取消。'
              : contract.status === 'VOID' && contract.stampedAt
                ? contract.renewedFromId
                  ? '续签新合同：未在起租首日起 24 小时内完成首期款支付，合同已自动作废。'
                  : '待付款后的 24 小时内未完成首期款支付，合同已自动作废。'
                : signExpired
                  ? '已超过确认与签字截止时间，请刷新页面；系统将取消订单并释放房源。'
                  : payExpired
                    ? contract?.renewedFromId
                      ? '已超过续签首期款支付期限，请刷新页面以查看最新状态。'
                      : '已超过待付款后 24 小时付款期限，请刷新页面以查看最新状态。'
                    : '当前合同已结束有效流程。'}
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

