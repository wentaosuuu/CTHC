import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPatch, apiPost } from '../api'
import { Pagination, paginate } from '../components/Pagination'

type CreditTier = 'A' | 'B' | 'C' | 'D'
type TenantKind = 'INDIVIDUAL' | 'ENTERPRISE'

type TenantRow = {
  id: string
  name: string
  phone: string
  wechat: string | null
  idDocType: string
  idNumberMasked: string
  creditTier: CreditTier
  tenantKind: TenantKind
  tenantKindLabel: string
  mobileVerified: boolean
  mobileVerifiedLabel: string
  createdSource: string
  createdByLabel: string
  enteredAt: string
  orderCount: number
  contractCount: number
}

type TenantOpLogRow = {
  id: string
  actionLabel: string
  detail: string
  occurredAt: string
  operatorName: string
  operatorEmail: string
  operatorKind: string
  synthetic?: boolean
}

const DOC_ZH: Record<string, string> = {
  IDCARD: '身份证',
  PASSPORT: '护照',
  HKM_TW_PERMIT: '港澳台通行证',
  USCC: '统一社会信用代码',
}

function fmtEntered(iso: string) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${day} ${hh}:${mm}`
  } catch {
    return iso
  }
}

function apiErrorZh(err: string) {
  if (err === 'PHONE_ALREADY_EXISTS') return '该手机号已存在租客档案'
  if (err === 'INVALID_USCC') return '统一社会信用代码格式不正确（须为 18 位）'
  if (err === 'INVALID_ID_NUMBER') return '身份证号格式不正确（须为 18 位）'
  return err
}

const defaultCreateForm = () => ({
  tenantKind: 'INDIVIDUAL' as TenantKind,
  name: '',
  phone: '',
  idNumber: '',
  wechat: '',
})

export function TenantProfilesPage() {
  const [items, setItems] = useState<TenantRow[]>([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [q, setQ] = useState('')
  const [tierFilter, setTierFilter] = useState<CreditTier | ''>('')
  const [kindFilter, setKindFilter] = useState<TenantKind | ''>('')
  const [verifiedFilter, setVerifiedFilter] = useState<'' | 'yes' | 'no'>('')

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState(defaultCreateForm)
  const [createSubmitting, setCreateSubmitting] = useState(false)

  const [logModalRow, setLogModalRow] = useState<TenantRow | null>(null)
  const [opLogs, setOpLogs] = useState<TenantOpLogRow[]>([])
  const [opLogsLoading, setOpLogsLoading] = useState(false)
  const [opLogsError, setOpLogsError] = useState('')

  async function load() {
    setError('')
    const r = await apiGet<{ items: TenantRow[] }>('/api/admin/tenants')
    if (!r.ok) return setError(r.error)
    setItems(r.data.items ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function saveTier(id: string, creditTier: CreditTier) {
    setError('')
    setSavingId(id)
    const r = await apiPatch<{ ok: true; item: TenantRow }>(`/api/admin/tenants/${encodeURIComponent(id)}`, {
      creditTier,
    })
    setSavingId(null)
    if (!r.ok) return setError(r.error)
    setItems((prev) => prev.map((x) => (x.id === id ? r.data.item : x)))
  }

  function openCreate() {
    setCreateForm(defaultCreateForm())
    setCreateOpen(true)
    setError('')
    setMsg('')
  }

  async function openOpLogModal(row: TenantRow) {
    setLogModalRow(row)
    setOpLogs([])
    setOpLogsError('')
    setOpLogsLoading(true)
    const r = await apiGet<{ tenantName: string; items: TenantOpLogRow[] }>(
      `/api/admin/tenants/${encodeURIComponent(row.id)}/operation-logs`,
    )
    setOpLogsLoading(false)
    if (!r.ok) {
      setOpLogsError(r.error)
      return
    }
    setOpLogs(r.data.items ?? [])
  }

  async function submitCreate() {
    if (!createForm.name.trim()) return setError('请填写名称')
    if (!createForm.phone.trim()) return setError('请填写手机号')
    if (!createForm.idNumber.trim()) {
      return setError(createForm.tenantKind === 'ENTERPRISE' ? '请填写统一社会信用代码' : '请填写身份证号')
    }
    setCreateSubmitting(true)
    setError('')
    const r = await apiPost<{ ok: true; item: TenantRow }>('/api/admin/tenants', {
      tenantKind: createForm.tenantKind,
      name: createForm.name.trim(),
      phone: createForm.phone.trim(),
      idNumber: createForm.idNumber.trim(),
      wechat: createForm.wechat.trim() || null,
    })
    setCreateSubmitting(false)
    if (!r.ok) return setError(apiErrorZh(r.error))
    setItems((prev) => [r.data.item, ...prev])
    setCreateOpen(false)
    setMsg(`已新增${createForm.tenantKind === 'ENTERPRISE' ? '企业' : '个人'}租客档案`)
  }

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return items.filter((x) => {
      if (tierFilter && x.creditTier !== tierFilter) return false
      if (kindFilter && x.tenantKind !== kindFilter) return false
      if (verifiedFilter === 'yes' && !x.mobileVerified) return false
      if (verifiedFilter === 'no' && x.mobileVerified) return false
      if (!kw) return true
      const hay =
        `${x.name} ${x.phone} ${x.wechat ?? ''} ${x.idNumberMasked} ${x.idDocType} ${x.createdByLabel} ${x.tenantKindLabel}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, tierFilter, kindFilter, verifiedFilter])

  const pageData = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize])

  useEffect(() => {
    setPage(1)
  }, [q, tierFilter, kindFilter, verifiedFilter, pageSize])

  const idLabel = createForm.tenantKind === 'ENTERPRISE' ? '统一社会信用代码' : '身份证号'
  const nameLabel = createForm.tenantKind === 'ENTERPRISE' ? '企业名称' : '姓名'

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">租客档案</div>
        <div className="a-muted" style={{ marginTop: 6 }}>
          记录租客基本信息、实名状态与档案来源。店长可在后台代建档案；租客在移动端下单或实名后也会自动入档。
        </div>
      </div>

      {error ? (
        <div className="a-card a-error" style={{ marginTop: 12 }}>
          操作失败：{error}
        </div>
      ) : null}
      {msg ? (
        <div className="a-card a-success" style={{ marginTop: 12 }}>
          {msg}
        </div>
      ) : null}

      <div className="a-card" style={{ marginTop: 12 }}>
        <div className="a-row" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="a-row" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'center', flex: 1 }}>
            <input
              className="a-input"
              style={{ minWidth: 220, flex: '1 1 200px' }}
              placeholder="按姓名、手机、证件、创建人搜索…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="a-input"
              style={{ width: 120 }}
              value={kindFilter}
              onChange={(e) => setKindFilter((e.target.value || '') as TenantKind | '')}
            >
              <option value="">全部类型</option>
              <option value="INDIVIDUAL">个人</option>
              <option value="ENTERPRISE">企业</option>
            </select>
            <select
              className="a-input"
              style={{ width: 120 }}
              value={verifiedFilter}
              onChange={(e) => setVerifiedFilter((e.target.value || '') as '' | 'yes' | 'no')}
            >
              <option value="">全部实名</option>
              <option value="yes">已实名</option>
              <option value="no">未实名</option>
            </select>
            <select
              className="a-input"
              style={{ width: 120 }}
              value={tierFilter}
              onChange={(e) => setTierFilter((e.target.value || '') as CreditTier | '')}
            >
              <option value="">全部等级</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
            </select>
          </div>
          <button type="button" className="a-btn" onClick={openCreate}>
            新增租客
          </button>
        </div>

        <div className="a-table-wrap" style={{ marginTop: 14 }}>
          <table className="a-table a-table-sticky-op" style={{ minWidth: 1280 }}>
            <thead>
              <tr>
                <th>类型</th>
                <th>姓名/企业名</th>
                <th>手机号</th>
                <th>证件类型</th>
                <th>证件号</th>
                <th>是否实名</th>
                <th>信誉度</th>
                <th>创建来源</th>
                <th>入档时间</th>
                <th>订单</th>
                <th>合同</th>
                <th style={{ minWidth: 140 }}>调整等级</th>
                <th className="a-op-col">操作</th>
              </tr>
            </thead>
            <tbody>
              {pageData.items.length === 0 ? (
                <tr>
                  <td colSpan={13} className="a-muted">
                    暂无租客档案。可点击「新增租客」代建档案，或等待租客在移动端下单/实名后自动入档。
                  </td>
                </tr>
              ) : (
                pageData.items.map((row) => (
                  <tr key={row.id}>
                    <td>{row.tenantKindLabel}</td>
                    <td style={{ fontWeight: 800 }} title="已脱敏展示">
                      {row.name}
                    </td>
                    <td title="已脱敏展示">{row.phone}</td>
                    <td>{DOC_ZH[row.idDocType] ?? row.idDocType}</td>
                    <td className="a-muted" style={{ fontSize: 12 }} title="已脱敏展示">
                      {row.idNumberMasked}
                    </td>
                    <td>
                      <span className={row.mobileVerified ? 'a-badge status-active' : 'a-badge status-wait-sign'}>
                        {row.mobileVerifiedLabel}
                      </span>
                    </td>
                    <td>
                      <span className={`a-tier-badge a-tier-${row.creditTier.toLowerCase()}`}>{row.creditTier}</span>
                    </td>
                    <td className="a-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }} title={row.createdByLabel}>
                      {row.createdByLabel}
                    </td>
                    <td className="a-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {fmtEntered(row.enteredAt)}
                    </td>
                    <td>{row.orderCount}</td>
                    <td>{row.contractCount}</td>
                    <td>
                      <div className="a-row" style={{ gap: 6, alignItems: 'center' }}>
                        <select
                          className="a-input"
                          style={{ width: 72, padding: '6px 8px', fontSize: 13 }}
                          value={row.creditTier}
                          disabled={savingId === row.id}
                          onChange={(e) => {
                            const v = e.target.value as CreditTier
                            if (v !== row.creditTier) void saveTier(row.id, v)
                          }}
                        >
                          <option value="A">A</option>
                          <option value="B">B</option>
                          <option value="C">C</option>
                          <option value="D">D</option>
                        </select>
                        {savingId === row.id ? <span className="a-muted" style={{ fontSize: 12 }}>保存中…</span> : null}
                      </div>
                    </td>
                    <td className="a-op-cell">
                      <button type="button" className="a-btn ghost" onClick={() => void openOpLogModal(row)}>
                        操作记录
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          total={pageData.total}
          page={pageData.page}
          pageSize={pageData.pageSize}
          onChange={(p) => {
            setPage(p.page)
            setPageSize(p.pageSize)
          }}
        />
      </div>

      {createOpen ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setCreateOpen(false)}
        >
          <div className="a-modal a-modal--narrow" onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">新增租客档案</div>
              <button type="button" className="a-modal-close" onClick={() => setCreateOpen(false)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">用户类型</div>
                  <div className="a-kv-v">
                    <select
                      className="a-filter-select"
                      style={{ width: '100%', maxWidth: 320 }}
                      value={createForm.tenantKind}
                      onChange={(e) =>
                        setCreateForm((f) => ({
                          ...f,
                          tenantKind: e.target.value as TenantKind,
                          idNumber: '',
                        }))
                      }
                    >
                      <option value="INDIVIDUAL">个人</option>
                      <option value="ENTERPRISE">企业</option>
                    </select>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">{nameLabel}</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      style={{ width: '100%' }}
                      value={createForm.name}
                      onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder={createForm.tenantKind === 'ENTERPRISE' ? '例如：广西某某科技有限公司' : '例如：张三'}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">手机号</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      style={{ width: '100%', maxWidth: 280 }}
                      value={createForm.phone}
                      onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                      placeholder="联系人手机号"
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">{idLabel}</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      style={{ width: '100%' }}
                      value={createForm.idNumber}
                      onChange={(e) => setCreateForm((f) => ({ ...f, idNumber: e.target.value }))}
                      placeholder={createForm.tenantKind === 'ENTERPRISE' ? '18 位统一社会信用代码' : '18 位身份证号'}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">微信（选填）</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      style={{ width: '100%', maxWidth: 280 }}
                      value={createForm.wechat}
                      onChange={(e) => setCreateForm((f) => ({ ...f, wechat: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
              <div className="a-muted" style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6 }}>
                后台新建的档案将记录为「后台·当前操作人」。实名状态默认为未实名，待租客在移动端完成实名认证后更新。
              </div>
              <div className="a-row" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="a-btn ghost" onClick={() => setCreateOpen(false)}>
                  取消
                </button>
                <button type="button" className="a-btn" disabled={createSubmitting} onClick={() => void submitCreate()}>
                  {createSubmitting ? '保存中…' : '确定新增'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {logModalRow ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setLogModalRow(null)}
        >
          <div className="a-modal a-modal--change-log" onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">操作记录 · {logModalRow.name}</div>
              <button type="button" className="a-modal-close" onClick={() => setLogModalRow(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body">
              {opLogsLoading ? <div className="a-muted">加载中…</div> : null}
              {opLogsError ? <div className="a-card a-error">加载失败：{opLogsError}</div> : null}
              {!opLogsLoading && !opLogsError && opLogs.length === 0 ? (
                <div className="a-muted">暂无操作记录。</div>
              ) : null}
              {!opLogsLoading && !opLogsError && opLogs.length > 0 ? (
                <div className="a-table-wrap a-change-log-wrap">
                  <table className="a-table a-change-log-table" style={{ minWidth: 880, width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ width: 140 }}>操作类型</th>
                        <th>说明</th>
                        <th style={{ width: 168 }}>操作时间</th>
                        <th style={{ width: 200 }}>操作人</th>
                      </tr>
                    </thead>
                    <tbody>
                      {opLogs.map((row) => (
                        <tr key={row.id}>
                          <td style={{ fontWeight: 800 }}>{row.actionLabel}</td>
                          <td className="a-change-log-cell">{row.detail || '—'}</td>
                          <td className="a-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                            {fmtEntered(row.occurredAt)}
                          </td>
                          <td style={{ fontSize: 12 }}>
                            <div style={{ fontWeight: 800 }}>{row.operatorName}</div>
                            {row.operatorEmail ? <div className="a-muted">{row.operatorEmail}</div> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
