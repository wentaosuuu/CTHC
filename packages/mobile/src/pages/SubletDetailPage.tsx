import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiGet, apiGetBlob, apiPost, getTenantPhone } from '../api'

type SubletFile = {
  id: string
  name: string
  file: string
  category: string | null
  previewUrl: string
  downloadUrl: string
}

type SubletDetail = {
  id: string
  applicationNo: string
  contractNo: string
  storeName: string
  apartmentName: string
  houseNo: string
  houseArea: number | null
  status: string
  statusLabel: string
  subletArea: number
  subletUnit: string
  remark: string
  rejectReason: string | null
  filingRejectReason: string | null
  filingMaterials: SubletFile[]
  meetingMinutes: SubletFile[]
  reviewedAt: string | null
  reviewedByName: string | null
  oaPassedAt: string | null
  oaRecordedByName: string | null
  filingSubmittedAt: string | null
  filingReviewedAt: string | null
  completedAt: string | null
  createdAt: string
}

/** 租户可见进度（隐藏店长内部节点：华创OA、会议纪要） */
const TENANT_STEPS: { label: string }[] = [
  { label: '提交申请' },
  { label: '店长初审' },
  { label: '备案材料' },
  { label: '材料复审' },
  { label: '已完成' },
]

function tenantStepIndex(status: string) {
  if (status === 'REJECTED') return -1
  switch (status) {
    case 'PENDING_REVIEW':
      return 0
    case 'WAIT_OA':
      // OA 为店长内部步骤，租户侧仍归在「店长初审」
      return 1
    case 'WAIT_FILING':
      return 2
    case 'FILING_REVIEW':
      return 3
    case 'WAIT_MINUTES':
    case 'COMPLETED':
      return 4
    default:
      return 0
  }
}

/** 租户端状态文案：不暴露 OA / 会议纪要等内部节点 */
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

function categoryZh(c: string | null) {
  if (c === 'CONTRACT') return '合同'
  if (c === 'LICENSE') return '营业执照'
  return '其他'
}

function fmtDt(iso: string | null) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN')
  } catch {
    return iso
  }
}

