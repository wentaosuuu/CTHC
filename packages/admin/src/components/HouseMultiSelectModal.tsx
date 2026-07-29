import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api'
import type { JiangnanHousePick } from '../jiangnanFactoryContract'

type ApiHouse = JiangnanHousePick & { assetType?: string }

type Props = {
  open: boolean
  selectedIds: string[]
  /** 手动新建时仅可选空置；配置合同时可含已选中的在租资产 */
  vacantOnly?: boolean
  onClose: () => void
  onConfirm: (houses: JiangnanHousePick[]) => void
}

export function HouseMultiSelectModal({
  open,
  selectedIds,
  vacantOnly = true,
  onClose,
  onConfirm,
}: Props) {
  const [items, setItems] = useState<ApiHouse[]>([])
  const [loadErr, setLoadErr] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selectedIds))

  useEffect(() => {
    if (!open) return
    setPicked(new Set(selectedIds))
    let alive = true
    void apiGet<{ items: ApiHouse[] }>('/api/admin/houses').then((r) => {
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
    return items.filter((h) => {
      if (vacantOnly && h.status !== 'VACANT' && !selectedIds.includes(h.id)) return false
      if (!kw) return true
      const hay = `${h.apartmentName} ${h.houseNo} ${h.storeName} ${h.address ?? ''}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, vacantOnly, selectedIds])

  if (!open) return null

  return (
    <div className="a-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="a-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="a-modal-header">
          <div className="a-modal-title">选择资产（可多选）</div>
          <button type="button" className="a-modal-close" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="a-modal-body">
          <input
            className="a-filter-input"
            placeholder="搜索公寓 / 房号 / 地址"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: '100%', marginBottom: 10 }}
          />
          {vacantOnly ? (
            <div className="a-muted" style={{ fontSize: 12, marginBottom: 8 }}>
              默认仅展示空置资产；已选中的资产会保留显示。
            </div>
          ) : null}
          {loadErr ? <div className="a-error" style={{ marginBottom: 8 }}>{loadErr}</div> : null}
          <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            {filtered.length === 0 ? (
              <div className="a-muted" style={{ padding: 16 }}>
                暂无可选资产
              </div>
            ) : (
              filtered.map((h) => {
                const on = picked.has(h.id)
                return (
                  <label
                    key={h.id}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'flex-start',
                      padding: '10px 12px',
                      borderBottom: '1px solid #f1f5f9',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      style={{ marginTop: 3 }}
                      onChange={() => {
                        setPicked((prev) => {
                          const next = new Set(prev)
                          if (next.has(h.id)) next.delete(h.id)
                          else next.add(h.id)
                          return next
                        })
                      }}
                    />
                    <span style={{ lineHeight: 1.5 }}>
                      <strong>
                        {h.apartmentName} {h.houseNo}
                      </strong>
                      <span className="a-muted">（{h.storeName}）</span>
                      <br />
                      <span className="a-muted" style={{ fontSize: 12 }}>
                        {h.address?.trim() || '未录入地址'} · {h.area}㎡ · ¥{h.rentMonthly}/月
                        {h.status && h.status !== 'VACANT' ? ` · ${h.status}` : ''}
                      </span>
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
                const houses = items
                  .filter((h) => picked.has(h.id))
                  .map((h) => ({
                    id: h.id,
                    apartmentName: h.apartmentName,
                    houseNo: h.houseNo,
                    storeName: h.storeName,
                    address: h.address ?? '',
                    area: h.area,
                    rentMonthly: h.rentMonthly,
                    status: h.status,
                    houseType: (h as ApiHouse & { houseType?: string }).houseType ?? '',
                  }))
                onConfirm(houses)
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
