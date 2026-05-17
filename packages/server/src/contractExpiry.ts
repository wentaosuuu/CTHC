import type { PrismaClient } from '@prisma/client'
import { houseIdsInOrderBundle } from './orderBundle.js'
import { startOfUtcDay } from './contractBilling.js'
import { toYmd } from './time.js'

/** 已生效且租期已过的合同：房源标记为空置（合同仍为 ACTIVE，展示「已过期 N 天」直至续签/退租） */
export async function syncExpiredActiveContractHouses(prisma: PrismaClient) {
  const today = startOfUtcDay(new Date())
  const expired = await prisma.contract.findMany({
    where: { status: 'ACTIVE', endDate: { lt: today } },
    select: { id: true, houseId: true, orderId: true },
    take: 500,
  })
  for (const c of expired) {
    const houseIds = await houseIdsInOrderBundle(prisma, c.orderId, c.houseId)
    for (const hid of houseIds) {
      const h = await prisma.house.findUnique({ where: { id: hid }, select: { status: true } })
      if (!h) continue
      if (h.status === 'TERMINATED' || h.status === 'VACANT') continue
      await prisma.house.update({ where: { id: hid }, data: { status: 'VACANT' } })
    }
  }
}

export function contractExpiryDaysLeft(endDate: Date, now = new Date()): number {
  const endUtc = startOfUtcDay(endDate).getTime()
  const todayUtc = startOfUtcDay(now).getTime()
  return Math.round((endUtc - todayUtc) / (24 * 3600 * 1000))
}

export function isContractLeaseExpired(c: { status: string; endDate: Date }, now = new Date()) {
  return c.status === 'ACTIVE' && contractExpiryDaysLeft(c.endDate, now) < 0
}

export { toYmd }
