import { useEffect, useRef, useState } from 'react'
import { apiGet } from '../api'
import { getAdminToken } from '../auth'
import { Pagination, paginate } from '../components/Pagination'
import { TEMPLATE_REPORTS } from './templateReportCatalog'
import type { TemplateReportKey } from './templateReportCatalog'

type Filters = { storeId: string; keyword: string; periodFrom: string; periodTo: string; asOf: string; groupBy: string; feeName: string }
type ReportResult = { rows: { id: string; values: (string | number | null)[] }[]; notices: string[] }
function defaults(): Filters {
  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return { storeId: '', keyword: '', periodFrom: month, periodTo: month, asOf: month, groupBy: 'asset', feeName: '' }
}
function queryFor(type: TemplateReportKey, filters: Filters) {
  const values: Record<string, string> = { storeId: filters.storeId, keyword: filters.keyword.trim() }
  if (type === 'rent-aging') values.asOf = filters.asOf
  if (['moveout-settlement', 'rent-income', 'other-income'].includes(type)) {
    values.periodFrom = filters.periodFrom
    values.periodTo = filters.periodTo
  }
  if (type === 'rent-income' || type === 'other-income') values.groupBy = filters.groupBy
  if (type === 'other-income') values.feeName = filters.feeName.trim()
  return new URLSearchParams(Object.entries(values).filter(([, value]) => value)).toString()
}
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const moneyFormat = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function display(value: string | number | null, format: string) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value !== 'number') return value
  if (format === 'percent') return `${numberFormat.format(value)}%`
  return (format === 'money' ? moneyFormat : numberFormat).format(value)
}

