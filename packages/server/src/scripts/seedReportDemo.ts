import type { PrismaClient } from '@prisma/client'

export const REPORT_DEMO_PERIOD = '2026-07'
const DEMO_TAG = '报表演示-2026-07'

type OfflineChannel = 'OFFLINE_QR' | 'TRANSFER' | 'CASH'

type DemoScenario =
  | {
      mode: 'online'
      payDate: string
      total: number
      rent: number
      property: number
    }
  | {
      mode: 'offline_full'
      payDate: string
      channel: OfflineChannel
      total: number
      rent: number
      property: number
      remark?: string
    }
  | {
      mode: 'offline_partial'
      total: number
      rent: number
      property: number
      payments: Array<{ payDate: string; amount: number; channel: OfflineChannel; remark?: string }>
    }
  | {
      mode: 'offline_overpay'
      payDate: string
      channel: OfflineChannel
      total: number
      payAmount: number
      rent: number
      property: number
    }
  | {
      mode: 'unpaid'
      total: number
      rent: number
      property: number
    }
  | {
      mode: 'overdue_unpaid'
      total: number
      rent: number
      property: number
    }

const DEMO_SCENARIOS: DemoScenario[] = [
  { mode: 'online', payDate: '2026-07-03', total: 7050, rent: 6200, property: 350 },
  { mode: 'offline_full', payDate: '2026-07-05', channel: 'TRANSFER', total: 5800, rent: 5100, property: 280, remark: '银行转账，流水号 20260705001' },
  {
    mode: 'offline_partial',
    total: 7200,
    rent: 6400,
    property: 320,
    payments: [
      { payDate: '2026-07-02', amount: 4000, channel: 'TRANSFER', remark: '首期转账' },
      { payDate: '2026-07-08', amount: 3200, channel: 'CASH', remark: '尾款现金' },
    ],
  },
  { mode: 'offline_overpay', payDate: '2026-07-07', channel: 'TRANSFER', total: 6500, payAmount: 7000, rent: 5800, property: 300 },
  { mode: 'unpaid', total: 5500, rent: 4800, property: 260 },
  { mode: 'online', payDate: '2026-07-01', total: 4800, rent: 4200, property: 220 },
  { mode: 'offline_full', payDate: '2026-07-09', channel: 'CASH', total: 8900, rent: 7800, property: 400, remark: '现金收款' },
  {
    mode: 'offline_partial',
    total: 6200,
    rent: 5400,
    property: 280,
    payments: [{ payDate: '2026-07-04', amount: 3000, channel: 'OFFLINE_QR', remark: '线下扫码部分收款' }],
  },
  { mode: 'overdue_unpaid', total: 5000, rent: 4300, property: 250 },
  { mode: 'online', payDate: '2026-07-06', total: 7500, rent: 6600, property: 380 },
  { mode: 'offline_full', payDate: '2026-07-02', channel: 'OFFLINE_QR', total: 5200, rent: 4600, property: 240 },
  { mode: 'online', payDate: '2026-07-08', total: 6800, rent: 6000, property: 320 },
]

function at(ymd: string, hour = 10, minute = 30) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d, hour, minute, 0, 0)
}

function assetNameFromContract(contract: {
  house: { houseNo: string; address: string | null; apartment: { name: string } }
}) {
  const h = contract.house
  return (h.address || '').trim() || `${h.apartment.name} ${h.houseNo}`
}

async function prepareDemoBill(
  prisma: PrismaClient,
  contractId: string,
  data: {
    dueDate: Date
    total: number
    billingRemark: string
    status: 'UNPAID' | 'OVERDUE'
    createdAt: Date
  },
) {
  const bill = await prisma.bill.upsert({
    where: {
      contractId_period_kind: { contractId, period: REPORT_DEMO_PERIOD, kind: 'BASE' },
    },
    create: {
      contractId,
      period: REPORT_DEMO_PERIOD,
      dueDate: data.dueDate,
      totalAmount: data.total,
      amountReceived: 0,
      status: data.status,
      billingRemark: data.billingRemark,
      createdAt: data.createdAt,
    },
    update: {
      dueDate: data.dueDate,
      totalAmount: data.total,
      amountReceived: 0,
      status: data.status,
      paidAt: null,
      offlineVerifiedAt: null,
      offlineVerifiedByAdminId: null,
      offlineVerifiedRemark: null,
      billingRemark: data.billingRemark,
    },
  })
  await prisma.billOfflineVerifyLog.deleteMany({ where: { billId: bill.id } })
  await prisma.contractCreditLedger.deleteMany({ where: { billId: bill.id } })
  return bill
}

