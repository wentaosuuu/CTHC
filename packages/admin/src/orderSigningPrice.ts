import { readAssetSupplement } from './assetDevelopment'

export type SigningPriceLine = {
  houseId: string
  label: string
  rentMonthly: string
  minimumRentSnapshot: number
}
export type OrderPriceSource = {
  house: { id: string; apartmentName: string; houseNo: string; rentMonthly: number; storeName: string }
  signedPriceLines?: { houseId: string; rentMonthly: number }[]
  bundleLines?: { houseId: string; apartmentName: string; houseNo: string; rentMonthlySnapshot: number; releasedAt: string | null }[] | null
  isMergedBundle?: boolean
}

export function orderSigningPriceLines(order: OrderPriceSource): SigningPriceLine[] {
  const saved = new Map(order.signedPriceLines?.map((line) => [line.houseId, line.rentMonthly]) ?? [])
  const houses = order.isMergedBundle && order.bundleLines?.length
    ? order.bundleLines.filter((line) => !line.releasedAt).map((line) => ({ id: line.houseId, label: `${line.apartmentName} ${line.houseNo}`, price: line.rentMonthlySnapshot }))
    : [{ id: order.house.id, label: `${order.house.apartmentName} ${order.house.houseNo}`, price: order.house.rentMonthly }]
  return houses.map((house) => ({ houseId: house.id, label: house.label, rentMonthly: String(saved.get(house.id) ?? house.price),
    minimumRentSnapshot: readAssetSupplement(house.id, order.house.storeName).negotiatedRent }))
}

export function validateSigningPriceLines(lines: SigningPriceLine[]): string | null {
  if (!lines.length) return '订单没有可调整的租赁资产'
  for (const line of lines) {
    const price = Number(line.rentMonthly)
    if (!line.rentMonthly.trim() || !Number.isSafeInteger(price) || price <= 0 || price > 2147483647) return `${line.label}：签约月租须为大于 0 的整数元`
    if (!Number.isFinite(line.minimumRentSnapshot) || line.minimumRentSnapshot < 0) return `${line.label}：协议定价无效，请先核对资产配置`
    if (price < Math.ceil(line.minimumRentSnapshot)) return `${line.label}：签约月租不得低于协议签约租金定价 ¥${line.minimumRentSnapshot}`
  }
  if (lines.reduce((sum, line) => sum + Number(line.rentMonthly), 0) > 2147483647) return '签约月租合计超出当前原型可保存范围'
  return null
}

/** 补全地址/面积等资产资料时保留订单签约快照，避免退回资产挂牌价格。 */
export function preserveSigningRents<T extends { id: string; rentMonthly: number }>(houses: T[], saved: { id: string; rentMonthly: number }[]): T[] {
  const prices = new Map(saved.map((house) => [house.id, house.rentMonthly]))
  return houses.map((house) => ({ ...house, rentMonthly: prices.get(house.id) ?? house.rentMonthly }))
}
