export type HouseConfigItem = { label: string; on: boolean }

export function parseHouseConfigItems(raw: string | null | undefined): HouseConfigItem[] {
  try {
    const p = JSON.parse(raw ?? '[]')
    if (!Array.isArray(p)) return []
    const out: HouseConfigItem[] = []
    for (const x of p) {
      if (!x || typeof x !== 'object') continue
      const label = String((x as { label?: unknown }).label ?? '').trim().slice(0, 80)
      if (!label) continue
      out.push({ label, on: Boolean((x as { on?: unknown }).on) })
    }
    return out
  } catch {
    return []
  }
}

export function serializeHouseConfigItems(items: HouseConfigItem[]): string {
  return JSON.stringify(
    items
      .map((x) => ({ label: String(x.label ?? '').trim().slice(0, 80), on: Boolean(x.on) }))
      .filter((x) => x.label),
  )
}

/** Excel「房屋配置」列：逗号/顿号/分号等分隔，导入为全部勾选 */
export function houseConfigFromImportText(text: string): HouseConfigItem[] {
  const parts = String(text ?? '')
    .split(/[,，;；、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const out: HouseConfigItem[] = []
  for (const label of parts) {
    const k = label.slice(0, 80)
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ label: k, on: true })
  }
  return out
}
