import type { Express, Request, RequestHandler } from 'express'
import type { PrismaClient } from '@prisma/client'
import { buildDepositRefundOptions } from './depositRefund.js'

/**
 * 工作台退押队列为只读视图：已终止合同 + 原退押算法的可退余额 > 0。
 * 认证中间件及门店范围由原业务路由传入，不建立第二套权限规则。
 */
export function registerWorkbenchRefundRoutes(
  app: Express,
  prisma: PrismaClient,
  authorize: RequestHandler,
  accessibleStoreIds: (request: Request) => string[] | null,
) {
  app.get('/api/admin/workbench/deposit-refunds', authorize, async (req, res) => {
    try {
      const storeIds = accessibleStoreIds(req)
      const contracts = await prisma.contract.findMany({
        where: {
          status: 'TERMINATED',
          ...(storeIds === null ? {} : { house: { apartment: { storeId: { in: storeIds } } } }),
        },
        select: {
          id: true, contractNo: true, deposit: true, changeHouseFromId: true,
          tenant: { select: { name: true } },
          house: { select: {
            projectName: true, houseNo: true,
            apartment: { select: { name: true, store: { select: { name: true } } } },
          } },
          // 与既有退押页面同口径：仅累计“退押金”业务的退款，负数不冲抵已退金额。
          refunds: { where: { reason: { startsWith: '退押金' } }, select: { amount: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
      const items = contracts.flatMap(contract => {
        const refundedAmount = contract.refunds.reduce((sum, refund) => sum + Math.max(0, refund.amount), 0)
        const { maxRefundable } = buildDepositRefundOptions({
          contractDeposit: contract.deposit, refundedAmount,
          changeHouseFromId: contract.changeHouseFromId,
          // 来源勾选不改变可退余额，工作台不读取无关账单/支付明细。
          bills: [], payments: [],
        })
        return maxRefundable > 0 ? [{
          id: contract.id, contractNo: contract.contractNo, status: 'TERMINATED', maxRefundable,
          tenant: contract.tenant,
          house: {
            projectName: contract.house.projectName, houseNo: contract.house.houseNo,
            apartmentName: contract.house.apartment.name, storeName: contract.house.apartment.store.name,
          },
        }] : []
      })
      res.json({ items })
    } catch {
      res.status(500).json({ error: '退押金待办暂时无法读取，请重试。' })
    }
  })
}
