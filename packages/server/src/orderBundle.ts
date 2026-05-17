import type { PrismaClient } from '@prisma/client'

/** 合并单涉及的全部房源（主单 houseId + 各 OrderLine） */
export async function houseIdsInOrderBundle(
  prisma: PrismaClient,
  orderId: string,
  primaryHouseId: string,
): Promise<string[]> {
  const lines = await prisma.orderLine.findMany({ where: { orderId }, select: { houseId: true } })
  if (lines.length === 0) return [primaryHouseId]
  return Array.from(new Set([primaryHouseId, ...lines.map((l) => l.houseId)]))
}

export async function releaseOrderedHousesForOrder(
  prisma: PrismaClient,
  orderId: string,
  primaryHouseId: string,
) {
  const ids = await houseIdsInOrderBundle(prisma, orderId, primaryHouseId)
  for (const hid of ids) {
    const h = await prisma.house.findUnique({ where: { id: hid } })
    if (h?.status === 'ORDERED') {
      await prisma.house.update({ where: { id: hid }, data: { status: 'VACANT' } })
    }
  }
}

export async function promoteOrderedHousesToReservedForOrder(
  prisma: PrismaClient,
  orderId: string,
  primaryHouseId: string,
) {
  const ids = await houseIdsInOrderBundle(prisma, orderId, primaryHouseId)
  for (const hid of ids) {
    const h = await prisma.house.findUnique({ where: { id: hid } })
    if (h?.status === 'ORDERED') {
      await prisma.house.update({ where: { id: hid }, data: { status: 'RESERVED' } })
    }
  }
}
