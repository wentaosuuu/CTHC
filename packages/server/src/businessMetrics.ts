import type { PrismaClient } from '@prisma/client'

export type BusinessReportKind = 'WEEKLY_MON' | 'MONTH_21' | 'MONTH_END' | 'MANUAL'

export type BusinessMetrics = {
  occupancyRate: number
  collectionRate: number
  rentableArea: number
  rentedArea: number
  receivableAmount: number
  collectedAmount: number
  houseCount: number
  signedCount: number
}

export function startOfLocalDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function endOfLocalDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

export function lastDayOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

/** 周一 / 每月 21 日 / 月末：返回当日应生成的报告类型（可多类型同日） */
export function reportKindsForDate(d = new Date()): BusinessReportKind[] {
  const kinds: BusinessReportKind[] = []
  if (d.getDay() === 1) kinds.push('WEEKLY_MON')
  if (d.getDate() === 21) kinds.push('MONTH_21')
  if (d.getDate() === lastDayOfMonth(d).getDate()) kinds.push('MONTH_END')
  return kinds
}

export function reportKindLabel(kind: string) {
  switch (kind) {
    case 'WEEKLY_MON':
      return '每周一'
    case 'MONTH_21':
      return '每月21日'
    case 'MONTH_END':
      return '月末'
    case 'MANUAL':
      return '手动生成'
    default:
      return kind
  }
}

function resolveProjectName(input: {
  projectName?: string | null
  apartmentName?: string | null
  storeName?: string | null
}) {
  const fromHouse = (input.projectName || '').trim()
  if (fromHouse) return fromHouse
  const apt = (input.apartmentName || '').trim()
  if (apt) return `${apt}·资管项目`
  return (input.storeName || '').trim() || '未命名项目'
}

function emptyMetrics(): BusinessMetrics {
  return {
    occupancyRate: 0,
    collectionRate: 0,
    rentableArea: 0,
    rentedArea: 0,
    receivableAmount: 0,
    collectedAmount: 0,
    houseCount: 0,
    signedCount: 0,
  }
}

/**
 * 演示数据补齐：生效合同对应房源标为已签约；
 * 各公寓在租比例过低时抬到约 72%–88%，避免出租率/在租资产全是 0。
 */
export async function ensureDemoOccupancy(prisma: PrismaClient) {
  const active = await prisma.contract.findMany({
    where: { status: 'ACTIVE' },
    select: { houseId: true },
    distinct: ['houseId'],
  })
  if (active.length) {
    await prisma.house.updateMany({
      where: { id: { in: active.map((row) => row.houseId) } },
      data: { status: 'SIGNED' },
    })
  }

  const houses = await prisma.house.findMany({
    select: { id: true, status: true, apartmentId: true, externalId: true },
    orderBy: { externalId: 'asc' },
  })
  const byApt = new Map<string, typeof houses>()
  for (const house of houses) {
    const list = byApt.get(house.apartmentId) ?? []
    list.push(house)
    byApt.set(house.apartmentId, list)
  }

  const toSign: string[] = []
  for (const [, list] of byApt) {
    const targetRatio = 0.72 + (list.length % 5) * 0.03
    const target = Math.max(1, Math.round(list.length * targetRatio))
    const signed = list.filter((h) => h.status === 'SIGNED')
    if (signed.length >= target) continue
    const vacant = list.filter((h) => h.status !== 'SIGNED')
    for (const house of vacant.slice(0, target - signed.length)) toSign.push(house.id)
  }
  if (toSign.length) {
    await prisma.house.updateMany({
      where: { id: { in: toSign } },
      data: { status: 'SIGNED' },
    })
  }
}

