import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { addMyOrder, apiGet, apiPost, setTenantPhone, type MyOrderSummary } from '../api'

export function OrderCreatePage() {
  const { houseId } = useParams()

  const [leaseMonths, setLeaseMonths] = useState(12)
  const [moveInDate, setMoveInDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [name, setName] = useState('张三')
  const [idNumber, setIdNumber] = useState('310101199001011234')
  const [phone, setPhone] = useState('13800000000')
  const [wechat, setWechat] = useState('wx_demo')
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  /** 下单成功后展示该门店企微二维码 */
  const [successWecom, setSuccessWecom] = useState<{ storeName: string; qrUrl: string | null } | null>(null)
  const [showFaceModal, setShowFaceModal] = useState(false)
  const [faceSubmitting, setFaceSubmitting] = useState(false)
  const disabled = useMemo(() => !houseId, [houseId])

  async function submitOrderToBackend() {
    if (!houseId) return
    setError('')
    setOkMsg('')
    setSuccessWecom(null)
    let houseSnapshot: Partial<MyOrderSummary> = {}
    try {
      const h = await apiGet<{
        id: string
        apartmentName: string
        storeName: string
        houseNo: string
        houseType: string
        area: number
        rentMonthly: number
      }>(`/api/houses/${houseId}`)
      if (h.ok) {
        houseSnapshot = {
          houseId,
          houseTitle: `${h.data.apartmentName} · ${h.data.houseNo}`,
          houseSubtitle: `${h.data.storeName} · ${h.data.houseType} · ${h.data.area}㎡`,
          rentMonthly: h.data.rentMonthly,
        }
      }
    } catch {
      // 忽略房源信息获取失败，仅影响“我的订单”展示
    }
    const createdAt = new Date().toISOString()
    const r = await apiPost<{
      id: string
      status: string
      tenantPhone: string
      tips: string
      house?: { storeName?: string }
      storeWecomQrUrl?: string | null
    }>('/api/orders', { houseId, leaseMonths, moveInDate, name, idNumber, phone, wechat })
    if (!r.ok) return setError(r.error)
    setTenantPhone(r.data.tenantPhone)
    addMyOrder({
      id: r.data.id,
      createdAt,
      statusText: '已提交，等待管理员审核',
      ...houseSnapshot,
    })
    const storeName = r.data.house?.storeName ?? '门店'
    setSuccessWecom({
      storeName,
      qrUrl: r.data.storeWecomQrUrl ?? null,
    })
    setOkMsg(`下单成功！订单号 ${r.data.id}。请尽快添加店长企业微信，方便跟进审核与签约。`)
  }

  function onTapSubmitOrder() {
    setError('')
    setShowFaceModal(true)
  }

  async function onFaceVerifySuccess() {
    setFaceSubmitting(true)
    setShowFaceModal(false)
    await submitOrderToBackend()
    setFaceSubmitting(false)
  }

  const orderPlaced = Boolean(okMsg)

  return (
    <div className="m-col">
      {!orderPlaced ? (
        <>
          <div className="m-card m-order-intro">
            <div className="m-order-intro-title">请录入您的租房意向信息</div>
            <div className="m-muted">填写后点击「提交订单」，将先完成扫脸实名认证再提交至后台。</div>
          </div>

          <div className="m-card m-col">
            <label className="m-muted m-label-required">租期（月）</label>
            <input className="m-input" type="number" value={leaseMonths} onChange={(e) => setLeaseMonths(Number(e.target.value))} />

            <label className="m-muted m-label-required">入住日期</label>
            <input className="m-input" type="date" value={moveInDate} onChange={(e) => setMoveInDate(e.target.value)} />

            <label className="m-muted m-label-required">姓名</label>
            <input className="m-input" value={name} onChange={(e) => setName(e.target.value)} />

            <label className="m-muted m-label-required">身份证号</label>
            <input className="m-input" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />

            <label className="m-muted m-label-required">手机号</label>
            <input className="m-input" value={phone} onChange={(e) => setPhone(e.target.value)} />

            <label className="m-muted">微信（可选）</label>
            <input className="m-input" value={wechat} onChange={(e) => setWechat(e.target.value)} />
          </div>
        </>
      ) : null}

      {!orderPlaced && error ? <div className="m-card m-error">提交失败：{error}</div> : null}

      {orderPlaced && okMsg ? (
        <div className="m-card m-order-success m-order-success-only">
          <div className="m-order-success-badge">下单成功</div>
          <div className="m-success">{okMsg}</div>
          {successWecom ? (
            <div className="m-wecom-block">
              <div className="m-wecom-title">联系店长（企业微信）</div>
              <p className="m-wecom-tip m-wecom-tip-em">
                请优先完成这一步：长按下图保存二维码，用<strong>微信扫一扫</strong>添加店长企业微信，方便跟进<strong>审核与签约</strong>。
              </p>
              <p className="m-wecom-tip">
                订单已提交至 <strong>{successWecom.storeName}</strong>。
              </p>
              {successWecom.qrUrl ? (
                <div className="m-wecom-qr-wrap">
                  <img
                    className="m-wecom-qr"
                    src={successWecom.qrUrl}
                    alt={`${successWecom.storeName}店长企业微信二维码`}
                  />
                </div>
              ) : (
                <p className="m-muted m-wecom-fallback">
                  该门店暂未上传企微二维码，请通过订单页预留的手机号等待店长与您联系。
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {!orderPlaced ? (
        <div className="m-row">
          <button
            className="m-btn"
            disabled={disabled || faceSubmitting}
            onClick={onTapSubmitOrder}
            style={{ flex: 1 }}
          >
            {faceSubmitting ? '提交中…' : '提交订单'}
          </button>
        </div>
      ) : null}

      {/* 扫脸实名认证弹窗（Demo：模拟调起认证接口，认证成功后再提交订单） */}
      {showFaceModal && !orderPlaced && (
        <div
          className="m-modal-backdrop"
          onClick={() => setShowFaceModal(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowFaceModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="face-modal-title"
        >
          <div className="m-modal-box m-face-modal" onClick={(e) => e.stopPropagation()}>
            <div className="m-modal-title" id="face-modal-title">扫脸实名认证</div>
            <div className="m-modal-desc">
              提交订单前需完成实名认证。此处将调起扫脸认证接口（如：对接公安/第三方活体检测），
              真实场景中会打开摄像头进行人脸识别，通过后即可提交订单至店长审核。
            </div>
            <div className="m-face-demo-tip">
              <strong>Demo 说明：</strong>不实际调用认证接口，点击下方按钮即视为「认证成功」，
              随后将把订单信息提交至管理后台。
            </div>
            <div className="m-modal-actions">
              <button
                type="button"
                className="m-modal-close"
                onClick={() => setShowFaceModal(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="m-btn"
                onClick={onFaceVerifySuccess}
              >
                模拟认证成功并提交
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
