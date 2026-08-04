import type { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import { resolveReceivingAccount } from './ledgerReceivingAccounts.js'

/** 与发起收款表单字段一致，全部选填 */
export const LEDGER_IMPORT_HEADERS = [
  '收款账户',
  '房号',
  '租户名称',
  '身份证号',
  '租金',
  '履约保证金',
  '水电押金',
  '卫生保洁押金',
  '物业费',
  '电费',
  '水费',
  '滞纳金',
  '合同编号',
  '账单编号',
  '租户手机',
  '备注',
] as const

export type LedgerImportRow = {
  receivingAccountName: string | null
  houseNo: string | null
  tenantName: string
  idCardNo: string | null
  rentAmount: number
  performanceDeposit: number
  utilityDeposit: number
  cleaningDeposit: number
  propertyFee: number
  electricityFee: number
  waterFee: number
  lateFee: number
  contractNo: string
  billNo: string | null
  tenantPhone: string | null
  remark: string | null
  amount: number
  excelRow: number
}

function parseCellAmount(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return Math.max(0, Math.round(val))
  const s = String(val ?? '')
    .trim()
    .replace(/,/g, '')
  if (!s) return 0
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function cellStr(val: unknown, max = 80): string {
  return String(val ?? '')
    .trim()
    .slice(0, max)
}

export function buildLedgerImportTemplateBuffer(): Buffer {
  const wb = XLSX.utils.book_new()
  const wsData = [
    [...LEDGER_IMPORT_HEADERS],
    [
      '南宁产投华创基本户',
      'A-1201',
      '张三',
      '450100199001011234',
      3000,
      3000,
      500,
      200,
      150,
      80,
      40,
      0,
      'HT2026-001',
      'ZD0000123456',
      '13800138000',
      '示例行：导入后每行生成一条待付款记录与独立二维码',
    ],
    ['租金专户', 'B-0808', '李四', '', 2500, 0, 0, 0, 100, 0, 0, 0, '', '', '', '费用均可选填'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = LEDGER_IMPORT_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 2) }))
  XLSX.utils.book_append_sheet(wb, ws, '记账本导入')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

function headerIndexMap(headerRow: unknown[]): Map<string, number> {
  const map = new Map<string, number>()
  headerRow.forEach((cell, idx) => {
    const key = String(cell ?? '').trim()
    if (key) map.set(key, idx)
  })
  return map
}

function pick(map: Map<string, number>, row: unknown[], name: string): unknown {
  const idx = map.get(name)
  if (idx == null) return ''
  return row[idx]
}

function parseDataRow(map: Map<string, number>, row: unknown[], excelRow: number): LedgerImportRow | null {
  const receivingAccountName = cellStr(pick(map, row, '收款账户'), 80) || null
  const houseNo = cellStr(pick(map, row, '房号')) || null
  const tenantName = cellStr(pick(map, row, '租户名称'))
  const idCardNo = cellStr(pick(map, row, '身份证号'), 40) || null
  const rentAmount = parseCellAmount(pick(map, row, '租金'))
  const performanceDeposit = parseCellAmount(pick(map, row, '履约保证金'))
  const utilityDeposit = parseCellAmount(pick(map, row, '水电押金'))
  const cleaningDeposit = parseCellAmount(pick(map, row, '卫生保洁押金'))
  const propertyFee = parseCellAmount(pick(map, row, '物业费'))
  const electricityFee = parseCellAmount(pick(map, row, '电费'))
  const waterFee = parseCellAmount(pick(map, row, '水费'))
  const lateFee = parseCellAmount(pick(map, row, '滞纳金'))
  const contractNo = cellStr(pick(map, row, '合同编号'))
  const billNo = cellStr(pick(map, row, '账单编号')) || null
  const tenantPhone = cellStr(pick(map, row, '租户手机'), 30) || null
  const remark = cellStr(pick(map, row, '备注'), 500) || null

  const amount =
    rentAmount +
    performanceDeposit +
    utilityDeposit +
    cleaningDeposit +
    propertyFee +
    electricityFee +
    waterFee +
    lateFee

  const empty =
    !receivingAccountName &&
    !houseNo &&
    !tenantName &&
    !idCardNo &&
    !contractNo &&
    !billNo &&
    !tenantPhone &&
    !remark &&
    amount === 0
  if (empty) return null

  return {
    receivingAccountName,
    houseNo,
    tenantName,
    idCardNo,
    rentAmount,
    performanceDeposit,
    utilityDeposit,
    cleaningDeposit,
    propertyFee,
    electricityFee,
    waterFee,
    lateFee,
    contractNo,
    billNo,
    tenantPhone,
    remark,
    amount,
    excelRow,
  }
}

export function parseLedgerImportRows(buffer: Buffer): { rows: LedgerImportRow[]; errors: string[] } {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return { rows: [], errors: ['Excel 中没有工作表'] }
  const sheet = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true })
  if (!aoa.length) return { rows: [], errors: ['Excel 为空'] }

  const headerRow = (aoa[0] ?? []) as unknown[]
  const map = headerIndexMap(headerRow)
  const missing = LEDGER_IMPORT_HEADERS.filter((h) => !map.has(h))
  // 宽松：只要有任一表头即可；若完全对不上则报错
  if (missing.length === LEDGER_IMPORT_HEADERS.length) {
    return { rows: [], errors: [`未识别到表头，请使用「下载导入模板」。期望包含：${LEDGER_IMPORT_HEADERS.join('、')}`] }
  }

  const rows: LedgerImportRow[] = []
  const errors: string[] = []
  for (let i = 1; i < aoa.length; i += 1) {
    const excelRow = i + 1
    const raw = (aoa[i] ?? []) as unknown[]
    try {
      const parsed = parseDataRow(map, raw, excelRow)
      if (!parsed) continue
      rows.push(parsed)
    } catch (e) {
      errors.push(`第 ${excelRow} 行解析失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (!rows.length && !errors.length) errors.push('没有可导入的数据行（请至少填写房号/租户/任一费用等）')
  return { rows, errors }
}

async function nextLedgerDisplayNo(prisma: PrismaClient) {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const prefix = `JZB${y}${m}${d}`
  const latest = await prisma.ledgerPayment.findFirst({
    where: { displayNo: { startsWith: prefix } },
    orderBy: { displayNo: 'desc' },
    select: { displayNo: true },
  })
  let seq = 1
  if (latest?.displayNo) {
    const tail = latest.displayNo.slice(prefix.length)
    const n = Number(tail)
    if (Number.isFinite(n) && n > 0) seq = n + 1
  }
  return { prefix, seq }
}

export async function importLedgerPayments(
  prisma: PrismaClient,
  buffer: Buffer,
  admin: { id: string; name: string },
): Promise<{ created: number; items: Awaited<ReturnType<typeof prisma.ledgerPayment.create>>[]; errors: string[] }> {
  const { rows, errors } = parseLedgerImportRows(buffer)
  if (!rows.length) return { created: 0, items: [], errors }

  let { prefix, seq } = await nextLedgerDisplayNo(prisma)
  const items: Awaited<ReturnType<typeof prisma.ledgerPayment.create>>[] = []

  for (const row of rows) {
    try {
      const displayNo = `${prefix}${String(seq).padStart(3, '0')}`
      seq += 1
      const account = await resolveReceivingAccount(prisma, { name: row.receivingAccountName })
      if (row.receivingAccountName && !account.receivingAccountId) {
        errors.push(`第 ${row.excelRow} 行：未找到收款账户「${row.receivingAccountName}」，已按名称记入快照`)
      }
      const created = await prisma.ledgerPayment.create({
        data: {
          displayNo,
          contractNo: row.contractNo,
          billNo: row.billNo,
          houseNo: row.houseNo,
          tenantName: row.tenantName,
          idCardNo: row.idCardNo,
          tenantPhone: row.tenantPhone,
          amount: row.amount,
          rentAmount: row.rentAmount,
          performanceDeposit: row.performanceDeposit,
          utilityDeposit: row.utilityDeposit,
          cleaningDeposit: row.cleaningDeposit,
          propertyFee: row.propertyFee,
          electricityFee: row.electricityFee,
          waterFee: row.waterFee,
          lateFee: row.lateFee,
          receivingAccountId: account.receivingAccountId,
          receivingAccountName: account.receivingAccountName,
          receivingBankName: account.receivingBankName,
          receivingAccountNo: account.receivingAccountNo,
          feeType: 'OTHER',
          remark: row.remark,
          status: 'PENDING',
          createdByAdminId: admin.id,
          createdByName: admin.name,
        },
      })
      items.push(created)
    } catch (e) {
      errors.push(`第 ${row.excelRow} 行写入失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { created: items.length, items, errors }
}
