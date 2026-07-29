import { useCallback, useEffect, useState } from 'react'
import { apiPost } from '../api'
import {
  isHkmTwPermitNo,
  isMainland18Id,
  isPassportNo,
  isUscc18,
  optionalDocExpiryMessage,
  readFileAsDataURL,
  validateIdExpiryMessage,
} from '../idCardUtils'

export type IdDocType = 'IDCARD' | 'PASSPORT' | 'HKM_TW_PERMIT' | 'USCC'

export const DOC_TYPE_LABEL: Record<IdDocType, string> = {
  IDCARD: '身份证',
  PASSPORT: '护照',
  HKM_TW_PERMIT: '港澳台通行证',
  USCC: '统一社会信用代码',
}

export type IdDocumentFormValues = {
  docType: IdDocType
  name: string
  idNumber: string
  phone: string
  wechat: string
  emergencyContactName: string
  emergencyContactPhone: string
  idLongTerm: boolean
  idValidUntil: string
  extraDocValidUntil: string
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

type UploadFlags = {
  idFrontRecognizedOk: boolean
  idBackRecognizedOk: boolean
  passportPageOk: boolean
  hkmFrontOk: boolean
  hkmBackOk: boolean
  usccScanOk: boolean
}

function imageFileError(file: File | null): string | null {
  if (!file) return null
  if (!file.type.startsWith('image/')) return '请选择图片文件'
  if (file.size > 5 * 1024 * 1024) return '单张图片请不超过 5MB'
  return null
}

/** 校验必填项、证件格式与上传状态 */
export function validateIdDocumentForm(v: IdDocumentFormValues, uploads: UploadFlags): string | null {
  if (!v.name.trim()) return '请填写姓名'
  if (!v.idNumber.trim()) return '请填写证件号码'
  if (v.phone.trim().length < 6) return '请填写手机号（至少 6 位）'

  if (v.docType === 'IDCARD') {
    if (!uploads.idFrontRecognizedOk || !uploads.idBackRecognizedOk) {
      return '请先上传身份证人像面与国徽面，并等待识别完成（若识别不完整请手动补充）'
    }
    if (!isMainland18Id(v.idNumber)) return '请填写正确的 18 位身份证号'
    const ve = validateIdExpiryMessage(v.idValidUntil, v.idLongTerm)
    if (ve) return ve
    return null
  }

  if (v.docType === 'PASSPORT') {
    if (!uploads.passportPageOk) return '请上传护照资料页照片'
    if (!isPassportNo(v.idNumber)) return '护照号码须为 6–24 位字母、数字或连字符'
    const oe = optionalDocExpiryMessage(v.extraDocValidUntil)
    if (oe) return oe
    return null
  }

  if (v.docType === 'HKM_TW_PERMIT') {
    if (!uploads.hkmFrontOk || !uploads.hkmBackOk) return '请上传港澳台通行证正面与反面照片'
    if (!isHkmTwPermitNo(v.idNumber)) return '请填写正确的通行证号码'
    const oe = optionalDocExpiryMessage(v.extraDocValidUntil)
    if (oe) return oe
    return null
  }

  if (v.docType === 'USCC') {
    if (!uploads.usccScanOk) return '请上传证件扫描件（如营业执照）'
    if (!isUscc18(v.idNumber)) return '请填写正确的 18 位统一社会信用代码'
    return null
  }

  return null
}

export function useIdDocumentForm(initial?: { phone?: string; wechat?: string }) {
  const [docType, setDocType] = useState<IdDocType>('IDCARD')
  const [name, setName] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [phone, setPhone] = useState(initial?.phone ?? '13800000000')
  const [wechat, setWechat] = useState(initial?.wechat ?? 'wx_demo')
  const [emergencyContactName, setEmergencyContactName] = useState('')
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('')
  const [idLongTerm, setIdLongTerm] = useState(false)
  const [idValidUntil, setIdValidUntil] = useState('')
  const [extraDocValidUntil, setExtraDocValidUntil] = useState('')

  const [idFrontPreview, setIdFrontPreview] = useState<string | null>(null)
  const [idBackPreview, setIdBackPreview] = useState<string | null>(null)
  const [ocrFrontBusy, setOcrFrontBusy] = useState(false)
  const [ocrBackBusy, setOcrBackBusy] = useState(false)
  const [idFrontRecognizedOk, setIdFrontRecognizedOk] = useState(false)
  const [idBackRecognizedOk, setIdBackRecognizedOk] = useState(false)

  const [ppPreview, setPpPreview] = useState<string | null>(null)
  const [passportPageOk, setPassportPageOk] = useState(false)

  const [hkmFrontPreview, setHkmFrontPreview] = useState<string | null>(null)
  const [hkmBackPreview, setHkmBackPreview] = useState<string | null>(null)
  const [hkmFrontOk, setHkmFrontOk] = useState(false)
  const [hkmBackOk, setHkmBackOk] = useState(false)

  const [usccPreview, setUsccPreview] = useState<string | null>(null)
  const [usccScanOk, setUsccScanOk] = useState(false)

  const [ocrError, setOcrError] = useState('')

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

  function onDocTypeChange(next: IdDocType) {
    if (next === docType) return
    resetAllDocumentUploads()
    setDocType(next)
    setIdNumber('')
    setOcrError('')
  }

  async function onPickIdFront(file: File | null) {
    setOcrError('')
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
        setOcrError(r.error)
        setOcrFrontBusy(false)
        return
      }
      setIdFrontRecognizedOk(true)
      if (r.data.name) setName(r.data.name)
      if (r.data.idNumber) setIdNumber(r.data.idNumber)
    } catch {
      setOcrError('读取人像面图片失败')
    }
    setOcrFrontBusy(false)
  }

  async function onPickIdBack(file: File | null) {
    setOcrError('')
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
        setOcrError(r.error)
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
      setOcrError('读取国徽面图片失败')
    }
    setOcrBackBusy(false)
  }

  function onPickPassportPage(file: File | null) {
    setOcrError('')
    const err = imageFileError(file)
    if (err || !file) return
    revokeIf(ppPreview)
    setPpPreview(URL.createObjectURL(file))
    setPassportPageOk(true)
  }

  function onPickHkmFront(file: File | null) {
    setOcrError('')
    const err = imageFileError(file)
    if (err || !file) return
    revokeIf(hkmFrontPreview)
    setHkmFrontPreview(URL.createObjectURL(file))
    setHkmFrontOk(true)
  }

  function onPickHkmBack(file: File | null) {
    setOcrError('')
    const err = imageFileError(file)
    if (err || !file) return
    revokeIf(hkmBackPreview)
    setHkmBackPreview(URL.createObjectURL(file))
    setHkmBackOk(true)
  }

  function onPickUsccScan(file: File | null) {
    setOcrError('')
    const err = imageFileError(file)
    if (err || !file) return
    revokeIf(usccPreview)
    setUsccPreview(URL.createObjectURL(file))
    setUsccScanOk(true)
  }

  const values: IdDocumentFormValues = {
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
  }

  const uploadFlags: UploadFlags = {
    idFrontRecognizedOk,
    idBackRecognizedOk,
    passportPageOk,
    hkmFrontOk,
    hkmBackOk,
    usccScanOk,
  }

  function validate(): string | null {
    return validateIdDocumentForm(values, uploadFlags)
  }

  return {
    values,
    ocrError,
    setOcrError,
    validate,
    fieldsProps: {
      ...values,
      ocrError,
      idFrontPreview,
      idBackPreview,
      ocrFrontBusy,
      ocrBackBusy,
      idFrontRecognizedOk,
      idBackRecognizedOk,
      ppPreview,
      passportPageOk,
      hkmFrontPreview,
      hkmBackPreview,
      hkmFrontOk,
      hkmBackOk,
      usccPreview,
      usccScanOk,
      onDocTypeChange,
      onNameChange: setName,
      onIdNumberChange: setIdNumber,
      onPhoneChange: setPhone,
      onWechatChange: setWechat,
      onEmergencyContactNameChange: setEmergencyContactName,
      onEmergencyContactPhoneChange: setEmergencyContactPhone,
      onIdLongTermChange: setIdLongTerm,
      onIdValidUntilChange: setIdValidUntil,
      onExtraDocValidUntilChange: setExtraDocValidUntil,
      onPickIdFront,
      onPickIdBack,
      onPickPassportPage,
      onPickHkmFront,
      onPickHkmBack,
      onPickUsccScan,
    },
  }
}

