export type AdminMenuItem = {
  id: string
  label: string
  path: string
}

export type AdminMenuGroup = {
  id: string
  label: string
  children: readonly AdminMenuItem[]
}

export type AdminMenuEntry = AdminMenuItem | AdminMenuGroup

/** 后台菜单与角色分配共用同一份业务目录。 */
export const ADMIN_NAVIGATION: readonly AdminMenuEntry[] = [
  {
    id: 'workbench_group', label: '工作台', children: [
      { id: 'workbench', label: '待办中心', path: '/workbench' },
    ],
  },
  { id: 'home', label: '仪表盘', path: '/' },
  {
    id: 'asset_group', label: '资产管理', children: [
      { id: 'houses', label: '资产列表', path: '/houses' },
      { id: 'contracts', label: '合同管理', path: '/contracts' },
    ],
  },
  { id: 'orders', label: '订单管理', path: '/orders' },
  {
    id: 'transaction_group', label: '交易记录', children: [
      { id: 'transactions', label: '交易记录列表', path: '/transactions' },
      { id: 'reprint_approvals', label: '再次导出审批', path: '/reprint-approvals' },
    ],
  },
  { id: 'sublets', label: '转租审核', path: '/sublets' },
  { id: 'bills', label: '账单管理', path: '/bills' },
  { id: 'overdue', label: '逾期管理', path: '/overdue' },
  { id: 'rent_reminders', label: '催租管理', path: '/rent-reminders' },
  { id: 'brokers', label: '经纪人', path: '/brokers' },
  { id: 'reports', label: '报表统计', path: '/reports' },
  {
    id: 'handover_group', label: '交接清单', children: [
      { id: 'handover_templates', label: '模板配置', path: '/handover-templates' },
    ],
  },
  { id: 'housing_houses', label: '房源住建', path: '/housing-houses' },
  {
    id: 'tenant_group', label: '租客档案', children: [
      { id: 'tenant_profiles', label: '租客列表', path: '/tenant-profiles' },
    ],
  },
  {
    id: 'temporary_collection_group', label: '临时收款', children: [
      { id: 'temporary_collections', label: '临时收款列表', path: '/temporary-collections' },
    ],
  },
  {
    id: 'prepayment_group', label: '合同预收款', children: [
      { id: 'contract_prepayments', label: '预收余额列表', path: '/contract-prepayments' },
    ],
  },
  {
    id: 'sub_merchant_group', label: '子商户管理', children: [
      { id: 'sub_merchants', label: '子商户列表', path: '/sub-merchants' },
    ],
  },
  {
    id: 'system_group', label: '系统管理', children: [
      { id: 'system_departments', label: '部门管理', path: '/system/departments' },
      { id: 'system_roles', label: '角色管理', path: '/system/roles' },
      { id: 'system_users', label: '用户管理', path: '/system/users' },
    ],
  },
]

export const ADMIN_MENU_OPTIONS: AdminMenuItem[] = ADMIN_NAVIGATION.flatMap((entry) =>
  'children' in entry ? [...entry.children] : [entry],
)

export function isAdminMenuActive(pathname: string, menuPath: string): boolean {
  return menuPath === '/' ? pathname === '/' : pathname === menuPath || pathname.startsWith(`${menuPath}/`)
}
