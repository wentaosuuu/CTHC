export type MoveOutMoneyItem = {
  id: string
  name: string
  amount: number
  remark: string
}

export type MoveOutInspectionSnapshot = {
  id: string
  name: string
  unit: string
  quantity: number
  moveInStatus: string
  moveOutStatus: string
  compensationQuantity: number
  referencePrice: number
  compensation: number
  remark: string
}

export type MoveOutSettlementType =
  | 'NORMAL_EXPIRY'
  | 'BREACH_EARLY'
  | 'SETTLED_EARLY'
  | 'NEGOTIATED_EARLY'

export type MoveOutSettlementSnapshot = {
  settlementType: MoveOutSettlementType
  stopRentDate: string
  requireTenantConfirmation: boolean
  hygieneStatus: 'PASS' | 'FAIL'
  inspectionItems: MoveOutInspectionSnapshot[]
  paidItems: MoveOutMoneyItem[]
  receivableItems: MoveOutMoneyItem[]
  paidTotal: number
  receivableTotal: number
  refundAmount: number
  amountDue: number
  applicationNote: string
}

/** 集团费报口径：退押金收款账户（租户提交 / 店长代录） */
export type MoveOutBankAccount = {
  accountName: string
  bankName: string
  bankBranch: string
  bankCardNo: string
  /** 联行号（选填） */
  cnapsCode?: string
  /** 开户省市（选填） */
  bankRegion?: string
  phone?: string
  idNumber?: string
  confirmedAt: string
}

export const MOVE_OUT_SETTLEMENT_TYPE_OPTIONS: Array<{ value: MoveOutSettlementType; label: string; hint: string }> = [
  { value: 'NORMAL_EXPIRY', label: '正常到期退租', hint: '合同到期、结清费用后办理退租' },
  { value: 'BREACH_EARLY', label: '违约提前退租', hint: '提前搬离并按合同计收提前终止违约金' },
  { value: 'SETTLED_EARLY', label: '结清提前退租', hint: '结清合同期内费用后提前搬离，不计违约金' },
  { value: 'NEGOTIATED_EARLY', label: '协商提前退租', hint: '双方协商一致免除提前终止违约金' },
]

/** 厂房/商铺/住宅审批表口径：已交款项 */
export const DEFAULT_MOVE_OUT_PAID_ITEMS: MoveOutMoneyItem[] = [
  { id: 'performance-bond', name: '履约保证金', amount: 0, remark: '读取合同押金余额' },
  { id: 'utility-deposit', name: '水电押金', amount: 0, remark: '' },
]

/** 厂房/商铺/住宅审批表口径：应收款项（可增删改） */
export const DEFAULT_MOVE_OUT_RECEIVABLE_ITEMS: MoveOutMoneyItem[] = [
  { id: 'rent', name: '租金', amount: 0, remark: '可按账期拆分说明写在备注' },
  { id: 'service-fee', name: '服务费', amount: 0, remark: '' },
  { id: 'electricity-fee', name: '电费', amount: 0, remark: '' },
  { id: 'water-fee', name: '水费', amount: 0, remark: '' },
  { id: 'penalty', name: '违约金', amount: 0, remark: '' },
  { id: 'early-termination-penalty', name: '违约金（提前终止合同）', amount: 0, remark: '请先核对系统内未交账单' },
]

export function settlementTypeLabel(value: MoveOutSettlementType) {
  return MOVE_OUT_SETTLEMENT_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? value
}

export function calculateMoveOutSettlement(
  paidItems: MoveOutMoneyItem[],
  receivableItems: MoveOutMoneyItem[],
) {
  const paidTotal = paidItems.reduce((sum, item) => sum + Math.max(0, Number(item.amount) || 0), 0)
  const receivableTotal = receivableItems.reduce((sum, item) => sum + Math.max(0, Number(item.amount) || 0), 0)
  return {
    paidTotal,
    receivableTotal,
    refundAmount: Math.max(paidTotal - receivableTotal, 0),
    amountDue: Math.max(receivableTotal - paidTotal, 0),
  }
}
