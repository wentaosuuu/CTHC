import type { DemoDirectoryRecord } from './components/DemoDirectoryPage'

export const INITIAL_DEMO_BROKERS: DemoDirectoryRecord[] = [
  { id: 'broker-demo-1', number: 'JJ-DEMO-001', enabled: true, createdAt: '2026/10/26 09:00:00',
    values: { name: '演示经纪人甲', idNumber: 'DEMO-ID-001（虚构）', agency: '演示中介机构甲（虚构）', remark: '用于启停、修改与删除演示' } },
  { id: 'broker-demo-2', number: 'JJ-DEMO-002', enabled: false, createdAt: '2026/10/26 09:00:00',
    values: { name: '演示经纪人乙', idNumber: 'DEMO-ID-002（虚构）', agency: '演示中介机构乙（虚构）', remark: '停用状态示例' } },
]

export const BROKERS_STORAGE_KEY = 'cthc.prototype-sync.v1.brokers'

/** 供房源住建等演示页选择经纪人，不读取开发站真实资料。 */
export function readEnabledDemoBrokers(): { id: string; name: string; agency: string }[] {
  let records = INITIAL_DEMO_BROKERS
  try {
    const raw = localStorage.getItem(BROKERS_STORAGE_KEY)
    if (raw) {
      const stored: unknown = JSON.parse(raw)
      if (typeof stored === 'object' && stored && 'version' in stored && stored.version === 1 &&
        'records' in stored && Array.isArray(stored.records)) {
        records = stored.records.filter((row): row is DemoDirectoryRecord => typeof row === 'object' && row !== null &&
          typeof row.id === 'string' && typeof row.enabled === 'boolean' && typeof row.values === 'object' && row.values !== null &&
          typeof row.values.name === 'string' && typeof row.values.agency === 'string')
      }
    }
  } catch { /* 浏览器无法读取时沿用虚构初始经纪人。 */ }
  return records.filter((row) => row.enabled).map((row) => ({ id: row.id, name: row.values.name, agency: row.values.agency }))
}

