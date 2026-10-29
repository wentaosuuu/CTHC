import { DEMO_STORES, INITIAL_DEMO_SYSTEM_USERS, SYSTEM_USER_KEY, isDemoSystemUser, type DemoSystemUser } from './systemDemoData'

export type AssetManagerDepartment = { id: string; name: string; parentId: string | null; linkedStoreName?: string | null }
function readUsers(): DemoSystemUser[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SYSTEM_USER_KEY) ?? 'null')
    if (stored && typeof stored === 'object' && 'version' in stored && stored.version === 1 && 'records' in stored
      && Array.isArray(stored.records) && stored.records.every(isDemoSystemUser)) return stored.records
  } catch { /* 缺少组织资料时保留原候选，不把姓名记录伪装为登录授权。 */ }
  return INITIAL_DEMO_SYSTEM_USERS
}

export function assetManagerOptions(input: {
  storeName: string
  departments: AssetManagerDepartment[]
  existingNames: string[]
  selectedNames: string[]
}) {
  const users = readUsers()
  const store = DEMO_STORES.find((item) => item.name === input.storeName)
  const rootIds = input.departments.filter((department) => department.linkedStoreName === input.storeName || department.name === input.storeName).map((department) => department.id)
  const departmentIds = new Set(rootIds)
  let changed = true
  while (changed) {
    changed = false
    for (const department of input.departments) {
      if (department.parentId && departmentIds.has(department.parentId) && !departmentIds.has(department.id)) {
        departmentIds.add(department.id); changed = true
      }
    }
  }
  const scopedUsers = users.filter((user) => (store && user.storeIds.includes(store.id)) || departmentIds.has(user.departmentId))
  const knownNames = new Set(users.map((user) => user.name))
  const hasCompleteScope = Boolean(input.storeName && (store || rootIds.length) && input.departments.length
    && input.existingNames.every((name) => knownNames.has(name)))
  const names = [...new Set([
    ...scopedUsers.map((user) => user.name),
    ...(hasCompleteScope ? [] : input.existingNames),
    ...input.selectedNames,
  ].map((name) => name.trim()).filter(Boolean))].sort()
  return { names, hasCompleteScope }
}
