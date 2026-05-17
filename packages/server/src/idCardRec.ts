import Tesseract from 'tesseract.js'

/** 将常见 OCR 日期片段规范为 YYYY-MM-DD */
function normalizeYmd(y: string, m: string, d: string): string {
  const mm = m.padStart(2, '0')
  const dd = d.padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

/** 从 OCR 文本中提取 18 位身份证号 */
export function parseIdNumberFromText(text: string): string | null {
  const cleaned = text.replace(/\s/g, '')
  const m = cleaned.match(/[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]/)
  if (!m) return null
  return m[0].toUpperCase()
}

/** 从正面 OCR 文本中猜测姓名（二代证正面「姓名」后常见 2–4 个汉字） */
export function parseNameFromText(text: string): string | null {
  const t = text.replace(/\r/g, '\n')
  const byLabel = t.match(/姓名\s*[:：]?\s*([\u4e00-\u9fa5·•．.\s]{2,8})/)
  if (byLabel) {
    const n = byLabel[1].replace(/[·•．.\s]/g, '').trim()
    if (n.length >= 2 && n.length <= 8) return n
  }
  const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean)
  for (let i = 0; i < lines.length; i += 1) {
    if (/姓名/.test(lines[i] ?? '')) {
      const next = lines[i + 1]
      if (next && /^[\u4e00-\u9fa5]{2,8}$/.test(next)) return next
    }
  }
  return null
}

export type ParsedValidity = {
  validFrom?: string
  validUntil?: string
  longTerm: boolean
}

/**
 * 从反面 OCR 文本解析「有效期限」：如 2018.01.01-2038.01.01 或 20180101-20380101、至长期
 */
export function parseValidityFromText(text: string): ParsedValidity {
  const flat = text.replace(/\s/g, '')
  const longM = flat.match(
    /(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})[日]?[-—至到]*长期/,
  )
  if (longM) {
    return {
      longTerm: true,
      validFrom: normalizeYmd(longM[1], longM[2], longM[3]),
    }
  }
  const dot = flat.match(
    /(\d{4})[.](\d{1,2})[.](\d{1,2})[-—至到](\d{4})[.](\d{1,2})[.](\d{1,2})/,
  )
  if (dot) {
    return {
      longTerm: false,
      validFrom: normalizeYmd(dot[1], dot[2], dot[3]),
      validUntil: normalizeYmd(dot[4], dot[5], dot[6]),
    }
  }
  const dash = flat.match(
    /(\d{4})[-/](\d{1,2})[-/](\d{1,2})[-—至到](\d{4})[-/](\d{1,2})[-/](\d{1,2})/,
  )
  if (dash) {
    return {
      longTerm: false,
      validFrom: normalizeYmd(dash[1], dash[2], dash[3]),
      validUntil: normalizeYmd(dash[4], dash[5], dash[6]),
    }
  }
  const compact = flat.match(/(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/)
  if (compact) {
    const s = compact[0]
    const a = s.slice(0, 8)
    const b = s.slice(8, 16)
    return {
      longTerm: false,
      validFrom: `${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6, 8)}`,
      validUntil: `${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6, 8)}`,
    }
  }
  return { longTerm: false }
}

/** 校验身份证是否在有效期内（按自然日，截止日期当天仍视为有效） */
export function validateIdCardExpiry(validUntil: string | undefined, longTerm: boolean): { ok: true } | { ok: false; error: string } {
  if (longTerm) return { ok: true }
  if (!validUntil || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
    return { ok: false, error: '缺少有效的证件截止日期，请重新拍摄反面或手动选择「有效期至」' }
  }
  const [y, mo, d] = validUntil.split('-').map((x) => Number(x))
  const end = new Date(y, mo - 1, d, 23, 59, 59, 999)
  const now = new Date()
  if (end.getTime() < now.getTime()) {
    return { ok: false, error: '身份证已超过有效期，请更换有效证件后下单' }
  }
  return { ok: true }
}

export function decodeBase64ImagePayload(imageField: string): Buffer {
  const s = String(imageField).trim()
  const comma = s.indexOf(',')
  const b64 = comma >= 0 && s.startsWith('data:') ? s.slice(comma + 1) : s
  return Buffer.from(b64, 'base64')
}

export type RecognizeSideResult = {
  rawText: string
  name?: string | null
  idNumber?: string | null
  validFrom?: string
  validUntil?: string
  longTerm: boolean
}

export async function recognizeIdCardSide(buffer: Buffer, side: 'front' | 'back'): Promise<RecognizeSideResult> {
  const { data } = await Tesseract.recognize(buffer, 'chi_sim+eng', { logger: () => {} })
  const rawText = (data.text ?? '').trim()
  if (side === 'front') {
    return {
      rawText,
      name: parseNameFromText(rawText),
      idNumber: parseIdNumberFromText(rawText),
      longTerm: false,
    }
  }
  const v = parseValidityFromText(rawText)
  return {
    rawText,
    validFrom: v.validFrom,
    validUntil: v.validUntil,
    longTerm: v.longTerm,
  }
}
