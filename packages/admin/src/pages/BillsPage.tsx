import { useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPost } from '../api'
import { getAdminToken } from '../auth'
import { Pagination, paginate } from '../components/Pagination'

type BillPeriodSummary = {
  storeId: string
  storeName: string
  period: string
  contractCount: number
  billCount: number
  totalAmount: number
  dueDateFrom: string
  dueDateTo: string
  locked: boolean
  lockedAt: string | null
}

type BillListItem = {
  id: string
  contractNo: string
  contractId?: string
  houseBizId: string
  apartmentName: string
  houseNo: string
  storeName: string
  tenantName: string
  tenantPhone: string
  period: string
  dueDate: string
  totalAmount: number
  status: string
  items?: { name: string; amount: number }[]
}

type BillDetail = BillListItem & {
  paidAt: string | null
  offlineVerifiedAt?: string | null
  offlineVerifiedRemark?: string | null
  offlineVerifyAttachments?: { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }[]
  createdAt: string
  items: { name: string; amount: number }[]
  changeLogs?: {
    id: string
    changedAt: string
    adminName: string
    remark: string
    beforeJson: string
    afterJson: string
  }[]
}

type ContractOption = {
  id: string
  contractNo: string
  status: string
  house: { apartmentName: string; houseNo: string; storeName: string }
  tenant: { name: string; phone: string }
}

type AdminStore = { id: string; name: string }

function formatContractNo(contractNo: string) {
  const digits = (contractNo || '').replace(/\D/g, '')
  return digits ? `HT${digits}` : contractNo
}

function formatBillNo(billId: string, digits = 10) {
  let h = 0
  for (let i = 0; i < billId.length; i += 1) h = (h * 31 + billId.charCodeAt(i)) >>> 0
  const s = String(h).padStart(digits, '0')
  return `ZD${s.slice(-digits)}`
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'UNPAID':
      return 'a-badge status-unpaid'
    case 'PAID':
      return 'a-badge status-paid'
    case 'OVERDUE':
      return 'a-badge status-overdue'
    default:
      return 'a-badge'
  }
}

const STATUS_ZH: Record<string, string> = {
  UNPAID: '未支付',
  PAID: '已支付',
  OVERDUE: '已逾期',
}

const FEE_ITEM_NAMES = ['租金', '水费', '电费', '物业费', '垃圾处理费', '公摊电费', '燃气费', '网络费', '滞纳金']
const DEFAULT_FEE_NAMES = FEE_ITEM_NAMES

