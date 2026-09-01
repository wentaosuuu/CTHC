import { useState } from 'react'

/** 角色 */
type Role = {
  id: string
  name: string
  code: string
  description: string
  /** 可访问的菜单 id 列表 */
  menuIds: string[]
}

/** 与侧边栏一致的菜单项（用于权限分配） */
const MENU_OPTIONS: { id: string; label: string; path: string }[] = [
  { id: 'home', label: '首页', path: '/' },
  { id: 'houses', label: '资产管理', path: '/houses' },
  { id: 'orders', label: '订单管理', path: '/orders' },
  { id: 'contracts', label: '合同管理', path: '/contracts' },
  { id: 'sublets', label: '转租管理', path: '/sublets' },
  { id: 'tenant_profiles', label: '租客档案', path: '/tenant-profiles' },
  { id: 'transactions', label: '交易记录', path: '/transactions' },
  { id: 'contract_prepayments', label: '合同预收款', path: '/contract-prepayments' },
  { id: 'bills', label: '账单管理', path: '/bills' },
  { id: 'overdue', label: '欠费预警', path: '/overdue' },
  { id: 'rent_reminders', label: '催租记录', path: '/rent-reminders' },
  { id: 'reports', label: '报表管理', path: '/reports' },
  { id: 'ledger_book', label: '记账本', path: '/ledger-book' },
  { id: 'system_departments', label: '部门管理', path: '/system/departments' },
  { id: 'system_roles', label: '角色管理', path: '/system/roles' },
  { id: 'system_users', label: '用户管理', path: '/system/users' },
]

const initialRoles: Role[] = [
  {
    id: 'role_system_admin',
    name: '系统管理员',
    code: 'SYSTEM_ADMIN',
    description: '拥有全量权限，可配置门店、账号、房源同步等',
    menuIds: MENU_OPTIONS.map((m) => m.id),
  },
  {
    id: 'role_store_manager',
    name: '店长',
    code: 'STORE_MANAGER',
    description: '只能查看和操作自己门店的数据',
    menuIds: ['home', 'houses', 'orders', 'contracts', 'sublets', 'tenant_profiles', 'transactions', 'contract_prepayments', 'bills', 'overdue', 'rent_reminders', 'reports', 'ledger_book'],
  },
  {
    id: 'role_finance',
    name: '财务',
    code: 'FINANCE',
    description: '可审批收据重打、作废收据，查看全部门店交易与账单',
    menuIds: ['home', 'transactions', 'contract_prepayments', 'bills', 'overdue', 'rent_reminders', 'reports', 'ledger_book'],
  },
]

