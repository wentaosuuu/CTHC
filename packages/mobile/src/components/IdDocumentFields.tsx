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
  idLongTerm: boolean
  idValidUntil: string
  extraDocValidUntil: string
}

/** 仅校验必填项，不做证件号格式与有效期真伪校验 */
export function validateIdDocumentForm(v: IdDocumentFormValues): string | null {
  if (!v.name.trim()) return '请填写姓名'
  if (!v.idNumber.trim()) return '请填写证件号码'
  if (v.phone.trim().length < 6) return '请填写手机号（至少 6 位）'
  if (v.docType === 'IDCARD' && !v.idLongTerm && !v.idValidUntil.trim()) {
    return '请填写证件有效期，或勾选「长期有效」'
  }
  return null
}

type Props = IdDocumentFormValues & {
  wechat: string
  onDocTypeChange: (next: IdDocType) => void
  onNameChange: (v: string) => void
  onIdNumberChange: (v: string) => void
  onPhoneChange: (v: string) => void
  onWechatChange: (v: string) => void
  onIdLongTermChange: (v: boolean) => void
  onIdValidUntilChange: (v: string) => void
  onExtraDocValidUntilChange: (v: string) => void
}

export function IdDocumentFields({
  docType,
  name,
  idNumber,
  phone,
  wechat,
  idLongTerm,
  idValidUntil,
  extraDocValidUntil,
  onDocTypeChange,
  onNameChange,
  onIdNumberChange,
  onPhoneChange,
  onWechatChange,
  onIdLongTermChange,
  onIdValidUntilChange,
  onExtraDocValidUntilChange,
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
      ? '请填写身份证号'
      : docType === 'PASSPORT'
        ? '请填写护照号码'
        : docType === 'HKM_TW_PERMIT'
          ? '请填写通行证号码'
          : '请填写统一社会信用代码'

  const namePlaceholder =
    docType === 'USCC' ? '联系人姓名（与证件一致）' : '与证件一致'

  return (
    <div className="m-card m-col">
      <div style={{ fontWeight: 900 }}>证件信息</div>
      <div className="m-muted" style={{ lineHeight: 1.6, marginTop: 8 }}>
        请选择证件类型并手动填写信息，无需上传证件照片。
      </div>

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
          <label className="m-muted m-label-required" style={{ marginTop: 12 }}>
            证件有效期
          </label>
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
              <span>长期有效</span>
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

      {docType === 'PASSPORT' || docType === 'HKM_TW_PERMIT' ? (
        <>
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

      <label className="m-muted m-label-required" style={{ marginTop: 12 }}>
        姓名
      </label>
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
    </div>
  )
}
