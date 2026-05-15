import type { PrismaClient } from '@prisma/client'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function ensureHousingReportRecord(prisma: PrismaClient, contractId: string) {
  const existing = await prisma.housingReport.findUnique({ where: { contractId } })
  if (existing) return existing
  return prisma.housingReport.create({ data: { contractId, status: 'PENDING' } })
}

export async function performHousingReportNow(prisma: PrismaClient, contractId: string) {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: {
      tenant: true,
      house: { include: { apartment: { include: { store: true } } } },
    },
  })
  if (!contract) throw new Error('Contract not found')
  if (contract.status !== 'ACTIVE') {
    return { status: 'SKIPPED', reason: 'CONTRACT_NOT_ACTIVE' as const }
  }

  const report = await ensureHousingReportRecord(prisma, contractId)

  try {
    const receiptsDir = path.join(process.cwd(), 'receipts')
    await fs.mkdir(receiptsDir, { recursive: true })
    const filename = `housing-receipt-${contract.contractNo}.pdf` // dummy file
    const filePath = path.join(receiptsDir, filename)
    const content = [
      '住建局合同报备回执（模拟）',
      `合同号：${contract.contractNo}`,
      `门店：${contract.house.apartment.store.name}`,
      `公寓：${contract.house.apartment.name}`,
      `房号：${contract.house.houseNo}`,
      `租客：${contract.tenant.name} ${contract.tenant.phone}`,
      `起止：${contract.startDate.toISOString().slice(0, 10)} ~ ${contract.endDate.toISOString().slice(0, 10)}`,
      `报备时间：${new Date().toISOString()}`,
      '',
    ].join('\n')
    await fs.writeFile(filePath, content, 'utf8')

    const updated = await prisma.housingReport.update({
      where: { id: report.id },
      data: {
        status: 'SUCCESS',
        receiptPdfPath: filePath,
        lastError: null,
        reportedAt: new Date(),
      },
    })
    return { status: updated.status, receiptPdfPath: updated.receiptPdfPath, reportedAt: updated.reportedAt?.toISOString() }
  } catch (e: any) {
    const updated = await prisma.housingReport.update({
      where: { id: report.id },
      data: {
        status: 'FAILED',
        lastError: String(e?.message ?? e),
      },
    })
    return { status: updated.status, lastError: updated.lastError }
  }
}

