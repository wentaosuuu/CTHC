const KEY = 'h5_rent_cart_v1'

/** 泊湾公寓单独结算；商铺 / 厂房 / 住宅等归为「其他」一并结算 */
export const BOWAN_ASSET_TYPE = '泊湾公寓'
export type CartCheckoutLane = 'bowan' | 'other'

const cartListeners = new Set<() => void>()

function notifyCartListeners() {
  cartListeners.forEach((fn) => {
    try {
      fn()
    } catch {
      // ignore
    }
  })
}

/** 购物车变更时触发（同标签页内同步底部购物车条等） */
export function subscribeCart(listener: () => void) {
  cartListeners.add(listener)
  return () => {
    cartListeners.delete(listener)
  }
}

export type CartLine = {
  houseId: string
  leaseMonths: number
  moveInDate: string
  title: string
  subtitle: string
  rentMonthly: number
  assetType: string
}

export function isBowanAssetType(assetType: string | undefined | null): boolean {
  return (assetType ?? '').trim() === BOWAN_ASSET_TYPE
}

export function cartCheckoutLane(assetType: string | undefined | null): CartCheckoutLane {
  return isBowanAssetType(assetType) ? 'bowan' : 'other'
}

export function filterCartByLane(lines: CartLine[], lane: CartCheckoutLane): CartLine[] {
  return lines.filter((l) => cartCheckoutLane(l.assetType) === lane)
}

/** 购物车是否同时含泊湾与其他类（需分两次结算） */
export function cartHasMixedLanes(lines: CartLine[]): boolean {
  if (lines.length <= 1) return false
  let hasBowan = false
  let hasOther = false
  for (const l of lines) {
    if (isBowanAssetType(l.assetType)) hasBowan = true
    else hasOther = true
    if (hasBowan && hasOther) return true
  }
  return false
}

export function cartLaneLabel(lane: CartCheckoutLane): string {
  return lane === 'bowan' ? '泊湾公寓' : '商铺 / 厂房 / 住宅'
}

export function getCart(): CartLine[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const p = JSON.parse(raw) as unknown
    if (!Array.isArray(p)) return []
    return p.filter(
      (x) =>
        x &&
        typeof x === 'object' &&
        typeof (x as CartLine).houseId === 'string' &&
        typeof (x as CartLine).title === 'string',
    ) as CartLine[]
  } catch {
    return []
  }
}

export function setCart(lines: CartLine[]) {
  localStorage.setItem(KEY, JSON.stringify(lines))
  notifyCartListeners()
}

/** 列表/详情快速加入购物车时的默认行数据 */
export function defaultCartLineFromHouse(h: {
  id: string
  apartmentName: string
  houseNo: string
  storeName: string
  houseType: string
  area: number
  rentMonthly: number
  assetType?: string
}): CartLine {
  return {
    houseId: h.id,
    leaseMonths: 12,
    moveInDate: new Date().toISOString().slice(0, 10),
    title: `${h.apartmentName} · ${h.houseNo}`,
    subtitle: `${h.storeName} · ${h.houseType} · ${h.area}㎡`,
    rentMonthly: h.rentMonthly,
    assetType: (h.assetType ?? '').trim() || '住宅',
  }
}

export function addToCart(line: CartLine) {
  const cur = getCart()
  if (cur.some((x) => x.houseId === line.houseId)) {
    setCart(cur.map((x) => (x.houseId === line.houseId ? { ...x, ...line } : x)))
    return
  }
  setCart([...cur, line])
}

export function removeFromCart(houseId: string) {
  setCart(getCart().filter((x) => x.houseId !== houseId))
}

export function removeManyFromCart(houseIds: string[]) {
  const drop = new Set(houseIds)
  setCart(getCart().filter((x) => !drop.has(x.houseId)))
}

export function clearCart() {
  localStorage.removeItem(KEY)
  notifyCartListeners()
}

export function cartCount(): number {
  return getCart().length
}

/** 批量更新购物车中若干套的租期/起租日（结算页同步用） */
export function patchCartLines(
  houseIds: string[],
  patch: Partial<Pick<CartLine, 'leaseMonths' | 'moveInDate'>>,
) {
  if (!houseIds.length) return
  const ids = new Set(houseIds)
  setCart(
    getCart().map((l) => (ids.has(l.houseId) ? { ...l, ...patch } : l)),
  )
}
