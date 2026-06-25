import type { RentCycle } from './rentCycle'

export function rentDueDayFromYmd(ymd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim())
  if (!m) return 1
  const d = parseInt(m[3], 10)
  return d >= 1 && d <= 31 ? d : 1
}

export function rentCycleDueDayHint(cycle: RentCycle): string {
  switch (cycle) {
    case 'BIMONTHLY':
      return '双月一付：每期在周期起始月的该日应交租'
    case 'QUARTERLY':
      return '季付：每期在周期起始月的该日应交租'
    case 'YEARLY':
      return '年付：每期在周期起始月的该日应交租'
    default:
      return '月付：每月在周期起始月的该日应交租'
  }
}

export function parseRentDueDayInput(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  const s = raw.trim()
  if (!s) return { ok: false, message: '请填写交租日（1–31）' }
  const n = parseInt(s, 10)
  if (Number.isNaN(n) || n < 1 || n > 31) return { ok: false, message: '交租日须为 1–31 的整数' }
  return { ok: true, value: n }
}
