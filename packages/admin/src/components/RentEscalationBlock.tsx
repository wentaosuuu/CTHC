import type { CSSProperties } from 'react'
import {
  createDefaultEscalationRow,
  recalcRentEscalations,
  type RentEscalationRow,
} from '../contractFormShared'

type Props = {
  rows: RentEscalationRow[]
  leaseEnd: string
  baseMonthlyRent: number
  rentStart: string
  onChange: (rows: RentEscalationRow[]) => void
  label?: string
}

function addOneDay(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd
  const [y, mo, d] = ymd.split('-').map(Number)
  const dt = new Date(y, mo - 1, d)
  dt.setDate(dt.getDate() + 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export function RentEscalationBlock({
  rows,
  leaseEnd,
  baseMonthlyRent,
  rentStart,
  onChange,
  label = '租金递增设置',
}: Props) {
  function updateRow(id: string, patch: Partial<RentEscalationRow>) {
    const next = rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    onChange(recalcRentEscalations(next, leaseEnd, baseMonthlyRent))
  }

  function addRow() {
    const last = rows[rows.length - 1]
    const start = last?.periodEnd ? addOneDay(last.periodEnd) : rentStart
    const row: RentEscalationRow = {
      ...createDefaultEscalationRow(start, baseMonthlyRent),
      incrementType: 'PERCENT',
      incrementValue: '5',
    }
    onChange(recalcRentEscalations([...rows, row], leaseEnd, baseMonthlyRent))
  }

  function removeRow(id: string) {
    if (rows.length <= 1) return
    onChange(recalcRentEscalations(rows.filter((r) => r.id !== id), leaseEnd, baseMonthlyRent))
  }

  return (
    <div style={{ maxWidth: 620 }}>
      {rows.map((row) => (
        <div
          key={row.id}
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: 10,
            marginBottom: 10,
            fontSize: 13,
            lineHeight: 1.65,
          }}
        >
          <div style={{ marginBottom: 6 }}>
            （{row.yearIndex}）该物业的第 {row.yearIndex} 年（
            <input
              className="a-filter-input"
              type="date"
              value={row.periodStart}
              onChange={(e) => updateRow(row.id, { periodStart: e.target.value })}
              style={{ width: 138, margin: '0 4px' } as CSSProperties}
            />
            起至 {row.periodEnd || '—'} 止）每月租金为人民币 <strong>{row.monthlyRent > 0 ? row.monthlyRent : '—'}</strong>{' '}
            元/月。
          </div>
          {row.yearIndex > 1 ? (
            <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span>递增方式</span>
              <select
                className="a-filter-select"
                value={row.incrementType === 'NONE' ? 'PERCENT' : row.incrementType}
                onChange={(e) =>
                  updateRow(row.id, { incrementType: e.target.value as RentEscalationRow['incrementType'] })
                }
              >
                <option value="PERCENT">百分比</option>
                <option value="FIXED">固定值（元）</option>
              </select>
              <input
                className="a-filter-input"
                style={{ width: 80 }}
                value={row.incrementValue}
                onChange={(e) => updateRow(row.id, { incrementValue: e.target.value })}
                placeholder={row.incrementType === 'FIXED' ? '元' : '%'}
              />
            </div>
          ) : null}
          {rows.length > 1 ? (
            <button
              type="button"
              className="a-btn ghost"
              style={{ marginTop: 8, padding: '2px 8px', fontSize: 12 }}
              onClick={() => removeRow(row.id)}
            >
              删除本段
            </button>
          ) : null}
        </div>
      ))}
      <button type="button" className="a-btn ghost" onClick={addRow}>
        + 添加递增段
      </button>
      <div className="a-muted" style={{ marginTop: 6, fontSize: 12 }}>
        {label}：仅填每段起始日，截止日自动计算；新增递增点将重算月租金。
      </div>
    </div>
  )
}