function csvEscape(v: unknown) {
  const s = String(v ?? '')
  const needs = /[",\n\r]/.test(s)
  const escaped = s.replace(/"/g, '""')
  return needs ? `"${escaped}"` : escaped
}

export function BillsPage() {
  const [mode, setMode] = useState<'summary' | 'detail'>('summary')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  // summary
  const [summaries, setSummaries] = useState<BillPeriodSummary[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [q, setQ] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  function resetBillSummaryFilters() {
    setQ('')
    setStoreFilter('')
    setPeriodFilter('')
    setPage(1)
  }

  // detail
  const [current, setCurrent] = useState<{ storeId: string; storeName: string; period: string; locked: boolean } | null>(null)
  const [detailItems, setDetailItems] = useState<BillListItem[]>([])
  const [detailKeywordInput, setDetailKeywordInput] = useState('')
  const [detailStatusInput, setDetailStatusInput] = useState('')
  const [detailDueDateFromInput, setDetailDueDateFromInput] = useState('')
  const [detailDueDateToInput, setDetailDueDateToInput] = useState('')
  const [detailKeyword, setDetailKeyword] = useState('')
  const [detailStatus, setDetailStatus] = useState('')
  const [detailDueDateFrom, setDetailDueDateFrom] = useState('')
  const [detailDueDateTo, setDetailDueDateTo] = useState('')

  const [detailBill, setDetailBill] = useState<BillDetail | null>(null)
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null)

  // import (keep existing ability; server will reject if locked)
  const [importOpen, setImportOpen] = useState(false)
  const [contracts, setContracts] = useState<ContractOption[]>([])
  const [importContractId, setImportContractId] = useState('')
  const [importPeriod, setImportPeriod] = useState('')
  const [importDueDate, setImportDueDate] = useState('')
  const [importItems, setImportItems] = useState<{ name: string; amount: number }[]>(DEFAULT_FEE_NAMES.map((name) => ({ name, amount: 0 })))
  const [importSubmitting, setImportSubmitting] = useState(false)

  const [fileImportSubmitting, setFileImportSubmitting] = useState(false)
  const [fileImportResult, setFileImportResult] = useState<{ created: number; errors: string[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // offline verify
  const [offlineVerifyBill, setOfflineVerifyBill] = useState<BillListItem | null>(null)
  const [offlineVerifyRemark, setOfflineVerifyRemark] = useState('')
  const [offlineVerifyFiles, setOfflineVerifyFiles] = useState<File[]>([])
  const [offlineVerifySubmitting, setOfflineVerifySubmitting] = useState(false)
  const offlineVerifyFileInputRef = useRef<HTMLInputElement>(null)

  const [editBill, setEditBill] = useState<BillDetail | null>(null)
  const [editItems, setEditItems] = useState<{ name: string; amount: number }[]>([])
  const [editDueDate, setEditDueDate] = useState('')
  const [editRemark, setEditRemark] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)

  // 一级：新建账期
  const [createPeriodOpen, setCreatePeriodOpen] = useState(false)
  const [storesForCreate, setStoresForCreate] = useState<AdminStore[]>([])
  const [manualStoreId, setManualStoreId] = useState('')
  const [manualPeriod, setManualPeriod] = useState('')
  const [manualStatStartDate, setManualStatStartDate] = useState('')
  const [manualDueDate, setManualDueDate] = useState('')
  const [createPeriodSubmitting, setCreatePeriodSubmitting] = useState(false)
  const [createPeriodResult, setCreatePeriodResult] = useState<Record<string, unknown> | null>(null)

  async function loadSummaries() {
    setError('')
    const r = await apiGet<{ items: BillPeriodSummary[] }>('/api/admin/bill-periods')
    if (!r.ok) return setError(r.error)
    setSummaries(r.data.items ?? [])
  }

  useEffect(() => {
    loadSummaries()
  }, [])

  async function openDetail(s: BillPeriodSummary) {
    setMode('detail')
    setCurrent({ storeId: s.storeId, storeName: s.storeName, period: s.period, locked: s.locked })
    setDetailItems([])
    setError('')
    setMsg('')
    setDetailKeywordInput('')
    setDetailStatusInput('')
    setDetailDueDateFromInput('')
    setDetailDueDateToInput('')
    setDetailKeyword('')
    setDetailStatus('')
    setDetailDueDateFrom('')
    setDetailDueDateTo('')
    const r = await apiGet<{ items: BillListItem[]; locked: boolean }>(`/api/admin/bill-periods/${s.storeId}/${s.period}`)
    if (!r.ok) return setError(r.error)
    setDetailItems(r.data.items ?? [])
    setCurrent((prev) => (prev ? { ...prev, locked: Boolean(r.data.locked) } : prev))
  }

  async function backToSummary() {
    setMode('summary')
    setCurrent(null)
    setDetailItems([])
    setDetailBill(null)
    setOfflineVerifyBill(null)
    setDetailKeywordInput('')
    setDetailStatusInput('')
    setDetailDueDateFromInput('')
    setDetailDueDateToInput('')
    setDetailKeyword('')
    setDetailStatus('')
    setDetailDueDateFrom('')
    setDetailDueDateTo('')
    await loadSummaries()
  }

  function searchDetailItems() {
    setDetailKeyword(detailKeywordInput.trim())
    setDetailStatus(detailStatusInput)
    setDetailDueDateFrom(detailDueDateFromInput)
    setDetailDueDateTo(detailDueDateToInput)
  }

  function resetDetailFilters() {
    setDetailKeywordInput('')
    setDetailStatusInput('')
    setDetailDueDateFromInput('')
    setDetailDueDateToInput('')
    setDetailKeyword('')
    setDetailStatus('')
    setDetailDueDateFrom('')
    setDetailDueDateTo('')
  }

  function formatGeneratePeriodError(code: string) {
    switch (code) {
      case 'PERIOD_LOCKED':
        return '该账期已锁定，无法生成账单'
      case 'BAD_BODY':
        return '提交内容不正确'
      case 'FORBIDDEN':
        return '无权限操作该门店'
      default:
        return code
    }
  }

  async function openCreatePeriodModal() {
    setCreatePeriodOpen(true)
    setCreatePeriodResult(null)
    setError('')
    const d = new Date()
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    setManualPeriod(month)
    setManualStatStartDate(`${month}-01`)
    setManualDueDate('')
    const r = await apiGet<{ items: AdminStore[] }>('/api/admin/stores')
    if (!r.ok) {
      setError(r.error)
      setStoresForCreate([])
      return
    }
    const list = r.data.items ?? []
    setStoresForCreate(list)
    setManualStoreId((prev) => (prev && list.some((s) => s.id === prev) ? prev : list[0]?.id ?? ''))
  }

  async function submitCreatePeriodManual() {
    if (!manualStoreId) return setError('请选择门店')
    if (!/^\d{4}-\d{2}$/.test(manualPeriod)) return setError('请选择正确的账期（年月）')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(manualStatStartDate)) return setError('请选择开始统计时间')
    setCreatePeriodSubmitting(true)
    setError('')
    setCreatePeriodResult(null)
    const body: Record<string, unknown> = {
      mode: 'manual',
      storeId: manualStoreId,
      period: manualPeriod,
      statStartDate: manualStatStartDate,
    }
    if (manualDueDate.trim()) body.dueDate = manualDueDate.trim()
    const r = await apiPost<Record<string, unknown>>('/api/admin/bill-periods/generate', body)
    setCreatePeriodSubmitting(false)
    if (!r.ok) {
      setError(formatGeneratePeriodError(r.error))
      return
    }
    setCreatePeriodResult(r.data)
    setMsg(
      `手动生成完成：新建 ${String(r.data.created ?? 0)} 条租金账单；已有 ${String(r.data.skippedExisting ?? 0)} 条已存在；不在租期内 ${String(r.data.skippedOutOfLease ?? 0)} 个合同跳过。`,
    )
    await loadSummaries()
  }

  async function lockPeriod(s: BillPeriodSummary) {
    if (s.locked) return
    const ok = window.confirm(`确认锁定【${s.storeName} / ${s.period}】吗？\n锁定后不可解锁，且该账期将不允许再导入/新增账单。`)
    if (!ok) return
    setError('')
    setMsg('')
    const r = await apiPost<{ ok: true; lockedAt: string }>(`/api/admin/bill-periods/${s.storeId}/${s.period}/lock`, {})
    if (!r.ok) return setError(r.error)
    setMsg('已锁定该账期（不可解锁）')
    setSelectedKeys(new Set())
    await loadSummaries()
  }

  const filterOptions = useMemo(() => {
    const stores = Array.from(new Set(summaries.map((x) => x.storeName).filter(Boolean))).sort()
    const periods = Array.from(new Set(summaries.map((x) => x.period).filter(Boolean))).sort().reverse()
    return { stores, periods }
  }, [summaries])

  const filteredSummaries = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return summaries.filter((s) => {
      if (storeFilter && s.storeName !== storeFilter) return false
      if (periodFilter && s.period !== periodFilter) return false
      if (!kw) return true
      const hay = `${s.storeName} ${s.period}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [summaries, q, storeFilter, periodFilter])

  const pageData = useMemo(() => paginate(filteredSummaries, page, pageSize), [filteredSummaries, page, pageSize])

  async function exportSelectedPeriod() {
    const keys = Array.from(selectedKeys)
    if (keys.length === 0) return setError('请先勾选一个账期再导出')
    if (keys.length > 1) return setError('当前仅支持一次导出一个账期，请只勾选一行')
    const [storeId, period] = keys[0].split('__')
    const r = await apiGet<{ items: BillListItem[]; locked: boolean }>(`/api/admin/bill-periods/${storeId}/${period}`)
    if (!r.ok) return setError(r.error)
    const rows = r.data.items ?? []
    const header = ['账单编号', '合同', '租客', '手机号', '公寓', '房号', '门店', '账期', '到期日', '应收金额', '状态', '明细']
    const lines = [
      header.map(csvEscape).join(','),
      ...rows.map((b) => {
        const itemsStr = (b.items ?? []).map((it) => `${it.name}:${it.amount}`).join('；')
        return [
          formatBillNo(b.id),
          formatContractNo(b.contractNo),
          b.tenantName,
          b.tenantPhone,
          b.apartmentName,
          b.houseNo,
          b.storeName,
          b.period,
          b.dueDate,
          b.totalAmount,
          STATUS_ZH[b.status] ?? b.status,
          itemsStr,
        ].map(csvEscape).join(',')
      }),
    ]
    const bom = '\uFEFF'
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `账单明细_${period}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setMsg(`已导出 ${rows.length} 条账单明细`)
  }

  async function loadDetail(billId: string) {
    setDetailLoadingId(billId)
    const r = await apiGet<BillDetail>('/api/admin/bills/' + billId)
    setDetailLoadingId(null)
    if (!r.ok) return setError(r.error)
    setDetailBill(r.data)
  }

  async function openEdit(billId: string) {
    setError('')
    setMsg('')
    const r = await apiGet<BillDetail>('/api/admin/bills/' + billId)
    if (!r.ok) return setError(r.error)
    setEditBill(r.data)
    setEditItems(r.data.items ?? [])
    setEditDueDate(r.data.dueDate)
    setEditRemark('')
  }

  async function loadContractsForImport() {
    const r = await apiGet<{ items: ContractOption[] }>('/api/admin/contracts')
    if (!r.ok) return setError(r.error)
    setContracts(r.data.items.filter((c) => c.status === 'ACTIVE'))
    if (!importContractId && r.data.items.length > 0) setImportContractId(r.data.items[0].id)
  }

  function openImport() {
    setImportOpen(true)
    setFileImportResult(null)
    setImportContractId('')
    const y = new Date().getFullYear()
    const m = String(new Date().getMonth() + 1).padStart(2, '0')
    setImportPeriod(current?.period ?? `${y}-${m}`)
    setImportDueDate(`${y}-${m}-01`)
    setImportItems(DEFAULT_FEE_NAMES.map((name) => ({ name, amount: 0 })))
    loadContractsForImport()
  }

  async function submitImport() {
    const contract = contracts.find((c) => c.id === importContractId)
    if (!contract) return setError('请选择合同')
    const itemsToSend = importItems.filter((i) => i.amount > 0)
    if (itemsToSend.length === 0) return setError('请至少填写一项金额大于 0 的收费项目')
    setImportSubmitting(true)
    setError('')
    const r = await apiPost<{ ok: true; id: string }>('/api/admin/bills', {
      contractId: importContractId,
      period: importPeriod,
      dueDate: importDueDate,
      items: itemsToSend,
    })
    setImportSubmitting(false)
    if (!r.ok) return setError(r.error)
    setMsg('账单导入成功')
    setImportOpen(false)
    if (current) {
      const rr = await apiGet<{ items: BillListItem[]; locked: boolean }>(`/api/admin/bill-periods/${current.storeId}/${current.period}`)
      if (rr.ok) setDetailItems(rr.data.items ?? [])
    } else {
      loadSummaries()
    }
  }

  async function downloadTemplate() {
    const token = getAdminToken()
    const res = await fetch('/api/admin/bills/import-template', {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) return setError('下载模板失败')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '账单导入模板.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function uploadFile(file: File) {
    setFileImportSubmitting(true)
    setFileImportResult(null)
    setError('')
    const form = new FormData()
    form.append('file', file)
    const token = getAdminToken()
    const res = await fetch('/api/admin/bills/import', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
    const data = await res.json().catch(() => ({}))
    setFileImportSubmitting(false)
    if (!res.ok) {
      setError(data.error || '导入失败')
      return
    }
    setFileImportResult({ created: data.created ?? 0, errors: data.errors ?? [] })
    if (data.created > 0) {
      setMsg(`成功导入 ${data.created} 条账单`)
      if (current) {
        const rr = await apiGet<{ items: BillListItem[]; locked: boolean }>(`/api/admin/bill-periods/${current.storeId}/${current.period}`)
        if (rr.ok) setDetailItems(rr.data.items ?? [])
      } else {
        loadSummaries()
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function openOfflineVerify(b: BillListItem) {
    setError('')
    setMsg('')
    setOfflineVerifyBill(b)
    setOfflineVerifyRemark('')
    setOfflineVerifyFiles([])
    if (offlineVerifyFileInputRef.current) offlineVerifyFileInputRef.current.value = ''
  }

  async function submitOfflineVerify() {
    if (!offlineVerifyBill) return
    setOfflineVerifySubmitting(true)
    setError('')
    setMsg('')
    const fd = new FormData()
    fd.append('remark', offlineVerifyRemark.trim())
    offlineVerifyFiles.forEach((f) => fd.append('files', f))
    const token = getAdminToken()
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(`/api/admin/bills/${offlineVerifyBill.id}/offline-verify`, {
      method: 'POST',
      headers,
      body: fd,
    })
    const data = await res.json().catch(() => ({}))
    setOfflineVerifySubmitting(false)
    if (!res.ok) return setError(data.error || '线下核销失败')
    setMsg('线下核销成功，账单已结清')
    setOfflineVerifyBill(null)
    if (current) {
      const rr = await apiGet<{ items: BillListItem[]; locked: boolean }>(`/api/admin/bill-periods/${current.storeId}/${current.period}`)
      if (rr.ok) setDetailItems(rr.data.items ?? [])
    } else {
      loadSummaries()
    }
    if (detailBill?.id === offlineVerifyBill.id) loadDetail(offlineVerifyBill.id)
  }

  const importTotal = useMemo(() => importItems.reduce((s, i) => s + i.amount, 0), [importItems])
  const filteredDetailItems = useMemo(() => {
    const kw = detailKeyword.trim().toLowerCase()
    return detailItems.filter((b) => {
      if (detailStatus && b.status !== detailStatus) return false
      if (detailDueDateFrom && b.dueDate < detailDueDateFrom) return false
      if (detailDueDateTo && b.dueDate > detailDueDateTo) return false
      if (!kw) return true
      const hay = [
        formatBillNo(b.id),
        formatContractNo(b.contractNo),
        b.houseBizId,
        b.apartmentName,
        b.houseNo,
        b.tenantName,
        b.tenantPhone,
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(kw)
    })
  }, [detailItems, detailKeyword, detailStatus, detailDueDateFrom, detailDueDateTo])

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">账单管理</div>
        <div className="a-muted">
          一级页面按「门店 + 账期」汇总展示应收数据；点击查看详情进入二级页面查看本期各合同账单明细。账期一旦锁定将不可解锁，且该账期不允许再导入/新增账单。
          新开合同会按租期自动预生成每月租金账单；若需提前生成某月，可点击右上角「新建账期」走手动创建。
        </div>
      </div>

      {error ? <div className="a-card a-error">操作失败：{error}</div> : null}
      {msg ? <div className="a-card a-success">{msg}</div> : null}

      {mode === 'summary' ? (
        <>
          <div className="a-card a-row" style={{ justifyContent: 'space-between' }}>
            <div className="a-filterbar" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span className="a-filter-label">筛选</span>
              <input
                className="a-filter-input"
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1) }}
                placeholder="搜索：门店/账期"
                style={{ minWidth: 180 }}
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
                value={periodFilter}
                onChange={(e) => { setPeriodFilter(e.target.value); setPage(1) }}
                title="账期"
              >
                <option value="">全部账期</option>
                {filterOptions.periods.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button className="a-btn ghost" onClick={() => setPage(1)} title="使用当前筛选条件进行查询">
                查询
              </button>
              <button className="a-btn ghost" onClick={resetBillSummaryFilters} title="清空筛选条件">
                重置
              </button>
              <span className="a-muted">共 {filteredSummaries.length} 期</span>
            </div>
            <div className="a-row" style={{ gap: 8 }}>
              <button className="a-btn" onClick={openCreatePeriodModal}>
                新建账期
              </button>
              <button className="a-btn ghost" onClick={exportSelectedPeriod}>
                导出
              </button>
              <button className="a-btn ghost" onClick={loadSummaries}>
                刷新
              </button>
            </div>
          </div>

          <div className="a-card">
            <div className="a-table-wrap">
            <table className="a-table a-table-sticky-op">
              <thead>
                <tr>
                  <th style={{ width: 42 }}>
                    <input
                      type="checkbox"
                      checked={pageData.items.length > 0 && pageData.items.every((s) => selectedKeys.has(`${s.storeId}__${s.period}`))}
                      onChange={(e) => {
                        const next = new Set(selectedKeys)
                        for (const s of pageData.items) {
                          const k = `${s.storeId}__${s.period}`
                          if (e.target.checked) next.add(k)
                          else next.delete(k)
                        }
                        setSelectedKeys(next)
                      }}
                      aria-label="全选当前页"
                    />
                  </th>
                  <th>账期</th>
                  <th>门店</th>
                  <th>合同数</th>
                  <th>账单数</th>
                  <th>应收金额</th>
                  <th>统计范围（到期日）</th>
                  <th>状态</th>
                  <th className="a-op-col">操作</th>
                </tr>
              </thead>
              <tbody>
                {pageData.items.map((s) => {
                  const k = `${s.storeId}__${s.period}`
                  return (
                    <tr key={k}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(k)}
                          onChange={(e) => {
                            const next = new Set(selectedKeys)
                            if (e.target.checked) next.add(k)
                            else next.delete(k)
                            setSelectedKeys(next)
                          }}
                          aria-label="选择该账期"
                        />
                      </td>
                      <td style={{ fontWeight: 900 }}>{s.period}</td>
                      <td className="a-muted">{s.storeName}</td>
                      <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{s.contractCount}</td>
                      <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{s.billCount}</td>
                      <td style={{ fontWeight: 900 }}>¥{s.totalAmount}</td>
                      <td className="a-muted" style={{ whiteSpace: 'nowrap' }}>{s.dueDateFrom} ~ {s.dueDateTo}</td>
                      <td>
                        {s.locked ? (
                          <span className="a-badge status-paid" title={s.lockedAt ? `锁定时间：${s.lockedAt}` : undefined}>已锁定</span>
                        ) : (
                          <span className="a-badge status-unpaid">未锁定</span>
                        )}
                      </td>
                      <td className="a-op-cell">
                        <div className="a-op-actions">
                          <button className="a-btn ghost" onClick={() => openDetail(s)}>
                            查看详情
                          </button>
                          {!s.locked ? (
                            <button className="a-btn ghost" onClick={() => lockPeriod(s)}>
                              锁定
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {summaries.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="a-muted">
                      暂无账单汇总数据。生成合同后会自动生成对应账期的租金账单，也可在二级页面导入账单。
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
        </>
      ) : (
        <>
          <div className="a-card a-row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div className="a-h2" style={{ margin: 0 }}>
                二级明细 · {current?.storeName} · {current?.period}
              </div>
              <div className="a-muted" style={{ marginTop: 6 }}>
                {current?.locked ? '该账期已锁定：不可再导入/新增账单。' : '该账期未锁定：可导入/新增账单。'}
              </div>
            </div>
            <div className="a-row" style={{ gap: 8 }}>
              <button className="a-btn ghost" onClick={backToSummary}>
                返回
              </button>
              <button className="a-btn ghost" onClick={downloadTemplate}>
                下载导入模板
              </button>
              <button className="a-btn" onClick={openImport} disabled={Boolean(current?.locked)}>
                导入账单
              </button>
            </div>
          </div>

          <div className="a-card">
            <div className="a-filterbar" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <span className="a-filter-label">筛选</span>
              <input
                className="a-filter-input"
                value={detailKeywordInput}
                onChange={(e) => setDetailKeywordInput(e.target.value)}
                placeholder="账单编号/合同/房源ID/公寓/房号/租客/手机号"
                style={{ minWidth: 320 }}
              />
              <select
                className="a-filter-select"
                value={detailStatusInput}
                onChange={(e) => setDetailStatusInput(e.target.value)}
                title="支付状态"
              >
                <option value="">全部状态</option>
                <option value="UNPAID">未支付</option>
                <option value="PAID">已支付</option>
                <option value="OVERDUE">已逾期</option>
              </select>
              <input
                className="a-filter-input"
                type="date"
                value={detailDueDateFromInput}
                onChange={(e) => setDetailDueDateFromInput(e.target.value)}
                title="到期日开始"
              />
              <span className="a-muted">至</span>
              <input
                className="a-filter-input"
                type="date"
                value={detailDueDateToInput}
                onChange={(e) => setDetailDueDateToInput(e.target.value)}
                title="到期日结束"
              />
              <button className="a-btn ghost" onClick={searchDetailItems}>
                搜索
              </button>
              <button className="a-btn ghost" onClick={resetDetailFilters}>
                重置
              </button>
              <span className="a-muted">共 {filteredDetailItems.length} 条</span>
            </div>
            <div className="a-table-wrap">
            <table className="a-table a-table-sticky-op">
              <thead>
                <tr>
                  <th>账单编号</th>
                  <th>合同</th>
                  <th>房源ID</th>
                  <th>公寓</th>
                  <th>房号</th>
                  <th>租客</th>
                  <th>手机号</th>
                  <th>到期日</th>
                  <th>金额</th>
                  <th>状态</th>
                  <th className="a-op-col">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredDetailItems.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatBillNo(b.id)}</td>
                    <td style={{ fontWeight: 700 }}>{formatContractNo(b.contractNo)}</td>
                    <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{b.houseBizId}</td>
                    <td className="a-muted">{b.apartmentName}</td>
                    <td style={{ fontWeight: 700 }}>{b.houseNo}</td>
                    <td>{b.tenantName}</td>
                    <td className="a-muted">{b.tenantPhone}</td>
                    <td>{b.dueDate}</td>
                    <td style={{ fontWeight: 900 }}>¥{b.totalAmount}</td>
                    <td>
                      <span className={statusBadgeClass(b.status)}>{STATUS_ZH[b.status] ?? b.status}</span>
                    </td>
                    <td className="a-op-cell">
                      <div className="a-op-actions">
                        <button
                          className="a-btn ghost"
                          onClick={() => loadDetail(b.id)}
                          disabled={detailLoadingId === b.id}
                        >
                          {detailLoadingId === b.id ? '加载中…' : '查看详情'}
                        </button>
                        <button
                          className="a-btn ghost"
                          onClick={() => openEdit(b.id)}
                        >
                          修改
                        </button>
                        {b.status !== 'PAID' ? (
                          <button className="a-btn ghost" onClick={() => openOfflineVerify(b)}>
                            线下核销
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredDetailItems.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="a-muted">该账期暂无账单明细。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      {/* 新建账期 */}
      {createPeriodOpen && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && !createPeriodSubmitting && setCreatePeriodOpen(false)}
        >
          <div className="a-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">新建账期</div>
              <button type="button" className="a-modal-close" disabled={createPeriodSubmitting} onClick={() => setCreatePeriodOpen(false)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-muted" style={{ marginBottom: 12, fontSize: 13, lineHeight: 1.55 }}>
                <strong>系统自动：</strong>合同生效时会按租期逐月预生成「租金」BASE 账单。
                <br />
                <strong>手动创建：</strong>指定门店 + 年月，为租期覆盖该月的生效合同补建缺失账单（不覆盖已有账单）。
              </div>

              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">门店</div>
                  <div className="a-kv-v">
                    <select
                      className="a-filter-select"
                      style={{ minWidth: 260 }}
                      value={manualStoreId}
                      onChange={(e) => setManualStoreId(e.target.value)}
                      disabled={createPeriodSubmitting || storesForCreate.length === 0}
                    >
                      <option value="">请选择门店</option>
                      {storesForCreate.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">账期</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="month"
                      value={manualPeriod}
                      onChange={(e) => setManualPeriod(e.target.value)}
                      disabled={createPeriodSubmitting}
                    />
                    <span className="a-muted" style={{ marginLeft: 8 }}>格式：2027-02</span>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">开始统计时间</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="date"
                      value={manualStatStartDate}
                      onChange={(e) => setManualStatStartDate(e.target.value)}
                      disabled={createPeriodSubmitting}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">到期日（可选）</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="date"
                      value={manualDueDate}
                      onChange={(e) => setManualDueDate(e.target.value)}
                      disabled={createPeriodSubmitting}
                    />
                    <span className="a-muted" style={{ marginLeft: 8 }}>不填则默认该月 1 号</span>
                  </div>
                </div>
              </div>
              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <button type="button" className="a-btn" disabled={createPeriodSubmitting} onClick={submitCreatePeriodManual}>
                  {createPeriodSubmitting ? '执行中…' : '生成该账期账单'}
                </button>
                <button type="button" className="a-btn ghost" disabled={createPeriodSubmitting} onClick={() => setCreatePeriodOpen(false)}>
                  取消
                </button>
              </div>

              {createPeriodResult ? (
                <div className="a-muted" style={{ marginTop: 14, fontSize: 13, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>上次执行结果</div>
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                    <li>新建账单：{String(createPeriodResult.created ?? 0)} 条</li>
                    <li>已有账单跳过：{String(createPeriodResult.skippedExisting ?? 0)} 条</li>
                    <li>不在租期内跳过：{String(createPeriodResult.skippedOutOfLease ?? 0)} 个合同</li>
                    <li>扫描合同数：{String(createPeriodResult.contractsScanned ?? 0)}</li>
                    <li>统计开始时间：{String(createPeriodResult.statStartDate ?? '未提供')}</li>
                    <li>统计结束时间：{String(createPeriodResult.dueDate ?? '未提供')}</li>
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* 账单详情弹窗（复用原能力） */}
      {detailBill && (
        <div className="a-modal-backdrop" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setDetailBill(null)}>
          <div className="a-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">账单详情 · {formatContractNo(detailBill.contractNo)} {detailBill.period}</div>
              <button className="a-modal-close" onClick={() => setDetailBill(null)}>关闭</button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv">
                <div className="a-kv-row"><div className="a-kv-k">账单编号</div><div className="a-kv-v">{formatBillNo(detailBill.id)}</div></div>
                <div className="a-kv-row"><div className="a-kv-k">账期</div><div className="a-kv-v">{detailBill.period}</div></div>
                <div className="a-kv-row"><div className="a-kv-k">到期日</div><div className="a-kv-v">{detailBill.dueDate}</div></div>
                <div className="a-kv-row"><div className="a-kv-k">账单生成时间</div><div className="a-kv-v">{new Date(detailBill.createdAt).toLocaleString('zh-CN', { hour12: false })}</div></div>
                <div className="a-kv-row"><div className="a-kv-k">房源</div><div className="a-kv-v">{detailBill.apartmentName} {detailBill.houseNo}（{detailBill.storeName}）</div></div>
                <div className="a-kv-row"><div className="a-kv-k">租客</div><div className="a-kv-v">{detailBill.tenantName} {detailBill.tenantPhone}</div></div>
                <div className="a-kv-row">
                  <div className="a-kv-k">支付状态</div>
                  <div className="a-kv-v">
                    <span className={statusBadgeClass(detailBill.status)}>{STATUS_ZH[detailBill.status] ?? detailBill.status}</span>
                    {detailBill.paidAt ? (
                      <span className="a-muted" style={{ marginLeft: 8 }}>
                        支付时间：{new Date(detailBill.paidAt).toLocaleString('zh-CN', { hour12: false })}
                      </span>
                    ) : null}
                  </div>
                </div>
                {detailBill.offlineVerifiedAt ? (
                  <div className="a-kv-row">
                    <div className="a-kv-k">线下核销</div>
                    <div className="a-kv-v">
                      <span style={{ fontWeight: 700, color: '#0f766e' }}>已核销</span>
                      <span className="a-muted" style={{ marginLeft: 8 }}>
                        核销时间：{new Date(detailBill.offlineVerifiedAt).toLocaleString('zh-CN', { hour12: false })}
                      </span>
                      {detailBill.offlineVerifiedRemark ? (
                        <div className="a-muted" style={{ marginTop: 6 }}>备注：{detailBill.offlineVerifiedRemark}</div>
                      ) : null}
                      {(detailBill.offlineVerifyAttachments?.length ?? 0) > 0 ? (
                        <div className="a-row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                          {detailBill.offlineVerifyAttachments?.map((a) => (
                            <a key={a.id} className="a-btn ghost" href={a.previewUrl} target="_blank" rel="noreferrer">
                              凭证：{a.name}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <div style={{ marginTop: 12, fontWeight: 700, color: '#475569' }}>收费明细</div>
              <div className="a-kv" style={{ marginTop: 6 }}>
                {detailBill.items.map((it, i) => (
                  <div key={i} className="a-kv-row">
                    <div className="a-kv-k">{it.name}</div>
                    <div className="a-kv-v">¥{it.amount}</div>
                  </div>
                ))}
                {detailBill.items.length === 0 ? (
                  <>
                    {FEE_ITEM_NAMES.map((name) => (
                      <div key={name} className="a-kv-row">
                        <div className="a-kv-k">{name}</div>
                        <div className="a-kv-v">¥0</div>
                      </div>
                    ))}
                  </>
                ) : null}
                <div className="a-kv-row" style={{ borderTop: '2px solid #e2e8f0', fontWeight: 800 }}>
                  <div className="a-kv-k">总费用</div>
                  <div className="a-kv-v">¥{detailBill.totalAmount}</div>
                </div>
              </div>

              {detailBill.changeLogs && detailBill.changeLogs.length > 0 && (
                <>
                  <div style={{ marginTop: 18, fontWeight: 700, color: '#475569' }}>变更记录（仅展示近 10 条）</div>
                  <div style={{ marginTop: 8, maxHeight: 220, overflow: 'auto' }}>
                    <div className="a-table-wrap">
                    <table className="a-table" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 150 }}>变更时间</th>
                          <th style={{ width: 80 }}>操作人</th>
                          <th>变更前</th>
                          <th>变更后</th>
                          <th style={{ width: 140 }}>备注</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailBill.changeLogs.slice(0, 10).map((c) => {
                          let before: any = {}
                          let after: any = {}
                          try { before = JSON.parse(c.beforeJson || '{}') } catch { /* ignore */ }
                          try { after = JSON.parse(c.afterJson || '{}') } catch { /* ignore */ }
                          const bItems = Array.isArray(before.items) ? before.items : []
                          const aItems = Array.isArray(after.items) ? after.items : []
                          const beforeSummary = `到期日：${before.dueDate ?? '—'}；总额：¥${before.totalAmount ?? '—'}；明细：${bItems
                            .map((it: any) => `${it.name}:${it.amount}`)
                            .join('、')}`
                          const afterSummary = `到期日：${after.dueDate ?? '—'}；总额：¥${after.totalAmount ?? '—'}；明细：${aItems
                            .map((it: any) => `${it.name}:${it.amount}`)
                            .join('、')}`
                          return (
                            <tr key={c.id}>
                              <td className="a-muted">
                                {new Date(c.changedAt).toLocaleString('zh-CN', { hour12: false })}
                              </td>
                              <td>{c.adminName}</td>
                              <td className="a-muted">{beforeSummary}</td>
                              <td className="a-muted">{afterSummary}</td>
                              <td className="a-muted">{c.remark || '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 导入账单弹窗（复用原能力） */}
      {importOpen && (
        <div className="a-modal-backdrop" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setImportOpen(false)}>
          <div className="a-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">导入账单</div>
              <button className="a-modal-close" onClick={() => setImportOpen(false)}>关闭</button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div style={{ fontWeight: 700, color: '#475569', marginBottom: 8 }}>通过 Excel 文件导入</div>
              <div className="a-row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                <button type="button" className="a-btn ghost" onClick={downloadTemplate}>下载导入模板</button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) uploadFile(f)
                  }}
                />
                <button type="button" className="a-btn ghost" onClick={() => fileInputRef.current?.click()} disabled={fileImportSubmitting}>
                  {fileImportSubmitting ? '导入中…' : '选择文件并导入'}
                </button>
              </div>
              {fileImportResult ? (
                <div className="a-muted" style={{ marginBottom: 14, fontSize: 13 }}>
                  {fileImportResult.created > 0 ? <div>成功导入 {fileImportResult.created} 条</div> : null}
                  {fileImportResult.errors.length > 0 ? (
                    <div style={{ color: '#b91c1c', marginTop: 4 }}>
                      {fileImportResult.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
                      {fileImportResult.errors.length > 5 ? <div>…等共 {fileImportResult.errors.length} 条提示</div> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14, marginTop: 6 }}>
                <div style={{ fontWeight: 700, color: '#475569', marginBottom: 8 }}>手动填写导入</div>
              </div>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">选择合同</div>
                  <div className="a-kv-v">
                    <select className="a-filter-select" value={importContractId} onChange={(e) => setImportContractId(e.target.value)} style={{ minWidth: 260 }}>
                      <option value="">请选择合同</option>
                      {contracts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {formatContractNo(c.contractNo)} · {c.house.apartmentName} {c.house.houseNo} · {c.tenant.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">账期</div>
                  <div className="a-kv-v">
                    <input className="a-filter-input" type="month" value={importPeriod} onChange={(e) => setImportPeriod(e.target.value)} />
                    <span className="a-muted" style={{ marginLeft: 8 }}>格式：2026-04</span>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">到期日</div>
                  <div className="a-kv-v">
                    <input className="a-filter-input" type="date" value={importDueDate} onChange={(e) => setImportDueDate(e.target.value)} />
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, fontWeight: 700, color: '#475569' }}>收费项目（金额为 0 的项不会导入）</div>
              <div className="a-kv" style={{ marginTop: 6 }}>
                {importItems.map((item, i) => (
                  <div key={i} className="a-kv-row">
                    <div className="a-kv-k">{item.name}</div>
                    <div className="a-kv-v">
                      <input
                        className="a-filter-input"
                        type="number"
                        min={0}
                        style={{ width: 120 }}
                        value={item.amount || ''}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10)
                          setImportItems((prev) => prev.map((p, j) => (j === i ? { ...p, amount: Number.isNaN(v) ? 0 : v } : p)))
                        }}
                      />
                      <span className="a-muted"> 元</span>
                    </div>
                  </div>
                ))}
                <div className="a-kv-row" style={{ borderTop: '2px solid #e2e8f0', fontWeight: 800 }}>
                  <div className="a-kv-k">合计</div>
                  <div className="a-kv-v">¥{importTotal}</div>
                </div>
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
                <button className="a-btn" onClick={submitImport} disabled={importSubmitting || importTotal <= 0}>
                  {importSubmitting ? '提交中…' : '确认导入'}
                </button>
                <button className="a-btn ghost" onClick={() => setImportOpen(false)}>取消</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 线下核销弹窗 */}
      {offlineVerifyBill && (
        <div className="a-modal-backdrop" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setOfflineVerifyBill(null)}>
          <div className="a-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">线下核销 · {formatContractNo(offlineVerifyBill.contractNo)} {offlineVerifyBill.period}</div>
              <button className="a-modal-close" onClick={() => setOfflineVerifyBill(null)}>关闭</button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-muted" style={{ marginBottom: 10 }}>
                用于租客线下转账/现金收款的场景。提交后该账单将被标记为「已支付」。
              </div>
              <div className="a-kv">
                <div className="a-kv-row"><div className="a-kv-k">金额</div><div className="a-kv-v">¥{offlineVerifyBill.totalAmount}</div></div>
                <div className="a-kv-row">
                  <div className="a-kv-k">备注</div>
                  <div className="a-kv-v">
                    <textarea className="a-filter-input" value={offlineVerifyRemark} onChange={(e) => setOfflineVerifyRemark(e.target.value)} placeholder="可选：收款方式/流水号/说明" style={{ width: '100%', minHeight: 72, resize: 'vertical' }} />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">凭证附件</div>
                  <div className="a-kv-v">
                    <input
                      ref={offlineVerifyFileInputRef}
                      type="file"
                      multiple
                      accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                      style={{ display: 'none' }}
                      onChange={(e) => setOfflineVerifyFiles(Array.from(e.target.files ?? []).slice(0, 5))}
                    />
                    <div className="a-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <button type="button" className="a-btn ghost" onClick={() => offlineVerifyFileInputRef.current?.click()} disabled={offlineVerifySubmitting}>
                        选择文件（最多 5 个）
                      </button>
                      {offlineVerifyFiles.length > 0 ? (
                        <button
                          type="button"
                          className="a-btn ghost"
                          onClick={() => {
                            setOfflineVerifyFiles([])
                            if (offlineVerifyFileInputRef.current) offlineVerifyFileInputRef.current.value = ''
                          }}
                          disabled={offlineVerifySubmitting}
                        >
                          清空
                        </button>
                      ) : null}
                    </div>
                    {offlineVerifyFiles.length > 0 ? (
                      <div className="a-muted" style={{ marginTop: 8, fontSize: 13 }}>
                        {offlineVerifyFiles.map((f, i) => <div key={`${f.name}-${i}`}>{f.name}</div>)}
                      </div>
                    ) : (
                      <div className="a-muted" style={{ marginTop: 8, fontSize: 13 }}>可不上传，但建议上传转账截图/收据等作为佐证。</div>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
                <button className="a-btn" onClick={submitOfflineVerify} disabled={offlineVerifySubmitting}>
                  {offlineVerifySubmitting ? '提交中…' : '确认核销'}
                </button>
                <button className="a-btn ghost" onClick={() => setOfflineVerifyBill(null)} disabled={offlineVerifySubmitting}>取消</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 修改账单弹窗 */}
      {editBill && (
        <div className="a-modal-backdrop" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setEditBill(null)}>
          <div className="a-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">修改账单 · {formatContractNo(editBill.contractNo)} {editBill.period}</div>
              <button className="a-modal-close" onClick={() => setEditBill(null)}>关闭</button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">账单编号</div>
                  <div className="a-kv-v">{formatBillNo(editBill.id)}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">到期日</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="date"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, fontWeight: 700, color: '#475569' }}>收费明细（总额自动按明细合计）</div>
              <div className="a-kv" style={{ marginTop: 6 }}>
                {editItems.map((item, i) => (
                  <div key={i} className="a-kv-row">
                    <div className="a-kv-k">{item.name}</div>
                    <div className="a-kv-v">
                      <input
                        className="a-filter-input"
                        type="number"
                        min={0}
                        style={{ width: 120 }}
                        value={item.amount || ''}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10)
                          setEditItems((prev) =>
                            prev.map((p, j) => (j === i ? { ...p, amount: Number.isNaN(v) ? 0 : v } : p)),
                          )
                        }}
                      />
                      <span className="a-muted"> 元</span>
                    </div>
                  </div>
                ))}
                <div className="a-kv-row" style={{ borderTop: '2px solid #e2e8f0', fontWeight: 800 }}>
                  <div className="a-kv-k">合计</div>
                  <div className="a-kv-v">
                    ¥{editItems.reduce((s, i) => s + (i.amount || 0), 0)}
                  </div>
                </div>
              </div>
              <div className="a-kv" style={{ marginTop: 10 }}>
                <div className="a-kv-row">
                  <div className="a-kv-k">变更备注</div>
                  <div className="a-kv-v">
                    <textarea
                      className="a-filter-input"
                      value={editRemark}
                      onChange={(e) => setEditRemark(e.target.value)}
                      placeholder="必填：说明本次调整原因，方便审计追溯"
                      style={{ width: '100%', minHeight: 72, resize: 'vertical' }}
                    />
                  </div>
                </div>
              </div>
              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <button
                  className="a-btn"
                  disabled={editSubmitting || !editDueDate || !editRemark.trim()}
                  onClick={async () => {
                    if (!editBill) return
                    setEditSubmitting(true)
                    setError('')
                    setMsg('')
                    const body = {
                      dueDate: editDueDate,
                      items: editItems,
                      remark: editRemark.trim(),
                    }
                    const r = await apiPost<{ ok: true; id: string; totalAmount: number; dueDate: string }>(
                      `/api/admin/bills/${editBill.id}`,
                      body,
                      { method: 'PATCH' as any },
                    )
                    setEditSubmitting(false)
                    if (!r.ok) {
                      setError(r.error)
                      return
                    }
                    setMsg('账单已修改并记录变更日志')
                    setEditBill(null)
                    if (current) {
                      const rr = await apiGet<{ items: BillListItem[]; locked: boolean }>(
                        `/api/admin/bill-periods/${current.storeId}/${current.period}`,
                      )
                      if (rr.ok) setDetailItems(rr.data.items ?? [])
                    }
                    if (detailBill?.id === editBill.id) {
                      loadDetail(editBill.id)
                    }
                  }}
                >
                  {editSubmitting ? '保存中…' : '保存修改'}
                </button>
                <button className="a-btn ghost" onClick={() => setEditBill(null)} disabled={editSubmitting}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
