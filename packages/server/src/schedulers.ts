import cron from 'node-cron'
import type { PrismaClient } from '@prisma/client'
import {
  DEMO_SEAL_DELAY_MS,
  MS_DAY,
  MS_HOUR,
  voidContractReleaseHouseAndCancelOrder,
} from './contractLifecycle.js'
import { ensureHousingReportRecord, performHousingReportNow } from './services/housingReport.js'
import { shouldClearBillingPause } from './contractBilling.js'
import { syncExpiredActiveContractHouses } from './contractExpiry.js'

export function startSchedulers(prisma: PrismaClient) {
  // 每分钟：待签字超时作废、演示电子章自动盖章、盖章后 24h 未付首期作废
  cron.schedule('* * * * *', async () => {
    const now = new Date()
    const payExpiredBefore = new Date(now.getTime() - 24 * MS_HOUR)

    const signExpired = await prisma.contract.findMany({
      where: {
        status: 'WAIT_TENANT_SIGN',
        OR: [
          { tenantSignDeadlineAt: { lt: now } },
          { tenantSignDeadlineAt: null, createdAt: { lt: new Date(now.getTime() - 3 * MS_DAY) } },
        ],
      },
      select: { id: true },
      take: 200,
    })
    for (const c of signExpired) {
      await voidContractReleaseHouseAndCancelOrder(
        prisma,
        c.id,
        '未在约定期限内完成确认与签字，订单已失效',
      )
    }

    const awaitingDemoSeal = await prisma.contract.findMany({
      where: {
        status: 'WAIT_STAMP',
        stampedAt: null,
        confirmedAt: { not: null },
      },
      select: { id: true, confirmedAt: true },
      take: 200,
    })
    for (const c of awaitingDemoSeal) {
      if (!c.confirmedAt) continue
      if (now.getTime() < c.confirmedAt.getTime() + DEMO_SEAL_DELAY_MS) continue
      await prisma.contract.update({
        where: { id: c.id },
        data: { stampedAt: now, status: 'PENDING_PAYMENT' },
      })
    }

    const payExpired = await prisma.contract.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        stampedAt: { not: null },
        OR: [
          {
            renewedFromId: null,
            stampedAt: { lt: payExpiredBefore },
          },
          {
            renewedFromId: { not: null },
            OR: [{ tenantSignDeadlineAt: { lt: now } }, { stampedAt: { lt: payExpiredBefore } }],
          },
        ],
      },
      select: { id: true, renewedFromId: true },
      take: 200,
    })
    for (const c of payExpired) {
      await voidContractReleaseHouseAndCancelOrder(
        prisma,
        c.id,
        c.renewedFromId
          ? '续签新合同：未在起租首日起 24 小时内完成首期款，合同已作废'
          : '盖章后24小时内未支付首期款，合同已作废',
      )
    }
  })

  // 每天凌晨 2 点：到期合同房源置空置、计费恢复、报备
  cron.schedule('0 2 * * *', async () => {
    await syncExpiredActiveContractHouses(prisma)
    const billingResumeCandidates = await prisma.contract.findMany({
      where: { billingPausedAt: { not: null }, billingResumeFrom: { not: null } },
      select: { id: true, billingPausedAt: true, billingResumeFrom: true },
      take: 500,
    })
    for (const c of billingResumeCandidates) {
      if (shouldClearBillingPause(c)) {
        await prisma.contract.update({
          where: { id: c.id },
          data: { billingPausedAt: null, billingResumeFrom: null },
        })
      }
    }

    const actives = await prisma.contract.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
      take: 500,
    })
    for (const c of actives) {
      await ensureHousingReportRecord(prisma, c.id)
    }

    const pending = await prisma.housingReport.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] } },
      select: { contractId: true },
      take: 200,
    })
    for (const r of pending) {
      await performHousingReportNow(prisma, r.contractId)
    }
  })
}
