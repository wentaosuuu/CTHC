import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPost } from '../api'
import { Pagination, paginate } from '../components/Pagination'

type ReceiptKind = 'RENT' | 'DEPOSIT'

type ReceiptInfo = {
  transactionId: string
  printCount: number
  status: 'ACTIVE' | 'VOID'
  reprintApproved: boolean
  reprintRequestStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null
  reprintRequestReason: string | null
  reprintRequestedAt: string | null
  reprintReviewRemark: string | null
  voidReason: string | null
  voidedAt: string | null
  lastPrintedAt: string | null
  lastReceiptKind: ReceiptKind | null
  canPrint: boolean
  canRequestReprint: boolean
  canApproveReprint: boolean
  canVoid: boolean
  printBlockedReason: string | null
}

type TxItem = {
  id: string
  txNo: string
  merchantOrderNo: string | null
  orderId: string
  type: 'BILL_PAYMENT' | 'REFUND' | 'OFFLINE_VERIFY' | 'PREPAYMENT'
  channel: 'ONLINE' | 'OFFLINE'
  amount: number
  occurredAt: string
  contractId: string
  contractNo: string
  tenant: { name: string; phone: string }
  house: { storeName: string; apartmentName: string; houseNo: string }
  houseBizId: string
  period: string | null
  dueDate: string | null
  attachmentCount: number
  note: string
  verify: {
    billId: string
    offlineVerifiedAt: string
    offlineVerifiedRemark: string | null
    offlineVerifyAttachments: {
      id: string
      name: string
      file: string
      previewUrl: string
      downloadUrl: string
    }[]
  } | null
  receipt: ReceiptInfo
}

const TYPE_ZH: Record<TxItem['type'], string> = {
  BILL_PAYMENT: '收款',
  REFUND: '退款',
  OFFLINE_VERIFY: '线下核销',
  PREPAYMENT: '预收入账',
}

/** 悬浮在「类型」旁问号上展示（浏览器原生 tooltip） */
const TX_TYPE_HELP_TITLE = [
  '【收款】租客通过 H5 等线上渠道，对账单整笔支付成功后产生的入账记录。',
  '',
  '【线下核销】在「账单管理」中每提交一次「线下核销」即产生一条流水；金额为本次实收总额，可小于、等于或大于该账单剩余应付。小于时账单仍待付；等于或大于时结清该期。',
  '',
  '【预收入账】与「线下核销」的关系：当本次核销实收金额大于该账单剩余应付时，超出部分会记入合同的「预收余额」（侧栏「合同预收款」可查看余额与流水）。超额部分会额外记一条「预收入账」流水，金额仅为超额；同一次操作中您会先看到一条「线下核销」（整笔实收），若存在超额则紧接出现「预收入账」，便于区分「进账单」与「进预收池」。',
  '',
  '【退款】合同侧退款产生的流水。',
].join('\n')

const CHANNEL_ZH: Record<TxItem['channel'], string> = {
  ONLINE: '线上支付',
  OFFLINE: '线下支付',
}

const RECEIPT_KIND_ZH: Record<ReceiptKind, string> = {
  RENT: '租金收据',
  DEPOSIT: '押金收据',
}

function formatContractNo(contractNo: string) {
  const digits = (contractNo || '').replace(/\D/g, '')
  return digits ? `HT${digits}` : contractNo
}

function fmtMoney(n: number) {
  const sign = n < 0 ? '-' : ''
  const v = Math.abs(n)
  return `${sign}¥${v.toLocaleString('zh-CN')}`
}

