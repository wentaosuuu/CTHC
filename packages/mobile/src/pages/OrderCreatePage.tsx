import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addMyOrder, apiGet, apiPost, setTenantPhone, type MyOrderSummary } from '../api'
import { IdDocumentFields, useIdDocumentForm } from '../components/IdDocumentFields'

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

type OrderAttachmentItem = {
  id: string
  name: string
  file: string
  category: string
}

function openExternalUrl(url: string) {
  const u = url.trim()
  if (!u) return
  window.open(u, '_blank', 'noopener,noreferrer')
}

function categoryLabel(cat: string) {
  if (cat === 'DEAL_CONFIRMATION') return '成交确认书'
  if (cat === 'BUSINESS_LICENSE') return '营业执照'
  return '其他附件'
}

export function OrderCreatePage() {
  const { houseId } = useParams()

  const [house, setHouse] = useState<HouseOrderMeta | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [leaseMonths, setLeaseMonths] = useState(12)
  const [moveInDate, setMoveInDate] = useState(() => new Date().toISOString().slice(0, 10))
  const idDoc = useIdDocumentForm({ phone: '13800000000', wechat: 'wx_demo' })
  const { values: docValues, validate: validateDocForm } = idDoc
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [successWecom, setSuccessWecom] = useState<{ storeName: string; qrUrl: string | null } | null>(null)
  const [showFaceModal, setShowFaceModal] = useState(false)
  const [faceSubmitting, setFaceSubmitting] = useState(false)
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null)
  const [needAttachments, setNeedAttachments] = useState(false)
  const [attachments, setAttachments] = useState<OrderAttachmentItem[]>([])
  const [uploading, setUploading] = useState(false)
  const disabled = useMemo(() => !houseId, [houseId])

  const isBowan = house?.assetType === BOWAN_ASSET
  const browseExternalUrl = useMemo(() => (house?.externalBrowseUrl ?? '').trim(), [house])
  const isEnterprise = docValues.docType === 'USCC'
  const hasDealConfirmation = attachments.some((a) => a.category === 'DEAL_CONFIRMATION')
  const hasBusinessLicense = attachments.some((a) => a.category === 'BUSINESS_LICENSE')
  const attachmentsReady = hasDealConfirmation && (!isEnterprise || hasBusinessLicense)

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
    const {
      docType,
      name,
      idNumber,
      phone,
      wechat,
      emergencyContactName,
      emergencyContactPhone,
      idLongTerm,
      idValidUntil,
      extraDocValidUntil,
    } = docValues
    const idNorm =
      docType === 'IDCARD' || docType === 'USCC' ? idNumber.trim().toUpperCase() : idNumber.trim()

    const base: Record<string, unknown> = {
      houseId,
      name: name.trim(),
      idNumber: idNorm,
      phone: phone.trim(),
      wechat,
      ...(emergencyContactName.trim() ? { emergencyContactName: emergencyContactName.trim() } : {}),
      ...(emergencyContactPhone.trim() ? { emergencyContactPhone: emergencyContactPhone.trim() } : {}),
      idDocType: docType,
      faceVerified: true,
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
      needsOrderAttachments?: boolean
      house?: { storeName?: string }
      storeWecomQrUrl?: string | null
    }>('/api/orders', payload)
    if (!r.ok) return setError(r.error)
    setTenantPhone(r.data.tenantPhone)
    addMyOrder({
      id: r.data.id,
      createdAt,
      statusText: r.data.needsOrderAttachments
        ? '已提交，请上传成交确认书等附件'
        : '已提交，等待管理员审核',
      ...houseSnapshot,
    })
    const storeName = r.data.house?.storeName ?? '门店'
    setSuccessWecom({
      storeName,
      qrUrl: r.data.storeWecomQrUrl ?? null,
    })
    setCreatedOrderId(r.data.id)
    if (r.data.needsOrderAttachments) {
      setNeedAttachments(true)
      setAttachments([])
      setOkMsg('')
    } else {
      setNeedAttachments(false)
      setOkMsg(`下单成功！订单号 ${r.data.id}。请尽快添加店长企业微信，方便跟进审核与签约。`)
    }
  }

  async function uploadAttachment(category: 'DEAL_CONFIRMATION' | 'BUSINESS_LICENSE', file: File | null) {
    if (!file || !createdOrderId) return
    const phone = docValues.phone.trim()
    if (!phone) return setError('请先填写手机号')
    setUploading(true)
    setError('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('category', category)
    const res = await fetch(`/api/orders/${encodeURIComponent(createdOrderId)}/attachment`, {
      method: 'POST',
      headers: { 'x-tenant-phone': phone },
      body: fd,
    })
    setUploading(false)
    if (!res.ok) {
      let err = '上传失败'
      try {
        const j = (await res.json()) as { error?: string }
        if (j.error === 'DEAL_CONFIRMATION_REQUIRED') err = '请上传成交确认书'
        else if (j.error) err = j.error
      } catch {
        /* ignore */
      }
      return setError(err)
    }
    const data = (await res.json()) as { attachments: OrderAttachmentItem[] }
    setAttachments(data.attachments)
  }

  function finishAttachmentStep() {
    if (!attachmentsReady) {
      setError(
        isEnterprise
          ? '请先上传成交确认书与营业执照'
          : '请先上传成交确认书',
      )
      return
    }
    setNeedAttachments(false)
    setOkMsg(
      `下单成功！订单号 ${createdOrderId}。附件已提交，请尽快添加店长企业微信，方便跟进审核与签约。`,
    )
  }

  function onTapDirectOrder() {
    setError('')
    idDoc.setOcrError('')
    const formErr = validateDocForm()
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

  const orderPlaced = Boolean(okMsg) || (Boolean(createdOrderId) && needAttachments)

  const documentBlock = !orderPlaced ? <IdDocumentFields {...idDoc.fieldsProps} /> : null

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
            <input
              className="m-input"
              type="number"
              value={leaseMonths}
              onChange={(e) => setLeaseMonths(Number(e.target.value))}
            />

            <label className="m-muted m-label-required">入住日期</label>
            <input
              className="m-input"
              type="date"
              value={moveInDate}
              onChange={(e) => setMoveInDate(e.target.value)}
            />
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

      {needAttachments && createdOrderId ? (
        <div className="m-card m-col">
          <div style={{ fontWeight: 900 }}>上传意向附件</div>
          <div className="m-muted" style={{ marginTop: 6 }}>
            订单号 {createdOrderId}。厂房/商铺/住宅需上传成交确认书
            {isEnterprise ? '与营业执照' : ''}后，店长方可审核。
          </div>
          <div style={{ marginTop: 12 }}>
            <label className="m-muted m-label-required">成交确认书</label>
            <input
              className="m-input"
              type="file"
              accept="image/*,.pdf"
              disabled={uploading}
              onChange={(e) => void uploadAttachment('DEAL_CONFIRMATION', e.target.files?.[0] ?? null)}
            />
          </div>
          {isEnterprise ? (
            <div>
              <label className="m-muted m-label-required">营业执照</label>
              <input
                className="m-input"
                type="file"
                accept="image/*,.pdf"
                disabled={uploading}
                onChange={(e) => void uploadAttachment('BUSINESS_LICENSE', e.target.files?.[0] ?? null)}
              />
            </div>
          ) : null}
          {attachments.length > 0 ? (
            <ul className="m-muted" style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
              {attachments.map((a) => (
                <li key={a.id}>
                  {categoryLabel(a.category)} · {a.name}
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            className="m-btn"
            style={{ marginTop: 12 }}
            disabled={uploading || !attachmentsReady}
            onClick={finishAttachmentStep}
          >
            {uploading ? '上传中…' : '完成并提交审核'}
          </button>
        </div>
      ) : null}

      {error ? <div className="m-card m-error">提交失败：{error}</div> : null}

      {okMsg ? (
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
            <div className="m-modal-title" id="face-modal-title">
              扫脸实名认证
            </div>
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
