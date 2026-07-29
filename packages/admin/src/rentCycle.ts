/** 与合同 rentCycle 字段及后端校验一致 */
export type RentCycle = 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'YEARLY'

export function normalizeRentCycle(v: string | undefined | null): RentCycle {
  if (v === 'BIMONTHLY' || v === 'QUARTERLY' || v === 'SEMIANNUAL' || v === 'YEARLY') return v
  return 'MONTHLY'
}

export function rentCycleLabel(c: RentCycle) {
  switch (c) {
    case 'MONTHLY':
      return '月付'
    case 'BIMONTHLY':
      return '双月'
    case 'QUARTERLY':
      return '季付'
    case 'SEMIANNUAL':
      return '半年'
    default:
      return '年付'
  }
}
