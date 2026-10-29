import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiDeleteSubletMinutesFile, apiGet, apiPost, apiUploadSubletMinutesFile } from '../api'
import { downloadFileWithAuth, previewFileWithAuth } from '../fileAuth'
import { Pagination, paginate } from '../components/Pagination'
import { CONTRACT_TEMPLATES } from '../contractTemplate'

type SubletFile = {
  id: string
  name: string
  file: string
  category: string | null
  adminPreviewUrl: string
  adminDownloadUrl: string
}

type SubletItem = {
  id: string
  applicationNo: string
  contractId: string
  contractNo: string
  proposedSubletDate?: string | null
  subletReason?: string | null
  tenantName: string
  tenantPhone: string
  storeId: string
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
  filingReviewedByName: string | null
  completedAt: string | null
  completedByName: string | null
  createdAt: string
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'PENDING_REVIEW':
    case 'FILING_REVIEW':
      return 'a-badge status-pending'
    case 'WAIT_OA':
    case 'WAIT_FILING':
    case 'WAIT_MINUTES':
      return 'a-badge status-ordered'
    case 'COMPLETED':
      return 'a-badge status-approved'
    case 'REJECTED':
      return 'a-badge status-rejected'
    default:
      return 'a-badge'
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
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString('zh-CN')
  } catch {
    return iso
  }
}

function mapSubletError(code: string) {
  const map: Record<string, string> = {
    NOT_PENDING_REVIEW: '当前不在待初审状态',
    NOT_WAIT_OA: '当前不在待 OA 登记状态',
    NOT_FILING_REVIEW: '当前不在备案材料复审状态',
    NOT_WAIT_MINUTES: '当前不在待上传会议纪要状态',
    REASON_REQUIRED: '驳回时须填写原因',
    MEETING_MINUTES_REQUIRED: '请先上传会议纪要附件',
    INVALID_BODY: '请求参数不正确',
  }
  return map[code] || code
}

