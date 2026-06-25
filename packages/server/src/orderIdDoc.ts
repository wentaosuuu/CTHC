export type IdDocType = 'IDCARD' | 'PASSPORT' | 'HKM_TW_PERMIT' | 'USCC'

export function normalizeIdDocType(raw: string | undefined): IdDocType {
  const u = String(raw ?? '').toUpperCase()
  if (u === 'PASSPORT' || u === 'HKM_TW_PERMIT' || u === 'USCC') return u
  return 'IDCARD'
}

/** 统一社会信用代码 18 位（字符集按国标常见约定） */
export function isUscc18(s: string): boolean {
  const v = s.trim().toUpperCase()
  return /^[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}$/.test(v)
}

export function isPassportNo(s: string): boolean {
  const t = s.trim()
  if (t.length < 6 || t.length > 24) return false
  return /^[A-Za-z0-9-]+$/.test(t)
}

/** 港澳台通行证号码：字母数字及少量符号，长度适中 */
export function isHkmTwPermitNo(s: string): boolean {
  const t = s.trim()
  if (t.length < 6 || t.length > 22) return false
  return /^[A-Za-z0-9（）()\-]+$/.test(t)
}

export function isMainland18Id(s: string): boolean {
  const v = s.trim().toUpperCase()
  return /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dX]$/.test(v)
}

/** 返回错误码（与接口 JSON error 一致）或 null 表示通过（仅校验非空，不校验证件号格式） */
export function validateIdNumberForDocType(_docType: IdDocType, idNumber: string): string | null {
  if (!idNumber.trim()) return 'ID_NUMBER_REQUIRED'
  return null
}

export function optionalDocValidUntilOk(ymd: string | undefined): string | null {
  if (!ymd || !String(ymd).trim()) return null
  const t = String(ymd).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return 'INVALID_DOC_VALID_UNTIL'
  return null
}
