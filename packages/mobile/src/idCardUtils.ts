/** 大陆 18 位二代身份证号格式（末位可为 X） */
export function isMainland18Id(id: string): boolean {
  return /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/.test(id.trim())
}

/** 校验有效期：非长期须填写 YYYY-MM-DD 且未过期 */
export function validateIdExpiryMessage(validUntil: string, longTerm: boolean): string | null {
  if (longTerm) return null
  if (!validUntil || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
    return '请填写「有效期至」或勾选「长期有效」（可先上传国徽面自动识别）'
  }
  const [y, mo, d] = validUntil.split('-').map((x) => Number(x))
  if (!y || !mo || !d) return '「有效期至」格式不正确'
  const end = new Date(y, mo - 1, d, 23, 59, 59, 999)
  if (end.getTime() < Date.now()) return '身份证已超过有效期，请更换有效证件'
  return null
}

export function isUscc18(id: string): boolean {
  const v = id.trim().toUpperCase()
  return /^[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}$/.test(v)
}

export function isPassportNo(id: string): boolean {
  const t = id.trim()
  if (t.length < 6 || t.length > 24) return false
  return /^[A-Za-z0-9-]+$/.test(t)
}

export function isHkmTwPermitNo(id: string): boolean {
  const t = id.trim()
  if (t.length < 6 || t.length > 22) return false
  return /^[A-Za-z0-9（）()\-]+$/.test(t)
}

/** 可选「证件有效期至」：有填则须合法且未过期 */
export function optionalDocExpiryMessage(ymd: string): string | null {
  const t = ymd.trim()
  if (!t) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return '「有效期至」格式须为 YYYY-MM-DD'
  const [y, mo, d] = t.split('-').map((x) => Number(x))
  const end = new Date(y, mo - 1, d, 23, 59, 59, 999)
  if (end.getTime() < Date.now()) return '证件已超过填写的有效期'
  return null
}

export async function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('READ_FAILED'))
    fr.readAsDataURL(file)
  })
}
