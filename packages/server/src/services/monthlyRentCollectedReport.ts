import type { PrismaClient } from '@prisma/client'
import { displayBillNoFromId } from '../billDisplayNo.js'
import { isContractBillingPaused } from '../contractBilling.js'
import { offlineChannelLabel } from '../offlineVerify.js'
import { toYmd } from '../time.js'
import type { ReportFilters } from './financeReports.js'
import { mapBillAssetFields, periodInRange, splitBillFeeAmounts } from './reportBillCommon.js'

export type MonthlyRentCollectedRow = {
  rowId: string
  assetName: string
  projectName: string
  districtArea: string
  mgmtDepartment: string
  contractNo: string
  tenantName: string
  collectionSource: string
  actualReceived: number
  feePayable: number
  feeWaived: number
  settlementAmount: number
  tenantPaymentDate: string
  billNo: string
  billingPeriod: string
  billStatus: string
  settlementStatus: string
  settlementEntryDate: string
  operator: string
  operatedAt: string
  remark: string
  rentAmount: number
  propertyFeeAmount: number
}

export type MonthlyRentCollectedSummary = {
  rowCount: number
  totalActualReceived: number
  totalSettlementAmount: number
  autoCollectionCount: number
  offlineCollectionCount: number
}

const contractHouseInclude = {
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
} as const

function dateInRange(iso: Date, fromYmd?: string, toYmdStr?: string): boolean {
  const ymd = toYmd(iso)
  if (fromYmd && ymd < fromYmd) return false
  if (toYmdStr && ymd > toYmdStr) return false
  return true
}

