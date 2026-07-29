import type { RentCycle } from './rentCycle'

export const JIANGNAN_PAYEE = {
  fullName: '南宁产业投资集团有限责任公司',
  bank: '兴业银行南宁新城支行',
  account: '5520 3010 0100 1022 70',
} as const

/** 第二十四条 · 甲方送达信息（固定） */
export const JIANGNAN_CLAUSE24_PARTY_A = {
  deliveryAddress: '南宁市亭洪路58号',
  postalCode: '530000',
  recipient: '南宁产业投资集团有限责任公司',
  phone: '0771-5702806',
} as const

export const JIANGNAN_PAYMENT_METHODS = [
  { value: 'BANK_TRANSFER', label: '银行转账' },
  { value: 'CASH', label: '现金' },
  { value: 'BANK_DEDUCT', label: '银行代扣' },
] as const

export type JiangnanPaymentMethod = (typeof JIANGNAN_PAYMENT_METHODS)[number]['value']

export const JIANGNAN_CLAUSE14_OPTIONS = [
  {
    value: 'REFUND_DEPOSIT',
    label: '（一）解除本合同，甲方将履约担保金全额（不计息）退还乙方。',
  },
  {
    value: 'EXTEND_LEASE',
    label: '（二）本合同继续有效，租赁起租日期相应顺延。',
  },
] as const

export type JiangnanClause14 = (typeof JIANGNAN_CLAUSE14_OPTIONS)[number]['value']

/** 厂房模板专用缴费周期文案 */
export const JIANGNAN_RENT_CYCLES: { value: RentCycle; label: string }[] = [
  { value: 'MONTHLY', label: '单月' },
  { value: 'BIMONTHLY', label: '双月' },
  { value: 'QUARTERLY', label: '三月' },
  { value: 'SEMIANNUAL', label: '半年' },
  { value: 'YEARLY', label: '年付' },
]

export type JiangnanPerformanceBondBase = 'FIRST_PERIOD' | 'LAST_PERIOD'

export type JiangnanRentEscalationRow = {
  id: string
  /** 第 N 年（展示用，从 1 起） */
  yearIndex: number
  /** 本段起始日（用户填写） */
  periodStart: string
  /** 本段截止日（自动计算） */
  periodEnd: string
  /** 递增方式：首段无递增；后续段相对上一段 */
  incrementType: 'NONE' | 'PERCENT' | 'FIXED'
  incrementValue: string
  monthlyRent: number
}

export type JiangnanTenantPick = {
  id: string
  name: string
  phone: string
  idNumber?: string
}

export type JiangnanHousePick = {
  id: string
  apartmentName: string
  houseNo: string
  storeName: string
  address: string
  area: number
  rentMonthly: number
  status?: string
}

export type JiangnanFactoryFormData = {
  tenantIds: string[]
  tenants: JiangnanTenantPick[]
  houseIds: string[]
  houses: JiangnanHousePick[]
  houseUsage: string
  rentableArea: string
  paymentMethod: JiangnanPaymentMethod
  leaseStart: string
  leaseEnd: string
  fitOutFreeDays: string
  businessProject: string
  clause14: JiangnanClause14
  postalCode: string
  partyBAddress: string
  partyBBank: string
  partyBBankAccountName: string
  partyBBankAccountNo: string
  confirmationCustomAddress: string
  rentEscalations: JiangnanRentEscalationRow[]
  performanceBondBase: JiangnanPerformanceBondBase
  performanceBondMultiple: string
  rentCycle: RentCycle
  rentDueDay: string
  latestRentGraceDays: string
  terminationDaysPastDue: string
  agreementSignDate: string
  remarkHtml: string
}

export function defaultJiangnanFactoryForm(): JiangnanFactoryFormData {
  return {
    tenantIds: [],
    tenants: [],
    houseIds: [],
    houses: [],
    houseUsage: '',
    rentableArea: '',
    paymentMethod: 'BANK_TRANSFER',
    leaseStart: new Date().toISOString().slice(0, 10),
    leaseEnd: '',
    fitOutFreeDays: '0',
    businessProject: '',
    clause14: 'REFUND_DEPOSIT',
    postalCode: '',
    partyBAddress: '',
    partyBBank: '',
    partyBBankAccountName: '',
    partyBBankAccountNo: '',
    confirmationCustomAddress: '',
    rentEscalations: [],
    performanceBondBase: 'FIRST_PERIOD',
    performanceBondMultiple: '1',
    rentCycle: 'MONTHLY',
    rentDueDay: '1',
    latestRentGraceDays: '',
    terminationDaysPastDue: '7',
    agreementSignDate: '',
    remarkHtml: '',
  }
}

function parseYmd(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, mo, d] = s.split('-').map(Number)
  return new Date(y, mo - 1, d)
}

function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(ymd: string, days: number): string {
  const d = parseYmd(ymd)
  if (!d) return ymd
  d.setDate(d.getDate() + days)
  return formatYmd(d)
}

