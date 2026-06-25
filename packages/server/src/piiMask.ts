/** 管理端列表展示用：姓名脱敏（保留首字） */
export function maskPersonName(name: string | null | undefined): string {
  const t = String(name ?? '')
    .trim()
    .replace(/undefined/g, '')
  if (!t) return '—'
  if (t.length === 1) return '*'
  if (t.length === 2) return `${t[0]}*`
  return `${t[0]}${'*'.repeat(t.length - 1)}`
}

/** 手机号脱敏：11 位大陆手机为 前3 + **** + 后4 */
export function maskMobilePhone(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (!digits) return '—'
  if (digits.length < 7) return '****'
  if (digits.length === 11) return `${digits.slice(0, 3)}****${digits.slice(-4)}`
  if (digits.length >= 8) return `${digits.slice(0, 3)}****${digits.slice(-3)}`
  return `${digits.slice(0, 2)}****${digits.slice(-2)}`
}

/** 证件号脱敏：保留前4后4（过短则缩小保留位） */
export function maskIdNumber(raw: string | null | undefined): string {
  const t = String(raw ?? '').trim()
  if (!t) return '—'
  if (t.length <= 6) return `${t.slice(0, 1)}****`
  if (t.length <= 10) return `${t.slice(0, 2)}****${t.slice(-2)}`
  return `${t.slice(0, 4)}****${t.slice(-4)}`
}
