import type { PrismaClient } from '@prisma/client'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { toYmd } from '../time.js'

/** 流程图：仅「住宅」资产在起租日 T+1 自动报备市住建局 */
export function isResidentialAssetType(assetType: string | null | undefined) {
  return String(assetType ?? '').trim() === '住宅'
}

/** 起租日次日 00:00（本地日历日）及之后才允许报备 */
export function isPastHousingReportTPlus1(startDate: Date, now = new Date()) {
  const start = new Date(startDate)
  const t1 = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return today.getTime() >= t1.getTime()
}

export async function ensureHousingReportRecord(prisma: PrismaClient, contractId: string) {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { house: { include: { apartment: true } } },
  })
  if (!contract) return null
  if (contract.status !== 'ACTIVE') return null
  if (!isResidentialAssetType(contract.house.apartment.assetType)) {
    return null
  }
  if (!isPastHousingReportTPlus1(contract.startDate)) {
    return null
  }

  const existing = await prisma.housingReport.findUnique({ where: { contractId } })
  if (existing) return existing
  return prisma.housingReport.create({ data: { contractId, status: 'PENDING' } })
}

async function buildHousingReceiptPdfBuffer(contract: {
  contractNo: string
  startDate: Date
  endDate: Date
  tenant: { name: string; phone: string }
  house: { houseNo: string; apartment: { name: string; store: { name: string } } }
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  let y = 780
  const lines = [
    'Housing bureau filing receipt (simulated)',
    `ContractNo: ${contract.contractNo}`,
    `Store: ${asciiOrDash(contract.house.apartment.store.name)}`,
    `Apt: ${asciiOrDash(contract.house.apartment.name)}`,
    `Room: ${asciiOrDash(contract.house.houseNo)}`,
    `Tenant: ${asciiOrDash(contract.tenant.name)} Tel:${asciiOrDash(contract.tenant.phone)}`,
    `Lease: ${toYmd(contract.startDate)} ~ ${toYmd(contract.endDate)}`,
    `FiledAt(UTC): ${new Date().toISOString()}`,
  ]
  for (const line of lines) {
    page.drawText(line.slice(0, 95), { x: 50, y, size: 11, font })
    y -= 18
  }
  return await doc.save()
}

function asciiOrDash(s: string) {
  const out = [...s].map((ch) => (ch.charCodeAt(0) <= 0x7f ? ch : '?')).join('')
  return out.trim() || '-'
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
  if (!isResidentialAssetType(contract.house.apartment.assetType)) {
    return { status: 'SKIPPED', reason: 'NOT_RESIDENTIAL' as const }
  }
  if (!isPastHousingReportTPlus1(contract.startDate)) {
    return { status: 'SKIPPED', reason: 'BEFORE_T_PLUS_1' as const }
  }

  const report = await ensureHousingReportRecord(prisma, contractId)
  if (!report) {
    return { status: 'SKIPPED', reason: 'NO_REPORT_RECORD' as const }
  }

  try {
    const receiptsDir = path.join(process.cwd(), 'receipts')
    await fs.mkdir(receiptsDir, { recursive: true })
    const filename = `housing-receipt-${contract.contractNo}.pdf`
    const filePath = path.join(receiptsDir, filename)
    const pdfBytes = await buildHousingReceiptPdfBuffer(contract)
    await fs.writeFile(filePath, Buffer.from(pdfBytes))

    const updated = await prisma.housingReport.update({
      where: { id: report.id },
      data: {
        status: 'SUCCESS',
        receiptPdfPath: filePath,
        lastError: null,
        reportedAt: new Date(),
        bureauRecordNo: `NNFJ-DEMO-${contract.contractNo}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 900) + 100).padStart(3, '0')}`,
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