function fmtDt(iso: string) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${dd} ${hh}:${mm}`
  } catch {
    return iso
  }
}

function fmtVerifyModalDt(iso: string) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

function receiptStatusLabel(r: ReceiptInfo) {
  if (r.status === 'VOID') return '已作废·可重开'
  if (r.reprintRequestStatus === 'PENDING') return '再次导出待审'
  if (r.reprintRequestStatus === 'REJECTED') return '申请已驳回'
  if (r.reprintApproved) return '可再次导出'
  if (r.printCount > 0) return '已导出'
  return '未导出'
}

function receiptStatusColor(r: ReceiptInfo) {
  if (r.status === 'VOID') return '#b45309'
  if (r.reprintRequestStatus === 'PENDING') return '#b45309'
  if (r.reprintRequestStatus === 'REJECTED') return '#b91c1c'
  if (r.reprintApproved) return '#047857'
  if (r.printCount > 0) return '#334155'
  return '#94a3b8'
}

/** 是否可发起再次导出申请（以接口返回为准） */
function canShowReexportApply(receipt: ReceiptInfo) {
  return receipt.canRequestReprint
}

function openReexportApplyModal(x: TxItem, setReprintReason: (v: string) => void, setReprintModal: (v: TxItem) => void) {
  setReprintReason(x.receipt.reprintRequestReason ?? '')
  setReprintModal(x)
}

export function TransactionsPage() {
  const [items, setItems] = useState<TxItem[]>([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [meRoleCode, setMeRoleCode] = useState('')
  const isFinance = meRoleCode === 'FINANCE'

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [apartmentFilter, setApartmentFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState('')
  const [receiptFilter, setReceiptFilter] = useState('')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [receiptOpen, setReceiptOpen] = useState(false)
  const [receiptKind, setReceiptKind] = useState<ReceiptKind | ''>('')
  const [receiptTargetIds, setReceiptTargetIds] = useState<string[]>([])

  const [verifyDetail, setVerifyDetail] = useState<TxItem | null>(null)
  const [reprintModal, setReprintModal] = useState<TxItem | null>(null)
  const [reprintReason, setReprintReason] = useState('')
  const [voidModal, setVoidModal] = useState<TxItem | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [reviewModal, setReviewModal] = useState<TxItem | null>(null)
  const [reviewRemark, setReviewRemark] = useState('')
  const [receiptDetailModal, setReceiptDetailModal] = useState<TxItem | null>(null)
  const [printLogs, setPrintLogs] = useState<
    {
      id: string
      receiptKind: ReceiptKind
      printSeq: number
      printedAt: string
      printedByAdminName: string | null
      printedByAdminEmail: string | null
    }[]
  >([])

  function resetTransactionFilters() {
    setQ('')
    setTypeFilter('')
    setChannelFilter('')
    setStoreFilter('')
    setApartmentFilter('')
    setPeriodFilter('')
    setReceiptFilter('')
    setPage(1)
  }

  async function load() {
    setError('')
    const r = await apiGet<{ items: TxItem[] }>('/api/admin/transactions')
    if (!r.ok) return setError(r.error)
    setItems(r.data.items ?? [])
    setMsg('')
    setSelectedIds(new Set())
  }

  useEffect(() => {
    load()
    apiGet<{ roleCode: string }>('/api/admin/me').then((r) => {
      if (r.ok) setMeRoleCode(r.data.roleCode)
    })
  }, [])

  function patchReceipt(transactionId: string, receipt: ReceiptInfo) {
    setItems((prev) => prev.map((x) => (x.id === transactionId ? { ...x, receipt } : x)))
  }

  async function openReceiptDetail(x: TxItem) {
    setReceiptDetailModal(x)
    setPrintLogs([])
    const r = await apiGet<{
      items: {
        id: string
        receiptKind: ReceiptKind
        printSeq: number
        printedAt: string
        printedByAdminName: string | null
        printedByAdminEmail: string | null
      }[]
    }>(`/api/admin/transactions/receipts/${encodeURIComponent(x.id)}/print-logs`)
    setPrintLogs(r.ok ? r.data.items : [])
  }

  function openReceiptModal(ids: string[]) {
    setError('')
    setMsg('')
    if (ids.length === 0) return setError('请先选择交易记录')
    const blocked = items.filter((x) => ids.includes(x.id) && !x.receipt.canPrint)
    if (blocked.length > 0) {
      const first = blocked[0]
      return setError(first.receipt.printBlockedReason ?? `流水 ${first.txNo} 当前不可导出`)
    }
    setReceiptTargetIds(ids)
    setReceiptKind('')
    setReceiptOpen(true)
  }

  function openReceiptExportModal() {
    openReceiptModal(Array.from(selectedIds))
  }

  const filterOptions = useMemo(() => {
    const stores = Array.from(new Set(items.map((x) => x.house.storeName).filter(Boolean))).sort()
    const apartments = Array.from(new Set(items.map((x) => x.house.apartmentName).filter(Boolean))).sort()
    const periods = Array.from(new Set(items.map((x) => x.period).filter(Boolean) as string[])).sort().reverse()
    return { stores, apartments, periods }
  }, [items])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return items.filter((x) => {
      if (typeFilter && x.type !== typeFilter) return false
      if (channelFilter && x.channel !== channelFilter) return false
      if (storeFilter && x.house.storeName !== storeFilter) return false
      if (apartmentFilter && x.house.apartmentName !== apartmentFilter) return false
      if (periodFilter && x.period !== periodFilter) return false
      if (receiptFilter === 'pending_reprint' && x.receipt.reprintRequestStatus !== 'PENDING') return false
      if (receiptFilter === 'need_apply' && !canShowReexportApply(x.receipt)) return false
      if (receiptFilter === 'voided' && x.receipt.status !== 'VOID') return false
      if (receiptFilter === 'printed' && x.receipt.printCount === 0) return false
      if (!kw) return true
      const hay =
        `${x.txNo} ${x.merchantOrderNo ?? ''} ${x.orderId} ${x.contractNo} ${formatContractNo(x.contractNo)} ${x.tenant.name} ${x.tenant.phone} ${x.house.storeName} ${x.house.apartmentName} ${x.house.houseNo} ${x.houseBizId} ${x.period ?? ''} ${x.note} ${TYPE_ZH[x.type]} ${CHANNEL_ZH[x.channel]}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, typeFilter, channelFilter, storeFilter, apartmentFilter, periodFilter, receiptFilter])

  const pendingReprintCount = useMemo(
    () => items.filter((x) => x.receipt.reprintRequestStatus === 'PENDING').length,
    [items],
  )

  const needReexportApplyCount = useMemo(
    () => items.filter((x) => canShowReexportApply(x.receipt)).length,
    [items],
  )

  const pageData = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize])

  const visibleIds = useMemo(() => pageData.items.map((x) => x.id), [pageData.items])
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id))

  function closeReceiptModal() {
    setReceiptOpen(false)
    setReceiptKind('')
    setReceiptTargetIds([])
  }

  async function confirmReceiptExport() {
    const ids = receiptTargetIds
    const kind = receiptKind
    if (!kind || ids.length === 0) return
    setError('')
    const r = await apiPost<{ message: string; results: { transactionId: string; receipt: ReceiptInfo }[] }>(
      '/api/admin/transactions/receipts/print',
      { transactionIds: ids, receiptKind: kind },
    )
    if (!r.ok) return setError(r.error)
    for (const row of r.data.results) patchReceipt(row.transactionId, row.receipt)
    setMsg(r.data.message)
    closeReceiptModal()
  }

  async function submitReprintRequest() {
    if (!reprintModal) return
    const reason = reprintReason.trim()
    if (reason.length < 2) return setError('请填写再次导出原因（至少 2 字）')
    const r = await apiPost<{ receipt: ReceiptInfo }>('/api/admin/transactions/receipts/reprint-request', {
      transactionId: reprintModal.id,
      reason,
    })
    if (!r.ok) return setError(r.error)
    patchReceipt(reprintModal.id, r.data.receipt)
    setMsg(`已提交再次导出申请：${reprintModal.txNo}`)
    setReprintModal(null)
    setReprintReason('')
  }

  async function submitReprintReview(action: 'APPROVE' | 'REJECT') {
    if (!reviewModal) return
    const r = await apiPost<{ receipt: ReceiptInfo }>('/api/admin/transactions/receipts/reprint-review', {
      transactionId: reviewModal.id,
      action,
      remark: reviewRemark.trim() || undefined,
    })
    if (!r.ok) return setError(r.error)
    patchReceipt(reviewModal.id, r.data.receipt)
    setMsg(action === 'APPROVE' ? `已批准再次导出：${reviewModal.txNo}` : `已驳回再次导出申请：${reviewModal.txNo}`)
    setReviewModal(null)
    setReviewRemark('')
  }

  async function submitVoidReceipt() {
    if (!voidModal) return
    const reason = voidReason.trim()
    if (reason.length < 2) return setError('请填写作废原因（至少 2 字）')
    const r = await apiPost<{ receipt: ReceiptInfo }>('/api/admin/transactions/receipts/void', {
      transactionId: voidModal.id,
      reason,
    })
    if (!r.ok) return setError(r.error)
    patchReceipt(voidModal.id, r.data.receipt)
    setMsg(`收据已作废：${voidModal.txNo}`)
    setVoidModal(null)
    setVoidReason('')
  }

  const emptyColSpan = 20

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">交易记录</div>
        <div className="a-muted">
          汇总系统内收款、退款与线下核销流水。<strong>所有角色</strong>每条交易流水收据仅可<strong>导出 1 次</strong>；再次导出须向<strong>财务</strong>申请并说明原因。<strong>财务作废</strong>后，可重新开具收据（作废记录保留在收据详情中）。
        </div>
        {meRoleCode ? (
          <div className="a-muted" style={{ marginTop: 6, fontSize: 13 }}>
            当前登录角色：
            <strong>
              {meRoleCode === 'STORE_MANAGER'
                ? '店长'
                : meRoleCode === 'FINANCE'
                  ? '财务'
                  : meRoleCode === 'SYSTEM_ADMIN'
                    ? '系统管理员'
                    : meRoleCode}
            </strong>
          </div>
        ) : null}
        {isFinance && pendingReprintCount > 0 ? (
          <div className="a-muted" style={{ marginTop: 8, color: '#b45309' }}>
            待审批再次导出申请 {pendingReprintCount} 条，可在下方筛选「再次导出待审」或于操作列审批。
          </div>
        ) : null}
        {needReexportApplyCount > 0 && !isFinance ? (
          <div className="a-muted" style={{ marginTop: 8 }}>
            当前有 <strong>{needReexportApplyCount}</strong> 条流水已导出、可申请再次导出。请点击操作列
            <strong>「申请再次导出」</strong>并填写原因，待财务审批通过后方可再次导出。
          </div>
        ) : null}
      </div>

      {error ? <div className="a-card a-error">{error}</div> : null}
      {needReexportApplyCount > 0 ? (
        <div className="a-card" style={{ borderColor: '#fdba74', background: '#fff7ed', padding: '10px 14px' }}>
          <strong style={{ color: '#c2410c' }}>有 {needReexportApplyCount} 条流水已导出、可申请再次导出。</strong>
          <span className="a-muted" style={{ marginLeft: 8 }}>
            请在操作列点击橙色「申请再次导出」，或筛选「可申请再次导出」快速定位。
          </span>
          <button
            type="button"
            className="a-btn a-reexport-apply-btn"
            style={{ marginLeft: 12 }}
            onClick={() => {
              setReceiptFilter('need_apply')
              setPage(1)
            }}
          >
            查看待申请流水
          </button>
        </div>
      ) : null}
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
              placeholder="搜索：流水号/商户单号/合同/租客/门店/房号/备注…"
              style={{ minWidth: 210 }}
            />
            <select
              className="a-filter-select"
              value={storeFilter}
              onChange={(e) => {
                setStoreFilter(e.target.value)
                setPage(1)
              }}
              title="所属门店"
            >
              <option value="">全部门店</option>
              {filterOptions.stores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="a-filter-select"
              value={apartmentFilter}
              onChange={(e) => {
                setApartmentFilter(e.target.value)
                setPage(1)
              }}
              title="公寓"
            >
              <option value="">全部公寓</option>
              {filterOptions.apartments.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              className="a-filter-select"
              value={periodFilter}
              onChange={(e) => {
                setPeriodFilter(e.target.value)
                setPage(1)
              }}
              title="账期"
            >
              <option value="">全部账期</option>
              {filterOptions.periods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              className="a-filter-select"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value)
                setPage(1)
              }}
              title="交易类型"
            >
              <option value="">全部类型</option>
              <option value="BILL_PAYMENT">收款</option>
              <option value="OFFLINE_VERIFY">线下核销</option>
              <option value="PREPAYMENT">预收入账</option>
              <option value="REFUND">退款</option>
            </select>
            <select
              className="a-filter-select"
              value={channelFilter}
              onChange={(e) => {
                setChannelFilter(e.target.value)
                setPage(1)
              }}
              title="交易渠道"
            >
              <option value="">全部渠道</option>
              <option value="ONLINE">线上支付</option>
              <option value="OFFLINE">线下支付</option>
            </select>
            <select
              className="a-filter-select"
              value={receiptFilter}
              onChange={(e) => {
                setReceiptFilter(e.target.value)
                setPage(1)
              }}
              title="收据状态"
            >
              <option value="">全部收据</option>
              <option value="need_apply">可申请再次导出</option>
              <option value="pending_reprint">再次导出待审</option>
              <option value="printed">已导出</option>
              <option value="voided">已作废</option>
            </select>
            <button className="a-btn ghost" onClick={() => setPage(1)} title="使用当前筛选条件进行查询">
              查询
            </button>
            <button className="a-btn ghost" onClick={resetTransactionFilters} title="清空筛选条件">
              重置
            </button>
            <span className="a-muted">共 {filtered.length} 条</span>
          </div>

          <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              className="a-btn ghost"
              onClick={() => setMsg('导出功能待业主提供模板后开启')}
              title="等待业主提供导出模板"
            >
              导出
            </button>
            <button className="a-btn ghost" onClick={openReceiptExportModal} title="导出所选交易的收据">
              导出收据
            </button>
            <button className="a-btn ghost" onClick={load}>
              刷新
            </button>
          </div>
        </div>

        <div style={{ height: 10 }} />
        <div className="a-table-wrap">
          <table className="a-table a-table-sticky-op">
            <thead>
              <tr>
                <th style={{ width: 48 }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected
                    }}
                    onChange={(e) => {
                      const checked = e.target.checked
                      setSelectedIds((prev) => {
                        const next = new Set(prev)
                        for (const id of visibleIds) {
                          if (checked) next.add(id)
                          else next.delete(id)
                        }
                        return next
                      })
                    }}
                    aria-label="全选当前页数据"
                  />
                </th>
                <th>时间</th>
                <th>流水号</th>
                <th>商户单号</th>
                <th>订单号</th>
                <th>
                  <span className="a-th-label-help">
                    类型
                    <span
                      className="a-help-icon"
                      tabIndex={0}
                      role="note"
                      title={TX_TYPE_HELP_TITLE}
                      aria-label="交易类型说明：收款、线下核销、预收入账、退款的含义及预收与核销的边界"
                    >
                      ?
                    </span>
                  </span>
                </th>
                <th>交易渠道</th>
                <th>金额</th>
                <th>合同</th>
                <th>房源ID</th>
                <th>租客</th>
                <th>手机号</th>
                <th>门店</th>
                <th>公寓</th>
                <th>房号</th>
                <th>账期 / 到期</th>
                <th>导出次数</th>
                <th>收据状态</th>
                <th>备注</th>
                <th>附件</th>
                <th className="a-op-col">操作</th>
              </tr>
            </thead>
            <tbody>
              {pageData.items.map((x) => (
                <tr key={x.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(x.id)}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setSelectedIds((prev) => {
                          const next = new Set(prev)
                          if (checked) next.add(x.id)
                          else next.delete(x.id)
                          return next
                        })
                      }}
                      aria-label={`选择 ${x.txNo}`}
                    />
                  </td>
                  <td className="a-muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                    {fmtDt(x.occurredAt)}
                  </td>
                  <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{x.txNo}</td>
                  <td className="a-muted" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {x.merchantOrderNo || '—'}
                  </td>
                  <td className="a-muted" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {x.orderId}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 800 }}>{TYPE_ZH[x.type]}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{CHANNEL_ZH[x.channel]}</td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 900, color: x.amount < 0 ? '#b91c1c' : '#047857' }}>
                    {fmtMoney(x.amount)}
                  </td>
                  <td style={{ fontWeight: 700 }}>{formatContractNo(x.contractNo)}</td>
                  <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{x.houseBizId}</td>
                  <td>{x.tenant.name}</td>
                  <td className="a-muted">{x.tenant.phone}</td>
                  <td className="a-muted">{x.house.storeName}</td>
                  <td className="a-muted">{x.house.apartmentName}</td>
                  <td style={{ fontWeight: 700 }}>{x.house.houseNo}</td>
                  <td className="a-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {x.period || '—'} <span style={{ color: '#94a3b8' }}>/</span> {x.dueDate || '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                    {x.receipt.printCount}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ fontWeight: 700, color: receiptStatusColor(x.receipt) }}>
                      {receiptStatusLabel(x.receipt)}
                    </span>
                    {canShowReexportApply(x.receipt) ? (
                      <button
                        type="button"
                        className="a-btn ghost"
                        style={{ marginLeft: 6, padding: '2px 8px', fontSize: 12, color: '#b45309', borderColor: '#fdba74' }}
                        onClick={() => openReexportApplyModal(x, setReprintReason, setReprintModal)}
                      >
                        去申请
                      </button>
                    ) : null}
                  </td>
                  <td className="a-muted" style={{ maxWidth: 220, fontSize: 12 }}>
                    {x.note}
                  </td>
                  <td className="a-muted" style={{ whiteSpace: 'nowrap' }}>
                    {x.attachmentCount > 0 ? `${x.attachmentCount} 个` : '—'}
                  </td>
                  <td className="a-op-cell a-op-cell--transactions">
                    <div className="a-op-actions a-op-actions--transactions">
                      <button type="button" className="a-btn ghost" onClick={() => openReceiptDetail(x)}>
                        收据详情
                      </button>
                      {x.receipt.canPrint ? (
                        <button type="button" className="a-btn" onClick={() => openReceiptModal([x.id])}>
                          导出收据
                        </button>
                      ) : null}
                      {canShowReexportApply(x.receipt) ? (
                        <button
                          type="button"
                          className="a-btn a-reexport-apply-btn"
                          onClick={() => openReexportApplyModal(x, setReprintReason, setReprintModal)}
                        >
                          申请再次导出
                        </button>
                      ) : null}
                      {x.receipt.reprintRequestStatus === 'PENDING' && x.receipt.status !== 'VOID' ? (
                        <button type="button" className="a-btn ghost" disabled title="已提交申请，请等待财务审批">
                          财务审核中
                        </button>
                      ) : null}
                      {x.receipt.reprintRequestStatus === 'REJECTED' && x.receipt.reprintReviewRemark ? (
                        <span
                          className="a-muted"
                          style={{ fontSize: 12, maxWidth: 120 }}
                          title={`驳回原因：${x.receipt.reprintReviewRemark}`}
                        >
                          驳回：{x.receipt.reprintReviewRemark.slice(0, 12)}
                          {x.receipt.reprintReviewRemark.length > 12 ? '…' : ''}
                        </span>
                      ) : null}
                      {x.receipt.canApproveReprint ? (
                        <button
                          type="button"
                          className="a-btn ghost"
                          onClick={() => {
                            setReviewRemark('')
                            setReviewModal(x)
                          }}
                        >
                          审批导出
                        </button>
                      ) : null}
                      {x.receipt.canVoid ? (
                        <button
                          type="button"
                          className="a-btn ghost"
                          onClick={() => {
                            setVoidReason('')
                            setVoidModal(x)
                          }}
                        >
                          作废收据
                        </button>
                      ) : null}
                      {x.type === 'OFFLINE_VERIFY' && x.verify ? (
                        <button type="button" className="a-btn ghost" onClick={() => setVerifyDetail(x)}>
                          核销详情
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={emptyColSpan} className="a-muted">
                    暂无交易记录。
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

      {receiptOpen ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && closeReceiptModal()}
        >
          <div className="a-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">导出收据</div>
              <button type="button" className="a-modal-close" onClick={closeReceiptModal}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <p className="a-muted" style={{ margin: '0 0 14px', lineHeight: 1.55, fontSize: 14 }}>
                已选择 <strong>{receiptTargetIds.length}</strong> 条记录。请选择收据类型（业主提供 Word/PDF 模板后将自动套打）。
                <strong>所有账号</strong>每条流水仅可导出 1 次；再次导出须先向财务申请并获批准。
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label className="a-row" style={{ alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="receiptKind"
                    checked={receiptKind === 'RENT'}
                    onChange={() => setReceiptKind('RENT')}
                  />
                  <span>{RECEIPT_KIND_ZH.RENT}</span>
                </label>
                <label className="a-row" style={{ alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="receiptKind"
                    checked={receiptKind === 'DEPOSIT'}
                    onChange={() => setReceiptKind('DEPOSIT')}
                  />
                  <span>{RECEIPT_KIND_ZH.DEPOSIT}</span>
                </label>
              </div>
              <div className="a-row" style={{ marginTop: 18, gap: 10, flexWrap: 'wrap' }}>
                <button type="button" className="a-btn ghost" onClick={closeReceiptModal}>
                  取消
                </button>
                <button type="button" className="a-btn" disabled={!receiptKind} onClick={confirmReceiptExport}>
                  导出
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {verifyDetail && verifyDetail.verify ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setVerifyDetail(null)}
        >
          <div className="a-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">
                核销详情 · {formatContractNo(verifyDetail.contractNo)} {verifyDetail.period ?? ''}
              </div>
              <button type="button" className="a-modal-close" onClick={() => setVerifyDetail(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">核销时间</div>
                  <div className="a-kv-v">{fmtVerifyModalDt(verifyDetail.verify.offlineVerifiedAt)}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">金额</div>
                  <div className="a-kv-v">¥{verifyDetail.amount}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">房源</div>
                  <div className="a-kv-v">
                    {verifyDetail.house.apartmentName} {verifyDetail.house.houseNo}（{verifyDetail.house.storeName}）
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">租客</div>
                  <div className="a-kv-v">
                    {verifyDetail.tenant.name} {verifyDetail.tenant.phone}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">备注</div>
                  <div className="a-kv-v">
                    {verifyDetail.verify.offlineVerifiedRemark?.trim() ? verifyDetail.verify.offlineVerifiedRemark : '—'}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">附件</div>
                  <div className="a-kv-v">
                    {verifyDetail.verify.offlineVerifyAttachments.length > 0 ? (
                      <div className="a-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                        {verifyDetail.verify.offlineVerifyAttachments.map((a) => (
                          <a
                            key={a.id}
                            className="a-btn ghost"
                            href={a.previewUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="点击预览；右键可另存为"
                          >
                            {a.name}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="a-muted">未上传</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <Link className="a-btn" to="/bills">
                  去账单管理
                </Link>
                <button type="button" className="a-btn ghost" onClick={() => setVerifyDetail(null)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {reprintModal ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setReprintModal(null)}
        >
          <div className="a-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">申请再次导出 · {reprintModal.txNo}</div>
              <button type="button" className="a-modal-close" onClick={() => setReprintModal(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <p className="a-muted" style={{ margin: '0 0 12px', lineHeight: 1.55 }}>
                该流水已导出 {reprintModal.receipt.printCount} 次。请说明再次导出原因，提交后由<strong>财务</strong>审批；审批通过后方可再次导出。
              </p>
              <textarea
                className="a-filter-input"
                style={{ width: '100%', minHeight: 96, resize: 'vertical' }}
                value={reprintReason}
                onChange={(e) => setReprintReason(e.target.value)}
                placeholder="请填写再次导出原因，如：租客遗失收据、打印不清晰等"
              />
              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <button type="button" className="a-btn ghost" onClick={() => setReprintModal(null)}>
                  取消
                </button>
                <button type="button" className="a-btn" onClick={submitReprintRequest}>
                  提交申请
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {reviewModal ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setReviewModal(null)}
        >
          <div className="a-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">审批再次导出 · {reviewModal.txNo}</div>
              <button type="button" className="a-modal-close" onClick={() => setReviewModal(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">已导出次数</div>
                  <div className="a-kv-v">{reviewModal.receipt.printCount}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">申请原因</div>
                  <div className="a-kv-v">{reviewModal.receipt.reprintRequestReason || '—'}</div>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <div className="a-muted" style={{ marginBottom: 6 }}>审批备注（选填）</div>
                <input
                  className="a-filter-input"
                  style={{ width: '100%' }}
                  value={reviewRemark}
                  onChange={(e) => setReviewRemark(e.target.value)}
                  placeholder="驳回时请说明原因"
                />
              </div>
              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <button type="button" className="a-btn ghost" onClick={() => submitReprintReview('REJECT')}>
                  驳回
                </button>
                <button type="button" className="a-btn" onClick={() => submitReprintReview('APPROVE')}>
                  批准再次导出
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {voidModal ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setVoidModal(null)}
        >
          <div className="a-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">作废收据 · {voidModal.txNo}</div>
              <button type="button" className="a-modal-close" onClick={() => setVoidModal(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <p className="a-muted" style={{ margin: '0 0 12px', lineHeight: 1.55 }}>
                作废后该流水收据将不可再打印，请谨慎操作。
              </p>
              <textarea
                className="a-filter-input"
                style={{ width: '100%', minHeight: 96, resize: 'vertical' }}
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="请填写作废原因"
              />
              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <button type="button" className="a-btn ghost" onClick={() => setVoidModal(null)}>
                  取消
                </button>
                <button type="button" className="a-btn" onClick={submitVoidReceipt}>
                  确认作废
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {receiptDetailModal ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setReceiptDetailModal(null)}
        >
          <div className="a-modal a-modal--receipt-detail" onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">收据详情 · {receiptDetailModal.txNo}</div>
              <button type="button" className="a-modal-close" onClick={() => setReceiptDetailModal(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv" style={{ marginBottom: 14 }}>
                <div className="a-kv-row">
                  <div className="a-kv-k">收据状态</div>
                  <div className="a-kv-v" style={{ color: receiptStatusColor(receiptDetailModal.receipt), fontWeight: 700 }}>
                    {receiptStatusLabel(receiptDetailModal.receipt)}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">累计导出</div>
                  <div className="a-kv-v">{receiptDetailModal.receipt.printCount} 次</div>
                </div>
                {receiptDetailModal.receipt.lastPrintedAt ? (
                  <div className="a-kv-row">
                    <div className="a-kv-k">最近导出</div>
                    <div className="a-kv-v">
                      {fmtDt(receiptDetailModal.receipt.lastPrintedAt)}
                      {receiptDetailModal.receipt.lastReceiptKind
                        ? ` · ${RECEIPT_KIND_ZH[receiptDetailModal.receipt.lastReceiptKind]}`
                        : ''}
                      {printLogs[0]?.printedByAdminEmail
                        ? ` · ${printLogs[0].printedByAdminName || '—'}（${printLogs[0].printedByAdminEmail}）`
                        : printLogs[0]?.printedByAdminName
                          ? ` · ${printLogs[0].printedByAdminName}`
                          : ''}
                    </div>
                  </div>
                ) : null}
                {receiptDetailModal.receipt.reprintRequestReason ? (
                  <div className="a-kv-row">
                    <div className="a-kv-k">再次导出申请</div>
                    <div className="a-kv-v">
                      {receiptDetailModal.receipt.reprintRequestReason}
                      {receiptDetailModal.receipt.reprintRequestedAt
                        ? `（${fmtDt(receiptDetailModal.receipt.reprintRequestedAt)}）`
                        : ''}
                    </div>
                  </div>
                ) : null}
                {receiptDetailModal.receipt.reprintReviewRemark ? (
                  <div className="a-kv-row">
                    <div className="a-kv-k">审批备注</div>
                    <div className="a-kv-v">{receiptDetailModal.receipt.reprintReviewRemark}</div>
                  </div>
                ) : null}
                {receiptDetailModal.receipt.voidedAt ? (
                  <div className="a-kv-row">
                    <div className="a-kv-k">{receiptDetailModal.receipt.status === 'VOID' ? '作废信息' : '上次作废'}</div>
                    <div className="a-kv-v" style={{ color: '#b91c1c' }}>
                      {receiptDetailModal.receipt.voidReason || '—'}
                      {receiptDetailModal.receipt.voidedAt ? `（${fmtDt(receiptDetailModal.receipt.voidedAt)}）` : ''}
                    </div>
                  </div>
                ) : null}
              </div>

              <div style={{ fontWeight: 800, marginBottom: 8 }}>导出历史</div>
              {printLogs.length === 0 ? (
                <div className="a-muted">暂无导出记录。</div>
              ) : (
                <div className="a-table-wrap a-receipt-detail-table">
                  <table className="a-table">
                    <thead>
                      <tr>
                        <th>次序</th>
                        <th>收据类型</th>
                        <th>导出时间</th>
                        <th>操作人</th>
                        <th>操作账号</th>
                      </tr>
                    </thead>
                    <tbody>
                      {printLogs.map((l) => (
                        <tr key={l.id}>
                          <td>第 {l.printSeq} 次</td>
                          <td>{RECEIPT_KIND_ZH[l.receiptKind]}</td>
                          <td className="a-muted">{fmtDt(l.printedAt)}</td>
                          <td>{l.printedByAdminName || '—'}</td>
                          <td className="a-muted">{l.printedByAdminEmail || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="a-row" style={{ marginTop: 16, gap: 10, flexWrap: 'wrap' }}>
                {receiptDetailModal.receipt.canPrint ? (
                  <button
                    type="button"
                    className="a-btn"
                    onClick={() => {
                      setReceiptDetailModal(null)
                      openReceiptModal([receiptDetailModal.id])
                    }}
                  >
                    导出收据
                  </button>
                ) : null}
                {canShowReexportApply(receiptDetailModal.receipt) ? (
                  <button
                    type="button"
                    className="a-btn a-reexport-apply-btn"
                    onClick={() => {
                      setReceiptDetailModal(null)
                      openReexportApplyModal(receiptDetailModal, setReprintReason, setReprintModal)
                    }}
                  >
                    申请再次导出
                  </button>
                ) : null}
                {receiptDetailModal.receipt.reprintRequestStatus === 'PENDING' ? (
                  <span className="a-muted" style={{ alignSelf: 'center' }}>
                    已提交再次导出申请，请等待财务审批
                  </span>
                ) : null}
                <button type="button" className="a-btn ghost" onClick={() => setReceiptDetailModal(null)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
