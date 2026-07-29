import {
  createDefaultEscalationRow,
  formatHouseLocation,
  leaseEndFromStartMonths,
  leaseMonthsFromRange,
  performanceBondAmount,
  recalcRentEscalations,
  sumHouseArea,
  sumHouseRentMonthly,
  validateRentEscalations,
  type ContractHousePick,
  type ContractTenantPick,
  type PerformanceBondBase,
  type RentEscalationRow,
} from './contractFormShared'
import { JIANGNAN_RENT_CYCLES, type JiangnanPaymentMethod } from './jiangnanFactoryContract'
import type { RentCycle } from './rentCycle'

export const BOWAN_DECORATION_OPTIONS = [
  { value: '精装', label: '精装' },
  { value: '简装', label: '简装' },
  { value: '毛坯', label: '毛坯' },
] as const

export type BowanDecoration = (typeof BOWAN_DECORATION_OPTIONS)[number]['value']

export const BOWAN_ANNEX5_TEMPLATES = [
  { value: 'TEMPLATE_1', label: '模板一' },
  { value: 'TEMPLATE_2', label: '模板二' },
  { value: 'TEMPLATE_3', label: '模板三' },
] as const

export type BowanAnnex5Template = (typeof BOWAN_ANNEX5_TEMPLATES)[number]['value']

export type BowanHousePick = ContractHousePick & {
  houseType: string
  ownershipName: string
  hasElevator: boolean
}

export type NanningHousingFormData = {
  tenantIds: string[]
  tenants: ContractTenantPick[]
  houseIds: string[]
  houses: BowanHousePick[]
  billPushToTenant: 'yes' | 'no'
  rentableArea: string
  decoration: BowanDecoration
  /** 手动可改月租；未触碰时随资产合计同步 */
  monthlyRent: string
  monthlyRentTouched: boolean
  propertyMgmtFee: string
  garbageFee: string
  firstPeriodStart: string
  firstPeriodEnd: string
  rentEscalations: RentEscalationRow[]
  rentCycle: RentCycle
  rentDueDay: string
  lateFeeDailyPercent: string
  lateFeeTerminateDays: string
  performanceBondBase: PerformanceBondBase
  performanceBondMultiple: string
  utilityDeposit: string
  cleaningDeposit: string
  comprehensiveDeposit: string
  occupationFeeMultiple: string
  leaseStart: string
  leaseEnd: string
  agreementSignDate: string
  annex2CustomAddress: string
  annex5Template: BowanAnnex5Template
  latestRentGraceDays: string
  terminationDaysPastDue: string
  remarkHtml: string
  paymentMethod: JiangnanPaymentMethod
}

function hashInt(s: string, mod: number) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return mod > 0 ? h % mod : 0
}

const OWNERSHIP_POOL = [
  '南宁梧桐资产管理有限公司',
  '江景公寓运营（南宁）有限公司',
  '某某不动产管理（集团）有限公司',
  '南宁产投华创投资发展有限责任公司',
]

/** 从资产推导所有权人 / 电梯（资产系统暂无独立字段时的演示口径） */
export function deriveBowanAssetMeta(houseId: string): { ownershipName: string; hasElevator: boolean } {
  return {
    ownershipName: OWNERSHIP_POOL[hashInt(houseId + 'own', OWNERSHIP_POOL.length)]!,
    hasElevator: hashInt(houseId + 'elv', 2) === 0,
  }
}

export function toBowanHousePick(h: ContractHousePick & { houseType?: string }): BowanHousePick {
  const meta = deriveBowanAssetMeta(h.id)
  return {
    id: h.id,
    apartmentName: h.apartmentName,
    houseNo: h.houseNo,
    storeName: h.storeName,
    address: h.address ?? '',
    area: h.area,
    rentMonthly: h.rentMonthly,
    status: h.status,
    houseType: (h.houseType ?? '').trim() || '—',
    ownershipName: meta.ownershipName,
    hasElevator: meta.hasElevator,
  }
}

