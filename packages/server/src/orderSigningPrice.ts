import type { Prisma } from '@prisma/client'
import { buildRentBillSchedule } from './rentBillSchedule.js'

export type SubmittedSigningPrice = { houseId: string; rentMonthly: number; minimumRentSnapshot: number }

/** 下限来自后台原型的资产配置快照，不将客户端快照当作生产定价的权威来源。 */
export function signingPriceError(expectedHouseIds: string[], prices: SubmittedSigningPrice[]): string | null {
  const ids = new Set(prices.map((price) => price.houseId))
  if (ids.size !== prices.length || ids.size !== expectedHouseIds.length || expectedHouseIds.some((id) => !ids.has(id))) return 'ORDER_PRICE_HOUSES_MISMATCH'
  let total = 0
  for (const price of prices) {
    if (!Number.isSafeInteger(price.rentMonthly) || price.rentMonthly <= 0 || price.rentMonthly > 2147483647) return 'INVALID_SIGNING_RENT'
    if (!Number.isFinite(price.minimumRentSnapshot) || price.minimumRentSnapshot < 0) return 'INVALID_MINIMUM_RENT'
    if (price.rentMonthly < Math.ceil(price.minimumRentSnapshot)) return 'SIGNING_RENT_BELOW_MINIMUM'
    total += price.rentMonthly
  }
  return total <= 2147483647 ? null : 'INVALID_SIGNING_RENT'
}

export function repriceContractTemplateSnapshot(json: string | null, prices: SubmittedSigningPrice[]): string | null {
  if (!json) return json
  let raw: Record<string, unknown>
  try { raw = JSON.parse(json) as Record<string, unknown> } catch { return json }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.houses)) return json
  const map = new Map(prices.map((price) => [price.houseId, price.rentMonthly]))
  const total = prices.reduce((sum, price) => sum + price.rentMonthly, 0)
  raw.houses = raw.houses.map((house: Record<string, unknown>) => ({ ...house, rentMonthly: map.get(String(house.id)) ?? house.rentMonthly }))
  if (raw.template === 'NANNING_HOUSING') { raw.monthlyRent = String(total); raw.monthlyRentTouched = false }
  let previous = total
  if (Array.isArray(raw.rentEscalations)) raw.rentEscalations = raw.rentEscalations.map((row: Record<string, unknown>, index: number) => {
    const increment = Number(row.incrementValue || 0)
    if (index > 0 && Number.isFinite(increment)) {
      if (row.incrementType === 'PERCENT') previous = Math.round(previous * (1 + increment / 100))
      else if (row.incrementType === 'FIXED') previous = Math.round(previous + increment)
    }
    return { ...row, monthlyRent: previous }
  })
  return JSON.stringify(raw)
}

/** 只调整原有未收款基础账单的租金差额，保留账单 ID、其他费用和既有期间。 */
export async function repriceUnpaidBaseBills(tx: Prisma.TransactionClient, params: {
  contractId: string; orderId: string; startDate: Date; leaseMonths: number; oldRent: number; newRent: number; rentCycle: string; rentDueDay: number
}) {
  const schedule = (rentMonthly: number) => buildRentBillSchedule({ startDate: params.startDate,
    leaseMonths: params.leaseMonths, rentMonthly, rentCycle: params.rentCycle, rentDueDay: params.rentDueDay })
  const oldAmounts = new Map(schedule(params.oldRent).map((row) => [row.period, row.totalAmount]))
  const newAmounts = new Map(schedule(params.newRent).map((row) => [row.period, row.totalAmount]))
  const lines = await tx.orderLine.findMany({ where: { orderId: params.orderId, releasedAt: null }, include: { house: { include: { apartment: true } } } })
  const linePrices = new Map(lines.map((line) => [`${line.house.apartment.name} · ${line.house.houseNo}`, line.rentMonthlySnapshot]))
  const bills = await tx.bill.findMany({ where: { contractId: params.contractId, kind: 'BASE' }, include: { items: true } })
  for (const bill of bills) {
    if (bill.amountReceived > 0 || bill.status === 'PAID' || bill.paidAt) throw new Error('ORDER_PRICE_HAS_COLLECTION')
    const oldRent = oldAmounts.get(bill.period)
    const newRent = newAmounts.get(bill.period)
    if (oldRent === undefined || newRent === undefined || bill.totalAmount < oldRent) throw new Error('ORDER_PRICE_BILL_REVIEW_REQUIRED')
    // 保存原有非租金差额，不重建账单或覆盖核销资料。
    const totalAmount = bill.totalAmount - oldRent + newRent
    if (totalAmount < 0) throw new Error('ORDER_PRICE_BILL_REVIEW_REQUIRED')
    await tx.bill.update({ where: { id: bill.id }, data: { totalAmount } })
    const rentItems = bill.items.filter((item) => {
      if (item.name.startsWith('房租（')) return true
      try { return (JSON.parse(item.breakdownJson || '[]') as { label?: string }[]).some((row) => row.label === '月租') } catch { return false }
    })
    if (rentItems.length) {
      let assigned = 0
      for (let index = 0; index < rentItems.length; index += 1) {
        const item = rentItems[index]!
        const monthlyAmount = linePrices.get(item.name)
        if (rentItems.length > 1 && monthlyAmount === undefined) throw new Error('ORDER_PRICE_BILL_REVIEW_REQUIRED')
        const amount = index === rentItems.length - 1 ? newRent - assigned : Math.round(newRent * (monthlyAmount ?? params.newRent) / params.newRent)
        assigned += amount
        await tx.billItem.update({ where: { id: item.id }, data: { amount, breakdownJson: JSON.stringify([{ label: '月租', amount }]) } })
      }
    }
  }
}
