import fs from 'fs'
import path from 'path'
import type { Prisma, PrismaClient } from '@prisma/client'
import { syncBaseRentBillItemsForContract } from './billRentItems.js'

/** 退租确认附件（与合同正文附件分目录存放） */
export const MOVEOUT_UPLOAD_ROOT = path.join(process.cwd(), 'data', 'move-out-uploads')

export function ensureMoveOutUploadDir(contractId: string) {
  const dir = path.join(MOVEOUT_UPLOAD_ROOT, contractId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function unlinkMoveOutFiles(contractId: string, attachments: Array<{ file?: string }> | null | undefined) {
  if (!attachments?.length) return
  for (const a of attachments) {
    const key = a?.file
    if (!key || !/^[a-zA-Z0-9._-]+$/.test(key)) continue
    const fp = path.join(MOVEOUT_UPLOAD_ROOT, contractId, key)
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp)
    } catch {
      /* ignore */
    }
  }
}

export type MoveOutPendingAttachment = { id: string; name: string; file: string }

export type MoveOutMoneyItem = {
  id: string
  name: string
  amount: number
  remark: string
}

export type MoveOutInspectionItem = {
  id: string
  name: string
  unit: string
  quantity: number
  moveInStatus: string
  moveOutStatus: string
  compensationQuantity: number
  referencePrice: number
  compensation: number
  remark: string
}

export type MoveOutSettlementSnapshot = {
  settlementType: 'NORMAL_EXPIRY' | 'BREACH_EARLY' | 'SETTLED_EARLY' | 'NEGOTIATED_EARLY'
  stopRentDate: string
  requireTenantConfirmation: boolean
  hygieneStatus: 'PASS' | 'FAIL'
  inspectionItems: MoveOutInspectionItem[]
  paidItems: MoveOutMoneyItem[]
  receivableItems: MoveOutMoneyItem[]
  paidTotal: number
  receivableTotal: number
  refundAmount: number
  amountDue: number
  applicationNote: string
}

export type MoveOutTenantConfirmation = {
  accountName: string
  bankName: string
  /** 开户支行 */
  bankBranch: string
  bankCardNo: string
  /** 联行号（选填） */
  cnapsCode?: string
  /** 开户省市（选填） */
  bankRegion?: string
  phone?: string
  idNumber?: string
  /** 租户确认时间（非电子签字） */
  confirmedAt: string
  /** @deprecated 兼容旧归档字段 */
  signedAt?: string
}

export type MoveOutPendingPayload = {
  version: 1 | 2
  terminateDate: string
  reasonFull: string
  releaseHouseIds: string[]
  partial: boolean
  attachments: MoveOutPendingAttachment[]
  deadlineAt: string
  createdAt: string
  settlement?: MoveOutSettlementSnapshot
}

export type MoveOutArchivePayload = MoveOutPendingPayload & {
  version: 2
  completedAt: string
  completedBy: 'TENANT_CONFIRMED' | 'STORE_DIRECT'
  tenantConfirmation?: MoveOutTenantConfirmation
}

function money(value: number) {
  return Math.round(Math.max(0, Number(value) || 0) * 100) / 100
}

/** 金额合计必须由服务端重算，避免前端篡改审批表结果。 */
export function normalizeMoveOutSettlement(
  settlement: Omit<MoveOutSettlementSnapshot, 'paidTotal' | 'receivableTotal' | 'refundAmount' | 'amountDue'>,
): MoveOutSettlementSnapshot {
  const paidItems = settlement.paidItems.map((item) => ({ ...item, amount: money(item.amount) }))
  const receivableItems = settlement.receivableItems.map((item) => ({ ...item, amount: money(item.amount) }))
  const inspectionItems = settlement.inspectionItems.map((item) => ({
    ...item,
    quantity: money(item.quantity),
    compensationQuantity: money(item.compensationQuantity),
    referencePrice: money(item.referencePrice),
    compensation: money(item.compensation),
  }))
  const paidTotal = money(paidItems.reduce((sum, item) => sum + item.amount, 0))
  const receivableTotal = money(receivableItems.reduce((sum, item) => sum + item.amount, 0))
  return {
    ...settlement,
    paidItems,
    receivableItems,
    inspectionItems,
    paidTotal,
    receivableTotal,
    refundAmount: money(Math.max(paidTotal - receivableTotal, 0)),
    amountDue: money(Math.max(receivableTotal - paidTotal, 0)),
  }
}

