import {
  calcAreaBasedDeposit,
  createDefaultEscalationRow,
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
import type { JiangnanPaymentMethod } from './jiangnanFactoryContract'
import type { RentCycle } from './rentCycle'

export const RESIDENTIAL_RENT_TYPE = '住宅' as const

export const RESIDENTIAL_CLAUSE13_OPTIONS = [
  {
    value: 'AREA_STANDARD',
    label:
      '在签订本合同之日，乙方按房屋建筑面积 10 元/平方米的标准（最低不得低于500元）一次性向甲方交纳水电费押金。',
  },
  {
    value: 'PREPAID_METER',
    label:
      '乙方承租的房屋配备预付费式计量装置（"一户一表"）。乙方应于本合同签订之日，向甲方一次性缴纳水电费押金人民币 500 元整。',
  },
] as const

export type ResidentialClause13 = (typeof RESIDENTIAL_CLAUSE13_OPTIONS)[number]['value']

export type ResidentialAssetFormData = {
  tenantIds: string[]
  tenants: ContractTenantPick[]
  houseIds: string[]
  houses: ContractHousePick[]
  rentableArea: string
  rentEscalations: RentEscalationRow[]
  paymentMethod: JiangnanPaymentMethod
  leaseStart: string
  leaseEnd: string
  garbageCleanupFee: string
  performanceBondBase: PerformanceBondBase
  performanceBondMultiple: string
  utilityDeposit: string
  utilityDepositTouched: boolean
  clause13: ResidentialClause13
  propertyMgmtDeposit: string
  rentCycle: RentCycle
  rentDueDay: string
  latestRentGraceDays: string
  terminationDaysPastDue: string
  agreementSignDate: string
  remarkHtml: string
}

export function calcResidentialUtilityDeposit(
  rentableArea: string,
  clause13: ResidentialClause13,
): number {
  if (clause13 === 'PREPAID_METER') return 500
  return calcAreaBasedDeposit(rentableArea, 10)
}

export function defaultResidentialAssetForm(): ResidentialAssetFormData {
  const leaseStart = new Date().toISOString().slice(0, 10)
  return {
    tenantIds: [],
    tenants: [],
    houseIds: [],
    houses: [],
    rentableArea: '',
    rentEscalations: [],
    paymentMethod: 'BANK_TRANSFER',
    leaseStart,
    leaseEnd: leaseEndFromStartMonths(leaseStart, 12),
    garbageCleanupFee: '',
    performanceBondBase: 'FIRST_PERIOD',
    performanceBondMultiple: '1',
    utilityDeposit: '500',
    utilityDepositTouched: false,
    clause13: 'AREA_STANDARD',
    propertyMgmtDeposit: '',
    rentCycle: 'MONTHLY',
    rentDueDay: '1',
    latestRentGraceDays: '',
    terminationDaysPastDue: '7',
    agreementSignDate: '',
    remarkHtml: '',
  }
}

export function syncResidentialDerivedFields(
  form: ResidentialAssetFormData,
  patch?: Partial<ResidentialAssetFormData>,
): ResidentialAssetFormData {
  const next = { ...form, ...patch }
  const totalArea = sumHouseArea(next.houses)
  if (!next.rentableArea.trim() && totalArea > 0) {
    next.rentableArea = String(totalArea)
  }
  const baseRent = sumHouseRentMonthly(next.houses)
  const rentStart = next.leaseStart
  let escalations = next.rentEscalations
  if (!escalations.length && rentStart && next.leaseEnd && baseRent > 0) {
    escalations = [createDefaultEscalationRow(rentStart, baseRent)]
  } else if (escalations.length && next.leaseEnd) {
    escalations = recalcRentEscalations(escalations, next.leaseEnd, baseRent)
  }
  const clauseChanged = patch?.clause13 !== undefined
  if (!next.utilityDepositTouched || clauseChanged) {
    next.utilityDeposit = String(calcResidentialUtilityDeposit(next.rentableArea, next.clause13))
    if (clauseChanged) next.utilityDepositTouched = false
  }
  return { ...next, rentEscalations: escalations }
}

export function residentialHousingBondAmount(form: ResidentialAssetFormData): number {
  return performanceBondAmount(form)
}

export function validateResidentialAssetForm(form: ResidentialAssetFormData): string | null {
  if (!form.tenantIds.length) return '请选择至少一位租客'
  if (!form.houseIds.length) return '请选择至少一项资产'
  if (!form.leaseStart) return '请填写租赁期限起始日'
  if (!form.leaseEnd) return '请填写租赁期限截止日'
  if (form.leaseEnd < form.leaseStart) return '租赁期限截止日不能早于起始日'
  const escErr = validateRentEscalations(form.rentEscalations)
  if (escErr) return escErr
  const bondMult = parseFloat(form.performanceBondMultiple.trim())
  if (Number.isNaN(bondMult) || bondMult <= 0) return '请填写住房保证金倍数'
  const util = parseFloat(form.utilityDeposit.trim())
  if (Number.isNaN(util) || util < 0) return '请填写有效的水电押金金额'
  if (form.garbageCleanupFee.trim()) {
    const g = parseFloat(form.garbageCleanupFee.trim())
    if (Number.isNaN(g) || g < 0) return '垃圾待清理费须为不小于 0 的数字'
  }
  if (form.propertyMgmtDeposit.trim()) {
    const p = parseFloat(form.propertyMgmtDeposit.trim())
    if (Number.isNaN(p) || p < 0) return '物业费押金须为不小于 0 的数字'
  }
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

export function serializeResidentialAssetForm(form: ResidentialAssetFormData): string {
  return JSON.stringify({ version: 1, template: 'RESIDENTIAL_ASSET', ...form })
}

export function parseResidentialAssetForm(json: string | null | undefined): ResidentialAssetFormData | null {
  if (!json?.trim()) return null
  try {
    const raw = JSON.parse(json) as Partial<ResidentialAssetFormData> & { template?: string }
    if (raw.template && raw.template !== 'RESIDENTIAL_ASSET') return null
    const base = defaultResidentialAssetForm()
    return syncResidentialDerivedFields({ ...base, ...raw })
  } catch {
    return null
  }
}

export { leaseMonthsFromRange, sumHouseArea, sumHouseRentMonthly }
