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

export const MOVE_OUT_SETTLEMENT_TYPE_OPTIONS: Array<{ value: MoveOutSettlementType; label: string; hint: string }> = [
  { value: 'NORMAL_EXPIRY', label: '正常到期退租', hint: '合同到期、结清费用后办理退租' },
  { value: 'BREACH_EARLY', label: '违约提前退租', hint: '提前搬离并按合同计收提前退租违约金' },
  { value: 'SETTLED_EARLY', label: '结清提前退租', hint: '结清合同期内费用后提前搬离，不计违约金' },
  { value: 'NEGOTIATED_EARLY', label: '协商提前退租', hint: '双方协商一致免除提前退租违约金' },
]

export const DEFAULT_MOVE_OUT_PAID_ITEMS: MoveOutMoneyItem[] = [
  { id: 'performance-bond', name: '履约保证金', amount: 0, remark: '读取合同押金余额' },
  { id: 'cleaning-deposit', name: '保洁押金', amount: 0, remark: '' },
  { id: 'utility-deposit', name: '水电押金', amount: 0, remark: '' },
  { id: 'rent-overpayment', name: '多交租金', amount: 0, remark: '如需退回，需确认 OA 审批情况' },
]

export const DEFAULT_MOVE_OUT_RECEIVABLE_ITEMS: MoveOutMoneyItem[] = [
  { id: 'rent', name: '租金', amount: 0, remark: '填写固定周期性费用所属期' },
  { id: 'overdue-penalty', name: '逾期交租违约金', amount: 0, remark: '所抵扣租金视同在退租日期交租' },
  { id: 'property-fee', name: '物业费', amount: 0, remark: '' },
  { id: 'garbage-fee', name: '垃圾处理费', amount: 0, remark: '' },
  { id: 'water-fee', name: '水费', amount: 0, remark: '' },
  { id: 'electricity-fee', name: '电费', amount: 0, remark: '' },
  { id: 'shared-fee', name: '公摊费', amount: 0, remark: '' },
  { id: 'cleaning-fee', name: '保洁费', amount: 0, remark: '' },
  { id: 'damage-compensation', name: '损坏赔偿费', amount: 0, remark: '自动汇总交接清单中的赔偿金额' },
  { id: 'early-termination-penalty', name: '提前退租违约金', amount: 0, remark: '请先核对系统内未交账单' },
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
