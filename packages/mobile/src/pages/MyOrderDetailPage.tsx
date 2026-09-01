import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  apiGet,
  apiPost,
  getMyOrders,
  getTenantPhone,
  type MyOrderSummary,
} from '../api'

type OrderAttachmentItem = {
  id: string
  name: string
  file: string
  category: string
  previewUrl?: string
  downloadUrl?: string
}

type TenantOrderDetail = {
  id: string
  status: string
  reviewReason: string | null
  createdAt: string
  leaseMonths: number
  moveInDate: string
  needsOrderAttachments: boolean
  attachments: OrderAttachmentItem[]
  tenant: { name: string; phone: string; idDocType: string }
  house: {
    id: string
    apartmentName: string
    houseNo: string
    storeName: string
    assetType: string
    rentMonthly: number
  }
  contractId: string | null
  contractStatus: string | null
  contractNo: string | null
}

function orderStatusZh(status: string) {
  switch (status) {
    case 'PENDING_REVIEW':
      return '待审核'
    case 'NEED_REVISION':
      return '需修改后重提'
    case 'APPROVED':
      return '已通过审核'
    case 'REJECTED':
      return '已拒绝'
    case 'CANCELLED':
      return '已取消'
    default:
      return status
  }
}

function categoryLabel(cat: string) {
  if (cat === 'DEAL_CONFIRMATION') return '成交确认书'
  if (cat === 'BUSINESS_LICENSE') return '营业执照'
  return '其他附件'
}