function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 默认首期款计租时间：当月剩余时段（起日 → 当月最后一天） */
export function defaultFirstPeriodRange(fromYmd?: string): { start: string; end: string } {
  const base =
    fromYmd && /^\d{4}-\d{2}-\d{2}$/.test(fromYmd)
      ? new Date(Number(fromYmd.slice(0, 4)), Number(fromYmd.slice(5, 7)) - 1, Number(fromYmd.slice(8, 10)))
      : new Date()
  const start = formatYmd(base)
  const end = formatYmd(new Date(base.getFullYear(), base.getMonth() + 1, 0))
  return { start, end }
}

export function bowanMonthlyRentNumber(form: NanningHousingFormData): number {
  const n = parseFloat(form.monthlyRent.trim())
  if (!Number.isNaN(n) && n > 0) return Math.round(n)
  return sumHouseRentMonthly(form.houses)
}

export function bowanOccupationFeeAmount(form: NanningHousingFormData): number {
  const mult = parseFloat(form.occupationFeeMultiple.trim() || '2')
  if (Number.isNaN(mult) || mult < 0) return 0
  return Math.round(bowanMonthlyRentNumber(form) * mult)
}

export function bowanPerformanceBondAmount(form: NanningHousingFormData): number {
  return performanceBondAmount({
    performanceBondBase: form.performanceBondBase,
    performanceBondMultiple: form.performanceBondMultiple,
    rentEscalations: form.rentEscalations,
    houses: form.houses.map((h) => ({
      ...h,
      rentMonthly: bowanMonthlyRentNumber(form) || h.rentMonthly,
    })),
  })
}

export function bowanPenaltyFormula(form: NanningHousingFormData): string {
  const pct = form.lateFeeDailyPercent.trim() || '0.1'
  return `amount*${pct}%*days`
}

export function bowanHouseTypeText(houses: BowanHousePick[]): string {
  if (!houses.length) return ''
  const parts = houses.map((h) => (h.houseType || '').trim() || '—')
  return [...new Set(parts)].join('；')
}

export function bowanOwnershipText(houses: BowanHousePick[]): string {
  if (!houses.length) return ''
  return houses.map((h) => h.ownershipName).join('；')
}

export function bowanElevatorText(houses: BowanHousePick[]): string {
  if (!houses.length) return ''
  if (houses.length === 1) return houses[0]!.hasElevator ? '有' : '无'
  return houses.map((h) => `${h.apartmentName} ${h.houseNo}：${h.hasElevator ? '有' : '无'}`).join('；')
}

export function defaultNanningHousingForm(): NanningHousingFormData {
  const leaseStart = new Date().toISOString().slice(0, 10)
  const first = defaultFirstPeriodRange(leaseStart)
  return {
    tenantIds: [],
    tenants: [],
    houseIds: [],
    houses: [],
    billPushToTenant: 'yes',
    rentableArea: '',
    decoration: '精装',
    monthlyRent: '',
    monthlyRentTouched: false,
    propertyMgmtFee: '',
    garbageFee: '',
    firstPeriodStart: first.start,
    firstPeriodEnd: first.end,
    rentEscalations: [],
    rentCycle: 'MONTHLY',
    rentDueDay: '15',
    lateFeeDailyPercent: '0.1',
    lateFeeTerminateDays: '15',
    performanceBondBase: 'FIRST_PERIOD',
    performanceBondMultiple: '1',
    utilityDeposit: '',
    cleaningDeposit: '',
    comprehensiveDeposit: '',
    occupationFeeMultiple: '2',
    leaseStart,
    leaseEnd: leaseEndFromStartMonths(leaseStart, 12),
    agreementSignDate: '',
    annex2CustomAddress: '',
    annex5Template: 'TEMPLATE_1',
    latestRentGraceDays: '',
    terminationDaysPastDue: '7',
    remarkHtml: '',
    paymentMethod: 'BANK_TRANSFER',
  }
}