function diffDaysInclusive(start: string, end: string): number {
  const a = parseYmd(start)
  const b = parseYmd(end)
  if (!a || !b) return 0
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000) + 1)
}

export function sumHouseArea(houses: JiangnanHousePick[]): number {
  return houses.reduce((s, h) => s + (h.area || 0), 0)
}

export function sumHouseRentMonthly(houses: JiangnanHousePick[]): number {
  return houses.reduce((s, h) => s + (h.rentMonthly || 0), 0)
}

export function formatHouseLocation(houses: JiangnanHousePick[]): string {
  return houses
    .map((h) => {
      const addr = (h.address || '').trim()
      if (addr) return addr
      return `${h.apartmentName} ${h.houseNo}（${h.storeName}）`
    })
    .filter(Boolean)
    .join('；')
}

/** 计租时间 = 租赁期限起始 + 装修免租期（日） */
export function calcRentStartDate(leaseStart: string, fitOutFreeDays: string): string {
  const n = parseInt(fitOutFreeDays.trim() || '0', 10)
  if (!leaseStart || Number.isNaN(n) || n <= 0) return leaseStart
  return addDays(leaseStart, n)
}

export function calcFitOutFreePeriodEnd(leaseStart: string, fitOutFreeDays: string): string {
  const n = parseInt(fitOutFreeDays.trim() || '0', 10)
  if (!leaseStart || Number.isNaN(n) || n <= 0) return leaseStart
  return addDays(leaseStart, Math.max(0, n - 1))
}

export function leaseEndFromStartMonths(start: string, months: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || months < 1) return start
  const [y, mo, d] = start.split('-').map(Number)
  const dt = new Date(y, mo - 1 + months, d)
  dt.setDate(dt.getDate() - 1)
  return formatYmd(dt)
}

export function leaseMonthsFromRange(start: string, end: string): number {
  const a = parseYmd(start)
  const b = parseYmd(end)
  if (!a || !b || b < a) return 0
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (b.getDate() >= a.getDate()) months += 1
  return Math.max(1, Math.min(36, months))
}

function applyIncrement(prevRent: number, type: JiangnanRentEscalationRow['incrementType'], valueStr: string): number {
  if (type === 'PERCENT') {
    const p = parseFloat(valueStr)
    if (Number.isNaN(p)) return prevRent
    return Math.round(prevRent * (1 + p / 100))
  }
  if (type === 'FIXED') {
    const add = parseFloat(valueStr)
    if (Number.isNaN(add)) return prevRent
    return Math.round(prevRent + add)
  }
  return prevRent
}

/** 根据起止日与基准月租，重算各递增段截止日与月租金 */
export function recalcRentEscalations(
  rows: JiangnanRentEscalationRow[],
  leaseEnd: string,
  baseMonthlyRent: number,
): JiangnanRentEscalationRow[] {
  if (!rows.length) return rows
  const sorted = [...rows].sort((a, b) => a.periodStart.localeCompare(b.periodStart))
  let prevRent = baseMonthlyRent
  return sorted.map((row, idx) => {
    const rent =
      idx === 0
        ? baseMonthlyRent
        : applyIncrement(prevRent, row.incrementType, row.incrementValue)
    prevRent = rent
    const next = sorted[idx + 1]
    let periodEnd = leaseEnd
    if (next?.periodStart) {
      const d = parseYmd(next.periodStart)
      if (d) {
        d.setDate(d.getDate() - 1)
        periodEnd = formatYmd(d)
      }
    }
    return {
      ...row,
      yearIndex: idx + 1,
      periodEnd,
      monthlyRent: rent,
    }
  })
}

