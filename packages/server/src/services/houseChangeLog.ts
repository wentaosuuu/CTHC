import type { Admin, PrismaClient } from '@prisma/client'

export type HouseFieldChange = {
  fieldLabel: string
  beforeValue: string
  afterValue: string
}

export function truncateLogValue(s: string | null | undefined, max = 900): string {
  const t = s == null ? '' : String(s)
  if (t.length <= max) return t
  return `${t.slice(0, max)}…（全文 ${t.length} 字）`
}

export function jsonArrayCount(jsonStr: string | null | undefined): number {
  if (jsonStr == null || jsonStr === '') return 0
  try {
    const p = JSON.parse(jsonStr)
    return Array.isArray(p) ? p.length : 0
  } catch {
    return 0
  }
}

export async function insertHouseChangeLogs(
  prisma: PrismaClient,
  params: { houseId: string; admin: Admin; changes: HouseFieldChange[] },
): Promise<void> {
  const rows = params.changes.filter((c) => c.beforeValue !== c.afterValue)
  if (!rows.length) return
  for (const c of rows) {
    await prisma.houseChangeLog.create({
      data: {
        houseId: params.houseId,
        fieldLabel: c.fieldLabel,
        beforeValue: c.beforeValue,
        afterValue: c.afterValue,
        adminId: params.admin.id,
        adminName: params.admin.name,
        adminEmail: params.admin.email,
      },
    })
  }
}
