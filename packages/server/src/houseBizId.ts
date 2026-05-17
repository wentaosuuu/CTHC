/** 与房源业务编号、订单号等展示用数字编码一致（演示用） */
export function numericCodeFromId(id: string, digits = 12) {
  let h = 0
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0
  const s = String(h).padStart(digits, '0')
  return s.slice(-digits)
}

/** 后台列表展示的房源业务编号 */
export function houseBizId(houseId: string) {
  return `FY${numericCodeFromId(houseId, 10)}`
}