export function SubletsPage() {
  const [searchParams] = useSearchParams()
  const [items, setItems] = useState<SubletItem[]>([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [q, setQ] = useState(() => searchParams.get('q') ?? searchParams.get('applicationNo') ?? '')
  const [status, setStatus] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [contractQuery, setContractQuery] = useState('')
  const [tenantQuery, setTenantQuery] = useState('')
  const [phoneQuery, setPhoneQuery] = useState('')
  const [appliedQueries, setAppliedQueries] = useState({ contract: '', tenant: '', phone: '' })
  const [contractTemplates, setContractTemplates] = useState<Record<string, string>>({})
  const [detail, setDetail] = useState<SubletItem | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const [applications, contracts] = await Promise.allSettled([
      apiGet<{ items: SubletItem[] }>('/api/admin/sublets'),
      apiGet<{ items: { id: string; contractTemplate?: string }[] }>('/api/admin/contracts'),
    ])
    setError('')
    if (applications.status === 'rejected') setError('转租申请加载失败，请重试。')
    else if (applications.value.ok) setItems(applications.value.data.items ?? [])
    else setError(applications.value.error)
    if (contracts.status === 'fulfilled' && contracts.value.ok) {
      setContractTemplates(Object.fromEntries(contracts.value.data.items.filter((contract) => contract.contractTemplate)
        .map((contract) => [contract.id, contract.contractTemplate as string])))
    } else setContractTemplates({})
  }

  useEffect(() => {
    let active = true
    // 异步启动首次请求；清理已卸载实例尚未开始的任务，手动刷新仍使用原 load。
    void Promise.resolve().then(() => {
      if (active) return load()
    })
    return () => { active = false }
  }, [])

  const filterOptions = useMemo(() => {
    const stores = Array.from(new Set(items.map((x) => x.storeName).filter(Boolean))).sort()
    return { stores }
  }, [items])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return items.filter((x) => {
      if (status && x.status !== status) return false
      if (storeFilter && x.storeName !== storeFilter) return false
      if (appliedQueries.contract && !x.contractNo.toLowerCase().includes(appliedQueries.contract.trim().toLowerCase())) return false
      if (appliedQueries.tenant && !x.tenantName.toLowerCase().includes(appliedQueries.tenant.trim().toLowerCase())) return false
      if (appliedQueries.phone && !x.tenantPhone.includes(appliedQueries.phone.trim())) return false
      if (!kw) return true
      const hay =
        `${x.applicationNo} ${x.contractNo} ${x.tenantName} ${x.tenantPhone} ${x.storeName} ${x.apartmentName} ${x.houseNo} ${x.subletUnit}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, status, storeFilter, appliedQueries])

  const pageData = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize])

  function openDetail(row: SubletItem) {
    setDetail(row)
    setReason('')
    setMsg('')
    setError('')
  }

  function syncDetail(next: SubletItem) {
    setDetail(next)
    setItems((prev) => prev.map((x) => (x.id === next.id ? next : x)))
  }

  async function doReview(approved: boolean) {
    if (!detail) return
    setBusy(true)
    setError('')
    setMsg('')
    const r = await apiPost<SubletItem>(`/api/admin/sublets/${detail.id}/review`, {
      approved,
      reason: reason.trim() || undefined,
    })
    setBusy(false)
    if (!r.ok) return setError(mapSubletError(r.error))
    syncDetail(r.data)
    setReason('')
    setMsg(approved ? '初审已通过，请等待/登记华创内部 OA 结果' : '已驳回，流程结束（状态已同步租户端）')
  }

  async function doOa(passed: boolean) {
    if (!detail) return
    setBusy(true)
    setError('')
    setMsg('')
    const r = await apiPost<SubletItem>(`/api/admin/sublets/${detail.id}/oa-result`, {
      passed,
      reason: reason.trim() || undefined,
    })
    setBusy(false)
    if (!r.ok) return setError(mapSubletError(r.error))
    syncDetail(r.data)
    setReason('')
    setMsg(passed ? '已登记 OA 通过，等待租户提交备案材料' : 'OA 未通过，流程结束')
  }

  async function doFilingReview(approved: boolean) {
    if (!detail) return
    setBusy(true)
    setError('')
    setMsg('')
    const r = await apiPost<SubletItem>(`/api/admin/sublets/${detail.id}/filing-review`, {
      approved,
      reason: reason.trim() || undefined,
    })
    setBusy(false)
    if (!r.ok) return setError(mapSubletError(r.error))
    syncDetail(r.data)
    setReason('')
    setMsg(approved ? '备案材料已通过，请上传会议纪要' : '已打回，租户需重新提交备案材料')
  }

  async function onUploadMinutes(file: File | null) {
    if (!detail || !file) return
    setBusy(true)
    setError('')
    const r = await apiUploadSubletMinutesFile<SubletItem>(detail.id, file)
    setBusy(false)
    if (!r.ok) return setError(mapSubletError(r.error))
    syncDetail(r.data)
    setMsg('会议纪要已上传')
  }

  async function onDeleteMinutes(fileKey: string) {
    if (!detail) return
    setBusy(true)
    const r = await apiDeleteSubletMinutesFile<SubletItem>(detail.id, fileKey)
    setBusy(false)
    if (!r.ok) return setError(mapSubletError(r.error))
    syncDetail(r.data)
  }

  async function doComplete() {
    if (!detail) return
    setBusy(true)
    setError('')
    setMsg('')
    const r = await apiPost<SubletItem>(`/api/admin/sublets/${detail.id}/complete`, {})
    setBusy(false)
    if (!r.ok) return setError(mapSubletError(r.error))
    syncDetail(r.data)
    setMsg('转租申请已完成')
  }

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">转租审核</div>
        <p className="a-muted">合同模板取自本地合同列表；当前接口未提供拟转租日期、转租原因时显示“—”。资料项配置重载尚待核对，原审核流程继续保留。</p>
        <div className="a-muted">
          租户发起转租申请记录：店长初审 → 登记华创内部 OA（线下）→ 租户提交备案材料 → 复审 → 上传会议纪要结案。
        </div>
      </div>

      {error && !detail ? <div className="a-card a-error">加载失败：{error}</div> : null}
      {msg && !detail ? <div className="a-card a-success">{msg}</div> : null}

      <div className="a-card a-row" style={{ justifyContent: 'space-between' }}>
        <div className="a-filterbar" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="a-filter-label">筛选</span>
          <input
            className="a-filter-input"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
            placeholder="申请号/合同/租客/房号/转租单位"
            style={{ minWidth: 220 }}
          />
          <label className="a-col" style={{ gap: 4 }}>合同号<input className="a-filter-input" value={contractQuery}
            placeholder="请输入合同号" onChange={(event) => setContractQuery(event.target.value)} /></label>
          <label className="a-col" style={{ gap: 4 }}>租客<input className="a-filter-input" value={tenantQuery}
            placeholder="请输入租客姓名" onChange={(event) => setTenantQuery(event.target.value)} /></label>
          <label className="a-col" style={{ gap: 4 }}>手机号<input className="a-filter-input" type="tel" value={phoneQuery}
            placeholder="请输入手机号" onChange={(event) => setPhoneQuery(event.target.value)} /></label>
          <select
            className="a-filter-select"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
          >
            <option value="">全部状态</option>
            <option value="PENDING_REVIEW">待初审</option>
            <option value="WAIT_OA">待OA审批</option>
            <option value="WAIT_FILING">待提交备案材料</option>
            <option value="FILING_REVIEW">待复审备案材料</option>
            <option value="WAIT_MINUTES">待上传会议纪要</option>
            <option value="COMPLETED">已完成</option>
            <option value="REJECTED">已结束</option>
          </select>
          <select
            className="a-filter-select"
            value={storeFilter}
            onChange={(e) => {
              setStoreFilter(e.target.value)
              setPage(1)
            }}
          >
            <option value="">全部门店</option>
            {filterOptions.stores.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="button" className="a-btn" onClick={() => {
            setAppliedQueries({ contract: contractQuery.trim(), tenant: tenantQuery.trim(), phone: phoneQuery.trim() }); setPage(1)
          }}>搜索</button>
          <button
            type="button"
            className="a-btn ghost"
            onClick={() => {
              setQ('')
              setStatus('')
              setStoreFilter('')
              setContractQuery('')
              setTenantQuery('')
              setPhoneQuery('')
              setAppliedQueries({ contract: '', tenant: '', phone: '' })
              setPage(1)
            }}
          >
            重置
          </button>
          <button type="button" className="a-btn secondary" onClick={load}>
            刷新
          </button>
        </div>
      </div>

      <div className="a-card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="a-table">
          <thead>
            <tr>
              <th>ID / 申请号</th>
              <th>状态</th>
              <th>合同号</th>
              <th>合同模板</th>
              <th>租客</th>
              <th>手机号</th>
              <th>拟转租日期</th>
              <th>转租原因</th>
              <th>申请时间</th>
              <th title="原 DEMO 初审记录">审核人/时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {pageData.items.length === 0 ? (
              <tr>
                <td colSpan={11} className="a-muted" style={{ textAlign: 'center', padding: 24 }}>
                  暂无转租申请
                </td>
              </tr>
            ) : (
              pageData.items.map((x) => (
                <tr key={x.id}>
                  <td>{x.applicationNo}<div className="a-muted" style={{ fontSize: 11 }}>{x.id}</div></td>
                  <td>
                    <span className={statusBadgeClass(x.status)}>{x.statusLabel}</span>
                  </td>
                  <td>{x.contractNo}<div className="a-muted">{x.storeName} · {x.apartmentName} · {x.houseNo}</div></td>
                  <td>{(() => {
                    const value = contractTemplates[x.contractId]
                    if (!value) return '—'
                    const key = value === 'TRIPARTITE' ? 'NON_RESIDENTIAL' : value === 'APARTMENT' ? 'RESIDENTIAL_ASSET' : value
                    return CONTRACT_TEMPLATES.find((template) => template.value === key)?.label ?? value
                  })()}</td>
                  <td>{x.tenantName}</td>
                  <td>{x.tenantPhone}</td>
                  <td>{x.proposedSubletDate?.slice(0, 10) || '—'}</td>
                  <td>{x.subletReason?.trim() || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDt(x.createdAt)}</td>
                  <td title="原 DEMO 初审记录，不推断为最新审批节点"><div>{x.reviewedByName || '—'}</div><div className="a-muted">{fmtDt(x.reviewedAt)}</div></td>
                  <td>
                    <button type="button" className="a-btn ghost" onClick={() => openDetail(x)}>
                      处理
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={filtered.length}
        onChange={({ page: p, pageSize: ps }) => {
          setPage(p)
          setPageSize(ps)
        }}
      />

      {detail ? (
        <div className="a-modal-backdrop" onClick={() => !busy && setDetail(null)}>
          <div
            className="a-modal a-modal--contract-detail"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal
          >
            <div className="a-modal-header">
              <div className="a-modal-title">
                转租申请 · {detail.applicationNo}{' '}
                <span className={statusBadgeClass(detail.status)} style={{ marginLeft: 8 }}>
                  {detail.statusLabel}
                </span>
              </div>
              <button type="button" className="a-modal-close" onClick={() => setDetail(null)} disabled={busy}>
                ×
              </button>
            </div>
            <div className="a-modal-body a-col" style={{ gap: 14 }}>
              {error ? <div className="a-error">{error}</div> : null}
              {msg ? <div className="a-success">{msg}</div> : null}

              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">合同</div>
                  <div className="a-kv-v">{detail.contractNo}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">房源</div>
                  <div className="a-kv-v">
                    {detail.storeName} · {detail.apartmentName} · {detail.houseNo}
                    {detail.houseArea != null ? `（${detail.houseArea}㎡）` : ''}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">租客</div>
                  <div className="a-kv-v">
                    {detail.tenantName} · {detail.tenantPhone}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">转租面积</div>
                  <div className="a-kv-v">{detail.subletArea}㎡</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">转租单位</div>
                  <div className="a-kv-v">{detail.subletUnit}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">说明</div>
                  <div className="a-kv-v">{detail.remark || '—'}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">提交时间</div>
                  <div className="a-kv-v">{fmtDt(detail.createdAt)}</div>
                </div>
                {detail.rejectReason ? (
                  <div className="a-kv-row">
                    <div className="a-kv-k">结束原因</div>
                    <div className="a-kv-v">{detail.rejectReason}</div>
                  </div>
                ) : null}
              </div>

              <div className="a-muted" style={{ fontSize: 12 }}>
                {[
                  detail.reviewedAt ? `初审 ${fmtDt(detail.reviewedAt)} · ${detail.reviewedByName || '—'}` : null,
                  detail.oaPassedAt ? `OA ${fmtDt(detail.oaPassedAt)} · ${detail.oaRecordedByName || '—'}` : null,
                  detail.filingSubmittedAt ? `材料提交 ${fmtDt(detail.filingSubmittedAt)}` : null,
                  detail.filingReviewedAt
                    ? `材料复审 ${fmtDt(detail.filingReviewedAt)} · ${detail.filingReviewedByName || '—'}`
                    : null,
                  detail.completedAt ? `完成 ${fmtDt(detail.completedAt)} · ${detail.completedByName || '—'}` : null,
                ]
                  .filter(Boolean)
                  .join(' ｜ ') || '尚未进入后续节点'}
              </div>

              {detail.filingMaterials.length > 0 ? (
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>备案材料</div>
                  {detail.filingRejectReason ? (
                    <div className="a-muted" style={{ marginBottom: 8 }}>
                      上次打回原因：{detail.filingRejectReason}
                    </div>
                  ) : null}
                  <div className="a-col" style={{ gap: 6 }}>
                    {detail.filingMaterials.map((f) => (
                      <div key={f.id} className="a-row" style={{ justifyContent: 'space-between', gap: 8 }}>
                        <div>
                          <span style={{ fontWeight: 600 }}>{f.name}</span>
                          <span className="a-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                            {categoryZh(f.category)}
                          </span>
                        </div>
                        <div className="a-row" style={{ gap: 6 }}>
                          <button
                            type="button"
                            className="a-btn ghost"
                            onClick={() => previewFileWithAuth(f.adminPreviewUrl)}
                          >
                            预览
                          </button>
                          <button
                            type="button"
                            className="a-btn ghost"
                            onClick={() => downloadFileWithAuth(f.adminDownloadUrl, f.name)}
                          >
                            下载
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {detail.meetingMinutes.length > 0 || detail.status === 'WAIT_MINUTES' ? (
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>会议纪要</div>
                  <div className="a-col" style={{ gap: 6 }}>
                    {detail.meetingMinutes.map((f) => (
                      <div key={f.id} className="a-row" style={{ justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ fontWeight: 600 }}>{f.name}</div>
                        <div className="a-row" style={{ gap: 6 }}>
                          <button
                            type="button"
                            className="a-btn ghost"
                            onClick={() => previewFileWithAuth(f.adminPreviewUrl)}
                          >
                            预览
                          </button>
                          {detail.status === 'WAIT_MINUTES' ? (
                            <button
                              type="button"
                              className="a-btn ghost"
                              disabled={busy}
                              onClick={() => onDeleteMinutes(f.file)}
                            >
                              删除
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    {detail.status === 'WAIT_MINUTES' ? (
                      <label className="a-btn secondary" style={{ alignSelf: 'flex-start' }}>
                        上传会议纪要
                        <input
                          type="file"
                          hidden
                          disabled={busy}
                          accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null
                            e.target.value = ''
                            onUploadMinutes(f)
                          }}
                        />
                      </label>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {(detail.status === 'PENDING_REVIEW' ||
                detail.status === 'WAIT_OA' ||
                detail.status === 'FILING_REVIEW') && (
                <label>
                  <div className="a-muted">驳回/不通过原因（通过时可空）</div>
                  <textarea
                    className="a-input"
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="驳回时必填"
                    style={{ width: '100%', marginTop: 6 }}
                  />
                </label>
              )}

              <div className="a-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {detail.status === 'PENDING_REVIEW' ? (
                  <>
                    <button type="button" className="a-btn" disabled={busy} onClick={() => doReview(true)}>
                      初审通过
                    </button>
                    <button type="button" className="a-btn secondary" disabled={busy} onClick={() => doReview(false)}>
                      初审不通过（结束）
                    </button>
                  </>
                ) : null}
                {detail.status === 'WAIT_OA' ? (
                  <>
                    <button type="button" className="a-btn" disabled={busy} onClick={() => doOa(true)}>
                      登记 OA 通过
                    </button>
                    <button type="button" className="a-btn secondary" disabled={busy} onClick={() => doOa(false)}>
                      登记 OA 不通过（结束）
                    </button>
                    <div className="a-muted" style={{ width: '100%', fontSize: 12 }}>
                      华创内部 OA 为非本系统操作，请在线下 OA 完成后在此登记结果。
                    </div>
                  </>
                ) : null}
                {detail.status === 'WAIT_FILING' ? (
                  <div className="a-muted">等待租户在 H5 提交备案材料…</div>
                ) : null}
                {detail.status === 'FILING_REVIEW' ? (
                  <>
                    <button type="button" className="a-btn" disabled={busy} onClick={() => doFilingReview(true)}>
                      材料复审通过
                    </button>
                    <button
                      type="button"
                      className="a-btn secondary"
                      disabled={busy}
                      onClick={() => doFilingReview(false)}
                    >
                      打回重新提交
                    </button>
                  </>
                ) : null}
                {detail.status === 'WAIT_MINUTES' ? (
                  <button type="button" className="a-btn" disabled={busy} onClick={doComplete}>
                    确认完成
                  </button>
                ) : null}
                <button type="button" className="a-btn ghost" disabled={busy} onClick={() => setDetail(null)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
