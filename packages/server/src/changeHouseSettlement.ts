import type { Prisma } from '@prisma/client'
import { toYmd } from './time.js'

export type ChangeHouseMoneySnapshot = {
  version: 1
  moveDateYmd: string
  oldContractId: string
  oldContractNo: string
  /** 旧合同在换房日之后「账期」已付且未消费的 BASE 租金之和 */
  prepaidRentCredit: number
  prepaidRentSources: { period: string; amount: number }[]
  /** 已用结转自动标记为已付的新合同账期 */
  prepaidAppliedToPeriods: { period: string; amount: number }[]
  /** 押金少补（已在换房补差账单中体现）；多不退 */
  depositSupplement: number
  /** 合并合同仅迁出一套时暂不自动结转预付（避免分摊歧义） */
  prepaidSkippedReason: string | null
  ruleSummary: string
}

/** 换房日所在自然月 YYYY-MM（与账单 period 对齐） */
export function moveMonthPeriod(moveEnd: Date): string {
  return toYmd(moveEnd).slice(0, 7)
}

export function computePrepaidRentCredit(
  oldBills: { period: string; kind: string; status: string; totalAmount: number }[],
  moveYm: string,
): { credit: number; sources: { period: string; amount: number }[] } {
  const sources: { period: string; amount: number }[] = []
  let credit = 0
  for (const b of oldBills) {
    if (b.kind !== 'BASE' || b.status !== 'PAID') continue
    if (b.period.length < 7) continue
    if (b.period <= moveYm) continue
    credit += b.totalAmount
    sources.push({ period: b.period, amount: b.totalAmount })
  }
  return { credit, sources }
}

/**
 * 将预付租金结转抵扣到新合同未付 BASE 账单（按账期先后）。
 * 仅处理「整期」抵扣；最后一期若不足以整期抵扣则调减该期应付并保留说明。
 */
export async function applyPrepaidRentCreditToNewContract(
  tx: Prisma.TransactionClient,
  params: { newContractId: string; credit: number },
): Promise<{ applied: { period: string; amount: number }[]; remainingCredit: number }> {
  const applied: { period: string; amount: number }[] = []
  let credit = params.credit
  if (credit <= 0) return { applied, remainingCredit: 0 }

  const baseBills = await tx.bill.findMany({
    where: { contractId: params.newContractId, kind: 'BASE', status: { in: ['UNPAID', 'OVERDUE'] } },
    orderBy: { period: 'asc' },
  })

  for (const b of baseBills) {
    if (credit <= 0) break
    const due = b.totalAmount
    if (credit >= due) {
      await tx.bill.update({
        where: { id: b.id },
        data: { status: 'PAID', paidAt: new Date(), amountReceived: due },
      })
      applied.push({ period: b.period, amount: due })
      credit -= due
    } else {
      const newTotal = due - credit
      await tx.billItem.deleteMany({ where: { billId: b.id } })
      await tx.billItem.create({
        data: {
          billId: b.id,
          name: `房租（${b.period}）｜含换房结转抵扣 ¥${credit}`,
          amount: newTotal,
          breakdownJson: JSON.stringify([
            { label: '换房结转-旧合同预付抵扣', amount: credit },
            { label: '本期应付租金', amount: newTotal },
          ]),
        },
      })
      await tx.bill.update({
        where: { id: b.id },
        data: { totalAmount: newTotal },
      })
      applied.push({ period: b.period, amount: credit })
      credit = 0
      break
    }
  }

  return { applied, remainingCredit: credit }
}

export function buildChangeHouseMoneySnapshot(p: {
  moveDateYmd: string
  moveEnd: Date
  old: { id: string; contractNo: string }
  prepaid: { credit: number; sources: { period: string; amount: number }[] }
  applied: { period: string; amount: number }[]
  remainingCredit: number
  depositSupplement: number
  prepaidSkippedReason: string | null
}): ChangeHouseMoneySnapshot {
  const moveYm = moveMonthPeriod(p.moveEnd)
  const lines: string[] = [
    '换房资金处理（系统说明）',
    `1）旧合同在换房日（${p.moveDateYmd}）前须无欠费账单；`,
    `2）押金「多不退少补」：仅新押金高于迁出侧押金基准时生成补差账单（本单补差 ¥${p.depositSupplement}）；`,
    `3）旧合同在「${moveYm}」之后已付的 BASE 租金账期，视为预付未消费金额，合计 ¥${p.prepaid.credit}，按新合同账期顺序结转抵扣；`,
    `4）新合同生效：须先在账单侧结清换房补差及剩余应付租金，再支付押金（见「去支付」金额）；`,
  ]
  if (p.prepaidSkippedReason) lines.push(`说明：${p.prepaidSkippedReason}`)
  if (p.remainingCredit > 0) lines.push(`提示：尚有 ¥${p.remainingCredit} 未能自动匹配到新合同账期，请人工核对或线下处理。`)

  return {
    version: 1,
    moveDateYmd: p.moveDateYmd,
    oldContractId: p.old.id,
    oldContractNo: p.old.contractNo,
    prepaidRentCredit: p.prepaid.credit,
    prepaidRentSources: p.prepaid.sources,
    prepaidAppliedToPeriods: p.applied,
    depositSupplement: p.depositSupplement,
    prepaidSkippedReason: p.prepaidSkippedReason,
    ruleSummary: lines.join('\n'),
  }
}
