import type { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import { houseBizId } from '../houseBizId.js'
import { houseConfigFromImportText, serializeHouseConfigItems } from '../houseConfigJson.js'

const TEMPLATE_HEADERS = [
  '房源业务编号',
  '月租(元)',
  '押金(元)',
  '公寓地址',
  'H5仅浏览外链',
  '房屋配置',
] as const

export function buildHouseImportTemplateBuffer(): Buffer {
  const wb = XLSX.utils.book_new()
  const wsData = [[...TEMPLATE_HEADERS]]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 36 }, { wch: 32 }, { wch: 28 }]
  XLSX.utils.book_append_sheet(wb, ws, '资产维护')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return Buffer.from(buf)
}

function cellStr(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v))
  return String(v).trim()
}

function cellInt(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v))
  const n = parseInt(String(v).replace(/\s+/g, ''), 10)
  return Number.isFinite(n) ? Math.max(0, n) : null
}

function validHttpUrl(u: string): boolean {
  if (!u) return true
  try {
    const p = new URL(u)
    return p.protocol === 'http:' || p.protocol === 'https:'
  } catch {
    return false
  }
}

export async function parseAndImportHouses(
  prisma: PrismaClient,
  fileBuffer: Buffer,
  canAccessStore: (storeId: string) => boolean,
): Promise<{ updated: number; errors: string[] }> {
  const wb = XLSX.read(fileBuffer, { type: 'buffer' })
  const firstSheet = wb.Sheets[wb.SheetNames[0]]
  if (!firstSheet) return { updated: 0, errors: ['文件中无有效工作表'] }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: '' })
  if (rows.length < 2) return { updated: 0, errors: ['请至少保留表头与一行数据'] }

  const houses = await prisma.house.findMany({
    include: { apartment: true },
    take: 5000,
  })
  const bizToHouse = new Map<string, { id: string; storeId: string }>()
  for (const h of houses) {
    bizToHouse.set(houseBizId(h.id), { id: h.id, storeId: h.apartment.storeId })
  }

  const errors: string[] = []
  let updated = 0
  const dataRows = rows.slice(1) as unknown[][]

  for (let i = 0; i < dataRows.length; i += 1) {
    const row = dataRows[i]
    const lineNo = i + 2
    const biz = cellStr(row[0])
    if (!biz) continue

    const found = bizToHouse.get(biz)
    if (!found) {
      errors.push(`第 ${lineNo} 行：未找到房源业务编号 ${biz}`)
      continue
    }
    if (!canAccessStore(found.storeId)) {
      errors.push(`第 ${lineNo} 行：无权维护房源 ${biz}`)
      continue
    }

    const rent = cellInt(row[1])
    const depositCell = cellInt(row[2])
    const address = cellStr(row[3])
    const browseUrl = cellStr(row[4])
    const configText = cellStr(row[5])

    const data: Record<string, unknown> = {}

    if (rent != null) {
      data.rentMonthly = rent
      data.deposit = depositCell != null ? depositCell : rent
    } else if (depositCell != null) {
      data.deposit = depositCell
    }

    if (address) data.address = address

    if (browseUrl) {
      if (!validHttpUrl(browseUrl)) {
        errors.push(`第 ${lineNo} 行：H5仅浏览外链须为 http(s) 地址`)
        continue
      }
      data.externalBrowseUrl = browseUrl
    }

    if (configText) {
      const items = houseConfigFromImportText(configText)
      data.houseConfigJson = serializeHouseConfigItems(items)
    }

    if (Object.keys(data).length === 0) continue

    await prisma.house.update({
      where: { id: found.id },
      data: data as any,
    })
    updated += 1
  }

  return { updated, errors }
}
