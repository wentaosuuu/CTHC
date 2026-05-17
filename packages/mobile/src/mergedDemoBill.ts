import type { MyBillDetail } from './api'

export type MergedDemoBillLine = MyBillDetail['items'][number]

/** 与种子库合并合同示例一致：三套月租 + 按租占比分摊的杂费 */
const ASSET_LABELS = ['江南·梧桐公寓 · 624', '西乡塘·青年社区 · 927', '邕宁·花园公寓 · 514'] as const
const ASSET_RENTS = [7600, 5300, 4400] as const
const RENT_SUM = ASSET_RENTS[0] + ASSET_RENTS[1] + ASSET_RENTS[2]

const EXTRA_POOL: Record<string, number> = {
  水费: 216,
  电费: 368,
  物业费: 285,
  垃圾处理费: 84,
  公摊电费: 118,
  燃气费: 52,
  网络费: 156,
  滞纳金: 0,
}

function splitPoolInt(pool: number): number[] {
  const parts = ASSET_RENTS.map((r) => Math.floor((pool * r) / RENT_SUM))
  let diff = pool - parts.reduce((a, b) => a + b, 0)
  let i = parts.length - 1
  while (diff > 0 && i >= 0) {
    parts[i]! += 1
    diff -= 1
    i -= 1
  }
  return parts
}

/** 合并合同 BASE 账期：每套一行，行内 breakdown 为月租 + 各项杂费 */
export function buildMergedDemoBaseLineItems(): { items: MergedDemoBillLine[]; totalAmount: number } {
  const items: MergedDemoBillLine[] = ASSET_LABELS.map((name, i) => {
    const breakdown: { label: string; amount: number }[] = [{ label: '月租', amount: ASSET_RENTS[i] }]
    for (const [label, pool] of Object.entries(EXTRA_POOL)) {
      if (pool <= 0) continue
      const parts = splitPoolInt(pool)
      breakdown.push({ label, amount: parts[i]! })
    }
    const amount = breakdown.reduce((s, x) => s + x.amount, 0)
    return { name, amount, breakdown }
  })
  const totalAmount = items.reduce((s, it) => s + it.amount, 0)
  return { items, totalAmount }
}
