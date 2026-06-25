import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addMyOrder, apiGet, apiPost, setTenantPhone, type MyOrderSummary } from '../api'
import {
  IdDocumentFields,
  validateIdDocumentForm,
  type IdDocType,
} from '../components/IdDocumentFields'

const BOWAN_ASSET = '泊湾公寓'

type HouseOrderMeta = {
  id: string
  apartmentName: string
  assetType: string
  storeName: string
  houseNo: string
  houseType: string
  area: number
  rentMonthly: number
  externalBrowseUrl?: string | null
}

function openExternalUrl(url: string) {
  const u = url.trim()
  if (!u) return
  window.open(u, '_blank', 'noopener,noreferrer')
}

export function OrderCreatePage() {
  const { houseId } = useParams()

  const [house, setHouse] = useState<HouseOrderMeta | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [leaseMonths, setLeaseMonths] = useState(12)
  const [moveInDate, setMoveInDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [docType, setDocType] = useState<IdDocType>('IDCARD')
  const [name, setName] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [phone, setPhone] = useState('13800000000')
  const [wechat, setWechat] = useState('wx_demo')
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [successWecom, setSuccessWecom] = useState<{ storeName: string; qrUrl: string | null } | null>(null)
  const [showFaceModal, setShowFaceModal] = useState(false)
  const [faceSubmitting, setFaceSubmitting] = useState(false)
  const disabled = useMemo(() => !houseId, [houseId])

  const [idLongTerm, setIdLongTerm] = useState(false)
  const [idValidUntil, setIdValidUntil] = useState('')
  const [extraDocValidUntil, setExtraDocValidUntil] = useState('')

  const isBowan = house?.assetType === BOWAN_ASSET
  const browseExternalUrl = useMemo(() => (house?.externalBrowseUrl ?? '').trim(), [house])

  useEffect(() => {
    if (!houseId) return
    let alive = true
    void (async () => {
      const r = await apiGet<HouseOrderMeta>(`/api/houses/${houseId}`)
      if (!alive) return
      if (!r.ok) {
        setLoadErr(r.error)
        setHouse(null)
        return
      }
      setLoadErr('')
      setHouse(r.data)
    })()
    return () => {
      alive = false
    }
  }, [houseId])

  function onDocTypeChange(next: IdDocType) {
    if (next === docType) return
    setDocType(next)
    setIdNumber('')
    setIdLongTerm(false)
    setIdValidUntil('')
    setExtraDocValidUntil('')
    setError('')
  }

  async function submitOrderToBackend() {
    if (!houseId || !house) return
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
      // ignore
    }
    const createdAt = new Date().toISOString()
    const idNorm =
      docType === 'IDCARD' || docType === 'USCC' ? idNumber.trim().toUpperCase() : idNumber.trim()

    const base: Record<string, unknown> = {
      houseId,
      name: name.trim(),
      idNumber: idNorm,
      phone: phone.trim(),
      wechat,
      idDocType: docType,
    }
    if (docType === 'IDCARD') {
      base.idCardLongTerm = idLongTerm
      if (!idLongTerm) base.idCardValidUntil = idValidUntil
    } else if (docType === 'PASSPORT' || docType === 'HKM_TW_PERMIT') {
      if (extraDocValidUntil.trim()) base.docValidUntil = extraDocValidUntil.trim()
    }

    const payload =
      house.assetType === BOWAN_ASSET ? { ...base, leaseMonths, moveInDate } : base

    const r = await apiPost<{
      id: string
      status: string
      tenantPhone: string
      tips: string
      house?: { storeName?: string }
      storeWecomQrUrl?: string | null
    }>('/api/orders', payload)
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

  function onTapDirectOrder() {
    setError('')
    const formErr = validateIdDocumentForm({
      docType,
      name,
      idNumber,
      phone,
      idLongTerm,
      idValidUntil,
      extraDocValidUntil,
    })
    if (formErr) {
      setError(formErr)
      return
    }
    setShowFaceModal(true)
  }

  async function onFaceVerifySuccess() {
    setFaceSubmitting(true)
    setShowFaceModal(false)
    await submitOrderToBackend()
    setFaceSubmitting(false)
  }

  const orderPlaced = Boolean(okMsg)

  const documentBlock = !orderPlaced ? (
    <IdDocumentFields
      docType={docType}
      name={name}
      idNumber={idNumber}
      phone={phone}
      wechat={wechat}
      idLongTerm={idLongTerm}
      idValidUntil={idValidUntil}
      extraDocValidUntil={extraDocValidUntil}
      onDocTypeChange={onDocTypeChange}
      onNameChange={setName}
      onIdNumberChange={setIdNumber}
      onPhoneChange={setPhone}
      onWechatChange={setWechat}
      onIdLongTermChange={setIdLongTerm}
      onIdValidUntilChange={setIdValidUntil}
      onExtraDocValidUntilChange={setExtraDocValidUntil}
    />
  ) : null

  if (loadErr) {
    return (
      <div className="m-col">
        <div className="m-card m-error">无法加载房源：{loadErr}</div>
        {houseId ? (
          <Link className="m-btn ghost" to={`/houses/${houseId}`} style={{ textAlign: 'center' }}>
            返回房源详情
          </Link>
        ) : null}
      </div>
    )
  }

  if (!houseId || !house) {
    return (
      <div className="m-col">
        <div className="m-card m-muted">正在加载房源信息…</div>
      </div>
    )
  }

  return (
    <div className="m-col">
      {!orderPlaced && isBowan ? (
        <>
          <div className="m-card m-order-intro">
            <div className="m-order-intro-title">请录入您的租房意向信息</div>
            <div className="m-muted">填写后点击「直接下单」，将先完成扫脸实名认证再提交至后台。</div>
          </div>
          {documentBlock}
          <div className="m-card m-col">
            <label className="m-muted m-label-required">租期（月）</label>
            <input className="m-input" type="number" value={leaseMonths} onChange={(e) => setLeaseMonths(Number(e.target.value))} />

            <label className="m-muted m-label-required">入住日期</label>
            <input className="m-input" type="date" value={moveInDate} onChange={(e) => setMoveInDate(e.target.value)} />
          </div>
        </>
      ) : null}

      {!orderPlaced && !isBowan ? (
        <>
          <div className="m-card m-order-intro">
            <div className="m-order-intro-title">{house.assetType} · 在线意向</div>
            <div className="m-muted">
              可先通过「仅浏览」打开合作方页面了解详情；需要在本平台登记意向时，请填写下方信息并点击「直接下单」（租期与入住日由后台按默认规则生成，无需在此填写）。
            </div>
          </div>

          <div className="m-card m-col">
            <div style={{ fontWeight: 800 }}>
              {house.apartmentName} · {house.houseNo}
            </div>
            <div className="m-muted">
              {house.storeName} · {house.houseType} · {house.area}㎡ · 约 ¥{house.rentMonthly}/月
            </div>
            {!browseExternalUrl ? (
              <div className="m-error" style={{ marginTop: 12, fontSize: 14 }}>
                尚未配置「仅浏览」外链：请在后台「资产管理 → 房源配置」中填写合作方展示页地址。
              </div>
            ) : null}
          </div>
          {documentBlock}
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

      {!orderPlaced && isBowan ? (
        <div className="m-row" style={{ gap: 10 }}>
          <button
            type="button"
            className="m-btn"
            disabled={disabled || faceSubmitting}
            onClick={onTapDirectOrder}
            style={{ flex: 1 }}
          >
            {faceSubmitting ? '提交中…' : '直接下单'}
          </button>
        </div>
      ) : null}

      {!orderPlaced && !isBowan ? (
        <div className="m-row" style={{ gap: 10 }}>
          <button
            type="button"
            className="m-btn ghost"
            style={{ flex: 1 }}
            disabled={!browseExternalUrl}
            onClick={() => openExternalUrl(browseExternalUrl)}
          >
            仅浏览
          </button>
          <button
            type="button"
            className="m-btn"
            style={{ flex: 1 }}
            disabled={disabled || faceSubmitting}
            onClick={onTapDirectOrder}
          >
            {faceSubmitting ? '提交中…' : '直接下单'}
          </button>
        </div>
      ) : null}

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
              <strong>说明：</strong>不实际调用认证接口，点击下方按钮即视为「认证成功」，
              随后将把订单信息提交至管理后台。
            </div>
            <div className="m-modal-actions">
              <button type="button" className="m-modal-close" onClick={() => setShowFaceModal(false)}>
                取消
              </button>
              <button type="button" className="m-btn" onClick={onFaceVerifySuccess}>
                模拟认证成功并提交
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
