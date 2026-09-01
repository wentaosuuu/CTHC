import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiGet, getTenantPhone, type ApiResult } from '../api'

export type SubletListItem = {
  id: string
  applicationNo: string
  contractNo: string
  storeName: string
  apartmentName: string
  houseNo: string
  status: string
  statusLabel: string
  subletArea: number
  subletUnit: string
  createdAt: string
  rejectReason: string | null
  filingRejectReason: string | null
}

function statusTone(status: string) {
  if (status === 'COMPLETED') return 'm-sublet-pill--done'
  if (status === 'REJECTED') return 'm-sublet-pill--end'
  if (status === 'WAIT_FILING') return 'm-sublet-pill--action'
  return 'm-sublet-pill--wait'
}

function tenantStatusLabel(status: string, fallback: string) {
  switch (status) {
    case 'PENDING_REVIEW':
      return '待初审'
    case 'WAIT_OA':
      return '审核中'
    case 'WAIT_FILING':
      return '待提交备案材料'
    case 'FILING_REVIEW':
      return '备案材料审核中'
    case 'WAIT_MINUTES':
      return '处理中'
    case 'COMPLETED':
      return '已完成'
    case 'REJECTED':
      return '已结束'
    default:
      return fallback
  }
}

export function SubletListPage() {
  const location = useLocation()
  const phone = getTenantPhone()
  const [items, setItems] = useState<SubletListItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      setError('')
      if (!phone.trim()) {
        setItems([])
        setLoading(false)
        return
      }
      const r: ApiResult<{ items: SubletListItem[] }> = await apiGet('/api/sublets', {
        headers: { 'x-tenant-phone': phone },
      })
      if (!alive) return
      if (!r.ok) {
        setError(r.error)
        setItems([])
      } else {
        setItems(r.data.items ?? [])
      }
      setLoading(false)
    }
    load()
    return () => {
      alive = false
    }
  }, [phone, location.key])

  const actionCount = useMemo(
    () => items.filter((x) => x.status === 'WAIT_FILING').length,
    [items],
  )

  return (
    <div className="m-col">
      {!phone.trim() ? (
        <div className="m-card">
          <div style={{ fontWeight: 800 }}>请先绑定手机号</div>
          <div className="m-muted" style={{ marginTop: 6 }}>
            转租申请需与在租合同绑定的手机号一致。
          </div>
          <div style={{ marginTop: 12 }}>
            <Link className="m-btn" to="/me/profile">
              去填写手机号
            </Link>
          </div>
        </div>
      ) : null}

      {phone.trim() ? (
        <div className="m-card">
          <div className="m-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="m-h1">转租申请</div>
              <div className="m-muted" style={{ marginTop: 4 }}>
                共 {items.length} 条{actionCount > 0 ? ` · ${actionCount} 条待补材料` : ''}
              </div>
            </div>
            <Link className="m-btn" to="/me/sublets/new">
              新建申请
            </Link>
          </div>
        </div>
      ) : null}

      {error ? <div className="m-card m-error">加载失败：{error}</div> : null}
      {loading ? <div className="m-card m-muted">加载中…</div> : null}

      {!loading && phone.trim() && items.length === 0 && !error ? (
        <div className="m-card">
          <div style={{ fontWeight: 700 }}>暂无转租申请</div>
          <div className="m-muted" style={{ marginTop: 6 }}>
            可对在租合同发起转租申请，经店长初审、华创 OA 通过后提交备案材料。
          </div>
        </div>
      ) : null}

      {items.map((it) => (
        <Link key={it.id} className="m-card m-sublet-card" to={`/me/sublets/${encodeURIComponent(it.id)}`}>
          <div className="m-row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontWeight: 800 }}>{it.applicationNo}</div>
            <span className={`m-sublet-pill ${statusTone(it.status)}`}>
              {tenantStatusLabel(it.status, it.statusLabel)}
            </span>
          </div>
          <div className="m-muted" style={{ marginTop: 8, fontSize: 13 }}>
            {it.storeName} · {it.apartmentName} · {it.houseNo}
          </div>
          <div style={{ marginTop: 6, fontSize: 13 }}>
            合同 {it.contractNo} · 转租 {it.subletArea}㎡ · {it.subletUnit}
          </div>
          {it.status === 'WAIT_FILING' ? (
            <div className="m-sublet-hint">请上传合同、营业执照等备案材料</div>
          ) : null}
          {it.status === 'REJECTED' && it.rejectReason ? (
            <div className="m-sublet-hint m-sublet-hint--end">结束原因：{it.rejectReason}</div>
          ) : null}
          {it.status === 'WAIT_FILING' && it.filingRejectReason ? (
            <div className="m-sublet-hint m-sublet-hint--end">材料驳回：{it.filingRejectReason}</div>
          ) : null}
        </Link>
      ))}
    </div>
  )
}
