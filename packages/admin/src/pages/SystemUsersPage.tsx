import { useEffect, useState, type FormEvent } from 'react'
import { apiGet } from '../api'
import { DemoDialog } from '../components/DemoDialog'
import { Pagination, paginate } from '../components/Pagination'
import { useDemoRecords } from '../demoStorage'
import { DEMO_STORES, INITIAL_DEMO_SYSTEM_USERS, SYSTEM_USER_KEY, inCreatedRange, isDemoSystemUser, readDemoSystemRoles, systemTime, type DemoSystemUser } from '../systemDemoData'

type OrgDept = { id: string; name: string; parentId: string | null }
const emptyFilters = { name: '', phone: '', status: '', from: '', to: '' }
export function SystemUsersPage() {
  const { records: users, commit, storageIssue } = useDemoRecords(SYSTEM_USER_KEY, INITIAL_DEMO_SYSTEM_USERS, isDemoSystemUser)
  const [departments, setDepartments] = useState<OrgDept[]>([])
  const [departmentWarning, setDepartmentWarning] = useState('')
  const [departmentQuery, setDepartmentQuery] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [inputs, setInputs] = useState(emptyFilters)
  const [filters, setFilters] = useState(emptyFilters)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [editor, setEditor] = useState<{ isNew: boolean; user: DemoSystemUser } | null>(null)
  const [password, setPassword] = useState('')
  const [resetUser, setResetUser] = useState<DemoSystemUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const roles = readDemoSystemRoles()
  useEffect(() => {
    let active = true
    apiGet<{ items: OrgDept[] }>('/api/admin/departments').then((result) => {
      if (!active) return
      if (result.ok) setDepartments(result.data.items)
      else setDepartmentWarning('组织部门选项加载失败，可继续评审本机用户资料。')
    }).catch(() => { if (active) setDepartmentWarning('组织部门选项加载失败，可继续评审本机用户资料。') })
    return () => { active = false }
  }, [])
  function deptName(id: string) { return departments.find((dept) => dept.id === id)?.name ?? '—' }
  function depth(dept: OrgDept) {
    let level = 0; let parent = dept.parentId; const seen = new Set([dept.id])
    while (parent && !seen.has(parent)) { seen.add(parent); level += 1; parent = departments.find((item) => item.id === parent)?.parentId ?? null }
    return level
  }
  const filtered = users.filter((user) => user.login.includes(filters.name.trim()) && user.phone.includes(filters.phone.trim()) &&
    (!departmentId || user.departmentId === departmentId) && (!filters.status || user.status === filters.status) && inCreatedRange(user.createdAt, filters.from, filters.to))
  const paged = paginate(filtered, page, pageSize)
  function query(event: FormEvent) {
    event.preventDefault(); setError('')
    if (inputs.from && inputs.to && inputs.from > inputs.to) { setError('创建时间开始日期不能晚于结束日期'); return }
    setFilters({ ...inputs }); setPage(1)
  }
  function open(user?: DemoSystemUser) {
    setError(''); setMessage(''); setPassword('')
    setEditor({ isNew: !user, user: user ? { ...user, storeIds: [...user.storeIds] } : {
      id: crypto.randomUUID(), number: `USER-DEMO-${String(users.length + 1).padStart(3, '0')}`, name: '', login: '', roleCode: '', storeIds: [],
      status: 'normal', departmentId: '', phone: '', email: '', gender: '', post: '', remark: '', passwordConfigured: false, passwordUpdatedAt: '', createdAt: '',
    } })
  }
  function closeEditor() { setPassword(''); setEditor(null); setError('') }
  function patch(patchValue: Partial<DemoSystemUser>) { if (editor) setEditor({ ...editor, user: { ...editor.user, ...patchValue } }) }
  function save(event: FormEvent) {
    event.preventDefault()
    if (!editor) return
    if (!editor.user.name.trim()) { setError('请填写用户昵称'); return }
    if (!editor.user.login.trim()) { setError('请填写用户名称'); return }
    if (editor.isNew && !password.trim()) { setError('请填写用户密码，仅用于演示已设置状态'); return }
    const now = new Date().toISOString()
    const next: DemoSystemUser = { ...editor.user, name: editor.user.name.trim(), login: editor.user.login.trim(), phone: editor.user.phone.trim(),
      email: editor.user.email.trim(), remark: editor.user.remark.trim(), passwordConfigured: editor.isNew ? true : editor.user.passwordConfigured,
      passwordUpdatedAt: editor.isNew ? now : editor.user.passwordUpdatedAt, createdAt: editor.isNew ? now : editor.user.createdAt }
    // 密码始终独立于记录；存储只保留布尔标记和演示设置时间。
    if (commit(editor.isNew ? [...users, next] : users.map((user) => user.id === next.id ? next : user))) {
      closeEditor(); setMessage('用户资料已保存到本机演示记录，未创建或修改可登录账号。')
    } else { setPassword(''); setError('本机存储不可用，用户资料尚未保存。') }
  }
  function toggleStatus(user: DemoSystemUser) {
    if (commit(users.map((row) => row.id === user.id ? { ...row, status: row.status === 'normal' ? 'disabled' : 'normal' } : row))) setMessage('已更新本机用户状态，未改变真实账号状态。')
  }
  function closeReset() { setResetPassword(''); setResetUser(null); setError('') }
  function saveReset(event: FormEvent) {
    event.preventDefault()
    if (!resetUser) return
    if (!resetPassword.trim()) { setError('请填写新密码，仅用于演示已设置状态'); return }
    const next = users.map((user) => user.id === resetUser.id ? { ...user, passwordConfigured: true, passwordUpdatedAt: new Date().toISOString() } : user)
    setResetPassword('')
    if (commit(next)) { closeReset(); setMessage('已记录重置密码演示。未修改真实凭据，也未保存密码明文。') }
    else setError('本机存储不可用，演示设置未保存。')
  }
  return <div className="a-col" style={{ minWidth: 0 }}>
    <div className="a-card"><div className="a-h1">用户管理</div><p className="a-muted">虚构演示账号，只保存本机资料、门店分配和密码已设置标记，不创建真实登录账号或改变授权。请使用虚构联系方式；历史创建时间未知显示“—”。</p></div>
    {storageIssue ? <div role="alert" className="a-card a-error">{storageIssue}</div> : null}
    {departmentWarning ? <div className="a-card a-muted">{departmentWarning}</div> : null}
    {error && !editor && !resetUser ? <div role="alert" className="a-card a-error">{error}</div> : null}
    {message ? <div role="status" className="a-card a-success">{message}</div> : null}
    <div className="a-row" style={{ alignItems: 'flex-start', minWidth: 0, gap: 14 }}>
      <aside className="a-card" style={{ flex: '0 0 215px', width: 215 }} aria-label="组织部门"><strong>组织部门</strong>
        <label className="a-col" style={{ marginTop: 12 }}>部门名称<input className="a-filter-input" style={{ minWidth: 0, width: '100%' }} value={departmentQuery} placeholder="请输入部门名称" onChange={(event) => setDepartmentQuery(event.target.value)} /></label>
        <div className="a-col" style={{ marginTop: 12, gap: 6 }}><button type="button" className={departmentId ? 'a-btn ghost' : 'a-btn'} onClick={() => { setDepartmentId(''); setPage(1) }}>全部部门</button>
          {departments.filter((dept) => dept.name.includes(departmentQuery.trim())).map((dept) => <button type="button" key={dept.id} className={departmentId === dept.id ? 'a-btn' : 'a-btn ghost'} style={{ textAlign: 'left', paddingLeft: 10 + depth(dept) * 10 }} onClick={() => { setDepartmentId(dept.id); setPage(1) }}>{dept.name}</button>)}
          {!departments.length ? <span className="a-muted">暂无可用部门选项</span> : null}</div>
      </aside><div className="a-col" style={{ flex: 1, minWidth: 0 }}>
        <form className="a-card a-filterbar" style={{ flexWrap: 'wrap', gap: 10 }} onSubmit={query}>
          <label>用户名称 <input className="a-filter-input" value={inputs.name} placeholder="请输入用户名称" onChange={(event) => setInputs({ ...inputs, name: event.target.value })} /></label>
          <label>手机号码 <input className="a-filter-input" type="tel" value={inputs.phone} placeholder="请输入手机号码" onChange={(event) => setInputs({ ...inputs, phone: event.target.value })} /></label>
          <label>状态 <select className="a-filter-select" value={inputs.status} onChange={(event) => setInputs({ ...inputs, status: event.target.value })}><option value="">全部状态</option><option value="normal">正常</option><option value="disabled">停用</option></select></label>
          <label>创建时间起 <input className="a-filter-input" type="date" value={inputs.from} onChange={(event) => setInputs({ ...inputs, from: event.target.value })} /></label>
          <label>创建时间止 <input className="a-filter-input" type="date" value={inputs.to} onChange={(event) => setInputs({ ...inputs, to: event.target.value })} /></label>
          <button type="submit" className="a-btn">搜索</button><button type="button" className="a-btn ghost" onClick={() => { setInputs(emptyFilters); setFilters(emptyFilters); setDepartmentId(''); setDepartmentQuery(''); setPage(1); setError('') }}>重置</button>
        </form>
        <div className="a-card"><div className="a-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}><span className="a-muted">共 {filtered.length} 个用户</span><button type="button" className="a-btn" onClick={() => open()}>新增用户</button></div>
          <div className="a-table-wrap"><table className="a-table" style={{ minWidth: 1230 }}><thead><tr>{['用户编号', '用户名称', '用户昵称', '部门', '手机号码', '状态', '创建时间', '角色', '担任门店', '密码设置（演示）', '操作'].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>
            {paged.items.map((user) => <tr key={user.id}><td>{user.number}</td><td>{user.login}</td><td>{user.name}</td><td>{deptName(user.departmentId)}</td><td>{user.phone || '—'}</td>
              <td><label className="a-switch"><input type="checkbox" aria-label={`${user.name}状态`} checked={user.status === 'normal'} onChange={() => toggleStatus(user)} /><span className="a-switch-slider" /></label> {user.status === 'normal' ? '正常' : '停用'}</td>
              <td>{systemTime(user.createdAt)}</td><td>{roles.find((role) => role.code === user.roleCode)?.name ?? '—'}</td><td>{user.storeIds.map((id) => DEMO_STORES.find((store) => store.id === id)?.name ?? id).join('、') || '—'}</td>
              <td>{user.passwordConfigured ? '已设置' : '未设置'}</td><td><div className="a-op-actions"><button type="button" className="a-btn ghost" onClick={() => open(user)}>修改</button><button type="button" className="a-btn ghost" onClick={() => { setResetUser(user); setResetPassword(''); setError('') }}>重置密码</button></div></td></tr>)}
            {!paged.items.length ? <tr><td colSpan={11} className="a-muted" style={{ textAlign: 'center', padding: 32 }}>暂无符合条件的演示用户</td></tr> : null}
          </tbody></table></div><Pagination total={paged.total} page={paged.page} pageSize={paged.pageSize} onChange={(next) => { setPage(next.page); setPageSize(next.pageSize) }} /></div>
      </div>
    </div>
    {editor ? <DemoDialog title={editor.isNew ? '新增用户' : '修改用户信息'} onClose={closeEditor}>
      <form noValidate onSubmit={save} className="a-col" style={{ gap: 14 }}>
        {error ? <div role="alert" className="a-error">{error}</div> : null}
        <p className="a-muted">仅编辑本机虚构账号资料。密码不写入存储、不回显、不用于实际登录。</p>
        <label className="a-col">用户昵称 *<input className="a-filter-input" aria-required="true" value={editor.user.name} maxLength={100} onChange={(event) => patch({ name: event.target.value })} /></label>
        <label className="a-col">归属部门<select className="a-filter-select" value={editor.user.departmentId} onChange={(event) => patch({ departmentId: event.target.value })}><option value="">请选择归属部门</option>
          {editor.user.departmentId && !departments.some((dept) => dept.id === editor.user.departmentId) ? <option value={editor.user.departmentId}>原部门不可用（待核对）</option> : null}
          {departments.map((dept) => <option key={dept.id} value={dept.id}>{'　'.repeat(depth(dept))}{dept.name}</option>)}</select></label>
        <label className="a-col">手机号码<input className="a-filter-input" type="tel" value={editor.user.phone} maxLength={30} onChange={(event) => patch({ phone: event.target.value })} /></label>
        <label className="a-col">邮箱<input className="a-filter-input" value={editor.user.email} maxLength={100} onChange={(event) => patch({ email: event.target.value })} /></label>
        <label className="a-col">用户名称 *<input className="a-filter-input" aria-required="true" value={editor.user.login} maxLength={100} autoComplete="off" onChange={(event) => patch({ login: event.target.value })} /></label>
        {editor.isNew ? <label className="a-col">用户密码 *<input className="a-filter-input" type="password" aria-required="true" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label> : null}
        <label className="a-col">用户性别<select className="a-filter-select" value={editor.user.gender} onChange={(event) => patch({ gender: event.target.value })}><option value="">请选择</option>{['男', '女', '未知'].map((value) => <option key={value}>{value}</option>)}</select></label>
        <div className="a-row" role="group" aria-label="状态">状态 {(['normal', 'disabled'] as const).map((status) => <label key={status}><input type="radio" name="system-user-status" checked={editor.user.status === status} onChange={() => patch({ status })} /> {status === 'normal' ? '正常' : '停用'}</label>)}</div>
        <label className="a-col">岗位<select className="a-filter-select" value={editor.user.post} onChange={(event) => patch({ post: event.target.value })}><option value="">请选择（岗位选项待确认）</option>{editor.user.post ? <option value={editor.user.post}>{editor.user.post}</option> : null}</select></label>
        <label className="a-col">角色<select className="a-filter-select" value={editor.user.roleCode} onChange={(event) => patch({ roleCode: event.target.value })}><option value="">请选择</option>{roles.map((role) => <option key={role.id} value={role.code}>{role.name}{role.status === 'disabled' ? '（停用·演示）' : ''}</option>)}</select></label>
        <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}><legend>担任门店（保留原演示）</legend><div className="a-row" style={{ flexWrap: 'wrap', gap: 12 }}>{DEMO_STORES.map((store) => <label key={store.id}><input type="checkbox" checked={editor.user.storeIds.includes(store.id)} onChange={(event) => patch({ storeIds: event.target.checked ? [...editor.user.storeIds, store.id] : editor.user.storeIds.filter((id) => id !== store.id) })} /> {store.name}</label>)}</div></fieldset>
        <label className="a-col">备注<textarea className="a-filter-input" rows={3} value={editor.user.remark} maxLength={500} onChange={(event) => patch({ remark: event.target.value })} /></label>
        <div className="a-row" style={{ justifyContent: 'flex-end' }}><button type="button" className="a-btn ghost" onClick={closeEditor}>取消</button><button type="submit" className="a-btn">保存</button></div>
      </form>
    </DemoDialog> : null}
    {resetUser ? <DemoDialog title={`重置密码演示 · ${resetUser.name}`} onClose={closeReset}><form noValidate onSubmit={saveReset} className="a-col" style={{ gap: 14 }}>
      <p className="a-muted">仅记录“已设置”演示标记，不修改真实密码，提交或关闭后清空输入。</p>{error ? <div role="alert" className="a-error">{error}</div> : null}
      <label className="a-col">新密码 *<input className="a-filter-input" type="password" aria-required="true" autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></label>
      <div className="a-row"><button type="submit" className="a-btn">确定</button><button type="button" className="a-btn ghost" onClick={closeReset}>取消</button></div>
    </form></DemoDialog> : null}
  </div>
}
