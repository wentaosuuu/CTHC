export function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

export function addMonths(d: Date, months: number) {
  const dt = new Date(d.getTime())
  dt.setUTCMonth(dt.getUTCMonth() + months)
  return dt
}

export function fmtPeriod(d: Date) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function toYmd(d: Date) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** UTC 日历日的 0 点（与 Prisma 存库日期字段对齐比较） */
export function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** 续签最早可发起日：合同到期日往前推 2 个月（与 addMonths 一致） */
export function renewEarliestStartDate(contractEndDate: Date) {
  return addMonths(contractEndDate, -2)
}

/** 当前是否已进入「到期前 2 个月」续签窗口（含窗口首日） */
export function isRenewWithinTwoMonthWindow(contractEndDate: Date, now = new Date()) {
  return startOfUtcDay(now).getTime() >= startOfUtcDay(renewEarliestStartDate(contractEndDate)).getTime()
}

