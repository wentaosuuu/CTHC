import { clearAdminToken, getAdminToken } from './auth'

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function readError(res: Response) {
  try {
    const j = await res.json()
    return j?.error ? String(j.error) : JSON.stringify(j)
  } catch {
    return await res.text()
  }
}

/** 鉴权失败时清掉本地 token，让路由回到登录页（避免仍显示「已登录」却全是演示数据、按钮不可用） */
async function readAdminError(res: Response): Promise<string> {
  const error = await readError(res)
  if (res.status === 401 && error === 'UNAUTHORIZED') clearAdminToken()
  return error
}

function withAuthHeaders(init?: RequestInit) {
  const token = getAdminToken()
  const headers = { ...(init?.headers ?? {}) } as Record<string, string>
  if (token) headers.Authorization = `Bearer ${token}`
  return { ...init, headers }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(path, withAuthHeaders({ ...init, method: 'GET' }))
  if (!res.ok) return { ok: false, error: await readAdminError(res) }
  return { ok: true, data: (await res.json()) as T }
}

export async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<ApiResult<T>> {
  const base = withAuthHeaders(init)
  const headers = { 'content-type': 'application/json', ...(base.headers as any) }
  const res = await fetch(path, { ...base, method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) return { ok: false, error: await readAdminError(res) }
  return { ok: true, data: (await res.json()) as T }
}

export async function apiPatch<T>(path: string, body: unknown, init?: RequestInit): Promise<ApiResult<T>> {
  const base = withAuthHeaders(init)
  const headers = { 'content-type': 'application/json', ...(base.headers as any) }
  const res = await fetch(path, { ...base, method: 'PATCH', headers, body: JSON.stringify(body) })
  if (!res.ok) return { ok: false, error: await readAdminError(res) }
  return { ok: true, data: (await res.json()) as T }
}

export async function apiUploadDepartmentQr(
  deptId: string,
  file: File,
): Promise<ApiResult<{ ok: true; wecomQrUrl: string }>> {
  const token = getAdminToken()
  const fd = new FormData()
  fd.append('file', file)
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`/api/admin/departments/${encodeURIComponent(deptId)}/qr`, {
    method: 'POST',
    headers,
    body: fd,
  })
  if (!res.ok) return { ok: false, error: await readAdminError(res) }
  return { ok: true, data: (await res.json()) as { ok: true; wecomQrUrl: string } }
}

export async function apiUploadContractAttachment(
  contractId: string,
  file: File,
): Promise<ApiResult<{ ok: true; attachments: { id: string; name: string; file: string }[] }>> {
  const token = getAdminToken()
  const fd = new FormData()
  fd.append('file', file)
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`/api/admin/contracts/${contractId}/upload-attachment`, {
    method: 'POST',
    headers,
    body: fd,
  })
  if (!res.ok) return { ok: false, error: await readAdminError(res) }
  return { ok: true, data: (await res.json()) as { ok: true; attachments: { id: string; name: string; file: string }[] } }
}

export async function apiDeleteContractAttachment(
  contractId: string,
  fileKey: string,
): Promise<ApiResult<{ ok: true; attachments: { id: string; name: string; file: string }[] }>> {
  const base = withAuthHeaders()
  const res = await fetch(
    `/api/admin/contracts/${contractId}/attachment/${encodeURIComponent(fileKey)}`,
    { ...base, method: 'DELETE' },
  )
  if (!res.ok) return { ok: false, error: await readAdminError(res) }
  return { ok: true, data: (await res.json()) as { ok: true; attachments: { id: string; name: string; file: string }[] } }
}
