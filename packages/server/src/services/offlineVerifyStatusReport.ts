import type { PrismaClient } from '@prisma/client'
import { displayBillNoFromId } from '../billDisplayNo.js'
import { isContractBillingPaused } from '../contractBilling.js'
import { offlineChannelLabel } from '../offlineVerify.js'
import { toYmd } from '../time.js'
import type { ReportFilters } from './financeReports.js'
import { mapBillAssetFields, periodInRange } from './reportBillCommon.js'

export type OfflineVerifyStatusRow = {
  logId: string
  assetName: string
  contractNo: string
  tenantName: string
  billNo: string
  billTotalReceivable: number
  verifyAmount: number
  billStatusAfter: string
  verifyStatus: string
  verifyFailReason: string
  prepayAmount: number
  operator: string
  operatedAt: string
  remark: string
}

export type OfflineVerifyStatusSummary = {
  verifyCount: number
  totalVerifyAmount: number
  totalPrepayAmount: number
  successCount: number
  partialCount: number
  failedCount: number
  prepayCount: number
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

function billStatusAfterVerify(
  total: number,
  receivedAfter: number,
  billingRemark: string | null,
): string {
  if (/冲红/.test(billingRemark || '')) return '已冲红'
  if (total > 0 && receivedAfter >= total) return '已结清'
  if (receivedAfter > 0) return '部分结清'
  return '未支付'
}

function verifyStatusLabel(applyToBill: number, excess: number, receivedAfter: number, total: number): string {
  if (applyToBill <= 0) return '核销失败'
  if (excess > 0) return '预收挂账'
  if (total > 0 && receivedAfter >= total) return '核销成功'
  return '部分核销'
}

function verifyFailReasonLabel(
  applyToBill: number,
  receivedBefore: number,
  total: number,
): string {
  if (applyToBill > 0) return ''
  if (total > 0 && receivedBefore >= total) return '3. 账单已全额结清'
  return '2. 无对应有效待核销账单'
}

function computeVerifyAllocation(
  bill: { totalAmount: number; offlineVerifyLogs: { id: string; amount: number; createdAt: Date }[] },
  logId: string,
): { applyToBill: number; excess: number; receivedBefore: number; receivedAfter: number } {
  const ordered = [...bill.offlineVerifyLogs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  let received = 0
  for (const l of ordered) {
    const remaining = Math.max(0, bill.totalAmount - received)
    const applyToBill = Math.min(l.amount, remaining)
    const excess = l.amount - applyToBill
    if (l.id === logId) {
      return { applyToBill, excess, receivedBefore: received, receivedAfter: received + applyToBill }
    }
    received += applyToBill
  }
  return { applyToBill: 0, excess: 0, receivedBefore: received, receivedAfter: received }
}

export async function buildOfflineVerifyStatusReport(
  prisma: PrismaClient,
  filters: ReportFilters,
  canAccessStore: (id: string) => boolean,
): Promise<{ rows: OfflineVerifyStatusRow[]; summary: OfflineVerifyStatusSummary }> {
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

  const adminIds = [...new Set(logs.map((l) => l.adminId).filter((id): id is string => Boolean(id)))]
  const admins =
    adminIds.length > 0
      ? await prisma.admin.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } })
      : []
  const adminNameById = new Map(admins.map((a) => [a.id, a.name]))

  const rows: OfflineVerifyStatusRow[] = []
  let totalVerifyAmount = 0
  let totalPrepayAmount = 0
  let successCount = 0
  let partialCount = 0
  let failedCount = 0
  let prepayCount = 0

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
    if (!dateInRange(log.createdAt, filters.collectedFrom, filters.collectedTo)) continue

    const { applyToBill, excess, receivedBefore, receivedAfter } = computeVerifyAllocation(b, log.id)
    const billStatusAfter = billStatusAfterVerify(b.totalAmount, receivedAfter, b.billingRemark)
    const verifyStatus = verifyStatusLabel(applyToBill, excess, receivedAfter, b.totalAmount)
    const verifyFailReason = verifyFailReasonLabel(applyToBill, receivedBefore, b.totalAmount)

    const channel = offlineChannelLabel(log.collectionChannel)
    const remark = [channel, log.remark?.trim()].filter(Boolean).join(' · ')

    rows.push({
      logId: log.id,
      assetName: (log.assetName || '').trim() || common.assetName,
      contractNo: common.contractNo,
      tenantName: common.tenantName,
      billNo: displayBillNoFromId(b.id),
      billTotalReceivable: b.totalAmount,
      verifyAmount: applyToBill,
      billStatusAfter,
      verifyStatus,
      verifyFailReason,
      prepayAmount: excess,
      operator: log.adminId ? adminNameById.get(log.adminId) || '管理员' : '系统全自动操作',
      operatedAt: fmtDateTime(log.createdAt),
      remark,
    })

    totalVerifyAmount += applyToBill
    totalPrepayAmount += excess
    if (verifyStatus === '核销成功') successCount += 1
    else if (verifyStatus === '部分核销') partialCount += 1
    else if (verifyStatus === '核销失败') failedCount += 1
    else if (verifyStatus === '预收挂账') prepayCount += 1
  }

  return {
    rows,
    summary: {
      verifyCount: rows.length,
      totalVerifyAmount,
      totalPrepayAmount,
      successCount,
      partialCount,
      failedCount,
      prepayCount,
    },
  }
}
