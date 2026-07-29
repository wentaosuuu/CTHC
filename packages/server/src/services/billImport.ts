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

/** 表头顺序：合同号、水表号、电表号、账期、到期日、各费用列、账单备注 */
export const BILL_IMPORT_TEMPLATE_HEADERS = [
  '合同号',
  '水表号',
  '电表号',
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
    ['C202619751738', '', '', '2026-05-01', '2026-05-01', 5000, 50, 120, 80, 20, 30, 0, 0, 0, 15, '示例：可填公摊维修等'],
    ['', 'WS-DEMO-001', '', '2026-05-01', '2026-05-01', 0, 50, 120, 0, 0, 0, 0, 0, 0, 0, '用水表号关联合同（合同号可留空）'],
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
  period: string
  dueDate: string
  items: { name: string; amount: number }[]
  totalAmount: number
  billingRemark: string | null
}

function parseCellAmount(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val)
  const s = String(val ?? '').trim().replace(/,/g, '')
  if (!s) return 0
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function parseRow(row: unknown[]): ImportRow | null {
  const contractNo = String(row[0] ?? '').trim()
  const waterMeterNo = String(row[1] ?? '').trim()
  const electricMeterNo = String(row[2] ?? '').trim()
  const period = String(row[3] ?? '').trim()
  const dueDate = String(row[4] ?? '').trim()
  const remarkCol = 5 + BILL_IMPORT_FEE_KEYS.length
  const billingRemarkRaw = String(row[remarkCol] ?? '').trim()
  const billingRemark = billingRemarkRaw ? billingRemarkRaw.slice(0, 500) : null
  if (!period || !dueDate) return null
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(period)) return null
  if (!contractNo && !waterMeterNo && !electricMeterNo) return null
  const items: { name: string; amount: number }[] = []
  for (let i = 0; i < BILL_IMPORT_FEE_KEYS.length; i++) {
    const amount = parseCellAmount(row[5 + i])
    if (amount !== 0) items.push({ name: BILL_IMPORT_FEE_KEYS[i], amount })
  }
  if (items.length === 0) return null
  const totalAmount = items.reduce((s, it) => s + it.amount, 0)
  if (totalAmount === 0) return null
  return { contractNo, waterMeterNo, electricMeterNo, period, dueDate, items, totalAmount, billingRemark }
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

function houseMatchesMeters(
  h: { waterMeterNosJson: string; electricMeterNosJson: string },
  water: string,
  electric: string,
): boolean {
  const w = water.trim()
  const e = electric.trim()
  if (!w && !e) return false
  const wList = parseMeterNoListJson(h.waterMeterNosJson)
  const eList = parseMeterNoListJson(h.electricMeterNosJson)
  if (w && !wList.includes(w)) return false
  if (e && !eList.includes(e)) return false
  return true
}

async function resolveContractForImportRow(
  prisma: PrismaClient,
  row: ImportRow,
  canAccessStore: (storeId: string) => boolean,
): Promise<
  | {
      ok: true
      contract: {
        id: string
        contractNo: string
        billingPausedAt: Date | null
        billingResumeFrom: Date | null
        house: { apartment: { storeId: string } }
      }
    }
  | { ok: false; error: string }
> {
  if (row.contractNo) {
    const contract = await prisma.contract.findFirst({
      where: { contractNo: row.contractNo },
      include: { house: { include: { apartment: { include: { store: true } } } } },
    })
    if (!contract) return { ok: false, error: `未找到合同号 ${row.contractNo}` }
    if (!canAccessStore(contract.house.apartment.storeId)) return { ok: false, error: '无权限操作该合同' }
    if (row.waterMeterNo || row.electricMeterNo) {
      const h = contract.house
      if (!houseMatchesMeters(h, row.waterMeterNo, row.electricMeterNo)) {
        return { ok: false, error: `合同号与表号不一致：请核对水/电表号是否属于该房源` }
      }
    }
    return { ok: true, contract }
  }

  const w = row.waterMeterNo.trim()
  const e = row.electricMeterNo.trim()
  if (!w && !e) return { ok: false, error: '合同号与水表号、电表号不能同时为空' }

  const houses = await prisma.house.findMany({
    include: { apartment: { include: { store: true } } },
    take: 4000,
  })
  const matched = houses.filter(
    (h) => canAccessStore(h.apartment.storeId) && houseMatchesMeters(h, row.waterMeterNo, row.electricMeterNo),
  )
  if (matched.length === 0) {
    return { ok: false, error: `未找到匹配水/电表号的资产（水=${w || '—'} 电=${e || '—'}）` }
  }
  if (matched.length > 1) {
    return { ok: false, error: `水/电表号匹配到多套资产（${matched.length} 套），请改用合同号导入或调整表号唯一性` }
  }
  const houseId = matched[0]!.id
  const contract = await prisma.contract.findFirst({
    where: { houseId, status: 'ACTIVE' },
    include: { house: { include: { apartment: { include: { store: true } } } } },
    orderBy: { createdAt: 'desc' },
  })
  if (!contract) return { ok: false, error: '匹配到资产但该房源无「已生效」合同，无法用表号导入账单' }
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
  const errors: string[] = []
  let created = 0
  for (let i = 0; i < dataRows.length; i++) {
    const row = parseRow(dataRows[i])
    if (!row) continue

    const resolved = await resolveContractForImportRow(prisma, row, canAccessStore)
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
