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
import type { RentCycle } from './rentCycle'

export const NON_RESIDENTIAL_HOUSE_USAGE = '非住宅' as const

export const NON_RESIDENTIAL_OTHER_DEFAULT =
  '1.乙方无法通过代扣结算租金的，应通过转账的方式于每月20日前支付当月租金。'

export type NonResidentialFormData = {
  tenantIds: string[]
  tenants: ContractTenantPick[]
  houseIds: string[]
  houses: ContractHousePick[]
  locationCustomAddress: string
  rentType: string
  rentableArea: string
  rentEscalations: RentEscalationRow[]
  bankAccount: string
  leaseStart: string
  leaseEnd: string
  performanceBondBase: PerformanceBondBase
  performanceBondMultiple: string
  utilityDeposit: string
  utilityDepositTouched: boolean
  businessProject: string
  otherMattersExtra: string
  rentCycle: RentCycle
  rentDueDay: string
  latestRentGraceDays: string
  terminationRentMultiple: string
  agreementSignDate: string
  remarkHtml: string
}

export function calcUtilityDeposit(rentableArea: string): number {
  return calcAreaBasedDeposit(rentableArea, 30)
}

export function defaultNonResidentialForm(): NonResidentialFormData {
  const leaseStart = new Date().toISOString().slice(0, 10)
  return {
    tenantIds: [],
    tenants: [],
    houseIds: [],
    houses: [],
    locationCustomAddress: '',
    rentType: '',
    rentableArea: '',
    rentEscalations: [],
    bankAccount: '',
    leaseStart,
    leaseEnd: leaseEndFromStartMonths(leaseStart, 12),
    performanceBondBase: 'FIRST_PERIOD',
    performanceBondMultiple: '1',
    utilityDeposit: '500',
    utilityDepositTouched: false,
    businessProject: '',
    otherMattersExtra: '',
    rentCycle: 'MONTHLY',
    rentDueDay: '20',
    latestRentGraceDays: '',
    terminationRentMultiple: '2',
    agreementSignDate: '',
    remarkHtml: '',
  }
}

export function syncNonResidentialDerivedFields(
  form: NonResidentialFormData,
  patch?: Partial<NonResidentialFormData>,
): NonResidentialFormData {
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
  if (!next.utilityDepositTouched) {
    next.utilityDeposit = String(calcUtilityDeposit(next.rentableArea))
  }
  return { ...next, rentEscalations: escalations }
}

export function nonResidentialPerformanceBondAmount(form: NonResidentialFormData): number {
  return performanceBondAmount(form)
}

export function formatLeasePeriod(start: string, end: string): string {
  if (!start && !end) return ''
  if (!end) return start
  if (!start) return end
  return `${start} 至 ${end}`
}

export function validateNonResidentialForm(form: NonResidentialFormData): string | null {
  if (!form.tenantIds.length) return '请选择至少一位租客'
  if (!form.houseIds.length) return '请选择至少一项资产'
  if (!form.leaseStart) return '租赁期限起始日缺失'
  if (!form.leaseEnd) return '租赁期限截止日缺失'
  if (form.leaseEnd < form.leaseStart) return '租赁期限截止日不能早于起始日'
  const escErr = validateRentEscalations(form.rentEscalations)
  if (escErr) return escErr
  const bondMult = parseFloat(form.performanceBondMultiple.trim())
  if (Number.isNaN(bondMult) || bondMult <= 0) return '请填写履约保证金倍数'
  const util = parseFloat(form.utilityDeposit.trim())
  if (Number.isNaN(util) || util < 0) return '请填写有效的水电押金金额'
  const d = parseInt(form.rentDueDay.trim(), 10)
  if (form.rentCycle === 'MONTHLY') {
    if (Number.isNaN(d) || d < 1 || d > 31) return '交租日须为 1–31 的整数'
  }
  if (form.latestRentGraceDays.trim()) {
    const g = parseInt(form.latestRentGraceDays.trim(), 10)
    if (Number.isNaN(g) || g < 0) return '最晚交租宽限期须为不小于 0 的整数'
  }
  const x = parseFloat(form.terminationRentMultiple.trim())
  if (Number.isNaN(x) || x <= 0) return '请填写大于 0 的解除短信月租倍数'
  return null
}

export function serializeNonResidentialForm(form: NonResidentialFormData): string {
  return JSON.stringify({ version: 1, template: 'NON_RESIDENTIAL', ...form })
}

export function parseNonResidentialForm(json: string | null | undefined): NonResidentialFormData | null {
  if (!json?.trim()) return null
  try {
    const raw = JSON.parse(json) as Partial<NonResidentialFormData> & { template?: string }
    if (raw.template && raw.template !== 'NON_RESIDENTIAL') return null
    const base = defaultNonResidentialForm()
    return syncNonResidentialDerivedFields({ ...base, ...raw })
  } catch {
    return null
  }
}

export function otherMattersFullText(form: NonResidentialFormData): string {
  const extra = form.otherMattersExtra.trim()
  if (!extra) return NON_RESIDENTIAL_OTHER_DEFAULT
  return `${NON_RESIDENTIAL_OTHER_DEFAULT}\n${extra}`
}

export { leaseMonthsFromRange, sumHouseArea, sumHouseRentMonthly }
