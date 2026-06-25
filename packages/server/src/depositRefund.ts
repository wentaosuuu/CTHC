/** 账单明细中视为「押金/保证金」类费用（用于退押时勾选来源） */
const DEPOSIT_ITEM_NAME = /押金|保证金|履约|换房.*押金/i

export type DepositRefundBillSource = {
  billId: string
  period: string
  kind: string
  status: string
  label: string
  maxAmount: number
  amountReceived: number
  itemSummary: string
}

export type DepositRefundPaymentSource = {
  paymentId: string
  label: string
  maxAmount: number
  paidAmount: number
  paidAt: string | null
}

/** 档案押金余额（无单独押金账单/支付记录时，仍可按余额勾选退押） */
export type DepositRefundBalanceSource = {
  id: 'CONTRACT_DEPOSIT_BALANCE'
  label: string
  maxAmount: number
}

export type DepositRefundOptions = {
  contractDeposit: number
  refundedAmount: number
  maxRefundable: number
  billSources: DepositRefundBillSource[]
  paymentSource: DepositRefundPaymentSource | null
  balanceSource: DepositRefundBalanceSource | null
}

function depositItemAmountSum(items: { name: string; amount: number }[]): number {
  return items
    .filter((i) => DEPOSIT_ITEM_NAME.test(i.name))
    .reduce((s, i) => s + Math.max(0, i.amount), 0)
}

export function isDepositBillItemName(name: string): boolean {
  return DEPOSIT_ITEM_NAME.test(name)
}

export function buildDepositRefundOptions(params: {
  contractDeposit: number
  refundedAmount: number
  changeHouseFromId: string | null
  bills: Array<{
    id: string
    period: string
    kind: string
    status: string
    amountReceived: number
    items: { name: string; amount: number }[]
  }>
  payments: Array<{ id: string; amount: number; status: string; paidAt: Date | null }>
}): DepositRefundOptions {
  const maxRefundable = Math.max(0, params.contractDeposit - params.refundedAmount)

  const billSources: DepositRefundBillSource[] = []
  for (const b of params.bills) {
    if (b.amountReceived <= 0) continue
    const depositItems = b.items.filter((i) => DEPOSIT_ITEM_NAME.test(i.name))
    if (depositItems.length === 0) continue
    const depositSum = depositItems.reduce((s, i) => s + Math.max(0, i.amount), 0)
    const maxAmount = Math.min(b.amountReceived, depositSum)
    if (maxAmount <= 0) continue
    const kindZh = b.kind === 'ADJUSTMENT' ? '补缴' : '账期'
    billSources.push({
      billId: b.id,
      period: b.period,
      kind: b.kind,
      status: b.status,
      label: `${b.period}（${kindZh}）· ${depositItems.map((i) => i.name).join('、')}`,
      maxAmount,
      amountReceived: b.amountReceived,
      itemSummary: depositItems.map((i) => `${i.name} ¥${i.amount}`).join('；'),
    })
  }

  let paymentSource: DepositRefundPaymentSource | null = null
  const paidPayments = params.payments.filter((p) => p.status === 'PAID' && p.amount > 0)
  const paid = paidPayments.length > 0 ? paidPayments[paidPayments.length - 1]! : null
  if (paid) {
    const depositPortion = Math.min(params.contractDeposit, paid.amount)
    const maxAmount = Math.min(depositPortion, maxRefundable)
    if (maxAmount > 0) {
      paymentSource = {
        paymentId: paid.id,
        label: params.changeHouseFromId ? '换房首期款（押金部分）' : '首期款支付记录（押金部分）',
        maxAmount,
        paidAmount: paid.amount,
        paidAt: paid.paidAt ? paid.paidAt.toISOString() : null,
      }
    }
  }

  const balanceSource: DepositRefundBalanceSource | null =
    maxRefundable > 0
      ? {
          id: 'CONTRACT_DEPOSIT_BALANCE',
          label: '合同押金余额（档案金额）',
          maxAmount: maxRefundable,
        }
      : null

  return {
    contractDeposit: params.contractDeposit,
    refundedAmount: params.refundedAmount,
    maxRefundable,
    billSources,
    paymentSource,
    balanceSource,
  }
}

export function resolveDepositRefundAmount(params: {
  mode: 'FULL' | 'SELECTED'
  billIds: string[]
  paymentSelected: boolean
  balanceSelected: boolean
  options: DepositRefundOptions
}): { ok: true; amount: number; auditParts: string[] } | { ok: false; error: string } {
  const { options } = params
  if (options.maxRefundable <= 0) {
    return { ok: false, error: 'DEPOSIT_REFUND_NO_REMAINING' }
  }

  if (params.mode === 'FULL') {
    return {
      ok: true,
      amount: options.maxRefundable,
      auditParts: [`全额退押 ¥${options.maxRefundable}`],
    }
  }

  const selectedBills = options.billSources.filter((b) => params.billIds.includes(b.billId))
  if (selectedBills.length !== params.billIds.length) {
    return { ok: false, error: 'DEPOSIT_REFUND_INVALID_SELECTION' }
  }

  let amount = selectedBills.reduce((s, b) => s + b.maxAmount, 0)
  const auditParts: string[] = []

  if (params.paymentSelected && options.paymentSource) {
    amount += options.paymentSource.maxAmount
    auditParts.push(options.paymentSource.label)
  }

  if (params.balanceSelected && options.balanceSource) {
    amount += options.balanceSource.maxAmount
    auditParts.push(options.balanceSource.label)
  }

  if (selectedBills.length === 0 && !params.paymentSelected && !params.balanceSelected) {
    return { ok: false, error: 'DEPOSIT_REFUND_NOTHING_SELECTED' }
  }

  for (const b of selectedBills) {
    auditParts.push(`账单 ${b.period} ¥${b.maxAmount}`)
  }

  if (amount <= 0) {
    return { ok: false, error: 'DEPOSIT_REFUND_NOTHING_SELECTED' }
  }
  if (amount > options.maxRefundable) {
    return { ok: false, error: 'DEPOSIT_REFUND_EXCEED_DEPOSIT' }
  }

  return { ok: true, amount, auditParts }
}
