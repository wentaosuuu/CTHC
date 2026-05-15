export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function readError(res: Response) {
  try {
    const j = await res.json()
    return j?.error ? String(j.error) : JSON.stringify(j)
  } catch {
    return await res.text()
  }
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

function hasConfirmDemo(orders: MyOrderSummary[]) {
  return orders.some((o) => o.statusText?.includes('确认订单'))
}

function hasSignedDemo(orders: MyOrderSummary[]) {
  return orders.some((o) => o.statusText?.includes('已签约'))
}

export function getMyOrders(): MyOrderSummary[] {
  try {
    const raw = localStorage.getItem(MY_ORDERS_KEY)
    let list: MyOrderSummary[]
    if (!raw) {
      list = [
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
    return list
  } catch {
    return [SIGNED_DEMO_ORDER, CONFIRM_DEMO_ORDER]
  }
}

export function addMyOrder(order: MyOrderSummary) {
  const current = getMyOrders()
  const next = [order, ...current].slice(0, 20) // 只保留最近 20 条
  localStorage.setItem(MY_ORDERS_KEY, JSON.stringify(next))
}

// 当前租客的合同列表（用于「确认订单」后跳转合同页）
export type TenantContractItem = { id: string; contractNo: string; status: string }

export async function getMyContracts(phone: string): Promise<ApiResult<{ items: TenantContractItem[] }>> {
  return apiGet<{ items: TenantContractItem[] }>('/api/contracts', {
    headers: { 'x-tenant-phone': phone },
  })
}// Tenant bills
export type MyBillSummary = {
  id: string
  period: string
  dueDate: string
  totalAmount: number
  status: string
  kind?: 'BASE' | 'ADJUSTMENT'
  contractId: string
  contractNo: string
  apartmentName: string
  houseNo: string
  storeName: string
}

export type MyBillDetail = {
  id: string
  period: string
  dueDate: string
  totalAmount: number
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
  items: { name: string; amount: number }[]
}
