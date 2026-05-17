/** 列表/卡片上的简短支付阻断提示（不罗列全部历史账期） */
export function shortPayBlockedHint(reason?: string | null): string | null {
  const t = (reason ?? '').trim()
  if (!t) return null
  if (/更早账期|请先结清/.test(t)) {
    return '您有待支付的历史账单，请先结清后再支付本期'
  }
  if (/线下部分收款/.test(t)) {
    return '该账单含线下部分收款，请联系门店处理'
  }
  return '当前账单暂不可在线支付'
}
