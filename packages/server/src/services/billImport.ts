import type { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'

const TEMPLATE_HEADERS = [
  '合同号',
  '账期',
  '到期日',
  '租金',
  '水费',
  '电费',
  '物业费',
  '垃圾处理费',
  '公摊电费',
  '燃气费',
  '网络费',
  '滞纳金',
]

const FEE_KEYS = ['租金', '水费', '电费', '物业费', '垃圾处理费', '公摊电费', '燃气费', '网络费', '滞纳金'] as const

export function buildBillImportTemplateBuffer(): Buffer {
  const wb = XLSX.utils.book_new()
  const wsData = [
    TEMPLATE_HEADERS,
    ['C202619751738', '2026-05', '2026-05-01', 5000, 50, 120, 80, 20, 30, 0, 0, 0],
  ]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  XLSX.utils.book_append_sheet(wb, ws, '账单导入')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return Buffer.from(buf)
}

type ImportRow = {
  contractNo: string
  period: string
  dueDate: string
  items: { name: string; amount: number }[]
  totalAmount: number
}

function parseRow(row: unknown[]): ImportRow | null {
  const contractNo = String(row[0] ?? '').trim()
  const period = String(row[1] ?? '').trim()
  const dueDate = String(row[2] ?? '').trim()
  if (!contractNo || !period || !dueDate) return null
  const items: { name: string; amount: number }[] = []
  for (let i = 0; i < FEE_KEYS.length; i++) {
    const val = row[3 + i]
    const amount = typeof val === 'number' ? Math.max(0, Math.round(val)) : parseInt(String(val || '0'), 10) || 0
    if (amount > 0) items.push({ name: FEE_KEYS[i], amount })
  }
  const totalAmount = items.reduce((s, i) => s + i.amount, 0)
  if (totalAmount <= 0) return null
  return { contractNo, period, dueDate, items, totalAmount }
}

export async function parseAndImportBills(
  prisma: PrismaClient,
  fileBuffer: Buffer,
  canAccessStore: (storeId: string) => boolean,
): Promise<{ created: number; errors: string[] }> {
  const wb = XLSX.read(fileBuffer, { type: 'buffer' })
  const firstSheet = wb.Sheets[wb.SheetNames[0]]
  if (!firstSheet) return { created: 0, errors: ['文件中无有效工作表'] }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: '' })
  if (rows.length < 2) return { created: 0, errors: ['请至少保留表头与一行数据'] }
  const dataRows = rows.slice(1) as unknown[][]
  const errors: string[] = []
  let created = 0
  for (let i = 0; i < dataRows.length; i++) {
    const row = parseRow(dataRows[i])
    if (!row) continue
    const contract = await prisma.contract.findFirst({
      where: { contractNo: row.contractNo },
      include: { house: { include: { apartment: { include: { store: true } } } } },
    })
    if (!contract) {
      errors.push(`第 ${i + 2} 行：未找到合同号 ${row.contractNo}`)
      continue
    }
    if (!canAccessStore(contract.house.apartment.storeId)) {
      errors.push(`第 ${i + 2} 行：无权限操作该合同`)
      continue
    }
    const locked = await prisma.billPeriod.findUnique({
      where: { storeId_period: { storeId: contract.house.apartment.storeId, period: row.period } },
    })
    if (locked?.lockedAt) {
      errors.push(`第 ${i + 2} 行：账期 ${row.period} 已锁定，无法导入该门店账单`)
      continue
    }

    // 账单导入产品逻辑：
    // - 合同创建时会预生成 BASE 账单（租金明确，水电等不确定费用可能为 0）
    // - 管理员在合适时间导入水电等实际费用时，生成 ADJUSTMENT 补缴情单
    // - 若历史数据没有 BASE，则本次导入可兜底创建 BASE
    const existingBase = await prisma.bill.findUnique({
      where: { contractId_period_kind: { contractId: contract.id, period: row.period, kind: 'BASE' } },
    })
    const existingAdj = await prisma.bill.findUnique({
      where: { contractId_period_kind: { contractId: contract.id, period: row.period, kind: 'ADJUSTMENT' } },
    })
    if (existingAdj) {
      errors.push(`第 ${i + 2} 行：该合同账期 ${row.period} 已存在补缴情单`)
      continue
    }

    const dueDate = new Date(row.dueDate)

    if (existingBase) {
      // 已有 BASE：只导入“非租金”项目生成补缴情单
      const adjItems = row.items.filter((it) => it.name !== '租金')
      const adjTotal = adjItems.reduce((s, it) => s + it.amount, 0)
      if (adjTotal <= 0) continue

      const bill = await prisma.bill.create({
        data: {
          contractId: contract.id,
          period: row.period,
          dueDate,
          totalAmount: adjTotal,
          status: 'UNPAID',
          kind: 'ADJUSTMENT',
        },
      })
      for (const it of adjItems) {
        await prisma.billItem.create({
          data: { billId: bill.id, name: it.name, amount: it.amount },
        })
      }
      created += 1
      continue
    }

    // 没有 BASE（兜底）：按导入内容创建 BASE
    const bill = await prisma.bill.create({
      data: {
        contractId: contract.id,
        period: row.period,
        dueDate,
        totalAmount: row.totalAmount,
        status: 'UNPAID',
        kind: 'BASE',
      },
    })
    for (const it of row.items) {
      await prisma.billItem.create({
        data: { billId: bill.id, name: it.name, amount: it.amount },
      })
    }
    created += 1
  }
  return { created, errors }
}
