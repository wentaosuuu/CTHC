import type { Prisma, PrismaClient } from '@prisma/client'
import { buildRentBillSchedule } from './rentBillSchedule.js'

export type ManualInteractionMode = 'SIGN_AND_PAY' | 'BILL_ONLY' | 'NONE'
export type ManualFlowStage = 'READY_TO_SEND' | 'SIGNING' | 'MATERIALS_PENDING' | 'WAIT_PAYMENT' | 'ACTIVE'
export type ManualFlow = { version: 1; mode: ManualInteractionMode; stage: ManualFlowStage; pushedAt?: string; signedAt?: string }
const FLOW_KEY = '_prototypeManualFlow'

export function readManualFlow(json: string | null | undefined): ManualFlow | null {
  try {
    const raw = JSON.parse(json || '{}')?.[FLOW_KEY] as Partial<ManualFlow> | undefined
    if (raw?.version === 1 && ['SIGN_AND_PAY', 'BILL_ONLY', 'NONE'].includes(raw.mode || '') && ['READY_TO_SEND', 'SIGNING', 'MATERIALS_PENDING', 'WAIT_PAYMENT', 'ACTIVE'].includes(raw.stage || '')) return raw as ManualFlow
  } catch { /* 历史模板数据保持原行为。 */ }
  return null
}

export function manualFlowVisibleToTenant(json: string | null | undefined): boolean {
  const flow = readManualFlow(json)
  return !flow || (flow.mode !== 'NONE' && flow.stage !== 'MATERIALS_PENDING' && flow.stage !== 'READY_TO_SEND')
}

export function writeManualFlow(json: string | null | undefined, flow: ManualFlow): string {
  let data: Record<string, unknown> = {}
  try { const parsed = JSON.parse(json || '{}') as unknown; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown> } catch { /* 空配置 */ }
  return JSON.stringify({ ...data, [FLOW_KEY]: flow })
}

export function preserveManualFlow(previous: string | null, next: string | null): string | null {
  const flow = readManualFlow(previous)
  return flow ? writeManualFlow(next, flow) : next
}

export function manualFlowDto(json: string | null, status: string) {
  const flow = readManualFlow(json)
  const pending = status === 'WAIT_TENANT_SIGN'
  return { interactionMode: flow?.mode ?? null, manualFlowStage: flow?.stage ?? null,
    tenantInteractionLabel: flow ? ({ SIGN_AND_PAY: '推送租户签字并付款', BILL_ONLY: '线下已签，仅推账单', NONE: '仅记录，不推送租户' })[flow.mode] : null,
    canPushSignature: Boolean(flow?.mode === 'SIGN_AND_PAY' && flow.stage === 'READY_TO_SEND' && pending),
    canCompleteMaterials: Boolean(flow?.mode === 'BILL_ONLY' && flow.stage === 'MATERIALS_PENDING' && pending),
    canSimulateSigned: Boolean(flow?.mode === 'SIGN_AND_PAY' && flow.stage === 'SIGNING' && pending),
    canSimulatePaid: Boolean(flow && flow.mode !== 'NONE' && flow.stage === 'WAIT_PAYMENT' && status === 'PENDING_PAYMENT') }
}

type BillContract = { id: string; startDate: Date; rentMonthly: number; deposit: number; rentCycle: string; rentDueDay: number }
export async function createManualFlowBills(tx: Prisma.TransactionClient, contract: BillContract, leaseMonths: number, firstOnly: boolean) {
  const schedule = buildRentBillSchedule({ startDate: contract.startDate, leaseMonths, rentMonthly: contract.rentMonthly, rentCycle: contract.rentCycle, rentDueDay: contract.rentDueDay })
  const periods = firstOnly ? schedule.slice(0, 1) : schedule
  for (const period of periods) await tx.bill.upsert({ where: { contractId_period_kind: { contractId: contract.id, period: period.period, kind: 'BASE' } },
    create: { contractId: contract.id, period: period.period, kind: 'BASE', dueDate: period.dueDate, totalAmount: period.totalAmount,
      items: { create: { name: `房租（${period.period}）`, amount: period.totalAmount } } }, update: {} })
  const first = schedule[0]
  if (first && contract.deposit > 0) await tx.bill.upsert({ where: { contractId_period_kind: { contractId: contract.id, period: first.period, kind: 'ADJUSTMENT' } },
    create: { contractId: contract.id, period: first.period, kind: 'ADJUSTMENT', dueDate: first.dueDate, totalAmount: contract.deposit,
      billingRemark: '首期押金', items: { create: { name: '履约担保金/住房保证金', amount: contract.deposit } } }, update: {} })
}

