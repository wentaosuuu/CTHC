import type { RentCycle } from './rentCycle'

export type ContractTenantPick = {
  id: string
  name: string
  phone: string
  idNumber?: string
}

export type ContractHousePick = {
  id: string
  apartmentName: string
  houseNo: string
  storeName: string
  address: string
  area: number
  rentMonthly: number
  status?: string
  /** 户型（资产信息） */
  houseType?: string
}

export type PerformanceBondBase = 'FIRST_PERIOD' | 'LAST_PERIOD'

export type RentEscalationRow = {
  id: string
  yearIndex: number
  periodStart: string
  periodEnd: string
  incrementType: 'NONE' | 'PERCENT' | 'FIXED'
  incrementValue: string
  monthlyRent: number
}

function parseYmd(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, mo, d] = s.split('-').map(Number)
  return new Date(y, mo - 1, d)
}

function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function sumHouseArea(houses: ContractHousePick[]): number {
  return houses.reduce((s, h) => s + (h.area || 0), 0)
}

export function sumHouseRentMonthly(houses: ContractHousePick[]): number {
  return houses.reduce((s, h) => s + (h.rentMonthly || 0), 0)
}

export function formatHouseLocation(houses: ContractHousePick[]): string {
  return houses
    .map((h) => {
      const addr = (h.address || '').trim()
      if (addr) return addr
      return `${h.apartmentName} ${h.houseNo}（${h.storeName}）`
    })
    .filter(Boolean)
    .join('；')
}

export function leaseEndFromStartMonths(start: string, months: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || months < 1) return start
  const [y, mo, d] = start.split('-').map(Number)
  const dt = new Date(y, mo - 1 + months, d)
  dt.setDate(dt.getDate() - 1)
  return formatYmd(dt)
}

export function leaseMonthsFromRange(start: string, end: string): number {
  const a = parseYmd(start)
  const b = parseYmd(end)
  if (!a || !b || b < a) return 0
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (b.getDate() >= a.getDate()) months += 1
  return Math.max(1, Math.min(36, months))
}

function applyIncrement(prevRent: number, type: RentEscalationRow['incrementType'], valueStr: string): number {
  if (type === 'PERCENT') {
    const p = parseFloat(valueStr)
    if (Number.isNaN(p)) return prevRent
    return Math.round(prevRent * (1 + p / 100))
  }
  if (type === 'FIXED') {
    const add = parseFloat(valueStr)
    if (Number.isNaN(add)) return prevRent
    return Math.round(prevRent + add)
  }
  return prevRent
}

export function recalcRentEscalations(
  rows: RentEscalationRow[],
  leaseEnd: string,
  baseMonthlyRent: number,
): RentEscalationRow[] {
  if (!rows.length) return rows
  const sorted = [...rows].sort((a, b) => a.periodStart.localeCompare(b.periodStart))
  let prevRent = baseMonthlyRent
  return sorted.map((row, idx) => {
    const rent = idx === 0 ? baseMonthlyRent : applyIncrement(prevRent, row.incrementType, row.incrementValue)
    prevRent = rent
    const next = sorted[idx + 1]
    let periodEnd = leaseEnd
    if (next?.periodStart) {
      const d = parseYmd(next.periodStart)
      if (d) {
        d.setDate(d.getDate() - 1)
        periodEnd = formatYmd(d)
      }
    }
    return { ...row, yearIndex: idx + 1, periodEnd, monthlyRent: rent }
  })
}

export function createDefaultEscalationRow(rentStart: string, baseRent: number): RentEscalationRow {
  return {
    id: `esc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    yearIndex: 1,
    periodStart: rentStart,
    periodEnd: '',
    incrementType: 'NONE',
    incrementValue: '',
    monthlyRent: baseRent,
  }
}

/** 按面积×单价计算押金：不足 500 取 500，超过 500 向上取整 */
export function calcAreaBasedDeposit(rentableArea: string, ratePerSqm: number): number {
  const area = parseFloat(rentableArea.trim())
  if (Number.isNaN(area) || area <= 0) return 500
  const raw = ratePerSqm * area
  if (raw < 500) return 500
  return Math.ceil(raw)
}

export function performanceBondAmount(
  form: {
    performanceBondBase: PerformanceBondBase
    performanceBondMultiple: string
    rentEscalations: RentEscalationRow[]
    houses: ContractHousePick[]
  },
): number {
  const mult = parseFloat(form.performanceBondMultiple.trim() || '1')
  if (Number.isNaN(mult) || mult <= 0) return 0
  const rows = form.rentEscalations
  const baseRent = sumHouseRentMonthly(form.houses)
  if (!rows.length) return Math.round(baseRent * mult)
  const target =
    form.performanceBondBase === 'LAST_PERIOD' ? rows[rows.length - 1]!.monthlyRent : rows[0]!.monthlyRent
  return Math.round((target || baseRent) * mult)
}

export function validateRentEscalations(rows: RentEscalationRow[]): string | null {
  if (!rows.length) return '请至少添加一条递增幅度设置'
  for (const row of rows) {
    if (!row.periodStart) return `请填写第 ${row.yearIndex} 段租金的起始日`
    if (row.incrementType === 'PERCENT' && row.yearIndex > 1) {
      const p = parseFloat(row.incrementValue)
      if (Number.isNaN(p)) return `第 ${row.yearIndex} 段请填写递增百分比`
    }
    if (row.incrementType === 'FIXED' && row.yearIndex > 1) {
      const v = parseFloat(row.incrementValue)
      if (Number.isNaN(v)) return `第 ${row.yearIndex} 段请填写固定递增金额`
    }
  }
  return null
}

export type { RentCycle }