async function applyBillItems(prisma: PrismaClient, billId: string, rent: number, property: number, total: number) {
  const water = Math.max(0, total - rent - property)
  const items = [
    { name: '租金', amount: rent },
    { name: '物业费', amount: property },
  ]
  if (water > 0) items.push({ name: '水费', amount: water })
  await prisma.billItem.deleteMany({ where: { billId } })
  await prisma.billItem.createMany({
    data: items.filter((i) => i.amount > 0).map((i) => ({ billId, name: i.name, amount: i.amount })),
  })
}

async function createOfflineLog(
  prisma: PrismaClient,
  params: {
    billId: string
    contractId: string
    amount: number
    channel: OfflineChannel
    payDate: string
    assetName: string
    remark: string
    adminId: string
  },
) {
  const paymentAt = at(params.payDate)
  await prisma.billOfflineVerifyLog.create({
    data: {
      billId: params.billId,
      amount: params.amount,
      collectionChannel: params.channel,
      collectionDate: paymentAt,
      assetName: params.assetName,
      remark: params.remark || null,
      adminId: params.adminId,
      createdAt: paymentAt,
    },
  })

  const bill = await prisma.bill.findUnique({ where: { id: params.billId } })
  if (!bill) return
  const remaining = Math.max(0, bill.totalAmount - bill.amountReceived)
  const applyToBill = Math.min(params.amount, remaining)
  const excess = params.amount - applyToBill
  const nextReceived = Math.min(bill.amountReceived + applyToBill, bill.totalAmount)
  const paidFull = nextReceived >= bill.totalAmount

  if (excess > 0) {
    let creditRow = await prisma.contractCredit.findUnique({ where: { contractId: params.contractId } })
    const prev = creditRow?.balanceAmount ?? 0
    const nextBal = prev + excess
    const saved = creditRow
      ? await prisma.contractCredit.update({ where: { id: creditRow.id }, data: { balanceAmount: nextBal } })
      : await prisma.contractCredit.create({ data: { contractId: params.contractId, balanceAmount: nextBal } })
    await prisma.contractCreditLedger.create({
      data: {
        contractCreditId: saved.id,
        deltaAmount: excess,
        balanceAfterAmount: nextBal,
        kind: 'OVERPAY_OFFLINE',
        billId: params.billId,
        remark: `报表演示超额入账 ¥${excess}`,
        adminId: params.adminId,
      },
    })
  }

  await prisma.bill.update({
    where: { id: params.billId },
    data: {
      amountReceived: nextReceived,
      status: paidFull ? 'PAID' : 'UNPAID',
      paidAt: paidFull ? paymentAt : null,
      offlineVerifiedAt: paymentAt,
      offlineVerifiedByAdminId: params.adminId,
      offlineVerifiedRemark: params.remark || null,
    },
  })
}

