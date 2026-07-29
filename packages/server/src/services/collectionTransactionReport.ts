import type { PrismaClient, TransactionReceipt } from '@prisma/client'
import { displayBillNoFromId } from '../billDisplayNo.js'
import { offlineChannelLabel } from '../offlineVerify.js'
import { isContractBillingPaused } from '../contractBilling.js'
import { toYmd } from '../time.js'
import type { ReportFilters } from './financeReports.js'
import { mapBillAssetFields, periodInRange, splitBillFeeAmounts } from './reportBillCommon.js'

export type CollectionTransactionRow = {
  txId: string
  assetName: string
  projectName: string
  districtArea: string
  mgmtDepartment: string
  contractNo: string
  tenantName: string
  totalReceivable: number
  actualReceived: number
  feePayable: number
  feeWaived: number
  settlementAmount: number
  billingStart: string
  billingEnd: string
  paidAt: string
  settlementStatus: string
  settlementEntryDate: string
  relatedBillNos: string
  remark: string
  rentAmount: number
  propertyFeeAmount: number
}

export type CollectionTransactionSummary = {
  txCount: number
  totalActualReceived: number
  totalReceivable: number
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

function settlementStatus(
  txType: 'BILL_PAYMENT' | 'OFFLINE_VERIFY' | 'PREPAYMENT' | 'REFUND',
  receipt: TransactionReceipt | null | undefined,
): string {
  if (txType === 'REFUND') return '已退款'
  if (receipt?.status === 'VOID') return '已退款'
  return '结算成功'
}

function billRowFromTx(params: {
  txId: string
  occurredAt: Date
  actualReceived: number
  totalReceivable: number
  txType: 'BILL_PAYMENT' | 'OFFLINE_VERIFY' | 'PREPAYMENT' | 'REFUND'
  bill: {
    id: string
    period: string
    totalAmount: number
    billingRemark: string | null
    offlineVerifiedRemark: string | null
    items: { name: string; amount: number }[]
    changeLogs: { remark: string | null }[]
    contract: Parameters<typeof mapBillAssetFields>[0]['contract']
  } | null
  contract: Parameters<typeof mapBillAssetFields>[0]['contract']
  remark: string
  receipt: TransactionReceipt | null | undefined
}): CollectionTransactionRow {
  const common = params.bill
    ? mapBillAssetFields({
        period: params.bill.period,
        kind: 'BASE',
        billingRemark: params.bill.billingRemark,
        offlineVerifiedRemark: params.bill.offlineVerifiedRemark,
        items: params.bill.items,
        changeLogs: params.bill.changeLogs,
        contract: params.bill.contract,
      })
    : mapBillAssetFields({
        period: '',
        kind: 'BASE',
        billingRemark: null,
        offlineVerifiedRemark: null,
        items: [],
        changeLogs: [],
        contract: params.contract,
      })

  const fees = params.bill ? splitBillFeeAmounts(params.bill.items) : { rentAmount: 0, propertyFeeAmount: 0 }
  const status = settlementStatus(params.txType, params.receipt)
  const relatedBillNos = params.bill ? displayBillNoFromId(params.bill.id) : ''

  return {
    txId: params.txId,
    assetName: common.assetName,
    projectName: common.projectName,
    districtArea: common.districtArea,
    mgmtDepartment: common.mgmtDepartment,
    contractNo: common.contractNo,
    tenantName: common.tenantName,
    totalReceivable: params.totalReceivable,
    actualReceived: params.actualReceived,
    feePayable: 0,
    feeWaived: 0,
    settlementAmount: params.actualReceived,
    billingStart: params.bill ? common.billing.start : '',
    billingEnd: params.bill ? common.billing.end : '',
    paidAt: fmtDateTime(params.occurredAt),
    settlementStatus: status,
    settlementEntryDate: status === '结算成功' || status === '已退款' ? toYmd(params.occurredAt) : '',
    relatedBillNos,
    remark: params.remark || common.remark,
    rentAmount: fees.rentAmount,
    propertyFeeAmount: fees.propertyFeeAmount,
  }
}

export async function buildCollectionTransactionReport(
  prisma: PrismaClient,
  filters: ReportFilters,
  canAccessStore: (id: string) => boolean,
): Promise<{ rows: CollectionTransactionRow[]; summary: CollectionTransactionSummary }> {
  const collectedFrom = filters.collectedFrom
  const collectedTo = filters.collectedTo

  const logs = await prisma.billOfflineVerifyLog.findMany({
    include: {
      bill: {
        include: {
          items: true,
          changeLogs: { take: 1, orderBy: { changedAt: 'desc' } },
          contract: { include: contractHouseInclude },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 2000,
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
    take: 1500,
  })

  const prepayLedgers = await prisma.contractCreditLedger.findMany({
    where: { kind: 'OVERPAY_OFFLINE', deltaAmount: { gt: 0 } },
    include: {
      contractCredit: {
        include: {
          contract: { include: contractHouseInclude },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const refunds = await prisma.refund.findMany({
    include: {
      contract: { include: contractHouseInclude },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const txIds: string[] = []
  const draftRows: CollectionTransactionRow[] = []

  for (const log of logs) {
    const b = log.bill
    const storeId = b.contract.house.apartment.storeId
    if (!canAccessStore(storeId)) continue
    if (isContractBillingPaused(b.contract)) continue
    if (filters.storeId && storeId !== filters.storeId) continue
    if (!dateInRange(log.collectionDate ?? log.createdAt, collectedFrom, collectedTo)) continue
    if (filters.periodFrom || filters.periodTo) {
      if (!periodInRange(b.period, filters.periodFrom, filters.periodTo)) continue
    }
    const txId = `offlog_${log.id}`
    txIds.push(txId)
    const channelLabel = offlineChannelLabel(log.collectionChannel)
    const logRemark = [channelLabel, log.remark?.trim()].filter(Boolean).join(' · ')
    draftRows.push(
      billRowFromTx({
        txId,
        occurredAt: log.collectionDate ?? log.createdAt,
        actualReceived: log.amount,
        totalReceivable: b.totalAmount,
        txType: 'OFFLINE_VERIFY',
        bill: b,
        contract: b.contract,
        remark: logRemark || '',
        receipt: undefined,
      }),
    )
  }

  for (const b of paidBills) {
    if (!b.paidAt) continue
    if (b._count.offlineVerifyLogs > 0) continue
    const storeId = b.contract.house.apartment.storeId
    if (!canAccessStore(storeId)) continue
    if (isContractBillingPaused(b.contract)) continue
    if (filters.storeId && storeId !== filters.storeId) continue
    if (!dateInRange(b.paidAt, collectedFrom, collectedTo)) continue
    if (filters.periodFrom || filters.periodTo) {
      if (!periodInRange(b.period, filters.periodFrom, filters.periodTo)) continue
    }
    const txId = `bill_${b.id}`
    txIds.push(txId)
    draftRows.push(
      billRowFromTx({
        txId,
        occurredAt: b.paidAt,
        actualReceived: b.amountReceived > 0 ? b.amountReceived : b.totalAmount,
        totalReceivable: b.totalAmount,
        txType: 'BILL_PAYMENT',
        bill: b,
        contract: b.contract,
        remark: '租客线上自助支付',
        receipt: undefined,
      }),
    )
  }

  for (const row of prepayLedgers) {
    const c = row.contractCredit.contract
    const storeId = c.house.apartment.storeId
    if (!canAccessStore(storeId)) continue
    if (isContractBillingPaused(c)) continue
    if (filters.storeId && storeId !== filters.storeId) continue
    if (!dateInRange(row.createdAt, collectedFrom, collectedTo)) continue
    const txId = `prepay_${row.id}`
    txIds.push(txId)
    draftRows.push(
      billRowFromTx({
        txId,
        occurredAt: row.createdAt,
        actualReceived: row.deltaAmount,
        totalReceivable: 0,
        txType: 'PREPAYMENT',
        bill: null,
        contract: c,
        remark: row.remark?.trim() || '合同预收余额入账（线下核销超额）',
        receipt: undefined,
      }),
    )
  }

  for (const r of refunds) {
    const storeId = r.contract.house.apartment.storeId
    if (!canAccessStore(storeId)) continue
    if (filters.storeId && storeId !== filters.storeId) continue
    if (!dateInRange(r.createdAt, collectedFrom, collectedTo)) continue
    const txId = `refund_${r.id}`
    txIds.push(txId)
    draftRows.push(
      billRowFromTx({
        txId,
        occurredAt: r.createdAt,
        actualReceived: -Math.abs(r.amount),
        totalReceivable: 0,
        txType: 'REFUND',
        bill: null,
        contract: r.contract,
        remark: `退款：${r.reason}`,
        receipt: undefined,
      }),
    )
  }

  const receipts =
    txIds.length > 0
      ? await prisma.transactionReceipt.findMany({ where: { transactionId: { in: txIds } } })
      : []
  const receiptMap = new Map(receipts.map((r) => [r.transactionId, r]))

  const rows = draftRows.map((row) => {
    const receipt = receiptMap.get(row.txId)
    if (!receipt) return row
    const txType = row.txId.startsWith('refund_')
      ? 'REFUND'
      : row.txId.startsWith('offlog_')
        ? 'OFFLINE_VERIFY'
        : row.txId.startsWith('prepay_')
          ? 'PREPAYMENT'
          : 'BILL_PAYMENT'
    const status = settlementStatus(txType, receipt)
    return {
      ...row,
      settlementStatus: status,
      settlementEntryDate: status === '待结算' ? '' : row.settlementEntryDate,
    }
  })

  rows.sort((a, b) => (a.paidAt < b.paidAt ? 1 : a.paidAt > b.paidAt ? -1 : 0))

  const summary = rows.reduce(
    (s, r) => {
      s.txCount += 1
      s.totalActualReceived += r.actualReceived
      s.totalReceivable += r.totalReceivable
      return s
    },
    { txCount: 0, totalActualReceived: 0, totalReceivable: 0 },
  )

  return { rows, summary }
}
