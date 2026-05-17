export type HouseConfigItem = { label: string; on: boolean }

/** 与后台房源配置常用项对齐，用于图标与演示数据 */
export const PRESET_HOUSE_CONFIG_LABELS = [
  '电视',
  '沙发',
  '热水',
  '空调',
  '洗衣机',
  '冰箱',
  '宽带',
  '衣柜',
  '燃气灶',
  '热水器',
  '独立卫浴',
] as const

const CONFIG_ICONS: Record<string, string> = {
  电视: '📺',
  沙发: '🛋️',
  热水: '♨️',
  空调: '❄️',
  洗衣机: '🧺',
  冰箱: '🧊',
  宽带: '📶',
  衣柜: '👔',
  燃气灶: '🔥',
  热水器: '🚿',
  独立卫浴: '🚽',
  床: '🛏️',
  书桌: '📚',
  油烟机: '💨',
  微波炉: '🍲',
}

export function houseConfigIcon(label: string): string {
  const k = (label ?? '').trim()
  return CONFIG_ICONS[k] ?? '✓'
}

/** 后台未维护配置时的演示数据（便于 H5 预览完整能力） */
export function demoHouseConfigItems(): HouseConfigItem[] {
  return [
    { label: '空调', on: true },
    { label: '热水器', on: true },
    { label: '热水', on: true },
    { label: '洗衣机', on: true },
    { label: '冰箱', on: true },
    { label: '电视', on: true },
    { label: '沙发', on: true },
    { label: '宽带', on: true },
    { label: '衣柜', on: true },
    { label: '独立卫浴', on: true },
    { label: '燃气灶', on: false },
  ]
}

/** 合并后台数据与常用项展示顺序；无后台数据时用演示集 */
export function resolveHouseConfigItems(saved: HouseConfigItem[] | undefined): HouseConfigItem[] {
  const list = (saved ?? []).filter((x) => (x.label ?? '').trim())
  if (list.length > 0) {
    const order = new Map(PRESET_HOUSE_CONFIG_LABELS.map((l, i) => [l, i]))
    return [...list].sort((a, b) => {
      const ai = order.get(a.label.trim()) ?? 99
      const bi = order.get(b.label.trim()) ?? 99
      return ai - bi || a.label.localeCompare(b.label, 'zh-CN')
    })
  }
  return demoHouseConfigItems()
}

export function countHouseConfigOn(items: HouseConfigItem[]): number {
  return items.filter((x) => x.on && (x.label ?? '').trim()).length
}

/** 资产类型标签样式（列表/详情共用） */
export function assetTypePillClass(assetType: string): string {
  const base = 'm-house-asset-pill'
  switch (assetType) {
    case '泊湾公寓':
      return `${base} m-house-asset-pill--bowan`
    case '人才公寓':
      return `${base} m-house-asset-pill--talent`
    case '商铺':
      return `${base} m-house-asset-pill--shop`
    case '厂房':
      return `${base} m-house-asset-pill--factory`
    case '住宅':
      return `${base} m-house-asset-pill--residential`
    default:
      return `${base} m-house-asset-pill--default`
  }
}
