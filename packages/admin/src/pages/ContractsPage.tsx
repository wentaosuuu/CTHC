import { useEffect, useMemo, useState } from 'react'
import { apiDeleteContractAttachment, apiGet, apiPatch, apiPost, apiUploadContractAttachment } from '../api'
import { ContractRemarkEditor } from '../components/ContractRemarkEditor'
import { downloadFileWithAuth, previewFileWithAuth } from '../fileAuth'
import { Pagination, paginate } from '../components/Pagination'

type ContractItem = {
  id: string
  contractNo: string
  status: string
  source?: string
  endDate: string
  tenant: { name: string; phone: string }
  house: {
    id: string
    houseBizId: string
    storeName: string
    apartmentName: string
    houseNo: string
  }
  housingReportStatus: string | null
  modificationRequestedAt: string | null
  modificationRejectedAt: string | null
  remarkPreview: string
  attachmentCount: number
  attachmentFiles?: { name: string; file: string }[]
  renewedFromContractNo: string | null
  changeHouseFromContractNo: string | null
  depositRefunded?: boolean
  refundedDepositAmount?: number
}

// 合同状态 -> 中文
const CONTRACT_STATUS_ZH: Record<string, string> = {
  WAIT_TENANT_SIGN: '待租客签字',
  WAIT_STAMP: '待盖章',
  PENDING_PAYMENT: '待支付',
  ACTIVE: '已生效',
  VOID: '已作废',
  TERMINATED: '已终止',
}

// 报备状态 -> 中文（未报备、已发起报备、完成报备、驳回）
const REPORT_STATUS_ZH: Record<string, string> = {
  null: '未报备',
  PENDING: '已发起报备',
  SUCCESS: '完成报备',
  FAILED: '驳回',
}

