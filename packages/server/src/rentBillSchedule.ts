import { addMonths, fmtPeriod, startOfMonth } from './time.js'

export function rentCycleMonths(cycle: string): number {
  switch (cycle) {
    case 'BIMONTHLY':
      return 2
    case 'QUARTERLY':
      return 3
    case 'SEMIANNUAL':
      return 6
    case 'YEARLY':
      return 12
    default:
      return 1
  }
}

/** 将交租日钳制到当月有效日历日（如 2 月 30 → 2 月 28/29） */
export function clampRentDueDay(year: number, month: number, day: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return Math.min(Math.max(1, day), last)
}

/** 某一交租周期起始月 + 交租日 → 应付日 */
export function rentDueDateForPeriodStart(periodStartMonth: Date, rentDueDay: number): Date {
  const y = periodStartMonth.getUTCFullYear()
  const m = periodStartMonth.getUTCMonth()
  const d = clampRentDueDay(y, m, rentDueDay)
  return new Date(Date.UTC(y, m, d))
}

export type RentBillPeriod = {
  period: string
  dueDate: Date
  totalAmount: number
  monthsInPeriod: number
}

/**
 * 按缴费周期生成租金账单计划。
 * - rentCycle 决定「几月一付」；
 * - rentDueDay 为每个交租周期起始月内的应交日（1–31，不足当月天数时取月末）。
 */
export function buildRentBillSchedule(params: {
  startDate: Date
  leaseMonths: number
  rentMonthly: number
  rentCycle: string
  rentDueDay: number
}): RentBillPeriod[] {
  const { startDate, leaseMonths, rentMonthly, rentCycle, rentDueDay } = params
  const day = Math.min(31, Math.max(1, Math.round(rentDueDay)))
  const step = rentCycleMonths(rentCycle)
  const anchor = startOfMonth(startDate)
  const out: RentBillPeriod[] = []

  for (let offset = 0; offset < leaseMonths; offset += step) {
    const periodStart = addMonths(anchor, offset)
    const monthsInPeriod = Math.min(step, leaseMonths - offset)
    out.push({
      period: fmtPeriod(periodStart),
      dueDate: rentDueDateForPeriodStart(periodStart, day),
      totalAmount: rentMonthly * monthsInPeriod,
      monthsInPeriod,
    })
  }
  return out
}

export function rentDueDayFromDate(d: Date): number {
  return d.getUTCDate()
}

export function normalizeRentDueDay(v: number | null | undefined, fallbackDate?: Date): number {
  if (v != null && v >= 1 && v <= 31) return Math.round(v)
  if (fallbackDate) return rentDueDayFromDate(fallbackDate)
  return 1
}
