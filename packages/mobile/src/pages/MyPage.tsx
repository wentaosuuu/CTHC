import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getMyOrders } from '../api'

export function MyPage() {
  const orderCount = useMemo(() => getMyOrders().length, [])

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
              <span className="m-my-menu-desc">共 {orderCount} 条</span>
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
