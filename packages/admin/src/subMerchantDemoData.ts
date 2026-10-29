import type { DemoDirectoryRecord } from './components/DemoDirectoryPage'

export const INITIAL_DEMO_SUB_MERCHANTS: DemoDirectoryRecord[] = [
  { id: 'merchant-demo-1', number: 'SH-DEMO-001', enabled: true, createdAt: '2026/10/26 09:00:00',
    values: { name: '演示子商户甲（虚构）', wechatMerchantNo: 'DEMO-WX-001', appId: 'DEMO-APP-001', remark: '正常状态示例，不发起真实支付' } },
  { id: 'merchant-demo-2', number: 'SH-DEMO-002', enabled: false, createdAt: '2026/10/26 09:00:00',
    values: { name: '演示子商户乙（虚构）', wechatMerchantNo: 'DEMO-WX-002', appId: '', remark: '停用后不可用于支付' } },
]

export const SUB_MERCHANTS_STORAGE_KEY = 'cthc.prototype-sync.v1.sub-merchants'

/** 仅向本地原型提供正常子商户，不代表已接入支付服务。 */
export function readEnabledDemoSubMerchants(): { id: string; name: string }[] {
  let records = INITIAL_DEMO_SUB_MERCHANTS
  try {
    const raw = localStorage.getItem(SUB_MERCHANTS_STORAGE_KEY)
    if (raw) {
      const stored: unknown = JSON.parse(raw)
      if (typeof stored === 'object' && stored && 'version' in stored && stored.version === 1 &&
        'records' in stored && Array.isArray(stored.records)) {
        records = stored.records.filter((row): row is DemoDirectoryRecord => typeof row === 'object' && row !== null &&
          typeof row.id === 'string' && typeof row.enabled === 'boolean' && typeof row.values === 'object' && row.values !== null &&
          typeof row.values.name === 'string')
      }
    }
  } catch { /* 无法读取本地演示存储时沿用虚构初始记录。 */ }
  return records.filter((row) => row.enabled).map((row) => ({ id: row.id, name: row.values.name }))
}
