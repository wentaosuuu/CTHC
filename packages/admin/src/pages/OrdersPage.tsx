import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost, apiUploadContractAttachment, apiDeleteContractAttachment } from '../api'
import { ContractRemarkEditor } from '../components/ContractRemarkEditor'
import { downloadFileWithAuth, previewFileWithAuth } from '../fileAuth'
import { Pagination, paginate } from '../components/Pagination'

type OrderItem = {
  id: string
  orderNo: string
  status: string
  reviewReason: string | null
  createdAt: string
  leaseMonths: number
  moveInDate: string
  tenantId: string
  tenant: { name: string; phone: string }
  house: { id: string; houseBizId: string; storeName: string; apartmentName: string; houseNo: string; rentMonthly: number; deposit: number }
  contractId: string | null
  contractStatus: string | null
  contractModificationRequestedAt: string | null
  contractModificationRejectedAt: string | null
}

function canShowConfigContractButton(order: OrderItem) {
  if (order.status !== 'APPROVED') return false
  // 兼容演示数据：contractId 可能为空，但只要合同状态已存在，就视为“已生成合同”
  const hasContract = Boolean(order.contractId || order.contractStatus)
  // 未生成合同：允许首次配置
  if (!hasContract) return true
  // 已生成合同：仅当租客发起修改申请（或管理员驳回后待再次修改）时才允许改
  return Boolean(order.contractModificationRequestedAt || order.contractModificationRejectedAt)
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'PENDING_REVIEW':
      return 'a-badge status-pending'
    case 'APPROVED':
      return 'a-badge status-approved'
    case 'REJECTED':
      return 'a-badge status-rejected'
    case 'CANCELLED':
      return 'a-badge status-void'
    default:
      return 'a-badge'
  }
}

function orderStatusZh(status: string) {
  switch (status) {
    case 'PENDING_REVIEW':
      return '待审核'
    case 'APPROVED':
      return '已通过'
    case 'REJECTED':
      return '已拒绝'
    case 'CANCELLED':
      return '已取消'
    default:
      return status
  }
}

function contractStatusZh(status: string | null) {
  if (!status) return '未生成'
  switch (status) {
    case 'WAIT_TENANT_SIGN':
      return '待租客签字'
    case 'WAIT_STAMP':
      return '待盖章'
    case 'PENDING_PAYMENT':
      return '待支付'
    case 'ACTIVE':
      return '已生效'
    case 'VOID':
      return '已作废'
    case 'TERMINATED':
      return '已终止'
    default:
      return status
  }
}

function contractStatusBadgeClass(status: string | null) {
  if (!status) return 'a-badge status-void'
  switch (status) {
    case 'WAIT_TENANT_SIGN':
      return 'a-badge status-pending'
    case 'WAIT_STAMP':
      return 'a-badge status-ordered'
    case 'PENDING_PAYMENT':
      return 'a-badge status-unpaid'
    case 'ACTIVE':
      return 'a-badge status-active'
    case 'VOID':
      return 'a-badge status-void'
    case 'TERMINATED':
      return 'a-badge status-terminated'
    default:
      return 'a-badge'
  }
}