/** 按项目聚合资产出租率与收缴率 */
export async function computeBusinessMetricsByProject(prisma: PrismaClient, asOf = new Date()) {
  const asOfEnd = endOfLocalDay(asOf)
  const [houses, activeContracts] = await Promise.all([
    prisma.house.findMany({
      select: {
        id: true,
        area: true,
        status: true,
        projectName: true,
        apartment: { select: { name: true, store: { select: { name: true } } } },
      },
    }),
    prisma.contract.findMany({
      where: { status: 'ACTIVE', createdAt: { lte: asOfEnd } },
      select: { houseId: true },
      distinct: ['houseId'],
    }),
  ])
  const occupiedIds = new Set(activeContracts.map((row) => row.houseId))

  const byProject = new Map<string, BusinessMetrics & { houseIds: Set<string> }>()

  for (const house of houses) {
    const projectName = resolveProjectName({
      projectName: house.projectName,
      apartmentName: house.apartment.name,
      storeName: house.apartment.store.name,
    })
    const row = byProject.get(projectName) ?? { ...emptyMetrics(), houseIds: new Set<string>() }
    const area = Number.isFinite(house.area) ? Math.max(0, house.area) : 0
    row.houseCount += 1
    row.rentableArea += area
    if (house.status === 'SIGNED' || occupiedIds.has(house.id)) {
      row.signedCount += 1
      row.rentedArea += area
    }
    row.houseIds.add(house.id)
    byProject.set(projectName, row)
  }

  const bills = await prisma.bill.findMany({
    where: { createdAt: { lte: asOfEnd } },
    select: {
      totalAmount: true,
      amountReceived: true,
      status: true,
      contract: {
        select: {
          house: {
            select: {
              projectName: true,
              apartment: { select: { name: true, store: { select: { name: true } } } },
            },
          },
        },
      },
    },
  })

  for (const bill of bills) {
    const projectName = resolveProjectName({
      projectName: bill.contract.house.projectName,
      apartmentName: bill.contract.house.apartment.name,
      storeName: bill.contract.house.apartment.store.name,
    })
    const row = byProject.get(projectName) ?? { ...emptyMetrics(), houseIds: new Set<string>() }
    const receivable = Math.max(0, bill.totalAmount)
    row.receivableAmount += receivable
    if (bill.status === 'PAID') row.collectedAmount += receivable
    else row.collectedAmount += Math.min(receivable, Math.max(0, bill.amountReceived ?? 0))
    byProject.set(projectName, row)
  }

  const result = new Map<string, BusinessMetrics>()
  for (const [projectName, row] of byProject) {
    result.set(projectName, {
      occupancyRate: row.rentableArea > 0 ? row.rentedArea / row.rentableArea : 0,
      collectionRate: row.receivableAmount > 0 ? row.collectedAmount / row.receivableAmount : 0,
      rentableArea: row.rentableArea,
      rentedArea: row.rentedArea,
      receivableAmount: row.receivableAmount,
      collectedAmount: row.collectedAmount,
      houseCount: row.houseCount,
      signedCount: row.signedCount,
    })
  }
  return result
}

/** 演示用：按报告日做轻微抖动，时间线不全是同一组数字 */
function withDemoJitter(metrics: BusinessMetrics, projectName: string, day: Date): BusinessMetrics {
  const seed = (day.getDate() + projectName.length * 13 + day.getMonth() * 7) % 11
  if (metrics.houseCount <= 0) return metrics

  let signedCount = metrics.signedCount
  if (signedCount <= 0) {
    signedCount = Math.max(1, Math.round(metrics.houseCount * (0.7 + (seed % 4) * 0.05)))
  } else {
    const delta = seed <= 2 ? -1 : seed >= 8 ? 1 : 0
    signedCount = Math.max(1, Math.min(metrics.houseCount, signedCount + delta))
  }
  const rentedArea =
    metrics.houseCount > 0 ? (metrics.rentableArea * signedCount) / metrics.houseCount : 0
  const collectFactor = 0.94 + seed * 0.01
  const collectedAmount = Math.min(
    metrics.receivableAmount,
    Math.max(metrics.receivableAmount * 0.12, metrics.collectedAmount * collectFactor),
  )
  return {
    ...metrics,
    signedCount,
    rentedArea: Math.round(rentedArea * 100) / 100,
    collectedAmount: Math.round(collectedAmount * 100) / 100,
    occupancyRate: metrics.rentableArea > 0 ? rentedArea / metrics.rentableArea : 0,
    collectionRate: metrics.receivableAmount > 0 ? collectedAmount / metrics.receivableAmount : 0,
  }
}

/** 每个项目各 upsert 一行 */
export async function upsertBusinessSnapshot(
  prisma: PrismaClient,
  reportDate: Date,
  reportKind: BusinessReportKind,
) {
  const day = startOfLocalDay(reportDate)
  const byProject = await computeBusinessMetricsByProject(prisma, day)
  const rows = []
  for (const [projectName, raw] of byProject) {
    const metrics = withDemoJitter(raw, projectName, day)
    rows.push(
      await prisma.businessMetricSnapshot.upsert({
        where: {
          reportDate_reportKind_projectName: {
            reportDate: day,
            reportKind,
            projectName,
          },
        },
        create: { reportDate: day, reportKind, projectName, ...metrics },
        update: { ...metrics },
      }),
    )
  }
  // 无资产时仍落一行，便于演示空项目
  if (!rows.length) {
    rows.push(
      await prisma.businessMetricSnapshot.upsert({
        where: {
          reportDate_reportKind_projectName: {
            reportDate: day,
            reportKind,
            projectName: '未命名项目',
          },
        },
        create: { reportDate: day, reportKind, projectName: '未命名项目', ...emptyMetrics() },
        update: { ...emptyMetrics() },
      }),
    )
  }
  return rows
}

/** 定时任务：若今天属于规定节点且尚未生成，则按项目写入 */
export async function ensureTodayBusinessSnapshots(prisma: PrismaClient, now = new Date()) {
  const kinds = reportKindsForDate(now)
  const created = []
  for (const kind of kinds) {
    const day = startOfLocalDay(now)
    const exists = await prisma.businessMetricSnapshot.findFirst({
      where: { reportDate: day, reportKind: kind },
    })
    if (exists) continue
    created.push(...(await upsertBusinessSnapshot(prisma, day, kind)))
  }
  return created
}
