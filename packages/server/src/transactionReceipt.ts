import type { Admin, Prisma, PrismaClient, ReceiptKind, TransactionReceipt } from '@prisma/client'

export type ReceiptDto = {
  transactionId: string
  printCount: number
  status: 'ACTIVE' | 'VOID'
  reprintApproved: boolean
  reprintRequestStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null
  reprintRequestReason: string | null
  reprintRequestedAt: string | null
  reprintReviewRemark: string | null
  voidReason: string | null
  voidedAt: string | null
  lastPrintedAt: string | null
  lastReceiptKind: ReceiptKind | null
  canPrint: boolean
  canRequestReprint: boolean
  canApproveReprint: boolean
  canVoid: boolean
  printBlockedReason: string | null
}

export function isFinanceRole(roleCode: string) {
  return roleCode === 'FINANCE'
}

export function isFinanceOrAdminRole(roleCode: string) {
  return roleCode === 'FINANCE' || roleCode === 'SYSTEM_ADMIN'
}

export function isStoreManagerRole(roleCode: string) {
  return roleCode === 'STORE_MANAGER'
}

/** 全员统一：每条交易流水收据仅可导出 1 次；财务审批通过后可再导出 1 次（消耗审批资格）。已作废的收据可重新开具。 */
export function receiptExportGate(receipt: TransactionReceipt | null): {
  ok: boolean
  reason: string | null
} {
  if (!receipt) return { ok: true, reason: null }
  if (receipt.status === 'VOID') {
    return { ok: true, reason: null }
  }
  if (receipt.printCount === 0) return { ok: true, reason: null }
  if (receipt.reprintApproved) return { ok: true, reason: null }
  if (receipt.reprintRequestStatus === 'PENDING') {
    return { ok: false, reason: '再次导出申请审核中，请等待财务处理' }
  }
  return { ok: false, reason: '已导出过，须向财务申请再次导出并说明原因' }
}

function canRequestReexport(receipt: TransactionReceipt) {
  return (
    receipt.status !== 'VOID' &&
    receipt.printCount >= 1 &&
    !receipt.reprintApproved &&
    receipt.reprintRequestStatus !== 'PENDING'
  )
}

function emptyReceiptDto(transactionId: string, admin: Admin): ReceiptDto {
  return {
    transactionId,
    printCount: 0,
    status: 'ACTIVE',
    reprintApproved: false,
    reprintRequestStatus: null,
    reprintRequestReason: null,
    reprintRequestedAt: null,
    reprintReviewRemark: null,
    voidReason: null,
    voidedAt: null,
    lastPrintedAt: null,
    lastReceiptKind: null,
    canPrint: true,
    canRequestReprint: false,
    canApproveReprint: false,
    canVoid: isFinanceRole(admin.roleCode),
    printBlockedReason: null,
  }
}

export function buildReceiptDto(receipt: TransactionReceipt | null, transactionId: string, admin: Admin): ReceiptDto {
  if (!receipt) return emptyReceiptDto(transactionId, admin)

  const voided = receipt.status === 'VOID'
  const finance = isFinanceRole(admin.roleCode)
  const gate = receiptExportGate(receipt)

  const canPrint = gate.ok
  const printBlockedReason = gate.ok ? null : gate.reason

  const canRequestReprint = canRequestReexport(receipt)
  const canApproveReprint = finance && !voided && receipt.reprintRequestStatus === 'PENDING'
  const canVoid = finance && !voided

  return {
    transactionId: receipt.transactionId,
    printCount: receipt.printCount,
    status: receipt.status,
    reprintApproved: receipt.reprintApproved,
    reprintRequestStatus: receipt.reprintRequestStatus,
    reprintRequestReason: receipt.reprintRequestReason,
    reprintRequestedAt: receipt.reprintRequestedAt?.toISOString() ?? null,
    reprintReviewRemark: receipt.reprintReviewRemark,
    voidReason: receipt.voidReason,
    voidedAt: receipt.voidedAt?.toISOString() ?? null,
    lastPrintedAt: receipt.lastPrintedAt?.toISOString() ?? null,
    lastReceiptKind: receipt.lastReceiptKind,
    canPrint,
    canRequestReprint,
    canApproveReprint,
    canVoid,
    printBlockedReason,
  }
}

export async function loadReceiptMap(prisma: PrismaClient, transactionIds: string[]) {
  if (transactionIds.length === 0) return new Map<string, TransactionReceipt>()
  const rows = await prisma.transactionReceipt.findMany({
    where: { transactionId: { in: transactionIds } },
  })
  return new Map(rows.map((r) => [r.transactionId, r]))
}

export async function ensureReceiptRow(tx: Prisma.TransactionClient, transactionId: string) {
  const existing = await tx.transactionReceipt.findUnique({ where: { transactionId } })
  if (existing) return existing
  return tx.transactionReceipt.create({ data: { transactionId } })
}

export async function printTransactionReceipts(
  prisma: PrismaClient,
  admin: Admin,
  transactionIds: string[],
  receiptKind: ReceiptKind,
) {
  const uniqueIds = [...new Set(transactionIds.filter(Boolean))]
  if (uniqueIds.length === 0) throw new Error('EMPTY_TRANSACTION_IDS')

  const results: { transactionId: string; printCount: number; receipt: ReceiptDto }[] = []

  await prisma.$transaction(async (tx) => {
    for (const transactionId of uniqueIds) {
      const receipt = await ensureReceiptRow(tx, transactionId)
      const dto = buildReceiptDto(receipt, transactionId, admin)
      if (!dto.canPrint) throw new Error(`PRINT_BLOCKED:${transactionId}:${dto.printBlockedReason ?? '不可导出'}`)

      const nextSeq = receipt.printCount + 1
      const now = new Date()
      const wasVoided = receipt.status === 'VOID'

      const updated = await tx.transactionReceipt.update({
        where: { id: receipt.id },
        data: {
          printCount: nextSeq,
          status: 'ACTIVE',
          lastPrintedAt: now,
          lastPrintedByAdminId: admin.id,
          lastReceiptKind: receiptKind,
          reprintApproved: false,
          reprintRequestStatus: wasVoided ? null : receipt.reprintApproved ? null : receipt.reprintRequestStatus,
        },
      })

      await tx.transactionReceiptPrintLog.create({
        data: {
          transactionReceiptId: receipt.id,
          receiptKind,
          printSeq: nextSeq,
          printedByAdminId: admin.id,
          printedByAdminName: admin.name,
          printedByAdminEmail: admin.email,
        },
      })

      results.push({
        transactionId,
        printCount: updated.printCount,
        receipt: buildReceiptDto(updated, transactionId, admin),
      })
    }
  })

  return results
}
