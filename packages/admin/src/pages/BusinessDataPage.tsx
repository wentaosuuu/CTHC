import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api'
import { Pagination, paginate } from '../components/Pagination'
import './workbenchInsight.css'

type BusinessRow = {
  id: string
  reportDate: string
  reportKind: string
  reportKindLabel: string
  projectName: string
  occupancyRate: number
  collectionRate: number
  rentableArea: number
  rentedArea: number
  receivableAmount: number
  collectedAmount: number
  houseCount: number
  signedCount: number
  createdAt: string
}

function formatPct(rate: number) {
  return (rate * 100).toFixed(2)
}

function formatArea(n: number) {
  return n.toFixed(2)
}

function formatMoney(n: number) {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ymdLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 相对今天往前推若干个月，作为报告日起点 */
function monthsAgoYmd(months: number) {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return ymdLocal(d)
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  const safe = /^[=+@-]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const blob = new Blob(
    ['\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')],
    { type: 'text/csv;charset=utf-8' },
  )
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function BusinessDataPage() {
  const [items, setItems] = useState<BusinessRow[]>([])
  const [projects, setProjects] = useState<string[]>([])
  const [scheduleHint, setScheduleHint] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10 })

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    apiGet<{ scheduleHint: string; projects: string[]; items: BusinessRow[] }>(
      '/api/admin/workbench/business-metrics',
    ).then((r) => {
      if (!alive) return
      setLoading(false)
      if (!r.ok) {
        setError(r.error)
        setItems([])
        setProjects([])
        return
      }
      setScheduleHint(r.data.scheduleHint)
      setProjects(r.data.projects ?? [])
      setItems(r.data.items)
    })
    return () => { alive = false }
  }, [])

  const filtered = useMemo(() => {
    const scoped = items.filter((row) => {
      if (dateFrom && row.reportDate < dateFrom) return false
      if (dateTo && row.reportDate > dateTo) return false
      if (kindFilter && row.reportKind !== kindFilter) return false
      if (projectFilter && row.projectName !== projectFilter) return false
      return true
    })

    // 项目名称选「全部」：按报告日+节点汇总，列表项目名称展示「全部」
    if (projectFilter) return scoped

    const groups = new Map<string, BusinessRow>()
    for (const row of scoped) {
      const key = `${row.reportDate}__${row.reportKind}`
      const existing = groups.get(key)
      if (!existing) {
        groups.set(key, {
          ...row,
          id: `all_${key}`,
          projectName: '全部',
        })
        continue
      }
      existing.rentableArea += row.rentableArea
      existing.rentedArea += row.rentedArea
      existing.receivableAmount += row.receivableAmount
      existing.collectedAmount += row.collectedAmount
      existing.houseCount += row.houseCount
      existing.signedCount += row.signedCount
      if (row.createdAt > existing.createdAt) existing.createdAt = row.createdAt
    }

    return Array.from(groups.values()).map((row) => ({
      ...row,
      occupancyRate: row.rentableArea > 0 ? row.rentedArea / row.rentableArea : 0,
      collectionRate: row.receivableAmount > 0 ? row.collectedAmount / row.receivableAmount : 0,
    })).sort((a, b) => {
      const byDate = b.reportDate.localeCompare(a.reportDate)
      if (byDate !== 0) return byDate
      return a.reportKindLabel.localeCompare(b.reportKindLabel, 'zh-CN')
    })
  }, [items, kindFilter, projectFilter, dateFrom, dateTo])

  const paged = useMemo(
    () => paginate(filtered, pagination.page, pagination.pageSize),
    [filtered, pagination],
  )

  function resetPage() {
    setPagination((p) => ({ ...p, page: 1 }))
  }

  function setKindAndResetPage(value: string) {
    setKindFilter(value)
    resetPage()
  }

  function setProjectAndResetPage(value: string) {
    setProjectFilter(value)
    resetPage()
  }

  function setDateFromAndResetPage(value: string) {
    setDateFrom(value)
    resetPage()
  }

  function setDateToAndResetPage(value: string) {
    setDateTo(value)
    resetPage()
  }

  /** 快捷区间：日历可跳年，快捷项覆盖常见查询 */
  function applyDatePreset(preset: '3m' | '1y' | 'all') {
    if (preset === 'all') {
      setDateFrom('')
      setDateTo('')
    } else if (preset === '3m') {
      setDateFrom(monthsAgoYmd(3))
      setDateTo(ymdLocal(new Date()))
    } else {
      setDateFrom(monthsAgoYmd(12))
      setDateTo(ymdLocal(new Date()))
    }
    resetPage()
  }

  function resetFilters() {
    setKindFilter('')
    setProjectFilter('')
    setDateFrom('')
    setDateTo('')
    setPagination((p) => ({ ...p, page: 1 }))
  }

  function exportRows() {
    const rows: unknown[][] = [[
      '报告日', '节点类型', '项目名称', '出租率（%）', '收缴率（%）', '在租资产（套）', '总资产（套）', '已租面积（㎡）', '可租面积（㎡）', '实收（元）', '应收（元）', '生成时间',
    ]]
    for (const row of filtered) {
      rows.push([
        row.reportDate,
        row.reportKindLabel,
        row.projectName,
        formatPct(row.occupancyRate),
        formatPct(row.collectionRate),
        row.signedCount,
        row.houseCount,
        formatArea(row.rentedArea),
        formatArea(row.rentableArea),
        formatMoney(row.collectedAmount),
        formatMoney(row.receivableAmount),
        formatDateTime(row.createdAt),
      ])
    }
    downloadCsv(`业务数据-${new Date().toISOString().slice(0, 10)}.csv`, rows)
  }

  return (
    <div className="a-workbench-insight">
      <div className="a-muted">工作台</div>
      <div className="a-h1">业务数据</div>
      <p className="a-muted a-workbench-insight-lead">
        在每周一、每月 21 日、月末最后一天，按项目生成出租率与收缴率快照；每生成一次，各项目各新增一行。
      </p>

      <div className="a-card a-workbench-insight-toolbar a-workbench-list-filterbar">
        <label className="a-workbench-insight-field a-workbench-date-filter">
          <span>报告日起</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFromAndResetPage(e.target.value)}
          />
        </label>
        <label className="a-workbench-insight-field a-workbench-date-filter">
          <span>报告日止</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateToAndResetPage(e.target.value)}
          />
        </label>
        <div className="a-workbench-date-presets" role="group" aria-label="报告日快捷区间">
          <button
            type="button"
            className={`a-btn ghost a-workbench-preset-btn${!dateFrom && !dateTo ? ' is-active' : ''}`}
            onClick={() => applyDatePreset('all')}
          >
            全部日期
          </button>
          <button
            type="button"
            className="a-btn ghost a-workbench-preset-btn"
            onClick={() => applyDatePreset('3m')}
          >
            近3个月
          </button>
          <button
            type="button"
            className="a-btn ghost a-workbench-preset-btn"
            onClick={() => applyDatePreset('1y')}
          >
            近1年
          </button>
        </div>
        <label className="a-workbench-insight-field">
          <span>节点类型</span>
          <select value={kindFilter} onChange={(e) => setKindAndResetPage(e.target.value)}>
            <option value="">全部</option>
            <option value="WEEKLY_MON">每周一</option>
            <option value="MONTH_21">每月21日</option>
            <option value="MONTH_END">月末</option>
            <option value="MANUAL">手动生成</option>
          </select>
        </label>
        <label className="a-workbench-insight-field a-workbench-project-filter">
          <span>项目名称</span>
          <select value={projectFilter} onChange={(e) => setProjectAndResetPage(e.target.value)}>
            <option value="">全部</option>
            {projects.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <div className="a-workbench-op-filter-actions">
          <button type="button" className="a-btn ghost" onClick={resetFilters}>重置</button>
          <button type="button" className="a-btn ghost" onClick={exportRows} disabled={!filtered.length}>
            导出
          </button>
        </div>
      </div>

      {scheduleHint ? <p className="a-muted a-workbench-insight-hint">{scheduleHint}</p> : null}
      {error ? <div className="a-card a-workbench-insight-error">{error}</div> : null}

      <div className="a-card">
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>报告日</th>
                <th>节点类型</th>
                <th>项目名称</th>
                <th>出租率（%）</th>
                <th>收缴率（%）</th>
                <th>在租资产（套）</th>
                <th>总资产（套）</th>
                <th>已租面积（㎡）</th>
                <th>可租面积（㎡）</th>
                <th>实收（元）</th>
                <th>应收（元）</th>
                <th>生成时间</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} className="a-muted">加载中…</td></tr>
              ) : paged.items.length === 0 ? (
                <tr><td colSpan={12} className="a-muted">暂无业务快照</td></tr>
              ) : paged.items.map((row) => (
                <tr key={row.id}>
                  <td>{row.reportDate}</td>
                  <td>
                    <span className={`a-workbench-kind a-workbench-kind--${row.reportKind.toLowerCase()}`}>
                      {row.reportKindLabel}
                    </span>
                  </td>
                  <td>{row.projectName || '—'}</td>
                  <td>{formatPct(row.occupancyRate)}</td>
                  <td>{formatPct(row.collectionRate)}</td>
                  <td>{row.signedCount}</td>
                  <td>{row.houseCount}</td>
                  <td>{formatArea(row.rentedArea)}</td>
                  <td>{formatArea(row.rentableArea)}</td>
                  <td>{formatMoney(row.collectedAmount)}</td>
                  <td>{formatMoney(row.receivableAmount)}</td>
                  <td>{formatDateTime(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={filtered.length}
          onChange={setPagination}
        />
      </div>
    </div>
  )
}
