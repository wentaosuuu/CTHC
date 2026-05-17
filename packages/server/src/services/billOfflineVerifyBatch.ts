import type { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import { displayBillNoFromId } from '../billDisplayNo.js'

export function buildOfflineVerifyBatchTemplateBuffer(): Buffer {
  const wb = XLSX.utils.book_new()
  const wsData = [
    ['账单编号', '核销备注'],
    ['填写二级列表中的「账单编号」（ZD…）；与列表展示一致，无需内部 ID', '例如：微信转账 / 现金 / POS 单号'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  XLSX.utils.book_append_sheet(wb, ws, '批量核销')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

export async function parseAndBatchOfflineVerify(
  prisma: PrismaClient,
  fileBuffer: Buffer,
  adminId: string,
  canAccessStore: (storeId: string) => boolean,
): Promise<{ verified: number; errors: string[] }> {
  const wb = XLSX.read(fileBuffer, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return { verified: 0, errors: ['文件中无有效工作表'] }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
  if (rows.length < 2) return { verified: 0, errors: ['请至少保留表头与一行数据'] }
  const dataRows = rows.slice(1) as unknown[][]
  const errors: string[] = []
  let ok = 0
  const now = new Date()

  for (let i = 0; i < dataRows.length; i++) {
    const cell = String(dataRows[i][0] ?? '').trim()
    const remark = String(dataRows[i][1] ?? '').trim().slice(0, 500)
    if (!cell) continue

    let billId = cell
    const byId = await prisma.bill.findUnique({
      where: { id: cell },
      include: {
        contract: {
          include: {
            house: {
              include: { apartment: true },
            },
          },
        },
      },
    })
    let bill = byId
    if (!bill && /^ZD\d+$/i.test(cell)) {
      const cand = await prisma.bill.findMany({
        where: { status: { in: ['UNPAID', 'OVERDUE'] } },
        include: {
          contract: {
            include: {
              house: {
                include: { apartment: true },
              },
            },
          },
        },
        take: 6000,
        orderBy: { updatedAt: 'desc' },
      })
      bill = cand.find((b) => displayBillNoFromId(b.id).toUpperCase() === cell.toUpperCase()) ?? null
    }
    if (!bill) {
      errors.push(`第 ${i + 2} 行：未找到账单「${cell}」（支持账单编号 ZD… 或内部 id）`)
      continue
    }
    billId = bill.id
    if (!canAccessStore(bill.contract.house.apartment.storeId)) {
      errors.push(`第 ${i + 2} 行：无权限核销账单 ${billId}`)
      continue
    }
    if (bill.status === 'PAID') {
      errors.push(`第 ${i + 2} 行：账单已支付，跳过 ${billId}`)
      continue
    }
    if (bill.status !== 'UNPAID' && bill.status !== 'OVERDUE') {
      errors.push(`第 ${i + 2} 行：状态不可核销 ${billId}`)
      continue
    }

    const locked = await prisma.billPeriod.findUnique({
      where: {
        storeId_period: { storeId: bill.contract.house.apartment.storeId, period: bill.period },
      },
    })
    if (locked?.lockedAt) {
      errors.push(`第 ${i + 2} 行：账期已锁定，无法核销 ${billId}`)
      continue
    }

    const rem = Math.max(0, bill.totalAmount - bill.amountReceived)
    await prisma.$transaction(async (tx) => {
      await tx.billOfflineVerifyLog.create({
        data: {
          billId: bill.id,
          amount: rem,
          remark: remark || null,
          attachmentsJson: '[]',
          adminId,
        },
      })
      await tx.bill.update({
        where: { id: bill.id },
        data: {
          amountReceived: bill.totalAmount,
          status: 'PAID',
          paidAt: bill.paidAt ?? now,
          offlineVerifiedAt: bill.offlineVerifiedAt ?? now,
          offlineVerifiedByAdminId: bill.offlineVerifiedByAdminId ?? adminId,
          offlineVerifiedRemark: remark || null,
        },
      })
    })
    ok += 1
  }

  return { verified: ok, errors }
}
