import type { Prisma, PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import { isContractBillingPaused } from '../contractBilling.js'

export const BILL_IMPORT_FEE_KEYS = [
  '租金',
  '水费',
  '电费',
  '物业费',
  '垃圾处理费',
  '公摊电费',
  '燃气费',
  '网络费',
  '滞纳金',
  '其他费用',
] as const

/** 表头顺序：合同号、水表号、电表号、燃气表号、账期、到期日、各费用列、账单备注 */
export const BILL_IMPORT_TEMPLATE_HEADERS = [
  '合同号',
  '水表号',
  '电表号',
  '燃气表号',
  '账期',
  '到期日',
  ...BILL_IMPORT_FEE_KEYS,
  '账单备注',
]

export function parseMeterNoListJson(raw: string | null | undefined): string[] {
  try {
    const j = JSON.parse(raw ?? '[]')
    if (!Array.isArray(j)) return []
    return [...new Set(j.map((x) => String(x).trim()).filter(Boolean))]
  } catch {
    return []
  }
}

export function buildBillImportTemplateBuffer(): Buffer {
  const wb = XLSX.utils.book_new()
  const wsData = [
    BILL_IMPORT_TEMPLATE_HEADERS,
    ['C202619751738', '', '', '', '2026-05-01', '2026-05-01', 5000, 50, 120, 80, 20, 30, 0, 0, 0, 15, '示例：可填公摊维修等'],
    ['', 'WS-DEMO-001', '', '', '2026-05-01', '2026-05-01', 0, 50, 120, 0, 0, 0, 0, 0, 0, 0, '用水表号关联合同（合同号可留空）'],
    ['', '', '', 'GS-DEMO-001', '2026-05-01', '2026-05-01', 0, 0, 0, 0, 0, 0, 36, 0, 0, 0, '用燃气表号关联合同（合同号可留空）'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  XLSX.utils.book_append_sheet(wb, ws, '账单导入')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return Buffer.from(buf)
}

type ImportRow = {
  contractNo: string
  waterMeterNo: string
  electricMeterNo: string
  gasMeterNo: string
  period: string
  dueDate: string
  items: { name: string; amount: number }[]
  totalAmount: number
  billingRemark: string | null
}

export type MeterMatchQuery = {
  contractNo?: string
  waterMeterNo?: string
  electricMeterNo?: string
  gasMeterNo?: string
}

function parseCellAmount(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val)
  const s = String(val ?? '').trim().replace(/,/g, '')
  if (!s) return 0
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : 0
}

type ImportColumns = {
  contractNo: number
  water: number
  electric: number
  gas: number
  period: number
  due: number
  fees: number[]
  remark: number
}

function resolveImportColumns(headerRow: unknown[]): ImportColumns {
  const headers = headerRow.map((cell) => String(cell ?? '').trim())
  const at = (name: string) => headers.indexOf(name)
  const hasGas = at('燃气表号') >= 0
  const feeStart = at('租金') >= 0 ? at('租金') : hasGas ? 6 : 5
  return {
    contractNo: at('合同号') >= 0 ? at('合同号') : 0,
    water: at('水表号') >= 0 ? at('水表号') : 1,
    electric: at('电表号') >= 0 ? at('电表号') : 2,
    gas: hasGas ? at('燃气表号') : -1,
    period: at('账期') >= 0 ? at('账期') : hasGas ? 4 : 3,
    due: at('到期日') >= 0 ? at('到期日') : hasGas ? 5 : 4,
    fees: BILL_IMPORT_FEE_KEYS.map((name, index) => (at(name) >= 0 ? at(name) : feeStart + index)),
    remark: at('账单备注') >= 0 ? at('账单备注') : feeStart + BILL_IMPORT_FEE_KEYS.length,
  }
}

function cellText(row: unknown[], index: number) {
  if (index < 0) return ''
  return String(row[index] ?? '').trim()
}

function parseRow(row: unknown[], columns: ImportColumns): ImportRow | null {
  const contractNo = cellText(row, columns.contractNo)
  const waterMeterNo = cellText(row, columns.water)
  const electricMeterNo = cellText(row, columns.electric)
  const gasMeterNo = cellText(row, columns.gas)
  const period = cellText(row, columns.period)
  const dueDate = cellText(row, columns.due)
  const billingRemarkRaw = cellText(row, columns.remark)
  const billingRemark = billingRemarkRaw ? billingRemarkRaw.slice(0, 500) : null
  if (!period || !dueDate) return null
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(period)) return null
  if (!contractNo && !waterMeterNo && !electricMeterNo && !gasMeterNo) return null
  const items: { name: string; amount: number }[] = []
  for (let i = 0; i < BILL_IMPORT_FEE_KEYS.length; i++) {
    const amount = parseCellAmount(row[columns.fees[i] ?? -1])
    if (amount !== 0) items.push({ name: BILL_IMPORT_FEE_KEYS[i], amount })
  }
  if (items.length === 0) return null
  const totalAmount = items.reduce((s, it) => s + it.amount, 0)
  if (totalAmount === 0) return null
  return { contractNo, waterMeterNo, electricMeterNo, gasMeterNo, period, dueDate, items, totalAmount, billingRemark }
}

async function appendBillLinesAndRecalcTotal(
  tx: Prisma.TransactionClient,
  billId: string,
  lines: { name: string; amount: number }[],
  dueDate: Date,
  billingRemark?: string | null,
) {
  for (const it of lines) {
    await tx.billItem.create({
      data: { billId, name: it.name, amount: it.amount },
    })
  }
  const all = await tx.billItem.findMany({ where: { billId } })
  const total = all.reduce((s, x) => s + x.amount, 0)
  const data: { totalAmount: number; dueDate: Date; billingRemark?: string } = { totalAmount: total, dueDate }
  const r = billingRemark?.trim()
  if (r) data.billingRemark = r.slice(0, 500)
  await tx.bill.update({
    where: { id: billId },
    data,
  })
}

function meterLabel(water: string, electric: string, gas: string) {
  return `水=${water || '—'} 电=${electric || '—'} 燃气=${gas || '—'}`
}

function houseMatchesMeters(
  h: { waterMeterNosJson: string; electricMeterNosJson: string; gasMeterNosJson: string },
  water: string,
  electric: string,
  gas: string,
): boolean {
  const w = water.trim()
  const e = electric.trim()
  const g = gas.trim()
  if (!w && !e && !g) return false
  const wList = parseMeterNoListJson(h.waterMeterNosJson)
  const eList = parseMeterNoListJson(h.electricMeterNosJson)
  const gList = parseMeterNoListJson(h.gasMeterNosJson)
  if (w && !wList.includes(w)) return false
  if (e && !eList.includes(e)) return false
  if (g && !gList.includes(g)) return false
  return true
}

const contractInclude = {
  house: { include: { apartment: { include: { store: true } } } },
  tenant: true,
} satisfies Prisma.ContractInclude

export async function resolveContractForMeterMatch(
  prisma: PrismaClient,
  query: MeterMatchQuery,
  canAccessStore: (storeId: string) => boolean,
): Promise<
  | {
      ok: true
      contract: Prisma.ContractGetPayload<{ include: typeof contractInclude }>
    }
  | { ok: false; error: string }
> {
  const waterMeterNo = (query.waterMeterNo ?? '').trim()
  const electricMeterNo = (query.electricMeterNo ?? '').trim()
  const gasMeterNo = (query.gasMeterNo ?? '').trim()
  const contractNo = (query.contractNo ?? '').trim()
  const hasMeter = Boolean(waterMeterNo || electricMeterNo || gasMeterNo)

  if (contractNo) {
    const contract = await prisma.contract.findFirst({
      where: { contractNo },
      include: contractInclude,
    })
    if (!contract) return { ok: false, error: `未找到合同号 ${contractNo}` }
    if (!canAccessStore(contract.house.apartment.storeId)) return { ok: false, error: '无权限操作该合同' }
    if (hasMeter && !houseMatchesMeters(contract.house, waterMeterNo, electricMeterNo, gasMeterNo)) {
      return { ok: false, error: '合同号与表号不一致：请核对水表号、电表号、燃气表号是否属于该房源' }
    }
    return { ok: true, contract }
  }

  if (!hasMeter) return { ok: false, error: '合同号与水表号、电表号、燃气表号不能同时为空' }

  const houses = await prisma.house.findMany({
    include: { apartment: { include: { store: true } } },
    take: 4000,
  })
  const matched = houses.filter(
    (h) => canAccessStore(h.apartment.storeId) && houseMatchesMeters(h, waterMeterNo, electricMeterNo, gasMeterNo),
  )
  if (matched.length === 0) {
    return { ok: false, error: `未找到匹配表号的资产（${meterLabel(waterMeterNo, electricMeterNo, gasMeterNo)}）` }
  }
  if (matched.length > 1) {
    return {
      ok: false,
      error: `表号匹配到多套资产（${matched.length} 套），请改用合同号导入，或保证水/电/燃气表号只对应一套资产`,
    }
  }
  const houseId = matched[0]!.id
  const contract = await prisma.contract.findFirst({
    where: { houseId, status: 'ACTIVE' },
    include: contractInclude,
    orderBy: { createdAt: 'desc' },
  })
  if (!contract) return { ok: false, error: '匹配到资产但该房源无「已生效」合同，无法用表号导入账单给租户' }
  return { ok: true, contract }
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
  const columns = resolveImportColumns((rows[0] ?? []) as unknown[])
  const errors: string[] = []
  let created = 0
  for (let i = 0; i < dataRows.length; i++) {
    const row = parseRow(dataRows[i], columns)
    if (!row) continue

    const resolved = await resolveContractForMeterMatch(prisma, row, canAccessStore)
    if (!resolved.ok) {
      errors.push(`第 ${i + 2} 行：${resolved.error}`)
      continue
    }
    const contract = resolved.contract
    if (contract.billingPausedAt && isContractBillingPaused(contract)) {
      errors.push(`第 ${i + 2} 行：合同 ${contract.contractNo} 已暂停计费，无法导入新账单`)
      continue
    }

    const periodLockCandidates = /^\d{4}-\d{2}-\d{2}$/.test(row.period)
      ? [row.period, row.period.slice(0, 7)]
      : [row.period]
    let periodLocked = false
    for (const p of periodLockCandidates) {
      const locked = await prisma.billPeriod.findUnique({
        where: { storeId_period: { storeId: contract.house.apartment.storeId, period: p } },
      })
      if (locked?.lockedAt) {
        periodLocked = true
        break
      }
    }
    if (periodLocked) {
      errors.push(`第 ${i + 2} 行：账期 ${row.period} 已锁定，无法导入该门店账单`)
      continue
    }

    const dueDate = new Date(row.dueDate)
    if (Number.isNaN(dueDate.getTime())) {
      errors.push(`第 ${i + 2} 行：到期日「${row.dueDate}」无效`)
      continue
    }

    const existingBase = await prisma.bill.findUnique({
      where: { contractId_period_kind: { contractId: contract.id, period: row.period, kind: 'BASE' } },
    })
    const existingAdj = await prisma.bill.findUnique({
      where: { contractId_period_kind: { contractId: contract.id, period: row.period, kind: 'ADJUSTMENT' } },
    })

    try {
      await prisma.$transaction(async (tx) => {
        if (!existingBase) {
          const bill = await tx.bill.create({
            data: {
              contractId: contract.id,
              period: row.period,
              dueDate,
              totalAmount: row.totalAmount,
              status: 'UNPAID',
              kind: 'BASE',
              billingRemark: row.billingRemark,
            },
          })
          for (const it of row.items) {
            await tx.billItem.create({
              data: { billId: bill.id, name: it.name, amount: it.amount },
            })
          }
          return
        }

        if (existingBase.status !== 'PAID') {
          const mergeLines = row.items.filter((it) => it.name !== '租金')
          if (mergeLines.length === 0) {
            if (row.items.some((it) => it.name === '租金')) {
              errors.push(
                `第 ${i + 2} 行：该账期已有未结清的 BASE 账单，表格中的「租金」不会重复合并；请至少填写一项非租金费用（可为负数）`,
              )
            }
            throw new Error('SKIP_ROW')
          }
          await appendBillLinesAndRecalcTotal(tx, existingBase.id, mergeLines, dueDate, row.billingRemark)
          return
        }

        const adjLines = row.items.filter((it) => it.name !== '租金')
        if (adjLines.length === 0) {
          errors.push(
            `第 ${i + 2} 行：该账期 BASE 租金已结清，补缴单仅合并水/电/物业等非租金项；请至少填写一项非租金费用（可为负数），不要重复填写租金`,
          )
          throw new Error('SKIP_ROW')
        }

        if (!existingAdj) {
          const bill = await tx.bill.create({
            data: {
              contractId: contract.id,
              period: row.period,
              dueDate,
              totalAmount: 0,
              status: 'UNPAID',
              kind: 'ADJUSTMENT',
              billingRemark: row.billingRemark,
            },
          })
          await appendBillLinesAndRecalcTotal(tx, bill.id, adjLines, dueDate, row.billingRemark)
          return
        }

        if (existingAdj.status === 'PAID') {
          errors.push(
            `第 ${i + 2} 行：该合同账期 ${row.period} 的账单与补缴均已结清，无法再导入；若有新费用请使用其它账期或联系管理员扩展多笔补缴`,
          )
          throw new Error('SKIP_ROW')
        }

        await appendBillLinesAndRecalcTotal(tx, existingAdj.id, adjLines, dueDate, row.billingRemark)
      })
    } catch (e) {
      if (e instanceof Error && e.message === 'SKIP_ROW') continue
      throw e
    }

    created += 1
  }
  return { created, errors }
}
