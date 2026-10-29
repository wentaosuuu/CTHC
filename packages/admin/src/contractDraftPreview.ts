import type { JiangnanFactoryFormData } from './jiangnanFactoryContract'
import { calcRentStartDate, JIANGNAN_CLAUSE14_OPTIONS, JIANGNAN_PAYMENT_METHODS } from './jiangnanFactoryContract'
import type { NonResidentialFormData } from './nonResidentialContract'
import { NON_RESIDENTIAL_OTHER_DEFAULT } from './nonResidentialContract'
import type { ResidentialAssetFormData } from './residentialAssetContract'
import { RESIDENTIAL_CLAUSE13_OPTIONS } from './residentialAssetContract'
import type { NanningHousingFormData } from './nanningHousingContract'
import { bowanMonthlyRentNumber, bowanPerformanceBondAmount } from './nanningHousingContract'
import { performanceBondAmount, recalcRentEscalations } from './contractFormShared'
import type { ContractTemplateKind } from './contractTemplate'
import { rentCycleLabel } from './rentCycle'

export type ContractDraftForm = JiangnanFactoryFormData | NonResidentialFormData | ResidentialAssetFormData | NanningHousingFormData
export type PreviewField = { label: string; value: string }

/** 新建和未设置的宽限期按本轮业务要求默认为 0，保留已有非零约定。 */
export function withDefaultGrace<T extends { latestRentGraceDays: string }>(form: T): T {
  return { ...form, latestRentGraceDays: form.latestRentGraceDays.trim() || '0' }
}

export function normalizeDraftFirstRentDate<T extends ContractDraftForm>(form: T): T {
  if (!form.rentEscalations.length || !form.leaseStart) return form
  const firstStart = 'fitOutFreeDays' in form ? calcRentStartDate(form.leaseStart, form.fitOutFreeDays) : form.leaseStart
  const rows = form.rentEscalations.map((row, index) => index === 0 ? { ...row, periodStart: firstStart } : row)
  const rent = 'monthlyRent' in form ? bowanMonthlyRentNumber(form) : form.houses.reduce((sum, house) => sum + house.rentMonthly, 0)
  return { ...form, rentEscalations: recalcRentEscalations(rows, form.leaseEnd, rent) }
}

export function plainContractRemark(html: string): string {
  return html.replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n').replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
}

export function contractDraftFields(template: ContractTemplateKind, form: ContractDraftForm): PreviewField[] {
  const monthlyRent = 'monthlyRent' in form ? bowanMonthlyRentNumber(form) : form.houses.reduce((sum, house) => sum + house.rentMonthly, 0)
  const fields: PreviewField[] = [
    { label: '租赁期限', value: `${form.leaseStart || '待填写'} 至 ${form.leaseEnd || '待填写'}` },
    { label: '可出租面积（㎡）', value: form.rentableArea || '待填写' },
    { label: '首段月租（元/月）', value: String(form.rentEscalations[0]?.monthlyRent ?? monthlyRent) },
    { label: '缴费周期', value: rentCycleLabel(form.rentCycle) },
    { label: '交租日', value: form.rentDueDay ? `每期起始月 ${form.rentDueDay} 日` : '待填写' },
    { label: '最晚交租宽限期（天）', value: form.latestRentGraceDays || '0' },
    { label: '支付方式', value: 'paymentMethod' in form ? JIANGNAN_PAYMENT_METHODS.find((item) => item.value === form.paymentMethod)?.label || '待填写' : '银行代扣' },
    { label: '履约担保金计算依据', value: `${form.performanceBondBase === 'LAST_PERIOD' ? '末期' : '首期'}月租 × ${form.performanceBondMultiple || '待填写'}` },
    { label: '履约担保金（元）', value: String('monthlyRent' in form ? bowanPerformanceBondAmount(form) : performanceBondAmount(form)) },
    { label: '签订日期', value: form.agreementSignDate || '待填写' },
  ]
  const values = form as unknown as Record<string, unknown>
  const add = (label: string, key: string) => fields.push({ label, value: String(values[key] ?? '').trim() || '待填写' })
  if (template === 'JIANGNAN_FACTORY' && 'clause14' in form) {
    add('房屋用途', 'houseUsage'); add('装修免租期（天）', 'fitOutFreeDays'); add('经营项目', 'businessProject')
    fields.push({ label: '第十四条约定', value: JIANGNAN_CLAUSE14_OPTIONS.find((item) => item.value === form.clause14)?.label || '待选择' })
    add('乙方送达地址', 'partyBAddress'); add('邮政编码', 'postalCode'); add('乙方开户行', 'partyBBank')
    add('乙方账户名称', 'partyBBankAccountName'); add('乙方银行账号', 'partyBBankAccountNo')
    add('房屋交付确认书地址', 'confirmationCustomAddress'); add('解除类短信逾期天数', 'terminationDaysPastDue')
  }
  if (template === 'NON_RESIDENTIAL' && 'otherMattersExtra' in form) {
    add('房屋坐落补充地址', 'locationCustomAddress'); add('租赁类型', 'rentType'); add('银行代扣账号', 'bankAccount')
    add('水电费押金（元）', 'utilityDeposit'); add('经营项目', 'businessProject'); add('解除类短信月租倍数', 'terminationRentMultiple')
    fields.push({ label: '其他约定', value: [NON_RESIDENTIAL_OTHER_DEFAULT, form.otherMattersExtra].filter(Boolean).join('\n') })
  }
  if (template === 'RESIDENTIAL_ASSET' && 'clause13' in form) {
    add('垃圾清运费（元）', 'garbageCleanupFee'); add('水电费押金（元）', 'utilityDeposit'); add('物业管理押金（元）', 'propertyMgmtDeposit')
    fields.push({ label: '第十三条水电费押金约定', value: RESIDENTIAL_CLAUSE13_OPTIONS.find((item) => item.value === form.clause13)?.label || '待选择' })
    add('解除类短信逾期天数', 'terminationDaysPastDue')
  }
  if (template === 'NANNING_HOUSING' && 'annex5Items' in form) {
    add('装修情况', 'decoration'); add('物业管理费（元）', 'propertyMgmtFee'); add('垃圾费（元）', 'garbageFee')
    fields.push({ label: '首期款计租时间', value: `${form.firstPeriodStart || '待填写'} 至 ${form.firstPeriodEnd || '待填写'}` })
    add('水电押金（元）', 'utilityDeposit'); add('保洁押金（元）', 'cleaningDeposit'); add('综合押金（元）', 'comprehensiveDeposit')
    add('滞纳金日比例（%）', 'lateFeeDailyPercent'); add('逾期解除天数', 'lateFeeTerminateDays'); add('占用使用费月租倍数', 'occupationFeeMultiple')
    add('附件二补充地址', 'annex2CustomAddress')
    fields.push({ label: '向租户推送账单', value: form.billPushToTenant === 'yes' ? '是' : '否' })
  }
  return fields
}
