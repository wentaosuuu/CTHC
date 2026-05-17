/** 租客在线支付顺序：同一合同下须先结清更早账期，再支付较新账单 */

export type BillPayOrderRow = {
  id: string
  contractId: string
  period: string
  dueDate: Date
  kind: string
  createdAt: Date
  status: string
  amountReceived: number
  totalAmount: number
}

export function compareBillsForPayOrder(a: BillPayOrderRow, b: BillPayOrderRow): number {
  const due = a.dueDate.getTime() - b.dueDate.getTime()
  if (due !== 0) return due
  const period = a.period.localeCompare(b.period)
  if (period !== 0) return period
  const kind = (a.kind === 'ADJUSTMENT' ? 1 : 0) - (b.kind === 'ADJUSTMENT' ? 1 : 0)
  if (kind !== 0) return kind
  return a.createdAt.getTime() - b.createdAt.getTime()
}

export function isBillPayableStatus(status: string) {
  return status === 'UNPAID' || status === 'OVERDUE'
}

export function hasPartialOfflinePayment(b: Pick<BillPayOrderRow, 'amountReceived' | 'totalAmount'>) {
  return b.amountReceived > 0 && b.amountReceived < b.totalAmount
}

/** 同一合同下待在线结清的队列（已部分线下收款的账单排在最前且须线下处理） */
export function unpaidBillsQueueForContract(
  all: BillPayOrderRow[],
  contractId: string,
): BillPayOrderRow[] {
  return all
    .filter((b) => b.contractId === contractId && isBillPayableStatus(b.status))
    .sort(compareBillsForPayOrder)
}

export function priorUnpaidBillsFor(
  queue: BillPayOrderRow[],
  billId: string,
): BillPayOrderRow[] {
  const idx = queue.findIndex((b) => b.id === billId)
  if (idx <= 0) return []
  return queue.slice(0, idx)
}

export function payBlockedReasonForBill(
  queue: BillPayOrderRow[],
  bill: BillPayOrderRow,
): string | null {
  if (!isBillPayableStatus(bill.status)) return null
  if (hasPartialOfflinePayment(bill)) {
    return '该账单已有线下部分收款，剩余金额请由门店线下核销或联系管理员处理。'
  }
  const prior = priorUnpaidBillsFor(queue, bill.id)
  if (prior.length === 0) return null
  const partial = prior.find(hasPartialOfflinePayment)
  if (partial) {
    return `请先处理账期 ${partial.period} 的线下部分收款，再支付后续账单。`
  }
  const periods = [...new Set(prior.map((b) => b.period))].join('、')
  return `请先结清更早账期（${periods}）的欠费，再支付本期账单。`
}

export function assertBillsPayableInOrder(
  allUnpaid: BillPayOrderRow[],
  targetIds: string[],
): { ok: true } | { ok: false; error: 'PRIOR_BILLS_UNPAID'; message: string } {
  const targets = targetIds.map((id) => allUnpaid.find((b) => b.id === id)).filter(Boolean) as BillPayOrderRow[]
  const byContract = new Map<string, BillPayOrderRow[]>()
  for (const b of targets) {
    const list = byContract.get(b.contractId) ?? []
    list.push(b)
    byContract.set(b.contractId, list)
  }

  for (const [contractId, selected] of byContract) {
    const queue = unpaidBillsQueueForContract(allUnpaid, contractId)
    const selectedSorted = [...selected].sort(compareBillsForPayOrder)
    const selectedSet = new Set(selectedSorted.map((b) => b.id))

    for (const b of selectedSorted) {
      if (hasPartialOfflinePayment(b)) {
        return {
          ok: false,
          error: 'PRIOR_BILLS_UNPAID',
          message: `账期 ${b.period} 已有线下部分收款，无法在线支付，请联系门店处理。`,
        }
      }
      const prior = priorUnpaidBillsFor(queue, b.id)
      const missing = prior.filter((p) => !selectedSet.has(p.id))
      if (missing.length > 0) {
        const periods = [...new Set(missing.map((x) => x.period))].join('、')
        return {
          ok: false,
          error: 'PRIOR_BILLS_UNPAID',
          message: `请先结清更早账期（${periods}）的欠费，再支付所选账单。`,
        }
      }
    }
  }

  return { ok: true }
}
