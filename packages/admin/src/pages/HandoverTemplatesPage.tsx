import { useState, type FormEvent } from 'react'
import { DemoDialog } from '../components/DemoDialog'
import { Pagination, paginate } from '../components/Pagination'
import { useDemoRecords } from '../demoStorage'

type TemplateItem = {
  id: string
  category: string
  name: string
  specification: string
  unit: string
  quantity: string
  price: string
}
type HandoverTemplate = {
  id: string
  number: string
  name: string
  category: string
  enabled: boolean
  sortOrder: number
  remark: string
  updatedAt: string
  items: TemplateItem[]
}
type TemplateFilters = { name: string; category: string; status: string }
const emptyFilters: TemplateFilters = { name: '', category: '', status: '' }
const initial: HandoverTemplate[] = [
  { id: 'handover-demo-1', number: 'JJQD-DEMO-001', name: '演示住宅交接模板', category: '住宅', enabled: true,
    sortOrder: 1, remark: '虚构示例，可调整项目顺序与参考单价', updatedAt: '2026/10/26 09:00:00',
    items: [
      { id: 'item-demo-1', category: '房屋', name: '演示入户门', specification: '单扇（虚构示例）', unit: '扇', quantity: '1', price: '300' },
      { id: 'item-demo-2', category: '设备', name: '演示空调', specification: '样例规格', unit: '台', quantity: '1', price: '500' },
    ] },
  { id: 'handover-demo-2', number: 'JJQD-DEMO-002', name: '演示非住宅交接模板', category: '非住宅', enabled: false,
    sortOrder: 2, remark: '停用模板示例', updatedAt: '2026/10/26 09:00:00',
    items: [{ id: 'item-demo-3', category: '设施', name: '演示照明设备', specification: '', unit: '套', quantity: '2', price: '100' }] },
]
function isTemplateItem(value: unknown): value is TemplateItem {
  if (typeof value !== 'object' || !value) return false
  const row = value as Partial<TemplateItem>
  return ['id', 'category', 'name', 'specification', 'unit', 'quantity', 'price'].every((key) => typeof row[key as keyof TemplateItem] === 'string')
}
function isTemplate(value: unknown): value is HandoverTemplate {
  if (typeof value !== 'object' || !value) return false
  const row = value as Partial<HandoverTemplate>
  return typeof row.id === 'string' && typeof row.number === 'string' && typeof row.name === 'string' && typeof row.category === 'string' &&
    typeof row.enabled === 'boolean' && typeof row.sortOrder === 'number' && Number.isFinite(row.sortOrder) &&
    typeof row.remark === 'string' && typeof row.updatedAt === 'string' && Array.isArray(row.items) && row.items.every(isTemplateItem)
}
function amount(item: TemplateItem): number {
  const total = Number(item.quantity) * Number(item.price)
  return Number.isFinite(total) ? Math.round(total * 100) / 100 : 0
}
function totalAmount(items: TemplateItem[]): number { return Math.round(items.reduce((sum, item) => sum + amount(item), 0) * 100) / 100 }

