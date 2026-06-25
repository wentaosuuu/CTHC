import type { Prisma } from '@prisma/client'
import { syncBaseRentBillItemsForContract } from './billRentItems.js'
import { moveMonthPeriod } from './changeHouseSettlement.js'
import { addMonths, fmtPeriod, startOfMonth } from './time.js'

export type MergedLineStatus = 'IN_USE' | 'CHANGED' | 'MOVED_OUT'

export function mergedOrderLineStatus(line: {
  releasedAt: Date | null
  changeHouseNewContractId: string | null
}): MergedLineStatus {
  if (!line.releasedAt) return 'IN_USE'
  if (line.changeHouseNewContractId) return 'CHANGED'
  return 'MOVED_OUT'
}

export function mergedOrderLineStatusLabel(status: MergedLineStatus): string {
  if (status === 'IN_USE') return '在用'
  if (status === 'CHANGED') return '已换'
  return '已迁出'
}

/**
 * 合并合同部分换房/部分退租后：重算未结清租金账单，并作废换房月之后仍按三套计费的未付账期。
 */
export async function reconcileBaseBillsAfterMergedLineRelease(
  tx: Prisma.TransactionClient,
  params: {
    contractId: string
    orderId: string
    rentMonthly: number
    moveEnd: Date
    leaseEnd: Date
  },
) {
  const moveYm = moveMonthPeriod(params.moveEnd)

  await syncBaseRentBillItemsForContract(tx, {
    contractId: params.contractId,
    orderId: params.orderId,
    rentMonthly: params.rentMonthly,
  })

  const futureUnpaid = await tx.bill.findMany({
    where: {
      contractId: params.contractId,
      kind: 'BASE',
      status: { in: ['UNPAID', 'OVERDUE'] },
      period: { gt: moveYm },
    },
    select: { id: true },
  })
  if (futureUnpaid.length) {
    const ids = futureUnpaid.map((b) => b.id)
    await tx.rentReminder.deleteMany({ where: { billId: { in: ids } } })
    await tx.arrears.deleteMany({ where: { billId: { in: ids } } })
    await tx.billItem.deleteMany({ where: { billId: { in: ids } } })
    await tx.bill.deleteMany({ where: { id: { in: ids } } })
  }

  let cursor = startOfMonth(addMonths(params.moveEnd, 1))
  const leaseEndMonth = startOfMonth(params.leaseEnd)
  while (cursor.getTime() <= leaseEndMonth.getTime()) {
    const period = fmtPeriod(cursor)
    const existing = await tx.bill.findUnique({
      where: {
        contractId_period_kind: { contractId: params.contractId, period, kind: 'BASE' },
      },
    })
    if (!existing) {
      await tx.bill.create({
        data: {
          contractId: params.contractId,
          period,
          dueDate: cursor,
          totalAmount: params.rentMonthly,
          status: 'UNPAID',
          kind: 'BASE',
        },
      })
    }
    cursor = addMonths(cursor, 1)
  }

  await syncBaseRentBillItemsForContract(tx, {
    contractId: params.contractId,
    orderId: params.orderId,
    rentMonthly: params.rentMonthly,
  })
}