export function SystemRolesPage() {
  const [roles, setRoles] = useState<Role[]>(initialRoles)
  const [roleModal, setRoleModal] = useState<{
    type: 'add' | 'edit'
    role?: Role
    form: { name: string; code: string; description: string }
  } | null>(null)
  const [menuModalRole, setMenuModalRole] = useState<Role | null>(null)
  const [menuSelectedIds, setMenuSelectedIds] = useState<Set<string>>(new Set())

  const openAddRole = () => {
    setRoleModal({
      type: 'add',
      form: { name: '', code: '', description: '' },
    })
  }

  const openEditRole = (role: Role) => {
    setRoleModal({
      type: 'edit',
      role,
      form: {
        name: role.name,
        code: role.code,
        description: role.description,
      },
    })
  }

  const closeRoleModal = () => setRoleModal(null)

  const setRoleForm = (patch: Partial<{ name: string; code: string; description: string }>) => {
    if (!roleModal) return
    setRoleModal({ ...roleModal, form: { ...roleModal.form, ...patch } })
  }

  const saveRole = () => {
    if (!roleModal) return
    const { name, code, description } = roleModal.form
    if (!name.trim()) return
    if (roleModal.type === 'add') {
      const newId = 'role_' + Date.now()
      setRoles((prev) => [
        ...prev,
        {
          id: newId,
          name: name.trim(),
          code: code.trim() || newId.toUpperCase().replace('ROLE_', ''),
          description: description.trim(),
          menuIds: [],
        },
      ])
    } else if (roleModal.role) {
      setRoles((prev) =>
        prev.map((r) =>
          r.id === roleModal.role!.id
            ? { ...r, name: name.trim(), code: code.trim(), description: description.trim() }
            : r
        )
      )
    }
    closeRoleModal()
  }

  const openMenuModal = (role: Role) => {
    setMenuModalRole(role)
    setMenuSelectedIds(new Set(role.menuIds))
  }

  const closeMenuModal = () => {
    setMenuModalRole(null)
    setMenuSelectedIds(new Set())
  }

  const toggleMenu = (id: string) => {
    setMenuSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllMenus = () => setMenuSelectedIds(new Set(MENU_OPTIONS.map((m) => m.id)))
  const clearAllMenus = () => setMenuSelectedIds(new Set())

  const saveMenuPermission = () => {
    if (!menuModalRole) return
    const ids = Array.from(menuSelectedIds)
    setRoles((prev) =>
      prev.map((r) => (r.id === menuModalRole.id ? { ...r, menuIds: ids } : r))
    )
    closeMenuModal()
  }

  const getMenuLabel = (menuId: string) => MENU_OPTIONS.find((m) => m.id === menuId)?.label ?? menuId

  const roleMenuSummary = (role: Role) => {
    if (role.menuIds.length === 0) return '未分配'
    if (role.menuIds.length === MENU_OPTIONS.length) return '全部'
    return role.menuIds.map(getMenuLabel).join('、')
  }

  return (
    <div className="a-col" style={{ width: '100%', minWidth: 0 }}>
      <div className="a-card">
        <div className="a-h1">角色管理</div>
        <div className="a-muted">
          角色决定功能权限范围，例如“系统管理员、店长”等。可在此新增、修改角色，并为角色分配可访问的菜单，从而控制不同角色能看到哪些功能。
        </div>
      </div>

      <div className="a-card" style={{ overflow: 'hidden' }}>
        <div className="a-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="a-muted">共 {roles.length} 个角色</span>
          <button type="button" className="a-btn" onClick={openAddRole}>
            新增角色
          </button>
        </div>
        <div className="a-table-wrap">
          <table className="a-table a-table-sticky-op" style={{ width: '100%', minWidth: 640, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '28%' }} />
              <col style={{ width: '32%' }} />
              <col style={{ width: '14%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>角色名称</th>
                <th>编码</th>
                <th>说明</th>
                <th>菜单权限</th>
                <th className="a-op-col">操作</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id}>
                  <td>{role.name}</td>
                  <td><code style={{ fontSize: 12 }}>{role.code}</code></td>
                  <td className="a-muted">{role.description || '-'}</td>
                  <td className="a-muted" style={{ wordBreak: 'break-word' }}>
                    {roleMenuSummary(role)}
                  </td>
                  <td className="a-op-cell">
                    <div className="a-op-actions">
                      <button type="button" className="a-btn ghost" onClick={() => openEditRole(role)}>
                        修改
                      </button>
                      <button type="button" className="a-btn ghost" onClick={() => openMenuModal(role)}>
                        分配菜单
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增/编辑角色弹窗 */}
      {roleModal && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && closeRoleModal()}
        >
          <div className="a-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">
                {roleModal.type === 'add' ? '新增角色' : '修改角色信息'}
              </div>
              <button type="button" className="a-modal-close" onClick={closeRoleModal}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">角色名称</div>
                  <div className="a-kv-v">
                    <input
                      type="text"
                      className="a-filter-input"
                      value={roleModal.form.name}
                      onChange={(e) => setRoleForm({ name: e.target.value })}
                      placeholder="如：系统管理员、店长"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">编码</div>
                  <div className="a-kv-v">
                    <input
                      type="text"
                      className="a-filter-input"
                      value={roleModal.form.code}
                      onChange={(e) => setRoleForm({ code: e.target.value })}
                      placeholder="如：SYSTEM_ADMIN（英文，用于系统识别）"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">说明</div>
                  <div className="a-kv-v">
                    <input
                      type="text"
                      className="a-filter-input"
                      value={roleModal.form.description}
                      onChange={(e) => setRoleForm({ description: e.target.value })}
                      placeholder="选填，描述该角色的权限范围"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              </div>
              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <button type="button" className="a-btn" onClick={saveRole}>
                  {roleModal.type === 'add' ? '确定新增' : '保存'}
                </button>
                <button type="button" className="a-btn ghost" onClick={closeRoleModal}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 分配菜单权限弹窗 */}
      {menuModalRole && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && closeMenuModal()}
        >
          <div className="a-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">分配菜单权限 · {menuModalRole.name}</div>
              <button type="button" className="a-modal-close" onClick={closeMenuModal}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <p className="a-muted" style={{ marginBottom: 12 }}>
                勾选该角色可访问的菜单，未勾选的菜单在侧边栏将不可见。
              </p>
              <div className="a-row" style={{ gap: 8, marginBottom: 12 }}>
                <button type="button" className="a-btn ghost" onClick={selectAllMenus}>
                  全选
                </button>
                <button type="button" className="a-btn ghost" onClick={clearAllMenus}>
                  清空
                </button>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '8px 16px',
                  maxHeight: 320,
                  overflow: 'auto',
                }}
              >
                {MENU_OPTIONS.map((menu) => (
                  <label
                    key={menu.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      fontSize: 14,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={menuSelectedIds.has(menu.id)}
                      onChange={() => toggleMenu(menu.id)}
                    />
                    <span>{menu.label}</span>
                  </label>
                ))}
              </div>
              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <button type="button" className="a-btn" onClick={saveMenuPermission}>
                  保存
                </button>
                <button type="button" className="a-btn ghost" onClick={closeMenuModal}>
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