export function OrdersPage() {
  const [items, setItems] = useState<OrderItem[]>([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [contractStatusFilter, setContractStatusFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [apartmentFilter, setApartmentFilter] = useState('')

  function resetOrderFilters() {
    setQ('')
    setStatus('')
    setContractStatusFilter('')
    setStoreFilter('')
    setApartmentFilter('')
    setPage(1)
  }

  async function load() {
    setError('')
    const r = await apiGet<{ items: OrderItem[] }>('/api/admin/orders')
    if (!r.ok) return setError(r.error)
    setItems(r.data.items)
  }

  useEffect(() => {
    load()
  }, [])

  async function cancelOrder(orderId: string) {
    setMsg('')
    if (!confirm('确认取消该订单？房源将解锁为「空置」，其他租客可再次下单。')) return
    const r = await apiPost<{ ok: true }>('/api/admin/orders/' + orderId + '/cancel', {})
    if (!r.ok) return setError(r.error)
    setMsg('已取消订单并解锁房源')
    await load()
  }

  async function review(orderId: string, approved: boolean) {
    setMsg('')
    if (approved) {
      if (!confirm('确认审核通过该订单？')) return
    }
    const reason = approved ? '' : prompt('请输入拒绝原因（必填）') || ''
    if (!approved && !reason.trim()) return
    if (!approved && !confirm('确认拒绝该订单？')) return
    const r = await apiPost<{ ok: true }>('/api/admin/orders/' + orderId + '/review', { approved, reason })
    if (!r.ok) return setError(r.error)
    setMsg('审核已提交')
    await load()
  }

  async function stamp(contractId: string) {
    if (!confirm('确认调用盖章接口？')) return
    setMsg('')
    const r = await apiPost<{ ok: true }>('/api/admin/contracts/' + contractId + '/stamp', {})
    if (!r.ok) return setError(r.error)
    setMsg('已调用盖章接口')
    await load()
  }

  const [configOpen, setConfigOpen] = useState(false)
  const [configOrder, setConfigOrder] = useState<OrderItem | null>(null)
  const [cfgTenantId, setCfgTenantId] = useState('')
  const [cfgLeaseMonths, setCfgLeaseMonths] = useState(12)
  const [cfgMoveInDate, setCfgMoveInDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [cfgRentMonthly, setCfgRentMonthly] = useState(5200)
  const [cfgDepositMultiple, setCfgDepositMultiple] = useState(1)
  const [cfgRentCycle, setCfgRentCycle] = useState<'MONTHLY' | 'QUARTERLY' | 'YEARLY'>('MONTHLY')
  const [cfgPenaltyFormula, setCfgPenaltyFormula] = useState('amount*0.1%*days')
  const [cfgLatestRentGraceDays, setCfgLatestRentGraceDays] = useState('')
  const [cfgRemarkHtml, setCfgRemarkHtml] = useState('')
  type CfgAtt = { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }
  const [cfgAttachments, setCfgAttachments] = useState<CfgAtt[]>([])

  type ContractCfgResp = {
    configRemarkHtml?: string
    attachments?: { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }[]
  }

  function openConfig(o: OrderItem) {
    setConfigOrder(o)
    setCfgTenantId('' as any)
    setCfgLeaseMonths(o.leaseMonths || 12)
    setCfgMoveInDate(o.moveInDate || new Date().toISOString().slice(0, 10))
    setCfgRentMonthly(o.house.rentMonthly || 5200)
    setCfgDepositMultiple(o.house.deposit && o.house.rentMonthly ? o.house.deposit / o.house.rentMonthly : 1)
    setCfgRentCycle('MONTHLY')
    setCfgPenaltyFormula('amount*0.1%*days')
    setCfgLatestRentGraceDays('')
    setCfgRemarkHtml('')
    setCfgAttachments([])
    // 租客来自订单，dropdown 先只有这一个选项（后续可扩展为租客库）
    setCfgTenantId(o.tenantId)
    setConfigOpen(true)
  }

  useEffect(() => {
    if (!configOpen || !configOrder?.contractId) return
    let alive = true
    apiGet<ContractCfgResp & { latestRentGraceDays: number | null }>(
      '/api/admin/contracts/' + configOrder.contractId,
    ).then((r) => {
      if (!alive || !r.ok) return
      setCfgLatestRentGraceDays(
        r.data.latestRentGraceDays != null ? String(r.data.latestRentGraceDays) : '',
      )
      setCfgRemarkHtml(r.data.configRemarkHtml ?? '')
      setCfgAttachments(r.data.attachments ?? [])
    })
    return () => {
      alive = false
    }
  }, [configOpen, configOrder?.contractId, configOrder?.id])

  async function saveConfig(sendToTenant: boolean) {
    if (!configOrder) return
    if (!confirm(sendToTenant ? '确认保存合同并发送给租客？' : '确认保存合同配置？')) return

    setError('')
    setMsg('')
    let latestRentGraceDays: number | null = null
    if (cfgLatestRentGraceDays.trim() !== '') {
      const n = parseInt(cfgLatestRentGraceDays.trim(), 10)
      if (Number.isNaN(n) || n < 0) {
        setError('最晚交租宽限期须为不小于 0 的整数（天）')
        return
      }
      latestRentGraceDays = n
    }

    const r = await apiPost<{ id: string; contractNo: string; tenantPhone: string }>(
      '/api/admin/contracts',
      {
        orderId: configOrder.id,
        tenantId: configOrder.tenantId || cfgTenantId,
        leaseMonths: cfgLeaseMonths,
        moveInDate: cfgMoveInDate,
        rentMonthly: cfgRentMonthly,
        depositMultiple: cfgDepositMultiple,
        rentCycle: cfgRentCycle,
        penaltyFormula: cfgPenaltyFormula,
        latestRentGraceDays,
        configRemarkHtml: cfgRemarkHtml.trim() ? cfgRemarkHtml : undefined,
      },
    )
    if (!r.ok) return setError(r.error)
    setMsg(`合同已配置：${r.data.contractNo}`)
    setConfigOpen(false)
    await load()

    if (sendToTenant) {
      const url = `${window.location.origin.replace('5174', '5173')}/contracts/${r.data.id}?phone=${encodeURIComponent(
        r.data.tenantPhone,
      )}`
      prompt('复制给租客的合同链接（打开 H5 进行确认/签字）', url)
    }
  }

  const filterOptions = useMemo(() => {
    const stores = Array.from(new Set(items.map((o) => o.house.storeName).filter(Boolean))).sort()
    const apartments = Array.from(new Set(items.map((o) => o.house.apartmentName).filter(Boolean))).sort()
    return { stores, apartments }
  }, [items])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return items.filter((o) => {
      if (status && o.status !== status) return false
      if (contractStatusFilter !== '') {
        const want = contractStatusFilter === '__null__' ? null : contractStatusFilter
        if (o.contractStatus !== want) return false
      }
      if (storeFilter && o.house.storeName !== storeFilter) return false
      if (apartmentFilter && o.house.apartmentName !== apartmentFilter) return false
      if (!kw) return true
      const hay = `${o.orderNo} ${o.house.houseBizId} ${o.tenant.name} ${o.tenant.phone} ${o.house.storeName} ${o.house.apartmentName} ${o.house.houseNo}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, status, contractStatusFilter, storeFilter, apartmentFilter])

  const pageData = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize])

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">订单审核</div>
        <div className="a-muted">流程：租客下单 → 店长审核 → 生成合同 → 租客确认+支付。</div>
      </div>

      {error ? <div className="a-card a-error">操作失败：{error}</div> : null}
      {msg ? <div className="a-card a-success">{msg}</div> : null}

      <div className="a-card">
        <div className="a-row" style={{ justifyContent: 'space-between' }}>
          <div className="a-filterbar" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className="a-filter-label">筛选</span>
            <input
              className="a-filter-input"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
              placeholder="搜索：订单号/租客/手机号/门店/房号"
              style={{ minWidth: 160 }}
            />
            <select
              className="a-filter-select"
              value={storeFilter}
              onChange={(e) => { setStoreFilter(e.target.value); setPage(1) }}
              title="所属门店"
            >
              <option value="">全部门店</option>
              {filterOptions.stores.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              className="a-filter-select"
              value={apartmentFilter}
              onChange={(e) => { setApartmentFilter(e.target.value); setPage(1) }}
              title="公寓"
            >
              <option value="">全部公寓</option>
              {filterOptions.apartments.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select
              className="a-filter-select"
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1) }}
              title="订单状态"
            >
              <option value="">全部订单状态</option>
              <option value="PENDING_REVIEW">待审核</option>
              <option value="APPROVED">已通过</option>
              <option value="REJECTED">已拒绝</option>
              <option value="CANCELLED">已取消</option>
            </select>
            <select
              className="a-filter-select"
              value={contractStatusFilter}
              onChange={(e) => { setContractStatusFilter(e.target.value); setPage(1) }}
              title="合同状态"
            >
              <option value="">全部合同状态</option>
              <option value="__null__">未生成合同</option>
              <option value="WAIT_TENANT_SIGN">待租客签字</option>
              <option value="WAIT_STAMP">待盖章</option>
              <option value="PENDING_PAYMENT">待支付</option>
              <option value="ACTIVE">已生效</option>
              <option value="VOID">已作废</option>
              <option value="TERMINATED">已终止</option>
            </select>
            <button className="a-btn ghost" onClick={() => setPage(1)} title="使用当前筛选条件进行查询">
              查询
            </button>
            <button className="a-btn ghost" onClick={resetOrderFilters} title="清空筛选条件">
              重置
            </button>
            <span className="a-muted">共 {filtered.length} 条</span>
          </div>
          <button className="a-btn ghost" onClick={load}>
            刷新
          </button>
        </div>
        <div style={{ height: 10 }} />
        <div className="a-table-wrap">
        <table className="a-table a-table-sticky-op">
          <thead>
            <tr>
              <th>订单号</th>
              <th>房源ID</th>
              <th>所属门店</th>
              <th>公寓</th>
              <th>房号</th>
              <th>租客</th>
              <th>手机号</th>
              <th>状态</th>
              <th>合同状态</th>
              <th>下单时间</th>
              <th className="a-op-col">操作</th>
            </tr>
          </thead>
          <tbody>
            {pageData.items.map((o) => (
              <tr key={o.id}>
                <td>
                  <div style={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{o.orderNo}</div>
                </td>
                <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{o.house.houseBizId}</td>
                <td className="a-muted">{o.house.storeName}</td>
                <td style={{ fontWeight: 800 }}>{o.house.apartmentName}</td>
                <td style={{ fontWeight: 900 }}>{o.house.houseNo}</td>
                <td style={{ fontWeight: 800 }}>{o.tenant.name}</td>
                <td className="a-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{o.tenant.phone}</td>
                <td>
                  <span className={statusBadgeClass(o.status)}>{orderStatusZh(o.status)}</span>
                  {o.reviewReason ? <div className="a-muted">原因：{o.reviewReason}</div> : null}
                </td>
                <td>
                  <span className={contractStatusBadgeClass(o.contractStatus)}>{contractStatusZh(o.contractStatus)}</span>
                </td>
                <td className="a-muted">{new Date(o.createdAt).toLocaleString('zh-CN', { hour12: false })}</td>
                <td className="a-op-cell">
                  <div className="a-op-actions">
                    {o.status === 'PENDING_REVIEW' ? (
                      <>
                        <button className="a-btn" onClick={() => review(o.id, true)}>
                          审核通过
                        </button>
                        <button className="a-btn secondary" onClick={() => review(o.id, false)}>
                          审核拒绝
                        </button>
                        <button className="a-btn ghost" onClick={() => cancelOrder(o.id)}>
                          取消订单并解锁房源
                        </button>
                      </>
                    ) : null}
                    {canShowConfigContractButton(o) ? (
                      <button className="a-btn" onClick={() => openConfig(o)}>
                        配置合同
                      </button>
                    ) : null}
                    {o.contractId && o.contractStatus === 'WAIT_STAMP' ? (
                      <button className="a-btn ghost" onClick={() => stamp(o.contractId!)}>
                        调用盖章接口
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={11} className="a-muted">
                  暂无订单。请先去 H5 下单。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        </div>

        <Pagination
          total={pageData.total}
          page={pageData.page}
          pageSize={pageData.pageSize}
          onChange={(p) => {
            setPage(p.page)
            setPageSize(p.pageSize)
          }}
        />
      </div>

      {configOpen && configOrder ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfigOpen(false)
          }}
        >
          <div className="a-modal">
            <div className="a-modal-header">
              <div className="a-modal-title">配置合同（订单号 {configOrder.orderNo}）</div>
              <button className="a-modal-close" onClick={() => setConfigOpen(false)}>
                关闭
              </button>
            </div>

            <div className="a-modal-body">
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">租客</div>
                  <div className="a-kv-v">
                    <select className="a-filter-select" value={cfgTenantId} onChange={(e) => setCfgTenantId(e.target.value)}>
                      <option value={configOrder.tenantId}>
                        {configOrder.tenant.name}（{configOrder.tenant.phone}）
                      </option>
                    </select>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">租期（月）</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      style={{ minWidth: 160 }}
                      type="number"
                      value={cfgLeaseMonths}
                      onChange={(e) => setCfgLeaseMonths(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">入住日期</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      style={{ minWidth: 160 }}
                      type="date"
                      value={cfgMoveInDate}
                      onChange={(e) => setCfgMoveInDate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">月租（元）</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      style={{ minWidth: 160 }}
                      type="number"
                      value={cfgRentMonthly}
                      onChange={(e) => setCfgRentMonthly(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">押金倍数</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      style={{ minWidth: 160 }}
                      type="number"
                      step="0.5"
                      value={cfgDepositMultiple}
                      onChange={(e) => setCfgDepositMultiple(Number(e.target.value))}
                    />
                    <span className="a-muted">（押金 = 月租 × 倍数）</span>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">交付周期</div>
                  <div className="a-kv-v">
                    <select className="a-filter-select" value={cfgRentCycle} onChange={(e) => setCfgRentCycle(e.target.value as any)}>
                      <option value="MONTHLY">按月</option>
                      <option value="QUARTERLY">按季</option>
                      <option value="YEARLY">按年</option>
                    </select>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">滞纳金公式</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      style={{ minWidth: 220 }}
                      value={cfgPenaltyFormula}
                      onChange={(e) => setCfgPenaltyFormula(e.target.value)}
                      placeholder="例如 amount*0.1%*days"
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">最晚交租宽限期（天）</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      style={{ minWidth: 160 }}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="例如 5"
                      title="相对每期应付日的宽限天数，与按月/按季/按年交付兼容"
                      value={cfgLatestRentGraceDays}
                      onChange={(e) => setCfgLatestRentGraceDays(e.target.value.replace(/\D/g, ''))}
                    />
                    <div className="a-muted" style={{ marginTop: 4, fontSize: 12 }}>
                      可选；留空表示未约定。填写整数天数（如 5 表示应付日后可宽限 5 天）。
                    </div>
                  </div>
                </div>
                <div className="a-kv-row" style={{ alignItems: 'flex-start' }}>
                  <div className="a-kv-k">备注</div>
                  <div className="a-kv-v" style={{ maxWidth: '100%' }}>
                    <ContractRemarkEditor value={cfgRemarkHtml} onChange={setCfgRemarkHtml} />
                  </div>
                </div>
                {configOrder.contractId ? (
                  <div className="a-kv-row" style={{ alignItems: 'flex-start' }}>
                    <div className="a-kv-k">附件</div>
                    <div className="a-kv-v">
                      <input
                        type="file"
                        onChange={async (e) => {
                          const f = e.target.files?.[0]
                          e.target.value = ''
                          if (!f || !configOrder.contractId) return
                          const r = await apiUploadContractAttachment(configOrder.contractId, f)
                          if (!r.ok) return setError(r.error)
                          const cid = configOrder.contractId
                          setCfgAttachments(
                            r.data.attachments.map((a) => ({
                              ...a,
                              previewUrl: `/api/admin/contracts/${cid}/attachment/${encodeURIComponent(a.file)}`,
                              downloadUrl: `/api/admin/contracts/${cid}/attachment/${encodeURIComponent(a.file)}?download=1`,
                            })),
                          )
                        }}
                      />
                      <div className="a-muted" style={{ fontSize: 12, marginTop: 4 }}>
                        需先保存生成合同后再上传；单文件 ≤15MB
                      </div>
                      <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                        {cfgAttachments.map((a) => (
                          <li key={a.id} style={{ marginBottom: 4 }}>
                            {a.name}{' '}
                            <button
                              type="button"
                              className="a-btn ghost"
                              style={{ padding: '2px 8px', fontSize: 12 }}
                              onClick={() =>
                                previewFileWithAuth(a.previewUrl).catch(() => setError('预览失败'))
                              }
                            >
                              预览
                            </button>{' '}
                            <button
                              type="button"
                              className="a-btn ghost"
                              style={{ padding: '2px 8px', fontSize: 12 }}
                              onClick={() =>
                                downloadFileWithAuth(a.downloadUrl, a.name).catch(() =>
                                  setError('下载失败'),
                                )
                              }
                            >
                              下载
                            </button>{' '}
                            <button
                              type="button"
                              className="a-btn ghost"
                              style={{ padding: '2px 8px', fontSize: 12 }}
                              onClick={async () => {
                                if (!configOrder.contractId) return
                                const r = await apiDeleteContractAttachment(configOrder.contractId, a.file)
                                if (!r.ok) return setError(r.error)
                                const cid = configOrder.contractId
                                setCfgAttachments(
                                  r.data.attachments.map((x) => ({
                                    ...x,
                                    previewUrl: `/api/admin/contracts/${cid}/attachment/${encodeURIComponent(x.file)}`,
                                    downloadUrl: `/api/admin/contracts/${cid}/attachment/${encodeURIComponent(x.file)}?download=1`,
                                  })),
                                )
                              }}
                            >
                              删除
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="a-muted" style={{ padding: '8px 0' }}>
                    保存合同后即可上传附件（与合同管理页一致）。
                  </div>
                )}
              </div>

              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">合同预览</div>
                  <div className="a-kv-v">
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>租赁合同（预览）</div>
                    <div className="a-muted" style={{ lineHeight: 1.8 }}>
                      租客：{configOrder.tenant.name}（{configOrder.tenant.phone}）<br />
                      房源：{configOrder.house.apartmentName} {configOrder.house.houseNo}（{configOrder.house.storeName}）<br />
                      租期：{cfgLeaseMonths} 个月，入住：{cfgMoveInDate}
                      <br />
                      月租：¥{cfgRentMonthly}，押金：¥{Math.round(cfgRentMonthly * cfgDepositMultiple)}
                      <br />
                      租金交付：{cfgRentCycle === 'MONTHLY' ? '按月' : cfgRentCycle === 'QUARTERLY' ? '按季' : '按年'}
                      <br />
                      滞纳金：{cfgPenaltyFormula}
                      <br />
                      最晚交租宽限期：
                      {cfgLatestRentGraceDays.trim() ? `${cfgLatestRentGraceDays.trim()} 天` : '未约定'}
                      <br />
                      <br />
                      流程提示：保存后 → 发送给租客确认签字 → 签字后才可“调用盖章接口” → 租客支付（24 小时内）→ 合同生效；超时未付自动作废并释放房源。
                    </div>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">操作</div>
                  <div className="a-kv-v">
                    <div className="a-row">
                      <button className="a-btn ghost" onClick={() => saveConfig(false)}>
                        保存
                      </button>
                      <button className="a-btn" onClick={() => saveConfig(true)}>
                        保存并发送给租客
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