export function syncNanningHousingDerivedFields(
  form: NanningHousingFormData,
  patch?: Partial<NanningHousingFormData>,
): NanningHousingFormData {
  const next = { ...form, ...patch }
  if (patch?.houses) {
    next.houses = patch.houses.map((h) => toBowanHousePick(h))
  }
  const totalArea = sumHouseArea(next.houses)
  if (!next.rentableArea.trim() && totalArea > 0) {
    next.rentableArea = String(totalArea)
  }
  const baseRent = sumHouseRentMonthly(next.houses)
  if (!next.monthlyRentTouched) {
    next.monthlyRent = baseRent > 0 ? String(baseRent) : ''
  }
  const rentForEsc = bowanMonthlyRentNumber(next)
  let escalations = next.rentEscalations
  if (!escalations.length && next.leaseStart && next.leaseEnd && rentForEsc > 0) {
    escalations = [createDefaultEscalationRow(next.leaseStart, rentForEsc)]
  } else if (escalations.length && next.leaseEnd) {
    escalations = recalcRentEscalations(escalations, next.leaseEnd, rentForEsc)
  }
  if (patch?.leaseStart !== undefined && patch.firstPeriodStart === undefined && patch.firstPeriodEnd === undefined) {
    const first = defaultFirstPeriodRange(next.leaseStart)
    next.firstPeriodStart = first.start
    next.firstPeriodEnd = first.end
  }
  return { ...next, rentEscalations: escalations }
}

export function validateNanningHousingForm(form: NanningHousingFormData): string | null {
  if (!form.tenantIds.length) return '请选择至少一位租客'
  if (!form.houseIds.length) return '请选择至少一项资产'
  if (!form.leaseStart) return '请填写租赁期起始日'
  if (!form.leaseEnd) return '请填写租赁期截止日'
  if (form.leaseEnd < form.leaseStart) return '租赁期截止日不能早于起始日'
  const rent = bowanMonthlyRentNumber(form)
  if (rent <= 0) return '请填写大于 0 的租金'
  const escErr = validateRentEscalations(form.rentEscalations)
  if (escErr) return escErr
  if (!form.firstPeriodStart || !form.firstPeriodEnd) return '请填写首期款计租时间'
  if (form.firstPeriodEnd < form.firstPeriodStart) return '首期款计租截止日不能早于起始日'
  const pct = parseFloat(form.lateFeeDailyPercent.trim())
  if (Number.isNaN(pct) || pct < 0) return '滞纳金日百分比须为不小于 0 的数字'
  const termDays = parseInt(form.lateFeeTerminateDays.trim(), 10)
  if (Number.isNaN(termDays) || termDays < 0) return '滞纳金解除天数须为不小于 0 的整数'
  const bondMult = parseFloat(form.performanceBondMultiple.trim())
  if (Number.isNaN(bondMult) || bondMult <= 0) return '请填写履约保证金倍数'
  for (const [label, raw] of [
    ['物业管理费', form.propertyMgmtFee],
    ['垃圾处理费', form.garbageFee],
    ['水电押金', form.utilityDeposit],
    ['保洁押金', form.cleaningDeposit],
    ['综合押金', form.comprehensiveDeposit],
  ] as const) {
    if (raw.trim()) {
      const n = parseFloat(raw.trim())
      if (Number.isNaN(n) || n < 0) return `${label}须为不小于 0 的数字`
    }
  }
  const occ = parseFloat(form.occupationFeeMultiple.trim())
  if (Number.isNaN(occ) || occ < 0) return '房屋占用费倍数须为不小于 0 的数字'
  const d = parseInt(form.rentDueDay.trim(), 10)
  if (form.rentCycle === 'MONTHLY') {
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

export function serializeNanningHousingForm(form: NanningHousingFormData): string {
  return JSON.stringify({ version: 1, template: 'NANNING_HOUSING', ...form })
}

export function parseNanningHousingForm(json: string | null | undefined): NanningHousingFormData | null {
  if (!json?.trim()) return null
  try {
    const raw = JSON.parse(json) as Partial<NanningHousingFormData> & { template?: string }
    if (raw.template && raw.template !== 'NANNING_HOUSING') return null
    const base = defaultNanningHousingForm()
    const houses = (raw.houses ?? []).map((h) => toBowanHousePick(h as ContractHousePick))
    return syncNanningHousingDerivedFields({ ...base, ...raw, houses })
  } catch {
    return null
  }
}

export {
  formatHouseLocation,
  leaseMonthsFromRange,
  sumHouseArea,
  sumHouseRentMonthly,
  JIANGNAN_RENT_CYCLES,
}