export function SubletDetailPage() {
  const { id } = useParams()
  const phone = getTenantPhone()
  const [item, setItem] = useState<SubletDetail | null>(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [category, setCategory] = useState<'CONTRACT' | 'LICENSE' | 'OTHER'>('CONTRACT')

  const load = useCallback(async () => {
    if (!id || !phone.trim()) return
    setLoading(true)
    setError('')
    const r = await apiGet<SubletDetail>(`/api/sublets/${encodeURIComponent(id)}`, {
      headers: { 'x-tenant-phone': phone },
    })
    if (!r.ok) {
      setError(r.error)
      setItem(null)
    } else {
      setItem(r.data)
    }
    setLoading(false)
  }, [id, phone])

  useEffect(() => {
    load()
  }, [load])

  const idx = useMemo(() => (item ? tenantStepIndex(item.status) : -1), [item])

  async function openFile(url: string, download: boolean, name: string) {
    const r = await apiGetBlob(url, { headers: { 'x-tenant-phone': phone } })
    if (!r.ok) return setError(r.error)
    const blobUrl = URL.createObjectURL(r.data)
    if (download) {
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = name
      a.click()
    } else {
      window.open(blobUrl, '_blank', 'noopener,noreferrer')
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
  }

  async function onUpload(file: File | null) {
    if (!file || !item) return
    setUploading(true)
    setError('')
    setMsg('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('category', category)
    const res = await fetch(`/api/sublets/${encodeURIComponent(item.id)}/filing-file`, {
      method: 'POST',
      headers: { 'x-tenant-phone': phone },
      body: fd,
    })
    setUploading(false)
    if (!res.ok) {
      let err = '上传失败'
      try {
        const j = (await res.json()) as { error?: string }
        err = j.error || err
      } catch {
        /* ignore */
      }
      return setError(err)
    }
    const data = (await res.json()) as SubletDetail
    setItem(data)
    setMsg('材料已上传')
  }

  async function removeFile(fileKey: string) {
    if (!item) return
    setError('')
    const res = await fetch(
      `/api/sublets/${encodeURIComponent(item.id)}/filing-file/${encodeURIComponent(fileKey)}`,
      { method: 'DELETE', headers: { 'x-tenant-phone': phone } },
    )
    if (!res.ok) {
      let err = '删除失败'
      try {
        const j = (await res.json()) as { error?: string }
        err = j.error || err
      } catch {
        /* ignore */
      }
      return setError(err)
    }
    setItem((await res.json()) as SubletDetail)
  }

  async function submitFiling() {
    if (!item) return
    setError('')
    setMsg('')
    const r = await apiPost<SubletDetail>(
      `/api/sublets/${encodeURIComponent(item.id)}/submit-filing`,
      {},
      { headers: { 'x-tenant-phone': phone } },
    )
    if (!r.ok) {
      const map: Record<string, string> = {
        FILING_MATERIALS_REQUIRED: '请至少上传一份备案材料',
        NOT_WAIT_FILING: '当前状态不可提交备案材料',
      }
      return setError(map[r.error] || r.error)
    }
    setItem(r.data)
    setMsg('备案材料已提交，等待店长复审')
  }

  if (!phone.trim()) {
    return (
      <div className="m-col">
        <div className="m-card">
          <div style={{ fontWeight: 800 }}>请先绑定手机号</div>
          <Link className="m-btn" to="/me/profile" style={{ marginTop: 12, display: 'inline-flex' }}>
            去填写手机号
          </Link>
        </div>
      </div>
    )
  }

  if (loading) return <div className="m-card m-muted">加载中…</div>
  if (error && !item) return <div className="m-card m-error">加载失败：{error}</div>
  if (!item) return <div className="m-card">未找到该申请</div>

  const canEditFiling = item.status === 'WAIT_FILING'

  return (
    <div className="m-col">
      <div className="m-card">
        <div className="m-row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <div className="m-h1">{item.applicationNo}</div>
          <span className="m-sublet-pill m-sublet-pill--wait">
            {tenantStatusLabel(item.status, item.statusLabel)}
          </span>
        </div>
        <div className="m-muted" style={{ marginTop: 8, fontSize: 13 }}>
          {item.storeName} · {item.apartmentName} · {item.houseNo}
        </div>
        <div className="m-kv" style={{ marginTop: 12 }}>
          <div className="m-k">合同</div>
          <div>{item.contractNo}</div>
          <div className="m-k">转租面积</div>
          <div>
            {item.subletArea}㎡{item.houseArea != null ? ` / 房源 ${item.houseArea}㎡` : ''}
          </div>
          <div className="m-k">转租单位</div>
          <div>{item.subletUnit}</div>
          {item.remark ? (
            <>
              <div className="m-k">说明</div>
              <div>{item.remark}</div>
            </>
          ) : null}
          <div className="m-k">提交时间</div>
          <div>{fmtDt(item.createdAt)}</div>
        </div>
      </div>

      {error ? <div className="m-card m-error">{error}</div> : null}
      {msg ? <div className="m-card m-success">{msg}</div> : null}

      <div className="m-card">
        <div style={{ fontWeight: 800, marginBottom: 10 }}>进度</div>
        {item.status === 'REJECTED' ? (
          <div className="m-sublet-hint m-sublet-hint--end">
            流程已结束{item.rejectReason ? `：${item.rejectReason}` : ''}
          </div>
        ) : (
          <div className="m-sublet-steps">
            {TENANT_STEPS.map((s, i) => {
              const done = idx > i || (idx === i && item.status === 'COMPLETED')
              const current = idx === i && item.status !== 'COMPLETED'
              return (
                <div
                  key={s.label}
                  className={`m-sublet-step${done ? ' is-done' : ''}${current ? ' is-current' : ''}`}
                >
                  <span className="m-sublet-step-dot" />
                  <span>{s.label}</span>
                </div>
              )
            })}
          </div>
        )}
        <div className="m-muted" style={{ marginTop: 10, fontSize: 12 }}>
          {item.reviewedAt ? `初审：${fmtDt(item.reviewedAt)} · ${item.reviewedByName || '—'}` : null}
          {item.filingSubmittedAt ? ` · 材料提交：${fmtDt(item.filingSubmittedAt)}` : null}
          {item.completedAt ? ` · 完成：${fmtDt(item.completedAt)}` : null}
        </div>
      </div>

      {(canEditFiling || item.filingMaterials.length > 0) && (
        <div className="m-card m-col" style={{ gap: 10 }}>
          <div style={{ fontWeight: 800 }}>备案材料</div>
          {item.filingRejectReason ? (
            <div className="m-sublet-hint m-sublet-hint--end">上次驳回：{item.filingRejectReason}</div>
          ) : null}
          {canEditFiling ? (
            <>
              <div className="m-muted" style={{ fontSize: 13 }}>
                OA 已通过，请上传合同、营业执照等相关材料后提交复审。
              </div>
              <label>
                <div className="m-muted">材料类型</div>
                <select
                  className="m-input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as typeof category)}
                  style={{ marginTop: 6 }}
                >
                  <option value="CONTRACT">合同</option>
                  <option value="LICENSE">营业执照</option>
                  <option value="OTHER">其他</option>
                </select>
              </label>
              <label className="m-btn secondary" style={{ textAlign: 'center' }}>
                {uploading ? '上传中…' : '选择文件上传'}
                <input
                  type="file"
                  hidden
                  disabled={uploading}
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null
                    e.target.value = ''
                    onUpload(f)
                  }}
                />
              </label>
            </>
          ) : null}

          {item.filingMaterials.length === 0 ? (
            <div className="m-muted">暂无材料</div>
          ) : (
            item.filingMaterials.map((f) => (
              <div key={f.id} className="m-row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 13, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div>
                  <div className="m-muted">{categoryZh(f.category)}</div>
                </div>
                <div className="m-row" style={{ gap: 6, flexShrink: 0 }}>
                  <button type="button" className="m-btn ghost" onClick={() => openFile(f.previewUrl, false, f.name)}>
                    查看
                  </button>
                  {canEditFiling ? (
                    <button type="button" className="m-btn ghost" onClick={() => removeFile(f.file)}>
                      删除
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}

          {canEditFiling ? (
            <button type="button" className="m-btn m-btn-block" onClick={submitFiling}>
              提交备案材料
            </button>
          ) : null}
        </div>
      )}

      <div className="m-card">
        <Link className="m-btn ghost m-btn-block" to="/me/sublets">
          返回列表
        </Link>
      </div>
    </div>
  )
}
