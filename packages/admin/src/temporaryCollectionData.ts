export const TEMPORARY_COLLECTION_STORAGE_KEY = 'cthc.prototype-sync.v1.temporary-collections'
export const TEMPORARY_COLLECTION_FEE_TYPES = ['租金', '押金', '水电费', '其他'] as const
export type TemporaryCollectionFeeType = (typeof TEMPORARY_COLLECTION_FEE_TYPES)[number]
export type TemporaryCollectionStatus = 'PENDING' | 'PAID' | 'CANCELLED'
export const TEMPORARY_COLLECTION_STATUS_LABEL: Record<TemporaryCollectionStatus, string> = {
  PENDING: '待支付', PAID: '已支付', CANCELLED: '已取消',
}
export type TemporaryCollection = {
  id: string; number: string; storeName: string; contractNo: string; tenantName: string; phone: string
  feeType: TemporaryCollectionFeeType; amountCents: number; status: TemporaryCollectionStatus
  channel: string; paidAt: string; createdAt: string; cancelledAt: string
  period: string; houseBizId: string; houseNo: string; remark: string
}
export type TemporaryCollectionDraft = {
  contractNo: string; tenantName: string; phone: string; feeType: TemporaryCollectionFeeType
  amount: string; period: string; houseBizId: string; houseNo: string; remark: string
}
export type TemporaryCollectionFilters = { query: string; status: '' | TemporaryCollectionStatus; from: string; to: string }
export const EMPTY_TEMPORARY_COLLECTION_FILTERS: TemporaryCollectionFilters = { query: '', status: '', from: '', to: '' }

export function emptyTemporaryCollectionDraft(): TemporaryCollectionDraft {
  return { contractNo: '', tenantName: '', phone: '', feeType: '其他', amount: '0.01', period: '', houseBizId: '', houseNo: '', remark: '' }
}

/** 整数分存储；不接受科学计数法、超过两位小数、非正金额及不安全整数。 */
export function parseTemporaryCollectionCents(value: string): { ok: true; cents: number } | { ok: false; error: string } {
  const normalized = value.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return { ok: false, error: '金额请填写大于 0 的数字，最多保留两位小数。' }
  const [whole, fraction = ''] = normalized.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents <= 0) return { ok: false, error: '金额须大于 0，且不能超过可保存范围。' }
  return { ok: true, cents }
}

export function temporaryCollectionMoney(cents: number): string {
  return `${Math.floor(cents / 100).toLocaleString('zh-CN')}.${String(cents % 100).padStart(2, '0')}`
}

export function isTemporaryCollection(value: unknown): value is TemporaryCollection {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<TemporaryCollection>
  const strings = ['id', 'number', 'storeName', 'contractNo', 'tenantName', 'phone', 'channel', 'paidAt', 'createdAt', 'cancelledAt', 'period', 'houseBizId', 'houseNo', 'remark'] as const
  return strings.every(key => typeof row[key] === 'string') && typeof row.amountCents === 'number'
    && Number.isSafeInteger(row.amountCents) && row.amountCents > 0
    && TEMPORARY_COLLECTION_FEE_TYPES.some(fee => fee === row.feeType)
    && (row.status === 'PENDING' || row.status === 'PAID' || row.status === 'CANCELLED')
}

export function createTemporaryCollection(
  draft: TemporaryCollectionDraft, id: string, now: string, storeName = '',
): { ok: true; record: TemporaryCollection } | { ok: false; error: string } {
  if (!draft.tenantName.trim()) return { ok: false, error: '请填写租户姓名。' }
  const money = parseTemporaryCollectionCents(draft.amount)
  if (!money.ok) return money
  if (!TEMPORARY_COLLECTION_FEE_TYPES.some(fee => fee === draft.feeType)) return { ok: false, error: '请选择费用类型。' }
  const date = new Date(now)
  if (Number.isNaN(date.getTime()) || !id) return { ok: false, error: '收款单生成失败，请重试。' }
  return { ok: true, record: {
    id, number: `LS-DEMO-${date.getTime()}-${id.slice(0, 6).toUpperCase()}`,
    storeName: storeName.trim(), contractNo: draft.contractNo.trim(), tenantName: draft.tenantName.trim(), phone: draft.phone.trim(),
    feeType: draft.feeType, amountCents: money.cents, status: 'PENDING', channel: '', paidAt: '', createdAt: now, cancelledAt: '',
    period: draft.period.trim(), houseBizId: draft.houseBizId.trim(), houseNo: draft.houseNo.trim(), remark: draft.remark.trim(),
  } }
}

export function transitionTemporaryCollection(
  row: TemporaryCollection, next: 'PAID' | 'CANCELLED', now: string,
): { ok: true; record: TemporaryCollection } | { ok: false; error: string } {
  if (row.status !== 'PENDING') return { ok: false, error: '仅待支付收款单可进行此项演示操作。' }
  if (Number.isNaN(Date.parse(now))) return { ok: false, error: '操作时间无效，请重试。' }
  return { ok: true, record: next === 'PAID'
    ? { ...row, status: 'PAID', channel: '本地演示支付', paidAt: now }
    : { ...row, status: 'CANCELLED', cancelledAt: now } }
}

export function filterTemporaryCollections(rows: TemporaryCollection[], filters: TemporaryCollectionFilters): TemporaryCollection[] {
  const query = filters.query.trim().toLocaleLowerCase('zh-CN')
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
  return rows.filter(row => {
    const hay = [row.number, row.storeName, row.contractNo, row.tenantName, row.phone, row.feeType, row.period, row.houseBizId, row.houseNo, row.remark].join(' ').toLocaleLowerCase('zh-CN')
    const day = Number.isNaN(Date.parse(row.createdAt)) ? '' : formatter.format(new Date(row.createdAt))
    return (!query || hay.includes(query)) && (!filters.status || row.status === filters.status)
      && (!filters.from || Boolean(day && day >= filters.from)) && (!filters.to || Boolean(day && day <= filters.to))
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** 仅编码演示协议和随机收款单 ID，不含租户信息或第三方地址。 */
export function temporaryCollectionQrPayload(id: string): string {
  return `cthc-demo://temporary-collection/${encodeURIComponent(id)}`
}
