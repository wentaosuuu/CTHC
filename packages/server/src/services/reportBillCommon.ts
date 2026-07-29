import { buildRentBillSchedule, rentCycleMonths } from '../rentBillSchedule.js'
import { addMonths, startOfMonth, toYmd } from '../time.js'

export function periodInRange(period: string, from?: string, to?: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(period)) return false
  if (from && period < from) return false
  if (to && period > to) return false
  return true
}

/** 财务关账归属月：每月 25 日关账，25 日之后生成的账单计入次月 */
export function financeCloseMonthFromCreatedAt(createdAt: Date): string {
  const y = createdAt.getUTCFullYear()
  const m = createdAt.getUTCMonth() + 1
  const d = createdAt.getUTCDate()
  if (d > 25) {
    if (m === 12) return `${y + 1}-01`
    return `${y}-${String(m + 1).padStart(2, '0')}`
  }
  return `${y}-${String(m).padStart(2, '0')}`
}

export function leaseMonthsFromContract(startDate: Date, endDate: Date): number {
  let months =
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + (endDate.getUTCMonth() - startDate.getUTCMonth())
  if (endDate.getUTCDate() >= startDate.getUTCDate()) months += 1
  return Math.max(1, Math.min(36, months))
}

export function billingRangeForBill(
  contract: {
    startDate: Date
    endDate: Date
    rentMonthly: number
    rentCycle: string
    rentDueDay: number
  },
  period: string,
): { start: string; end: string } {
  const leaseMonths = leaseMonthsFromContract(contract.startDate, contract.endDate)
  const schedule = buildRentBillSchedule({
    startDate: contract.startDate,
    leaseMonths,
    rentMonthly: contract.rentMonthly,
    rentCycle: contract.rentCycle,
    rentDueDay: contract.rentDueDay,
  })
  const hit = schedule.find((s) => s.period === period)
  if (hit) {
    const periodStart = startOfMonth(new Date(`${period}-01T00:00:00.000Z`))
    const periodEndMonth = addMonths(periodStart, hit.monthsInPeriod - 1)
    const y = periodEndMonth.getUTCFullYear()
    const m = periodEndMonth.getUTCMonth()
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    return {
      start: toYmd(periodStart),
      end: `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    }
  }
  const [py, pm] = period.split('-').map(Number)
  const step = rentCycleMonths(contract.rentCycle)
  const start = `${py}-${String(pm).padStart(2, '0')}-01`
  const endMonth = addMonths(new Date(Date.UTC(py, pm - 1, 1)), step - 1)
  const ey = endMonth.getUTCFullYear()
  const em = endMonth.getUTCMonth() + 1
  const lastDay = new Date(Date.UTC(ey, em, 0)).getUTCDate()
  return {
    start,
    end: `${ey}-${String(em).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  }
}

/** 账期锁定批次展示编号（与账单编号算法一致，前缀 PC） */
export function displayBatchNoFromId(batchId: string, digits = 10): string {
  let h = 0
  for (let i = 0; i < batchId.length; i += 1) h = (h * 31 + batchId.charCodeAt(i)) >>> 0
  const s = String(h).padStart(digits, '0')
  return `PC${s.slice(-digits)}`
}

export function accountingYearMonth(period: string): { year: string; month: string } {
  const [y, m] = period.split('-')
  return { year: y || '', month: m || '' }
}

export function receivableSourceLabel(kind: string, remark: string): string {
  const r = remark.trim()
  if (kind === 'ADJUSTMENT') {
    if (/结转|调整|上期/.test(r)) return '上期调整结转'
    return '后台手工录入'
  }
  return '系统正常生成'
}

export const reportBillInclude = {
  items: { orderBy: { createdAt: 'asc' as const } },
  arrears: true,
  offlineVerifyLogs: { orderBy: { createdAt: 'asc' as const } },
  changeLogs: {
    orderBy: { changedAt: 'desc' as const },
    take: 1,
    include: { admin: true },
  },
  contract: {
    include: {
      tenant: true,
      house: {
        include: {
          apartment: {
            include: {
              store: {
                include: {
                  department: { include: { parent: true } },
                },
              },
            },
          },
        },
      },
    },
  },
} as const

export function mapBillAssetFields(b: {
  period: string
  kind: string
  billingRemark: string | null
  offlineVerifiedRemark: string | null
  items: { name: string }[]
  changeLogs: { remark: string | null }[]
  contract: {
    contractNo: string
    startDate: Date
    endDate: Date
    rentMonthly: number
    rentCycle: string
    rentDueDay: number
    tenant: { name: string }
    house: {
      houseNo: string
      address: string | null
      projectName: string | null
      rentCollectionUnit: string | null
      managerName: string | null
      mgmtDepartment: string | null
      apartment: {
        name: string
        assetType: string
        storeId: string
        store: {
          name: string
          department: {
            name: string
            parent: { name: string } | null
          } | null
        }
      }
    }
  }
}) {
  const h = b.contract.house
  const apt = h.apartment
  const store = apt.store
  const dept = store.department
  return {
    storeId: apt.storeId,
    assetType: apt.assetType,
    assetName: (h.address || '').trim() || `${apt.name} ${h.houseNo}`,
    projectName: (h.projectName || '').trim() || store.name,
    districtArea: dept?.parent?.name ?? dept?.name ?? store.name,
    mgmtDepartment: (h.mgmtDepartment || h.rentCollectionUnit || h.managerName || dept?.name || store.name).trim(),
    contractNo: b.contract.contractNo,
    tenantName: b.contract.tenant.name,
    billType:
      b.items.length > 0
        ? b.items.map((i) => i.name).join('、')
        : b.kind === 'ADJUSTMENT'
          ? '补缴账单'
          : '租金',
    billing: billingRangeForBill(b.contract, b.period),
    remark: [b.billingRemark, b.offlineVerifiedRemark, b.changeLogs[0]?.remark]
      .filter((x) => (x ?? '').trim())
      .join('；'),
  }
}

/** 从账单明细拆分租金/物业费金额（模板末两列） */
export function splitBillFeeAmounts(items: { name: string; amount: number }[]): {
  rentAmount: number
  propertyFeeAmount: number
} {
  let rentAmount = 0
  let propertyFeeAmount = 0
  for (const i of items) {
    if (/物业/.test(i.name)) propertyFeeAmount += i.amount
    else if (/租金|房租/.test(i.name)) rentAmount += i.amount
  }
  if (rentAmount === 0 && propertyFeeAmount === 0 && items.length === 1) {
    rentAmount = items[0]!.amount
  }
  return { rentAmount, propertyFeeAmount }
}