export function createDefaultEscalationRow(rentStart: string, baseRent: number): JiangnanRentEscalationRow {
  return {
    id: `esc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    yearIndex: 1,
    periodStart: rentStart,
    periodEnd: '',
    incrementType: 'NONE',
    incrementValue: '',
    monthlyRent: baseRent,
  }
}

export function syncJiangnanDerivedFields(
  form: JiangnanFactoryFormData,
  patch?: Partial<JiangnanFactoryFormData>,
): JiangnanFactoryFormData {
  const next = { ...form, ...patch }
  const totalArea = sumHouseArea(next.houses)
  if (!next.rentableArea.trim() && totalArea > 0) {
    next.rentableArea = String(totalArea)
  }
  const baseRent = sumHouseRentMonthly(next.houses)
  const rentStart = calcRentStartDate(next.leaseStart, next.fitOutFreeDays)
  let escalations = next.rentEscalations
  if (!escalations.length && rentStart && next.leaseEnd && baseRent > 0) {
    escalations = [createDefaultEscalationRow(rentStart, baseRent)]
  } else if (escalations.length && next.leaseEnd) {
    escalations = recalcRentEscalations(escalations, next.leaseEnd, baseRent)
  }
  if (next.tenants.length && !next.partyBAddress.trim()) {
    // 租客表暂无地址字段，保留用户填写；仅同步电话展示在预览
  }
  return { ...next, rentEscalations: escalations }
}

export function performanceBondAmount(form: JiangnanFactoryFormData): number {
  const mult = parseFloat(form.performanceBondMultiple.trim() || '1')
  if (Number.isNaN(mult) || mult <= 0) return 0
  const rows = form.rentEscalations
  const baseRent = sumHouseRentMonthly(form.houses)
  if (!rows.length) return Math.round(baseRent * mult)
  const target =
    form.performanceBondBase === 'LAST_PERIOD' ? rows[rows.length - 1]!.monthlyRent : rows[0]!.monthlyRent
  return Math.round((target || baseRent) * mult)
}

export function validateJiangnanFactoryForm(form: JiangnanFactoryFormData): string | null {
  if (!form.tenantIds.length) return '请选择至少一位租客'
  if (!form.houseIds.length) return '请选择至少一项资产'
  if (!form.leaseStart) return '请填写租赁期限起始日'
  if (!form.leaseEnd) return '请填写租赁期限截止日'
  if (form.leaseEnd < form.leaseStart) return '租赁期限截止日不能早于起始日'
  const fit = parseInt(form.fitOutFreeDays.trim() || '0', 10)
  if (Number.isNaN(fit) || fit < 0) return '装修免租期须为不小于 0 的整数'
  if (!form.rentEscalations.length) return '请至少添加一条租金递增设置'
  for (const row of form.rentEscalations) {
    if (!row.periodStart) return `请填写第 ${row.yearIndex} 段租金的起始日`
    if (row.incrementType === 'PERCENT' && row.yearIndex > 1) {
      const p = parseFloat(row.incrementValue)
      if (Number.isNaN(p)) return `第 ${row.yearIndex} 段请填写递增百分比`
    }
    if (row.incrementType === 'FIXED' && row.yearIndex > 1) {
      const v = parseFloat(row.incrementValue)
      if (Number.isNaN(v)) return `第 ${row.yearIndex} 段请填写固定递增金额`
    }
  }
  const bondMult = parseFloat(form.performanceBondMultiple.trim())
  if (Number.isNaN(bondMult) || bondMult <= 0) return '请填写履约担保金倍数'
  if (form.rentCycle === 'MONTHLY') {
    const d = parseInt(form.rentDueDay.trim(), 10)
    if (Number.isNaN(d) || d < 1 || d > 31) return '交租日须为 1–31 的整数'
  }
  if (form.latestRentGraceDays.trim()) {
    const g = parseInt(form.latestRentGraceDays.trim(), 10)
    if (Number.isNaN(g) || g < 0) return '最晚交租宽限期须为不小于 0 的整数'
  }
  const t = parseInt(form.terminationDaysPastDue.trim(), 10)
  if (Number.isNaN(t) || t < 0) return '解除合同短信触发天数须为不小于 0 的整数'
  return null
}

export function serializeJiangnanFactoryForm(form: JiangnanFactoryFormData): string {
  return JSON.stringify({ version: 1, template: 'JIANGNAN_FACTORY', ...form })
}

export function parseJiangnanFactoryForm(json: string | null | undefined): JiangnanFactoryFormData | null {
  if (!json?.trim()) return null
  try {
    const raw = JSON.parse(json) as Partial<JiangnanFactoryFormData> & { houseUser?: string; clause24?: string }
    if (raw.template && raw.template !== 'JIANGNAN_FACTORY') return null
    const base = defaultJiangnanFactoryForm()
    const houseUsage = raw.houseUsage ?? raw.houseUser ?? ''
    return syncJiangnanDerivedFields({ ...base, ...raw, houseUsage })
  } catch {
    return null
  }
}

export function fitOutFreeDaysText(form: JiangnanFactoryFormData): string {
  const n = parseInt(form.fitOutFreeDays.trim() || '0', 10)
  const start = form.leaseStart
  if (!start || Number.isNaN(n) || n <= 0) {
    return `租赁期内，甲方同意给乙方装修免租期 ${n || 0} 个日。`
  }
  const end = calcFitOutFreePeriodEnd(start, form.fitOutFreeDays)
  const [sy, sm, sd] = start.split('-')
  const [ey, em, ed] = end.split('-')
  return `租赁期内，甲方同意给乙方装修免租期 ${n} 个日。装修免租期起止时间为自 ${sy} 年 ${sm} 月 ${sd} 日至 ${ey} 年 ${em} 月 ${ed} 日止。`
}

export function rentDueDayHint(cycle: RentCycle, rentDueDay: string): string {
  if (cycle === 'MONTHLY') return `当月 ${rentDueDay || '—'} 日`
  return '每期租期起始日前'
}

export function diffDaysLabel(start: string, end: string): string {
  const n = diffDaysInclusive(start, end)
  return n > 0 ? `${n} 天` : '—'
}
