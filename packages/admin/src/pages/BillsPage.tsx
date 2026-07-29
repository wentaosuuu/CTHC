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
  lockedByName?: string | null
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
  tenantIdNumber?: string
  period: string
  dueDate: string
  totalAmount: number
  amountReceived: number
  amountRemaining: number
  status: string
  billingRemark?: string | null
  contractBillingPaused?: boolean
  tenantPushStatus?: string
  tenantPushStatusLabel?: string
  billPushToTenant?: boolean
  items?: { name: string; amount: number }[]
}

type BillPaymentQr = {
  payUrl: string
  qrImageUrl: string
  billId: string
  period: string
  contractNo: string
  tenantName: string
  tenantPhone: string
  totalAmount: number
  amountRemaining: number
}

function guessMobilePayOrigin() {
  if (typeof window === 'undefined') return 'http://localhost:5173'
  const { protocol, hostname } = window.location
  const port = hostname === 'localhost' || hostname === '127.0.0.1' ? '5173' : window.location.port || '5173'
  return `${protocol}//${hostname}:${port}`
}

type BillDetail = BillListItem & {
  contractPrepayBalance?: number
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

type BillPeriodDetailResponse = {
  items: BillListItem[]
  locked: boolean
  lockedAt: string | null
  lockedByName: string | null
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

function formatLockAtDisplay(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
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

function statusBadgeForBill(b: Pick<BillListItem, 'status' | 'amountReceived'>) {
  if (b.status === 'PAID') return statusBadgeClass('PAID')
  if ((b.amountReceived ?? 0) > 0) return 'a-badge status-partial'
  return statusBadgeClass(b.status)
}

function statusLabelForBill(b: Pick<BillListItem, 'status' | 'amountReceived'>) {
  if (b.status === 'PAID') return STATUS_ZH.PAID
  if ((b.amountReceived ?? 0) > 0) return '部分收款'
  return STATUS_ZH[b.status] ?? b.status
}

const FEE_ITEM_NAMES = ['租金', '水费', '电费', '物业费', '垃圾处理费', '公摊电费', '燃气费', '网络费', '滞纳金', '其他费用']

const OFFLINE_VERIFY_CHANNELS = [
  { value: 'OFFLINE_QR', label: '线下扫码' },
  { value: 'TRANSFER', label: '转账' },
  { value: 'CASH', label: '现金' },
] as const

function todayYmd() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function defaultBillAssetName(b: Pick<BillListItem, 'apartmentName' | 'houseNo'>) {
  return [b.apartmentName, b.houseNo].filter(Boolean).join(' ')
}

function parseOfflineVerifyAmountInput(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n)
}

function offlineVerifyFieldLabel(label: string, required?: boolean, hint?: string) {
  return (
    <>
      {label}
      {required ? <span className="a-req-mark">*</span> : null}
      {hint ? (
        <div className="a-muted" style={{ fontSize: 12, fontWeight: 400, marginTop: 4 }}>
          {hint}
        </div>
      ) : null}
    </>
  )
}

function mergeFeeItemsForEdit(items: { name: string; amount: number }[]): { name: string; amount: number }[] {
  const map = new Map(items.map((i) => [i.name, i.amount]))
  const ordered = [...FEE_ITEM_NAMES]
  for (const name of map.keys()) {
    if (!ordered.includes(name)) ordered.push(name)
  }
  return ordered.map((name) => ({ name, amount: map.get(name) ?? 0 }))
}

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
  const [current, setCurrent] = useState<{ storeId: string; storeName: string; period: string; locked: boolean; lockedAt?: string | null; lockedByName?: string | null } | null>(null)
  const [detailItems, setDetailItems] = useState<BillListItem[]>([])
  const [detailKeywordInput, setDetailKeywordInput] = useState('')
  const [detailContractNoInput, setDetailContractNoInput] = useState('')
  const [detailTenantNameInput, setDetailTenantNameInput] = useState('')
  const [detailTenantIdInput, setDetailTenantIdInput] = useState('')
  const [detailTenantPhoneInput, setDetailTenantPhoneInput] = useState('')
  const [detailAssetNameInput, setDetailAssetNameInput] = useState('')
  const [detailStatusInput, setDetailStatusInput] = useState('')
  const [detailDueDateFromInput, setDetailDueDateFromInput] = useState('')
  const [detailDueDateToInput, setDetailDueDateToInput] = useState('')

  const [detailBill, setDetailBill] = useState<BillDetail | null>(null)
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null)

  // import (keep existing ability; server will reject if locked)
  const [importOpen, setImportOpen] = useState(false)
  const [contracts, setContracts] = useState<ContractOption[]>([])
  const [importContractId, setImportContractId] = useState('')
  const [importPeriod, setImportPeriod] = useState('')
  const [importDueDate, setImportDueDate] = useState('')
  const [importItems, setImportItems] = useState<{ name: string; amount: number }[]>(FEE_ITEM_NAMES.map((name) => ({ name, amount: 0 })))
  const [importSubmitting, setImportSubmitting] = useState(false)

  const [fileImportSubmitting, setFileImportSubmitting] = useState(false)
  const [fileImportResult, setFileImportResult] = useState<{ created: number; errors: string[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importBillingRemark, setImportBillingRemark] = useState('')
  const batchVerifyInputRef = useRef<HTMLInputElement>(null)
  const [batchVerifySubmitting, setBatchVerifySubmitting] = useState(false)
  const [batchVerifyResult, setBatchVerifyResult] = useState<{ verified: number; errors: string[] } | null>(null)

  // offline verify
  const [offlineVerifyBill, setOfflineVerifyBill] = useState<BillListItem | null>(null)
  const [offlineVerifyAmount, setOfflineVerifyAmount] = useState('')
  const [offlineVerifyChannel, setOfflineVerifyChannel] = useState<string>('TRANSFER')
  const [offlineVerifyDate, setOfflineVerifyDate] = useState(todayYmd)
  const [offlineVerifyAssetName, setOfflineVerifyAssetName] = useState('')
  const [offlineVerifyRemark, setOfflineVerifyRemark] = useState('')
  const [offlineVerifyFiles, setOfflineVerifyFiles] = useState<File[]>([])
  const [offlineVerifySubmitting, setOfflineVerifySubmitting] = useState(false)
  const offlineVerifyFileInputRef = useRef<HTMLInputElement>(null)

  const [editBill, setEditBill] = useState<BillDetail | null>(null)
  const [editItems, setEditItems] = useState<{ name: string; amount: number }[]>([])
  const [editDueDate, setEditDueDate] = useState('')
  const [editRemark, setEditRemark] = useState('')
  const [editBillingRemark, setEditBillingRemark] = useState('')
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

  const [payQrBillId, setPayQrBillId] = useState<string | null>(null)
  const [payQrData, setPayQrData] = useState<BillPaymentQr | null>(null)
  const [payQrLoading, setPayQrLoading] = useState(false)

  const [meRoleCode, setMeRoleCode] = useState<string | null>(null)
  const canEditBill = meRoleCode === 'SYSTEM_ADMIN'

  async function loadSummaries() {
    setError('')
    const r = await apiGet<{ items: BillPeriodSummary[] }>('/api/admin/bill-periods')
    if (!r.ok) return setError(r.error)
    setSummaries(r.data.items ?? [])
  }

  useEffect(() => {
    loadSummaries()
    apiGet<{ roleCode: string }>('/api/admin/me').then((r) => {
      if (r.ok) setMeRoleCode(r.data.roleCode)
    })
  }, [])

  function periodDetailFiltersFromInputs(): {
    keyword: string
    contractNo: string
    tenantName: string
    tenantIdNumber: string
    tenantPhone: string
    assetName: string
    status: string
    dueDateFrom: string
    dueDateTo: string
  } {
    return {
      keyword: detailKeywordInput,
      contractNo: detailContractNoInput,
      tenantName: detailTenantNameInput,
      tenantIdNumber: detailTenantIdInput,
      tenantPhone: detailTenantPhoneInput,
      assetName: detailAssetNameInput,
      status: detailStatusInput,
      dueDateFrom: detailDueDateFromInput,
      dueDateTo: detailDueDateToInput,
    }
  }

  async function loadPeriodBills(
    storeId: string,
    period: string,
    filters: {
      keyword?: string
      contractNo?: string
      tenantName?: string
      tenantIdNumber?: string
      tenantPhone?: string
      assetName?: string
      status?: string
      dueDateFrom?: string
      dueDateTo?: string
    } = {},
  ) {
    setError('')
    const p = new URLSearchParams()
    const qset = (k: string, v: string | undefined) => {
      const t = (v ?? '').trim()
      if (t) p.set(k, t)
    }
    qset('keyword', filters.keyword)
    qset('contractNo', filters.contractNo)
    qset('tenantName', filters.tenantName)
    qset('tenantIdNumber', filters.tenantIdNumber)
    qset('tenantPhone', filters.tenantPhone)
    qset('assetName', filters.assetName)
    qset('status', filters.status)
    qset('dueDateFrom', filters.dueDateFrom)
    qset('dueDateTo', filters.dueDateTo)
    const qs = p.toString()
    const url = `/api/admin/bill-periods/${storeId}/${period}${qs ? `?${qs}` : ''}`
    const r = await apiGet<BillPeriodDetailResponse>(url)
    if (!r.ok) {
      setError(r.error)
      return false
    }
    setDetailItems(r.data.items ?? [])
    setPayQrBillId(null)
    setPayQrData(null)
    setCurrent((prev) =>
      prev && prev.storeId === storeId && prev.period === period
        ? {
            ...prev,
            locked: Boolean(r.data.locked),
            lockedAt: r.data.lockedAt ?? null,
            lockedByName: r.data.lockedByName ?? null,
          }
        : prev,
    )
    return true
  }

  async function generatePaymentQr() {
    if (!payQrBillId) {
      setError('请先勾选一笔待付账单')
      return
    }
    const bill = detailItems.find((b) => b.id === payQrBillId)
    if (!bill) {
      setError('未找到所选账单')
      return
    }
    if (bill.status === 'PAID') {
      setError('该账单已支付，无法生成付款码')
      return
    }
    setPayQrLoading(true)
    setError('')
    setPayQrData(null)
    const r = await apiPost<BillPaymentQr>(`/api/admin/bills/${payQrBillId}/payment-qr`, {
      mobileOrigin: guessMobilePayOrigin(),
    })
    setPayQrLoading(false)
    if (!r.ok) return setError(r.error)
    setPayQrData(r.data)
  }

  async function openDetail(s: BillPeriodSummary) {
    setMode('detail')
    setCurrent({
      storeId: s.storeId,
      storeName: s.storeName,
      period: s.period,
      locked: s.locked,
      lockedAt: s.lockedAt ?? null,
      lockedByName: s.lockedByName ?? null,
    })
    setDetailItems([])
    setError('')
    setMsg('')
    setDetailKeywordInput('')
    setDetailContractNoInput('')
    setDetailTenantNameInput('')
    setDetailTenantIdInput('')
    setDetailTenantPhoneInput('')
    setDetailAssetNameInput('')
    setDetailStatusInput('')
    setDetailDueDateFromInput('')
    setDetailDueDateToInput('')
    setBatchVerifyResult(null)
    await loadPeriodBills(s.storeId, s.period, {})
  }

  async function backToSummary() {
    setMode('summary')
    setCurrent(null)
    setDetailItems([])
    setDetailBill(null)
    setOfflineVerifyBill(null)
    setDetailKeywordInput('')
    setDetailContractNoInput('')
    setDetailTenantNameInput('')
    setDetailTenantIdInput('')
    setDetailTenantPhoneInput('')
    setDetailAssetNameInput('')
    setDetailStatusInput('')
    setDetailDueDateFromInput('')
    setDetailDueDateToInput('')
    setBatchVerifyResult(null)
    await loadSummaries()
  }

  function searchDetailItems() {
    if (!current) return
    void loadPeriodBills(current.storeId, current.period, periodDetailFiltersFromInputs())
  }

  function resetDetailFilters() {
    setDetailKeywordInput('')
    setDetailContractNoInput('')
    setDetailTenantNameInput('')
    setDetailTenantIdInput('')
    setDetailTenantPhoneInput('')
    setDetailAssetNameInput('')
    setDetailStatusInput('')
    setDetailDueDateFromInput('')
    setDetailDueDateToInput('')
    if (current) void loadPeriodBills(current.storeId, current.period, {})
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
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setManualPeriod(today)
    setManualStatStartDate(today)
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(manualPeriod)) return setError('请选择正确的账期（精确到日）')
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
    const header = ['账单编号', '合同', '租客', '手机号', '公寓', '房号', '门店', '账期', '到期日', '应收金额', '已收金额', '待付金额', '状态', '明细']
    const lines = [
      header.map(csvEscape).join(','),
      ...rows.map((b) => {
        const itemsStr = (b.items ?? []).map((it) => `${it.name}:${it.amount}`).join('；')
        const recv = b.amountReceived ?? 0
        const rem = b.amountRemaining ?? Math.max(0, b.totalAmount - recv)
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
          recv,
          rem,
          statusLabelForBill(b),
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
    if (!canEditBill) return
    setError('')
    setMsg('')
    const r = await apiGet<BillDetail>('/api/admin/bills/' + billId)
    if (!r.ok) return setError(r.error)
    setEditBill(r.data)
    setEditItems(mergeFeeItemsForEdit(r.data.items ?? []))
    setEditDueDate(r.data.dueDate)
    setEditBillingRemark((r.data.billingRemark ?? '').trim())
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
    const d = String(new Date().getDate()).padStart(2, '0')
    const cur = current?.period ?? ''
    // 账期可选到日；若从月账期详情带入（YYYY-MM），默认补为当月 1 号
    setImportPeriod(/^\d{4}-\d{2}-\d{2}$/.test(cur) ? cur : /^\d{4}-\d{2}$/.test(cur) ? `${cur}-01` : `${y}-${m}-${d}`)
    setImportDueDate(/^\d{4}-\d{2}-\d{2}$/.test(cur) ? cur : /^\d{4}-\d{2}$/.test(cur) ? `${cur}-01` : `${y}-${m}-01`)
    setImportItems(FEE_ITEM_NAMES.map((name) => ({ name, amount: 0 })))
    setImportBillingRemark('')
    loadContractsForImport()
  }

  async function submitImport() {
    const contract = contracts.find((c) => c.id === importContractId)
    if (!contract) return setError('请选择合同')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(importPeriod)) return setError('请选择正确的账期（精确到日）')
    const itemsToSend = importItems.filter((i) => i.amount > 0)
    if (itemsToSend.length === 0) return setError('请至少填写一项金额大于 0 的收费项目')
    setImportSubmitting(true)
    setError('')
    const r = await apiPost<{ ok: true; id: string }>('/api/admin/bills', {
      contractId: importContractId,
      period: importPeriod,
      dueDate: importDueDate,
      items: itemsToSend,
      ...(importBillingRemark.trim() ? { billingRemark: importBillingRemark.trim().slice(0, 500) } : {}),
    })
    setImportSubmitting(false)
    if (!r.ok) return setError(r.error)
    setMsg('账单导入成功')
    setImportOpen(false)
    if (current) {
      await loadPeriodBills(current.storeId, current.period, periodDetailFiltersFromInputs())
    } else {
      loadSummaries()
    }
  }

  async function downloadBatchVerifyTemplate() {
    const token = getAdminToken()
    const res = await fetch('/api/admin/bills/offline-verify-batch-template', {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) return setError('下载批量核销模板失败')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '批量核销模板.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function uploadBatchVerifyFile(file: File) {
    if (!current) return
    setBatchVerifySubmitting(true)
    setBatchVerifyResult(null)
    setError('')
    const form = new FormData()
    form.append('file', file)
    const token = getAdminToken()
    const res = await fetch('/api/admin/bills/offline-verify-batch', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
    const data = await res.json().catch(() => ({}))
    setBatchVerifySubmitting(false)
    if (!res.ok) {
      setError(data.error || '批量核销失败')
      return
    }
    setBatchVerifyResult({ verified: data.verified ?? 0, errors: data.errors ?? [] })
    if (data.verified > 0) {
      setMsg(`批量核销成功 ${data.verified} 条`)
      await loadPeriodBills(current.storeId, current.period, periodDetailFiltersFromInputs())
    }
    if (batchVerifyInputRef.current) batchVerifyInputRef.current.value = ''
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
        await loadPeriodBills(current.storeId, current.period, periodDetailFiltersFromInputs())
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
    const rem = typeof b.amountRemaining === 'number' ? b.amountRemaining : Math.max(0, b.totalAmount - (b.amountReceived ?? 0))
    setOfflineVerifyAmount(rem > 0 ? rem.toFixed(2) : b.totalAmount.toFixed(2))
    setOfflineVerifyChannel('TRANSFER')
    setOfflineVerifyDate(todayYmd())
    setOfflineVerifyAssetName(defaultBillAssetName(b))
    setOfflineVerifyRemark('')
    setOfflineVerifyFiles([])
    if (offlineVerifyFileInputRef.current) offlineVerifyFileInputRef.current.value = ''
  }

  function offlineVerifyErrorText(code: string) {
    switch (code) {
      case 'INVALID_COLLECTION_CHANNEL':
        return '请选择收款渠道'
      case 'INVALID_COLLECTION_DATE':
        return '请填写收款日期（格式 YYYY-MM-DD）'
      case 'INVALID_AMOUNT':
        return '收款金额须为正数，最多保留 2 位小数，不可为 0'
      case 'ALREADY_PAID':
        return '该账单已结清'
      case 'INVALID_STATUS':
        return '当前账单状态不可核销'
      default:
        return code || '线下核销失败'
    }
  }

  async function submitOfflineVerify() {
    if (!offlineVerifyBill) return
    const amt = parseOfflineVerifyAmountInput(offlineVerifyAmount)
    if (amt === null) {
      setError('请填写收款金额：正数，保留 2 位小数，不可为 0')
      return
    }
    if (!OFFLINE_VERIFY_CHANNELS.some((c) => c.value === offlineVerifyChannel)) {
      setError('请选择收款渠道')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(offlineVerifyDate.trim())) {
      setError('请填写收款日期（格式 YYYY-MM-DD）')
      return
    }
    setOfflineVerifySubmitting(true)
    setError('')
    setMsg('')
    const fd = new FormData()
    fd.append('amount', offlineVerifyAmount.trim())
    fd.append('collectionChannel', offlineVerifyChannel)
    fd.append('collectionDate', offlineVerifyDate.trim())
    fd.append('assetName', offlineVerifyAssetName.trim())
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
    if (!res.ok) return setError(offlineVerifyErrorText(data.error))
    const prepaid = Number(data.prepaidCredited ?? 0)
    const st = String(data.status ?? '')
    const received = Number(data.amountReceived ?? 0)
    const remain = Number(data.amountRemaining ?? 0)
    let tip = st === 'PAID' ? '账单已全部结清。' : `账单仍待支付：已收 ¥${received}，尚欠 ¥${remain}。`
    if (prepaid > 0) tip += ` 超额 ¥${prepaid} 已记入「合同预收款」余额，可在侧栏「合同预收款」查看。`
    setMsg(tip)
    setOfflineVerifyBill(null)
    if (current) {
      await loadPeriodBills(current.storeId, current.period, periodDetailFiltersFromInputs())
    } else {
      loadSummaries()
    }
    if (detailBill?.id === offlineVerifyBill.id) loadDetail(offlineVerifyBill.id)
  }

  const importTotal = useMemo(() => importItems.reduce((s, i) => s + i.amount, 0), [importItems])

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
                  <th>锁定日期</th>
                  <th>操作人</th>
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
                      <td className="a-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {s.locked && s.lockedAt ? formatLockAtDisplay(s.lockedAt) : '—'}
                      </td>
                      <td className="a-muted" style={{ fontSize: 12 }}>
                        {s.locked ? (s.lockedByName ?? '—') : '—'}
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
                    <td colSpan={11} className="a-muted">
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
                {current?.locked ? (
                  <>
                    该账期已锁定：不可再导入/新增账单。
                    {current.lockedAt ? (
                      <span style={{ marginLeft: 8 }}>
                        锁定时间 {formatLockAtDisplay(current.lockedAt)}
                        {current.lockedByName ? ` · 操作人 ${current.lockedByName}` : ''}
                      </span>
                    ) : null}
                  </>
                ) : (
                  '该账期未锁定：可导入/新增账单。'
                )}
              </div>
            </div>
            <div className="a-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="a-btn ghost" onClick={backToSummary}>
                返回
              </button>
              <button className="a-btn ghost" onClick={downloadTemplate}>
                下载导入模板
              </button>
              <button className="a-btn ghost" onClick={downloadBatchVerifyTemplate}>
                下载批量核销模板
              </button>
              <input
                ref={batchVerifyInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void uploadBatchVerifyFile(f)
                }}
              />
              <button
                type="button"
                className="a-btn ghost"
                disabled={Boolean(current?.locked) || batchVerifySubmitting}
                onClick={() => batchVerifyInputRef.current?.click()}
              >
                {batchVerifySubmitting ? '批量核销中…' : '批量核销'}
              </button>
              <button className="a-btn" onClick={openImport} disabled={Boolean(current?.locked)}>
                导入账单
              </button>
              <button
                type="button"
                className="a-btn ghost"
                disabled={!payQrBillId || payQrLoading}
                onClick={() => void generatePaymentQr()}
              >
                {payQrLoading ? '生成中…' : '生成付款二维码'}
              </button>
            </div>
          </div>

          <div className="a-card">
            <div className="a-filterbar" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <span className="a-filter-label">筛选</span>
              <input
                className="a-filter-input"
                value={detailKeywordInput}
                onChange={(e) => setDetailKeywordInput(e.target.value)}
                placeholder="快速搜索（账单编号/合同/房源/租客/手机/证件号）"
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
              <span className="a-muted">共 {detailItems.length} 条</span>
            </div>
            <div className="a-filterbar" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <span className="a-filter-label">精确</span>
              <input
                className="a-filter-input"
                value={detailContractNoInput}
                onChange={(e) => setDetailContractNoInput(e.target.value)}
                placeholder="合同编号"
                style={{ minWidth: 140 }}
              />
              <input
                className="a-filter-input"
                value={detailTenantNameInput}
                onChange={(e) => setDetailTenantNameInput(e.target.value)}
                placeholder="租客名称"
                style={{ minWidth: 120 }}
              />
              <input
                className="a-filter-input"
                value={detailTenantIdInput}
                onChange={(e) => setDetailTenantIdInput(e.target.value)}
                placeholder="身份证号"
                style={{ minWidth: 160 }}
              />
              <input
                className="a-filter-input"
                value={detailTenantPhoneInput}
                onChange={(e) => setDetailTenantPhoneInput(e.target.value)}
                placeholder="手机号"
                style={{ minWidth: 120 }}
              />
              <input
                className="a-filter-input"
                value={detailAssetNameInput}
                onChange={(e) => setDetailAssetNameInput(e.target.value)}
                placeholder="资产名称（公寓/房号/项目）"
                style={{ minWidth: 220 }}
              />
            </div>
            {batchVerifyResult && (batchVerifyResult.errors.length > 0 || batchVerifyResult.verified > 0) ? (
              <div className="a-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                {batchVerifyResult.verified > 0 ? <div>本次成功核销 {batchVerifyResult.verified} 条</div> : null}
                {batchVerifyResult.errors.length > 0 ? (
                  <div style={{ color: '#b91c1c', marginTop: 4 }}>
                    {batchVerifyResult.errors.slice(0, 8).map((e, i) => (
                      <div key={i}>{e}</div>
                    ))}
                    {batchVerifyResult.errors.length > 8 ? <div>…等共 {batchVerifyResult.errors.length} 条提示</div> : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="a-table-wrap">
            <table className="a-table a-table-sticky-op">
              <thead>
                <tr>
                  <th style={{ width: 42 }} aria-label="选择" />
                  <th>账单编号</th>
                  <th>合同</th>
                  <th>房源ID</th>
                  <th>公寓</th>
                  <th>房号</th>
                  <th>租客</th>
                  <th>身份证</th>
                  <th>手机号</th>
                  <th>店长备注</th>
                  <th>到期日</th>
                  <th>应收</th>
                  <th>已收</th>
                  <th>待付</th>
                  <th>状态</th>
                  <th className="a-op-col">操作</th>
                </tr>
              </thead>
              <tbody>
                {detailItems.map((b) => (
                  <tr key={b.id}>
                    <td>
                      {b.status !== 'PAID' ? (
                        <input
                          type="checkbox"
                          checked={payQrBillId === b.id}
                          onChange={() => {
                            setPayQrBillId((prev) => (prev === b.id ? null : b.id))
                            setPayQrData(null)
                          }}
                          aria-label={`选择账单 ${formatBillNo(b.id)} 生成付款码`}
                        />
                      ) : (
                        <span className="a-muted">—</span>
                      )}
                    </td>
                    <td style={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatBillNo(b.id)}</td>
                    <td style={{ fontWeight: 700 }}>{formatContractNo(b.contractNo)}</td>
                    <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{b.houseBizId}</td>
                    <td className="a-muted">{b.apartmentName}</td>
                    <td style={{ fontWeight: 700 }}>{b.houseNo}</td>
                    <td>{b.tenantName}</td>
                    <td className="a-muted" style={{ fontSize: 12, maxWidth: 140, wordBreak: 'break-all' }}>{b.tenantIdNumber ?? '—'}</td>
                    <td className="a-muted">{b.tenantPhone}</td>
                    <td className="a-muted" style={{ fontSize: 12, maxWidth: 160 }} title={(b.billingRemark ?? '').trim() || undefined}>
                      {(b.billingRemark ?? '').trim() ? `${(b.billingRemark ?? '').trim().slice(0, 24)}${(b.billingRemark ?? '').trim().length > 24 ? '…' : ''}` : '—'}
                    </td>
                    <td>{b.dueDate}</td>
                    <td style={{ fontWeight: 900 }}>¥{b.totalAmount}</td>
                    <td className="a-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>¥{b.amountReceived ?? 0}</td>
                    <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: (b.amountRemaining ?? 0) > 0 ? '#b45309' : '#64748b' }}>
                      ¥{b.amountRemaining ?? 0}
                    </td>
                    <td>
                      <span className={statusBadgeForBill(b)}>{statusLabelForBill(b)}</span>
                      {b.contractBillingPaused ? (
                        <span className="a-badge status-wait-stamp" style={{ marginLeft: 6, fontSize: 11 }}>
                          暂停计费
                        </span>
                      ) : null}
                      {b.billPushToTenant && b.tenantPushStatus && b.tenantPushStatus !== 'SKIPPED' ? (
                        <span
                          className={
                            b.tenantPushStatus === 'PUSHED'
                              ? 'a-badge status-active'
                              : 'a-badge status-wait-sign'
                          }
                          style={{ marginLeft: 6, fontSize: 11 }}
                          title="南宁市房屋租赁合同 · 账单推送状态"
                        >
                          {b.tenantPushStatusLabel ?? b.tenantPushStatus}
                        </span>
                      ) : null}
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
                        {canEditBill ? (
                          <button className="a-btn ghost" onClick={() => openEdit(b.id)}>
                            修改
                          </button>
                        ) : null}
                        {b.status !== 'PAID' ? (
                          <button className="a-btn ghost" onClick={() => openOfflineVerify(b)}>
                            线下核销
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {detailItems.length === 0 ? (
                  <tr>
                    <td colSpan={16} className="a-muted">该账期暂无账单明细。</td>
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
                      type="date"
                      value={manualPeriod}
                      onChange={(e) => {
                        const v = e.target.value
                        setManualPeriod(v)
                        if (v) setManualStatStartDate(v)
                      }}
                      disabled={createPeriodSubmitting}
                    />
                    <span className="a-muted" style={{ marginLeft: 8 }}>格式：2027-02-01</span>
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
                    <span className="a-muted" style={{ marginLeft: 8 }}>不填则默认账期当日</span>
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
                <div className="a-kv-row">
                  <div className="a-kv-k">租客</div>
                  <div className="a-kv-v">
                    {[
                      (detailBill.tenantName ?? '').replace(/undefined/g, '').trim(),
                      (detailBill.tenantPhone ?? '').trim(),
                    ]
                      .filter(Boolean)
                      .join(' ') || '—'}
                  </div>
                </div>
                {detailBill.tenantIdNumber ? (
                  <div className="a-kv-row">
                    <div className="a-kv-k">证件号</div>
                    <div className="a-kv-v" style={{ wordBreak: 'break-all', fontSize: 13 }}>{detailBill.tenantIdNumber}</div>
                  </div>
                ) : null}
                <div className="a-kv-row">
                  <div className="a-kv-k">店长备注</div>
                  <div className="a-kv-v" style={{ whiteSpace: 'pre-wrap' }}>{(detailBill.billingRemark ?? '').trim() || '—'}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">支付状态</div>
                  <div className="a-kv-v">
                    <span className={statusBadgeForBill(detailBill)}>{statusLabelForBill(detailBill)}</span>
                    {detailBill.paidAt ? (
                      <span className="a-muted" style={{ marginLeft: 8 }}>
                        支付时间：{new Date(detailBill.paidAt).toLocaleString('zh-CN', { hour12: false })}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">已收 / 待付</div>
                  <div className="a-kv-v">
                    ¥{detailBill.amountReceived ?? 0} / 待付 ¥{detailBill.amountRemaining ?? Math.max(0, detailBill.totalAmount - (detailBill.amountReceived ?? 0))}
                  </div>
                </div>
                {typeof detailBill.contractPrepayBalance === 'number' && detailBill.contractPrepayBalance > 0 ? (
                  <div className="a-kv-row">
                    <div className="a-kv-k">合同预收余额</div>
                    <div className="a-kv-v" style={{ fontWeight: 800, color: '#0369a1' }}>
                      ¥{detailBill.contractPrepayBalance}（见侧栏「合同预收款」）
                    </div>
                  </div>
                ) : null}
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
                {mergeFeeItemsForEdit(detailBill.items ?? []).map((it) => (
                  <div key={it.name} className="a-kv-row">
                    <div className="a-kv-k">{it.name}</div>
                    <div className="a-kv-v">¥{it.amount}</div>
                  </div>
                ))}
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
                    <input className="a-filter-input" type="date" value={importPeriod} onChange={(e) => setImportPeriod(e.target.value)} />
                    <span className="a-muted" style={{ marginLeft: 8 }}>格式：2026-04-01</span>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">到期日</div>
                  <div className="a-kv-v">
                    <input className="a-filter-input" type="date" value={importDueDate} onChange={(e) => setImportDueDate(e.target.value)} />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">店长备注</div>
                  <div className="a-kv-v">
                    <textarea
                      className="a-filter-input"
                      value={importBillingRemark}
                      onChange={(e) => setImportBillingRemark(e.target.value)}
                      placeholder="可选：费用说明、对账说明等（与线下核销备注不同）"
                      style={{ width: '100%', minHeight: 64, resize: 'vertical' }}
                      maxLength={500}
                    />
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
          <div className="a-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">线下核销 · {formatContractNo(offlineVerifyBill.contractNo)} {offlineVerifyBill.period}</div>
              <button className="a-modal-close" onClick={() => setOfflineVerifyBill(null)}>关闭</button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                应收 ¥{offlineVerifyBill.totalAmount} · 已入账 ¥{offlineVerifyBill.amountReceived ?? 0} · 尚欠 ¥
                {offlineVerifyBill.amountRemaining ?? Math.max(0, offlineVerifyBill.totalAmount - (offlineVerifyBill.amountReceived ?? 0))}
                。收款小于尚欠时账单仍待支付；等于或大于时结清本期，超出部分记入「合同预收款」。
              </div>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">
                    {offlineVerifyFieldLabel('单元编号', true, '上级资产经营单元唯一编码')}
                  </div>
                  <div className="a-kv-v">{offlineVerifyBill.houseBizId || '—'}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">{offlineVerifyFieldLabel('资产名称')}</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      style={{ width: '100%' }}
                      value={offlineVerifyAssetName}
                      onChange={(e) => setOfflineVerifyAssetName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">
                    {offlineVerifyFieldLabel('合同编号', true, '系统内已生效的租赁合同编号')}
                  </div>
                  <div className="a-kv-v">{formatContractNo(offlineVerifyBill.contractNo)}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">
                    {offlineVerifyFieldLabel('租户名称', true, '合同对应的租户全称')}
                  </div>
                  <div className="a-kv-v">{offlineVerifyBill.tenantName || '—'}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">
                    {offlineVerifyFieldLabel('收款金额（元）', true, '正数，保留 2 位小数，不可为 0')}
                  </div>
                  <div className="a-kv-v">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="a-filter-input"
                      style={{ width: 160 }}
                      value={offlineVerifyAmount}
                      onChange={(e) => setOfflineVerifyAmount(e.target.value)}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">
                    {offlineVerifyFieldLabel('收款渠道', true, '线下扫码 / 转账 / 现金')}
                  </div>
                  <div className="a-kv-v">
                    <select className="a-filter-input" style={{ width: '100%' }} value={offlineVerifyChannel} onChange={(e) => setOfflineVerifyChannel(e.target.value)}>
                      {OFFLINE_VERIFY_CHANNELS.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">
                    {offlineVerifyFieldLabel('收款日期', true, '格式 YYYY-MM-DD，款项实际到账日期')}
                  </div>
                  <div className="a-kv-v">
                    <input
                      type="date"
                      className="a-filter-input"
                      style={{ width: 180 }}
                      value={offlineVerifyDate}
                      onChange={(e) => setOfflineVerifyDate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">
                    {offlineVerifyFieldLabel('对应账单编号', false, '不填则系统自动匹配该合同下最早的待核销账单')}
                  </div>
                  <div className="a-kv-v">{formatBillNo(offlineVerifyBill.id)}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">
                    {offlineVerifyFieldLabel('备注', false, '付款人与租户不一致、核销说明、其他补充信息')}
                  </div>
                  <div className="a-kv-v">
                    <textarea
                      className="a-filter-input"
                      value={offlineVerifyRemark}
                      onChange={(e) => setOfflineVerifyRemark(e.target.value)}
                      style={{ width: '100%', minHeight: 72, resize: 'vertical' }}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">{offlineVerifyFieldLabel('凭证附件')}</div>
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
                      <div className="a-muted" style={{ marginTop: 8, fontSize: 13 }}>可不上传，建议上传转账截图等作为佐证。</div>
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
                  <div className="a-kv-k">店长备注</div>
                  <div className="a-kv-v">
                    <textarea
                      className="a-filter-input"
                      value={editBillingRemark}
                      onChange={(e) => setEditBillingRemark(e.target.value)}
                      placeholder="可选：费用说明、对账说明等（最多 500 字）"
                      style={{ width: '100%', minHeight: 64, resize: 'vertical' }}
                      maxLength={500}
                    />
                  </div>
                </div>
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
                    const body: Record<string, unknown> = {
                      dueDate: editDueDate,
                      items: editItems,
                      remark: editRemark.trim(),
                      billingRemark: editBillingRemark.trim(),
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
                      await loadPeriodBills(current.storeId, current.period, periodDetailFiltersFromInputs())
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

      {payQrData && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setPayQrData(null)}
        >
          <div className="a-modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">付款二维码 · {payQrData.period}</div>
              <button type="button" className="a-modal-close" onClick={() => setPayQrData(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">租客</div>
                  <div className="a-kv-v">
                    {payQrData.tenantName} {payQrData.tenantPhone}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">待付</div>
                  <div className="a-kv-v" style={{ fontWeight: 800, color: '#b45309' }}>
                    ¥{payQrData.amountRemaining}
                  </div>
                </div>
              </div>
              <div className="a-bill-pay-qr-wrap">
                <img src={payQrData.qrImageUrl} alt="付款二维码" />
              </div>
              <p className="a-muted" style={{ fontSize: 13, lineHeight: 1.5, textAlign: 'center' }}>
                请租客使用微信扫一扫，打开账单页后可「立即支付」。请确保手机能访问同一局域网下的 H5 地址。
              </p>
              <div className="a-bill-pay-qr-url">{payQrData.payUrl}</div>
              <div className="a-row" style={{ marginTop: 12, gap: 8 }}>
                <button
                  type="button"
                  className="a-btn ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(payQrData.payUrl)
                    setMsg('已复制付款链接')
                  }}
                >
                  复制链接
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
