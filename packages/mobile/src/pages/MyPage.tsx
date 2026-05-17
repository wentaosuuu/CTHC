import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { getMyOrders, getTenantPhone, resolveContractForOrderDisplay, type TenantContractItem } from '../api'
import { pendingFirstPayDeadlineMs } from '../countdownFormat'
import { useTenantContractItems } from '../hooks/useTenantContractItems'

function summarizeUrgency(orders: ReturnType<typeof getMyOrders>, contracts: TenantContractItem[], now: number) {
  let sign = 0
  let pay = 0
  for (const o of orders) {
    const c = resolveContractForOrderDisplay(o, contracts)
    if (!c || c.status === 'VOID' || c.status === 'TERMINATED' || c.status === 'WAIT_STAMP') continue
    if (c.status === 'WAIT_TENANT_SIGN' && c.tenantSignDeadlineAt) {
      const left = new Date(c.tenantSignDeadlineAt).getTime() - now
      if (left > 0) sign += 1
    } else if (c.status === 'PENDING_PAYMENT' && c.stampedAt) {
      const endMs = pendingFirstPayDeadlineMs(c)
      if (endMs != null && endMs - now > 0) pay += 1
    }
  }
  return { sign, pay }
}

export function MyPage() {
  const location = useLocation()
  const orders = useMemo(() => getMyOrders(), [location.key])
  const { items: contracts, now } = useTenantContractItems(location.key)
  const hasPhone = Boolean(getTenantPhone().trim())

  const orderDesc = useMemo(() => {
    const base = `共 ${orders.length} 条`
    if (!hasPhone) return `${base} · 绑定手机号可显示签约/付款倒计时`
    const { sign, pay } = summarizeUrgency(orders, contracts, now)
    const parts: string[] = []
    if (sign > 0) parts.push(`${sign} 个合同待确认`)
    if (pay > 0) parts.push(`${pay} 笔首期款待付`)
    if (parts.length === 0) return base
    return `${base} · ${parts.join('，')}`
  }, [orders, contracts, now, hasPhone])

  return (
    <div className="m-col">
      <div className="m-card">
        <div className="m-h1">我的服务</div>
        <div className="m-muted" style={{ marginTop: 6 }}>
          在这里统一管理订单、账单和个人资料
        </div>
        <div className="m-my-menu-list">
          <Link className="m-my-menu-item" to="/me/profile">
            <div className="m-my-menu-main">
              <span className="m-my-menu-title">个人信息</span>
              <span className="m-my-menu-desc">维护姓名、手机号和紧急联系人</span>
            </div>
            <span className="m-my-menu-arrow">›</span>
          </Link>
          <Link className="m-my-menu-item" to="/me/orders">
            <div className="m-my-menu-main">
              <span className="m-my-menu-title">我的订单</span>
              <span className="m-my-menu-desc">{orderDesc}</span>
            </div>
            <span className="m-my-menu-arrow">›</span>
          </Link>
          <Link className="m-my-menu-item" to="/bills">
            <div className="m-my-menu-main">
              <span className="m-my-menu-title">我的账单</span>
              <span className="m-my-menu-desc">查看待支付和历史账单</span>
            </div>
            <span className="m-my-menu-arrow">›</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