type Props = IdDocumentFormValues & {
  ocrError?: string
  idFrontPreview: string | null
  idBackPreview: string | null
  ocrFrontBusy: boolean
  ocrBackBusy: boolean
  idFrontRecognizedOk: boolean
  idBackRecognizedOk: boolean
  ppPreview: string | null
  passportPageOk: boolean
  hkmFrontPreview: string | null
  hkmBackPreview: string | null
  hkmFrontOk: boolean
  hkmBackOk: boolean
  usccPreview: string | null
  usccScanOk: boolean
  onDocTypeChange: (next: IdDocType) => void
  onNameChange: (v: string) => void
  onIdNumberChange: (v: string) => void
  onPhoneChange: (v: string) => void
  onWechatChange: (v: string) => void
  onEmergencyContactNameChange: (v: string) => void
  onEmergencyContactPhoneChange: (v: string) => void
  onIdLongTermChange: (v: boolean) => void
  onIdValidUntilChange: (v: string) => void
  onExtraDocValidUntilChange: (v: string) => void
  onPickIdFront: (file: File | null) => void | Promise<void>
  onPickIdBack: (file: File | null) => void | Promise<void>
  onPickPassportPage: (file: File | null) => void
  onPickHkmFront: (file: File | null) => void
  onPickHkmBack: (file: File | null) => void
  onPickUsccScan: (file: File | null) => void
}

