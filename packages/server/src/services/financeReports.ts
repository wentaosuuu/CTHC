import type { PrismaClient } from '@prisma/client'
import { isContractBillingPaused } from '../contractBilling.js'
import { houseBizId } from '../houseBizId.js'
import { toYmd } from '../time.js'

export type ReportFilters = {
  storeId?: string
  periodFrom?: string
  periodTo?: string
  collectedFrom?: string
  collectedTo?: string
}

function periodInRange(period: string, from?: string, to?: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(period)) return false
  if (from && period < from) return false
  if (to && period > to) return false
  return true
}

function dateInRange(iso: Date, fromYmd?: string, toYmdStr?: string): boolean {
  const ymd = toYmd(iso)
  if (fromYmd && ymd < fromYmd) return false
  if (toYmdStr && ymd > toYmdStr) return false
  return true
}

const billInclude = {
  contract: {
    include: {
      tenant: true,
      house: { include: { apartment: { include: { store: true } } } },
    },
  },
} as const

export async function buildReceivableReport(prisma: PrismaClient, filters: ReportFilters, canAccessStore: (id: string) => boolean) {
  const bills = await prisma.bill.findMany({
    include: billInclude,
    orderBy: [{ period: 'desc' }, { dueDate: 'asc' }],
    take: 3000,
  })

  const rows = bills
    .filter((b) => {
      const storeId = b.contract.house.apartment.storeId
      if (!canAccessStore(storeId)) return false
      if (isContractBillingPaused(b.contract)) return false
      if (filters.storeId && storeId !== filters.storeId) return false
      if (!periodInRange(b.period, filters.periodFrom, filters.periodTo)) return false
      return true
    })
    .map((b) => {
      const h = b.contract.house
      const remaining = Math.max(0, b.totalAmount - b.amountReceived)
      return {
        billId: b.id,
        storeId: h.apartment.storeId,
        storeName: h.apartment.store.name,
        apartmentName: h.apartment.name,
        houseNo: h.houseNo,
        houseBizId: houseBizId(h.id),
        contractNo: b.contract.contractNo,
        tenantName: b.contract.tenant.name,
        tenantPhone: b.contract.tenant.phone,
        period: b.period,
        dueDate: toYmd(b.dueDate),
        totalAmount: b.totalAmount,
        amountReceived: b.amountReceived,
        amountRemaining: remaining,
        status: b.status,
      }
    })

  const summary = rows.reduce(
    (s, r) => {
      s.billCount += 1
      s.totalReceivable += r.totalAmount
      s.totalReceived += r.amountReceived
      s.totalRemaining += r.amountRemaining
      if (r.status === 'PAID') s.paidCount += 1
      else if (r.status === 'OVERDUE') s.overdueCount += 1
      else s.unpaidCount += 1
      return s
    },
    {
      billCount: 0,
      totalReceivable: 0,
      totalReceived: 0,
      totalRemaining: 0,
      paidCount: 0,
      unpaidCount: 0,
      overdueCount: 0,
    },
  )

  return { rows, summary }
}

export async function buildCollectedReport(prisma: PrismaClient, filters: ReportFilters, canAccessStore: (id: string) => boolean) {
  const collectedFrom = filters.collectedFrom
  const collectedTo = filters.collectedTo

  const logs = await prisma.billOfflineVerifyLog.findMany({
    include: {
      bill: { include: billInclude },
    },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  })

  const paidBills = await prisma.bill.findMany({
    where: { status: 'PAID', paidAt: { not: null } },
    include: {
      ...billInclude,
      _count: { select: { offlineVerifyLogs: true } },
    },
    orderBy: { paidAt: 'desc' },
    take: 1500,
  })

  type Row = {
    id: string
    occurredAt: string
    channel: 'ONLINE' | 'OFFLINE'
    channelLabel: string
    amount: number
    storeId: string
    storeName: string
    apartmentName: string
    houseNo: string
    houseBizId: string
    contractNo: string
    tenantName: string
    period: string
    dueDate: string
    note: string
  }

  const rows: Row[] = []

  for (const log of logs) {
    const b = log.bill
    if (isContractBillingPaused(b.contract)) continue
    const storeId = b.contract.house.apartment.storeId
    if (!canAccessStore(storeId)) continue
    if (filters.storeId && storeId !== filters.storeId) continue
    if (!dateInRange(log.createdAt, collectedFrom, collectedTo)) continue
    if (filters.periodFrom || filters.periodTo) {
      if (!periodInRange(b.period, filters.periodFrom, filters.periodTo)) continue
    }
    const h = b.contract.house
    rows.push({
      id: `offline-${log.id}`,
      occurredAt: log.createdAt.toISOString(),
      channel: 'OFFLINE',
      channelLabel: '线下核销',
      amount: log.amount,
      storeId,
      storeName: h.apartment.store.name,
      apartmentName: h.apartment.name,
      houseNo: h.houseNo,
      houseBizId: houseBizId(h.id),
      contractNo: b.contract.contractNo,
      tenantName: b.contract.tenant.name,
      period: b.period,
      dueDate: toYmd(b.dueDate),
      note: (log.remark ?? '').trim() || '—',
    })
  }

  for (const b of paidBills) {
    if (!b.paidAt) continue
    if (b._count.offlineVerifyLogs > 0) continue
    if (isContractBillingPaused(b.contract)) continue
    const storeId = b.contract.house.apartment.storeId
    if (!canAccessStore(storeId)) continue
    if (filters.storeId && storeId !== filters.storeId) continue
    if (!dateInRange(b.paidAt, collectedFrom, collectedTo)) continue
    if (filters.periodFrom || filters.periodTo) {
      if (!periodInRange(b.period, filters.periodFrom, filters.periodTo)) continue
    }
    const h = b.contract.house
    rows.push({
      id: `online-${b.id}`,
      occurredAt: b.paidAt.toISOString(),
      channel: 'ONLINE',
      channelLabel: '线上支付',
      amount: b.amountReceived > 0 ? b.amountReceived : b.totalAmount,
      storeId,
      storeName: h.apartment.store.name,
      apartmentName: h.apartment.name,
      houseNo: h.houseNo,
      houseBizId: houseBizId(h.id),
      contractNo: b.contract.contractNo,
      tenantName: b.contract.tenant.name,
      period: b.period,
      dueDate: toYmd(b.dueDate),
      note: '租客线上整笔支付',
    })
  }

  rows.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))

  const summary = rows.reduce(
    (s, r) => {
      s.txCount += 1
      s.totalCollected += r.amount
      if (r.channel === 'ONLINE') {
        s.onlineCount += 1
        s.onlineAmount += r.amount
      } else {
        s.offlineCount += 1
        s.offlineAmount += r.amount
      }
      return s
    },
    {
      txCount: 0,
      totalCollected: 0,
      onlineCount: 0,
      onlineAmount: 0,
      offlineCount: 0,
      offlineAmount: 0,
    },
  )

  return { rows, summary }
}