/** 执行管理员退租结案（从租客确认后调用，或旧流程；不含清理附件文件） */
export async function executeAdminContractTerminate(
  tx: Prisma.TransactionClient,
  contract: {
    id: string
    houseId: string
    order: {
      id: string
      isMergedBundle: boolean
      lines: {
        houseId: string
        releasedAt: Date | null
        rentMonthlySnapshot: number
        depositSnapshot: number
      }[]
    } | null
  },
  moveAt: Date,
  reasonText: string,
  releaseIdsIn: string[],
): Promise<{ partial: boolean; rentMonthly?: number }> {
  const order = contract.order
  const merged = Boolean(order?.isMergedBundle && order.lines.length > 0)
  const releaseIds = releaseIdsIn.filter(Boolean)
  const partial =
    merged &&
    releaseIds.length > 0 &&
    releaseIds.length < order!.lines.filter((l) => !l.releasedAt).length

  if (merged && releaseIds.length > 0) {
    const activeLines = order!.lines.filter((l) => !l.releasedAt)
    const idSet = new Set(activeLines.map((l) => l.houseId))
    for (const hid of releaseIds) {
      if (!idSet.has(hid)) {
        const err = new Error('INVALID_RELEASE_HOUSE')
        ;(err as { code?: string }).code = 'INVALID_RELEASE_HOUSE'
        throw err
      }
    }
  }

  if (partial) {
    for (const hid of releaseIds) {
      await tx.orderLine.updateMany({
        where: { orderId: order!.id, houseId: hid, releasedAt: null },
        data: { releasedAt: moveAt },
      })
      await tx.house.update({ where: { id: hid }, data: { status: 'VACANT' } })
    }
    const after = await tx.orderLine.findMany({
      where: { orderId: order!.id, releasedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })
    if (after.length === 0) {
      const err = new Error('NO_ACTIVE_LINES')
      ;(err as { code?: string }).code = 'NO_ACTIVE_LINES'
      throw err
    }
    const rentSum = after.reduce((s, l) => s + l.rentMonthlySnapshot, 0)
    const depSum = after.reduce((s, l) => s + l.depositSnapshot, 0)
    const primaryHouseId = after[0]!.houseId
    await tx.contract.update({
      where: { id: contract.id },
      data: {
        houseId: primaryHouseId,
        rentMonthly: rentSum,
        deposit: depSum,
        status: 'ACTIVE',
        moveOutPendingJson: null,
      },
    })
    await syncBaseRentBillItemsForContract(tx, {
      contractId: contract.id,
      orderId: order!.id,
      rentMonthly: rentSum,
    })
    await tx.refund.create({
      data: {
        contractId: contract.id,
        amount: 0,
        reason: `${reasonText}；部分退租子房源 houseId：${releaseIds.join('、')}`,
      },
    })
    return { partial: true, rentMonthly: rentSum }
  }

  await tx.contract.update({
    where: { id: contract.id },
    data: { status: 'TERMINATED', terminatedAt: moveAt, moveOutPendingJson: null },
  })
  if (merged && order) {
    await tx.orderLine.updateMany({
      where: { orderId: order.id, releasedAt: null },
      data: { releasedAt: moveAt },
    })
    for (const l of order.lines) {
      await tx.house.update({ where: { id: l.houseId }, data: { status: 'VACANT' } })
    }
  } else {
    await tx.house.update({ where: { id: contract.houseId }, data: { status: 'VACANT' } })
  }
  await tx.refund.create({
    data: { contractId: contract.id, amount: 0, reason: reasonText },
  })
  return { partial: false }
}

/** 退租确认超时：恢复为在租并删除待确认附件 */
export async function expireTenantMoveOutIfNeeded(prisma: PrismaClient, contractId: string): Promise<void> {
  const c = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true, status: true, moveOutPendingJson: true },
  })
  if (!c || c.status !== 'WAIT_TENANT_MOVEOUT_SIGN' || !c.moveOutPendingJson) return
  let pending: MoveOutPendingPayload
  try {
    pending = JSON.parse(c.moveOutPendingJson) as MoveOutPendingPayload
  } catch {
    return
  }
  const d = pending?.deadlineAt ? new Date(pending.deadlineAt) : null
  if (!d || Number.isNaN(d.getTime()) || d.getTime() > Date.now()) return
  unlinkMoveOutFiles(c.id, pending.attachments)
  await prisma.contract.update({
    where: { id: c.id },
    data: { status: 'ACTIVE', moveOutPendingJson: null },
  })
}
