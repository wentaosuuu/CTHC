export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function readError(res: Response) {
  const text = await res.text()
  let err: string
  try {
    const j = JSON.parse(text) as { error?: unknown; message?: unknown }
    if (j?.message != null && String(j.message).trim()) err = String(j.message)
    else err = j?.error != null ? String(j.error) : text || String(res.status)
  } catch {
    err = text || String(res.status)
  }
  if (err === 'PAYMENT_REQUIRED_FOR_DOWNLOAD') return '请先完成首笔缴费后再下载正式合同附件'
  if (err === 'OCR_FAILED') return '证件识别失败，请换一张更清晰的照片重试'
  if (err === 'ID_CARD_VALID_UNTIL_REQUIRED') return '请填写证件有效期至，或勾选「长期有效」'
  if (err === 'ID_NUMBER_REQUIRED') return '请填写证件号码'
  if (err === 'INVALID_ID_NUMBER') return '请填写证件号码'
  if (err === 'INVALID_IMAGE' || err === 'IMAGE_TOO_LARGE') return '图片无效或过大，请重新选择较小的照片'
  if (err === 'INVALID_BODY') return '请求参数不正确'
  if (err === 'TENANT_SIGN_DEADLINE_EXCEEDED') return '已超过确认与签字的截止时间（3天），合同已失效'
  if (err === 'PAYMENT_WINDOW_EXPIRED') return '已超过盖章后24小时付款期限，无法继续支付'
  if (err === 'NOT_STAMPED_YET') return '合同尚未完成盖章，请稍后再试'
  if (err === 'INVALID_PASSPORT_NO') return '护照号码格式不正确（6–24 位字母、数字或连字符）'
  if (err === 'INVALID_PERMIT_NO') return '港澳台通行证号码格式不正确'
  if (err === 'INVALID_USCC') return '统一社会信用代码须为 18 位合法格式'
  if (err === 'INVALID_DOC_VALID_UNTIL') return '「有效期至」日期格式不正确'
  if (err === 'DOC_EXPIRED') return '填写的证件有效期已过期'
  if (err === 'MERGED_LEASE_MISMATCH') return '合并为一份合同时，各房源租期与入住日须一致'
  if (err === 'DUPLICATE_HOUSE_IN_CHECKOUT') return '购物车中存在重复房源'
  if (err === 'CART_MIXED_ASSET_LANE') return '泊湾公寓与商铺/厂房/住宅不能在同一笔订单中结算，请分开提交'
  if (err === 'MERGED_RENT_SUM_MISMATCH') return '合并订单：配置合同的月租须等于各子资产月租之和'
  if (err === 'PRIOR_BILLS_UNPAID') return '请先结清更早账期的欠费账单，再支付本期'
  return err
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(path, { ...init, method: 'GET' })
  if (!res.ok) return { ok: false, error: await readError(res) }
  return { ok: true, data: (await res.json()) as T }
}

export async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    ...init,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    body: JSON.stringify(body),
  })
  if (!res.ok) return { ok: false, error: await readError(res) }
  return { ok: true, data: (await res.json()) as T }
}

export async function apiGetBlob(path: string, init?: RequestInit): Promise<ApiResult<Blob>> {
  const res = await fetch(path, { ...init, method: 'GET' })
  if (!res.ok) return { ok: false, error: await readError(res) }
  return { ok: true, data: await res.blob() }
}

export async function previewContractAttachmentWithPhone(
  contractId: string,
  fileKey: string,
  phone: string,
): Promise<ApiResult<true>> {
  const r = await apiGetBlob(`/api/contracts/${contractId}/attachment/${encodeURIComponent(fileKey)}`, {
    headers: { 'x-tenant-phone': phone },
  })
  if (!r.ok) return r
  const url = URL.createObjectURL(r.data)
  window.open(url, '_blank', 'noopener,noreferrer')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { ok: true, data: true }
}

export async function downloadContractAttachmentWithPhone(
  contractId: string,
  fileKey: string,
  fileName: string,
  phone: string,
): Promise<ApiResult<true>> {
  const r = await apiGetBlob(
    `/api/contracts/${contractId}/attachment/${encodeURIComponent(fileKey)}?download=1`,
    {
      headers: { 'x-tenant-phone': phone },
    },
  )
  if (!r.ok) return r
  const url = URL.createObjectURL(r.data)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName || '附件'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { ok: true, data: true }
}

export async function previewMoveOutFileWithPhone(
  contractId: string,
  fileKey: string,
  phone: string,
): Promise<ApiResult<true>> {
  const r = await apiGetBlob(`/api/contracts/${contractId}/move-out-file/${encodeURIComponent(fileKey)}`, {
    headers: { 'x-tenant-phone': phone },
  })
  if (!r.ok) return r
  const url = URL.createObjectURL(r.data)
  window.open(url, '_blank', 'noopener,noreferrer')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { ok: true, data: true }
}