// 合同状态 tag 样式（不同底色便于区分）
function statusBadgeClass(status: string) {
  switch (status) {
    case 'WAIT_TENANT_SIGN':
      return 'a-badge status-wait-sign'
    case 'WAIT_STAMP':
      return 'a-badge status-wait-stamp'
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

// 报备状态 tag 样式（不同底色便于区分）
function reportStatusBadgeClass(reportStatus: string | null) {
  const key = reportStatus ?? 'null'
  switch (key) {
    case 'null':
      return 'a-badge report-none'      // 未报备 - 灰
    case 'PENDING':
      return 'a-badge report-pending'   // 已发起报备 - 蓝
    case 'SUCCESS':
      return 'a-badge report-success'   // 完成报备 - 绿
    case 'FAILED':
      return 'a-badge report-failed'     // 驳回 - 红
    default:
      return 'a-badge report-none'
  }
}

// 合同号展示：HT + 按时间顺序的一串数字
function formatContractNo(contractNo: string) {
  const digits = contractNo.replace(/\D/g, '')
  return digits ? `HT${digits}` : contractNo
}

/** 与后端 `packages/server/src/time.ts` 的 `toYmd`（UTC 年月日）一致，避免东八区等时区把「未到期」算成「已过期」 */
function calcDaysTo(ymd: string) {
  const parts = ymd.trim().split('-').map((x) => Number(x))
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return NaN
  const [y, mo, d] = parts as [number, number, number]
  const endUtc = Date.UTC(y, mo - 1, d)
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const ms = 24 * 3600 * 1000
  return Math.round((endUtc - todayUtc) / ms)
}

function expiryWarnText(daysLeft: number) {
  if (daysLeft < -30) return '已过期超过30天'
  if (daysLeft < 0) return `已过期${Math.abs(daysLeft)}天`
  if (daysLeft === 0) return '当天到期'
  return `还有${daysLeft}天到期`
}

// 租客姓名展示（避免因历史数据出现 undefined）
function formatTenantName(name: string | undefined) {
  if (name == null) return '—'
  return String(name).replace(/undefined/g, '').trim() || '—'
}

const MOVE_OUT_REASON_OPTIONS = [
  { value: '租客违约', label: '租客违约' },
  { value: '房东收回', label: '房东收回' },
  { value: '协商一致', label: '协商一致' },
  { value: '到期不续', label: '到期不续' },
  { value: '其他', label: '其他' },
] as const

function apiErrorZh(code: string) {
  const m: Record<string, string> = {
    BILLS_NOT_SETTLED: '请先结清该合同下所有未付/逾期账单（续签、换房均需费用结清）',
    RENEW_NEED_ACTIVE: '仅「已生效」合同可续签',
    TARGET_NOT_VACANT: '目标房源不是空置状态',
    CROSS_STORE_NOT_ALLOWED: '换房仅支持同门店下的空置房源',
    SAME_HOUSE: '不能换到当前同一套房',
    CONTRACT_ENDED: '合同已结束，无法换房',
    TARGET_FORBIDDEN: '无权限操作目标房源',
    TARGET_NOT_FOUND: '目标房源不存在',
    NEW_START_BEFORE_MOVE: '新合同起租日不能早于换房日',
    CHANGE_HOUSE_NEED_ACTIVE: '仅「已生效」的在租合同可办理换房',
    DEPOSIT_REFUND_NEED_TERMINATED: '仅已退租（已终止）合同可以退押金',
    DEPOSIT_REFUND_EXCEED_DEPOSIT: '退押金金额不能超过合同押金',
  }
  return m[code] ?? code
}

type DemoMode = {
  enabled: boolean
  reason: string
}

function buildDemoContracts(totalCount: number): ContractItem[] {
  const apartments = [
    { storeName: '华东一区', apartmentName: '星河公寓' },
    { storeName: '华东一区', apartmentName: '云栖公寓' },
    { storeName: '华南一区', apartmentName: '海岸公寓' },
    { storeName: '华南一区', apartmentName: '榕城公寓' },
    { storeName: '华北一区', apartmentName: '京华公寓' },
    { storeName: '华北一区', apartmentName: '雪松公寓' },
  ]
  const tenants = [
    { name: '张三', phone: '13800000001' },
    { name: '李四', phone: '13800000002' },
    { name: '王五', phone: '13800000003' },
    { name: '赵六', phone: '13800000004' },
    { name: '钱七', phone: '13800000005' },
    { name: '孙八', phone: '13800000006' },
    { name: '周九', phone: '13800000007' },
    { name: '吴十', phone: '13800000008' },
    { name: '郑一', phone: '13800000009' },
    { name: '冯二', phone: '13800000010' },
  ]

  const contractStatuses: ContractItem['status'][] = [
    'WAIT_TENANT_SIGN',
    'WAIT_STAMP',
    'PENDING_PAYMENT',
    'ACTIVE',
    'VOID',
    'TERMINATED',
  ]
  const reportStatuses: Array<ContractItem['housingReportStatus']> = [null, 'PENDING', 'SUCCESS', 'FAILED']

  function pick<T>(arr: T[], idx: number) {
    return arr[idx % arr.length]
  }

  function buildContractNo(i: number) {
    const base = 202603180000 + i
    return String(base)
  }

  function buildHouseBizId(i: number) {
    return String(100000 + i)
  }

  function buildHouseNo(i: number) {
    const building = (Math.floor(i / 10) % 9) + 1
    const room = (i % 10) + 1
    return `${building}${String(room).padStart(2, '0')}`
  }

  function buildAttachmentFiles(i: number) {
    if (i % 7 !== 0) return { attachmentCount: 0, attachmentFiles: [] as { name: string; file: string }[] }
    const attachmentCount = (i % 2) + 1
    const attachmentFiles = Array.from({ length: attachmentCount }).map((_, idx) => {
      return {
        name: idx === 0 ? '合同PDF.pdf' : '身份证照片.png',
        file: `demo_${i}_${idx}.bin`,
      }
    })
    return { attachmentCount, attachmentFiles }
  }

  function buildRemarkPreview(i: number, status: string) {
    if (i % 9 === 0) return '租客申请修改条款'
    if (status === 'VOID') return '未支付，已作废'
    if (status === 'TERMINATED') return '已退租结案'
    if (status === 'ACTIVE' && i % 5 === 0) return '在租中，按季付'
    return '—'
  }

  const items: ContractItem[] = []
  // 演示用 endDate：按合同序号 i 分配「距到期天数」，保证预警列各不相同
  // - i=1..31：还有 30、29、…、1 天到期 + 当天到期（从 30 天起完整倒计时）
  // - i=32..61：已过期 1…30 天
  // - i>61：少量「已过期超过30天」/ 更远到期（列表不展示预警）
  function buildEndDateByIndex(i: number) {
    const now = new Date()
    const y = now.getUTCFullYear()
    const m = now.getUTCMonth()
    const d = now.getUTCDate()
    const n = Math.max(1, i)
    let offsetDays: number
    if (n <= 31) {
      offsetDays = 31 - n
    } else if (n <= 61) {
      offsetDays = -(n - 31)
    } else {
      const tail = [-38, -42, -55, 45, 52, 60, 70, -33, 48]
      offsetDays = tail[(n - 62) % tail.length]!
    }
    const t = new Date(Date.UTC(y, m, d + offsetDays))
    const yy = t.getUTCFullYear()
    const mm = String(t.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(t.getUTCDate()).padStart(2, '0')
    return `${yy}-${mm}-${dd}`
  }

  // 1) 先构造一批“换房”链路：旧合同（已生效/已终止） + 新合同（待签字/待盖章/待支付）
  const changeHousePairs = 10
  for (let p = 0; p < changeHousePairs; p++) {
    const oldIndex = items.length + 1
    const newIndex = oldIndex + 1
    const tenant = pick(tenants, p)
    const oldApartment = pick(apartments, p)
    const newApartment = pick(apartments, p + 2)

    const oldContractNo = buildContractNo(oldIndex)
    const newContractNo = buildContractNo(newIndex)

    const oldContract: ContractItem = {
      id: `demo_old_change_${p}`,
      contractNo: oldContractNo,
      status: p % 2 === 0 ? 'ACTIVE' : 'TERMINATED',
      tenant,
      house: {
        id: `demo_house_old_${p}`,
        houseBizId: buildHouseBizId(oldIndex),
        storeName: oldApartment.storeName,
        apartmentName: oldApartment.apartmentName,
        houseNo: buildHouseNo(oldIndex),
      },
      housingReportStatus: p % 3 === 0 ? 'SUCCESS' : null,
      modificationRequestedAt: p % 4 === 0 ? new Date().toISOString() : null,
      modificationRejectedAt: p % 6 === 0 ? new Date().toISOString() : null,
      remarkPreview: buildRemarkPreview(oldIndex, p % 2 === 0 ? 'ACTIVE' : 'TERMINATED'),
      ...buildAttachmentFiles(oldIndex),
      renewedFromContractNo: null,
      changeHouseFromContractNo: null,
      endDate: buildEndDateByIndex(oldIndex),
    }

    const newContractStatus: ContractItem['status'] =
      p % 3 === 0 ? 'WAIT_TENANT_SIGN' : p % 3 === 1 ? 'WAIT_STAMP' : 'PENDING_PAYMENT'
    const newContract: ContractItem = {
      id: `demo_new_change_${p}`,
      contractNo: newContractNo,
      status: newContractStatus,
      tenant,
      house: {
        id: `demo_house_new_${p}`,
        houseBizId: buildHouseBizId(newIndex),
        storeName: newApartment.storeName,
        apartmentName: newApartment.apartmentName,
        houseNo: buildHouseNo(newIndex + 20),
      },
      housingReportStatus: null,
      modificationRequestedAt: p % 5 === 0 ? new Date().toISOString() : null,
      modificationRejectedAt: null,
      remarkPreview: buildRemarkPreview(newIndex, newContractStatus),
      ...buildAttachmentFiles(newIndex),
      renewedFromContractNo: null,
      changeHouseFromContractNo: oldContractNo,
      endDate: buildEndDateByIndex(newIndex),
    }

    items.push(newContract, oldContract)
  }

  // 2) 再构造一批“续签”链路：旧合同（已生效/已终止） + 新合同（待签字）
  const renewPairs = 8
  for (let p = 0; p < renewPairs; p++) {
    const oldIndex = items.length + 1
    const newIndex = oldIndex + 1
    const tenant = pick(tenants, p + 3)
    const apt = pick(apartments, p + 1)

    const oldContractNo = buildContractNo(oldIndex)
    const newContractNo = buildContractNo(newIndex)

    const oldContract: ContractItem = {
      id: `demo_old_renew_${p}`,
      contractNo: oldContractNo,
      status: p % 2 === 0 ? 'ACTIVE' : 'TERMINATED',
      tenant,
      house: {
        id: `demo_house_renew_old_${p}`,
        houseBizId: buildHouseBizId(oldIndex),
        storeName: apt.storeName,
        apartmentName: apt.apartmentName,
        houseNo: buildHouseNo(oldIndex + 30),
      },
      housingReportStatus: pick(reportStatuses, p + 1),
      modificationRequestedAt: null,
      modificationRejectedAt: null,
      remarkPreview: buildRemarkPreview(oldIndex, p % 2 === 0 ? 'ACTIVE' : 'TERMINATED'),
      ...buildAttachmentFiles(oldIndex),
      renewedFromContractNo: null,
      changeHouseFromContractNo: null,
      endDate: buildEndDateByIndex(oldIndex),
    }

    const newContract: ContractItem = {
      id: `demo_new_renew_${p}`,
      contractNo: newContractNo,
      status: 'WAIT_TENANT_SIGN',
      tenant,
      house: {
        id: `demo_house_renew_new_${p}`,
        houseBizId: buildHouseBizId(newIndex),
        storeName: apt.storeName,
        apartmentName: apt.apartmentName,
        houseNo: buildHouseNo(newIndex + 31),
      },
      housingReportStatus: null,
      modificationRequestedAt: null,
      modificationRejectedAt: null,
      remarkPreview: buildRemarkPreview(newIndex, 'WAIT_TENANT_SIGN'),
      ...buildAttachmentFiles(newIndex),
      renewedFromContractNo: oldContractNo,
      changeHouseFromContractNo: null,
      endDate: buildEndDateByIndex(newIndex),
    }

    items.push(newContract, oldContract)
  }

  // 3) 其余补齐各种状态的“独立合同”
  while (items.length < totalCount) {
    const i = items.length + 1
    const tenant = pick(tenants, i)
    const apartment = pick(apartments, i)
    const status = pick(contractStatuses, i)
    const reportStatus = status === 'ACTIVE' ? pick(reportStatuses, i + 2) : null
    const { attachmentCount, attachmentFiles } = buildAttachmentFiles(i)

    items.push({
      id: `demo_${i}`,
      contractNo: buildContractNo(i),
      status,
      endDate: buildEndDateByIndex(i),
      tenant,
      house: {
        id: `demo_house_${i}`,
        houseBizId: buildHouseBizId(i),
        storeName: apartment.storeName,
        apartmentName: apartment.apartmentName,
        houseNo: buildHouseNo(i),
      },
      housingReportStatus: reportStatus,
      modificationRequestedAt: i % 11 === 0 ? new Date().toISOString() : null,
      modificationRejectedAt: i % 13 === 0 ? new Date().toISOString() : null,
      remarkPreview: buildRemarkPreview(i, status),
      attachmentCount,
      attachmentFiles,
      renewedFromContractNo: null,
      changeHouseFromContractNo: null,
    })
  }

  return items.slice(0, totalCount)
}

type ContractDetail = {
  id: string
  contractNo: string
  status: string
  source?: string
  tenant: { name: string; phone: string; idNumber?: string; wechat?: string | null }
  house: { storeName: string; apartmentName: string; houseNo: string }
  startDate: string
  endDate: string
  rentMonthly: number
  deposit: number
  rentCycle?: string
  penaltyFormula?: string
  latestRentGraceDays: number | null
  configRemarkHtml?: string
  attachments?: { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }[]
  renewedFromContractNo?: string | null
  renewedFromId?: string | null
  changeHouseFromContractNo?: string | null
  changeHouseFromId?: string | null
  createdAt: string
  confirmedAt: string | null
  signedAt: string | null
  stampedAt: string | null
  voidedAt: string | null
  terminatedAt: string | null
  housingReport: { status: string; receiptPdfPath: string | null; reportedAt: string | null; lastError: string | null } | null
  depositRefunded?: boolean
  refundedDepositAmount?: number
  refunds: { amount: number; reason: string; createdAt: string }[]
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 解析「最晚交租宽限期（天）」：空字符串 = 未约定 */
function parseLatestRentGraceDaysInput(s: string): { ok: true; value: number | null } | { ok: false; message: string } {
  const t = s.trim()
  if (t === '') return { ok: true, value: null }
  const n = parseInt(t, 10)
  if (Number.isNaN(n) || n < 0) return { ok: false, message: '最晚交租宽限期须为不小于 0 的整数（天）' }
  if (n > 999) return { ok: false, message: '最晚交租宽限期不能超过 999 天' }
  return { ok: true, value: n }
}

export function ContractsPage() {
  const [items, setItems] = useState<ContractItem[]>([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [demoMode, setDemoMode] = useState<DemoMode>({ enabled: false, reason: '' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [reportStatusFilter, setReportStatusFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [apartmentFilter, setApartmentFilter] = useState('')
  const [expiryWarnMin, setExpiryWarnMin] = useState('') // 到期预警：最小值（到期日-今天，支持负数）
  const [expiryWarnMax, setExpiryWarnMax] = useState('') // 到期预警：最大值（到期日-今天，支持负数）

  function resetContractFilters() {
    setQ('')
    setStatus('')
    setReportStatusFilter('')
    setSourceFilter('')
    setStoreFilter('')
    setApartmentFilter('')
    setExpiryWarnMin('')
    setExpiryWarnMax('')
    setPage(1)
  }

  // 退租（原「终止合同」：待支付作废 / 已生效退租）
  const [moveOutModal, setMoveOutModal] = useState<ContractItem | null>(null)
  const [moveOutDate, setMoveOutDate] = useState(todayYmd())
  const [moveOutReason, setMoveOutReason] = useState<string>('')
  const [moveOutReasonOther, setMoveOutReasonOther] = useState('')
  const [moveOutRemark, setMoveOutRemark] = useState('')
  const [moveOutSubmitting, setMoveOutSubmitting] = useState(false)
  // 退押金
  const [refundDepositModal, setRefundDepositModal] = useState<ContractItem | null>(null)
  const [refundDepositAmount, setRefundDepositAmount] = useState('')
  const [refundDepositRemark, setRefundDepositRemark] = useState('')
  const [refundDepositSubmitting, setRefundDepositSubmitting] = useState(false)

  // 续签
  type RenewElig = {
    eligible: boolean
    reason: string | null
    tenant: { name: string; phone: string; idNumber?: string; wechat?: string | null }
    previousContractNo?: string
    rentMonthly?: number
    depositMultiple?: number
    rentCycle?: string
    penaltyFormula?: string
  }
  const [renewModal, setRenewModal] = useState<ContractItem | null>(null)
  const [renewElig, setRenewElig] = useState<RenewElig | null>(null)
  const [renewForm, setRenewForm] = useState({
    leaseMonths: 12,
    moveInDate: '',
    rentMonthly: 0,
    depositMultiple: 1,
    rentCycle: 'MONTHLY' as 'MONTHLY' | 'QUARTERLY' | 'YEARLY',
    penaltyFormula: 'amount*0.1%*days',
    latestRentGraceDays: '',
  })
  const [renewSubmitting, setRenewSubmitting] = useState(false)
  const [renewRemarkHtml, setRenewRemarkHtml] = useState('')
  const [renewPendingFiles, setRenewPendingFiles] = useState<File[]>([])

  // 换房
  type VacantPick = { id: string; apartmentName: string; houseNo: string; storeName: string }
  const [changeHouseModal, setChangeHouseModal] = useState<ContractItem | null>(null)
  const [changeHouseOptions, setChangeHouseOptions] = useState<VacantPick[]>([])
  const [changeHouseTargetId, setChangeHouseTargetId] = useState('')
  const [changeHouseSubmitting, setChangeHouseSubmitting] = useState(false)
  const [chMoveDate, setChMoveDate] = useState('')
  const [chNewStart, setChNewStart] = useState('')
  const [chLeaseMonths, setChLeaseMonths] = useState(12)
  const [chOldRent, setChOldRent] = useState(0)
  const [chOldDeposit, setChOldDeposit] = useState(0)
  const [chNewRent, setChNewRent] = useState(0)
  const [chNewDeposit, setChNewDeposit] = useState(0)

  // 查看详情弹窗
  const [detailContract, setDetailContract] = useState<ContractDetail | null>(null)
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null)

  // 修改配置合同信息弹窗
  const [editContract, setEditContract] = useState<ContractDetail | null>(null)
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    startDate: '',
    endDate: '',
    rentMonthly: 0,
    deposit: 0,
    rentCycle: 'MONTHLY' as 'MONTHLY' | 'QUARTERLY' | 'YEARLY',
    penaltyFormula: 'amount*0.1%*days',
    latestRentGraceDays: '' as string, // 天数，空表示未设置
  })
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editRemarkHtml, setEditRemarkHtml] = useState('')
  const [editAttachments, setEditAttachments] = useState<
    { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }[]
  >([])

  // 管理员手动新建合同弹窗
  type HousePick = { id: string; apartmentName: string; houseNo: string; storeName: string; status: string }
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createHouseOptions, setCreateHouseOptions] = useState<HousePick[]>([])
  const [createForm, setCreateForm] = useState({
    houseId: '',
    tenantName: '',
    tenantPhone: '',
    tenantIdNumber: '',
    startDate: todayYmd(),
    leaseMonths: 12,
    rentMonthly: 0,
    deposit: 0,
    rentCycle: 'MONTHLY' as 'MONTHLY' | 'QUARTERLY' | 'YEARLY',
    penaltyFormula: 'amount*0.1%*days',
    latestRentGraceDays: '',
    remarkHtml: '',
  })
  const [createPendingFiles, setCreatePendingFiles] = useState<File[]>([])
  const [createSubmitting, setCreateSubmitting] = useState(false)

  async function load() {
    setError('')
    const r = await apiGet<{ items: ContractItem[] }>('/api/admin/contracts')
    if (!r.ok) {
      // 未登录或 token 失效：api 层会清 token 并回到登录页，不要进入「演示模式」以免按钮全废
      if (r.error === 'UNAUTHORIZED') {
        setDemoMode({ enabled: false, reason: '' })
        setItems([])
        setMsg('')
        setError('登录已失效，请重新登录')
        return
      }
      const demoItems = buildDemoContracts(70)
      setDemoMode({ enabled: true, reason: `接口失败：${r.error}` })
      setItems(demoItems)
      setMsg('已加载 70 条演示合同数据（用于演示，不会影响真实数据）')
      return
    }
    const list = r.data.items ?? []
    if (list.length === 0) {
      const demoItems = buildDemoContracts(70)
      setDemoMode({ enabled: true, reason: '接口返回为空' })
      setItems(demoItems)
      setMsg('已加载 70 条演示合同数据（用于演示，不会影响真实数据）')
      return
    }
    setDemoMode({ enabled: false, reason: '' })
    setItems(list)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!editLoadingId) return
    let alive = true
    apiGet<ContractDetail>('/api/admin/contracts/' + editLoadingId).then((r) => {
      if (!alive) return
      setEditLoadingId(null)
      if (!r.ok) return setError(r.error)
      const d = r.data
      setEditContract(d)
      setEditForm({
        startDate: d.startDate,
        endDate: d.endDate,
        rentMonthly: d.rentMonthly,
        deposit: d.deposit,
        rentCycle: (d.rentCycle === 'QUARTERLY' || d.rentCycle === 'YEARLY' ? d.rentCycle : 'MONTHLY') as 'MONTHLY' | 'QUARTERLY' | 'YEARLY',
        penaltyFormula: d.penaltyFormula ?? 'amount*0.1%*days',
        latestRentGraceDays: d.latestRentGraceDays != null ? String(d.latestRentGraceDays) : '',
      })
      setEditRemarkHtml(d.configRemarkHtml ?? '')
      setEditAttachments(d.attachments ?? [])
    })
    return () => {
      alive = false
    }
  }, [editLoadingId])

  function openMoveOutModal(c: ContractItem) {
    setMoveOutModal(c)
    setMoveOutDate(todayYmd())
    setMoveOutReason('')
    setMoveOutReasonOther('')
    setMoveOutRemark('')
  }

  async function openRenewModal(c: ContractItem) {
    setError('')
    setRenewModal(c)
    setRenewElig(null)
    setRenewRemarkHtml('')
    setRenewPendingFiles([])
    const r = await apiGet<RenewElig>('/api/admin/contracts/' + c.id + '/renew-eligibility')
    if (!r.ok) {
      setRenewModal(null)
      return setError(r.error)
    }
    setRenewElig(r.data)
    if (r.data.eligible && r.data.rentMonthly != null) {
      const d = await apiGet<ContractDetail>('/api/admin/contracts/' + c.id)
      let nextStart = todayYmd()
      if (d.ok) {
        const end = new Date(d.data.endDate)
        end.setDate(end.getDate() + 1)
        nextStart = end.toISOString().slice(0, 10)
      }
      setRenewForm({
        leaseMonths: 12,
        moveInDate: nextStart,
        rentMonthly: r.data.rentMonthly,
        depositMultiple: r.data.depositMultiple ?? 1,
        rentCycle: (r.data.rentCycle === 'QUARTERLY' || r.data.rentCycle === 'YEARLY'
          ? r.data.rentCycle
          : 'MONTHLY') as 'MONTHLY' | 'QUARTERLY' | 'YEARLY',
        penaltyFormula: r.data.penaltyFormula ?? 'amount*0.1%*days',
        latestRentGraceDays:
          d.ok && d.data.latestRentGraceDays != null ? String(d.data.latestRentGraceDays) : '',
      })
    }
  }

  async function openChangeHouseModal(c: ContractItem) {
    setError('')
    setChangeHouseModal(c)
    setChangeHouseTargetId('')
    const t = todayYmd()
    setChMoveDate(t)
    setChNewStart(t)
    setChLeaseMonths(12)
    const cr = await apiGet<ContractDetail>('/api/admin/contracts/' + c.id)
    if (cr.ok) {
      setChOldRent(cr.data.rentMonthly)
      setChOldDeposit(cr.data.deposit)
      setChNewRent(cr.data.rentMonthly)
      setChNewDeposit(cr.data.deposit)
    } else {
      setChOldRent(0)
      setChOldDeposit(0)
      setChNewRent(0)
      setChNewDeposit(0)
    }
    const r = await apiGet<{
      items: Array<{ id: string; apartmentName: string; houseNo: string; storeName: string; status: string }>
    }>('/api/admin/houses')
    if (!r.ok) {
      setChangeHouseModal(null)
      return setError(r.error)
    }
    const items = r.data.items
    const opts = items.filter(
      (h) => h.status === 'VACANT' && h.storeName === c.house.storeName && h.id !== c.house.id,
    )
    setChangeHouseOptions(opts)
    if (opts.length === 1) setChangeHouseTargetId(opts[0].id)
  }

  // 补差仅针对押金：新押金 > 旧押金时生成补差账单（押金补足）；新押金 ≤ 旧押金时不生成，多出部分不退
  const chSupplementPreview = useMemo(() => {
    const dd = chNewDeposit - chOldDeposit
    if (dd <= 0) {
      return {
        lines: [] as { name: string; amount: number }[],
        total: 0,
        note: '新押金不高于旧押金：不生成补差账单；旧押金多于新押金的部分按规定不予退还租客。',
      }
    }
    const lines: { name: string; amount: number }[] = [
      { name: '押金补足（新房押金 − 旧房押金）', amount: dd },
    ]
    return {
      lines,
      total: dd,
      note: '提交后将在新合同下生成一笔「换房补差」账单（押金补足），租客需在账单中支付此金额。',
    }
  }, [chNewDeposit, chOldDeposit])

  async function loadDetail(contractId: string) {
    setDetailLoadingId(contractId)
    const r = await apiGet<ContractDetail>('/api/admin/contracts/' + contractId)
    setDetailLoadingId(null)
    if (!r.ok) return setError(r.error)
    setDetailContract(r.data)
  }

  async function submitEditConfig() {
    if (!editContract) return
    if (editContract.status === 'VOID' || editContract.status === 'TERMINATED') {
      setError('已作废或已终止的合同无法修改')
      return
    }
    setEditSubmitting(true)
    setError('')
    const graceParsed = parseLatestRentGraceDaysInput(editForm.latestRentGraceDays)
    if (!graceParsed.ok) {
      setEditSubmitting(false)
      return setError(graceParsed.message)
    }
    const r = await apiPatch<{ ok: true }>('/api/admin/contracts/' + editContract.id, {
      startDate: editForm.startDate,
      endDate: editForm.endDate,
      rentMonthly: editForm.rentMonthly,
      deposit: editForm.deposit,
      rentCycle: editForm.rentCycle,
      penaltyFormula: editForm.penaltyFormula,
      latestRentGraceDays: graceParsed.value,
      configRemarkHtml: editRemarkHtml || null,
      attachmentsJson: JSON.stringify(
        editAttachments.map((a) => ({
          id: a.id,
          name: (a.name || '').trim() || '未命名附件',
          file: a.file,
        })),
      ),
    })
    setEditSubmitting(false)
    if (!r.ok) return setError(r.error)
    setMsg('合同配置已更新')
    setEditContract(null)
    await load()
  }

  async function submitMoveOut() {
    if (!moveOutModal) return
    const reasonText = moveOutReason === '其他' ? moveOutReasonOther.trim() : moveOutReason
    if (!reasonText) {
      setError('请选择或填写退租原因')
      return
    }
    setMoveOutSubmitting(true)
    setError('')
    if (moveOutModal.status === 'PENDING_PAYMENT') {
      const r = await apiPost<{ ok: true }>('/api/admin/contracts/' + moveOutModal.id + '/void', {
        terminateDate: moveOutDate || undefined,
        reason: reasonText,
        remark: moveOutRemark.trim() || undefined,
      })
      if (!r.ok) {
        setMoveOutSubmitting(false)
        return setError(typeof r.error === 'string' ? apiErrorZh(r.error) : String(r.error))
      }
      setMsg('已办理退租（未支付合同已作废，房源已释放）')
    } else if (moveOutModal.status === 'ACTIVE') {
      const r = await apiPost<{ ok: true }>('/api/admin/contracts/' + moveOutModal.id + '/terminate', {
        terminateDate: moveOutDate,
        reason: reasonText,
        remark: moveOutRemark.trim() || undefined,
      })
      if (!r.ok) {
        setMoveOutSubmitting(false)
        return setError(typeof r.error === 'string' ? apiErrorZh(r.error) : String(r.error))
      }
      setMsg('已办理退租，合同已终止')
    } else {
      setMoveOutSubmitting(false)
      return setError('当前状态不可在此办理退租（支持：待支付作废、已生效退租）')
    }
    setMoveOutSubmitting(false)
    setMoveOutModal(null)
    await load()
  }

  function openRefundDepositModal(c: ContractItem) {
    setRefundDepositModal(c)
    setRefundDepositAmount('')
    setRefundDepositRemark('')
  }

  async function submitRefundDeposit() {
    if (!refundDepositModal) return
    const amount = Number(refundDepositAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('请输入大于 0 的退押金金额')
      return
    }
    if (!Number.isInteger(amount)) {
      setError('退押金金额需为整数（单位：元）')
      return
    }
    setRefundDepositSubmitting(true)
    setError('')
    const r = await apiPost<{ ok: true }>('/api/admin/contracts/' + refundDepositModal.id + '/refund-deposit', {
      amount,
      remark: refundDepositRemark.trim() || undefined,
    })
    setRefundDepositSubmitting(false)
    if (!r.ok) return setError(apiErrorZh(String(r.error)))
    setMsg(`退押金成功：${formatContractNo(refundDepositModal.contractNo)} 已退 ¥${amount}`)
    setRefundDepositModal(null)
    await load()
  }

  async function submitRenew() {
    if (!renewModal || !renewElig?.eligible) return
    setRenewSubmitting(true)
    setError('')
    const graceParsed = parseLatestRentGraceDaysInput(renewForm.latestRentGraceDays)
    if (!graceParsed.ok) {
      setRenewSubmitting(false)
      return setError(graceParsed.message)
    }
    const r = await apiPost<{ ok: true; newContractId: string; contractNo: string }>(
      '/api/admin/contracts/' + renewModal.id + '/renew',
      {
        leaseMonths: renewForm.leaseMonths,
        moveInDate: renewForm.moveInDate,
        rentMonthly: renewForm.rentMonthly,
        depositMultiple: renewForm.depositMultiple,
        rentCycle: renewForm.rentCycle,
        penaltyFormula: renewForm.penaltyFormula,
        latestRentGraceDays: graceParsed.value,
        configRemarkHtml: renewRemarkHtml.trim() ? renewRemarkHtml : null,
      },
    )
    if (!r.ok) {
      setRenewSubmitting(false)
      return setError(apiErrorZh(String(r.error)))
    }
    const newId = r.data.newContractId
    for (const f of renewPendingFiles) {
      const up = await apiUploadContractAttachment(newId, f)
      if (!up.ok) {
        setRenewSubmitting(false)
        setMsg(`续签已生成 ${formatContractNo(r.data.contractNo)}，但附件「${f.name}」上传失败，请在合同管理中补传。`)
        setRenewModal(null)
        setRenewElig(null)
        await load()
        return
      }
    }
    setRenewSubmitting(false)
    setMsg(
      `续签成功：新合同 ${formatContractNo(r.data.contractNo)}（关联原合同 ${formatContractNo(renewElig.previousContractNo ?? renewModal.contractNo)}），请通知租客签字 / 支付`,
    )
    setRenewModal(null)
    setRenewElig(null)
    await load()
  }

  async function submitChangeHouse() {
    if (!changeHouseModal || !changeHouseTargetId) {
      setError('请选择目标房源')
      return
    }
    if (!chMoveDate || !chNewStart) {
      setError('请填写换房日与新合同起租日')
      return
    }
    if (chNewRent <= 0 || chNewDeposit < 0) {
      setError('请填写新月租与新押金')
      return
    }
    setChangeHouseSubmitting(true)
    setError('')
    const r = await apiPost<{
      ok: true
      newContractId: string
      contractNo: string
      supplementBillCreated: boolean
      supplementTotal: number
    }>('/api/admin/contracts/' + changeHouseModal.id + '/change-house', {
      targetHouseId: changeHouseTargetId,
      moveDate: chMoveDate,
      newStartDate: chNewStart,
      leaseMonths: chLeaseMonths,
      newRentMonthly: chNewRent,
      newDeposit: chNewDeposit,
    })
    setChangeHouseSubmitting(false)
    if (!r.ok) return setError(apiErrorZh(String(r.error)))
    const sup = r.data.supplementBillCreated
      ? `已生成换房补差账单 ¥${r.data.supplementTotal}。`
      : '未生成补差账单（新押金不高于旧押金）。'
    setMsg(
      `换房完成：旧合同已于 ${chMoveDate} 终止；新合同 ${formatContractNo(r.data.contractNo)} 已生成（待租客签字/支付后在新房生效）。${sup}`,
    )
    setChangeHouseModal(null)
    await load()
  }

  const filterOptions = useMemo(() => {
    const stores = Array.from(new Set(items.map((c) => c.house.storeName).filter(Boolean))).sort()
    const apartments = Array.from(new Set(items.map((c) => c.house.apartmentName).filter(Boolean))).sort()
    return { stores, apartments }
  }, [items])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return items.filter((c) => {
      if (status && c.status !== status) return false
      if (sourceFilter) {
        const cur = (c.source ?? 'SYSTEM') as string
        if (cur !== sourceFilter) return false
      }
      if (reportStatusFilter !== '') {
        const key = reportStatusFilter === '__null__' ? null : reportStatusFilter
        const cur = c.housingReportStatus ?? null
        if (cur !== key) return false
      }
      if (storeFilter && c.house.storeName !== storeFilter) return false
      if (apartmentFilter && c.house.apartmentName !== apartmentFilter) return false

      if (expiryWarnMin.trim() || expiryWarnMax.trim()) {
        const min = expiryWarnMin.trim() ? Number(expiryWarnMin.trim()) : -Infinity
        const max = expiryWarnMax.trim() ? Number(expiryWarnMax.trim()) : Infinity
        const daysLeft = calcDaysTo(c.endDate)
        // 到期预警列只在 daysLeft <= 30 时展示；筛选也基于同样规则
        if (Number.isNaN(daysLeft) || daysLeft > 30) return false
        const low = Math.min(min, max)
        const high = Math.max(min, max)
        if (daysLeft < low || daysLeft > high) return false
      }

      if (!kw) return true
      const srcZh =
        (c.source ?? 'SYSTEM') === 'MANUAL_IMPORT'
          ? '手动导入 手动创建'
          : (c.source ?? 'SYSTEM') === 'SYSTEM'
            ? '系统生成'
            : String(c.source ?? '')
      const hay =
        `${c.contractNo} ${c.house.houseBizId} ${c.tenant.name} ${c.tenant.phone} ${c.house.storeName} ${c.house.apartmentName} ${c.house.houseNo} ${srcZh}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, status, sourceFilter, reportStatusFilter, storeFilter, apartmentFilter, expiryWarnMin, expiryWarnMax])

  async function openCreateModal() {
    setError('')
    setMsg('')
    const r = await apiGet<{ items: HousePick[] }>('/api/admin/houses')
    if (!r.ok) return setError(r.error)
    // 仅允许选择空置房源
    const opts = (r.data.items ?? []).filter((h) => h.status === 'VACANT')
    setCreateHouseOptions(opts)
    setCreateForm((f) => ({
      ...f,
      houseId: opts.length === 1 ? opts[0].id : f.houseId,
      startDate: todayYmd(),
      remarkHtml: '',
    }))
    setCreatePendingFiles([])
    setCreateModalOpen(true)
  }

  async function submitCreate() {
    if (!createForm.houseId) return setError('请选择房源（仅支持空置房源）')
    if (!createForm.tenantName.trim()) return setError('请填写租客姓名')
    if (!createForm.tenantPhone.trim()) return setError('请填写手机号')
    if (!createForm.tenantIdNumber.trim()) return setError('请填写身份证号')
    if (!createForm.startDate) return setError('请填写起租日')
    if (createForm.leaseMonths <= 0) return setError('租期（月）需大于 0')
    if (createForm.rentMonthly <= 0) return setError('月租需大于 0')
    if (createForm.deposit < 0) return setError('押金不能为负数')
    const graceParsed = parseLatestRentGraceDaysInput(createForm.latestRentGraceDays)
    if (!graceParsed.ok) return setError(graceParsed.message)
    setCreateSubmitting(true)
    setError('')
    const r = await apiPost<{ ok: true; contractId: string; contractNo: string }>('/api/admin/contracts/manual', {
      houseId: createForm.houseId,
      tenant: {
        name: createForm.tenantName.trim(),
        phone: createForm.tenantPhone.trim(),
        idNumber: createForm.tenantIdNumber.trim(),
      },
      startDate: createForm.startDate,
      leaseMonths: createForm.leaseMonths,
      rentMonthly: createForm.rentMonthly,
      deposit: createForm.deposit,
      rentCycle: createForm.rentCycle,
      penaltyFormula: createForm.penaltyFormula,
      latestRentGraceDays: graceParsed.value,
      configRemarkHtml: createForm.remarkHtml.trim() ? createForm.remarkHtml : null,
    })
    setCreateSubmitting(false)
    if (!r.ok) return setError(apiErrorZh(String(r.error)))
    const newId = r.data.contractId
    for (const f of createPendingFiles) {
      const up = await apiUploadContractAttachment(newId, f)
      if (!up.ok) {
        setMsg(
          `新建合同已生成 ${formatContractNo(r.data.contractNo)}，但附件「${f.name}」上传失败，请在合同详情中补传。`,
        )
        setCreateModalOpen(false)
        await load()
        return
      }
    }
    setCreateModalOpen(false)
    setMsg(`新建合同成功：${formatContractNo(r.data.contractNo)}（合同来源：手动导入），已直接生效。`)
    await load()
  }

  const contractNoToChildren = useMemo(() => {
    const map = new Map<string, { renewedTo: string[]; changeHouseTo: string[] }>()
    function ensure(contractNo: string) {
      if (!map.has(contractNo)) map.set(contractNo, { renewedTo: [], changeHouseTo: [] })
      return map.get(contractNo)!
    }
    for (const c of items) {
      if (c.renewedFromContractNo) {
        ensure(c.renewedFromContractNo).renewedTo.push(c.contractNo)
      }
      if (c.changeHouseFromContractNo) {
        ensure(c.changeHouseFromContractNo).changeHouseTo.push(c.contractNo)
      }
    }
    return map
  }, [items])

  const pageData = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize])

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">合同管理</div>
        <div className="a-muted">合同生效后，系统会在次日自动报备（定时任务）。这里也支持手动触发一次。</div>
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
              onChange={(e) => { setQ(e.target.value); setPage(1) }}
              placeholder="搜索：合同号/租客/手机号/门店/房号"
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
              title="合同状态"
            >
              <option value="">全部合同状态</option>
              <option value="WAIT_TENANT_SIGN">待租客签字</option>
              <option value="WAIT_STAMP">待盖章</option>
              <option value="PENDING_PAYMENT">待支付</option>
              <option value="ACTIVE">已生效</option>
              <option value="VOID">已作废</option>
              <option value="TERMINATED">已终止</option>
            </select>
            <select
              className="a-filter-select"
              value={sourceFilter}
              onChange={(e) => { setSourceFilter(e.target.value); setPage(1) }}
              title="合同来源"
            >
              <option value="">全部合同来源</option>
              <option value="SYSTEM">系统生成</option>
              <option value="MANUAL_IMPORT">手动导入</option>
            </select>
            <select
              className="a-filter-select"
              value={reportStatusFilter}
              onChange={(e) => { setReportStatusFilter(e.target.value); setPage(1) }}
              title="报备状态"
            >
              <option value="">全部报备状态</option>
              <option value="__null__">未报备</option>
              <option value="PENDING">已发起报备</option>
              <option value="SUCCESS">完成报备</option>
              <option value="FAILED">驳回</option>
            </select>
            <div className="a-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                className="a-filter-input"
                value={expiryWarnMin}
                onChange={(e) => {
                  setExpiryWarnMin(e.target.value)
                  setPage(1)
                }}
                placeholder="开始（如 0 或 -30）"
                style={{ minWidth: 120 }}
                title="到期日-今天的最小值，支持负数"
              />
              <input
                className="a-filter-input"
                value={expiryWarnMax}
                onChange={(e) => {
                  setExpiryWarnMax(e.target.value)
                  setPage(1)
                }}
                placeholder="结束（如 30 或 30）"
                style={{ minWidth: 120 }}
                title="到期日-今天的最大值，支持负数"
              />
              <button
                className="a-btn ghost"
                onClick={() => setPage(1)}
                title="使用当前筛选条件进行查询（当前页面为前端过滤演示）"
              >
                查询
              </button>
              <button className="a-btn ghost" onClick={resetContractFilters} title="清空筛选条件">
                重置
              </button>
            </div>
            <span className="a-muted">共 {filtered.length} 条</span>
          </div>
          <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="a-btn" onClick={openCreateModal}>
              新建合同
            </button>
            <button className="a-btn ghost" onClick={load}>
              刷新
            </button>
          </div>
        </div>
        {demoMode.enabled ? (
          <div className="a-muted" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6 }}>
            当前为<strong>演示数据模式</strong>（{demoMode.reason}）。列表中的“查看详情/续签/换房/退租/修改合同配置”等操作将不会调用后端。
          </div>
        ) : null}
        <div style={{ height: 10 }} />
        <div className="a-table-wrap">
        <table className="a-table a-table-sticky-op">
          <thead>
            <tr>
              <th>合同</th>
              <th>房源ID</th>
              <th>公寓</th>
              <th>房号</th>
              <th>所属门店</th>
              <th>租客</th>
              <th>手机号</th>
              <th>状态</th>
              <th>报备</th>
              <th title="从「还有30天到期」起倒计时至当天；已到期则显示「已过期N天」（超30天另有汇总文案）">到期提醒</th>
              <th>备注</th>
              <th>附件</th>
              <th title="换房/续签时新旧合同互相关联">关联来源</th>
              <th title="系统流程/管理员手动创建">合同来源</th>
              <th className="contracts-op-col">操作</th>
            </tr>
          </thead>
          <tbody>
            {pageData.items.map((c) => (
              <tr key={c.id}>
                <td>
                  <span style={{ fontWeight: 600 }}>{formatContractNo(c.contractNo)}</span>
                </td>
                <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{c.house.houseBizId}</td>
                <td style={{ fontWeight: 600 }}>{c.house.apartmentName}</td>
                <td style={{ fontWeight: 600 }}>{c.house.houseNo}</td>
                <td className="a-muted">{c.house.storeName}</td>
                <td>{formatTenantName(c.tenant.name)}</td>
                <td>{c.tenant.phone}</td>
                <td>
                  <span className={statusBadgeClass(c.status)}>
                    {CONTRACT_STATUS_ZH[c.status] ?? c.status}
                  </span>
                </td>
                <td>
                  <span className={reportStatusBadgeClass(c.housingReportStatus)}>
                    {REPORT_STATUS_ZH[c.housingReportStatus ?? 'null'] ?? '未报备'}
                  </span>
                </td>
                <td>
                  {(() => {
                    const daysLeft = calcDaysTo(c.endDate)
                    if (Number.isNaN(daysLeft) || daysLeft > 30) return null
                    const isSoon = daysLeft <= 7
                    return (
                      <span style={{ fontWeight: 800, color: isSoon ? '#b91c1c' : '#f59e0b' }}>
                        {expiryWarnText(daysLeft)}
                      </span>
                    )
                  })()}
                </td>
                <td className="a-muted" style={{ maxWidth: 140, fontSize: 12 }}>
                  {c.remarkPreview ?? '—'}
                </td>
                <td className="a-muted" style={{ fontSize: 12, maxWidth: 200 }}>
                  {(c.attachmentCount ?? 0) === 0 ? (
                    '—'
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span>{c.attachmentCount} 个</span>
                      {(c.attachmentFiles ?? []).map((a) => (
                        <span key={a.file} style={{ whiteSpace: 'nowrap' }}>
                          <span title={a.name}>{a.name.length > 14 ? `${a.name.slice(0, 14)}…` : a.name}</span>{' '}
                          <button
                            type="button"
                            className="a-btn ghost"
                            style={{ padding: '0 6px', fontSize: 11 }}
                            onClick={() =>
                              previewFileWithAuth(
                                `/api/admin/contracts/${c.id}/attachment/${encodeURIComponent(a.file)}`,
                              ).catch(() => setError('预览失败'))
                            }
                          >
                            预览
                          </button>
                          <button
                            type="button"
                            className="a-btn ghost"
                            style={{ padding: '0 6px', fontSize: 11 }}
                            onClick={() =>
                              downloadFileWithAuth(
                                `/api/admin/contracts/${c.id}/attachment/${encodeURIComponent(a.file)}?download=1`,
                                a.name,
                              ).catch(() => setError('下载失败'))
                            }
                          >
                            下载
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ fontSize: 12, lineHeight: 1.55, minWidth: 168 }}>
                  {c.changeHouseFromContractNo ? (
                    <div title="租客换房后在新房签约的「新合同」，与左侧旧合同成对出现">
                      <span className="a-pill ch-new">换房·新合同</span>
                      <div className="a-muted" style={{ marginTop: 4 }}>
                        上一份（旧房）：
                        <strong>{formatContractNo(c.changeHouseFromContractNo)}</strong>
                      </div>
                    </div>
                  ) : null}
                  {c.renewedFromContractNo ? (
                    <div title="本合同由续签生成">
                      <span className="a-pill" style={{ background: '#f0fdf4', color: '#166534' }}>
                        续签
                      </span>
                      <div className="a-muted" style={{ marginTop: 4 }}>
                        上一份：<strong>{formatContractNo(c.renewedFromContractNo)}</strong>
                      </div>
                    </div>
                  ) : null}
                  {(() => {
                    const child = contractNoToChildren.get(c.contractNo)
                    if (!child) return null
                    const lines: Array<{ label: string; toNo: string; title: string; kind: 'ch' | 'rn' }> = []
                    for (const toNo of child.changeHouseTo.slice(0, 3)) {
                      lines.push({
                        label: '换房后新签',
                        toNo,
                        title: '本合同为旧房合同，换房后租客在新房签了下列新合同',
                        kind: 'ch',
                      })
                    }
                    for (const toNo of child.renewedTo.slice(0, 2)) {
                      lines.push({
                        label: '续签生成',
                        toNo,
                        title: '续签生成的新合同',
                        kind: 'rn',
                      })
                    }
                    return lines.map((x) => (
                      <div key={`${x.label}${x.toNo}`} title={x.title} style={{ marginTop: 6 }}>
                        <span className={x.kind === 'ch' ? 'a-pill ch-old' : 'a-pill'}>{x.label}</span>
                        <div className="a-muted" style={{ marginTop: 4 }}>
                          → <strong>{formatContractNo(x.toNo)}</strong>
                        </div>
                      </div>
                    ))
                  })()}
                  {!c.changeHouseFromContractNo &&
                  !c.renewedFromContractNo &&
                  !contractNoToChildren.has(c.contractNo)
                    ? '—'
                    : null}
                </td>
                <td className="a-muted" style={{ fontSize: 12 }}>
                  {(c.source ?? 'SYSTEM') === 'MANUAL_IMPORT' ? '手动导入' : '系统生成'}
                </td>
                <td className="contracts-op-cell">
                  <div className="contracts-op-actions">
                    <button
                      className="a-btn ghost"
                      onClick={() => {
                        if (demoMode.enabled) return setMsg('演示数据不支持查看详情（请连接真实数据后体验）')
                        loadDetail(c.id)
                      }}
                      disabled={detailLoadingId === c.id}
                    >
                      {detailLoadingId === c.id ? '加载中…' : '查看详情'}
                    </button>
                    {c.status === 'ACTIVE' ? (
                      <div className="contracts-op-group">
                        <button
                          className="a-btn"
                          onClick={() => {
                            if (demoMode.enabled) return setMsg('演示数据不支持续签（请连接真实数据后体验）')
                            openRenewModal(c)
                          }}
                          title="须费用结清"
                        >
                          续签
                        </button>
                        <button
                          className="a-btn ghost"
                          onClick={() => {
                            if (demoMode.enabled) return setMsg('演示数据不支持换房（请连接真实数据后体验）')
                            openChangeHouseModal(c)
                          }}
                          title="生成新合同"
                        >
                          换房
                        </button>
                        <button
                          className="a-btn secondary"
                          onClick={() => {
                            if (demoMode.enabled) return setMsg('演示数据不支持退租（请连接真实数据后体验）')
                            openMoveOutModal(c)
                          }}
                        >
                          退租
                        </button>
                      </div>
                    ) : null}
                    {c.status === 'TERMINATED' ? (
                      <button
                        className="a-btn"
                        onClick={() => {
                          if (demoMode.enabled) return setMsg('演示数据不支持退押金（请连接真实数据后体验）')
                          openRefundDepositModal(c)
                        }}
                        title={c.depositRefunded ? '该合同已存在退押金记录，可继续补退' : '为该退租合同办理退押金'}
                      >
                        {c.depositRefunded ? '再次退押金' : '退押金'}
                      </button>
                    ) : null}
                    {c.status !== 'ACTIVE' && (c.modificationRequestedAt || c.modificationRejectedAt) ? (
                      <button
                        className="a-btn ghost"
                        onClick={() => {
                          if (demoMode.enabled) return setMsg('演示数据不支持修改合同配置（请连接真实数据后体验）')
                          setEditLoadingId(c.id)
                        }}
                        disabled={editLoadingId === c.id || c.status === 'VOID' || c.status === 'TERMINATED'}
                        title={c.modificationRejectedAt ? '租客申请已驳回，可重新配置' : '租客已申请修改，点击处理'}
                      >
                        {editLoadingId === c.id ? '加载中…' : '修改合同配置'}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={14} className="a-muted">
                  暂无合同。请先去“订单”页面生成合同。
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

      {/* 退租 */}
      {moveOutModal && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMoveOutModal(null)
          }}
        >
          <div className="a-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">办理退租 · {formatContractNo(moveOutModal.contractNo)}</div>
              <button className="a-modal-close" onClick={() => setMoveOutModal(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-muted" style={{ marginBottom: 10 }}>
                {moveOutModal.status === 'PENDING_PAYMENT'
                  ? '当前为待支付：确认后合同作废，房源释放为空置。'
                  : '当前为在租：确认后退租结案，房源标记为已退租。'}
              </div>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">{moveOutModal.status === 'PENDING_PAYMENT' ? '作废日期' : '退租日期'}</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="date"
                      value={moveOutDate}
                      onChange={(e) => setMoveOutDate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">退租原因</div>
                  <div className="a-kv-v">
                    <select
                      className="a-filter-select"
                      value={moveOutReason}
                      onChange={(e) => setMoveOutReason(e.target.value)}
                    >
                      <option value="">请选择</option>
                      {MOVE_OUT_REASON_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {moveOutReason === '其他' && (
                  <div className="a-kv-row">
                    <div className="a-kv-k">其他原因</div>
                    <div className="a-kv-v">
                      <input
                        className="a-filter-input"
                        placeholder="请填写"
                        value={moveOutReasonOther}
                        onChange={(e) => setMoveOutReasonOther(e.target.value)}
                      />
                    </div>
                  </div>
                )}
                <div className="a-kv-row">
                  <div className="a-kv-k">备注</div>
                  <div className="a-kv-v">
                    <textarea
                      className="a-filter-input"
                      placeholder="选填"
                      rows={3}
                      value={moveOutRemark}
                      onChange={(e) => setMoveOutRemark(e.target.value)}
                      style={{ resize: 'vertical', minHeight: 60 }}
                    />
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  className="a-btn secondary"
                  onClick={submitMoveOut}
                  disabled={moveOutSubmitting}
                >
                  {moveOutSubmitting ? '提交中…' : '确认办理退租'}
                </button>
                <button className="a-btn ghost" onClick={() => setMoveOutModal(null)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 退押金 */}
      {refundDepositModal && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRefundDepositModal(null)
          }}
        >
          <div className="a-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">退押金 · {formatContractNo(refundDepositModal.contractNo)}</div>
              <button className="a-modal-close" onClick={() => setRefundDepositModal(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-muted" style={{ marginBottom: 12, lineHeight: 1.6 }}>
                仅支持已退租（已终止）合同。支持部分退押金。
                <br />
                已退累计：<strong>¥{refundDepositModal.refundedDepositAmount ?? 0}</strong>
              </div>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">退押金金额（元）</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="number"
                      min={1}
                      step={1}
                      placeholder="请输入金额，例如 1200"
                      value={refundDepositAmount}
                      onChange={(e) => setRefundDepositAmount(e.target.value)}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">备注</div>
                  <div className="a-kv-v">
                    <textarea
                      className="a-filter-input"
                      placeholder="可选：例如 扣除保洁费200元"
                      rows={3}
                      value={refundDepositRemark}
                      onChange={(e) => setRefundDepositRemark(e.target.value)}
                      style={{ resize: 'vertical', minHeight: 60 }}
                    />
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="a-btn" onClick={submitRefundDeposit} disabled={refundDepositSubmitting}>
                  {refundDepositSubmitting ? '提交中…' : '确认退押金'}
                </button>
                <button className="a-btn ghost" onClick={() => setRefundDepositModal(null)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 续签 */}
      {renewModal && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setRenewModal(null)
              setRenewElig(null)
            }
          }}
        >
          <div className="a-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">续签 · {formatContractNo(renewModal.contractNo)}</div>
              <button
                className="a-modal-close"
                onClick={() => {
                  setRenewModal(null)
                  setRenewElig(null)
                }}
              >
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              {renewElig && !renewElig.eligible ? (
                <div className="a-error" style={{ marginBottom: 12 }}>
                  {renewElig.reason ?? '当前不可续签'}
                </div>
              ) : null}
              {renewElig?.eligible ? (
                <>
                  <div
                    style={{
                      marginBottom: 14,
                      padding: 12,
                      background: '#f8fafc',
                      borderRadius: 10,
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>旧合同租客信息（自动沿用至新合同）</div>
                    <div className="a-muted" style={{ lineHeight: 1.7 }}>
                      姓名：{renewElig.tenant.name}
                      <br />
                      手机：{renewElig.tenant.phone}
                      <br />
                      身份证：{renewElig.tenant.idNumber ?? '—'}
                      <br />
                      微信：{renewElig.tenant.wechat ?? '—'}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 13, color: '#64748b' }}>
                      关联旧合同编号：<strong>{formatContractNo(renewElig.previousContractNo ?? renewModal.contractNo)}</strong>
                      （续签成功后新合同将记录此关联）
                    </div>
                  </div>
                  <div className="a-muted" style={{ marginBottom: 12 }}>
                    请设置<strong>新租期起算日</strong>及租金条件。旧合同将结案，新合同从「待租客签字」开始；须已结清旧合同全部账单。
                  </div>
                  <div className="a-kv">
                    <div className="a-kv-row">
                      <div className="a-kv-k">新租期起算日</div>
                      <div className="a-kv-v">
                        <input
                          className="a-filter-input"
                          type="date"
                          value={renewForm.moveInDate}
                          onChange={(e) => setRenewForm((f) => ({ ...f, moveInDate: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="a-kv-row">
                      <div className="a-kv-k">租期（月）</div>
                      <div className="a-kv-v">
                        <input
                          className="a-filter-input"
                          type="number"
                          min={1}
                          max={36}
                          value={renewForm.leaseMonths}
                          onChange={(e) =>
                            setRenewForm((f) => ({ ...f, leaseMonths: Number(e.target.value) || 12 }))
                          }
                        />
                      </div>
                    </div>
                    <div className="a-kv-row">
                      <div className="a-kv-k">月租（元）</div>
                      <div className="a-kv-v">
                        <input
                          className="a-filter-input"
                          type="number"
                          min={1}
                          value={renewForm.rentMonthly}
                          onChange={(e) =>
                            setRenewForm((f) => ({ ...f, rentMonthly: Number(e.target.value) || 0 }))
                          }
                        />
                      </div>
                    </div>
                    <div className="a-kv-row">
                      <div className="a-kv-k">押金倍数</div>
                      <div className="a-kv-v">
                        <input
                          className="a-filter-input"
                          type="number"
                          step={0.5}
                          min={0.5}
                          value={renewForm.depositMultiple}
                          onChange={(e) =>
                            setRenewForm((f) => ({ ...f, depositMultiple: Number(e.target.value) || 1 }))
                          }
                        />
                      </div>
                    </div>
                    <div className="a-kv-row">
                      <div className="a-kv-k">缴费周期</div>
                      <div className="a-kv-v">
                        <select
                          className="a-filter-select"
                          value={renewForm.rentCycle}
                          onChange={(e) =>
                            setRenewForm((f) => ({
                              ...f,
                              rentCycle: e.target.value as 'MONTHLY' | 'QUARTERLY' | 'YEARLY',
                            }))
                          }
                        >
                          <option value="MONTHLY">月付</option>
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
                          value={renewForm.penaltyFormula}
                          onChange={(e) => setRenewForm((f) => ({ ...f, penaltyFormula: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="a-kv-row">
                      <div className="a-kv-k">最晚交租宽限期（天）</div>
                      <div className="a-kv-v">
                        <input
                          className="a-filter-input"
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder="例如 5，留空表示未约定"
                          value={renewForm.latestRentGraceDays}
                          onChange={(e) =>
                            setRenewForm((f) => ({ ...f, latestRentGraceDays: e.target.value.replace(/\D/g, '') }))
                          }
                        />
                        <div className="a-muted" style={{ marginTop: 4, fontSize: 12 }}>
                          相对每期应付日的宽限天数，与月付/季付/年付兼容。
                        </div>
                      </div>
                    </div>
                    <div className="a-kv-row" style={{ alignItems: 'flex-start' }}>
                      <div className="a-kv-k">备注</div>
                      <div className="a-kv-v" style={{ maxWidth: '100%' }}>
                        <ContractRemarkEditor value={renewRemarkHtml} onChange={setRenewRemarkHtml} />
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <div className="a-muted" style={{ marginBottom: 6 }}>
                      附件（提交续签后上传到<strong>新合同</strong>，单文件 ≤15MB）
                    </div>
                    <input
                      type="file"
                      multiple
                      onChange={(e) => setRenewPendingFiles(Array.from(e.target.files || []))}
                    />
                    {renewPendingFiles.length > 0 ? (
                      <div className="a-muted" style={{ marginTop: 6, fontSize: 12 }}>
                        待上传 {renewPendingFiles.length} 个：{renewPendingFiles.map((f) => f.name).join('、')}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      className="a-btn"
                      onClick={submitRenew}
                      disabled={renewSubmitting || !renewForm.moveInDate || renewForm.rentMonthly <= 0}
                    >
                      {renewSubmitting ? '提交中…' : '确认续签'}
                    </button>
                    <button
                      className="a-btn ghost"
                      onClick={() => {
                        setRenewModal(null)
                        setRenewElig(null)
                      }}
                    >
                      取消
                    </button>
                  </div>
                </>
              ) : renewElig ? null : (
                <div className="a-muted">加载中…</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 换房：新合同 + 补差账单 */}
      {changeHouseModal && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setChangeHouseModal(null)
          }}
        >
          <div className="a-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">换房 · {formatContractNo(changeHouseModal.contractNo)}</div>
              <button className="a-modal-close" onClick={() => setChangeHouseModal(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div
                style={{
                  padding: 12,
                  background: '#f8fafc',
                  borderRadius: 10,
                  marginBottom: 14,
                  fontSize: 13,
                  lineHeight: 1.6,
                  border: '1px solid #e2e8f0',
                }}
              >
                <strong>流程说明</strong>
                <br />
                1）旧合同在<strong>换房日</strong>当日结束后终止，旧房释放为空置。
                <br />
                2）系统生成<strong>新合同</strong>（新房），起租日以您填写的「新合同起租日」为准；租客完成签字并支付后，新合同在新房生效。
                <br />
                3）补差仅针对<strong>押金</strong>：若<strong>新押金 &gt; 旧押金</strong>，自动生成一笔「换房补差」账单（押金补足），租客需支付差额。若新押金 ≤ 旧押金：不生成补差账单；旧押金多于新押金的部分<strong>不退还</strong>租客。
                <br />
                4）须已结清本合同全部未付账单。
              </div>

              <div className="a-kv" style={{ marginBottom: 12 }}>
                <div className="a-kv-row">
                  <div className="a-kv-k">当前旧房条件</div>
                  <div className="a-kv-v">
                    月租 ¥{chOldRent} · 押金 ¥{chOldDeposit}
                  </div>
                </div>
              </div>

              {changeHouseOptions.length === 0 ? (
                <div className="a-error">暂无同门店可换的空置房源</div>
              ) : (
                <>
                  <div className="a-kv">
                    <div className="a-kv-row">
                      <div className="a-kv-k">迁入房源</div>
                      <div className="a-kv-v">
                        <select
                          className="a-filter-select"
                          style={{ width: '100%', maxWidth: 360 }}
                          value={changeHouseTargetId}
                          onChange={(e) => setChangeHouseTargetId(e.target.value)}
                        >
                          <option value="">请选择新房</option>
                          {changeHouseOptions.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.apartmentName} · {h.houseNo}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="a-kv-row">
                      <div className="a-kv-k">换房日</div>
                      <div className="a-kv-v">
                        <input
                          className="a-filter-input"
                          type="date"
                          value={chMoveDate}
                          onChange={(e) => setChMoveDate(e.target.value)}
                        />
                        <div className="a-muted" style={{ fontSize: 12, marginTop: 4 }}>
                          旧合同于此日结束后终止，旧房空置。
                        </div>
                      </div>
                    </div>
                    <div className="a-kv-row">
                      <div className="a-kv-k">新合同起租日</div>
                      <div className="a-kv-v">
                        <input
                          className="a-filter-input"
                          type="date"
                          value={chNewStart}
                          onChange={(e) => setChNewStart(e.target.value)}
                        />
                        <div className="a-muted" style={{ fontSize: 12, marginTop: 4 }}>
                          不得早于换房日；支付完成后在新房履约。
                        </div>
                      </div>
                    </div>
                    <div className="a-kv-row">
                      <div className="a-kv-k">新租期（月）</div>
                      <div className="a-kv-v">
                        <input
                          className="a-filter-input"
                          type="number"
                          min={1}
                          max={36}
                          value={chLeaseMonths}
                          onChange={(e) => setChLeaseMonths(Number(e.target.value) || 12)}
                        />
                      </div>
                    </div>
                    <div className="a-kv-row">
                      <div className="a-kv-k">新月租（元/月）</div>
                      <div className="a-kv-v">
                        <input
                          className="a-filter-input"
                          type="number"
                          min={1}
                          value={chNewRent || ''}
                          onChange={(e) => setChNewRent(Number(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                    <div className="a-kv-row">
                      <div className="a-kv-k">新押金（元）</div>
                      <div className="a-kv-v">
                        <input
                          className="a-filter-input"
                          type="number"
                          min={0}
                          value={chNewDeposit}
                          onChange={(e) => setChNewDeposit(Number(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      padding: 12,
                      background: chSupplementPreview.total > 0 ? '#fffbeb' : '#f1f5f9',
                      borderRadius: 10,
                      border: `1px solid ${chSupplementPreview.total > 0 ? '#fde68a' : '#e2e8f0'}`,
                    }}
                  >
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>补差账单预览</div>
                    <div className="a-muted" style={{ fontSize: 13, marginBottom: 8 }}>{chSupplementPreview.note}</div>
                    {chSupplementPreview.lines.length > 0 ? (
                      <div className="a-table-wrap">
                      <table className="a-table" style={{ fontSize: 13 }}>
                        <thead>
                          <tr>
                            <th>收款明细</th>
                            <th>金额</th>
                          </tr>
                        </thead>
                        <tbody>
                          {chSupplementPreview.lines.map((l) => (
                            <tr key={l.name}>
                              <td>{l.name}</td>
                              <td>¥{l.amount}</td>
                            </tr>
                          ))}
                          <tr>
                            <td style={{ fontWeight: 800 }}>合计</td>
                            <td style={{ fontWeight: 800 }}>¥{chSupplementPreview.total}</td>
                          </tr>
                        </tbody>
                      </table>
                      </div>
                    ) : null}
                  </div>

                  <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      className="a-btn"
                      onClick={submitChangeHouse}
                      disabled={
                        changeHouseSubmitting ||
                        !changeHouseTargetId ||
                        !chMoveDate ||
                        !chNewStart ||
                        chNewRent <= 0
                      }
                    >
                      {changeHouseSubmitting ? '提交中…' : '确认换房并生成新合同'}
                    </button>
                    <button className="a-btn ghost" onClick={() => setChangeHouseModal(null)}>
                      取消
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 修改配置合同信息弹窗 */}
      {editContract && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditContract(null)
          }}
        >
          <div className="a-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">修改合同配置 · {formatContractNo(editContract.contractNo)}</div>
              <button className="a-modal-close" onClick={() => setEditContract(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-muted" style={{ marginBottom: 12 }}>
                房源：{editContract.house.apartmentName} {editContract.house.houseNo}（{editContract.house.storeName}）
              </div>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">起租日</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="date"
                      value={editForm.startDate}
                      onChange={(e) => setEditForm((f) => ({ ...f, startDate: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">到期日</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="date"
                      value={editForm.endDate}
                      onChange={(e) => setEditForm((f) => ({ ...f, endDate: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">月租（元）</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="number"
                      min={1}
                      value={editForm.rentMonthly || ''}
                      onChange={(e) => setEditForm((f) => ({ ...f, rentMonthly: Number(e.target.value) || 0 }))}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">押金（元）</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="number"
                      min={0}
                      value={editForm.deposit || ''}
                      onChange={(e) => setEditForm((f) => ({ ...f, deposit: Number(e.target.value) || 0 }))}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">缴费周期</div>
                  <div className="a-kv-v">
                    <select
                      className="a-filter-select"
                      value={editForm.rentCycle}
                      onChange={(e) => setEditForm((f) => ({ ...f, rentCycle: e.target.value as 'MONTHLY' | 'QUARTERLY' | 'YEARLY' }))}
                    >
                      <option value="MONTHLY">月付</option>
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
                      type="text"
                      placeholder="如 amount*0.1%*days"
                      value={editForm.penaltyFormula}
                      onChange={(e) => setEditForm((f) => ({ ...f, penaltyFormula: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">最晚交租宽限期（天）</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="例如 5，留空表示未约定"
                      title="相对每期应付日的宽限天数"
                      value={editForm.latestRentGraceDays}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, latestRentGraceDays: e.target.value.replace(/\D/g, '') }))
                      }
                    />
                    <div className="a-muted" style={{ marginTop: 4, fontSize: 12 }}>
                      可选；留空表示未约定。保存后写入合同。
                    </div>
                  </div>
                </div>
                <div className="a-kv-row" style={{ alignItems: 'flex-start' }}>
                  <div className="a-kv-k">备注</div>
                  <div className="a-kv-v" style={{ maxWidth: '100%' }}>
                    <ContractRemarkEditor value={editRemarkHtml} onChange={setEditRemarkHtml} />
                  </div>
                </div>
                <div className="a-kv-row" style={{ alignItems: 'flex-start' }}>
                  <div className="a-kv-k">附件</div>
                  <div className="a-kv-v">
                    <input
                      type="file"
                      onChange={async (e) => {
                        const f = e.target.files?.[0]
                        e.target.value = ''
                        if (!f || !editContract) return
                        const r = await apiUploadContractAttachment(editContract.id, f)
                        if (!r.ok) return setError(r.error)
                        setEditAttachments(r.data.attachments.map((a) => ({
                          ...a,
                          previewUrl: `/api/admin/contracts/${editContract.id}/attachment/${encodeURIComponent(a.file)}`,
                          downloadUrl: `/api/admin/contracts/${editContract.id}/attachment/${encodeURIComponent(a.file)}?download=1`,
                        })))
                      }}
                    />
                    <div className="a-muted" style={{ fontSize: 12, marginTop: 4 }}>单文件 ≤15MB，可多次添加</div>
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                      {editAttachments.map((a) => (
                        <li key={a.id} style={{ marginBottom: 4 }}>
                          <input
                            className="a-filter-input"
                            style={{ width: 260, maxWidth: '100%', marginRight: 8, height: 30 }}
                            value={a.name}
                            onChange={(e) => {
                              const nextName = e.target.value
                              setEditAttachments((list) =>
                                list.map((x) => (x.id === a.id ? { ...x, name: nextName } : x)),
                              )
                            }}
                            placeholder="附件名称"
                          />
                          <button
                            type="button"
                            className="a-btn ghost"
                            style={{ padding: '2px 8px', fontSize: 12 }}
                            onClick={() => previewFileWithAuth(a.previewUrl).catch(() => setError('预览失败'))}
                          >
                            预览
                          </button>{' '}
                          <button
                            type="button"
                            className="a-btn ghost"
                            style={{ padding: '2px 8px', fontSize: 12 }}
                            onClick={() =>
                              downloadFileWithAuth(a.downloadUrl, a.name).catch(() => setError('下载失败'))
                            }
                          >
                            下载
                          </button>{' '}
                          <button
                            type="button"
                            className="a-btn ghost"
                            style={{ padding: '2px 8px', fontSize: 12 }}
                            onClick={async () => {
                              if (!editContract) return
                              const r = await apiDeleteContractAttachment(editContract.id, a.file)
                              if (!r.ok) return setError(r.error)
                              setEditAttachments(
                                r.data.attachments.map((x) => ({
                                  ...x,
                                  previewUrl: `/api/admin/contracts/${editContract.id}/attachment/${encodeURIComponent(x.file)}`,
                                  downloadUrl: `/api/admin/contracts/${editContract.id}/attachment/${encodeURIComponent(x.file)}?download=1`,
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
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  className="a-btn"
                  onClick={submitEditConfig}
                  disabled={editSubmitting || !editForm.startDate || !editForm.endDate || editForm.rentMonthly <= 0}
                >
                  {editSubmitting ? '保存中…' : '保存'}
                </button>
                <button className="a-btn ghost" onClick={() => setEditContract(null)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 管理员手动新建合同 */}
      {createModalOpen ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !createSubmitting) setCreateModalOpen(false)
          }}
        >
          <div className="a-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">新建合同（管理员手动创建，直接生效）</div>
              <button className="a-modal-close" onClick={() => setCreateModalOpen(false)} disabled={createSubmitting}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-muted" style={{ marginBottom: 12, lineHeight: 1.6 }}>
                该合同的<strong>合同来源</strong>将标记为「手动导入」。无需租客签字/盖章/支付，创建后直接为「已生效」。
              </div>

              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">房源（空置）</div>
                  <div className="a-kv-v">
                    <select
                      className="a-filter-select"
                      value={createForm.houseId}
                      onChange={(e) => setCreateForm((f) => ({ ...f, houseId: e.target.value }))}
                      style={{ width: '100%' }}
                    >
                      <option value="">请选择空置房源</option>
                      {createHouseOptions.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.storeName} / {h.apartmentName} / {h.houseNo}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">租客姓名</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      value={createForm.tenantName}
                      onChange={(e) => setCreateForm((f) => ({ ...f, tenantName: e.target.value }))}
                      placeholder="例如：张三"
                    />
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">手机号</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      value={createForm.tenantPhone}
                      onChange={(e) => setCreateForm((f) => ({ ...f, tenantPhone: e.target.value }))}
                      placeholder="例如：13800000000"
                    />
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">身份证号</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      value={createForm.tenantIdNumber}
                      onChange={(e) => setCreateForm((f) => ({ ...f, tenantIdNumber: e.target.value }))}
                      placeholder="用于合同资料留档"
                    />
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">起租日</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="date"
                      value={createForm.startDate}
                      onChange={(e) => setCreateForm((f) => ({ ...f, startDate: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">租期（月）</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="number"
                      value={createForm.leaseMonths}
                      onChange={(e) =>
                        setCreateForm((f) => ({ ...f, leaseMonths: Number(e.target.value || 0) }))
                      }
                      min={1}
                      max={36}
                    />
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">月租（元）</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="number"
                      value={createForm.rentMonthly}
                      onChange={(e) => setCreateForm((f) => ({ ...f, rentMonthly: Number(e.target.value || 0) }))}
                      min={0}
                    />
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">押金（元）</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="number"
                      value={createForm.deposit}
                      onChange={(e) => setCreateForm((f) => ({ ...f, deposit: Number(e.target.value || 0) }))}
                      min={0}
                    />
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">租金周期</div>
                  <div className="a-kv-v">
                    <select
                      className="a-filter-select"
                      value={createForm.rentCycle}
                      onChange={(e) => setCreateForm((f) => ({ ...f, rentCycle: e.target.value as any }))}
                    >
                      <option value="MONTHLY">月付</option>
                      <option value="QUARTERLY">季付</option>
                      <option value="YEARLY">年付</option>
                    </select>
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">最晚交租宽限期（天）</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="可不填"
                      value={createForm.latestRentGraceDays}
                      onChange={(e) =>
                        setCreateForm((f) => ({ ...f, latestRentGraceDays: e.target.value.replace(/\D/g, '') }))
                      }
                    />
                    <div className="a-muted" style={{ marginTop: 4, fontSize: 12 }}>
                      相对每期应付日的宽限天数。
                    </div>
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">备注（富文本）</div>
                  <div className="a-kv-v">
                    <ContractRemarkEditor value={createForm.remarkHtml} onChange={(v) => setCreateForm((f) => ({ ...f, remarkHtml: v }))} />
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">附件</div>
                  <div className="a-kv-v">
                    <div className="a-muted" style={{ marginBottom: 8 }}>
                      创建后上传到<strong>新合同</strong>，单文件 ≤15MB
                    </div>
                    <input
                      type="file"
                      multiple
                      onChange={(e) => {
                        const list = Array.from(e.target.files ?? [])
                        if (list.length > 0) setCreatePendingFiles((prev) => [...prev, ...list])
                        e.currentTarget.value = ''
                      }}
                    />
                    {createPendingFiles.length > 0 ? (
                      <div className="a-muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
                        待上传 {createPendingFiles.length} 个：
                        {createPendingFiles.map((f, idx) => (
                          <span key={`${f.name}-${idx}`}>
                            {' '}
                            {f.name}
                            <button
                              type="button"
                              className="a-btn ghost"
                              style={{ padding: '0 6px', fontSize: 11, marginLeft: 6 }}
                              onClick={() =>
                                setCreatePendingFiles((prev) => prev.filter((_, i) => i !== idx))
                              }
                              disabled={createSubmitting}
                            >
                              移除
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button className="a-btn ghost" onClick={() => setCreateModalOpen(false)} disabled={createSubmitting}>
                  取消
                </button>
                <button className="a-btn" onClick={submitCreate} disabled={createSubmitting}>
                  {createSubmitting ? '创建中…' : '确认创建并生效'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 合同详情（生命周期）弹窗 */}
      {detailContract && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailContract(null)
          }}
        >
          <div className="a-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">合同详情 · {formatContractNo(detailContract.contractNo)}</div>
              <button className="a-modal-close" onClick={() => setDetailContract(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">当前状态</div>
                  <div className="a-kv-v">
                    <span className={statusBadgeClass(detailContract.status)}>
                      {CONTRACT_STATUS_ZH[detailContract.status] ?? detailContract.status}
                    </span>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">房源</div>
                  <div className="a-kv-v">
                    {detailContract.house.apartmentName} {detailContract.house.houseNo}（{detailContract.house.storeName}）
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">租客</div>
                  <div className="a-kv-v">
                    {formatTenantName(detailContract.tenant.name)} {detailContract.tenant.phone}
                    <br />
                    <span className="a-muted" style={{ fontSize: 12 }}>
                      身份证 {detailContract.tenant.idNumber ?? '—'} · 微信 {detailContract.tenant.wechat ?? '—'}
                    </span>
                  </div>
                </div>
                {detailContract.changeHouseFromContractNo ? (
                  <div className="a-kv-row">
                    <div className="a-kv-k">换房来源</div>
                    <div className="a-kv-v">
                      本合同由换房生成，上一份（旧房）合同编号：
                      <strong>{formatContractNo(detailContract.changeHouseFromContractNo)}</strong>
                    </div>
                  </div>
                ) : null}
                {detailContract.renewedFromContractNo ? (
                  <div className="a-kv-row">
                    <div className="a-kv-k">续签关联</div>
                    <div className="a-kv-v">
                      本合同由续签生成，上一份合同编号：
                      <strong>{formatContractNo(detailContract.renewedFromContractNo)}</strong>
                    </div>
                  </div>
                ) : null}
                <div className="a-kv-row">
                  <div className="a-kv-k">租期</div>
                  <div className="a-kv-v">
                    {detailContract.startDate} 至 {detailContract.endDate}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">最晚交租宽限期（天）</div>
                  <div className="a-kv-v">
                    {detailContract.latestRentGraceDays != null ? `${detailContract.latestRentGraceDays} 天` : '—'}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">创建时间</div>
                  <div className="a-kv-v">
                    {new Date(detailContract.createdAt).toLocaleString('zh-CN', { hour12: false })}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">租客确认</div>
                  <div className="a-kv-v">
                    {detailContract.confirmedAt
                      ? new Date(detailContract.confirmedAt).toLocaleString('zh-CN', { hour12: false })
                      : '—'}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">签字时间</div>
                  <div className="a-kv-v">
                    {detailContract.signedAt
                      ? new Date(detailContract.signedAt).toLocaleString('zh-CN', { hour12: false })
                      : '—'}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">盖章时间</div>
                  <div className="a-kv-v">
                    {detailContract.stampedAt
                      ? new Date(detailContract.stampedAt).toLocaleString('zh-CN', { hour12: false })
                      : '—'}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">作废时间</div>
                  <div className="a-kv-v">
                    {detailContract.voidedAt
                      ? new Date(detailContract.voidedAt).toLocaleString('zh-CN', { hour12: false })
                      : '—'}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">终止时间</div>
                  <div className="a-kv-v">
                    {detailContract.terminatedAt
                      ? new Date(detailContract.terminatedAt).toLocaleString('zh-CN', { hour12: false })
                      : '—'}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">押金退还</div>
                  <div className="a-kv-v">
                    {detailContract.depositRefunded ? (
                      <span>
                        已退押金，累计 <strong>¥{detailContract.refundedDepositAmount ?? 0}</strong>
                      </span>
                    ) : (
                      '未退押金'
                    )}
                  </div>
                </div>
                {detailContract.configRemarkHtml ? (
                  <div className="a-kv-row" style={{ alignItems: 'flex-start' }}>
                    <div className="a-kv-k">配置备注</div>
                    <div
                      className="a-kv-v"
                      style={{ fontSize: 14, lineHeight: 1.55 }}
                      dangerouslySetInnerHTML={{ __html: detailContract.configRemarkHtml }}
                    />
                  </div>
                ) : null}
                {detailContract.attachments && detailContract.attachments.length > 0 ? (
                  <div className="a-kv-row" style={{ alignItems: 'flex-start' }}>
                    <div className="a-kv-k">附件</div>
                    <div className="a-kv-v">
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {detailContract.attachments.map((a) => (
                          <li key={a.id} style={{ marginBottom: 6 }}>
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
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
                <div className="a-kv-row">
                  <div className="a-kv-k">住房报备</div>
                  <div className="a-kv-v">
                    {detailContract.housingReport
                      ? `${REPORT_STATUS_ZH[detailContract.housingReport.status] ?? detailContract.housingReport.status}${detailContract.housingReport.reportedAt ? ` · ${new Date(detailContract.housingReport.reportedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}${detailContract.housingReport.lastError ? ` · ${detailContract.housingReport.lastError}` : ''}`
                      : '未报备'}
                  </div>
                </div>
                {detailContract.refunds.length > 0 && (
                  <div className="a-kv-row">
                    <div className="a-kv-k">退租/作废记录</div>
                    <div className="a-kv-v">
                      {detailContract.refunds.map((r, i) => (
                        <div key={i} style={{ marginBottom: 4 }}>
                          {new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })} — {r.reason}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

