import type { PrismaClient } from '@prisma/client'
import { houseIdsInOrderBundle } from './orderBundle.js'

export const MS_DAY = 86400_000
export const MS_HOUR = 3600_000
export const TENANT_SIGN_DAYS = 3
/** 演示：租客确认后，系统模拟调用电子章接口的延迟（毫秒），之后自动进入待付款 */
export const DEMO_SEAL_DELAY_MS = 60_000

export function computeTenantSignDeadline(from: Date = new Date()): Date {
  return new Date(from.getTime() + TENANT_SIGN_DAYS * MS_DAY)
}

/**
 * 续签新合同：确认、电子签与首期款须在「新合同起租日」当日 24 小时内完成（起租日 0:00 起算 24h）。
 * 若倒签导致该截止早于「当前 + 24h」，则取后者，避免生成即失效。
 */
export function computeRenewalTenantActionDeadline(moveInDate: Date, now: Date = new Date()): Date {
  const y = moveInDate.getFullYear()
  const m = moveInDate.getMonth()
  const d = moveInDate.getDate()
  const leaseDayStart = new Date(y, m, d, 0, 0, 0, 0)
  const byLease = new Date(leaseDayStart.getTime() + 24 * MS_HOUR)
  const floor = new Date(now.getTime() + 24 * MS_HOUR)
  return byLease.getTime() >= floor.getTime() ? byLease : floor
}

/** 合同作废 + 订单取消 + 房源释放（演示用统一收口） */
export async function voidContractReleaseHouseAndCancelOrder(
  prisma: PrismaClient,
  contractId: string,
  orderReason: string,
) {
  const c = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true, status: true, orderId: true, houseId: true },
  })
  if (!c || c.status === 'VOID' || c.status === 'TERMINATED') return

  const houseIds = await houseIdsInOrderBundle(prisma, c.orderId, c.houseId)
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id: contractId },
      data: { status: 'VOID', voidedAt: now },
    })
    await tx.order.update({
      where: { id: c.orderId },
      data: { status: 'CANCELLED', reviewReason: orderReason },
    })
    for (const hid of houseIds) {
      await tx.house.update({ where: { id: hid }, data: { status: 'VACANT' } })
    }
  })
}
