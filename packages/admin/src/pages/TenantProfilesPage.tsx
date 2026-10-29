import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPatch, apiPost } from '../api'
import { Pagination, paginate } from '../components/Pagination'
import { DemoDialog } from '../components/DemoDialog'

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
  associationStatus?: string | null
  associationStatusLabel?: string | null
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

type TenantSupplement = {
  nature: string; legalRepresentative: string; documentAddress: string; contact: string
  emergencyContact: string; emergencyPhone: string; updatedAt: string
}
const TENANT_SUPPLEMENT_KEY = 'cthc.prototype-sync.v1.tenant-supplements'
function emptySupplement(): TenantSupplement {
  return { nature: '', legalRepresentative: '', documentAddress: '', contact: '', emergencyContact: '', emergencyPhone: '', updatedAt: '' }
}
function readTenantSupplements(): Record<string, TenantSupplement> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TENANT_SUPPLEMENT_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1 || !('records' in parsed)
      || !parsed.records || typeof parsed.records !== 'object' || Array.isArray(parsed.records)) return {}
    const result: Record<string, TenantSupplement> = {}
    for (const [id, record] of Object.entries(parsed.records)) {
      if (!record || typeof record !== 'object') continue
      const safe = emptySupplement()
      for (const key of Object.keys(safe) as (keyof TenantSupplement)[]) {
        const value: unknown = record[key]
        if (typeof value === 'string') safe[key] = value
      }
      result[id] = safe
    }
    return result
  } catch { return {} }
}
function associationLabel(row: TenantRow) {
  // 只展示接口明确提供的关联字段；不根据实名、订单或合同数量推导。
  return row.associationStatusLabel?.trim() || row.associationStatus?.trim() || '—'
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
  const [appliedQ, setAppliedQ] = useState('')
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
  const [supplements, setSupplements] = useState(readTenantSupplements)
  const [detailRow, setDetailRow] = useState<TenantRow | null>(null)
  const [editRow, setEditRow] = useState<TenantRow | null>(null)
  const [editForm, setEditForm] = useState(emptySupplement)
  const [editError, setEditError] = useState('')
  const [tierRow, setTierRow] = useState<TenantRow | null>(null)
  const [tierDraft, setTierDraft] = useState<CreditTier>('A')

  async function load() {
    setError('')
    try {
      const r = await apiGet<{ items: TenantRow[] }>('/api/admin/tenants')
      if (!r.ok) return setError(r.error)
      setItems(r.data.items ?? [])
      setSupplements(readTenantSupplements())
    } catch { setError('租客档案加载失败，请重试。') }
  }

  useEffect(() => {
    let active = true
    void apiGet<{ items: TenantRow[] }>('/api/admin/tenants').then((result) => {
      if (!active) return
      if (result.ok) setItems(result.data.items ?? [])
      else setError(result.error)
    }).catch(() => { if (active) setError('租客档案加载失败，请重试。') })
    return () => { active = false }
  }, [])

  async function saveTier(id: string, creditTier: CreditTier) {
    setError('')
    setSavingId(id)
    try {
      const r = await apiPatch<{ ok: true; item: TenantRow }>(`/api/admin/tenants/${encodeURIComponent(id)}`, { creditTier })
      if (!r.ok) { setError(r.error); return false }
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...r.data.item } : x)))
      setMsg('信誉等级已保存到本地 DEMO。')
      return true
    } catch { setError('信誉等级保存失败，请重试。'); return false }
    finally { setSavingId(null) }
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
    const kw = appliedQ.trim().toLowerCase()
    return items.filter((x) => {
      if (tierFilter && x.creditTier !== tierFilter) return false
      if (kindFilter && x.tenantKind !== kindFilter) return false
      if (verifiedFilter === 'yes' && !x.mobileVerified) return false
      if (verifiedFilter === 'no' && x.mobileVerified) return false
      if (!kw) return true
      // 只能匹配接口已返回的展示内容，无法用完整证件号检索已脱敏数据。
      return [x.name, x.phone, x.idNumberMasked].some((value) => (value || '').toLowerCase() === kw)
    })
  }, [items, appliedQ, tierFilter, kindFilter, verifiedFilter])

  const pageData = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize])

  function query() { setAppliedQ(q); setPage(1) }
  function resetFilters() {
    setQ(''); setAppliedQ(''); setTierFilter(''); setKindFilter(''); setVerifiedFilter(''); setPage(1)
  }
  function openEdit(row: TenantRow) {
    setEditRow(row); setEditForm({ ...emptySupplement(), ...supplements[row.id] }); setEditError('')
  }
  function saveSupplement() {
    if (!editRow) return
    const next = { ...editForm, updatedAt: new Date().toISOString() }
    for (const key of Object.keys(next) as (keyof TenantSupplement)[]) next[key] = next[key].trim()
    const records = { ...readTenantSupplements(), [editRow.id]: next }
    try { localStorage.setItem(TENANT_SUPPLEMENT_KEY, JSON.stringify({ version: 1, records })) }
    catch { setEditError('本机存储不可用或空间不足，补充资料未保存。请重试。'); return }
    setSupplements(records); setEditRow(null); setMsg('档案补充资料已保存到本机演示，原档案基本字段未更改。')
  }
  function exportTenants() {
    const cell = (value: unknown) => {
      const text = String(value ?? '')
      const safe = /^[=+@-]/.test(text) ? `'${text}` : text
      return `"${safe.replace(/"/g, '""')}"`
    }
    const rows: unknown[][] = [['租客姓名', '手机号', '证件类型', '证件号码（已脱敏）', '信誉等级', '关联状态', '订单数', '合同数', '入档时间', '档案类型', '实名状态', '创建来源']]
    for (const row of filtered) rows.push([row.name, row.phone, DOC_ZH[row.idDocType] ?? row.idDocType, row.idNumberMasked,
      row.creditTier, associationLabel(row), row.orderCount, row.contractCount, fmtEntered(row.enteredAt), row.tenantKindLabel, row.mobileVerifiedLabel, row.createdByLabel])
    const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map((row) => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = '租客列表-当前筛选-脱敏.csv'; link.click(); URL.revokeObjectURL(url)
    setMsg(`已导出当前筛选的 ${filtered.length} 条租客记录，沿用列表已有脱敏内容。`)
  }
  const currentDetail = detailRow ? items.find((row) => row.id === detailRow.id) ?? detailRow : null
  const currentSupplement = currentDetail ? supplements[currentDetail.id] ?? emptySupplement() : emptySupplement()

  const idLabel = createForm.tenantKind === 'ENTERPRISE' ? '统一社会信用代码' : '身份证号'
  const nameLabel = createForm.tenantKind === 'ENTERPRISE' ? '企业名称' : '姓名'

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">租客列表</div>
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
              placeholder="姓名/手机/已展示证件精确匹配"
              aria-label="租客精确查询"
              onKeyDown={(event) => { if (event.key === 'Enter') query() }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="a-input"
              style={{ width: 120 }}
              value={kindFilter}
              onChange={(e) => { setKindFilter((e.target.value || '') as TenantKind | ''); setPage(1) }}
            >
              <option value="">全部类型</option>
              <option value="INDIVIDUAL">个人</option>
              <option value="ENTERPRISE">企业</option>
            </select>
            <select
              className="a-input"
              style={{ width: 120 }}
              value={verifiedFilter}
              onChange={(e) => { setVerifiedFilter((e.target.value || '') as '' | 'yes' | 'no'); setPage(1) }}
            >
              <option value="">全部实名</option>
              <option value="yes">已实名</option>
              <option value="no">未实名</option>
            </select>
            <select
              className="a-input"
              style={{ width: 120 }}
              value={tierFilter}
              onChange={(e) => { setTierFilter((e.target.value || '') as CreditTier | ''); setPage(1) }}
            >
              <option value="">全部等级</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
            </select>
          </div>
          <button type="button" className="a-btn ghost" onClick={query}>查询</button>
          <button type="button" className="a-btn ghost" onClick={resetFilters}>重置</button>
          <button type="button" className="a-btn ghost" onClick={() => void load()}>刷新</button>
          <button type="button" className="a-btn ghost" onClick={exportTenants}>导出</button>
          <button type="button" className="a-btn" onClick={openCreate}>
            新增租客
          </button>
        </div>

        <p className="a-muted" style={{ fontSize: 12 }}>姓名、手机或证件按列表展示内容精确匹配；证件号码已脱敏，不能用未返回的完整证件号查询。关联状态仅显示接口明确字段，未提供时显示“—”。</p>
        <div className="a-table-wrap" style={{ marginTop: 14 }}>
          <table className="a-table a-table-sticky-op" style={{ minWidth: 1280 }}>
            <thead>
              <tr>
                <th>类型</th>
                <th>姓名/企业名</th>
                <th>手机号</th>
                <th>证件类型</th>
                <th>证件号码</th>
                <th>是否实名</th>
                <th>信誉等级</th>
                <th>关联状态</th>
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
                  <td colSpan={14} className="a-muted">
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
                    <td>{associationLabel(row)}</td>
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
                      <div className="a-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                        <button type="button" className="a-btn ghost" onClick={() => setDetailRow(row)}>详情</button>
                        <button type="button" className="a-btn ghost" onClick={() => openEdit(row)}>编辑档案</button>
                        <button type="button" className="a-btn ghost" onClick={() => { setTierRow(row); setTierDraft(row.creditTier); setError('') }}>调整信誉</button>
                        <button type="button" className="a-btn ghost" onClick={() => void openOpLogModal(row)}>操作记录</button>
                      </div>
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

      {currentDetail ? <DemoDialog title={`租客详情 · ${currentDetail.name}`} onClose={() => setDetailRow(null)}>
        <div className="a-kv">{[
          ['租客姓名', currentDetail.name], ['手机号', currentDetail.phone], ['证件类型', DOC_ZH[currentDetail.idDocType] ?? currentDetail.idDocType],
          ['证件号码', currentDetail.idNumberMasked], ['信誉等级', currentDetail.creditTier], ['关联状态', associationLabel(currentDetail)],
          ['订单数', currentDetail.orderCount], ['合同数', currentDetail.contractCount], ['入档时间', fmtEntered(currentDetail.enteredAt)],
          ['档案类型', currentDetail.tenantKindLabel], ['实名状态', currentDetail.mobileVerifiedLabel], ['创建来源', currentDetail.createdByLabel],
          ['租户性质（补充资料）', currentSupplement.nature], ['法定代表人', currentSupplement.legalRepresentative], ['证件地址', currentSupplement.documentAddress],
          ['联系人', currentSupplement.contact], ['紧急联系人', currentSupplement.emergencyContact], ['紧急联系电话', currentSupplement.emergencyPhone],
        ].map(([label, value]) => <div className="a-kv-row" key={label}><div className="a-kv-k">{label}</div><div className="a-kv-v">{value === 0 ? 0 : value || '—'}</div></div>)}</div>
        <p className="a-muted" style={{ fontSize: 12 }}>证件沿用原有脱敏展示。档案补充资料仅保存于本机演示。</p>
      </DemoDialog> : null}
      {editRow ? <DemoDialog title={`编辑档案 · ${editRow.name}`} onClose={() => setEditRow(null)}>
        <form className="a-col" onSubmit={(event) => { event.preventDefault(); saveSupplement() }}>
          <p className="a-muted">本表为本机演示补充资料，不修改原档案基本字段；无新增必填项。</p>
          {editError ? <p role="alert" className="a-error">{editError}</p> : null}
          <label className="a-col">租客姓名<input className="a-filter-input" value={editRow.name} disabled /></label>
          <label className="a-col">租户性质<select className="a-filter-select" value={editForm.nature} onChange={(event) => setEditForm((previous) => ({ ...previous, nature: event.target.value }))}>
            <option value="">请选择</option>{editForm.nature ? <option value={editForm.nature}>{editForm.nature}</option> : null}</select></label>
          <div className="a-muted" style={{ fontSize: 12 }}>开发端租户性质选项待核对，本次仅保留空值或已存值。</div>
          {([['legalRepresentative', '法定代表人'], ['documentAddress', '证件地址'], ['contact', '联系人'], ['emergencyContact', '紧急联系人'], ['emergencyPhone', '紧急联系电话']] as const).map(([key, label]) =>
            <label className="a-col" key={key}>{label}<input className="a-filter-input" type={key === 'emergencyPhone' ? 'tel' : 'text'} value={editForm[key]} onChange={(event) => setEditForm((previous) => ({ ...previous, [key]: event.target.value }))} /></label>)}
          <div className="a-row"><button type="submit" className="a-btn">保存补充资料</button><button type="button" className="a-btn ghost" onClick={() => setEditRow(null)}>取消</button></div>
        </form>
      </DemoDialog> : null}
      {tierRow ? <DemoDialog title={`调整信誉 · ${tierRow.name}`} onClose={() => setTierRow(null)}>
        <div className="a-col">{error ? <p className="a-error" role="alert">{error}</p> : null}
          <label className="a-col">信誉等级<select className="a-filter-select" value={tierDraft} onChange={(event) => setTierDraft(event.target.value as CreditTier)}>{(['A', 'B', 'C', 'D'] as CreditTier[]).map((tier) => <option key={tier}>{tier}</option>)}</select></label>
          <div className="a-row"><button type="button" className="a-btn" disabled={savingId === tierRow.id} onClick={() => { void saveTier(tierRow.id, tierDraft).then((saved) => { if (saved) setTierRow(null) }) }}>{savingId === tierRow.id ? '保存中…' : '保存信誉'}</button>
            <button type="button" className="a-btn ghost" onClick={() => setTierRow(null)}>取消</button></div>
        </div>
      </DemoDialog> : null}

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
