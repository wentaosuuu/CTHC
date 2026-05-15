import { getAdminToken } from './auth'

export async function previewFileWithAuth(url: string) {
  const token = getAdminToken()
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error('加载失败')
  const blob = await res.blob()
  window.open(URL.createObjectURL(blob))
}

export async function downloadFileWithAuth(url: string, filename: string) {
  const token = getAdminToken()
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error('下载失败')
  const blob = await res.blob()
  const u = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = u
  a.download = filename
  a.click()
  URL.revokeObjectURL(u)
}