export function TemplateReportPanel({ type }: { type: TemplateReportKey }) {
  const meta = TEMPLATE_REPORTS[type]
  const [filters, setFilters] = useState(defaults)
  const [applied, setApplied] = useState(defaults)
  const [refresh, setRefresh] = useState(0)
  const [stores, setStores] = useState<{ id: string; name: string }[]>([])
  const [result, setResult] = useState<ReportResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const exportController = useRef<AbortController | null>(null)
  const dated = ['moveout-settlement', 'rent-income', 'other-income'].includes(type)
  const income = type === 'rent-income' || type === 'other-income'
  const query = queryFor(type, applied)
  const dirty = queryFor(type, filters) !== query
  const pageData = paginate(result?.rows ?? [], page, pageSize)

  useEffect(() => {
    const controller = new AbortController()
    apiGet<{ items: { id: string; name: string }[] }>('/api/admin/stores', { signal: controller.signal })
      .then(r => { if (r.ok) setStores(r.data.items ?? []) })
      .catch(() => { /* 报表请求会独立展示网络异常。 */ })
    return () => { controller.abort(); exportController.current?.abort() }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setResult(null)
    apiGet<ReportResult>(`/api/admin/reports/templates/${type}?${query}`, { signal: controller.signal })
      .then(r => {
        if (controller.signal.aborted) return
        if (!r.ok) { setError(r.error); return }
        setResult(r.data)
        setPage(1)
      })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '网络异常，请重试') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [type, query, refresh])

  function update(key: keyof Filters, value: string) { setFilters(current => ({ ...current, [key]: value })); setFormError('') }
  function search() {
    if (dated && (!filters.periodFrom || !filters.periodTo || filters.periodFrom > filters.periodTo)) {
      setFormError('请选择完整的月份范围，起始月不能晚于结束月。'); return
    }
    if (type === 'rent-aging' && !filters.asOf) { setFormError('请选择账龄截止月份。'); return }
    setFormError(''); setApplied({ ...filters }); setRefresh(value => value + 1)
  }
  function reset() {
    const next = defaults()
    setFilters(next); setApplied(next); setFormError(''); setRefresh(value => value + 1)
  }
  async function exportExcel() {
    setExporting(true); setFormError('')
    const controller = new AbortController()
    exportController.current = controller
    try {
      const response = await fetch(`/api/admin/reports/templates/${type}/export?${query}`, {
        headers: { Authorization: `Bearer ${getAdminToken()}` }, signal: controller.signal,
      })
      if (!response.ok) throw new Error('导出失败，请稍后重试。')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${meta.title}_${type === 'rent-aging' ? applied.asOf : dated ? `${applied.periodFrom}_${applied.periodTo}` : new Date().toLocaleDateString('sv-SE')}.xlsx`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      if (!controller.signal.aborted) setFormError(e instanceof Error ? e.message : '导出失败')
    } finally { if (!controller.signal.aborted) setExporting(false) }
  }

  return <div className="a-col a-template-report">
    <form className="a-card a-template-filters" onSubmit={e => { e.preventDefault(); search() }}>
      <div className="a-template-filter-fields">
        <label>门店<select className="a-filter-select" value={filters.storeId} onChange={e => update('storeId', e.target.value)}>
          <option value="">全部门店</option>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select></label>
        {dated ? <fieldset><legend>{type === 'moveout-settlement' ? '退租月份' : '统计期间'}</legend>
          <input aria-label="起始月份" type="month" className="a-filter-input" value={filters.periodFrom} onChange={e => update('periodFrom', e.target.value)} />
          <span className="a-muted">至</span>
          <input aria-label="结束月份" type="month" className="a-filter-input" value={filters.periodTo} onChange={e => update('periodTo', e.target.value)} />
        </fieldset> : null}
        {type === 'rent-aging' ? <label>截止月份<input type="month" className="a-filter-input" value={filters.asOf} onChange={e => update('asOf', e.target.value)} /></label> : null}
        {income ? <label>汇总维度<select className="a-filter-select" value={filters.groupBy} onChange={e => update('groupBy', e.target.value)}>
          <option value="asset">具体资产</option><option value="project">项目</option><option value="district">所属片区</option>
        </select></label> : null}
        {type === 'other-income' ? <label>费项<input className="a-filter-input" placeholder="全部费项" value={filters.feeName} onChange={e => update('feeName', e.target.value)} /></label> : null}
        <label className="a-template-keyword">关键词<input type="search" className="a-filter-input" placeholder={type === 'tenant-register' ? '租户名称、联系电话' : type === 'asset-register' ? '资产名称、单元编号或地址' : '资产、项目、租户或合同'} value={filters.keyword} onChange={e => update('keyword', e.target.value)} /></label>
        <div className="a-template-filter-actions"><button className="a-btn" disabled={loading}>查询</button><button type="button" className="a-btn ghost" onClick={reset} disabled={loading}>重置</button></div>
      </div>
      {formError ? <p className="a-error" role="alert">{formError}</p> : null}
      {dirty ? <p className="a-muted a-template-pending">筛选条件已修改，点击“查询”后更新报表。</p> : null}
    </form>

    <section className="a-card a-template-results" aria-busy={loading}>
      <div className="a-template-result-heading">
        <div><h2>{meta.title}</h2><p className="a-muted">{loading ? '正在查询…' : result ? `共 ${result.rows.length} 条 · ${meta.columns.length} 个字段` : '查询未完成'}{type !== 'tenant-register' ? <span>金额单位：元{income || type === 'asset-register' || type === 'contract-register' || type === 'moveout-settlement' ? '，面积单位：㎡' : ''}</span> : null}</p></div>
        <div className="a-row"><button type="button" className="a-btn ghost" onClick={() => setRefresh(value => value + 1)} disabled={loading}>刷新</button>
          <button type="button" className="a-btn" onClick={exportExcel} disabled={loading || exporting || !result || dirty}>{exporting ? '导出中…' : '导出 Excel'}</button></div>
      </div>
      {error ? <div className="a-template-empty a-error" role="alert">加载失败：{error}<button type="button" className="a-btn ghost" onClick={() => setRefresh(value => value + 1)}>重新加载</button></div> : <>
        {result?.notices.length ? <details className="a-template-notes"><summary>统计口径与数据说明（{result.notices.length}）</summary><ul>{result.notices.map((note, i) => <li key={i}>{note}</li>)}</ul></details> : null}
        <div className="a-template-scroll" tabIndex={0} role="region" aria-label={`${meta.title}明细，可横向滚动`}>
          <table className="a-table a-template-table"><caption className="a-sr-only">{meta.title}，空缺字段以破折号显示，完整说明见统计口径。</caption>
            <thead>{meta.headerRows.map((row, index) => <tr key={index}>{row.map((cell, i) => <th key={i} colSpan={cell.colSpan} rowSpan={cell.rowSpan} scope={cell.colSpan > 1 ? 'colgroup' : 'col'} title={cell.label}>{cell.label}</th>)}</tr>)}</thead>
            <tbody>{pageData.items.map(row => <tr key={row.id}>{meta.columns.map((column, i) => <td key={i} className={typeof row.values[i] === 'number' ? 'is-numeric' : ''} title={display(row.values[i], column.format)}>{display(row.values[i], column.format)}</td>)}</tr>)}</tbody>
          </table>
        </div>
        {loading ? <div className="a-template-empty" role="status">正在加载报表数据…</div> : !result?.rows.length ? <div className="a-template-empty"><strong>暂无符合条件的数据</strong><span>请调整筛选条件后重新查询，也可导出当前报表表头。</span></div> : null}
        <div className="a-template-table-foot"><span className="a-muted">左右滚动查看完整字段 · “—”表示未记录或暂无法计算</span>
          <Pagination total={pageData.total} page={pageData.page} pageSize={pageSize} onChange={next => { setPage(next.page); setPageSize(next.pageSize) }} />
        </div>
      </>}
    </section>
  </div>
}
