// MVP 默认滞纳金规则：账单金额 * 0.1% * 逾期天数
// 后续你提供“客户公式”后，可以把这里替换掉。
export function computePenalty(amount: number, daysOverdue: number) {
  if (daysOverdue <= 0) return 0
  const ratePerDay = 0.001
  return Math.floor(amount * ratePerDay * daysOverdue)
}

