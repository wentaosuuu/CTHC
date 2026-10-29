import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '../api'
import { Pagination, paginate } from '../components/Pagination'
import {
  WORKBENCH_CATEGORIES, WORKBENCH_SOURCES, deriveWorkbenchRows, parseWorkbenchItems,
  sortWorkbenchRows, workbenchWaitingLabel,
  type WorkbenchCategoryId, type WorkbenchRecord, type WorkbenchSourceId,
} from '../workbenchData'

type SourceState = {
  status: 'loading' | 'ready' | 'error'
  items: WorkbenchRecord[]
  error: string
}
type SourcesState = Record<WorkbenchSourceId, SourceState>

function initialSources(): SourcesState {
  const initial = (): SourceState => ({ status: 'loading', items: [], error: '' })
  return { orders: initial(), contracts: initial(), refunds: initial(), sublets: initial(), transactions: initial(), overdue: initial() }
}

export function WorkbenchPage() {
  const [sources, setSources] = useState<SourcesState>(initialSources)
  const [selected, setSelected] = useState<WorkbenchCategoryId>('orders')
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10 })
  const [refresh, setRefresh] = useState(0)
  const [snapshotAt, setSnapshotAt] = useState(Date.now)
  const pendingRequests = useRef<Partial<Record<WorkbenchSourceId, AbortController>>>({})

  useEffect(() => {
    let active = true
    const requests = pendingRequests.current
    const controllers = WORKBENCH_SOURCES.map(source => {
      const controller = new AbortController()
      pendingRequests.current[source.id]?.abort()
      pendingRequests.current[source.id] = controller
      return { source, controller }
    })
    // 各来源独立完成；一处失败不遮住其它已成功读取的业务记录。
    for (const { source, controller } of controllers) {
      void apiGet<unknown>(source.path, { signal: controller.signal }).then(result => {
        if (!active || controller.signal.aborted) return
        if (!result.ok) throw new Error(result.error)
        const items = parseWorkbenchItems(result.data)
        setSources(previous => ({ ...previous, [source.id]: { status: 'ready', items, error: '' } }))
      }).catch(error => {
        if (!active || controller.signal.aborted) return
        setSources(previous => ({ ...previous, [source.id]: {
          status: 'error', items: [], error: error instanceof Error ? error.message : '加载失败，请重试。',
        } }))
      })
    }
    return () => {
      active = false
      controllers.forEach(({ controller }) => controller.abort())
      Object.values(requests).forEach(controller => controller?.abort())
    }
  }, [refresh])

  async function retrySource(id: WorkbenchSourceId) {
    const source = WORKBENCH_SOURCES.find(item => item.id === id)
    if (!source) return
    const controller = new AbortController()
    pendingRequests.current[id]?.abort()
    pendingRequests.current[id] = controller
    setSources(previous => ({ ...previous, [id]: { status: 'loading', items: [], error: '' } }))
    try {
      const result = await apiGet<unknown>(source.path, { signal: controller.signal })
      if (controller.signal.aborted) return
      if (!result.ok) throw new Error(result.error)
      const items = parseWorkbenchItems(result.data)
      setSnapshotAt(Date.now())
      setSources(previous => ({ ...previous, [id]: { status: 'ready', items, error: '' } }))
    } catch (error) {
      if (controller.signal.aborted) return
      setSources(previous => ({ ...previous, [id]: {
        status: 'error', items: [], error: error instanceof Error ? error.message : '加载失败，请重试。',
      } }))
    }
  }

  const rows = useMemo(() => WORKBENCH_SOURCES.flatMap(source => sources[source.id].status === 'ready'
    ? deriveWorkbenchRows(source.id, sources[source.id].items, snapshotAt) : []), [sources, snapshotAt])
  const category = WORKBENCH_CATEGORIES.find(item => item.id === selected) ?? WORKBENCH_CATEGORIES[0]
  const categoryState = sources[category.source]
  const selectedRows = useMemo(() => sortWorkbenchRows(rows.filter(row => row.category === selected)), [rows, selected])
  const paged = paginate(selectedRows, pagination.page, pagination.pageSize)
  const involved = new Set(rows.map(row => row.category)).size
  const loading = WORKBENCH_SOURCES.some(source => sources[source.id].status === 'loading')
  const failures = WORKBENCH_SOURCES.filter(source => sources[source.id].status === 'error')
  const readyCount = WORKBENCH_SOURCES.filter(source => sources[source.id].status === 'ready').length

  function countLabel(id: WorkbenchCategoryId, source: WorkbenchSourceId, available: boolean) {
    if (sources[source].status === 'loading') return '…'
    if (sources[source].status === 'error' || !available) return '—'
    return rows.filter(row => row.category === id).length
  }

  let emptyLabel = '暂无待办'
  if (categoryState.status === 'loading') emptyLabel = '加载中…'
  else if (categoryState.status === 'error') emptyLabel = '待办数据加载失败，请重试'
  else if (!category.available) emptyLabel = '暂无待办数据'

  return <div>
    <div className="a-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <div><div className="a-muted" style={{ marginBottom: 4 }}>工作台</div><h1 className="a-h1" style={{ margin: 0 }}>待办中心</h1></div>
      <button type="button" className="a-btn ghost" disabled={loading} onClick={() => {
        setSources(initialSources()); setSnapshotAt(Date.now()); setRefresh(previous => previous + 1)
      }}>{loading ? '刷新中…' : '刷新'}</button>
    </div>
    <p className="a-muted" role="status">
      {readyCount > 0 ? <>当前可识别 <strong style={{ color: '#1d4ed8' }}>{rows.length}</strong> 项待处理事项，涉及 {involved} 个分类</>
        : loading ? '正在读取待办数据…' : '待办数据暂未加载成功'}
      {loading && readyCount > 0 ? '，其余数据加载中…' : ''}
    </p>
    {failures.length > 0 ? <div className="a-card" role="alert" style={{ marginBottom: 16, borderColor: '#fecaca', padding: 14 }}>
      {failures.map(source => <div className="a-row" key={source.id} style={{ justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
        <span style={{ color: '#b91c1c' }}>{source.label}待办加载失败：{sources[source.id].error}</span>
        <button type="button" className="a-btn ghost" onClick={() => void retrySource(source.id)}>重试</button>
      </div>)}
    </div> : null}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 12, margin: '20px 0' }} aria-label="待办分类">
      {WORKBENCH_CATEGORIES.map(item => <button type="button" key={item.id} className="a-card"
        aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setPagination(previous => ({ ...previous, page: 1 })) }}
        style={{ cursor: 'pointer', textAlign: 'left', padding: '16px 18px', minHeight: 96, font: 'inherit',
          borderColor: selected === item.id ? '#2563eb' : undefined, background: selected === item.id ? '#eff6ff' : undefined }}>
        <span style={{ display: 'block', fontSize: 14, color: selected === item.id ? '#1d4ed8' : '#475569' }}>{item.label}</span>
        <strong style={{ display: 'block', marginTop: 8, fontSize: 28, color: '#1e3a8a' }}>{countLabel(item.id, item.source, item.available)}</strong>
      </button>)}
    </div>
    <div className="a-card" style={{ padding: 0 }}>
      <div className="a-row" style={{ justifyContent: 'space-between', padding: '18px 20px', gap: 12, flexWrap: 'wrap' }}>
        <strong>{category.label} {category.available && categoryState.status === 'ready' ? `${selectedRows.length} 项` : ''}</strong>
        <span className="a-muted">按等待天数倒序，最久未处理的排最前</span>
      </div>
      <div className="a-table-wrap"><table className="a-table" style={{ minWidth: 1050 }}>
        <thead><tr>{['业务编号', '租客', '门店', '项目/房号', '金额', '等待时长', '状态', '操作'].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{paged.items.map(row => <tr key={row.id}>
          <td style={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere', maxWidth: 220 }}>{row.businessNo}</td>
          <td>{row.tenant}</td><td>{row.store}</td><td style={{ minWidth: 180 }}>{row.projectHouse}</td>
          <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{row.amount === null ? '—' : `¥${row.amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`}</td>
          <td style={{ whiteSpace: 'nowrap' }}>{workbenchWaitingLabel(row.waitingDays)}</td><td style={{ whiteSpace: 'nowrap' }}>{row.status}</td>
          <td>{row.href ? <Link className="a-btn ghost" to={row.href}>{row.action}</Link> : <span className="a-muted">—</span>}</td>
        </tr>)}{paged.items.length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: '56px 20px', color: '#64748b' }}>{emptyLabel}</td></tr> : null}</tbody>
      </table></div>
      {category.available && categoryState.status === 'ready' ? <Pagination total={paged.total} page={paged.page} pageSize={paged.pageSize} onChange={setPagination} /> : null}
    </div>
    <p className="a-muted" style={{ fontSize: 12, marginTop: 12 }}>统计基于当前可读取的业务记录；点击操作后，在对应业务页面查看和办理。</p>
  </div>
}
