import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api'
import type { JiangnanTenantPick } from '../jiangnanFactoryContract'

type ApiTenant = {
  id: string
  name: string
  phone: string
  idNumber?: string
}

type Props = {
  open: boolean
  selectedIds: string[]
  onClose: () => void
  onConfirm: (tenants: JiangnanTenantPick[]) => void
}

export function TenantMultiSelectModal({ open, selectedIds, onClose, onConfirm }: Props) {
  const [items, setItems] = useState<ApiTenant[]>([])
  const [loadErr, setLoadErr] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selectedIds))

  useEffect(() => {
    if (!open) return
    setPicked(new Set(selectedIds))
    let alive = true
    void apiGet<{ items: ApiTenant[] }>('/api/admin/tenants?forContractSelect=1').then((r) => {
      if (!alive) return
      if (!r.ok) {
        setLoadErr(r.error)
        setItems([])
        return
      }
      setLoadErr('')
      setItems(r.data.items ?? [])
    })
    return () => {
      alive = false
    }
  }, [open, selectedIds])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return items
    return items.filter((t) => `${t.name} ${t.phone} ${t.idNumber ?? ''}`.toLowerCase().includes(kw))
  }, [items, q])

  if (!open) return null

  return (
    <div className="a-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="a-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="a-modal-header">
          <div className="a-modal-title">选择租客（可多选）</div>
          <button type="button" className="a-modal-close" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="a-modal-body">
          <input
            className="a-filter-input"
            placeholder="搜索姓名 / 手机号"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: '100%', marginBottom: 10 }}
          />
          {loadErr ? <div className="a-error" style={{ marginBottom: 8 }}>{loadErr}</div> : null}
          <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            {filtered.length === 0 ? (
              <div className="a-muted" style={{ padding: 16 }}>
                暂无可选租客
              </div>
            ) : (
              filtered.map((t) => {
                const on = picked.has(t.id)
                return (
                  <label
                    key={t.id}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                      padding: '10px 12px',
                      borderBottom: '1px solid #f1f5f9',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        setPicked((prev) => {
                          const next = new Set(prev)
                          if (next.has(t.id)) next.delete(t.id)
                          else next.add(t.id)
                          return next
                        })
                      }}
                    />
                    <span>
                      {t.name} · {t.phone}
                      {t.idNumber ? ` · ${t.idNumber}` : ''}
                    </span>
                  </label>
                )
              })
            )}
          </div>
          <div className="a-row" style={{ marginTop: 12, justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="a-btn ghost" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="a-btn"
              onClick={() => {
                const tenants = items
                  .filter((t) => picked.has(t.id))
                  .map((t) => ({ id: t.id, name: t.name, phone: t.phone, idNumber: t.idNumber }))
                onConfirm(tenants)
                onClose()
              }}
            >
              确定（{picked.size}）
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
