import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addMyOrder, apiGet, apiPost, setTenantPhone, type MyOrderSummary } from '../api'
import {
  isHkmTwPermitNo,
  isMainland18Id,
  isPassportNo,
  isUscc18,
  optionalDocExpiryMessage,
  readFileAsDataURL,
  validateIdExpiryMessage,
} from '../idCardUtils'

const BOWAN_ASSET = '泊湾公寓'

export type IdDocType = 'IDCARD' | 'PASSPORT' | 'HKM_TW_PERMIT' | 'USCC'

const DOC_TYPE_LABEL: Record<IdDocType, string> = {
  IDCARD: '身份证',
  PASSPORT: '护照',
  HKM_TW_PERMIT: '港澳台通行证',
  USCC: '统一社会信用代码',
}

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

type RecognizeResp = {
  ok: true
  rawText: string
  name?: string | null
  idNumber?: string | null
  validFrom?: string
  validUntil?: string
  longTerm: boolean
}

function openExternalUrl(url: string) {
  const u = url.trim()
  if (!u) return
  window.open(u, '_blank', 'noopener,noreferrer')
}

function imageFileError(file: File | null): string | null {
  if (!file) return null
  if (!file.type.startsWith('image/')) return '请选择图片文件'
  if (file.size > 5 * 1024 * 1024) return '单张图片请不超过 5MB'
  return null
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

  const [idFrontPreview, setIdFrontPreview] = useState<string | null>(null)
  const [idBackPreview, setIdBackPreview] = useState<string | null>(null)
  const [ocrFrontBusy, setOcrFrontBusy] = useState(false)
  const [ocrBackBusy, setOcrBackBusy] = useState(false)
  const [idFrontRecognizedOk, setIdFrontRecognizedOk] = useState(false)
  const [idBackRecognizedOk, setIdBackRecognizedOk] = useState(false)
  const [idLongTerm, setIdLongTerm] = useState(false)
  const [idValidUntil, setIdValidUntil] = useState('')

  const [ppPreview, setPpPreview] = useState<string | null>(null)
  const [passportPageOk, setPassportPageOk] = useState(false)

  const [hkmFrontPreview, setHkmFrontPreview] = useState<string | null>(null)
  const [hkmBackPreview, setHkmBackPreview] = useState<string | null>(null)
  const [hkmFrontOk, setHkmFrontOk] = useState(false)
  const [hkmBackOk, setHkmBackOk] = useState(false)

  const [usccPreview, setUsccPreview] = useState<string | null>(null)
  const [usccScanOk, setUsccScanOk] = useState(false)

  /** 护照 / 港澳台通行证 可选填的「有效期至」 */
  const [extraDocValidUntil, setExtraDocValidUntil] = useState('')

  const isBowan = house?.assetType === BOWAN_ASSET
  const browseExternalUrl = useMemo(() => (house?.externalBrowseUrl ?? '').trim(), [house])

  const revokeIf = useCallback((u: string | null) => {
    if (u) URL.revokeObjectURL(u)
  }, [])

  const resetAllDocumentUploads = useCallback(() => {
    revokeIf(idFrontPreview)
    revokeIf(idBackPreview)
    revokeIf(ppPreview)
    revokeIf(hkmFrontPreview)
    revokeIf(hkmBackPreview)
    revokeIf(usccPreview)
    setIdFrontPreview(null)
    setIdBackPreview(null)
    setPpPreview(null)
    setHkmFrontPreview(null)
    setHkmBackPreview(null)
    setUsccPreview(null)
    setOcrFrontBusy(false)
    setOcrBackBusy(false)
    setIdFrontRecognizedOk(false)
    setIdBackRecognizedOk(false)
    setPassportPageOk(false)
    setHkmFrontOk(false)
    setHkmBackOk(false)
    setUsccScanOk(false)
    setIdLongTerm(false)
    setIdValidUntil('')
    setExtraDocValidUntil('')
  }, [
    idFrontPreview,
    idBackPreview,
    ppPreview,
    hkmFrontPreview,
    hkmBackPreview,
    usccPreview,
    revokeIf,
  ])

  useEffect(() => {
    return () => {
      revokeIf(idFrontPreview)
      revokeIf(idBackPreview)
      revokeIf(ppPreview)
      revokeIf(hkmFrontPreview)
      revokeIf(hkmBackPreview)
      revokeIf(usccPreview)
    }
  }, [idFrontPreview, idBackPreview, ppPreview, hkmFrontPreview, hkmBackPreview, usccPreview, revokeIf])

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
    resetAllDocumentUploads()
    setDocType(next)
    setIdNumber('')
    setError('')
  }

  async function onPickIdFront(file: File | null) {
    setError('')
    const err = imageFileError(file)
    if (err || !file) return
    setIdFrontRecognizedOk(false)
    setOcrFrontBusy(true)
    revokeIf(idFrontPreview)
    const url = URL.createObjectURL(file)
    setIdFrontPreview(url)
    try {
      const dataUrl = await readFileAsDataURL(file)
      const r = await apiPost<RecognizeResp>('/api/id-card/recognize', { side: 'front', image: dataUrl })
      if (!r.ok) {
        setError(r.error)
        setOcrFrontBusy(false)
        return
      }
      setIdFrontRecognizedOk(true)
      if (r.data.name) setName(r.data.name)
      if (r.data.idNumber) setIdNumber(r.data.idNumber)
    } catch {
      setError('读取人像面图片失败')
    }
    setOcrFrontBusy(false)
  }

  async function onPickIdBack(file: File | null) {
    setError('')
    const err = imageFileError(file)
    if (err || !file) return
    setIdBackRecognizedOk(false)
    setOcrBackBusy(true)
    revokeIf(idBackPreview)
    const url = URL.createObjectURL(file)
    setIdBackPreview(url)
    try {
      const dataUrl = await readFileAsDataURL(file)
      const r = await apiPost<RecognizeResp>('/api/id-card/recognize', { side: 'back', image: dataUrl })
      if (!r.ok) {
        setError(r.error)
        setOcrBackBusy(false)
        return
      }
      setIdBackRecognizedOk(true)
      if (r.data.longTerm) {
        setIdLongTerm(true)
        setIdValidUntil('')
      } else if (r.data.validUntil) {
        setIdLongTerm(false)
        setIdValidUntil(r.data.validUntil)
      }
    } catch {
      setError('读取国徽面图片失败')
    }
    setOcrBackBusy(false)
  }

  function onPickPassportPage(file: File | null) {
    setError('')
    const err = imageFileError(file)
    if (err || !file) return
    revokeIf(ppPreview)
    setPpPreview(URL.createObjectURL(file))
    setPassportPageOk(true)
  }

  function onPickHkmFront(file: File | null) {
    setError('')
    const err = imageFileError(file)
    if (err || !file) return
    revokeIf(hkmFrontPreview)
    setHkmFrontPreview(URL.createObjectURL(file))
    setHkmFrontOk(true)
  }

  function onPickHkmBack(file: File | null) {
    setError('')
    const err = imageFileError(file)
    if (err || !file) return
    revokeIf(hkmBackPreview)
    setHkmBackPreview(URL.createObjectURL(file))
    setHkmBackOk(true)
  }

  function onPickUsccScan(file: File | null) {
    setError('')
    const err = imageFileError(file)
    if (err || !file) return
    revokeIf(usccPreview)
    setUsccPreview(URL.createObjectURL(file))
    setUsccScanOk(true)
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
    if (!name.trim()) {
      setError('请填写姓名')
      return
    }

    if (docType === 'IDCARD') {
      if (!idFrontRecognizedOk || !idBackRecognizedOk) {
        setError('请先上传身份证人像面与国徽面，并等待识别完成（若识别不完整请手动补充）')
        return
      }
      if (!isMainland18Id(idNumber)) {
        setError('请填写正确的 18 位身份证号')
        return
      }
      const ve = validateIdExpiryMessage(idValidUntil, idLongTerm)
      if (ve) {
        setError(ve)
        return
      }
    } else if (docType === 'PASSPORT') {
      if (!passportPageOk) {
        setError('请上传护照资料页照片')
        return
      }
      if (!isPassportNo(idNumber)) {
        setError('护照号码须为 6–24 位字母、数字或连字符')
        return
      }
      const oe = optionalDocExpiryMessage(extraDocValidUntil)
      if (oe) {
        setError(oe)
        return
      }
    } else if (docType === 'HKM_TW_PERMIT') {
      if (!hkmFrontOk || !hkmBackOk) {
        setError('请上传港澳台通行证正面与反面照片')
        return
      }
      if (!isHkmTwPermitNo(idNumber)) {
        setError('请填写正确的通行证号码')
        return
      }
      const oe = optionalDocExpiryMessage(extraDocValidUntil)
      if (oe) {
        setError(oe)
        return
      }
    } else if (docType === 'USCC') {
      if (!usccScanOk) {
        setError('请上传证件扫描件（如营业执照）')
        return
      }
      if (!isUscc18(idNumber)) {
        setError('请填写正确的 18 位统一社会信用代码')
        return
      }
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

  const numberLabel =
    docType === 'IDCARD'
      ? '身份证号'
      : docType === 'PASSPORT'
        ? '护照号码'
        : docType === 'HKM_TW_PERMIT'
          ? '通行证号码'
          : '统一社会信用代码'

  const numberPlaceholder =
    docType === 'IDCARD'
      ? '18 位身份证号'
      : docType === 'PASSPORT'
        ? '护照号码'
        : docType === 'HKM_TW_PERMIT'
          ? '通行证号码'
          : '18 位统一社会信用代码'

  const namePlaceholder =
    docType === 'USCC' ? '联系人姓名（与证件材料一致）' : '与证件一致'

  const documentBlock = !orderPlaced ? (
    <div className="m-card m-col">
      <div style={{ fontWeight: 900 }}>证件信息</div>
      <label className="m-muted m-label-required">证件类型</label>
      <select
        className="m-input"
        value={docType}
        onChange={(e) => onDocTypeChange(e.target.value as IdDocType)}
      >
        {(Object.keys(DOC_TYPE_LABEL) as IdDocType[]).map((k) => (
          <option key={k} value={k}>
            {DOC_TYPE_LABEL[k]}
          </option>
        ))}
      </select>

      {docType === 'IDCARD' ? (
        <>
          <div className="m-muted" style={{ lineHeight: 1.6, marginTop: 10 }}>
            请上传身份证<strong>人像面</strong>与<strong>国徽面</strong>。系统将自动识别姓名、号码与「有效期限」；识别后请核对。
            <strong> 首次识别可能需十余秒</strong>。
          </div>
          <div style={{ height: 12 }} />
          <div className="m-row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <div className="m-muted" style={{ marginBottom: 6 }}>人像面（必填）</div>
              <label className="m-upload-field" style={{ display: 'block' }}>
                <span>{ocrFrontBusy ? '识别中…' : idFrontRecognizedOk ? '已上传（可重选）' : '上传人像面'}</span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={ocrFrontBusy}
                  onChange={(e) => void onPickIdFront(e.target.files?.[0] ?? null)}
                />
              </label>
              {idFrontPreview ? (
                <img src={idFrontPreview} alt="" style={{ width: '100%', marginTop: 8, borderRadius: 8 }} />
              ) : null}
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <div className="m-muted" style={{ marginBottom: 6 }}>国徽面（必填）</div>
              <label className="m-upload-field" style={{ display: 'block' }}>
                <span>{ocrBackBusy ? '识别中…' : idBackRecognizedOk ? '已上传（可重选）' : '上传国徽面'}</span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={ocrBackBusy}
                  onChange={(e) => void onPickIdBack(e.target.files?.[0] ?? null)}
                />
              </label>
              {idBackPreview ? (
                <img src={idBackPreview} alt="" style={{ width: '100%', marginTop: 8, borderRadius: 8 }} />
              ) : null}
            </div>
          </div>
          <div style={{ height: 12 }} />
          <label className="m-muted m-label-required">证件有效期</label>
          <div className="m-col" style={{ gap: 8 }}>
            <label className="m-verify-agree" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={idLongTerm}
                onChange={(e) => {
                  setIdLongTerm(e.target.checked)
                  if (e.target.checked) setIdValidUntil('')
                }}
              />
              <span>长期有效（国徽面「至长期」）</span>
            </label>
            {!idLongTerm ? (
              <input
                className="m-input"
                type="date"
                value={idValidUntil}
                onChange={(e) => setIdValidUntil(e.target.value)}
              />
            ) : null}
          </div>
        </>
      ) : null}

      {docType === 'PASSPORT' ? (
        <>
          <div className="m-muted" style={{ lineHeight: 1.6, marginTop: 10 }}>
            请上传<strong>护照资料页</strong>（含照片与号码页）照片，并填写护照号码。可选填「有效期至」以便后台核对。
          </div>
          <div style={{ height: 12 }} />
          <label className="m-upload-field" style={{ display: 'block' }}>
            <span>{passportPageOk ? '已上传资料页（可重选）' : '上传护照资料页'}</span>
            <input type="file" accept="image/*" onChange={(e) => onPickPassportPage(e.target.files?.[0] ?? null)} />
          </label>
          {ppPreview ? (
            <img src={ppPreview} alt="" style={{ width: '100%', maxHeight: 220, objectFit: 'contain', marginTop: 8, borderRadius: 8 }} />
          ) : null}
          <label className="m-muted" style={{ marginTop: 12 }}>有效期至（选填）</label>
          <input
            className="m-input"
            type="date"
            value={extraDocValidUntil}
            onChange={(e) => setExtraDocValidUntil(e.target.value)}
          />
        </>
      ) : null}

      {docType === 'HKM_TW_PERMIT' ? (
        <>
          <div className="m-muted" style={{ lineHeight: 1.6, marginTop: 10 }}>
            请上传<strong>通行证正面</strong>与<strong>反面</strong>照片，并填写证件号码。可选填「有效期至」。
          </div>
          <div style={{ height: 12 }} />
          <div className="m-row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <div className="m-muted" style={{ marginBottom: 6 }}>正面（必填）</div>
              <label className="m-upload-field" style={{ display: 'block' }}>
                <span>{hkmFrontOk ? '已上传（可重选）' : '上传正面'}</span>
                <input type="file" accept="image/*" onChange={(e) => onPickHkmFront(e.target.files?.[0] ?? null)} />
              </label>
              {hkmFrontPreview ? (
                <img src={hkmFrontPreview} alt="" style={{ width: '100%', marginTop: 8, borderRadius: 8 }} />
              ) : null}
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <div className="m-muted" style={{ marginBottom: 6 }}>反面（必填）</div>
              <label className="m-upload-field" style={{ display: 'block' }}>
                <span>{hkmBackOk ? '已上传（可重选）' : '上传反面'}</span>
                <input type="file" accept="image/*" onChange={(e) => onPickHkmBack(e.target.files?.[0] ?? null)} />
              </label>
              {hkmBackPreview ? (
                <img src={hkmBackPreview} alt="" style={{ width: '100%', marginTop: 8, borderRadius: 8 }} />
              ) : null}
            </div>
          </div>
          <label className="m-muted" style={{ marginTop: 12 }}>有效期至（选填）</label>
          <input
            className="m-input"
            type="date"
            value={extraDocValidUntil}
            onChange={(e) => setExtraDocValidUntil(e.target.value)}
          />
        </>
      ) : null}

      {docType === 'USCC' ? (
        <>
          <div className="m-muted" style={{ lineHeight: 1.6, marginTop: 10 }}>
            请上传<strong>证件扫描件</strong>（如营业执照），并填写 18 位<strong>统一社会信用代码</strong>。
          </div>
          <div style={{ height: 12 }} />
          <label className="m-upload-field" style={{ display: 'block' }}>
            <span>{usccScanOk ? '已上传（可重选）' : '上传证件扫描件'}</span>
            <input type="file" accept="image/*" onChange={(e) => onPickUsccScan(e.target.files?.[0] ?? null)} />
          </label>
          {usccPreview ? (
            <img src={usccPreview} alt="" style={{ width: '100%', maxHeight: 220, objectFit: 'contain', marginTop: 8, borderRadius: 8 }} />
          ) : null}
        </>
      ) : null}

      <div style={{ height: 8 }} />
      <label className="m-muted m-label-required">姓名</label>
      <input className="m-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={namePlaceholder} />

      <label className="m-muted m-label-required">{numberLabel}</label>
      <input className="m-input" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder={numberPlaceholder} />

      <label className="m-muted m-label-required">手机号</label>
      <input className="m-input" value={phone} onChange={(e) => setPhone(e.target.value)} />

      <label className="m-muted">微信（可选）</label>
      <input className="m-input" value={wechat} onChange={(e) => setWechat(e.target.value)} />
    </div>
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
              <strong>Demo 说明：</strong>不实际调用认证接口，点击下方按钮即视为「认证成功」，
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
