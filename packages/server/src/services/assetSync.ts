import type { PrismaClient } from '@prisma/client'

type AssetSnapshot = {
  stores: { externalId: string; name: string; wecomQrUrl?: string | null }[]
  apartments: { externalId: string; storeExternalId: string; name: string }[]
  houses: {
    externalId: string
    apartmentExternalId: string
    houseNo: string
    houseType: string
    area: number
    // 资产系统可能只下发「基础房子信息」，租金/押金等需后台补录
    rentMonthly?: number
    deposit?: number
    status: 'VACANT' | 'RESERVED' | 'ORDERED' | 'SIGNED' | 'TERMINATED'
  }[]
}

export async function upsertAssetSnapshot(prisma: PrismaClient, snapshot: AssetSnapshot) {
  const storeMap = new Map<string, string>() // externalId -> storeId
  for (const s of snapshot.stores) {
    const store = await prisma.store.upsert({
      where: { externalId: s.externalId },
      create: {
        externalId: s.externalId,
        name: s.name,
        wecomQrUrl: s.wecomQrUrl ?? null,
      },
      update: {
        name: s.name,
        ...(s.wecomQrUrl !== undefined ? { wecomQrUrl: s.wecomQrUrl } : {}),
      },
    })
    storeMap.set(s.externalId, store.id)
  }

  const apartmentMap = new Map<string, string>() // externalId -> apartmentId
  for (const a of snapshot.apartments) {
    const storeId = storeMap.get(a.storeExternalId)
    if (!storeId) continue
    const apartment = await prisma.apartment.upsert({
      where: { externalId: a.externalId },
      create: { externalId: a.externalId, name: a.name, storeId },
      update: { name: a.name, storeId },
    })
    apartmentMap.set(a.externalId, apartment.id)
  }

  let upsertedHouses = 0
  for (const h of snapshot.houses) {
    const apartmentId = apartmentMap.get(h.apartmentExternalId)
    if (!apartmentId) continue
    await prisma.house.upsert({
      where: { externalId: h.externalId },
      create: {
        externalId: h.externalId,
        apartmentId,
        houseNo: h.houseNo,
        houseType: h.houseType,
        area: h.area,
        rentMonthly: h.rentMonthly ?? 0,
        deposit: h.deposit ?? 0,
        status: h.status,
      },
      update: {
        apartmentId,
        houseNo: h.houseNo,
        houseType: h.houseType,
        area: h.area,
        // 同步只更新「基础信息」；租金/图片等由后台/店长维护
        ...(h.rentMonthly !== undefined ? { rentMonthly: h.rentMonthly } : {}),
        ...(h.deposit !== undefined ? { deposit: h.deposit } : {}),
        status: h.status,
      },
    })
    upsertedHouses += 1
  }

  return {
    upsertedStores: snapshot.stores.length,
    upsertedApartments: snapshot.apartments.length,
    upsertedHouses,
  }
}