function fmtDateTime(iso: Date): string {
  const y = iso.getFullYear()
  const m = String(iso.getMonth() + 1).padStart(2, '0')
  const d = String(iso.getDate()).padStart(2, '0')
  const hh = String(iso.getHours()).padStart(2, '0')
  const mm = String(iso.getMinutes()).padStart(2, '0')
  const ss = String(iso.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

function billStatusLabel(total: number, received: number, billingRemark: string | null): string {
  if (/冲红/.test(billingRemark || '')) return '已冲红'
  if (total > 0 && received >= total) return '已结清'
  if (received > 0) return '部分结清'
  return '未支付'
}

function computeVerifyAllocation(
  bill: { totalAmount: number; offlineVerifyLogs: { id: string; amount: number; createdAt: Date }[] },
  logId: string,
): { applyToBill: number; receivedAfter: number } {
  const ordered = [...bill.offlineVerifyLogs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  let received = 0
  for (const l of ordered) {
    const remaining = Math.max(0, bill.totalAmount - received)
    const applyToBill = Math.min(l.amount, remaining)
    if (l.id === logId) {
      return { applyToBill, receivedAfter: received + applyToBill }
    }
    received += applyToBill
  }
  return { applyToBill: 0, receivedAfter: received }
}

function prorateFees(
  items: { name: string; amount: number }[],
  totalAmount: number,
  receivedPart: number,
): { rentAmount: number; propertyFeeAmount: number } {
  const fees = splitBillFeeAmounts(items)
  if (totalAmount <= 0 || receivedPart >= totalAmount) return fees
  const ratio = receivedPart / totalAmount
  return {
    rentAmount: Math.round(fees.rentAmount * ratio),
    propertyFeeAmount: Math.round(fees.propertyFeeAmount * ratio),
  }
}

export async function buildMonthlyRentCollectedReport(
  prisma: PrismaClient,
  filters: ReportFilters,
  canAccessStore: (id: string) => boolean,
): Promise<{ rows: MonthlyRentCollectedRow[]; summary: MonthlyRentCollectedSummary }> {
  const logs = await prisma.billOfflineVerifyLog.findMany({
    include: {
      bill: {
        include: {
          items: true,
          changeLogs: { take: 1, orderBy: { changedAt: 'desc' } },
          offlineVerifyLogs: { orderBy: { createdAt: 'asc' } },
          contract: { include: contractHouseInclude },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 3000,
  })

  const paidBills = await prisma.bill.findMany({
    where: { status: 'PAID', paidAt: { not: null } },
    include: {
      items: true,
      changeLogs: { take: 1, orderBy: { changedAt: 'desc' } },
      contract: { include: contractHouseInclude },
      _count: { select: { offlineVerifyLogs: true } },
    },
    orderBy: { paidAt: 'desc' },
    take: 2000,
  })

  const adminIds = [...new Set(logs.map((l) => l.adminId).filter((id): id is string => Boolean(id)))]
  const admins =
    adminIds.length > 0
      ? await prisma.admin.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } })
      : []
  const adminNameById = new Map(admins.map((a) => [a.id, a.name]))

  const rows: MonthlyRentCollectedRow[] = []

  for (const log of logs) {
    const b = log.bill
    const common = mapBillAssetFields(b)
    const storeId = common.storeId
    if (!canAccessStore(storeId)) continue
    if (isContractBillingPaused(b.contract)) continue
    if (filters.storeId && storeId !== filters.storeId) continue
    if (filters.periodFrom || filters.periodTo) {
      if (!periodInRange(b.period, filters.periodFrom, filters.periodTo)) continue
    }

    const paymentAt = log.collectionDate ?? log.createdAt
    if (!dateInRange(paymentAt, filters.collectedFrom, filters.collectedTo)) continue

    const { applyToBill, receivedAfter } = computeVerifyAllocation(b, log.id)
    if (applyToBill <= 0) continue

    const channel = offlineChannelLabel(log.collectionChannel)
    const remark = [channel, log.remark?.trim()].filter(Boolean).join(' · ')
    const fees = prorateFees(b.items, b.totalAmount, applyToBill)

    rows.push({
      rowId: `offlog_${log.id}`,
      assetName: (log.assetName || '').trim() || common.assetName,
      projectName: common.projectName,
      districtArea: common.districtArea,
      mgmtDepartment: common.mgmtDepartment,
      contractNo: common.contractNo,
      tenantName: common.tenantName,
      collectionSource: '后台核销收款',
      actualReceived: log.amount,
      feePayable: 0,
      feeWaived: 0,
      settlementAmount: log.amount,
      tenantPaymentDate: toYmd(paymentAt),
      billNo: displayBillNoFromId(b.id),
      billingPeriod: b.period,
      billStatus: billStatusLabel(b.totalAmount, receivedAfter, b.billingRemark),
      settlementStatus: '无需结算',
      settlementEntryDate: '',
      operator: log.adminId ? adminNameById.get(log.adminId) || '管理员' : '系统全自动操作',
      operatedAt: fmtDateTime(log.createdAt),
      remark,
      rentAmount: fees.rentAmount,
      propertyFeeAmount: fees.propertyFeeAmount,
    })
  }

  for (const b of paidBills) {
    if (!b.paidAt) continue
    if (b._count.offlineVerifyLogs > 0) continue
    const common = mapBillAssetFields(b)
    const storeId = common.storeId
    if (!canAccessStore(storeId)) continue
    if (isContractBillingPaused(b.contract)) continue
    if (filters.storeId && storeId !== filters.storeId) continue
    if (!dateInRange(b.paidAt, filters.collectedFrom, filters.collectedTo)) continue
    if (filters.periodFrom || filters.periodTo) {
      if (!periodInRange(b.period, filters.periodFrom, filters.periodTo)) continue
    }

    const received = b.amountReceived > 0 ? b.amountReceived : b.totalAmount
    const fees = splitBillFeeAmounts(b.items)

    rows.push({
      rowId: `bill_${b.id}`,
      assetName: common.assetName,
      projectName: common.projectName,
      districtArea: common.districtArea,
      mgmtDepartment: common.mgmtDepartment,
      contractNo: common.contractNo,
      tenantName: common.tenantName,
      collectionSource: '系统自动收款',
      actualReceived: received,
      feePayable: 0,
      feeWaived: 0,
      settlementAmount: received,
      tenantPaymentDate: toYmd(b.paidAt),
      billNo: displayBillNoFromId(b.id),
      billingPeriod: b.period,
      billStatus: billStatusLabel(b.totalAmount, received, b.billingRemark),
      settlementStatus: '结算成功',
      settlementEntryDate: toYmd(b.paidAt),
      operator: '系统自动操作',
      operatedAt: fmtDateTime(b.paidAt),
      remark: '租客线上自助支付',
      rentAmount: fees.rentAmount,
      propertyFeeAmount: fees.propertyFeeAmount,
    })
  }

  rows.sort((a, b) => (a.tenantPaymentDate < b.tenantPaymentDate ? 1 : a.tenantPaymentDate > b.tenantPaymentDate ? -1 : 0))

  const summary = rows.reduce(
    (s, r) => {
      s.rowCount += 1
      s.totalActualReceived += r.actualReceived
      s.totalSettlementAmount += r.settlementAmount
      if (r.collectionSource === '系统自动收款') s.autoCollectionCount += 1
      else s.offlineCollectionCount += 1
      return s
    },
    {
      rowCount: 0,
      totalActualReceived: 0,
      totalSettlementAmount: 0,
      autoCollectionCount: 0,
      offlineCollectionCount: 0,
    },
  )

  return { rows, summary }
}
