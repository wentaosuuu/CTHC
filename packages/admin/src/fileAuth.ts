import { getAdminToken } from './auth'

export async function previewFileWithAuth(url: string) {
  const token = getAdminToken()
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  if (!res.ok) {
    let msg = '加载失败'
    try {
      const j = (await res.clone().json()) as { error?: string }
      if (j.error === 'PAYMENT_REQUIRED_FOR_DOWNLOAD') msg = '当前不可加载该文件'
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  const blob = await res.blob()
  window.open(URL.createObjectURL(blob))
}

export async function downloadFileWithAuth(url: string, filename: string) {
  const token = getAdminToken()
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  if (!res.ok) {
    let msg = '下载失败'
    try {
      const j = (await res.clone().json()) as { error?: string }
      if (j.error === 'PAYMENT_REQUIRED_FOR_DOWNLOAD') {
        msg = '租客完成首笔缴费后方可下载正式合同附件'
      }
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  const blob = await res.blob()
  const u = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = u
  a.download = filename
  a.click()
  URL.revokeObjectURL(u)
}
