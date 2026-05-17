/** 待付首期：盖章后 24h；续签合同与「起租首日起 24h」整体截止取较早者 */
export function pendingFirstPayDeadlineMs(contract: {
  stampedAt: string | null
  renewedFromId?: string | null
  tenantSignDeadlineAt: string | null
}): number | null {
  if (!contract.stampedAt) return null
  const stampMs = new Date(contract.stampedAt).getTime()
  if (Number.isNaN(stampMs)) return null
  const stampEnd = stampMs + 24 * 3600 * 1000
  if (contract.renewedFromId && contract.tenantSignDeadlineAt) {
    const cap = new Date(contract.tenantSignDeadlineAt).getTime()
    if (!Number.isNaN(cap)) return Math.min(stampEnd, cap)
  }
  return stampEnd
}

/** 用于付款等「几小时内」展示：HH:MM:SS */
export function formatCountdownHms(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/** 合同确认阶段：≥1 天时用「X天Y小时」，否则 HH:MM:SS */
export function formatSignCountdownShort(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(totalSeconds / 86400)
  const h = Math.floor((totalSeconds % 86400) / 3600)
  if (d >= 1) return `${d}天${h}小时`
  return formatCountdownHms(ms)
}