export function MyOrderDetailPage() {
  const { id } = useParams()
  const phone = getTenantPhone()
  const localOrder = useMemo<MyOrderSummary | null>(() => {
    if (!id) return null
    return getMyOrders().find((o) => o.id === id) ?? null
  }, [id])

  const [detail, setDetail] = useState<TenantOrderDetail | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)

  async function reload() {
    if (!id || !phone) return
    const r = await apiGet<TenantOrderDetail>(`/api/orders/${encodeURIComponent(id)}`, {
      headers: { 'x-tenant-phone': phone },
    })
    if (!r.ok) {
      setLoadErr(r.error)
      setDetail(null)
      return
    }
    setLoadErr('')
    setDetail(r.data)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, phone])

  async function uploadAttachment(category: 'DEAL_CONFIRMATION' | 'BUSINESS_LICENSE', file: File | null) {
    if (!file || !id || !phone) return
    setUploading(true)
    setError('')
    setMsg('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('category', category)
    const res = await fetch(`/api/orders/${encodeURIComponent(id)}/attachment`, {
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
    const data = (await res.json()) as { attachments: OrderAttachmentItem[] }
    setDetail((prev) => (prev ? { ...prev, attachments: data.attachments } : prev))
    setMsg('附件已上传')
  }

  async function resubmit() {
    if (!id || !phone) return
    setError('')
    setMsg('')
    const r = await apiPost<{ ok: true; status: string }>(
      `/api/orders/${encodeURIComponent(id)}/resubmit`,
      {},
      { headers: { 'x-tenant-phone': phone } },
    )
    if (!r.ok) {
      const map: Record<string, string> = {
        DEAL_CONFIRMATION_REQUIRED: '请先上传成交确认书',
        BUSINESS_LICENSE_REQUIRED: '企业租户请上传营业执照',
        NOT_NEED_REVISION: '当前订单无需重提',
      }
      return setError(map[r.error] || r.error)
    }
    setMsg('已重新提交，等待店长审核')
    await reload()
  }

  if (!id) {
    return <div className="m-card m-error">未找到该订单。</div>
  }

  if (!phone && !localOrder) {
    return <div className="m-card m-muted">请先绑定手机号后再查看订单详情。</div>
  }

  if (phone && !detail && !loadErr) {
    return <div className="m-card m-muted">正在加载订单详情…</div>
  }

  if (loadErr && !localOrder) {
    return <div className="m-card m-error">无法加载订单：{loadErr}</div>
  }

  const status = detail?.status
  const canEditAttachments =
    status === 'PENDING_REVIEW' || status === 'NEED_REVISION'
  const isEnterprise = detail?.tenant.idDocType === 'USCC'
  const houseTitle = detail
    ? `${detail.house.apartmentName} · ${detail.house.houseNo}`
    : localOrder?.houseTitle ?? '订单详情'
  const houseSubtitle = detail
    ? `${detail.house.storeName} · ${detail.house.assetType}`
    : localOrder?.houseSubtitle ?? `订单号：${id}`

  return (
    <div className="m-col">
      <div className="m-card">
        <div className="m-h1">{houseTitle}</div>
        <div className="m-muted" style={{ marginTop: 4 }}>
          {houseSubtitle}
        </div>
        <div style={{ height: 12 }} />
        <div className="m-kv">
          <div className="m-k">订单号</div>
          <div>{id}</div>
          <div className="m-k">提交时间</div>
          <div>
            {new Date(detail?.createdAt ?? localOrder?.createdAt ?? Date.now()).toLocaleString()}
          </div>
          {(detail?.house.rentMonthly ?? localOrder?.rentMonthly) ? (
            <>
              <div className="m-k">月租</div>
              <div>¥{detail?.house.rentMonthly ?? localOrder?.rentMonthly}/月</div>
            </>
          ) : null}
          <div className="m-k">当前状态</div>
          <div>
            {detail
              ? orderStatusZh(detail.status)
              : localOrder?.statusText ?? '已提交，等待管理员审核'}
          </div>
          {detail?.reviewReason ? (
            <>
              <div className="m-k">退回原因</div>
              <div style={{ color: '#b91c1c' }}>{detail.reviewReason}</div>
            </>
          ) : null}
        </div>
      </div>

      {detail?.needsOrderAttachments && canEditAttachments ? (
        <div className="m-card m-col">
          <div style={{ fontWeight: 900 }}>
            {status === 'NEED_REVISION' ? '按店长要求修改附件后重提' : '意向附件'}
          </div>
          <div className="m-muted" style={{ marginTop: 6 }}>
            需上传成交确认书{isEnterprise ? '与营业执照' : ''}。
          </div>
          <div style={{ marginTop: 12 }}>
            <label className="m-muted m-label-required">成交确认书</label>
            <input
              className="m-input"
              type="file"
              accept="image/*,.pdf"
              disabled={uploading}
              onChange={(e) => void uploadAttachment('DEAL_CONFIRMATION', e.target.files?.[0] ?? null)}
            />
          </div>
          {isEnterprise ? (
            <div>
              <label className="m-muted m-label-required">营业执照</label>
              <input
                className="m-input"
                type="file"
                accept="image/*,.pdf"
                disabled={uploading}
                onChange={(e) => void uploadAttachment('BUSINESS_LICENSE', e.target.files?.[0] ?? null)}
              />
            </div>
          ) : null}
          {detail.attachments.length > 0 ? (
            <ul className="m-muted" style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
              {detail.attachments.map((a) => (
                <li key={a.id}>
                  {categoryLabel(a.category)} · {a.name}
                </li>
              ))}
            </ul>
          ) : null}
          {status === 'NEED_REVISION' ? (
            <button type="button" className="m-btn" style={{ marginTop: 12 }} disabled={uploading} onClick={() => void resubmit()}>
              重新提交审核
            </button>
          ) : null}
        </div>
      ) : null}

      {detail?.attachments && detail.attachments.length > 0 && !canEditAttachments ? (
        <div className="m-card">
          <div style={{ fontWeight: 900 }}>已提交附件</div>
          <ul className="m-muted" style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
            {detail.attachments.map((a) => (
              <li key={a.id}>
                {categoryLabel(a.category)} · {a.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detail?.contractId && detail.contractStatus === 'WAIT_TENANT_SIGN' ? (
        <div className="m-card">
          <div style={{ fontWeight: 900 }}>合同待确认</div>
          <div className="m-muted" style={{ marginTop: 6 }}>
            华创内部 OA 已通过，请前往合同页确认并签字。
          </div>
          <Link className="m-btn" style={{ marginTop: 12, display: 'inline-block' }} to={`/contracts/${detail.contractId}`}>
            去合同页
          </Link>
        </div>
      ) : null}

      {detail?.contractId && detail.contractStatus === 'WAIT_INTERNAL_OA' ? (
        <div className="m-card m-muted">合同已配置，正在等待内部审批（华创 OA），通过后可确认签字。</div>
      ) : null}

      {error ? <div className="m-card m-error">{error}</div> : null}
      {msg ? <div className="m-card m-success">{msg}</div> : null}
    </div>
  )
}
