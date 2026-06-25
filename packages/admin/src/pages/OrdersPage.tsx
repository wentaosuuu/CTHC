import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPatch, apiPost, apiUploadContractAttachment, apiDeleteContractAttachment } from '../api'
import { ContractRemarkEditor } from '../components/ContractRemarkEditor'
import { contractAttachmentsLockedUntilPaid } from '../contractAttachmentPolicy'
import { downloadFileWithAuth, previewFileWithAuth } from '../fileAuth'
import { Pagination, paginate } from '../components/Pagination'
import { rentCycleLabel, normalizeRentCycle, type RentCycle } from '../rentCycle'
import { parseRentDueDayInput, rentCycleDueDayHint, rentDueDayFromYmd } from '../rentDueDay'

type OrderBundleLine = {
  houseId: string
  houseBizId: string
  apartmentName: string
  houseNo: string
  rentMonthlySnapshot: number
  depositSnapshot: number
  releasedAt: string | null
}

type OrderItem = {
  id: string
  orderNo: string
  status: string
  reviewReason: string | null
  createdAt: string
  leaseMonths: number
  moveInDate: string
  isMergedBundle?: boolean
  bundleLineCount?: number
  bundleRentMonthlySum?: number
  bundleLines?: OrderBundleLine[] | null
  tenantId: string
  tenant: {
    name: string
    phone: string
    wechat: string | null
    idDocType: string
    idNumber: string
    idCardLongTerm: boolean
    idCardValidUntil: string | null
  }
  house: {
    id: string
    houseBizId: string
    storeName: string
    apartmentName: string
    houseNo: string
    rentMonthly: number
    deposit: number
    assetType: string
  }
  contractId: string | null
  contractStatus: string | null
  contractModificationRequestedAt: string | null
  contractModificationRejectedAt: string | null
  /** 租客在 H5 确认合同后非空，此时禁止改订单 */
  contractConfirmedAt: string | null
}

type ContractTemplateKind = 'TRIPARTITE' | 'APARTMENT'

function normalizeContractTemplate(v: string | undefined | null): ContractTemplateKind {
  return v === 'TRIPARTITE' ? 'TRIPARTITE' : 'APARTMENT'
}

function contractTemplateZh(t: ContractTemplateKind) {
  return t === 'TRIPARTITE' ? '三方合同' : '公寓合同'
}

/** 合同已进入履行或结束态、或租客已确认合同时，不允许再改订单 */
const CONTRACT_LOCK_ORDER_EDIT: string[] = ['ACTIVE', 'TERMINATED', 'VOID']

