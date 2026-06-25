import type { Prisma } from '@prisma/client'

/**
 * 为合同下未结清的 BASE 账单重写「租金」明细：
 * - 合并订单且仍有 2 套及以上未释放子资产：每套一条 BillItem，账单总额=各套月租快照之和
 * - 合并订单仅剩 1 套：单条 BillItem（名称：公寓 · 房号）
 * - 非合并或无双有效行：单条「房租（账期）」
 */
export async function syncBaseRentBillItemsForContract(
  tx: Prisma.TransactionClient,
  params: { contractId: string; orderId: string; rentMonthly: number },
) {
  const order = await tx.order.findUnique({
    where: { id: params.orderId },
    include: {
      lines: {
        where: { releasedAt: null },
        include: { house: { include: { apartment: true } } },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      },
    },
  })
  if (!order) return

  const active = order.lines
  const bills = await tx.bill.findMany({
    where: {
      contractId: params.contractId,
      kind: 'BASE',
      status: { in: ['UNPAID', 'OVERDUE'] },
    },
    orderBy: { period: 'asc' },
  })

  if (active.length === 0) {
    const orphan = await tx.bill.findMany({
      where: {
        contractId: params.contractId,
        kind: 'BASE',
        status: { in: ['UNPAID', 'OVERDUE'] },
      },
      select: { id: true },
    })
    if (orphan.length) {
      await tx.billItem.deleteMany({ where: { billId: { in: orphan.map((b) => b.id) } } })
      await tx.bill.deleteMany({ where: { id: { in: orphan.map((b) => b.id) } } })
    }
    return
  }

  const mergedMulti = order.isMergedBundle && active.length > 1
  const totalRent =
    active.length > 0 ? active.reduce((s, l) => s + l.rentMonthlySnapshot, 0) : params.rentMonthly

  for (const b of bills) {
    await tx.billItem.deleteMany({ where: { billId: b.id } })

    if (mergedMulti) {
      for (const l of active) {
        const name = `${l.house.apartment.name} · ${l.house.houseNo}`
        await tx.billItem.create({
          data: {
            billId: b.id,
            name,
            amount: l.rentMonthlySnapshot,
            breakdownJson: JSON.stringify([{ label: '月租', amount: l.rentMonthlySnapshot }]),
          },
        })
      }
    } else if (active.length === 1) {
      const l = active[0]!
      const name = `${l.house.apartment.name} · ${l.house.houseNo}`
      await tx.billItem.create({
        data: {
          billId: b.id,
          name,
          amount: l.rentMonthlySnapshot,
          breakdownJson: JSON.stringify([{ label: '月租', amount: l.rentMonthlySnapshot }]),
        },
      })
    } else {
      await tx.billItem.create({
        data: {
          billId: b.id,
          name: `房租（${b.period}）`,
          amount: params.rentMonthly,
          breakdownJson: null,
        },
      })
    }

    await tx.bill.update({
      where: { id: b.id },
      data: { totalAmount: totalRent },
    })
  }
}
