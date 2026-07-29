import type { PrismaClient } from '@prisma/client'
import { displayBillNoFromId } from '../billDisplayNo.js'
import { isContractBillingPaused } from '../contractBilling.js'
import { toYmd } from '../time.js'
import type { ReportFilters } from './financeReports.js'
import {
  accountingYearMonth,
  displayBatchNoFromId,
  financeCloseMonthFromCreatedAt,
  mapBillAssetFields,
  periodInRange,
  receivableSourceLabel,
  reportBillInclude,
} from './reportBillCommon.js'

export type MonthlyReceivableRow = {
  billId: string
  batchNo: string
  batchDate: string
  batchOperator: string
  accountingYear: string
  accountingMonth: string
  billNo: string
  assetType: string
  assetName: string
  projectName: string
  districtArea: string
  mgmtDepartment: string
  contractNo: string
  tenantName: string
  billType: string
  billingStart: string
  billingEnd: string
  receivableAmount: number
  reversalBillNo: string
  lateFeeBillNo: string
  expenseNaturalMonth: string
  receivableSource: string
  remark: string
}

export type MonthlyReceivableSummary = {
  billCount: number
  totalReceivable: number
  lockedBatchCount: number
}

export async function buildMonthlyReceivableReport(
  prisma: PrismaClient,
  filters: ReportFilters,
  canAccessStore: (id: string) => boolean,
): Promise<{ rows: MonthlyReceivableRow[]; summary: MonthlyReceivableSummary }> {
  const bills = await prisma.bill.findMany({
    include: reportBillInclude,
    orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
    take: 5000,
  })

  const locks = await prisma.billPeriod.findMany({
    where: { lockedAt: { not: null } },
    take: 2000,
  })
  const lockMap = new Map(locks.map((l) => [`${l.storeId}__${l.period}`, l]))

  const lockAdminIds = Array.from(
    new Set(locks.map((l) => l.lockedByAdminId).filter((x): x is string => Boolean(x))),
  )
  const lockAdmins =
    lockAdminIds.length > 0
      ? await prisma.admin.findMany({ where: { id: { in: lockAdminIds } }, select: { id: true, name: true } })
      : []
  const lockAdminNameById = new Map(lockAdmins.map((a) => [a.id, a.name]))

  const rows: MonthlyReceivableRow[] = []
  const lockedBatchKeys = new Set<string>()

  for (const b of bills) {
    const common = mapBillAssetFields(b)
    if (!canAccessStore(common.storeId)) continue
    if (isContractBillingPaused(b.contract)) continue
    if (filters.storeId && common.storeId !== filters.storeId) continue
    if (!periodInRange(b.period, filters.periodFrom, filters.periodTo)) continue

    const lock = lockMap.get(`${common.storeId}__${b.period}`)
    const acct = accountingYearMonth(b.period)
    const hasLateFee = b.items.some((i) => i.name.includes('滞纳金'))

    if (lock?.lockedAt) lockedBatchKeys.add(lock.id)

    rows.push({
      billId: b.id,
      batchNo: lock?.lockedAt ? displayBatchNoFromId(lock.id) : '',
      batchDate: lock?.lockedAt ? toYmd(lock.lockedAt) : '',
      batchOperator:
        lock?.lockedByAdminId && lockAdminNameById.get(lock.lockedByAdminId)
          ? lockAdminNameById.get(lock.lockedByAdminId)!
          : '',
      accountingYear: acct.year,
      accountingMonth: acct.month,
      billNo: displayBillNoFromId(b.id),
      assetType: common.assetType,
      assetName: common.assetName,
      projectName: common.projectName,
      districtArea: common.districtArea,
      mgmtDepartment: common.mgmtDepartment,
      contractNo: common.contractNo,
      tenantName: common.tenantName,
      billType: common.billType,
      billingStart: common.billing.start,
      billingEnd: common.billing.end,
      receivableAmount: b.totalAmount,
      reversalBillNo: '',
      lateFeeBillNo: hasLateFee ? '' : '',
      expenseNaturalMonth: b.period,
      receivableSource: receivableSourceLabel(b.kind, common.remark),
      remark: common.remark,
    })
  }

  const summary = rows.reduce(
    (s, r) => {
      s.billCount += 1
      s.totalReceivable += r.receivableAmount
      return s
    },
    { billCount: 0, totalReceivable: 0, lockedBatchCount: lockedBatchKeys.size },
  )

  return { rows, summary }
}

// re-export for tests
export { financeCloseMonthFromCreatedAt }
