import { useCallback, useEffect, useState } from 'react'
import { getMyContracts, getTenantPhone, type TenantContractItem } from '../api'

/** 拉取当前手机号下的合同摘要（含倒计时所需字段），并每秒刷新 now 用于展示 */
export function useTenantContractItems(refetchKey: string | number, options?: { pollMs?: number }) {
  const pollMs = options?.pollMs ?? 12_000
  const [items, setItems] = useState<TenantContractItem[]>([])
  const [loadError, setLoadError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    const phone = getTenantPhone()
    if (!phone) {
      setItems([])
      setLoadError('')
      return
    }
    const r = await getMyContracts(phone)
    if (!r.ok) {
      setLoadError(r.error)
      return
    }
    setLoadError('')
    setItems(r.data.items)
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), pollMs)
    return () => window.clearInterval(id)
  }, [load, pollMs, refetchKey])

  return { items, now, loadError, refresh: load }
}