export async function downloadMoveOutFileWithPhone(
  contractId: string,
  fileKey: string,
  fileName: string,
  phone: string,
): Promise<ApiResult<true>> {
  const r = await apiGetBlob(
    `/api/contracts/${contractId}/move-out-file/${encodeURIComponent(fileKey)}?download=1`,
    {
      headers: { 'x-tenant-phone': phone },
    },
  )
  if (!r.ok) return r
  const url = URL.createObjectURL(r.data)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName || '退租附件'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { ok: true, data: true }
}

export function getTenantPhone() {
  return localStorage.getItem('tenantPhone') || ''
}

export function setTenantPhone(phone: string) {
  localStorage.setItem('tenantPhone', phone)
}

export type MyOrderSummary = {
  id: string
  createdAt: string
  houseId?: string
  houseTitle?: string
  houseSubtitle?: string
  rentMonthly?: number
  statusText?: string
  contractId?: string
  contractNo?: string
}

const MY_ORDERS_KEY = 'myOrders'

// 固定的一条「审核通过，请确认订单」demo，用于演示 确认订单 -> 合同页 -> 申请修改合同
const CONFIRM_DEMO_ORDER: MyOrderSummary = {
  id: 'DEMO-ORDER-CONFIRM',
  createdAt: new Date('2026-03-10T14:00:00Z').toISOString(),
  houseId: 'DEMO-HOUSE-002',
  houseTitle: '良庆·悦居公寓 · 330',
  houseSubtitle: '南宁市-良庆区 · 开间 · 32㎡',
  rentMonthly: 4200,
  statusText: '审核通过，请确认订单',
  contractId: 'DEMO-CONTRACT-001',
  contractNo: 'HT20260316001',
}

// 固定一条「已签约完成」demo，用于演示订单完成态 + 合同预览/下载
const SIGNED_DEMO_ORDER: MyOrderSummary = {
  id: 'DEMO-ORDER-SIGNED',
  createdAt: new Date('2026-03-08T09:30:00Z').toISOString(),
  houseId: 'DEMO-HOUSE-002',
  houseTitle: '良庆·悦居公寓 · 330',
  houseSubtitle: '南宁市-良庆区 · 开间 · 32㎡',
  rentMonthly: 4200,
  statusText: '已签约完成，合同已生效',
  contractId: 'DEMO-CONTRACT-001',
  contractNo: 'HT20260316001',
}

/** 演示：已盖章待付首期（24 小时倒计时） */
const PAY_DEMO_ORDER: MyOrderSummary = {
  id: 'DEMO-ORDER-PAY',
  createdAt: new Date('2026-03-11T16:00:00Z').toISOString(),
  houseId: 'DEMO-HOUSE-004',
  houseTitle: '西乡塘·学府青年社区 · 908',
  houseSubtitle: '南宁市-西乡塘区 · 单间 · 28㎡',
  rentMonthly: 1650,
  statusText: '合同已盖章，待支付首期款',
  contractId: 'DEMO-CONTRACT-PAY',
  contractNo: 'C-DEMO-待付首期',
}

function hasConfirmDemo(orders: MyOrderSummary[]) {
  return orders.some((o) => o.statusText?.includes('确认订单'))
}

function hasSignedDemo(orders: MyOrderSummary[]) {
  return orders.some((o) => o.statusText?.includes('已签约'))
}

function hasPayDemo(orders: MyOrderSummary[]) {
  return orders.some((o) => o.id === 'DEMO-ORDER-PAY')
}

export function getMyOrders(): MyOrderSummary[] {
  try {
    const raw = localStorage.getItem(MY_ORDERS_KEY)
    let list: MyOrderSummary[]
    if (!raw) {
      list = [
        PAY_DEMO_ORDER,
        CONFIRM_DEMO_ORDER,
        {
          id: 'DEMO-ORDER-001',
          createdAt: new Date('2026-03-01T10:00:00Z').toISOString(),
          houseId: 'DEMO-HOUSE-001',
          houseTitle: '青秀·江景公寓 · 1203',
          houseSubtitle: '南宁市-青秀区 · 两室一厅 · 78㎡',
          rentMonthly: 7800,
          statusText: '已提交，等待管理员审核',
        },
      ]
    } else {
      const parsed = JSON.parse(raw) as MyOrderSummary[]
      list = Array.isArray(parsed) ? parsed : []
    }
    // 无论本地有没有数据，都保证列表里有一条「审核通过，请确认订单」，方便演示申请修改合同
    if (!hasConfirmDemo(list)) {
      list = [CONFIRM_DEMO_ORDER, ...list].slice(0, 20)
    }
    // 同时保证有一条「已签约完成」demo
    if (!hasSignedDemo(list)) {
      list = [SIGNED_DEMO_ORDER, ...list].slice(0, 20)
    }
    if (!hasPayDemo(list)) {
      list = [PAY_DEMO_ORDER, ...list].slice(0, 20)
    }
    return list
  } catch {
    return [PAY_DEMO_ORDER, SIGNED_DEMO_ORDER, CONFIRM_DEMO_ORDER]
  }
}

