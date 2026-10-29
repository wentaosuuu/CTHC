import { useState, type FormEvent } from 'react'
import { useDemoRecords } from '../demoStorage'
import { DemoDialog } from './DemoDialog'
import { Pagination, paginate } from './Pagination'

export type DemoDirectoryRecord = {
  id: string
  number: string
  enabled: boolean
  createdAt: string
  values: Record<string, string>
}

export type DemoDirectoryField = {
  key: string
  label: string
  required?: boolean
  unique?: boolean
  multiline?: boolean
  filter?: boolean
  maxLength?: number
}

function isDirectoryRecord(value: unknown): value is DemoDirectoryRecord {
  if (typeof value !== 'object' || !value) return false
  const item = value as Partial<DemoDirectoryRecord>
  return typeof item.id === 'string' && typeof item.number === 'string' && typeof item.enabled === 'boolean' &&
    typeof item.createdAt === 'string' && typeof item.values === 'object' && item.values !== null &&
    Object.values(item.values).every((field) => typeof field === 'string')
}

export function DemoDirectoryPage({ title, recordLabel, storageKey, numberPrefix, fields, initial,
  enabledLabel = '启用', description, showCreatedAt = false }: {
  title: string
  recordLabel: string
  storageKey: string
  numberPrefix: string
  fields: readonly DemoDirectoryField[]
  initial: DemoDirectoryRecord[]
  enabledLabel?: string
  description: string
  showCreatedAt?: boolean
}) {
  const { records, commit, storageIssue } = useDemoRecords(storageKey, initial, isDirectoryRecord)
  const [filterInputs, setFilterInputs] = useState<Record<string, string>>({})
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [editing, setEditing] = useState<{ originalId: string | null; values: Record<string, string>; enabled: boolean } | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const filterFields = fields.filter((field) => field.filter)
  const columns = fields.filter((field) => field.key !== 'remark')
  const nameKey = fields[0]?.key ?? 'name'
  const filtered = records.filter((row) => {
    if (filters.status && String(row.enabled) !== filters.status) return false
    return filterFields.every((field) => (row.values[field.key] ?? '').toLowerCase().includes((filters[field.key] ?? '').trim().toLowerCase()))
  })
  const pageData = paginate(filtered, page, pageSize)
  const selected = records.filter((record) => selectedIds.has(record.id))
  const allPageSelected = pageData.items.length > 0 && pageData.items.every((record) => selectedIds.has(record.id))
  const changeSelection = (id: string, checked: boolean) => setSelectedIds((previous) => {
    const next = new Set(previous)
    if (checked) next.add(id); else next.delete(id)
    return next
  })
  const resetSelection = () => setSelectedIds(new Set())
  const query = (event: FormEvent) => { event.preventDefault(); setFilters({ ...filterInputs }); setPage(1); resetSelection() }
  const reset = () => { setFilterInputs({}); setFilters({}); setPage(1); resetSelection() }
  const openEditor = (row?: DemoDirectoryRecord) => {
    setError(''); setMessage('')
    setEditing({ originalId: row?.id ?? null, values: { ...(row?.values ?? {}) }, enabled: row?.enabled ?? true })
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    const values = Object.fromEntries(fields.map((field) => [field.key, (editing.values[field.key] ?? '').trim()]))
    for (const field of fields) {
      if (field.required && !values[field.key]) return setError(`请填写${field.label}`)
      if (field.unique && records.some((row) => row.id !== editing.originalId && row.values[field.key] === values[field.key])) {
        return setError(`${field.label}已存在，请勿重复添加`)
      }
    }
    let next: DemoDirectoryRecord[]
    if (editing.originalId) {
      next = records.map((row) => row.id === editing.originalId ? { ...row, values, enabled: editing.enabled } : row)
    } else {
      const nextNumber = records.reduce((max, row) => Math.max(max, Number(row.number.split('-').at(-1)) || 0), 0) + 1
      next = [{ id: crypto.randomUUID(), number: `${numberPrefix}-${String(nextNumber).padStart(3, '0')}`,
        values, enabled: editing.enabled, createdAt: new Date().toLocaleString('zh-CN', { hour12: false }) }, ...records]
    }
    if (commit(next)) { setEditing(null); setPage(1); setMessage(`${recordLabel}已保存（本地演示数据）`) }
    else setError('本地存储不可用，修改尚未保存，请检查浏览器存储设置后重试。')
  }
  const setEnabled = (ids: Set<string>, enabled: boolean) => {
    if (commit(records.map((row) => ids.has(row.id) ? { ...row, enabled } : row))) {
      setMessage(`已${enabled ? enabledLabel : '停用'} ${ids.size} 条本地演示记录`)
    }
  }
  const remove = (ids: Set<string>) => {
    const targets = records.filter((row) => ids.has(row.id))
    if (!targets.length || !window.confirm(`确认删除 ${targets.length} 条${recordLabel}演示记录？删除后无法恢复。`)) return
    if (commit(records.filter((row) => !ids.has(row.id)))) { resetSelection(); setMessage(`已删除 ${targets.length} 条本地演示记录`) }
  }
  return <div className="a-col" style={{ width: '100%', minWidth: 0 }}>
    <div className="a-card"><div className="a-h1">{title}</div><p className="a-muted">{description}</p>
      <p className="a-muted">演示数据：所有示例均为虚构资料，仅保存在当前浏览器，请使用虚构资料进行评审演练。</p></div>
    {storageIssue ? <div className="a-card a-error" role="alert">{storageIssue}</div> : null}
    {message ? <div className="a-card a-success" role="status">{message}</div> : null}
    <form className="a-card a-filterbar" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }} onSubmit={query}>
      {filterFields.map((field) => <label className="a-col" style={{ gap: 6 }} key={field.key}>{field.label}
        <input className="a-filter-input" value={filterInputs[field.key] ?? ''} placeholder={`请输入${field.label}`}
          onChange={(event) => setFilterInputs((previous) => ({ ...previous, [field.key]: event.target.value }))} /></label>)}
      <label className="a-col" style={{ gap: 6 }}>状态<select className="a-filter-input" value={filterInputs.status ?? ''}
        onChange={(event) => setFilterInputs((previous) => ({ ...previous, status: event.target.value }))}>
        <option value="">全部状态</option><option value="true">{enabledLabel}</option><option value="false">停用</option></select></label>
      <button className="a-btn" type="submit">查询</button><button className="a-btn ghost" type="button" onClick={reset}>重置</button>
    </form>
    <div className="a-card"><div className="a-row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
      <button type="button" className="a-btn" onClick={() => openEditor()}>新增{recordLabel}</button>
      <button type="button" className="a-btn ghost" disabled={!selected.length} onClick={() => setEnabled(new Set(selected.map((row) => row.id)), true)}>批量{enabledLabel}</button>
      <button type="button" className="a-btn ghost" disabled={!selected.length} onClick={() => setEnabled(new Set(selected.map((row) => row.id)), false)}>批量停用</button>
      <button type="button" className="a-btn ghost" disabled={!selected.length} onClick={() => remove(new Set(selected.map((row) => row.id)))}>批量删除</button>
      <span className="a-muted">已选 {selected.length} 条 · 共 {filtered.length} 条</span>
    </div><div className="a-table-wrap"><table className="a-table" style={{ minWidth: 960 }}><thead><tr>
      <th><input type="checkbox" aria-label="全选当前页" checked={allPageSelected}
        ref={(element) => { if (element) element.indeterminate = !allPageSelected && pageData.items.some((row) => selectedIds.has(row.id)) }}
        onChange={(event) => { const checked = event.target.checked; setSelectedIds((previous) => {
          const next = new Set(previous); pageData.items.forEach((row) => { if (checked) next.add(row.id); else next.delete(row.id) }); return next
        }) }} /></th><th>编号</th>{columns.map((field) => <th key={field.key}>{field.label}</th>)}<th>状态</th><th>备注</th>
      {showCreatedAt ? <th>创建时间</th> : null}<th>操作</th></tr></thead><tbody>
      {pageData.items.map((row) => <tr key={row.id}>
        <td><input type="checkbox" aria-label={`选择${row.values[nameKey]}`} checked={selectedIds.has(row.id)} onChange={(event) => changeSelection(row.id, event.target.checked)} /></td>
        <td>{row.number}</td>{columns.map((field) => <td key={field.key}>{row.values[field.key] || '—'}</td>)}
        <td><label className="a-switch" title={`${row.enabled ? enabledLabel : '停用'}，点击切换`}>
          <input type="checkbox" aria-label={`${row.values[nameKey]}状态`} checked={row.enabled}
            onChange={(event) => setEnabled(new Set([row.id]), event.target.checked)} /><span className="a-switch-slider" /></label>
          <span style={{ marginLeft: 6 }}>{row.enabled ? enabledLabel : '停用'}</span></td><td style={{ maxWidth: 220, overflowWrap: 'anywhere' }}>{row.values.remark || '—'}</td>
        {showCreatedAt ? <td>{row.createdAt}</td> : null}<td><div className="a-op-actions">
          <button type="button" className="a-btn ghost" onClick={() => openEditor(row)}>修改</button>
          <button type="button" className="a-btn ghost" onClick={() => remove(new Set([row.id]))}>删除</button></div></td>
      </tr>)}
      {!pageData.items.length ? <tr><td colSpan={columns.length + 5 + Number(showCreatedAt)} className="a-muted" style={{ textAlign: 'center', padding: 36 }}>
        {records.length ? '暂无符合条件的演示记录，请调整条件或重置。' : `暂无${recordLabel}演示数据，可点击新增。`}</td></tr> : null}
    </tbody></table></div><Pagination total={pageData.total} page={pageData.page} pageSize={pageData.pageSize}
      onChange={(next) => { setPage(next.page); setPageSize(next.pageSize) }} /></div>
    {editing ? <DemoDialog title={`${editing.originalId ? '修改' : '新增'}${recordLabel}`} onClose={() => setEditing(null)}>
      <form onSubmit={save} noValidate><p className="a-muted">本表单仅修改本地演示数据。</p>
        {error ? <div className="a-error" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
        <div className="a-col" style={{ gap: 14 }}>{fields.map((field) => <label key={field.key} className="a-col" style={{ gap: 6 }}>
          {field.label}{field.required ? ' *' : ''}
          {field.multiline ? <textarea className="a-input" rows={3} maxLength={field.maxLength ?? 500} value={editing.values[field.key] ?? ''}
            onChange={(event) => setEditing({ ...editing, values: { ...editing.values, [field.key]: event.target.value } })} />
            : <input className="a-input" maxLength={field.maxLength ?? 100} aria-required={field.required} value={editing.values[field.key] ?? ''}
              placeholder={`请输入${field.label}`} onChange={(event) => setEditing({ ...editing, values: { ...editing.values, [field.key]: event.target.value } })} />}
        </label>)}<label className="a-col" style={{ gap: 6 }}>状态<select className="a-input" value={String(editing.enabled)}
          onChange={(event) => setEditing({ ...editing, enabled: event.target.value === 'true' })}>
          <option value="true">{enabledLabel}</option><option value="false">停用</option></select></label>
        </div><div className="a-row" style={{ gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="a-btn ghost" type="button" onClick={() => setEditing(null)}>取消</button><button className="a-btn" type="submit">保存</button></div>
      </form></DemoDialog> : null}
  </div>
}
