/** 与管理端 `BillsPage.formatBillNo` 算法一致，用于按「账单编号 ZD…」反查账单 */
export function displayBillNoFromId(billId: string, digits = 10): string {
  let h = 0
  for (let i = 0; i < billId.length; i += 1) h = (h * 31 + billId.charCodeAt(i)) >>> 0
  const s = String(h).padStart(digits, '0')
  return `ZD${s.slice(-digits)}`
}
