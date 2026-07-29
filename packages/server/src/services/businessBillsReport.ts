import type { PrismaClient } from '@prisma/client'
import { displayBillNoFromId } from '../billDisplayNo.js'
import { offlineChannelLabel } from '../offlineVerify.js'
import { isContractBillingPaused } from '../contractBilling.js'
import { toYmd } from '../time.js'
import type { ReportFilters } from './financeReports.js'
import {
  financeCloseMonthFromCreatedAt,
  mapBillAssetFields,
  periodInRange,
  reportBillInclude,
} from './reportBillCommon.js'

export type BusinessBillRow = {
  billId: string
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
  totalAmount: number
  amountReceived: number
  amountOwed: number
  billStatus: string
  reversalBillNo: string
  lateFeeBillNo: string
  latestRentDueDate: string
  firstVerifyDate: string
  overdueDays: number
  collectionChannel: string
  expenseNaturalMonth: string
  financeCloseMonth: string
  creationMethod: string
  operator: string
  operatedAt: string
  remark: string
}

export type BusinessBillSummary = {
  billCount: number
  totalReceivable: number
  totalReceived: number
  totalOwed: number
}

export { financeCloseMonthFromCreatedAt }

function billStatusLabel(total: number, received: number, dbStatus: string): string {
  if (received >= total && total > 0) return '已结清'
  if (received > 0) return '部分结清'
  if (dbStatus === 'OVERDUE') return '未支付'
  return '未支付'
}

function creationMethodLabel(kind: string): string {
  if (kind === 'ADJUSTMENT') return '后台手工新增'
  return '系统自动生成'
}

function latestRentDueDate(dueDate: Date, graceDays: number | null | undefined): string {
  if (!graceDays || graceDays <= 0) return toYmd(dueDate)
  const d = new Date(dueDate.getTime())
  d.setUTCDate(d.getUTCDate() + graceDays)
  return toYmd(d)
}

function collectionChannelLabel(
  amountReceived: number,
  paidAt: Date | null,
  offlineLogs: { collectionChannel: string | null; createdAt: Date }[],
): string {
  if (amountReceived <= 0) return ''
  if (offlineLogs.length > 0) {
    const ch = offlineChannelLabel(offlineLogs[0]?.collectionChannel)
    if (paidAt && offlineLogs.length > 0) return ch ? `${ch}（含线上）` : '线上支付+线下核销'
    return ch || '后台手工核销'
  }
  if (paidAt) return '租客线上自助支付'
  return ''
}

export async function buildBusinessBillsReport(
  prisma: PrismaClient,
  filters: ReportFilters,
  canAccessStore: (id: string) => boolean,
): Promise<{ rows: BusinessBillRow[]; summary: BusinessBillSummary }> {
  const today = new Date()
  const bills = await prisma.bill.findMany({
    include: reportBillInclude,
    orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
    take: 5000,
  })

  const rows: BusinessBillRow[] = []

  for (const b of bills) {
    const common = mapBillAssetFields(b)
    if (!canAccessStore(common.storeId)) continue
    if (isContractBillingPaused(b.contract)) continue
    if (filters.storeId && common.storeId !== filters.storeId) continue
    if (!periodInRange(b.period, filters.periodFrom, filters.periodTo)) continue

    const amountOwed = Math.max(0, b.totalAmount - b.amountReceived)
    const firstOffline = b.offlineVerifyLogs[0]
    const firstVerifyDate = firstOffline
      ? toYmd(firstOffline.collectionDate ?? firstOffline.createdAt)
      : b.paidAt
        ? toYmd(b.paidAt)
        : ''

    let overdueDays = b.arrears?.daysOverdue ?? 0
    if (!overdueDays && amountOwed > 0 && b.dueDate < today) {
      overdueDays = Math.max(0, Math.floor((today.getTime() - b.dueDate.getTime()) / 86400000))
    }

    const hasLateFee = b.items.some((i) => i.name.includes('滞纳金'))
    const lastLog = b.changeLogs[0]
    let operator = lastLog?.admin?.name ?? ''
    if (!operator && b.offlineVerifiedByAdminId) operator = '管理员'
    if (!operator && b.kind === 'BASE') operator = '系统'

    rows.push({
      billId: b.id,
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
      totalAmount: b.totalAmount,
      amountReceived: b.amountReceived,
      amountOwed,
      billStatus: billStatusLabel(b.totalAmount, b.amountReceived, b.status),
      reversalBillNo: '',
      lateFeeBillNo: hasLateFee ? '' : '',
      latestRentDueDate: latestRentDueDate(b.dueDate, b.contract.latestRentGraceDays),
      firstVerifyDate,
      overdueDays,
      collectionChannel: collectionChannelLabel(b.amountReceived, b.paidAt, b.offlineVerifyLogs),
      expenseNaturalMonth: b.period,
      financeCloseMonth: financeCloseMonthFromCreatedAt(b.createdAt),
      creationMethod: creationMethodLabel(b.kind),
      operator,
      operatedAt: toYmd(b.updatedAt),
      remark: common.remark,
    })
  }

  const summary = rows.reduce(
    (s, r) => {
      s.billCount += 1
      s.totalReceivable += r.totalAmount
      s.totalReceived += r.amountReceived
      s.totalOwed += r.amountOwed
      return s
    },
    { billCount: 0, totalReceivable: 0, totalReceived: 0, totalOwed: 0 },
  )

  return { rows, summary }
}
