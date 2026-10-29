import { ADMIN_MENU_OPTIONS } from './adminNavigation'

export const SYSTEM_ROLE_KEY = 'cthc.prototype-sync.v1.system-roles'
export const SYSTEM_USER_KEY = 'cthc.prototype-sync.v1.system-users'
export const DEPARTMENT_SUPPLEMENT_KEY = 'cthc.prototype-sync.v1.department-supplements'

export type DemoRole = {
  id: string; number: string; name: string; code: string; description: string
  menuIds: string[]; sortOrder: number; status: 'normal' | 'disabled'; createdAt: string
}
export type DemoSystemUser = {
  id: string; number: string; name: string; login: string; roleCode: string; storeIds: string[]
  status: 'normal' | 'disabled'; departmentId: string; phone: string; email: string; gender: string
  post: string; remark: string; passwordConfigured: boolean; passwordUpdatedAt: string; createdAt: string
}
export type DepartmentSupplement = {
  id: string; sortOrder: number; leader: string; email: string; status: 'normal' | 'disabled'; createdAt: string
}
export const INITIAL_DEMO_ROLES: DemoRole[] = [
  { id: 'role_system_admin', number: 'ROLE-DEMO-001', name: '系统管理员', code: 'SYSTEM_ADMIN', description: '虚构角色，仅演示菜单勾选，不实际授权',
    menuIds: ADMIN_MENU_OPTIONS.map((menu) => menu.id), sortOrder: 1, status: 'normal', createdAt: '' },
  { id: 'role_store_manager', number: 'ROLE-DEMO-002', name: '店长', code: 'STORE_MANAGER', description: '虚构角色，原有门店分配演示保留',
    menuIds: ADMIN_MENU_OPTIONS.filter((menu) => !menu.id.startsWith('system_')).map((menu) => menu.id), sortOrder: 2, status: 'normal', createdAt: '' },
  { id: 'role_finance', number: 'ROLE-DEMO-003', name: '财务', code: 'FINANCE', description: '虚构角色，不修改实际财务权限',
    menuIds: ['home', 'transactions', 'reprint_approvals', 'contract_prepayments', 'bills', 'reports'], sortOrder: 3, status: 'normal', createdAt: '' },
]
export const INITIAL_DEMO_SYSTEM_USERS: DemoSystemUser[] = [
  { id: 'u1', number: 'USER-DEMO-001', name: '演示管理员', login: 'demo-admin', roleCode: 'SYSTEM_ADMIN', storeIds: ['hq'], status: 'normal', departmentId: '', phone: '', email: '', gender: '', post: '', remark: '虚构演示账号，不用于登录', passwordConfigured: true, passwordUpdatedAt: '', createdAt: '' },
  { id: 'u2', number: 'USER-DEMO-002', name: '演示店长', login: 'demo-manager', roleCode: 'STORE_MANAGER', storeIds: ['jn'], status: 'normal', departmentId: '', phone: '', email: '', gender: '', post: '', remark: '虚构演示账号，不用于登录', passwordConfigured: true, passwordUpdatedAt: '', createdAt: '' },
  { id: 'u3', number: 'USER-DEMO-003', name: '演示财务', login: 'demo-finance', roleCode: 'FINANCE', storeIds: ['hq'], status: 'normal', departmentId: '', phone: '', email: '', gender: '', post: '', remark: '虚构演示账号，不用于登录', passwordConfigured: true, passwordUpdatedAt: '', createdAt: '' },
]
export const DEMO_STORES = [
  { id: 'hq', name: '总部' }, { id: 'jn', name: '南宁市-江南区' }, { id: 'qx', name: '南宁市-青秀区' },
  { id: 'xn', name: '南宁市-兴宁区' }, { id: 'xxt', name: '南宁市-西乡塘区' }, { id: 'yn', name: '南宁市-邕宁区' },
  { id: 'wm', name: '南宁市-武鸣区' }, { id: 'lq', name: '南宁市-良庆区' },
]
const hasStrings = (value: object, keys: string[]) => keys.every((key) => typeof (value as Record<string, unknown>)[key] === 'string')
export function isDemoRole(value: unknown): value is DemoRole {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<DemoRole>
  return hasStrings(value, ['id', 'number', 'name', 'code', 'description', 'createdAt']) &&
    typeof row.sortOrder === 'number' && Number.isFinite(row.sortOrder) && ['normal', 'disabled'].includes(String(row.status)) &&
    Array.isArray(row.menuIds) && row.menuIds.every((id) => typeof id === 'string')
}
export function isDemoSystemUser(value: unknown): value is DemoSystemUser {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<DemoSystemUser>
  return hasStrings(value, ['id', 'number', 'name', 'login', 'roleCode', 'departmentId', 'phone', 'email', 'gender', 'post', 'remark', 'passwordUpdatedAt', 'createdAt']) &&
    ['normal', 'disabled'].includes(String(row.status)) && typeof row.passwordConfigured === 'boolean' &&
    Array.isArray(row.storeIds) && row.storeIds.every((id) => typeof id === 'string') &&
    !('password' in value) && !('newPassword' in value)
}
export function isDepartmentSupplement(value: unknown): value is DepartmentSupplement {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<DepartmentSupplement>
  return hasStrings(value, ['id', 'leader', 'email', 'createdAt']) && typeof row.sortOrder === 'number' && Number.isFinite(row.sortOrder) &&
    ['normal', 'disabled'].includes(String(row.status))
}
export function readDemoSystemRoles(): DemoRole[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(SYSTEM_ROLE_KEY) ?? 'null')
    if (data && typeof data === 'object' && 'version' in data && data.version === 1 && 'records' in data &&
      Array.isArray(data.records) && data.records.every(isDemoRole)) return data.records
  } catch { /* 使用虚构默认角色，不影响页面打开。 */ }
  return INITIAL_DEMO_ROLES
}
export function systemTime(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}
export function inCreatedRange(value: string, from: string, to: string): boolean {
  if (!from && !to) return true
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return false
  const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
  return (!from || day >= from) && (!to || day <= to)
}
