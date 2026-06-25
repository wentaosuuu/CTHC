import { useState } from 'react'

/** 用户 */
type User = {
  id: string
  name: string
  login: string
  roleCode: 'SYSTEM_ADMIN' | 'STORE_MANAGER' | 'FINANCE'
  /** 担任店长的门店 id 列表（可多选） */
  storeIds: string[]
  status: 'enabled' | 'disabled'
}

const ROLE_OPTIONS = [
  { code: 'SYSTEM_ADMIN' as const, label: '系统管理员' },
  { code: 'STORE_MANAGER' as const, label: '店长' },
  { code: 'FINANCE' as const, label: '财务' },
]

/** 门店列表（Demo 静态数据，后续可接接口） */
const STORES = [
  { id: 'hq', name: '总部' },
  { id: 'jn', name: '南宁市-江南区' },
  { id: 'qx', name: '南宁市-青秀区' },
  { id: 'xn', name: '南宁市-兴宁区' },
  { id: 'xxt', name: '南宁市-西乡塘区' },
  { id: 'yn', name: '南宁市-邕宁区' },
  { id: 'wm', name: '南宁市-武鸣区' },
  { id: 'lq', name: '南宁市-良庆区' },
]

const initialUsers: User[] = [
  {
    id: 'u1',
    name: '系统管理员',
    login: 'admin',
    roleCode: 'SYSTEM_ADMIN',
    storeIds: ['hq'],
    status: 'enabled',
  },
  {
    id: 'u2',
    name: '店长A',
    login: 'manager',
    roleCode: 'STORE_MANAGER',
    storeIds: ['jn'],
    status: 'enabled',
  },
  {
    id: 'u3',
    name: '财务专员',
    login: 'finance',
    roleCode: 'FINANCE',
    storeIds: ['hq'],
    status: 'enabled',
  },
]

function getRoleLabel(code: User['roleCode']) {
  return ROLE_OPTIONS.find((r) => r.code === code)?.label ?? code
}

function getStoreNames(storeIds: string[]) {
  if (storeIds.length === 0) return '-'
  return storeIds.map((id) => STORES.find((s) => s.id === id)?.name ?? id).join('、')
}