export function IdDocumentFields({
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
  ocrError,
  idFrontPreview,
  idBackPreview,
  ocrFrontBusy,
  ocrBackBusy,
  idFrontRecognizedOk,
  idBackRecognizedOk,
  ppPreview,
  passportPageOk,
  hkmFrontPreview,
  hkmBackPreview,
  hkmFrontOk,
  hkmBackOk,
  usccPreview,
  usccScanOk,
  onDocTypeChange,
  onNameChange,
  onIdNumberChange,
  onPhoneChange,
  onWechatChange,
  onEmergencyContactNameChange,
  onEmergencyContactPhoneChange,
  onIdLongTermChange,
  onIdValidUntilChange,
  onExtraDocValidUntilChange,
  onPickIdFront,
  onPickIdBack,
  onPickPassportPage,
  onPickHkmFront,
  onPickHkmBack,
  onPickUsccScan,
}: Props) {
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

  return (
    <div className="m-card m-col">
      <div style={{ fontWeight: 900 }}>证件信息</div>

      <label className="m-muted m-label-required">证件类型</label>
      <select className="m-input" value={docType} onChange={(e) => onDocTypeChange(e.target.value as IdDocType)}>
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
              <div className="m-muted m-label-required" style={{ marginBottom: 6 }}>
                人像面
              </div>
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
              <div className="m-muted m-label-required" style={{ marginBottom: 6 }}>
                国徽面
              </div>
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
                  onIdLongTermChange(e.target.checked)
                  if (e.target.checked) onIdValidUntilChange('')
                }}
              />
              <span>长期有效（国徽面「至长期」）</span>
            </label>
            {!idLongTerm ? (
              <input
                className="m-input"
                type="date"
                value={idValidUntil}
                onChange={(e) => onIdValidUntilChange(e.target.value)}
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
            <img
              src={ppPreview}
              alt=""
              style={{ width: '100%', maxHeight: 220, objectFit: 'contain', marginTop: 8, borderRadius: 8 }}
            />
          ) : null}
          <label className="m-muted" style={{ marginTop: 12 }}>
            有效期至（选填）
          </label>
          <input
            className="m-input"
            type="date"
            value={extraDocValidUntil}
            onChange={(e) => onExtraDocValidUntilChange(e.target.value)}
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
              <div className="m-muted m-label-required" style={{ marginBottom: 6 }}>
                正面
              </div>
              <label className="m-upload-field" style={{ display: 'block' }}>
                <span>{hkmFrontOk ? '已上传（可重选）' : '上传正面'}</span>
                <input type="file" accept="image/*" onChange={(e) => onPickHkmFront(e.target.files?.[0] ?? null)} />
              </label>
              {hkmFrontPreview ? (
                <img src={hkmFrontPreview} alt="" style={{ width: '100%', marginTop: 8, borderRadius: 8 }} />
              ) : null}
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <div className="m-muted m-label-required" style={{ marginBottom: 6 }}>
                反面
              </div>
              <label className="m-upload-field" style={{ display: 'block' }}>
                <span>{hkmBackOk ? '已上传（可重选）' : '上传反面'}</span>
                <input type="file" accept="image/*" onChange={(e) => onPickHkmBack(e.target.files?.[0] ?? null)} />
              </label>
              {hkmBackPreview ? (
                <img src={hkmBackPreview} alt="" style={{ width: '100%', marginTop: 8, borderRadius: 8 }} />
              ) : null}
            </div>
          </div>
          <label className="m-muted" style={{ marginTop: 12 }}>
            有效期至（选填）
          </label>
          <input
            className="m-input"
            type="date"
            value={extraDocValidUntil}
            onChange={(e) => onExtraDocValidUntilChange(e.target.value)}
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
            <img
              src={usccPreview}
              alt=""
              style={{ width: '100%', maxHeight: 220, objectFit: 'contain', marginTop: 8, borderRadius: 8 }}
            />
          ) : null}
        </>
      ) : null}

      {ocrError ? (
        <div className="m-error" style={{ marginTop: 10, fontSize: 14 }}>
          {ocrError}
        </div>
      ) : null}

      <div style={{ height: 8 }} />
      <label className="m-muted m-label-required">姓名</label>
      <input
        className="m-input"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={namePlaceholder}
      />

      <label className="m-muted m-label-required">{numberLabel}</label>
      <input
        className="m-input"
        value={idNumber}
        onChange={(e) => onIdNumberChange(e.target.value)}
        placeholder={numberPlaceholder}
      />

      <label className="m-muted m-label-required">手机号</label>
      <input className="m-input" value={phone} onChange={(e) => onPhoneChange(e.target.value)} placeholder="请填写手机号" />

      <label className="m-muted">微信（可选）</label>
      <input className="m-input" value={wechat} onChange={(e) => onWechatChange(e.target.value)} placeholder="选填" />

      <label className="m-muted">紧急联系人姓名（可选）</label>
      <input
        className="m-input"
        value={emergencyContactName}
        onChange={(e) => onEmergencyContactNameChange(e.target.value)}
        placeholder="选填"
      />

      <label className="m-muted">联系电话（可选）</label>
      <input
        className="m-input"
        value={emergencyContactPhone}
        onChange={(e) => onEmergencyContactPhoneChange(e.target.value)}
        placeholder="紧急联系人电话，选填"
        inputMode="tel"
      />
    </div>
  )
}