export function addMyOrder(order: MyOrderSummary) {
  const current = getMyOrders()
  const next = [order, ...current].slice(0, 20) // 只保留最近 20 条
  localStorage.setItem(MY_ORDERS_KEY, JSON.stringify(next))
}

// 当前租客的合同列表（用于「确认订单」后跳转合同页）
export type TenantContractItem = {
  id: string
  contractNo: string
  status: string
  orderId: string
  tenantSignDeadlineAt: string | null
  stampedAt: string | null
  /** 续签生成的新合同：首期款截止与签字共用 tenantSignDeadlineAt（起租首日起 24h） */
  renewedFromId?: string | null
  /** 待租客确认退租时的签字截止 */
  moveOutSignDeadlineAt?: string | null
}

export async function getMyContracts(phone: string): Promise<ApiResult<{ items: TenantContractItem[] }>> {
  return apiGet<{ items: TenantContractItem[] }>('/api/contracts', {
    headers: { 'x-tenant-phone': phone },
  })
}

/** 将本地订单与接口返回的合同关联（优先 contractId，否则用订单 id 对 orderId） */
export function matchContractForOrder(
  order: MyOrderSummary,
  items: TenantContractItem[],
): TenantContractItem | undefined {
  if (order.contractId) return items.find((c) => c.id === order.contractId)
  return items.find((c) => c.orderId === order.id)
}

const MS_DAY = 86400_000
const MS_HOUR = 3600_000

function readOrInitSessionIso(key: string, init: () => Date): string {
  try {
    if (typeof sessionStorage === 'undefined') return init().toISOString()
    let v = sessionStorage.getItem(key)
    if (!v) {
      v = init().toISOString()
      sessionStorage.setItem(key, v)
    }
    return v
  } catch {
    return init().toISOString()
  }
}

/** 无后端合同时，为固定 DEMO 订单注入可展示的倒计时数据（给客户演示用） */
export function getDemoSyntheticContract(order: MyOrderSummary): TenantContractItem | undefined {
  if (order.id === 'DEMO-ORDER-CONFIRM') {
    const tenantSignDeadlineAt = readOrInitSessionIso('cthc_demo_sign_deadline_v1', () => new Date(Date.now() + 2.6 * MS_DAY))
    return {
      id: order.contractId ?? 'DEMO-CONTRACT-001',
      contractNo: order.contractNo ?? 'HT20260316001',
      status: 'WAIT_TENANT_SIGN',
      orderId: order.id,
      tenantSignDeadlineAt,
      stampedAt: null,
      renewedFromId: null,
    }
  }
  if (order.id === 'DEMO-ORDER-PAY') {
    const stampedAt = readOrInitSessionIso('cthc_demo_pay_stamped_v1', () => new Date(Date.now() - 3 * MS_HOUR))
    return {
      id: order.contractId ?? 'DEMO-CONTRACT-PAY',
      contractNo: order.contractNo ?? 'C-DEMO-待付首期',
      status: 'PENDING_PAYMENT',
      orderId: order.id,
      tenantSignDeadlineAt: null,
      stampedAt,
      renewedFromId: null,
    }
  }
  return undefined
}

/** 优先真实接口合同，否则尝试 DEMO 合成数据 */
export function resolveContractForOrderDisplay(
  order: MyOrderSummary,
  items: TenantContractItem[],
): TenantContractItem | undefined {
  return matchContractForOrder(order, items) ?? getDemoSyntheticContract(order)
}

// Tenant bills
export type MyBillSummary = {
  id: string
  period: string
  dueDate: string
  totalAmount: number
  amountReceived?: number
  amountRemaining?: number
  status: string
  kind?: 'BASE' | 'ADJUSTMENT'
  contractId: string
  contractNo: string
  apartmentName: string
  houseNo: string
  storeName: string
  /** 一单多套合并合同时，各套房源展示名 */
  mergedUnits?: { apartmentName: string; houseNo: string }[]
  /** 存在更早账期欠费时，在线支付被阻断的原因 */
  payBlockedReason?: string
}

export type MyBillDetail = {
  id: string
  period: string
  dueDate: string
  totalAmount: number
  amountReceived?: number
  amountRemaining?: number
  status: string
  kind?: 'BASE' | 'ADJUSTMENT'
  paidAt: string | null
  contractId: string
  contractNo: string
  apartmentName: string
  houseNo: string
  storeName: string
  tenantName: string
  tenantPhone: string
  createdAt: string
  mergedUnits?: { apartmentName: string; houseNo: string }[]
  payBlockedReason?: string
  items: { name: string; amount: number; breakdown?: { label: string; amount: number }[] }[]
}
