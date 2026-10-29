import { useState, type FormEvent } from 'react'
import { ADMIN_MENU_OPTIONS } from '../adminNavigation'
import { DemoDialog } from '../components/DemoDialog'
import { Pagination, paginate } from '../components/Pagination'
import { SystemMenuPermissions } from '../components/SystemMenuPermissions'
import { useDemoRecords } from '../demoStorage'
import { INITIAL_DEMO_ROLES, SYSTEM_ROLE_KEY, inCreatedRange, isDemoRole, systemTime, type DemoRole } from '../systemDemoData'

const emptyFilters = { name: '', code: '', status: '', from: '', to: '' }
export function SystemRolesPage() {
  const { records: roles, commit, storageIssue } = useDemoRecords(SYSTEM_ROLE_KEY, INITIAL_DEMO_ROLES, isDemoRole)
  const [inputs, setInputs] = useState(emptyFilters)
  const [filters, setFilters] = useState(emptyFilters)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [editor, setEditor] = useState<{ isNew: boolean; role: DemoRole } | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const filtered = roles.filter((role) => role.name.includes(filters.name.trim()) && role.code.includes(filters.code.trim()) &&
    (!filters.status || role.status === filters.status) && inCreatedRange(role.createdAt, filters.from, filters.to))
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const paged = paginate(filtered, page, pageSize)
  function query(event: FormEvent) {
    event.preventDefault(); setError('')
    if (inputs.from && inputs.to && inputs.from > inputs.to) { setError('创建时间开始日期不能晚于结束日期'); return }
    setFilters({ ...inputs }); setPage(1)
  }
  function open(role?: DemoRole) {
    setError(''); setMessage('')
    setEditor({ isNew: !role, role: role ? { ...role, menuIds: [...role.menuIds] } : {
      id: crypto.randomUUID(), number: `ROLE-DEMO-${String(roles.length + 1).padStart(3, '0')}`, name: '', code: '',
      sortOrder: 0, status: 'normal', description: '', menuIds: [], createdAt: '',
    } })
  }
  function patch(patchValue: Partial<DemoRole>) { if (editor) setEditor({ ...editor, role: { ...editor.role, ...patchValue } }) }
  function save(event: FormEvent) {
    event.preventDefault()
    if (!editor) return
    if (!editor.role.name.trim()) { setError('请填写角色名称'); return }
    if (!editor.role.code.trim()) { setError('请填写权限字符'); return }
    if (!Number.isInteger(editor.role.sortOrder)) { setError('请填写有效的角色顺序整数'); return }
    const next = { ...editor.role, name: editor.role.name.trim(), code: editor.role.code.trim(), description: editor.role.description.trim(),
      createdAt: editor.isNew ? new Date().toISOString() : editor.role.createdAt }
    if (commit(editor.isNew ? [...roles, next] : roles.map((role) => role.id === next.id ? next : role))) {
      setEditor(null); setError(''); setMessage('角色已保存到本机演示记录，未改变真实权限。')
    } else setError('本机存储不可用，角色尚未保存。')
  }
  function toggleStatus(role: DemoRole) {
    if (commit(roles.map((item) => item.id === role.id ? { ...item, status: item.status === 'normal' ? 'disabled' : 'normal' } : item))) {
      setMessage('已更新本机角色状态，未改变真实授权。')
    }
  }
  return <div className="a-col" style={{ minWidth: 0 }}>
    <div className="a-card"><div className="a-h1">角色管理</div>
      <p className="a-muted">虚构演示角色，保存在当前浏览器。菜单勾选、顺序和状态仅用于原型评审，不改变实际登录权限或侧栏；历史创建时间未知时显示“—”。</p></div>
    {storageIssue ? <div role="alert" className="a-card a-error">{storageIssue}</div> : null}
    {error && !editor ? <div role="alert" className="a-card a-error">{error}</div> : null}
    {message ? <div role="status" className="a-card a-success">{message}</div> : null}
    <form className="a-card a-filterbar" style={{ flexWrap: 'wrap', gap: 10 }} onSubmit={query}>
      <label>角色名称 <input className="a-filter-input" value={inputs.name} placeholder="请输入角色名称" onChange={(event) => setInputs({ ...inputs, name: event.target.value })} /></label>
      <label>权限字符 <input className="a-filter-input" value={inputs.code} placeholder="请输入权限字符" onChange={(event) => setInputs({ ...inputs, code: event.target.value })} /></label>
      <label>状态 <select className="a-filter-select" value={inputs.status} onChange={(event) => setInputs({ ...inputs, status: event.target.value })}><option value="">全部状态</option><option value="normal">正常</option><option value="disabled">停用</option></select></label>
      <label>创建时间起 <input className="a-filter-input" type="date" value={inputs.from} onChange={(event) => setInputs({ ...inputs, from: event.target.value })} /></label>
      <label>创建时间止 <input className="a-filter-input" type="date" value={inputs.to} onChange={(event) => setInputs({ ...inputs, to: event.target.value })} /></label>
      <button className="a-btn" type="submit">搜索</button><button className="a-btn ghost" type="button" onClick={() => { setInputs(emptyFilters); setFilters(emptyFilters); setPage(1); setError('') }}>重置</button>
    </form>
    <div className="a-card"><div className="a-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}><span className="a-muted">共 {filtered.length} 个角色</span><button className="a-btn" type="button" onClick={() => open()}>新增角色</button></div>
      <div className="a-table-wrap"><table className="a-table" style={{ minWidth: 1100 }}><thead><tr>
        {['角色编号', '角色名称', '权限字符', '显示顺序', '状态', '创建时间', '菜单权限（演示）', '操作'].map((label) => <th key={label}>{label}</th>)}
      </tr></thead><tbody>{paged.items.map((role) => <tr key={role.id}><td>{role.number}</td><td>{role.name}</td><td>{role.code}</td><td>{role.sortOrder}</td>
        <td><label className="a-switch"><input type="checkbox" aria-label={`${role.name}状态`} checked={role.status === 'normal'} onChange={() => toggleStatus(role)} /><span className="a-switch-slider" /></label> {role.status === 'normal' ? '正常' : '停用'}</td>
        <td>{systemTime(role.createdAt)}</td><td style={{ maxWidth: 250, overflowWrap: 'anywhere' }}>{role.menuIds.length ? ADMIN_MENU_OPTIONS.filter((menu) => role.menuIds.includes(menu.id)).map((menu) => menu.label).join('、') || '已选择分组' : '未分配'}</td>
        <td><div className="a-op-actions"><button type="button" className="a-btn ghost" onClick={() => open(role)}>修改</button><button type="button" className="a-btn ghost" onClick={() => open(role)}>分配菜单</button></div></td></tr>)}
        {!paged.items.length ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32 }} className="a-muted">暂无符合条件的演示角色</td></tr> : null}
      </tbody></table></div><Pagination total={paged.total} page={paged.page} pageSize={paged.pageSize} onChange={(next) => { setPage(next.page); setPageSize(next.pageSize) }} /></div>
    {editor ? <DemoDialog title={editor.isNew ? '新增角色' : '修改角色信息'} onClose={() => { setEditor(null); setError('') }}>
      <form noValidate onSubmit={save} className="a-col" style={{ gap: 14 }}>
        {error ? <div role="alert" className="a-error">{error}</div> : null}
        <label className="a-col">角色名称 *<input className="a-filter-input" maxLength={100} aria-required="true" value={editor.role.name} onChange={(event) => patch({ name: event.target.value })} /></label>
        <label className="a-col">权限字符 *<input className="a-filter-input" maxLength={100} aria-required="true" value={editor.role.code} onChange={(event) => patch({ code: event.target.value })} /></label>
        <label className="a-col">角色顺序 *<input className="a-filter-input" type="number" step={1} aria-required="true" value={Number.isNaN(editor.role.sortOrder) ? '' : editor.role.sortOrder} onChange={(event) => patch({ sortOrder: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
        <div className="a-row" role="group" aria-label="状态">状态 {(['normal', 'disabled'] as const).map((status) => <label key={status}><input type="radio" name="role-status" checked={editor.role.status === status} onChange={() => patch({ status })} /> {status === 'normal' ? '正常' : '停用'}</label>)}</div>
        <SystemMenuPermissions value={editor.role.menuIds} onChange={(menuIds) => patch({ menuIds })} />
        <label className="a-col">备注<textarea className="a-filter-input" rows={3} maxLength={500} value={editor.role.description} onChange={(event) => patch({ description: event.target.value })} /></label>
        <div className="a-row" style={{ justifyContent: 'flex-end' }}><button type="button" className="a-btn ghost" onClick={() => { setEditor(null); setError('') }}>取消</button><button className="a-btn" type="submit">保存</button></div>
      </form>
    </DemoDialog> : null}
  </div>
}