export async function seedReportDemoData(prisma: PrismaClient): Promise<{ billCount: number }> {
  const admin = await prisma.admin.findFirst({ where: { email: 'admin@example.com' } })
  if (!admin) {
    // eslint-disable-next-line no-console
    console.warn('seedReportDemoData: 未找到 admin@example.com，请先执行 db:seed')
    return { billCount: 0 }
  }

  const contracts = await prisma.contract.findMany({
    where: {
      status: 'ACTIVE',
      billingPausedAt: null,
    },
    include: {
      tenant: true,
      house: { include: { apartment: { include: { store: true } } } },
    },
    orderBy: { contractNo: 'asc' },
    take: DEMO_SCENARIOS.length,
  })

  if (contracts.length < 6) {
    // eslint-disable-next-line no-console
    console.warn(`seedReportDemoData: 生效合同不足（${contracts.length}），跳过报表演示数据`)
    return { billCount: 0 }
  }

  const useContracts = contracts.slice(0, DEMO_SCENARIOS.length)

  const storePeriodKeys = new Set<string>()
  let created = 0

  for (let i = 0; i < useContracts.length; i += 1) {
    const contract = useContracts[i]!
    const scenario = DEMO_SCENARIOS[i]!
    const storeId = contract.house.apartment.storeId
    storePeriodKeys.add(`${storeId}__${REPORT_DEMO_PERIOD}`)
    const assetName = assetNameFromContract(contract)
    const dueDate =
      scenario.mode === 'overdue_unpaid' ? at('2026-06-15') : at(`${REPORT_DEMO_PERIOD}-10`)

    const bill = await prepareDemoBill(prisma, contract.id, {
      dueDate,
      total: scenario.total,
      billingRemark: `${DEMO_TAG} · ${contract.tenant.name}`,
      status: scenario.mode === 'overdue_unpaid' ? 'OVERDUE' : 'UNPAID',
      createdAt: at(`${REPORT_DEMO_PERIOD}-01`, 9, 0),
    })
    await applyBillItems(prisma, bill.id, scenario.rent, scenario.property, scenario.total)
    created += 1

    if (scenario.mode === 'online') {
      const paidAt = at(scenario.payDate)
      await prisma.bill.update({
        where: { id: bill.id },
        data: {
          amountReceived: scenario.total,
          status: 'PAID',
          paidAt,
        },
      })
    } else if (scenario.mode === 'offline_full') {
      await createOfflineLog(prisma, {
        billId: bill.id,
        contractId: contract.id,
        amount: scenario.total,
        channel: scenario.channel,
        payDate: scenario.payDate,
        assetName,
        remark: scenario.remark || '后台核销收款',
        adminId: admin.id,
      })
    } else if (scenario.mode === 'offline_partial') {
      for (const p of scenario.payments) {
        await createOfflineLog(prisma, {
          billId: bill.id,
          contractId: contract.id,
          amount: p.amount,
          channel: p.channel,
          payDate: p.payDate,
          assetName,
          remark: p.remark || '部分核销',
          adminId: admin.id,
        })
      }
      const refreshed = await prisma.bill.findUnique({ where: { id: bill.id } })
      if (refreshed && refreshed.amountReceived > 0 && refreshed.amountReceived < refreshed.totalAmount) {
        await prisma.bill.update({
          where: { id: bill.id },
          data: { status: 'UNPAID' },
        })
      }
    } else if (scenario.mode === 'offline_overpay') {
      await createOfflineLog(prisma, {
        billId: bill.id,
        contractId: contract.id,
        amount: scenario.payAmount,
        channel: scenario.channel,
        payDate: scenario.payDate,
        assetName,
        remark: '核销超额转预收',
        adminId: admin.id,
      })
    }
  }

  for (const key of storePeriodKeys) {
    const [storeId, period] = key.split('__')
    const sameStoreBills = await prisma.bill.findMany({
      where: {
        period,
        billingRemark: { contains: DEMO_TAG },
        contract: { house: { apartment: { storeId } } },
      },
    })
    if (sameStoreBills.length === 0) continue
    const contractIds = new Set(sameStoreBills.map((x) => x.contractId))
    const totalAmount = sameStoreBills.reduce((s, x) => s + x.totalAmount, 0)
    const dueDates = sameStoreBills.map((x) => x.dueDate).sort((a, b) => a.getTime() - b.getTime())
    const lockedAt = at('2026-07-05', 16, 0)
    await prisma.billPeriod.upsert({
      where: { storeId_period: { storeId, period } },
      create: {
        storeId,
        period,
        lockedAt,
        lockedByAdminId: admin.id,
        snapshotContractCount: contractIds.size,
        snapshotBillCount: sameStoreBills.length,
        snapshotTotalAmount: totalAmount,
        snapshotDueDateFrom: dueDates[0]!,
        snapshotDueDateTo: dueDates[dueDates.length - 1]!,
      },
      update: {
        lockedAt,
        lockedByAdminId: admin.id,
        snapshotContractCount: contractIds.size,
        snapshotBillCount: sameStoreBills.length,
        snapshotTotalAmount: totalAmount,
        snapshotDueDateFrom: dueDates[0]!,
        snapshotDueDateTo: dueDates[dueDates.length - 1]!,
      },
    })
  }

  // eslint-disable-next-line no-console
  console.log(
    `报表演示数据已写入：${REPORT_DEMO_PERIOD} 共 ${created} 笔账单（含线上支付、线下核销、部分收款、预收挂账等场景）。筛选费用归属月 ${REPORT_DEMO_PERIOD}、支付日 2026-07-01～2026-07-09 即可演示。`,
  )
  return { billCount: created }
}

async function runCli() {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  try {
    await seedReportDemoData(prisma)
  } finally {
    await prisma.$disconnect()
  }
}

const isDirectRun = process.argv[1]?.includes('seedReportDemo')
if (isDirectRun) {
  runCli().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    process.exit(1)
  })
}
