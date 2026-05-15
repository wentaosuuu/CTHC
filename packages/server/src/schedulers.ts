import cron from 'node-cron'
import type { PrismaClient } from '@prisma/client'
import { ensureHousingReportRecord, performHousingReportNow } from './services/housingReport.js'

export function startSchedulers(prisma: PrismaClient) {
  // 每 10 分钟：处理 24 小时未支付的合同 -> 作废并释放房源
  cron.schedule('*/10 * * * *', async () => {
    const deadline = new Date(Date.now() - 24 * 3600 * 1000)
    const expired = await prisma.contract.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        // 支付倒计时从“盖章完成”开始更贴合业务；若没有 stampedAt 则兜底用 createdAt
        OR: [{ stampedAt: { lt: deadline } }, { stampedAt: null, createdAt: { lt: deadline } }],
      },
      select: { id: true, houseId: true },
      take: 200,
    })
    for (const c of expired) {
      await prisma.contract.update({
        where: { id: c.id },
        data: { status: 'VOID', voidedAt: new Date() },
      })
      await prisma.house.update({ where: { id: c.houseId }, data: { status: 'VACANT' } })
    }
  })

  // 每天凌晨 2 点：对“已生效但未成功报备”的合同执行报备（模拟）
  cron.schedule('0 2 * * *', async () => {
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