export function SystemUsersPage() {
  const [users, setUsers] = useState<User[]>(initialUsers)
  const [userModal, setUserModal] = useState<{
    type: 'add' | 'edit'
    user?: User
    form: {
      name: string
      login: string
      roleCode: User['roleCode']
      storeIds: string[]
    }
  } | null>(null)
  const [resetPwdUserId, setResetPwdUserId] = useState<string | null>(null)
  const [resetPwdModal, setResetPwdModal] = useState<{ user: User; newPassword: string } | null>(null)

  const openAdd = () => {
    setUserModal({
      type: 'add',
      form: {
        name: '',
        login: '',
        roleCode: 'STORE_MANAGER',
        storeIds: [],
      },
    })
  }

  const openEdit = (user: User) => {
    setUserModal({
      type: 'edit',
      user,
      form: {
        name: user.name,
        login: user.login,
        roleCode: user.roleCode,
        storeIds: [...user.storeIds],
      },
    })
  }

  const toggleStatus = (user: User) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === user.id ? { ...u, status: u.status === 'enabled' ? 'disabled' : 'enabled' } : u
      )
    )
  }

  const openResetPwdModal = (user: User) => {
    setResetPwdModal({ user, newPassword: '' })
  }

  const closeResetPwdModal = () => setResetPwdModal(null)

  const setResetPwdForm = (newPassword: string) => {
    setResetPwdModal((prev) => (prev ? { ...prev, newPassword } : null))
  }

  const submitResetPassword = () => {
    if (!resetPwdModal) return
    const pwd = resetPwdModal.newPassword.trim()
    if (!pwd) {
      window.alert('请输入新密码')
      return
    }
    setResetPwdUserId(resetPwdModal.user.id)
    setTimeout(() => setResetPwdUserId(null), 3000)
    closeResetPwdModal()
  }

  const closeModal = () => setUserModal(null)

  const setForm = (patch: Partial<UserModal['form']>) => {
    if (!userModal) return
    setUserModal({ ...userModal, form: { ...userModal.form, ...patch } })
  }

  const toggleStore = (storeId: string) => {
    if (!userModal) return
    const next = userModal.form.storeIds.includes(storeId)
      ? userModal.form.storeIds.filter((id) => id !== storeId)
      : [...userModal.form.storeIds, storeId]
    setForm({ storeIds: next })
  }

  const saveUser = () => {
    if (!userModal) return
    const { name, login, roleCode, storeIds } = userModal.form
    if (!name.trim() || !login.trim()) return
    if (userModal.type === 'add') {
      setUsers((prev) => [
        ...prev,
        {
          id: 'u_' + Date.now(),
          name: name.trim(),
          login: login.trim(),
          roleCode,
          storeIds: [...storeIds],
          status: 'enabled',
        },
      ])
    } else if (userModal.user) {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userModal.user!.id
            ? { ...u, name: name.trim(), login: login.trim(), roleCode, storeIds: [...storeIds] }
            : u
        )
      )
    }
    closeModal()
  }

  type UserModal = NonNullable<typeof userModal>

  return (
    <div className="a-col" style={{ width: '100%', minWidth: 0 }}>
      <div className="a-card">
        <div className="a-h1">用户管理</div>
        <div className="a-muted">
          这里管理后台账号（系统管理员、店长等），包括登录名、角色、担任门店。一个用户可以是多个门店的店长，在编辑时勾选多个门店即可。数据可对接真实接口。
        </div>
      </div>

      <div className="a-card" style={{ overflow: 'hidden' }}>
        <div style={{ marginBottom: 12 }}>
          <div className="a-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="a-muted">共 {users.length} 个用户</span>
            <button type="button" className="a-btn" onClick={openAdd}>
              新增用户
            </button>
          </div>
          {resetPwdUserId ? (
            <div className="a-muted" style={{ marginTop: 8, color: '#15803d', fontWeight: 700 }}>
              已为「{users.find((u) => u.id === resetPwdUserId)?.name}」设置新密码
            </div>
          ) : null}
        </div>
        <div className="a-table-wrap">
          <table className="a-table a-table-sticky-op" style={{ width: '100%', minWidth: 640, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '28%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '22%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>姓名</th>
                <th>登录账号</th>
                <th>角色</th>
                <th>担任门店</th>
                <th>状态</th>
                <th className="a-op-col">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.name}</td>
                  <td><code style={{ fontSize: 12 }}>{user.login}</code></td>
                  <td>{getRoleLabel(user.roleCode)}</td>
                  <td className="a-muted" style={{ wordBreak: 'break-word' }}>
                    {getStoreNames(user.storeIds)}
                  </td>
                  <td>
                    <label className="a-switch" title={user.status === 'enabled' ? '启用（点击切换为停用）' : '停用（点击切换为启用）'}>
                      <input
                        type="checkbox"
                        checked={user.status === 'enabled'}
                        onChange={() => toggleStatus(user)}
                      />
                      <span className="a-switch-slider" />
                    </label>
                  </td>
                  <td className="a-op-cell">
                    <div className="a-op-actions">
                      <button type="button" className="a-btn ghost" onClick={() => openEdit(user)}>
                        修改
                      </button>
                      <button type="button" className="a-btn ghost" onClick={() => openResetPwdModal(user)}>
                        重置密码
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增/编辑用户弹窗 */}
      {userModal && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div className="a-modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">
                {userModal.type === 'add' ? '新增用户' : '修改用户信息'}
              </div>
              <button type="button" className="a-modal-close" onClick={closeModal}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">姓名</div>
                  <div className="a-kv-v">
                    <input
                      type="text"
                      className="a-filter-input"
                      value={userModal.form.name}
                      onChange={(e) => setForm({ name: e.target.value })}
                      placeholder="如：张三、店长A"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">登录账号</div>
                  <div className="a-kv-v">
                    <input
                      type="text"
                      className="a-filter-input"
                      value={userModal.form.login}
                      onChange={(e) => setForm({ login: e.target.value })}
                      placeholder="用于登录的账号（如邮箱或用户名）"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">角色</div>
                  <div className="a-kv-v">
                    <select
                      className="a-filter-select"
                      value={userModal.form.roleCode}
                      onChange={(e) => setForm({ roleCode: e.target.value as User['roleCode'] })}
                      style={{ minWidth: 160 }}
                    >
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">担任门店</div>
                  <div className="a-kv-v">
                    <p className="a-muted" style={{ marginBottom: 8, fontSize: 12 }}>
                      可多选。店长可担任多个门店的店长，系统管理员可选所属部门（如总部）。
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
                      {STORES.map((store) => (
                        <label
                          key={store.id}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}
                        >
                          <input
                            type="checkbox"
                            checked={userModal.form.storeIds.includes(store.id)}
                            onChange={() => toggleStore(store.id)}
                          />
                          <span>{store.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <button type="button" className="a-btn" onClick={saveUser}>
                  {userModal.type === 'add' ? '确定新增' : '保存'}
                </button>
                <button type="button" className="a-btn ghost" onClick={closeModal}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 重置密码弹窗 */}
      {resetPwdModal && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-pwd-title"
          onClick={(e) => e.target === e.currentTarget && closeResetPwdModal()}
        >
          <div className="a-modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title" id="reset-pwd-title">
                为「{resetPwdModal.user.name}」重置密码
              </div>
              <button type="button" className="a-modal-close" onClick={closeResetPwdModal}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">新密码</div>
                  <div className="a-kv-v">
                    <input
                      type="password"
                      className="a-filter-input"
                      value={resetPwdModal.newPassword}
                      onChange={(e) => setResetPwdForm(e.target.value)}
                      placeholder="请输入新密码（由管理员设置后告知该用户）"
                      style={{ width: '100%' }}
                      autoComplete="new-password"
                    />
                  </div>
                </div>
              </div>
              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <button type="button" className="a-btn" onClick={submitResetPassword}>
                  确定
                </button>
                <button type="button" className="a-btn ghost" onClick={closeResetPwdModal}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