export function HandoverTemplatesPage() {
  const { records, commit, storageIssue } = useDemoRecords('cthc.prototype-sync.v1.handover-templates', initial, isTemplate)
  const [inputFilters, setInputFilters] = useState<TemplateFilters>(emptyFilters)
  const [filters, setFilters] = useState<TemplateFilters>(emptyFilters)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [editor, setEditor] = useState<HandoverTemplate | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const categories = [...new Set(records.map((row) => row.category).filter(Boolean))].sort()
  const filtered = records.filter((row) => row.name.toLowerCase().includes(filters.name.trim().toLowerCase()) &&
    (!filters.category || row.category === filters.category) && (!filters.status || String(row.enabled) === filters.status))
    .sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt))
  const pageData = paginate(filtered, page, pageSize)
  const selected = records.filter((row) => selectedIds.has(row.id))
  const allSelected = pageData.items.length > 0 && pageData.items.every((row) => selectedIds.has(row.id))
  const closeEditor = () => { setEditor(null); setError('') }
  const selectOne = (id: string, checked: boolean) => setSelectedIds((previous) => {
    const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next
  })
  const openEditor = (template?: HandoverTemplate) => {
    setError(''); setMessage(''); setIsNew(!template)
    if (template) { setEditor({ ...template, items: template.items.map((item) => ({ ...item })) }); return }
    const nextNumber = records.reduce((max, row) => Math.max(max, Number(row.number.split('-').at(-1)) || 0), 0) + 1
    setEditor({ id: crypto.randomUUID(), number: `JJQD-DEMO-${String(nextNumber).padStart(3, '0')}`, name: '', category: '',
      enabled: true, sortOrder: records.length + 1, remark: '', updatedAt: '', items: [] })
  }
  const updateItem = (id: string, patch: Partial<TemplateItem>) => {
    setEditor((previous) => previous ? { ...previous, items: previous.items.map((item) => item.id === id ? { ...item, ...patch } : item) } : previous)
  }
  const moveItem = (index: number, step: number) => setEditor((previous) => {
    if (!previous || index + step < 0 || index + step >= previous.items.length) return previous
    const items = [...previous.items]; [items[index], items[index + step]] = [items[index + step], items[index]]
    return { ...previous, items }
  })
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!editor) return
    if (!editor.name.trim()) return setError('请填写模板名称')
    if (!Number.isInteger(editor.sortOrder) || editor.sortOrder < 0) return setError('排序号须为大于或等于 0 的整数')
    for (const [index, item] of editor.items.entries()) {
      if (!item.name.trim()) return setError(`第 ${index + 1} 项：请填写项目名称（原型交互校验）`)
      if (!item.quantity.trim() || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 0) return setError(`第 ${index + 1} 项：数量须为大于或等于 0 的数字`)
      if (!item.price.trim() || !Number.isFinite(Number(item.price)) || Number(item.price) < 0) return setError(`第 ${index + 1} 项：参考单价须为大于或等于 0 的数字`)
      if (!Number.isFinite(Number(item.quantity) * Number(item.price))) return setError(`第 ${index + 1} 项：数量与单价相乘超出有效数字范围`)
    }
    const next: HandoverTemplate = { ...editor, name: editor.name.trim(), category: editor.category.trim(), remark: editor.remark.trim(),
      updatedAt: new Date().toLocaleString('zh-CN', { hour12: false }), items: editor.items.map((item) => ({ ...item,
        category: item.category.trim(), name: item.name.trim(), specification: item.specification.trim(), unit: item.unit.trim() })) }
    if (commit(isNew ? [next, ...records] : records.map((row) => row.id === next.id ? next : row))) {
      setEditor(null); setPage(1); setMessage('交接清单模板已保存（本地演示数据）')
    } else setError('本地存储不可用，模板尚未保存，请检查浏览器存储设置后重试。')
  }
  const setEnabled = (ids: Set<string>, enabled: boolean) => {
    if (commit(records.map((row) => ids.has(row.id) ? { ...row, enabled, updatedAt: new Date().toLocaleString('zh-CN', { hour12: false }) } : row))) {
      setMessage(`已${enabled ? '启用' : '停用'} ${ids.size} 个本地演示模板`)
    }
  }
  const remove = (ids: Set<string>) => {
    const count = records.filter((row) => ids.has(row.id)).length
    if (!count || !window.confirm(`确认删除 ${count} 个交接清单演示模板？删除后无法恢复。`)) return
    if (commit(records.filter((row) => !ids.has(row.id)))) { setSelectedIds(new Set()); setMessage(`已删除 ${count} 个本地演示模板`) }
  }
  const copyTemplate = async (row: HandoverTemplate) => {
    setError(''); setMessage('')
    if (!row.enabled) return setError('停用模板不可复制，请先启用')
    if (!row.items.length) return setError('模板暂无项目，请先维护项目')
    const text = ['【本地演示模板，不会写入合同】', row.name, `分类：${row.category}`,
      '序号\t分类\t项目名称\t规格\t单位\t数量\t参考单价（元）\t小计（元）',
      ...row.items.map((item, index) => [index + 1, item.category, item.name, item.specification || '—', item.unit,
        item.quantity, Number(item.price).toFixed(2), amount(item).toFixed(2)].join('\t')),
      `参考合计：${totalAmount(row.items).toFixed(2)} 元`, '合同附件五可按顺序采用这些项目，合同内可独立调整；此处仅复制内容，不自动关联合同。'].join('\n')
    try { await navigator.clipboard.writeText(text); setMessage('已复制启用模板的演示内容，可粘贴评审；未写入合同附件五。') }
    catch { setError('浏览器未允许复制，请检查剪贴板权限后重试。') }
  }
  return <div className="a-col" style={{ width: '100%', minWidth: 0 }}>
    <div className="a-card"><div className="a-h1">交接清单 · 模板配置</div>
      <p className="a-muted">维护交接清单项目及参考单价。项目按顺序供合同附件五采用，合同内可独立调整。</p>
      <p className="a-muted">演示数据：模板及项目均为虚构，保存在当前浏览器。“复制演示模板”可复制启用模板的内容，不会自动写入或关联合同。</p></div>
    {storageIssue ? <div className="a-card a-error" role="alert">{storageIssue}</div> : null}
    {error && !editor ? <div className="a-card a-error" role="alert">{error}</div> : null}
    {message ? <div className="a-card a-success" role="status">{message}</div> : null}
    <form className="a-card a-filterbar" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12 }}
      onSubmit={(event) => { event.preventDefault(); setFilters({ ...inputFilters }); setPage(1); setSelectedIds(new Set()) }}>
      <label className="a-col" style={{ gap: 6 }}>模板名称<input className="a-filter-input" placeholder="请输入模板名称" value={inputFilters.name}
        onChange={(event) => setInputFilters({ ...inputFilters, name: event.target.value })} /></label>
      <label className="a-col" style={{ gap: 6 }}>分类<select className="a-filter-input" value={inputFilters.category}
        onChange={(event) => setInputFilters({ ...inputFilters, category: event.target.value })}><option value="">全部分类</option>
        {categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
      <label className="a-col" style={{ gap: 6 }}>状态<select className="a-filter-input" value={inputFilters.status}
        onChange={(event) => setInputFilters({ ...inputFilters, status: event.target.value })}>
        <option value="">全部状态</option><option value="true">启用</option><option value="false">停用</option></select></label>
      <button type="submit" className="a-btn">查询</button><button type="button" className="a-btn ghost"
        onClick={() => { setInputFilters(emptyFilters); setFilters(emptyFilters); setPage(1); setSelectedIds(new Set()) }}>重置</button>
    </form>
    <div className="a-card"><div className="a-row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
      <button type="button" className="a-btn" onClick={() => openEditor()}>新增模板</button>
      <button type="button" className="a-btn ghost" disabled={!selected.length} onClick={() => setEnabled(new Set(selected.map((row) => row.id)), true)}>批量启用</button>
      <button type="button" className="a-btn ghost" disabled={!selected.length} onClick={() => setEnabled(new Set(selected.map((row) => row.id)), false)}>批量停用</button>
      <button type="button" className="a-btn ghost" disabled={!selected.length} onClick={() => remove(new Set(selected.map((row) => row.id)))}>批量删除</button>
      <span className="a-muted">已选 {selected.length} 条 · 共 {filtered.length} 条</span>
    </div><div className="a-table-wrap"><table className="a-table" style={{ minWidth: 1100 }}><thead><tr>
      <th><input type="checkbox" aria-label="全选当前页" checked={allSelected}
        ref={(element) => { if (element) element.indeterminate = !allSelected && pageData.items.some((row) => selectedIds.has(row.id)) }}
        onChange={(event) => { const checked = event.target.checked;
        setSelectedIds((previous) => { const next = new Set(previous); pageData.items.forEach((row) => { if (checked) next.add(row.id); else next.delete(row.id) }); return next }) }} /></th>
      <th>编号</th><th>模板名称</th><th>分类</th><th>状态</th><th>项目数量</th><th>备注</th><th>更新时间</th><th>操作</th></tr></thead><tbody>
      {pageData.items.map((row) => <tr key={row.id}>
        <td><input type="checkbox" aria-label={`选择${row.name}`} checked={selectedIds.has(row.id)} onChange={(event) => selectOne(row.id, event.target.checked)} /></td>
        <td>{row.number}</td><td>{row.name}</td><td>{row.category || '—'}</td><td><label className="a-switch" title={row.enabled ? '启用' : '停用'}>
          <input type="checkbox" aria-label={`${row.name}状态`} checked={row.enabled} onChange={(event) => setEnabled(new Set([row.id]), event.target.checked)} />
          <span className="a-switch-slider" /></label><span style={{ marginLeft: 6 }}>{row.enabled ? '启用' : '停用'}</span></td>
        <td>{row.items.length}</td><td style={{ maxWidth: 200, overflowWrap: 'anywhere' }}>{row.remark || '—'}</td><td>{row.updatedAt}</td><td><div className="a-op-actions">
          <button type="button" className="a-btn ghost" onClick={() => openEditor(row)}>修改</button>
          <button type="button" className="a-btn ghost" disabled={!row.enabled} onClick={() => { void copyTemplate(row) }}>复制演示模板</button>
          <button type="button" className="a-btn ghost" onClick={() => remove(new Set([row.id]))}>删除</button></div></td>
      </tr>)}{!pageData.items.length ? <tr><td colSpan={9} className="a-muted" style={{ padding: 36, textAlign: 'center' }}>
        {records.length ? '暂无符合条件的演示模板，请调整条件或重置。' : '暂无交接清单模板，可点击新增模板。'}</td></tr> : null}
    </tbody></table></div><Pagination total={pageData.total} page={pageData.page} pageSize={pageData.pageSize}
      onChange={(next) => { setPage(next.page); setPageSize(next.pageSize) }} /></div>
    {editor ? <DemoDialog title={`${isNew ? '新增' : '修改'}交接清单模板`} wide onClose={closeEditor}>
      <form noValidate onSubmit={save}><p className="a-muted">演示项目按表格顺序排列，支持上移/下移；仅维护本地演示模板。项目名称非空仅作原型交互校验，不代表已确认的开发业务规则。</p>
        {error ? <div className="a-error" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
          <label className="a-col" style={{ gap: 6 }}>模板名称 *<input className="a-input" aria-required="true" maxLength={100} value={editor.name}
            onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
          <label className="a-col" style={{ gap: 6 }}>分类<input className="a-input" maxLength={50} value={editor.category}
            onChange={(event) => setEditor({ ...editor, category: event.target.value })} /></label>
          <label className="a-col" style={{ gap: 6 }}>状态<select className="a-input" value={String(editor.enabled)}
            onChange={(event) => setEditor({ ...editor, enabled: event.target.value === 'true' })}>
            <option value="true">启用</option><option value="false">停用</option></select></label>
          <label className="a-col" style={{ gap: 6 }}>排序号<input className="a-input" type="number" min={0} step={1} value={Number.isNaN(editor.sortOrder) ? '' : editor.sortOrder}
            onChange={(event) => setEditor({ ...editor, sortOrder: event.target.value === '' ? Number.NaN : Number(event.target.value) })} /></label>
          <label className="a-col" style={{ gap: 6, gridColumn: '1 / -1' }}>备注<textarea className="a-input" rows={2} maxLength={500} value={editor.remark}
            onChange={(event) => setEditor({ ...editor, remark: event.target.value })} /></label>
        </div><div className="a-row" style={{ justifyContent: 'space-between', marginTop: 20, marginBottom: 10 }}><strong>交接项目（{editor.items.length} 项）</strong>
          <button type="button" className="a-btn ghost" onClick={() => setEditor({ ...editor, items: [...editor.items,
            { id: crypto.randomUUID(), category: '其他', name: '', specification: '', unit: '个', quantity: '1', price: '0' }] })}>新增项目</button></div>
        <div className="a-table-wrap"><table className="a-table" style={{ minWidth: 1020 }}><thead><tr><th>序号</th><th>分类</th><th>项目名称</th><th>规格</th><th>单位</th><th>数量</th><th>参考单价（元）</th><th>小计（元）</th><th>操作</th></tr></thead><tbody>
          {editor.items.map((item, index) => <tr key={item.id}><td>{index + 1}</td>
            <td><input className="a-input" style={{ width: 100, minWidth: 0 }} aria-label={`第${index + 1}项分类`} value={item.category} maxLength={50} onChange={(event) => updateItem(item.id, { category: event.target.value })} /></td>
            <td><input className="a-input" style={{ width: 160, minWidth: 0 }} aria-label={`第${index + 1}项名称`} value={item.name} maxLength={100} onChange={(event) => updateItem(item.id, { name: event.target.value })} /></td>
            <td><input className="a-input" style={{ width: 130, minWidth: 0 }} aria-label={`第${index + 1}项规格`} value={item.specification} maxLength={100} onChange={(event) => updateItem(item.id, { specification: event.target.value })} /></td>
            <td><input className="a-input" style={{ width: 70, minWidth: 0 }} aria-label={`第${index + 1}项单位`} value={item.unit} maxLength={20} onChange={(event) => updateItem(item.id, { unit: event.target.value })} /></td>
            <td><input className="a-input" style={{ width: 85, minWidth: 0 }} aria-label={`第${index + 1}项数量`} type="number" min={0} step="0.01" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: event.target.value })} /></td>
            <td><input className="a-input" style={{ width: 110, minWidth: 0 }} aria-label={`第${index + 1}项参考单价`} type="number" min={0} step="0.01" value={item.price} onChange={(event) => updateItem(item.id, { price: event.target.value })} /></td>
            <td>¥{amount(item).toFixed(2)}</td><td><div className="a-op-actions">
              <button type="button" className="a-btn ghost" disabled={index === 0} onClick={() => moveItem(index, -1)}>上移</button>
              <button type="button" className="a-btn ghost" disabled={index === editor.items.length - 1} onClick={() => moveItem(index, 1)}>下移</button>
              <button type="button" className="a-btn ghost" onClick={() => setEditor({ ...editor, items: editor.items.filter((row) => row.id !== item.id) })}>删除项目</button></div></td>
          </tr>)}{!editor.items.length ? <tr><td colSpan={9} className="a-muted" style={{ padding: 28, textAlign: 'center' }}>暂无项目，可点击新增项目。</td></tr> : null}
        </tbody></table></div><p style={{ textAlign: 'right', fontWeight: 700 }}>参考合计：¥{totalAmount(editor.items).toFixed(2)}</p>
        <div className="a-row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 18 }}><button className="a-btn ghost" type="button" onClick={closeEditor}>取消</button>
          <button className="a-btn" type="submit">保存模板</button></div>
      </form></DemoDialog> : null}
  </div>
}
