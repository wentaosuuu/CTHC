export const OFFLINE_COLLECTION_CHANNELS = ['OFFLINE_QR', 'TRANSFER', 'CASH'] as const
export type OfflineCollectionChannel = (typeof OFFLINE_COLLECTION_CHANNELS)[number]

export const OFFLINE_COLLECTION_CHANNEL_LABEL: Record<OfflineCollectionChannel, string> = {
  OFFLINE_QR: '线下扫码',
  TRANSFER: '转账',
  CASH: '现金',
}

export function isOfflineCollectionChannel(v: string): v is OfflineCollectionChannel {
  return (OFFLINE_COLLECTION_CHANNELS as readonly string[]).includes(v)
}

/** 正数、最多 2 位小数，存储为整数元（四舍五入） */
export function parseOfflineCollectionAmount(raw: unknown): number | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n)
}

export function parseCollectionDateYmd(raw: unknown): Date | null {
  const s = String(raw ?? '').trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() + 1 !== Number(m[2]) || d.getDate() !== Number(m[3])) {
    return null
  }
  return d
}

export function offlineChannelLabel(channel: string | null | undefined): string {
  if (!channel) return ''
  if (isOfflineCollectionChannel(channel)) return OFFLINE_COLLECTION_CHANNEL_LABEL[channel]
  return channel
}