/** 待审核 / 已通过，且合同未锁定、租客未确认时，可改租期、入住日 */
function canModifyOrder(order: OrderItem) {
  if (order.status !== 'PENDING_REVIEW' && order.status !== 'APPROVED') return false
  if (order.contractConfirmedAt) return false
  if (order.contractStatus && CONTRACT_LOCK_ORDER_EDIT.includes(order.contractStatus)) return false
  return true
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

function idDocTypeZh(t: string) {
  switch (t) {
    case 'IDCARD':
      return '身份证'
    case 'PASSPORT':
      return '护照'
    case 'HKM_TW_PERMIT':
      return '港澳台通行证'
    case 'USCC':
      return '统一社会信用代码'
    default:
      return t || '—'
  }
}

function formatYuan(n: number) {
  if (!Number.isFinite(n)) return '—'
  return `¥${n.toLocaleString('zh-CN')}`
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

  async function openOrderDetail(orderId: string) {
    setError('')
    setOrderDetailLoading(true)
    setOrderDetailOpen(true)
    setOrderDetail(null)
    const r = await apiGet<OrderItem>('/api/admin/orders/' + orderId)
    setOrderDetailLoading(false)
    if (!r.ok) {
      setOrderDetailOpen(false)
      return setError(r.error)
    }
    setOrderDetail(r.data)
  }

  function openEditOrder(o: OrderItem) {
    setEditOrder(o)
    setEditLeaseMonths(o.leaseMonths || 12)
    const d = o.moveInDate
    setEditMoveInDate(d && d.length >= 10 ? d.slice(0, 10) : new Date().toISOString().slice(0, 10))
    setEditTenantName(o.tenant.name || '')
    setEditTenantPhone(o.tenant.phone || '')
    setEditTenantWechat(o.tenant.wechat ?? '')
    setEditOpen(true)
  }

  async function saveEditOrder() {
    if (!editOrder) return
    if (!Number.isFinite(editLeaseMonths) || editLeaseMonths < 1 || editLeaseMonths > 36) {
      setError('租期须为 1～36 个月的整数')
      return
    }
    if (!editMoveInDate || editMoveInDate.length < 8) {
      setError('请选择入住日期')
      return
    }
    const name = editTenantName.trim()
    const phone = editTenantPhone.trim()
    const wechat = editTenantWechat.trim()
    if (!name) {
      setError('请填写租客姓名')
      return
    }
    if (phone.length < 6 || phone.length > 20) {
      setError('手机号长度须为 6～20 位')
      return
    }
    if (wechat.length > 80) {
      setError('微信号过长（最多 80 字）')
      return
    }
    setError('')
    setMsg('')
    const r = await apiPatch<{ ok: true }>(`/api/admin/orders/${editOrder.id}`, {
      leaseMonths: editLeaseMonths,
      moveInDate: editMoveInDate,
      tenantName: name,
      tenantPhone: phone,
      tenantWechat: wechat,
    })
    if (!r.ok) return setError(r.error)
    setMsg('订单已更新')
    setEditOpen(false)
    setEditOrder(null)
    await load()
  }

  async function review(orderId: string, approved: boolean) {
    setMsg('')
    if (approved) {
      if (!confirm('确认审核通过该订单？')) return
    }
    const reason = approved ? '' : prompt('请输入拒绝原因（必填）') || ''
    if (!approved && !reason.trim()) return
    if (!approved && !confirm('确认拒绝该订单？房源将解锁为「空置」，其他租客可再次下单。')) return
    const r = await apiPost<{ ok: true }>('/api/admin/orders/' + orderId + '/review', { approved, reason })
    if (!r.ok) return setError(r.error)
    setMsg(approved ? '审核已通过' : '已拒绝订单，房源已解锁')
    await load()
  }

  async function stamp(contractId: string) {
    if (!confirm('确认调用盖章接口？')) return
    setMsg('')
    const r = await apiPost<{ ok: true }>('/api/admin/contracts/' + contractId + '/stamp', {})
    if (!r.ok) return setError(r.error)
    setMsg('已调用盖章接口')
    if (configOpen && configOrder?.contractId === contractId) {
      setCfgContractStatus('PENDING_PAYMENT')
    }
    await load()
  }

  const [editOpen, setEditOpen] = useState(false)
  const [editOrder, setEditOrder] = useState<OrderItem | null>(null)
  const [editLeaseMonths, setEditLeaseMonths] = useState(12)
  const [editMoveInDate, setEditMoveInDate] = useState('')
  const [editTenantName, setEditTenantName] = useState('')
  const [editTenantPhone, setEditTenantPhone] = useState('')
  const [editTenantWechat, setEditTenantWechat] = useState('')

  const [orderDetailOpen, setOrderDetailOpen] = useState(false)
  const [orderDetail, setOrderDetail] = useState<OrderItem | null>(null)
  const [orderDetailLoading, setOrderDetailLoading] = useState(false)

  const [configOpen, setConfigOpen] = useState(false)
  const [configOrder, setConfigOrder] = useState<OrderItem | null>(null)
  const [cfgTenantId, setCfgTenantId] = useState('')
  const [cfgLeaseMonths, setCfgLeaseMonths] = useState(12)
  const [cfgMoveInDate, setCfgMoveInDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [cfgRentMonthly, setCfgRentMonthly] = useState(5200)
  const [cfgDepositMultiple, setCfgDepositMultiple] = useState(1)
  const [cfgRentCycle, setCfgRentCycle] = useState<RentCycle>('MONTHLY')
  const [cfgPenaltyFormula, setCfgPenaltyFormula] = useState('amount*0.1%*days')
  const [cfgRentDueDay, setCfgRentDueDay] = useState('1')
  const [cfgLatestRentGraceDays, setCfgLatestRentGraceDays] = useState('')
  const [cfgRemarkHtml, setCfgRemarkHtml] = useState('')
  const [cfgAgreementSignDate, setCfgAgreementSignDate] = useState('')
  type CfgAtt = { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }
  const [cfgAttachments, setCfgAttachments] = useState<CfgAtt[]>([])
  /** 与列表同步；打开弹窗后由合同详情接口刷新 */
  const [cfgContractStatus, setCfgContractStatus] = useState<string | null>(null)
  const [cfgContractTemplate, setCfgContractTemplate] = useState<ContractTemplateKind>('APARTMENT')
  const [cfgTerminationRentMulti, setCfgTerminationRentMulti] = useState('2')
  const [cfgTerminationDaysPastDue, setCfgTerminationDaysPastDue] = useState('7')

  type ContractCfgResp = {
    status?: string
    rentCycle?: string
    rentDueDay?: number | null
    contractTemplate?: string
    terminationRentMultiple?: number | null
    terminationDaysPastDue?: number | null
    configRemarkHtml?: string
    agreementSignDate?: string | null
    attachments?: { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }[]
  }

  function openConfig(o: OrderItem) {
    setConfigOrder(o)
    setCfgTenantId('' as any)
    setCfgLeaseMonths(o.leaseMonths || 12)
    setCfgMoveInDate(o.moveInDate || new Date().toISOString().slice(0, 10))
    setCfgRentMonthly(o.bundleRentMonthlySum ?? o.house.rentMonthly)
    setCfgDepositMultiple(o.house.deposit && o.house.rentMonthly ? o.house.deposit / o.house.rentMonthly : 1)
    setCfgRentCycle('MONTHLY')
    setCfgPenaltyFormula('amount*0.1%*days')
    setCfgRentDueDay(String(rentDueDayFromYmd(o.moveInDate || new Date().toISOString().slice(0, 10))))
    setCfgLatestRentGraceDays('')
    setCfgRemarkHtml('')
    setCfgAgreementSignDate('')
    setCfgAttachments([])
    setCfgContractStatus(o.contractStatus)
    setCfgContractTemplate('APARTMENT')
    setCfgTerminationRentMulti('2')
    setCfgTerminationDaysPastDue('7')
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
      if (r.data.status) setCfgContractStatus(r.data.status)
      setCfgRentCycle(normalizeRentCycle(r.data.rentCycle))
      setCfgRentDueDay(
        r.data.rentDueDay != null ? String(r.data.rentDueDay) : String(rentDueDayFromYmd(cfgMoveInDate)),
      )
      setCfgContractTemplate(normalizeContractTemplate(r.data.contractTemplate))
      setCfgTerminationRentMulti(
        r.data.terminationRentMultiple != null && !Number.isNaN(r.data.terminationRentMultiple)
          ? String(r.data.terminationRentMultiple)
          : '2',
      )
      setCfgTerminationDaysPastDue(
        r.data.terminationDaysPastDue != null ? String(r.data.terminationDaysPastDue) : '7',
      )
      setCfgLatestRentGraceDays(
        r.data.latestRentGraceDays != null ? String(r.data.latestRentGraceDays) : '',
      )
      setCfgRemarkHtml(r.data.configRemarkHtml ?? '')
      setCfgAgreementSignDate(r.data.agreementSignDate ?? '')
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
    const rentDueParsed = parseRentDueDayInput(cfgRentDueDay)
    if (!rentDueParsed.ok) return setError(rentDueParsed.message)

    let latestRentGraceDays: number | null = null
    if (cfgLatestRentGraceDays.trim() !== '') {
      const n = parseInt(cfgLatestRentGraceDays.trim(), 10)
      if (Number.isNaN(n) || n < 0) {
        setError('最晚交租宽限期须为不小于 0 的整数（天）')
        return
      }
      latestRentGraceDays = n
    }

    let terminationRentMultiple: number | null = null
    let terminationDaysPastDue: number | null = null
    if (cfgContractTemplate === 'TRIPARTITE') {
      const x = parseFloat(cfgTerminationRentMulti.trim())
      if (Number.isNaN(x) || x <= 0) {
        setError('三方合同：请填写大于 0 的月租倍数')
        return
      }
      terminationRentMultiple = x
    } else {
      const d = parseInt(cfgTerminationDaysPastDue.trim(), 10)
      if (Number.isNaN(d) || d < 0) {
        setError('公寓合同：请填写不小于 0 的逾期天数（整数）')
        return
      }
      terminationDaysPastDue = d
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
        rentDueDay: rentDueParsed.value,
        latestRentGraceDays,
        configRemarkHtml: cfgRemarkHtml.trim() ? cfgRemarkHtml : undefined,
        agreementSignDate: cfgAgreementSignDate.trim() === '' ? null : cfgAgreementSignDate,
        contractTemplate: cfgContractTemplate,
        terminationRentMultiple,
        terminationDaysPastDue,
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
      const hay = `${o.orderNo} ${o.house.houseBizId} ${o.tenant.name} ${o.tenant.phone} ${o.tenant.wechat ?? ''} ${o.house.storeName} ${o.house.apartmentName} ${o.house.houseNo}`.toLowerCase()
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
                  {o.isMergedBundle ? (
                    <div className="a-muted" style={{ fontSize: 12, marginTop: 4 }}>
                      合并单 · {o.bundleLineCount ?? 0} 个资产 · 月租合计 ¥{o.bundleRentMonthlySum ?? '—'}
                    </div>
                  ) : null}
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
                    <button type="button" className="a-btn ghost" onClick={() => openOrderDetail(o.id)}>
                      查看详情
                    </button>
                    {o.status === 'PENDING_REVIEW' ? (
                      <>
                        <button className="a-btn" onClick={() => review(o.id, true)}>
                          审核通过
                        </button>
                        <button className="a-btn secondary" onClick={() => review(o.id, false)}>
                          审核拒绝
                        </button>
                      </>
                    ) : null}
                    {canModifyOrder(o) ? (
                      <button
                        type="button"
                        className="a-btn ghost"
                        title="修改租期（月）与入住日期；若已生成合同且租客未确认，将同步合同起止日"
                        onClick={() => openEditOrder(o)}
                      >
                        修改订单
                      </button>
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

      {orderDetailOpen ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setOrderDetailOpen(false)
              setOrderDetail(null)
            }
          }}
        >
          <div className="a-modal a-modal--narrow" onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">
                订单详情
                {orderDetail ? ` · ${orderDetail.orderNo}` : ''}
              </div>
              <button
                type="button"
                className="a-modal-close"
                onClick={() => {
                  setOrderDetailOpen(false)
                  setOrderDetail(null)
                }}
              >
                关闭
              </button>
            </div>
            <div className="a-modal-body a-house-config-body">
              {orderDetailLoading ? (
                <div className="a-muted">加载中…</div>
              ) : orderDetail ? (
                <>
                  <div className="a-house-config-kv">
                    <div className="a-kv">
                      <div className="a-kv-row">
                        <div className="a-kv-k">订单状态</div>
                        <div className="a-kv-v">
                          <span className={statusBadgeClass(orderDetail.status)}>{orderStatusZh(orderDetail.status)}</span>
                        </div>
                      </div>
                      <div className="a-kv-row">
                        <div className="a-kv-k">合同状态</div>
                        <div className="a-kv-v">
                          <span className={contractStatusBadgeClass(orderDetail.contractStatus)}>
                            {contractStatusZh(orderDetail.contractStatus)}
                          </span>
                        </div>
                      </div>
                      <div className="a-kv-row">
                        <div className="a-kv-k">租期（月）</div>
                        <div className="a-kv-v">{orderDetail.leaseMonths}</div>
                      </div>
                      <div className="a-kv-row">
                        <div className="a-kv-k">入住日</div>
                        <div className="a-kv-v">{orderDetail.moveInDate}</div>
                      </div>
                      <div className="a-kv-row">
                        <div className="a-kv-k">下单时间</div>
                        <div className="a-kv-v">
                          {new Date(orderDetail.createdAt).toLocaleString('zh-CN', { hour12: false })}
                        </div>
                      </div>
                      <div className="a-kv-row">
                        <div className="a-kv-k">主房源</div>
                        <div className="a-kv-v">
                          {orderDetail.house.apartmentName} · {orderDetail.house.houseNo}（{orderDetail.house.storeName}）
                          <div className="a-muted" style={{ fontSize: 12, marginTop: 4 }}>
                            房源ID {orderDetail.house.houseBizId} · 月租 ¥{orderDetail.house.rentMonthly} · 押金 ¥
                            {orderDetail.house.deposit}
                          </div>
                        </div>
                      </div>
                      {orderDetail.isMergedBundle && orderDetail.bundleLines && orderDetail.bundleLines.length > 0 ? (
                        <div className="a-kv-row" style={{ alignItems: 'flex-start' }}>
                          <div className="a-kv-k">合并资产</div>
                          <div className="a-kv-v" style={{ width: '100%' }}>
                            <table className="a-table" style={{ fontSize: 13, width: '100%' }}>
                              <thead>
                                <tr>
                                  <th>房源ID</th>
                                  <th>公寓 · 房号</th>
                                  <th style={{ textAlign: 'right' }}>月租快照</th>
                                  <th>状态</th>
                                </tr>
                              </thead>
                              <tbody>
                                {orderDetail.bundleLines.map((ln) => (
                                  <tr key={ln.houseId}>
                                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{ln.houseBizId}</td>
                                    <td>
                                      {ln.apartmentName} · {ln.houseNo}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>¥{ln.rentMonthlySnapshot}</td>
                                    <td className="a-muted" style={{ fontSize: 12 }}>
                                      {ln.releasedAt ? '已迁出' : '在租'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
                      <div className="a-kv-row">
                        <div className="a-kv-k">租客</div>
                        <div className="a-kv-v">
                          {orderDetail.tenant.name} · {orderDetail.tenant.phone}
                          <div className="a-muted" style={{ fontSize: 12, marginTop: 4 }}>
                            {idDocTypeZh(orderDetail.tenant.idDocType)} {orderDetail.tenant.idNumber}
                            {orderDetail.tenant.wechat ? ` · 微信 ${orderDetail.tenant.wechat}` : ''}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="a-muted">暂无数据</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {editOpen && editOrder ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditOpen(false)
          }}
        >
          <div className="a-modal a-modal--narrow">
            <div className="a-modal-header">
              <div className="a-modal-title">修改订单（订单号 {editOrder.orderNo}）</div>
              <button
                type="button"
                className="a-modal-close"
                onClick={() => {
                  setEditOpen(false)
                  setEditOrder(null)
                }}
              >
                关闭
              </button>
            </div>
            <div className="a-modal-body a-house-config-body">
              <div className="a-house-config-kv">
                <div className="a-muted" style={{ marginBottom: 4 }}>
                  以下为租客在 H5 提交的信息。租客确认合同后不可修改订单；若已生成合同且仍为「待租客签字」，保存租期/入住日时会同步合同起止日并重新计算签字截止时间。
                </div>

                <div style={{ fontWeight: 900, fontSize: 13, margin: '14px 0 8px' }}>房源（下单时）</div>
                <div className="a-kv">
                  <div className="a-kv-row">
                    <div className="a-kv-k">所属门店</div>
                    <div className="a-kv-v">{editOrder.house.storeName || '—'}</div>
                  </div>
                  <div className="a-kv-row">
                    <div className="a-kv-k">公寓</div>
                    <div className="a-kv-v">{editOrder.house.apartmentName || '—'}</div>
                  </div>
                  <div className="a-kv-row">
                    <div className="a-kv-k">房号</div>
                    <div className="a-kv-v">{editOrder.house.houseNo || '—'}</div>
                  </div>
                  <div className="a-kv-row">
                    <div className="a-kv-k">房源业务 ID</div>
                    <div className="a-kv-v" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {editOrder.house.houseBizId}
                    </div>
                  </div>
                  <div className="a-kv-row">
                    <div className="a-kv-k">资产类型</div>
                    <div className="a-kv-v">{editOrder.house.assetType || '—'}</div>
                  </div>
                  <div className="a-kv-row">
                    <div className="a-kv-k">月租</div>
                    <div className="a-kv-v">{formatYuan(editOrder.house.rentMonthly)}</div>
                  </div>
                  <div className="a-kv-row">
                    <div className="a-kv-k">押金</div>
                    <div className="a-kv-v">{formatYuan(editOrder.house.deposit)}</div>
                  </div>
                </div>

                <div style={{ fontWeight: 900, fontSize: 13, margin: '14px 0 8px', paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
                  租客与证件（可改姓名 / 手机 / 微信）
                </div>
                <div className="a-kv">
                  <div className="a-kv-row">
                    <div className="a-kv-k">姓名</div>
                    <div className="a-kv-v">
                      <input
                        className="a-filter-input"
                        style={{ width: '100%', maxWidth: 320 }}
                        value={editTenantName}
                        onChange={(e) => setEditTenantName(e.target.value)}
                        maxLength={80}
                      />
                    </div>
                  </div>
                  <div className="a-kv-row">
                    <div className="a-kv-k">手机号</div>
                    <div className="a-kv-v">
                      <input
                        className="a-filter-input"
                        style={{ width: '100%', maxWidth: 320 }}
                        value={editTenantPhone}
                        onChange={(e) => setEditTenantPhone(e.target.value)}
                        maxLength={20}
                      />
                    </div>
                  </div>
                  <div className="a-kv-row">
                    <div className="a-kv-k">微信号</div>
                    <div className="a-kv-v">
                      <input
                        className="a-filter-input"
                        style={{ width: '100%', maxWidth: 320 }}
                        value={editTenantWechat}
                        onChange={(e) => setEditTenantWechat(e.target.value)}
                        maxLength={80}
                        placeholder="选填"
                      />
                    </div>
                  </div>
                  <div className="a-kv-row">
                    <div className="a-kv-k">证件类型</div>
                    <div className="a-kv-v">{idDocTypeZh(editOrder.tenant.idDocType)}</div>
                  </div>
                  <div className="a-kv-row">
                    <div className="a-kv-k">证件号码</div>
                    <div className="a-kv-v">{editOrder.tenant.idNumber || '—'}</div>
                  </div>
                  <div className="a-kv-row">
                    <div className="a-kv-k">证件有效期</div>
                    <div className="a-kv-v">
                      {editOrder.tenant.idDocType === 'IDCARD'
                        ? editOrder.tenant.idCardLongTerm
                          ? '长期有效'
                          : editOrder.tenant.idCardValidUntil
                            ? `至 ${editOrder.tenant.idCardValidUntil}`
                            : '—'
                        : editOrder.tenant.idCardValidUntil
                          ? `至 ${editOrder.tenant.idCardValidUntil}`
                          : '—'}
                    </div>
                  </div>
                </div>

                <div style={{ fontWeight: 900, fontSize: 13, margin: '14px 0 8px', paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
                  租约意向（可修改）
                </div>
                <div className="a-kv">
                  <div className="a-kv-row">
                    <div className="a-kv-k">租期（月）</div>
                    <div className="a-kv-v">
                      <input
                        className="a-filter-input"
                        type="number"
                        min={1}
                        max={36}
                        value={editLeaseMonths}
                        onChange={(e) => setEditLeaseMonths(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className="a-kv-row">
                    <div className="a-kv-k">入住日期</div>
                    <div className="a-kv-v">
                      <input
                        className="a-filter-input"
                        type="date"
                        value={editMoveInDate}
                        onChange={(e) => setEditMoveInDate(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="a-row" style={{ marginTop: 16, gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="a-btn ghost"
                    onClick={() => {
                      setEditOpen(false)
                      setEditOrder(null)
                    }}
                  >
                    取消
                  </button>
                  <button type="button" className="a-btn" onClick={() => void saveEditOrder()}>
                    保存
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {configOpen && configOrder ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfigOpen(false)
          }}
        >
          <div className="a-modal a-modal--change-log">
            <div className="a-modal-header">
              <div className="a-modal-title">配置合同（订单号 {configOrder.orderNo}）</div>
              <button className="a-modal-close" onClick={() => setConfigOpen(false)}>
                关闭
              </button>
            </div>

            <div className="a-modal-body">
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">合同模板</div>
                  <div className="a-kv-v">
                    <select
                      className="a-filter-select"
                      value={cfgContractTemplate}
                      onChange={(e) => setCfgContractTemplate(e.target.value as ContractTemplateKind)}
                    >
                      <option value="TRIPARTITE">三方合同</option>
                      <option value="APARTMENT">公寓合同</option>
                    </select>
                  </div>
                </div>
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
                  <div className="a-kv-k">签订日期</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      style={{ minWidth: 160 }}
                      type="date"
                      value={cfgAgreementSignDate}
                      onChange={(e) => setCfgAgreementSignDate(e.target.value)}
                    />
                    <div className="a-muted" style={{ marginTop: 4, fontSize: 12, maxWidth: 420 }}>
                      可选；书面合同落款用「签订日期」，可与实际电子签字时间不同。留空则清空该字段。
                    </div>
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
                    {configOrder?.isMergedBundle ? (
                      <div className="a-muted" style={{ marginTop: 6, maxWidth: 420, lineHeight: 1.5 }}>
                        本单为<strong>多资产合并合同</strong>：月租须等于各子资产月租之和（当前订单合计 ¥
                        {configOrder.bundleRentMonthlySum ?? '—'}），保存后将写入每期账单「房租」明细及子资产展开项。
                      </div>
                    ) : null}
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
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">缴费周期</div>
                  <div className="a-kv-v">
                    <select
                      className="a-filter-select"
                      value={cfgRentCycle}
                      onChange={(e) => setCfgRentCycle(e.target.value as RentCycle)}
                    >
                      <option value="MONTHLY">月付</option>
                      <option value="BIMONTHLY">双月</option>
                      <option value="QUARTERLY">季付</option>
                      <option value="YEARLY">年付</option>
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
                  <div className="a-kv-k">交租日</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      style={{ minWidth: 160 }}
                      type="number"
                      min={1}
                      max={31}
                      value={cfgRentDueDay}
                      onChange={(e) => setCfgRentDueDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    />
                    <div className="a-muted" style={{ marginTop: 4, fontSize: 12, maxWidth: 420 }}>
                      {rentCycleDueDayHint(cfgRentCycle)}；当月无该日则取月末（如 2 月 30 日 → 2 月 28/29 日）。
                    </div>
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
                      title="相对每期应付日的宽限天数（与月付/双月/季付/年付约定兼容）"
                      value={cfgLatestRentGraceDays}
                      onChange={(e) => setCfgLatestRentGraceDays(e.target.value.replace(/\D/g, ''))}
                    />
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
                                previewFileWithAuth(a.previewUrl).catch((e) =>
                                  setError(e instanceof Error ? e.message : '预览失败'),
                                )
                              }
                            >
                              预览
                            </button>{' '}
                            <button
                              type="button"
                              className="a-btn ghost"
                              style={{ padding: '2px 8px', fontSize: 12 }}
                              onClick={() =>
                                downloadFileWithAuth(a.downloadUrl, a.name).catch((e) =>
                                  setError(e instanceof Error ? e.message : '下载失败'),
                                )
                              }
                              disabled={contractAttachmentsLockedUntilPaid(cfgContractStatus)}
                              title={
                                contractAttachmentsLockedUntilPaid(cfgContractStatus)
                                  ? '租客完成首笔缴费后方可下载'
                                  : undefined
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
                ) : null}
                <div className="a-kv-row" style={{ alignItems: 'flex-start' }}>
                  <div className="a-kv-k">解除合同短信发送时间</div>
                  <div className="a-kv-v" style={{ maxWidth: 560, fontSize: 13, lineHeight: 1.65 }}>
                    {cfgContractTemplate === 'TRIPARTITE' ? (
                      <>
                        当<strong>逾期金额</strong>超过<strong>月租</strong>的{' '}
                        <input
                          className="a-filter-input"
                          type="number"
                          step="0.1"
                          min={0.1}
                          style={{ width: 86 }}
                          value={cfgTerminationRentMulti}
                          onChange={(e) => setCfgTerminationRentMulti(e.target.value)}
                        />{' '}
                        倍时触发（规则配置存档；实际短信以业务接通为准）。
                      </>
                    ) : (
                      <>
                        当<strong>逾期天数</strong>超过<strong>最晚缴费日</strong>（含宽限期后的应付口径）后满{' '}
                        <input
                          className="a-filter-input"
                          type="text"
                          inputMode="numeric"
                          style={{ width: 86 }}
                          value={cfgTerminationDaysPastDue}
                          onChange={(e) => setCfgTerminationDaysPastDue(e.target.value.replace(/\D/g, ''))}
                        />{' '}
                        天时触发（规则配置存档；实际短信以业务接通为准）。
                      </>
                    )}
                  </div>
                </div>
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
                      缴费周期：{rentCycleLabel(cfgRentCycle)}
                      <br />
                      滞纳金：{cfgPenaltyFormula}
                      <br />
                      交租日：每期起始月 {cfgRentDueDay || '—'} 日（{rentCycleLabel(cfgRentCycle)}）
                      <br />
                      最晚交租宽限期：
                      {cfgLatestRentGraceDays.trim() ? `${cfgLatestRentGraceDays.trim()} 天` : '未约定'}
                      <br />
                      合同模板：{contractTemplateZh(cfgContractTemplate)}
                      <br />
                      {cfgContractTemplate === 'TRIPARTITE' ? (
                        <>
                          解除类短信：逾期金额超过月租的 {cfgTerminationRentMulti.trim() || '—'} 倍时触发
                        </>
                      ) : (
                        <>
                          解除类短信：超过最晚缴费日后满 {cfgTerminationDaysPastDue.trim() || '—'} 天时触发
                        </>
                      )}
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