export type ManualFlowAction = 'PUSH_SIGNATURE' | 'COMPLETE_MATERIALS' | 'SIMULATE_SIGNED' | 'SIMULATE_PAID'
/** 只用于本地原型流程，绝不调用契约锁、短信或真实支付。 */
export async function advanceManualFlow(prisma: PrismaClient, contractId: string, action: ManualFlowAction) {
  return prisma.$transaction(async (tx) => {
    const contract = await tx.contract.findUnique({ where: { id: contractId }, include: { order: { include: { lines: true } } } })
    if (!contract) throw new Error('NOT_FOUND')
    const flow = readManualFlow(contract.contractTemplateDataJson)
    if (!flow) throw new Error('MANUAL_FLOW_NOT_AVAILABLE')
    const actions = manualFlowDto(contract.contractTemplateDataJson, contract.status)
    const now = new Date()
    let next: ManualFlow = flow
    if (action === 'PUSH_SIGNATURE') {
      if (!actions.canPushSignature) throw new Error('MANUAL_FLOW_INVALID_STAGE')
      next = { ...flow, stage: 'SIGNING', pushedAt: now.toISOString() }
    } else if (action === 'COMPLETE_MATERIALS' || action === 'SIMULATE_SIGNED') {
      if (action === 'COMPLETE_MATERIALS' ? !actions.canCompleteMaterials : !actions.canSimulateSigned) throw new Error('MANUAL_FLOW_INVALID_STAGE')
      if (action === 'COMPLETE_MATERIALS') {
        let attachments: unknown = []
        try { attachments = JSON.parse(contract.attachmentsJson || '[]') } catch { /* 缺少文件 */ }
        if (!Array.isArray(attachments) || !attachments.length) throw new Error('SIGNED_CONTRACT_ATTACHMENT_REQUIRED')
      }
      await createManualFlowBills(tx, contract, contract.order.leaseMonths, true)
      next = { ...flow, stage: 'WAIT_PAYMENT', signedAt: now.toISOString() }
      await tx.contract.update({ where: { id: contract.id }, data: { status: 'PENDING_PAYMENT', confirmedAt: now, signedAt: now, stampedAt: now,
        billPushToTenant: true, billPushStatus: 'PENDING_TENANT' } })
    } else {
      if (!actions.canSimulatePaid) throw new Error('MANUAL_FLOW_INVALID_STAGE')
      const bills = await tx.bill.findMany({ where: { contractId, status: { in: ['UNPAID', 'OVERDUE'] } } })
      if (!bills.length) throw new Error('MANUAL_FLOW_BILLS_REQUIRED')
      if (bills.some((bill) => bill.amountReceived > 0)) throw new Error('MANUAL_FLOW_PARTIAL_COLLECTION')
      await tx.bill.updateMany({ where: { id: { in: bills.map((bill) => bill.id) } }, data: { status: 'PAID', paidAt: now } })
      for (const bill of bills) await tx.bill.update({ where: { id: bill.id }, data: { amountReceived: bill.totalAmount } })
      await tx.payment.create({ data: { contractId, amount: bills.reduce((sum, bill) => sum + bill.totalAmount, 0), status: 'PAID', paidAt: now } })
      await tx.contract.update({ where: { id: contractId }, data: { status: 'ACTIVE' } })
      const ids = contract.order.lines.length ? contract.order.lines.filter((line) => !line.releasedAt).map((line) => line.houseId) : [contract.houseId]
      await tx.house.updateMany({ where: { id: { in: ids } }, data: { status: 'SIGNED' } })
      next = { ...flow, stage: 'ACTIVE' }
    }
    const updated = await tx.contract.update({ where: { id: contractId }, data: { contractTemplateDataJson: writeManualFlow(contract.contractTemplateDataJson, next) } })
    return { ok: true, status: updated.status, ...manualFlowDto(updated.contractTemplateDataJson, updated.status), localSimulation: true }
  })
}
