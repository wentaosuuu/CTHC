import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getMyOrders, type MyOrderSummary } from '../api'

const NEED_CONFIRM_TEXT = '确认订单'

function needConfirmOrder(order: MyOrderSummary) {
  return order.statusText?.includes(NEED_CONFIRM_TEXT) ?? false
}

// Demo 合同信息（与「审核通过，请确认订单」订单同页直接展示）
const DEMO_CONTRACT = {
  id: 'DEMO-CONTRACT-001',
  contractNo: 'HT20260316001',
  apartmentName: '良庆·悦居公寓',
  houseNo: '330',
  storeName: '南宁市-良庆区',
  tenantName: '张三',
  tenantPhone: '13810000000',
  startDate: '2026-04-01',
  endDate: '2027-03-31',
  rentMonthly: 4200,
  deposit: 4200,
}

function isSignedOrder(order: MyOrderSummary) {
  return order.statusText?.includes('已签约') ?? false
}

function contractThumbDataUri(contractNo: string) {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160">
  <rect width="240" height="160" rx="12" fill="#eef2ff"/>
  <rect x="16" y="16" width="208" height="128" rx="10" fill="#ffffff" stroke="#c7d2fe"/>
  <text x="28" y="44" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#1e3a8a">租赁合同</text>
  <text x="28" y="70" font-family="Arial, sans-serif" font-size="12" fill="#334155">合同号：${contractNo}</text>
  <text x="28" y="92" font-family="Arial, sans-serif" font-size="12" fill="#334155">房源：良庆·悦居公寓 · 330</text>
  <text x="28" y="114" font-family="Arial, sans-serif" font-size="12" fill="#334155">租期：2026-04-01 至 2027-03-31</text>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function MyOrderDetailPage() {
  const { id } = useParams()
  const [contractConfirmed, setContractConfirmed] = useState(false)
  const [showContractPreview, setShowContractPreview] = useState(false)

  const order = useMemo<MyOrderSummary | null>(() => {
    if (!id) return null
    const all = getMyOrders()
    return all.find((o) => o.id === id) ?? null
  }, [id])

  if (!id) {
    return <div className="m-card m-error">未找到该订单。</div>
  }

  if (!order) {
    return <div className="m-card">正在加载订单详情…</div>
  }

  const showContractBlock = needConfirmOrder(order)
  const signed = isSignedOrder(order)
  const contractNo = order.contractNo || DEMO_CONTRACT.contractNo
  const contractThumb = contractThumbDataUri(contractNo)

  function downloadDemoContract() {
    const lines = [
      '租赁合同',
      `合同号：${contractNo}`,
      `房源：${DEMO_CONTRACT.apartmentName} · ${DEMO_CONTRACT.houseNo}`,
      `门店：${DEMO_CONTRACT.storeName}`,
      `租客：${DEMO_CONTRACT.tenantName}（${DEMO_CONTRACT.tenantPhone}）`,
      `租期：${DEMO_CONTRACT.startDate} 至 ${DEMO_CONTRACT.endDate}`,
      `月租：¥${DEMO_CONTRACT.rentMonthly} / 押金：¥${DEMO_CONTRACT.deposit}`,
      '',
      '说明：可替换为后端真实合同 PDF 下载链接。',
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${contractNo}-租赁合同.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="m-col">
      <div className="m-card">
        <div className="m-h1">{order.houseTitle ?? '订单详情'}</div>
        <div className="m-muted" style={{ marginTop: 4 }}>
          {order.houseSubtitle ?? `订单号：${order.id}`}
        </div>
        <div style={{ height: 12 }} />
        <div className="m-kv">
          <div className="m-k">订单号</div>
          <div>{order.id}</div>
          <div className="m-k">提交时间</div>
          <div>{new Date(order.createdAt).toLocaleString()}</div>
          {order.rentMonthly ? (
            <>
              <div className="m-k">月租</div>
              <div>¥{order.rentMonthly}/月</div>
            </>
          ) : null}
          <div className="m-k">当前状态</div>
          <div>{order.statusText ?? '已提交，等待管理员审核'}</div>
        </div>
      </div>

      {showContractBlock ? (
        <>
          <div className="m-card">
            <div style={{ fontWeight: 900 }}>合同信息</div>
            <div className="m-muted" style={{ marginTop: 4 }}>请仔细阅读以下合同内容，确认无误后点击底部按钮。</div>
            <div style={{ height: 12 }} />
            <div className="m-kv">
              <div className="m-k">合同号</div>
              <div>{DEMO_CONTRACT.contractNo}</div>
              <div className="m-k">房源</div>
              <div>{DEMO_CONTRACT.apartmentName} · {DEMO_CONTRACT.houseNo}</div>
              <div className="m-k">门店</div>
              <div>{DEMO_CONTRACT.storeName}</div>
              <div className="m-k">租客</div>
              <div>{DEMO_CONTRACT.tenantName}（{DEMO_CONTRACT.tenantPhone}）</div>
              <div className="m-k">租期</div>
              <div>{DEMO_CONTRACT.startDate} 至 {DEMO_CONTRACT.endDate}</div>
              <div className="m-k">月租</div>
              <div>¥{DEMO_CONTRACT.rentMonthly}/月</div>
              <div className="m-k">押金</div>
              <div>¥{DEMO_CONTRACT.deposit}</div>
            </div>
          </div>

          <div className="m-card" style={{ marginTop: 4 }}>
            <div style={{ fontWeight: 900 }}>确认合同信息</div>
            <div className="m-muted" style={{ marginTop: 6 }}>
              确认上述合同信息无误后，请点击下方按钮。
            </div>
            <div style={{ marginTop: 12 }}>
              {contractConfirmed ? (
                <div style={{ color: '#047857', fontWeight: 600 }}>您已确认合同信息</div>
              ) : (
                <button
                  type="button"
                  className="m-btn"
                  onClick={() => setContractConfirmed(true)}
                >
                  确认合同信息
                </button>
              )}
            </div>
          </div>
        </>
      ) : null}

      {signed ? (
        <div className="m-card">
          <div style={{ fontWeight: 900 }}>合同文件</div>
          <div className="m-muted" style={{ marginTop: 6 }}>
            合同已生效，可预览或下载合同文件。
          </div>
          <div className="m-contract-file">
            <img src={contractThumb} alt="合同缩略图" className="m-contract-thumb" />
            <div className="m-col" style={{ gap: 8, flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{contractNo}</div>
              <div className="m-row" style={{ gap: 8 }}>
                <button type="button" className="m-btn ghost" onClick={() => setShowContractPreview(true)}>
                  合同预览
                </button>
                <button type="button" className="m-btn" onClick={downloadDemoContract}>
                  下载合同
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showContractPreview ? (
        <div
          className="m-modal-backdrop"
          onClick={() => setShowContractPreview(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowContractPreview(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="m-modal-box m-contract-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="m-modal-title">合同预览</div>
            <div className="m-modal-desc">{contractNo}</div>
            <div className="m-contract-preview">
              <img src={contractThumb} alt="合同预览" />
            </div>
            <div className="m-row" style={{ gap: 8, marginTop: 12 }}>
              <button type="button" className="m-btn ghost" onClick={() => setShowContractPreview(false)}>
                关闭
              </button>
              <button type="button" className="m-btn" onClick={downloadDemoContract}>
                下载合同
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

