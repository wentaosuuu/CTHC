/** 合同暂停计费：不计入应收报表，停止推送新费用；租客 H5 仍可见历史账单 */

export type ContractBillingPauseFields = {
  billingPausedAt: Date | null
  billingResumeFrom: Date | null
}

export function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** 当前是否处于暂停计费（含「已设定未来恢复日、尚未到日」） */
export function isContractBillingPaused(c: ContractBillingPauseFields, now = new Date()): boolean {
  if (!c.billingPausedAt) return false
  if (c.billingResumeFrom) {
    const resumeDay = startOfUtcDay(c.billingResumeFrom)
    const today = startOfUtcDay(now)
    if (today.getTime() >= resumeDay.getTime()) return false
  }
  return true
}

export function shouldClearBillingPause(c: ContractBillingPauseFields, now = new Date()): boolean {
  if (!c.billingPausedAt || !c.billingResumeFrom) return false
  const resumeDay = startOfUtcDay(c.billingResumeFrom)
  const today = startOfUtcDay(now)
  return today.getTime() >= resumeDay.getTime()
}
