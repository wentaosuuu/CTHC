import { useEffect, useMemo, useState } from 'react'
import { apiDeleteContractAttachment, apiGet, apiPatch, apiPost, apiUploadContractAttachment, apiUploadMoveOutFile } from '../api'
import { JiangnanFactoryContractForm } from '../components/JiangnanFactoryContractForm'
import { NonResidentialContractForm } from '../components/NonResidentialContractForm'
import { NanningHousingContractForm } from '../components/NanningHousingContractForm'
import { ResidentialAssetContractForm } from '../components/ResidentialAssetContractForm'
import { ContractRemarkEditor } from '../components/ContractRemarkEditor'
import { ContractTemplateSelect } from '../components/ContractTemplateSelect'
import { contractAttachmentsLockedUntilPaid } from '../contractAttachmentPolicy'
import {
  contractTemplateUsesRentMultipleTermination,
  contractTemplateZh,
  type ContractTemplateKind,
} from '../contractTemplate'
import {
  defaultJiangnanFactoryForm,
  leaseMonthsFromRange,
  performanceBondAmount,
  serializeJiangnanFactoryForm,
  sumHouseRentMonthly,
  validateJiangnanFactoryForm,
  type JiangnanFactoryFormData,
} from '../jiangnanFactoryContract'
import {
  defaultNonResidentialForm,
  leaseMonthsFromRange as nrLeaseMonthsFromRange,
  nonResidentialPerformanceBondAmount,
  serializeNonResidentialForm,
  sumHouseRentMonthly as nrSumHouseRentMonthly,
  validateNonResidentialForm,
  type NonResidentialFormData,
} from '../nonResidentialContract'
import {
  defaultResidentialAssetForm,
  leaseMonthsFromRange as raLeaseMonthsFromRange,
  residentialHousingBondAmount,
  serializeResidentialAssetForm,
  sumHouseRentMonthly as raSumHouseRentMonthly,
  validateResidentialAssetForm,
  type ResidentialAssetFormData,
} from '../residentialAssetContract'
import {
  bowanMonthlyRentNumber,
  bowanPenaltyFormula,
  bowanPerformanceBondAmount,
  defaultNanningHousingForm,
  leaseMonthsFromRange as nhLeaseMonthsFromRange,
  serializeNanningHousingForm,
  validateNanningHousingForm,
  type NanningHousingFormData,
} from '../nanningHousingContract'
import { downloadFileWithAuth, previewFileWithAuth } from '../fileAuth'
import { Pagination, paginate } from '../components/Pagination'
import { parseRentDueDayInput, rentCycleDueDayHint, rentDueDayFromYmd } from '../rentDueDay'
import { MoveOutApprovalSheet } from '../components/MoveOutApprovalSheet'
import {
  calculateMoveOutSettlement,
  DEFAULT_MOVE_OUT_PAID_ITEMS,
  DEFAULT_MOVE_OUT_RECEIVABLE_ITEMS,
  MOVE_OUT_SETTLEMENT_TYPE_OPTIONS,
  type MoveOutMoneyItem,
  type MoveOutSettlementSnapshot,
  type MoveOutSettlementType,
} from '../moveOutSettlement'

/** 与合同 rentCycle 字段及后端校验一致 */
type RentCycle = 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'YEARLY'

function normalizeRentCycle(v: string | undefined | null): RentCycle {
  if (v === 'BIMONTHLY' || v === 'QUARTERLY' || v === 'YEARLY') return v
  return 'MONTHLY'
}

function rentCycleLabel(c: RentCycle) {
  switch (c) {
    case 'MONTHLY':
      return '月付'
    case 'BIMONTHLY':
      return '双月'
    case 'QUARTERLY':
      return '季付'
    default:
      return '年付'
  }
}

/** 一单多房源合并签约：列表/详情与订单 OrderLine 对齐 */
type MergedBundleListInfo = {
  lineCount: number
  lineHistoryCount?: number
  rentMonthlySum: number
  lines: {
    houseId: string
    houseBizId: string
    apartmentName: string
    houseNo: string
    rentMonthlySnapshot: number
    releasedAt?: string | null
    changeHouseNewContractId?: string | null
    changeHouseNewContractNo?: string | null
    lineStatus?: 'IN_USE' | 'CHANGED' | 'MOVED_OUT'
    lineStatusLabel?: string
  }[]
}

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
  /** 非合并合同为 null；合并时为各子资产快照（合同主房源为 lines[0] 之一） */
  mergedBundle: MergedBundleListInfo | null
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
  /** 待租客确认退租时的签字截止（ISO） */
  moveOutSignDeadlineAt?: string | null
  billingPaused?: boolean
  billingPausedAt?: string | null
  billingResumeFrom?: string | null
  houseStatus?: string
  leaseDaysLeft?: number
  leaseExpired?: boolean
  contractTemplate?: string
  billPushToTenant?: boolean
  billPushStatus?: string | null
}

type MoveOutAnnex5Item = {
  id: string
  category: string
  name: string
  unit: string
  moveInQuantity: number
  moveInStatus: string
  moveOutStatus: '完好' | '正常损耗' | '损坏' | '缺失' | '数量减少'
  compensationQuantity: number
  referencePrice: number
  actualCompensation: number
  remark: string
  isMoveOutAdded?: boolean
}

const DEFAULT_MOVE_OUT_ANNEX5_ITEMS: MoveOutAnnex5Item[] = [
  { id: 'mo-1', category: '卫浴', name: '马桶、地漏、洗手池及户内下水支管（通水状态核验）', unit: '套', moveInQuantity: 1, moveInStatus: '完好', moveOutStatus: '完好', compensationQuantity: 0, referencePrice: 300, actualCompensation: 0, remark: '' },
  { id: 'mo-2', category: '家电', name: '冰箱', unit: '台', moveInQuantity: 1, moveInStatus: '完好', moveOutStatus: '完好', compensationQuantity: 0, referencePrice: 1200, actualCompensation: 0, remark: '' },
  { id: 'mo-3', category: '家电', name: '空调', unit: '台', moveInQuantity: 1, moveInStatus: '完好', moveOutStatus: '完好', compensationQuantity: 0, referencePrice: 1800, actualCompensation: 0, remark: '' },
  { id: 'mo-4', category: '家具', name: '床架及床垫', unit: '套', moveInQuantity: 1, moveInStatus: '完好', moveOutStatus: '完好', compensationQuantity: 0, referencePrice: 800, actualCompensation: 0, remark: '' },
  { id: 'mo-5', category: '门窗', name: '入户门锁及钥匙', unit: '套', moveInQuantity: 1, moveInStatus: '完好', moveOutStatus: '完好', compensationQuantity: 0, referencePrice: 300, actualCompensation: 0, remark: '' },
]

// 合同状态 -> 中文
const CONTRACT_STATUS_ZH: Record<string, string> = {
  WAIT_TENANT_SIGN: '待租客签字',
  WAIT_STAMP: '待盖章',
  PENDING_PAYMENT: '待支付',
  ACTIVE: '已生效',
  WAIT_TENANT_MOVEOUT_SIGN: '待租客确认退租',
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

const BILL_PUSH_STATUS_ZH: Record<string, string> = {
  NOT_ENABLED: '未开启推送',
  PENDING_TENANT: '等待租户注册',
  ACTIVE: '推送已开通',
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
    case 'WAIT_TENANT_MOVEOUT_SIGN':
      return 'a-badge status-wait-sign'
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

/** 「修改合同配置」：仅租客已申请修改或管理员已驳回、且合同仍可改配置时展示 */
function canShowEditContractConfigButton(c: {
  status: string
  modificationRequestedAt: string | null
  modificationRejectedAt: string | null
}): boolean {
  if (!c.modificationRequestedAt && !c.modificationRejectedAt) return false
  if (c.status === 'VOID' || c.status === 'TERMINATED' || c.status === 'WAIT_TENANT_MOVEOUT_SIGN') {
    return false
  }
  return true
}

/** 与 H5 合同签字倒计时风格一致（≥1 天用「X天Y小时」，否则 HH:MM:SS） */
function formatCountdownHms(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function formatSignLikeCountdown(remainingMs: number | null) {
  if (remainingMs == null) return null
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000))
  const d = Math.floor(totalSeconds / 86400)
  const h = Math.floor((totalSeconds % 86400) / 3600)
  if (d >= 1) return `${d}天${h}小时`
  return formatCountdownHms(remainingMs)
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

const EXPIRY_WARN_DAYS = 90

function expiryWarnText(daysLeft: number) {
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

/** 与后端 `DEPOSIT_REFUND_TEMPLATE_LABEL` 编码一致（占位模板名，后续可换真实文书） */
const DEPOSIT_REFUND_TEMPLATES = [
  { code: 'BOWAN_APT_STANDARD', label: '泊湾公寓 · 标准退押结算单' },
  { code: 'SHOP_STANDARD', label: '商铺 · 退租退押结算模板' },
  { code: 'FACTORY_STANDARD', label: '厂房 · 退租退押结算模板' },
  { code: 'RESIDENTIAL_STANDARD', label: '住宅 · 退租退押结算模板' },
  { code: 'CO_LIVING', label: '合租/分散式 · 退押结算模板' },
  { code: 'SERVICED_APT', label: '服务式公寓 · 退押结算模板' },
  { code: 'GENERIC_MINIMAL', label: '通用 · 简化退款确认书' },
] as const

function apiErrorZh(code: string) {
  const m: Record<string, string> = {
    BILLS_NOT_SETTLED: '请先结清该合同下所有未付/逾期账单（续签、换房均需费用结清）',
    RENEW_NEED_ACTIVE: '仅「已生效」合同可续签',
    TARGET_NOT_VACANT: '目标房源不是空置状态',
    CROSS_STORE_NOT_ALLOWED: '换房仅支持同门店下的空置房源',
    SAME_HOUSE: '不能换到当前同一套房',
    CONTRACT_ENDED: '合同已结束，无法换房',
    CONTRACT_EFFECTIVE_ORDER_LOCKED: '合同已生效/已终止/已作废，订单不可再修改',
    INVALID_RELEASE_HOUSE: '部分退租所选的房源不属于本合同或未在租',
    INVALID_SOURCE_HOUSE: '换房所选的子房源无效或已迁出',
    SOURCE_HOUSE_NEED_MERGED: '仅合并多套的合同可指定迁出子房源',
    TARGET_FORBIDDEN: '无权限操作目标房源',
    TARGET_NOT_FOUND: '目标房源不存在',
    NEW_START_BEFORE_MOVE: '新合同起租日不能早于换房日',
    CHANGE_HOUSE_NEED_ACTIVE: '仅「已生效」的在租合同可办理换房',
    DEPOSIT_REFUND_NEED_TERMINATED: '仅已退租（已终止）合同可以退押金',
    DEPOSIT_REFUND_EXCEED_DEPOSIT: '退押金金额不能超过合同可退上限',
    DEPOSIT_REFUND_NO_REMAINING: '该合同押金已全部退还，无可退余额',
    DEPOSIT_REFUND_INVALID_SELECTION: '所选账单无效或不属于本合同',
    DEPOSIT_REFUND_NOTHING_SELECTED: '请选择要退的账单或首期款记录',
    RENEW_WINDOW_NOT_OPEN: '续签须在合同到期前 2 个月内发起，当前未到窗口',
    HOUSING_RECEIPT_NOT_READY: '报备未完成或尚无回执文件，无法下载',
    HOUSING_RECEIPT_FILE_MISSING: '回执文件在服务器上不存在，请重新发起报备',
    CONTRACT_SUMMARY_BUILD_FAILED: '生成合同摘要失败，请稍后重试',
    CHANGE_HOUSE_NEED_BILLS_SETTLED:
      '换房生成的新合同：请先在「账单」中结清换房补差及剩余租金账单，再支付押金完成生效',
    USE_TERMINATE_REQUEST: '已生效合同请使用「发起退租确认」：上传附件后由租客在 7 日内电子签字确认',
    MOVEOUT_FILE_MISSING: '退租附件未找到，请重新上传后再提交',
    MOVEOUT_REQUEST_ALREADY_PENDING: '该合同已有待租客确认的退租申请，请先撤销或等待租客处理',
    INVALID_MOVEOUT_DATE: '退租日期无效，且当前版本不支持选择未来日期办理结案',
    INVALID_STOP_RENT_DATE: '停止计租日期无效或早于合同起租日期',
    NO_MOVEOUT_PENDING: '当前没有待确认的退租申请',
    TENANT_MOVEOUT_DEADLINE_EXCEEDED: '退租确认已超时，请重新发起或联系管理员',
    CONTRACT_MOVEOUT_PENDING: '当前合同正在等待租客确认退租，暂不可进行此操作',
    NEED_ACTIVE_CONTRACT: '仅「已生效」合同可暂停/恢复计费',
    ALREADY_PAUSED: '该合同已处于暂停计费状态',
    NOT_PAUSED: '该合同未暂停计费',
  }
  return m[code] ?? code
}


type ContractDetail = {
  id: string
  contractNo: string
  status: string
  source?: string
  tenant: { name: string; phone: string; idNumber?: string; wechat?: string | null }
  house: { storeName: string; apartmentName: string; houseNo: string }
  mergedBundle?: MergedBundleListInfo | null
  startDate: string
  endDate: string
  /** 书面合同签订日期（可与电子签字时间不同） */
  agreementSignDate?: string | null
  rentMonthly: number
  deposit: number
  rentCycle?: string
  penaltyFormula?: string
  rentDueDay?: number | null
  latestRentGraceDays: number | null
  configRemarkHtml?: string
  attachments?: { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }[]
  renewedFromContractNo?: string | null
  renewedFromId?: string | null
  changeHouseFromContractNo?: string | null
  changeHouseFromId?: string | null
  changeHouseMoney?: {
    version: number
    moveDateYmd: string
    oldContractId: string
    oldContractNo: string
    prepaidRentCredit: number
    prepaidRentSources: { period: string; amount: number }[]
    prepaidAppliedToPeriods: { period: string; amount: number }[]
    depositSupplement: number
    prepaidSkippedReason: string | null
    ruleSummary: string
  } | null
  createdAt: string
  confirmedAt: string | null
  signedAt: string | null
  stampedAt: string | null
  voidedAt: string | null
  terminatedAt: string | null
  tenantSignDeadlineAt?: string | null
  moveOutSignDeadlineAt?: string | null
  moveOutPending?: {
    deadlineAt: string
    reasonFull: string
    terminateDate: string
    partial: boolean
    settlement: MoveOutSettlementSnapshot | null
    attachments: { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }[]
  } | null
  moveOutArchive?: {
    completedAt: string
    completedBy: 'TENANT_CONFIRMED' | 'STORE_DIRECT'
    terminateDate: string
    reasonFull: string
    settlement?: MoveOutSettlementSnapshot
    tenantConfirmation?: { accountName: string; bankName: string; bankCardNo: string; signedAt: string }
  } | null
  housingReport: {
    status: string
    bureauRecordNo?: string | null
    receiptPdfPath: string | null
    reportedAt: string | null
    lastError: string | null
  } | null
  depositRefunded?: boolean
  refundedDepositAmount?: number
  refunds: { amount: number; reason: string; createdAt: string }[]
  contractTemplate?: string
  billPushToTenant?: boolean
  billPushStatus?: string | null
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
  /** 合并合同退租：整套 / 仅部分子房源 */
  const [moveOutScope, setMoveOutScope] = useState<'ALL' | 'PARTIAL'>('ALL')
  const [moveOutReleaseHouseIds, setMoveOutReleaseHouseIds] = useState<string[]>([])
  const [moveOutAttachments, setMoveOutAttachments] = useState<{ id: string; name: string; file: string }[]>([])
  const [moveOutStep, setMoveOutStep] = useState<1 | 2 | 3 | 4>(1)
  const [moveOutContractDetail, setMoveOutContractDetail] = useState<ContractDetail | null>(null)
  const [moveOutSettlementType, setMoveOutSettlementType] = useState<MoveOutSettlementType>('NORMAL_EXPIRY')
  const [moveOutStopRentDate, setMoveOutStopRentDate] = useState(todayYmd())
  const [moveOutRequireTenantConfirmation, setMoveOutRequireTenantConfirmation] = useState(true)
  const [moveOutPaidItems, setMoveOutPaidItems] = useState<MoveOutMoneyItem[]>(DEFAULT_MOVE_OUT_PAID_ITEMS)
  const [moveOutReceivableItems, setMoveOutReceivableItems] = useState<MoveOutMoneyItem[]>(DEFAULT_MOVE_OUT_RECEIVABLE_ITEMS)
  const [moveOutApplicationNote, setMoveOutApplicationNote] = useState('')
  const [moveOutAnnex5Items, setMoveOutAnnex5Items] = useState<MoveOutAnnex5Item[]>(DEFAULT_MOVE_OUT_ANNEX5_ITEMS)
  const [moveOutHygiene, setMoveOutHygiene] = useState<'PASS' | 'FAIL'>('PASS')
  const [moveOutCleaningFee, setMoveOutCleaningFee] = useState(0)
  const [moveOutDeposit, setMoveOutDeposit] = useState(2600)
  // 退押金
  type DepositRefundOptions = {
    contractDeposit: number
    refundedAmount: number
    maxRefundable: number
    billSources: {
      billId: string
      period: string
      kind: string
      status: string
      label: string
      maxAmount: number
      amountReceived: number
      itemSummary: string
    }[]
    paymentSource: {
      paymentId: string
      label: string
      maxAmount: number
      paidAmount: number
      paidAt: string | null
    } | null
    balanceSource: {
      id: 'CONTRACT_DEPOSIT_BALANCE'
      label: string
      maxAmount: number
    } | null
  }
  const [refundDepositModal, setRefundDepositModal] = useState<ContractItem | null>(null)
  const [refundDepositOptions, setRefundDepositOptions] = useState<DepositRefundOptions | null>(null)
  const [refundDepositOptionsLoading, setRefundDepositOptionsLoading] = useState(false)
  const [refundDepositMode, setRefundDepositMode] = useState<'FULL' | 'SELECTED'>('FULL')
  const [refundDepositBillIds, setRefundDepositBillIds] = useState<string[]>([])
  const [refundDepositIncludePayment, setRefundDepositIncludePayment] = useState(false)
  const [refundDepositIncludeBalance, setRefundDepositIncludeBalance] = useState(false)
  const [refundDepositRemark, setRefundDepositRemark] = useState('')
  const [refundDepositTemplate, setRefundDepositTemplate] = useState('')
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
    rentCycle: 'MONTHLY' as RentCycle,
    penaltyFormula: 'amount*0.1%*days',
    rentDueDay: '1',
    latestRentGraceDays: '',
  })
  const [renewSubmitting, setRenewSubmitting] = useState(false)
  const [billingResumeModal, setBillingResumeModal] = useState<ContractItem | null>(null)
  const [billingResumeFrom, setBillingResumeFrom] = useState('')
  const [billingActionSubmitting, setBillingActionSubmitting] = useState(false)
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
  /** 合并合同换房：整套迁出签新房 / 仅迁出一条子资产 */
  const [chScope, setChScope] = useState<'ALL' | 'PARTIAL'>('ALL')
  const [chSourceHouseId, setChSourceHouseId] = useState('')

  // 查看详情弹窗
  const [detailContract, setDetailContract] = useState<ContractDetail | null>(null)
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null)

  // 修改配置合同信息弹窗
  const [editContract, setEditContract] = useState<ContractDetail | null>(null)
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    startDate: '',
    endDate: '',
    agreementSignDate: '' as string,
    rentMonthly: 0,
    deposit: 0,
    rentCycle: 'MONTHLY' as RentCycle,
    penaltyFormula: 'amount*0.1%*days',
    rentDueDay: '1',
    latestRentGraceDays: '' as string, // 天数，空表示未设置
  })
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editRemarkHtml, setEditRemarkHtml] = useState('')
  const [editAttachments, setEditAttachments] = useState<
    { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }[]
  >([])

  // 管理员手动新建合同弹窗
  type HousePick = {
    id: string
    apartmentName: string
    houseNo: string
    storeName: string
    status: string
    rentMonthly: number
    deposit: number
  }
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createHouseOptions, setCreateHouseOptions] = useState<HousePick[]>([])
  const [createForm, setCreateForm] = useState({
    houseId: '',
    tenantName: '',
    tenantPhone: '',
    tenantIdNumber: '',
    startDate: todayYmd(),
    agreementSignDate: '' as string,
    leaseMonths: 12,
    rentMonthly: 0,
    depositMultiple: 1,
    rentCycle: 'MONTHLY' as RentCycle,
    penaltyFormula: 'amount*0.1%*days',
    rentDueDay: '1',
    latestRentGraceDays: '',
    remarkHtml: '',
    contractTemplate: 'RESIDENTIAL_ASSET' as ContractTemplateKind,
    terminationRentMulti: '2',
    terminationDaysPastDue: '7',
    billPushToTenant: 'yes' as 'yes' | 'no',
  })
  const [createPendingFiles, setCreatePendingFiles] = useState<File[]>([])
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [jiangnanForm, setJiangnanForm] = useState<JiangnanFactoryFormData>(() => defaultJiangnanFactoryForm())
  const [nonResidentialForm, setNonResidentialForm] = useState<NonResidentialFormData>(() => defaultNonResidentialForm())
  const [residentialForm, setResidentialForm] = useState<ResidentialAssetFormData>(() => defaultResidentialAssetForm())
  const [nanningHousingForm, setNanningHousingForm] = useState<NanningHousingFormData>(() => defaultNanningHousingForm())

  const [nowTick, setNowTick] = useState(() => Date.now())

  async function load() {
    setError('')
    setMsg('')
    const r = await apiGet<{ items: ContractItem[] }>('/api/admin/contracts')
    if (!r.ok) {
      if (r.error === 'UNAUTHORIZED') {
        setItems([])
        setError('登录已失效，请重新登录')
        return
      }
      setItems([])
      setError(r.error)
      return
    }
    const list = r.data.items ?? []
    setItems(
      list.map((c) => ({
        ...c,
        mergedBundle: c.mergedBundle ?? null,
      })),
    )
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(t)
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
        agreementSignDate: d.agreementSignDate ?? '',
        rentMonthly: d.rentMonthly,
        deposit: d.deposit,
        rentCycle: normalizeRentCycle(d.rentCycle),
        penaltyFormula: d.penaltyFormula ?? 'amount*0.1%*days',
        rentDueDay: d.rentDueDay != null ? String(d.rentDueDay) : String(rentDueDayFromYmd(d.startDate)),
        latestRentGraceDays: d.latestRentGraceDays != null ? String(d.latestRentGraceDays) : '',
      })
      setEditRemarkHtml(d.configRemarkHtml ?? '')
      setEditAttachments(d.attachments ?? [])
    })
    return () => {
      alive = false
    }
  }, [editLoadingId])

  async function openMoveOutModal(c: ContractItem) {
    setMoveOutModal(c)
    setMoveOutDate(todayYmd())
    setMoveOutReason('')
    setMoveOutReasonOther('')
    setMoveOutRemark('')
    setMoveOutScope('ALL')
    setMoveOutReleaseHouseIds([])
    setMoveOutAttachments([])
    setMoveOutStep(1)
    setMoveOutContractDetail(null)
    setMoveOutSettlementType(c.endDate <= todayYmd() ? 'NORMAL_EXPIRY' : 'BREACH_EARLY')
    setMoveOutStopRentDate(todayYmd())
    setMoveOutRequireTenantConfirmation(true)
    setMoveOutPaidItems(DEFAULT_MOVE_OUT_PAID_ITEMS.map((item) => ({ ...item })))
    setMoveOutReceivableItems(DEFAULT_MOVE_OUT_RECEIVABLE_ITEMS.map((item) => ({ ...item })))
    setMoveOutApplicationNote('')
    setMoveOutAnnex5Items(DEFAULT_MOVE_OUT_ANNEX5_ITEMS.map((item) => ({ ...item })))
    setMoveOutHygiene('PASS')
    setMoveOutCleaningFee(0)
    const detail = await apiGet<ContractDetail>('/api/admin/contracts/' + c.id)
    if (detail.ok) {
      setMoveOutContractDetail(detail.data)
      setMoveOutDeposit(detail.data.deposit || 0)
      setMoveOutPaidItems(DEFAULT_MOVE_OUT_PAID_ITEMS.map((item) => (
        item.id === 'performance-bond' ? { ...item, amount: detail.data.deposit || 0 } : { ...item }
      )))
    }
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
        rentCycle: normalizeRentCycle(r.data.rentCycle),
        penaltyFormula: r.data.penaltyFormula ?? 'amount*0.1%*days',
        rentDueDay:
          d.ok && d.data.rentDueDay != null
            ? String(d.data.rentDueDay)
            : String(rentDueDayFromYmd(nextStart)),
        latestRentGraceDays:
          d.ok && d.data.latestRentGraceDays != null ? String(d.data.latestRentGraceDays) : '',
      })
    }
  }

  async function openChangeHouseModal(c: ContractItem) {
    setError('')
    setChangeHouseModal(c)
    setChangeHouseTargetId('')
    setChScope('ALL')
    setChSourceHouseId('')
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
    setDetailContract({ ...r.data, mergedBundle: r.data.mergedBundle ?? null })
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
    const rentDueParsed = parseRentDueDayInput(editForm.rentDueDay)
    if (!rentDueParsed.ok) {
      setEditSubmitting(false)
      return setError(rentDueParsed.message)
    }
    const r = await apiPatch<{ ok: true }>('/api/admin/contracts/' + editContract.id, {
      startDate: editForm.startDate,
      endDate: editForm.endDate,
      agreementSignDate: editForm.agreementSignDate.trim() === '' ? null : editForm.agreementSignDate,
      rentMonthly: editForm.rentMonthly,
      deposit: editForm.deposit,
      rentCycle: editForm.rentCycle,
      penaltyFormula: editForm.penaltyFormula,
      rentDueDay: rentDueParsed.value,
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
      if (!moveOutDate || !moveOutStopRentDate) {
        setMoveOutSubmitting(false)
        return setError('请填写退租日期和停止计租日期')
      }
      if (moveOutDate > todayYmd()) {
        setMoveOutSubmitting(false)
        return setError('当前版本暂不支持选择未来日期立即办理退租，请在实际退租日发起')
      }
      if (moveOutStopRentDate < (moveOutContractDetail?.startDate ?? moveOutStopRentDate)) {
        setMoveOutSubmitting(false)
        return setError('停止计租日期不能早于合同起租日期')
      }
      const invalidInspection = moveOutAnnex5Items.find((item) =>
        item.moveOutStatus !== '完好' && item.moveOutStatus !== '正常损耗' && !item.remark.trim(),
      )
      if (invalidInspection) {
        setMoveOutSubmitting(false)
        return setError(`“${invalidInspection.name}”存在异常，请填写异常或赔偿说明`)
      }
      const active = moveOutModal.mergedBundle?.lines?.filter((l) => !l.releasedAt) ?? []
      if (moveOutScope === 'PARTIAL') {
        if (active.length <= 1) {
          setMoveOutSubmitting(false)
          return setError('仅当仍有 2 套及以上在租子资产时，才可选择「部分退租」')
        }
        if (moveOutReleaseHouseIds.length === 0) {
          setMoveOutSubmitting(false)
          return setError('部分退租请至少勾选一套子房源')
        }
        if (moveOutReleaseHouseIds.length >= active.length) {
          setMoveOutSubmitting(false)
          return setError('部分退租不能勾选全部在租资产，请改用「整套退租」')
        }
      }
      const r = await apiPost<{ ok: true; deadlineAt?: string; partial?: boolean; completed?: boolean }>(
        '/api/admin/contracts/' + moveOutModal.id + '/terminate-request',
        {
          terminateDate: moveOutDate,
          reason: reasonText,
          remark: moveOutRemark.trim() || undefined,
          requireTenantConfirmation: moveOutRequireTenantConfirmation,
          settlement: moveOutSettlementSnapshot,
          attachments: moveOutAttachments,
          ...(moveOutScope === 'PARTIAL' && moveOutReleaseHouseIds.length > 0
            ? { releaseHouseIds: moveOutReleaseHouseIds }
            : {}),
        },
      )
      if (!r.ok) {
        setMoveOutSubmitting(false)
        return setError(typeof r.error === 'string' ? apiErrorZh(r.error) : String(r.error))
      }
      setMsg(r.data.completed
        ? '退租结算审批表已生成并归档；本单无需租户确认，可打印后报财务办理退款。'
        : '已向租客发起退租确认：租户需核对交接与结算明细、填写退款银行卡并电子签字。')
    } else {
      setMoveOutSubmitting(false)
      return setError('当前状态不可在此办理退租（支持：待支付作废、已生效退租）')
    }
    setMoveOutSubmitting(false)
    setMoveOutModal(null)
    await load()
  }

  function goNextMoveOutStep() {
    setError('')
    if (moveOutStep === 1) {
      const reasonText = moveOutReason === '其他' ? moveOutReasonOther.trim() : moveOutReason
      if (!reasonText) return setError('请选择或填写退租原因')
      if (!moveOutDate || !moveOutStopRentDate) return setError('请填写退租日期和停止计租日期')
      if (moveOutDate > todayYmd()) return setError('当前版本暂不支持选择未来日期立即办理退租')
      if (!moveOutRequireTenantConfirmation && !moveOutRemark.trim()) {
        return setError('无需租户确认时，请在备注中填写店长直接办理的依据')
      }
      if (moveOutScope === 'PARTIAL' && moveOutReleaseHouseIds.length === 0) {
        return setError('部分退租请至少选择一套子房源')
      }
    }
    if (moveOutStep === 2) {
      const unnamed = moveOutAnnex5Items.find((item) => !item.name.trim())
      if (unnamed) return setError('交接清单中存在未填写名称的项目')
      const invalid = moveOutAnnex5Items.find((item) =>
        !['完好', '正常损耗'].includes(item.moveOutStatus) && !item.remark.trim(),
      )
      if (invalid) return setError(`“${invalid.name}”存在异常，请填写异常或赔偿说明`)
    }
    if (moveOutStep === 3) {
      if (moveOutPaidItems.some((item) => !item.name.trim()) || moveOutReceivableItems.some((item) => !item.name.trim())) {
        return setError('结算明细中存在未填写项目名称的行')
      }
    }
    setMoveOutStep((moveOutStep + 1) as 2 | 3 | 4)
  }

  async function cancelMoveOutRequest(c: ContractItem) {
    setError('')
    setMsg('')
    const r = await apiPost<{ ok: true }>('/api/admin/contracts/' + c.id + '/cancel-move-out-request', {})
    if (!r.ok) return setError(typeof r.error === 'string' ? apiErrorZh(r.error) : String(r.error))
    setMsg(`已撤销退租确认申请：${formatContractNo(c.contractNo)}`)
    await load()
  }

  function openRefundDepositModal(c: ContractItem) {
    setRefundDepositModal(c)
    setRefundDepositOptions(null)
    setRefundDepositMode('FULL')
    setRefundDepositBillIds([])
    setRefundDepositIncludePayment(false)
    setRefundDepositIncludeBalance(false)
    setRefundDepositRemark('')
    setRefundDepositTemplate(DEPOSIT_REFUND_TEMPLATES[0]?.code ?? '')
    setRefundDepositOptionsLoading(true)
    setError('')
    void apiGet<DepositRefundOptions>('/api/admin/contracts/' + c.id + '/refund-deposit-options').then((r) => {
      setRefundDepositOptionsLoading(false)
      if (!r.ok) {
        setError(apiErrorZh(String(r.error)))
        return
      }
      setRefundDepositOptions(r.data)
      const hasBills = r.data.billSources.length > 0
      const hasPayment = Boolean(r.data.paymentSource)
      if (hasBills || hasPayment) {
        setRefundDepositMode('SELECTED')
      }
    })
  }

  const refundDepositSelectedAmount = useMemo(() => {
    if (!refundDepositOptions) return 0
    if (refundDepositMode === 'FULL') return refundDepositOptions.maxRefundable
    let sum = 0
    for (const b of refundDepositOptions.billSources) {
      if (refundDepositBillIds.includes(b.billId)) sum += b.maxAmount
    }
    if (refundDepositIncludePayment && refundDepositOptions.paymentSource) {
      sum += refundDepositOptions.paymentSource.maxAmount
    }
    if (refundDepositIncludeBalance && refundDepositOptions.balanceSource) {
      sum += refundDepositOptions.balanceSource.maxAmount
    }
    return sum
  }, [
    refundDepositOptions,
    refundDepositMode,
    refundDepositBillIds,
    refundDepositIncludePayment,
    refundDepositIncludeBalance,
  ])

  const moveOutDamageCompensation = useMemo(
    () => moveOutAnnex5Items.reduce((sum, item) => sum + Math.max(0, Number(item.actualCompensation) || 0), 0),
    [moveOutAnnex5Items],
  )
  const moveOutReceivableItemsForSubmit = useMemo(
    () => moveOutReceivableItems.map((item) => {
      if (item.id === 'damage-compensation') return { ...item, amount: moveOutDamageCompensation }
      if (item.id === 'cleaning-fee') return { ...item, amount: moveOutHygiene === 'FAIL' ? moveOutCleaningFee : 0 }
      return item
    }),
    [moveOutCleaningFee, moveOutDamageCompensation, moveOutHygiene, moveOutReceivableItems],
  )
  const moveOutSettlementTotals = useMemo(
    () => calculateMoveOutSettlement(moveOutPaidItems, moveOutReceivableItemsForSubmit),
    [moveOutPaidItems, moveOutReceivableItemsForSubmit],
  )
  const moveOutSettlementSnapshot: MoveOutSettlementSnapshot = {
    settlementType: moveOutSettlementType,
    stopRentDate: moveOutStopRentDate,
    requireTenantConfirmation: moveOutRequireTenantConfirmation,
    hygieneStatus: moveOutHygiene,
    inspectionItems: moveOutAnnex5Items.map((item) => ({
      id: item.id,
      name: item.name,
      unit: item.unit,
      quantity: item.moveInQuantity,
      moveInStatus: item.moveInStatus,
      moveOutStatus: item.moveOutStatus,
      compensationQuantity: item.compensationQuantity,
      referencePrice: item.referencePrice,
      compensation: item.actualCompensation,
      remark: item.remark,
    })),
    paidItems: moveOutPaidItems,
    receivableItems: moveOutReceivableItemsForSubmit,
    ...moveOutSettlementTotals,
    applicationNote: moveOutApplicationNote.trim() || `租户已腾空并交还房屋，现申请按上述明细结算已交款项 ¥${moveOutSettlementTotals.paidTotal.toFixed(2)}，抵扣应收款项 ¥${moveOutSettlementTotals.receivableTotal.toFixed(2)}，抵扣后${moveOutSettlementTotals.amountDue > 0 ? `租户应补 ¥${moveOutSettlementTotals.amountDue.toFixed(2)}` : `实际退还租户 ¥${moveOutSettlementTotals.refundAmount.toFixed(2)}`}。`,
  }

  async function submitRefundDeposit() {
    if (!refundDepositModal || !refundDepositOptions) return
    if (!refundDepositTemplate) {
      setError('请选择退押金模板类型')
      return
    }
    if (refundDepositOptions.maxRefundable <= 0) {
      setError('该合同押金已全部退还')
      return
    }
    if (refundDepositMode === 'SELECTED') {
      const hasBill = refundDepositBillIds.length > 0
      const hasPay = refundDepositIncludePayment && refundDepositOptions.paymentSource
      const hasBalance = refundDepositIncludeBalance && refundDepositOptions.balanceSource
      if (!hasBill && !hasPay && !hasBalance) {
        setError('请勾选要退的账单、首期款记录或合同押金余额')
        return
      }
      if (refundDepositSelectedAmount <= 0) {
        setError('所选来源无可退金额')
        return
      }
      if (refundDepositSelectedAmount > refundDepositOptions.maxRefundable) {
        setError('所选金额合计超过合同可退上限')
        return
      }
    }
    setRefundDepositSubmitting(true)
    setError('')
    const r = await apiPost<{ ok: true; amount: number }>(
      '/api/admin/contracts/' + refundDepositModal.id + '/refund-deposit',
      {
        mode: refundDepositMode,
        billIds: refundDepositMode === 'SELECTED' ? refundDepositBillIds : undefined,
        includePayment:
          refundDepositMode === 'SELECTED' ? refundDepositIncludePayment : undefined,
        includeContractBalance:
          refundDepositMode === 'SELECTED' ? refundDepositIncludeBalance : undefined,
        remark: refundDepositRemark.trim() || undefined,
        refundTemplateCode: refundDepositTemplate,
      },
    )
    setRefundDepositSubmitting(false)
    if (!r.ok) return setError(apiErrorZh(String(r.error)))
    const amt = r.data.amount
    setMsg(`退押金成功：${formatContractNo(refundDepositModal.contractNo)} 已退 ¥${amt}`)
    setRefundDepositModal(null)
    setRefundDepositOptions(null)
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
    const rentDueParsed = parseRentDueDayInput(renewForm.rentDueDay)
    if (!rentDueParsed.ok) {
      setRenewSubmitting(false)
      return setError(rentDueParsed.message)
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
        rentDueDay: rentDueParsed.value,
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
    const active = changeHouseModal.mergedBundle?.lines?.filter((l) => !l.releasedAt) ?? []
    if (chScope === 'PARTIAL') {
      if (active.length <= 1) {
        return setError('仅当仍有 2 套及以上在租子资产时，才可选择「仅迁出一套」')
      }
      if (!chSourceHouseId) {
        return setError('请选择要迁出的子房源')
      }
    }
    setChangeHouseSubmitting(true)
    setError('')
    const r = await apiPost<{
      ok: true
      newContractId: string
      contractNo: string
      supplementBillCreated: boolean
      supplementTotal: number
      partial?: boolean
    }>('/api/admin/contracts/' + changeHouseModal.id + '/change-house', {
      targetHouseId: changeHouseTargetId,
      moveDate: chMoveDate,
      newStartDate: chNewStart,
      leaseMonths: chLeaseMonths,
      newRentMonthly: chNewRent,
      newDeposit: chNewDeposit,
      ...(chScope === 'PARTIAL' && chSourceHouseId ? { sourceHouseId: chSourceHouseId } : {}),
    })
    setChangeHouseSubmitting(false)
    if (!r.ok) return setError(apiErrorZh(String(r.error)))
    const sup = r.data.supplementBillCreated
      ? `已生成换房补差账单 ¥${r.data.supplementTotal}。`
      : '未生成补差账单（新押金不高于旧押金）。'
    setMsg(
      r.data.partial
        ? `部分换房已提交：原合并合同仍在租部分已重算后续账单；新合同 ${formatContractNo(r.data.contractNo)} 已生成（待租客签字/支付）。${sup}`
        : `换房完成：旧合同已于 ${chMoveDate} 终止；新合同 ${formatContractNo(r.data.contractNo)} 已生成（待租客签字/支付后在新房生效）。${sup}`,
    )
    setChangeHouseModal(null)
    await load()
  }

  const filterOptions = useMemo(() => {
    const stores = Array.from(new Set(items.map((c) => c.house.storeName).filter(Boolean))).sort()
    const apartments = Array.from(
      new Set(
        items.flatMap((c) => {
          const names = [c.house.apartmentName]
          if (c.mergedBundle?.lines?.length) {
            for (const ln of c.mergedBundle.lines) {
              if (ln.apartmentName) names.push(ln.apartmentName)
            }
          }
          return names
        }).filter(Boolean),
      ),
    ).sort()
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
      if (apartmentFilter) {
        const hitPrimary = c.house.apartmentName === apartmentFilter
        const hitBundle = Boolean(c.mergedBundle?.lines?.some((ln) => ln.apartmentName === apartmentFilter))
        if (!hitPrimary && !hitBundle) return false
      }

      if (expiryWarnMin.trim() || expiryWarnMax.trim()) {
        const min = expiryWarnMin.trim() ? Number(expiryWarnMin.trim()) : -Infinity
        const max = expiryWarnMax.trim() ? Number(expiryWarnMax.trim()) : Infinity
        const daysLeft = calcDaysTo(c.endDate)
        if (Number.isNaN(daysLeft) || daysLeft > EXPIRY_WARN_DAYS) return false
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
      const bundleHay =
        c.mergedBundle?.lines
          ?.map((ln) => `${ln.houseBizId} ${ln.apartmentName} ${ln.houseNo}`)
          .join(' ')
          .toLowerCase() ?? ''
      const hay =
        `${c.contractNo} ${c.house.houseBizId} ${c.tenant.name} ${c.tenant.phone} ${c.house.storeName} ${c.house.apartmentName} ${c.house.houseNo} ${bundleHay} ${srcZh}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, status, sourceFilter, reportStatusFilter, storeFilter, apartmentFilter, expiryWarnMin, expiryWarnMax])

  const createSelectedHouse = useMemo(
    () => createHouseOptions.find((h) => h.id === createForm.houseId) ?? null,
    [createHouseOptions, createForm.houseId],
  )

  function applyCreateHouseDefaults(houseId: string, prev: typeof createForm) {
    const h = createHouseOptions.find((x) => x.id === houseId)
    return {
      ...prev,
      houseId,
      rentMonthly: h?.rentMonthly ?? prev.rentMonthly,
      depositMultiple:
        h && h.rentMonthly > 0 ? h.deposit / h.rentMonthly : prev.depositMultiple,
    }
  }

  async function openCreateModal() {
    setError('')
    setMsg('')
    const r = await apiGet<{ items: HousePick[] }>('/api/admin/houses')
    if (!r.ok) return setError(r.error)
    // 仅允许选择空置房源
    const opts = (r.data.items ?? [])
      .filter((h) => h.status === 'VACANT')
      .map((h) => ({
        id: h.id,
        apartmentName: h.apartmentName,
        houseNo: h.houseNo,
        storeName: h.storeName,
        status: h.status,
        rentMonthly: h.rentMonthly ?? 0,
        deposit: h.deposit ?? 0,
      }))
    setCreateHouseOptions(opts)
    const defaultHouse = opts.length === 1 ? opts[0] : null
    setCreateForm({
      houseId: defaultHouse?.id ?? '',
      tenantName: '',
      tenantPhone: '',
      tenantIdNumber: '',
      startDate: todayYmd(),
      agreementSignDate: '',
      leaseMonths: 12,
      rentMonthly: defaultHouse?.rentMonthly ?? 0,
      depositMultiple:
        defaultHouse && defaultHouse.rentMonthly > 0
          ? defaultHouse.deposit / defaultHouse.rentMonthly
          : 1,
      rentCycle: 'MONTHLY',
      penaltyFormula: 'amount*0.1%*days',
      rentDueDay: String(rentDueDayFromYmd(todayYmd())),
      latestRentGraceDays: '',
      remarkHtml: '',
      contractTemplate: 'RESIDENTIAL_ASSET',
      terminationRentMulti: '2',
      terminationDaysPastDue: '7',
      billPushToTenant: 'yes',
    })
    setCreatePendingFiles([])
    setJiangnanForm(defaultJiangnanFactoryForm())
    setNonResidentialForm(defaultNonResidentialForm())
    setResidentialForm(defaultResidentialAssetForm())
    setNanningHousingForm(defaultNanningHousingForm())
    setCreateModalOpen(true)
  }

  async function submitCreateJiangnan() {
    const formErr = validateJiangnanFactoryForm(jiangnanForm)
    if (formErr) return setError(formErr)

    const rentMonthly = sumHouseRentMonthly(jiangnanForm.houses)
    if (rentMonthly <= 0) return setError('所选资产月租须大于 0')

    const bondAmount = performanceBondAmount(jiangnanForm)
    const depositMultiple = rentMonthly > 0 ? bondAmount / rentMonthly : 1
    const leaseMonths = leaseMonthsFromRange(jiangnanForm.leaseStart, jiangnanForm.leaseEnd)
    if (leaseMonths <= 0) return setError('租赁期限不合法')

    let latestRentGraceDays: number | null = null
    if (jiangnanForm.latestRentGraceDays.trim()) {
      latestRentGraceDays = parseInt(jiangnanForm.latestRentGraceDays.trim(), 10)
    }
    const terminationDaysPastDue = parseInt(jiangnanForm.terminationDaysPastDue.trim() || '0', 10)
    const rentDueParsed = parseRentDueDayInput(
      jiangnanForm.rentCycle === 'MONTHLY' ? jiangnanForm.rentDueDay : '1',
    )
    if (!rentDueParsed.ok) return setError(rentDueParsed.message)

    setCreateSubmitting(true)
    setError('')
    const r = await apiPost<{ ok: true; contractId: string; contractNo: string }>('/api/admin/contracts/manual', {
      contractTemplate: 'JIANGNAN_FACTORY',
      contractTemplateDataJson: serializeJiangnanFactoryForm(jiangnanForm),
      tenantIds: jiangnanForm.tenantIds,
      houseIds: jiangnanForm.houseIds,
      leaseMonths,
      startDate: jiangnanForm.leaseStart,
      endDate: jiangnanForm.leaseEnd,
      rentMonthly,
      depositMultiple,
      rentCycle: jiangnanForm.rentCycle,
      penaltyFormula: 'amount*0.1%*days',
      rentDueDay: rentDueParsed.value,
      latestRentGraceDays,
      configRemarkHtml: jiangnanForm.remarkHtml.trim() ? jiangnanForm.remarkHtml : null,
      agreementSignDate: jiangnanForm.agreementSignDate.trim() === '' ? null : jiangnanForm.agreementSignDate,
      terminationDaysPastDue,
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
    setMsg(`新建合同成功：${formatContractNo(r.data.contractNo)}（产投江南企业公园厂房租赁，已直接生效）。`)
    await load()
  }

  async function submitCreateNonResidential() {
    const formErr = validateNonResidentialForm(nonResidentialForm)
    if (formErr) return setError(formErr)

    const rentMonthly = nrSumHouseRentMonthly(nonResidentialForm.houses)
    if (rentMonthly <= 0) return setError('所选资产月租须大于 0')

    const bondAmount = nonResidentialPerformanceBondAmount(nonResidentialForm)
    const depositMultiple = rentMonthly > 0 ? bondAmount / rentMonthly : 1
    const leaseMonths = nrLeaseMonthsFromRange(nonResidentialForm.leaseStart, nonResidentialForm.leaseEnd)
    if (leaseMonths <= 0) return setError('租赁期限不合法')

    let latestRentGraceDays: number | null = null
    if (nonResidentialForm.latestRentGraceDays.trim()) {
      latestRentGraceDays = parseInt(nonResidentialForm.latestRentGraceDays.trim(), 10)
    }
    const terminationRentMultiple = parseFloat(nonResidentialForm.terminationRentMultiple.trim() || '0')
    const rentDueParsed = parseRentDueDayInput(
      nonResidentialForm.rentCycle === 'MONTHLY' ? nonResidentialForm.rentDueDay : '1',
    )
    if (!rentDueParsed.ok) return setError(rentDueParsed.message)

    setCreateSubmitting(true)
    setError('')
    const r = await apiPost<{ ok: true; contractId: string; contractNo: string }>('/api/admin/contracts/manual', {
      contractTemplate: 'NON_RESIDENTIAL',
      contractTemplateDataJson: serializeNonResidentialForm(nonResidentialForm),
      tenantIds: nonResidentialForm.tenantIds,
      houseIds: nonResidentialForm.houseIds,
      leaseMonths,
      startDate: nonResidentialForm.leaseStart,
      endDate: nonResidentialForm.leaseEnd,
      rentMonthly,
      depositMultiple,
      rentCycle: nonResidentialForm.rentCycle,
      penaltyFormula: 'amount*0.1%*days',
      rentDueDay: rentDueParsed.value,
      latestRentGraceDays,
      configRemarkHtml: nonResidentialForm.remarkHtml.trim() ? nonResidentialForm.remarkHtml : null,
      agreementSignDate: nonResidentialForm.agreementSignDate.trim() === '' ? null : nonResidentialForm.agreementSignDate,
      terminationRentMultiple,
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
    setMsg(`新建合同成功：${formatContractNo(r.data.contractNo)}（非住宅资产租赁，已直接生效）。`)
    await load()
  }

  async function submitCreateResidential() {
    const formErr = validateResidentialAssetForm(residentialForm)
    if (formErr) return setError(formErr)

    const rentMonthly = raSumHouseRentMonthly(residentialForm.houses)
    if (rentMonthly <= 0) return setError('所选资产月租须大于 0')

    const bondAmount = residentialHousingBondAmount(residentialForm)
    const depositMultiple = rentMonthly > 0 ? bondAmount / rentMonthly : 1
    const leaseMonths = raLeaseMonthsFromRange(residentialForm.leaseStart, residentialForm.leaseEnd)
    if (leaseMonths <= 0) return setError('租赁期限不合法')

    let latestRentGraceDays: number | null = null
    if (residentialForm.latestRentGraceDays.trim()) {
      latestRentGraceDays = parseInt(residentialForm.latestRentGraceDays.trim(), 10)
    }
    const terminationDaysPastDue = parseInt(residentialForm.terminationDaysPastDue.trim() || '0', 10)
    const rentDueParsed = parseRentDueDayInput(
      residentialForm.rentCycle === 'MONTHLY' ? residentialForm.rentDueDay : '1',
    )
    if (!rentDueParsed.ok) return setError(rentDueParsed.message)

    setCreateSubmitting(true)
    setError('')
    const r = await apiPost<{ ok: true; contractId: string; contractNo: string }>('/api/admin/contracts/manual', {
      contractTemplate: 'RESIDENTIAL_ASSET',
      contractTemplateDataJson: serializeResidentialAssetForm(residentialForm),
      tenantIds: residentialForm.tenantIds,
      houseIds: residentialForm.houseIds,
      leaseMonths,
      startDate: residentialForm.leaseStart,
      endDate: residentialForm.leaseEnd,
      rentMonthly,
      depositMultiple,
      rentCycle: residentialForm.rentCycle,
      penaltyFormula: 'amount*0.1%*days',
      rentDueDay: rentDueParsed.value,
      latestRentGraceDays,
      configRemarkHtml: residentialForm.remarkHtml.trim() ? residentialForm.remarkHtml : null,
      agreementSignDate: residentialForm.agreementSignDate.trim() === '' ? null : residentialForm.agreementSignDate,
      terminationDaysPastDue,
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
    setMsg(`新建合同成功：${formatContractNo(r.data.contractNo)}（住宅资产租赁，已直接生效）。`)
    await load()
  }

  async function submitCreateNanningHousing() {
    const formErr = validateNanningHousingForm(nanningHousingForm)
    if (formErr) return setError(formErr)

    const rentMonthly = bowanMonthlyRentNumber(nanningHousingForm)
    if (rentMonthly <= 0) return setError('所选资产月租须大于 0')

    const bondAmount = bowanPerformanceBondAmount(nanningHousingForm)
    const depositMultiple = rentMonthly > 0 ? bondAmount / rentMonthly : 1
    const leaseMonths = nhLeaseMonthsFromRange(nanningHousingForm.leaseStart, nanningHousingForm.leaseEnd)
    if (leaseMonths <= 0) return setError('租赁期限不合法')

    let latestRentGraceDays: number | null = null
    if (nanningHousingForm.latestRentGraceDays.trim()) {
      latestRentGraceDays = parseInt(nanningHousingForm.latestRentGraceDays.trim(), 10)
    }
    const terminationDaysPastDue = parseInt(nanningHousingForm.terminationDaysPastDue.trim() || '0', 10)
    const rentDueParsed = parseRentDueDayInput(
      nanningHousingForm.rentCycle === 'MONTHLY' ? nanningHousingForm.rentDueDay : '1',
    )
    if (!rentDueParsed.ok) return setError(rentDueParsed.message)

    setCreateSubmitting(true)
    setError('')
    const r = await apiPost<{ ok: true; contractId: string; contractNo: string }>('/api/admin/contracts/manual', {
      contractTemplate: 'NANNING_HOUSING',
      contractTemplateDataJson: serializeNanningHousingForm(nanningHousingForm),
      tenantIds: nanningHousingForm.tenantIds,
      houseIds: nanningHousingForm.houseIds,
      leaseMonths,
      startDate: nanningHousingForm.leaseStart,
      endDate: nanningHousingForm.leaseEnd,
      rentMonthly,
      depositMultiple,
      rentCycle: nanningHousingForm.rentCycle,
      penaltyFormula: bowanPenaltyFormula(nanningHousingForm),
      rentDueDay: rentDueParsed.value,
      latestRentGraceDays,
      configRemarkHtml: nanningHousingForm.remarkHtml.trim() ? nanningHousingForm.remarkHtml : null,
      agreementSignDate:
        nanningHousingForm.agreementSignDate.trim() === '' ? null : nanningHousingForm.agreementSignDate,
      terminationDaysPastDue,
      billPushToTenant: nanningHousingForm.billPushToTenant === 'yes',
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
    setMsg(`新建合同成功：${formatContractNo(r.data.contractNo)}（南宁市房屋租赁合同·泊湾公寓，已直接生效）。`)
    await load()
  }

  async function submitCreate() {
    if (createForm.contractTemplate === 'JIANGNAN_FACTORY') {
      return submitCreateJiangnan()
    }
    if (createForm.contractTemplate === 'NON_RESIDENTIAL') {
      return submitCreateNonResidential()
    }
    if (createForm.contractTemplate === 'RESIDENTIAL_ASSET') {
      return submitCreateResidential()
    }
    if (createForm.contractTemplate === 'NANNING_HOUSING') {
      return submitCreateNanningHousing()
    }
    if (!createForm.houseId) return setError('请选择房源（仅支持空置房源）')
    if (!createForm.tenantName.trim()) return setError('请填写租客姓名')
    if (!createForm.tenantPhone.trim()) return setError('请填写手机号')
    if (!createForm.tenantIdNumber.trim()) return setError('请填写身份证号')
    if (!createForm.startDate) return setError('请填写入住日期')
    if (createForm.leaseMonths <= 0) return setError('租期（月）需大于 0')
    if (createForm.rentMonthly <= 0) return setError('月租需大于 0')
    if (createForm.depositMultiple <= 0) return setError('押金倍数须大于 0')
    const graceParsed = parseLatestRentGraceDaysInput(createForm.latestRentGraceDays)
    if (!graceParsed.ok) return setError(graceParsed.message)
    const rentDueParsed = parseRentDueDayInput(createForm.rentDueDay)
    if (!rentDueParsed.ok) return setError(rentDueParsed.message)

    let terminationRentMultiple: number | null = null
    let terminationDaysPastDue: number | null = null
    if (contractTemplateUsesRentMultipleTermination(createForm.contractTemplate)) {
      const x = parseFloat(createForm.terminationRentMulti.trim())
      if (Number.isNaN(x) || x <= 0) {
        return setError(`${contractTemplateZh(createForm.contractTemplate)}：请填写大于 0 的月租倍数`)
      }
      terminationRentMultiple = x
    } else {
      const d = parseInt(createForm.terminationDaysPastDue.trim(), 10)
      if (Number.isNaN(d) || d < 0) {
        return setError(`${contractTemplateZh(createForm.contractTemplate)}：请填写不小于 0 的逾期天数（整数）`)
      }
      terminationDaysPastDue = d
    }

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
      agreementSignDate: createForm.agreementSignDate.trim() === '' ? null : createForm.agreementSignDate,
      leaseMonths: createForm.leaseMonths,
      rentMonthly: createForm.rentMonthly,
      depositMultiple: createForm.depositMultiple,
      rentCycle: createForm.rentCycle,
      penaltyFormula: createForm.penaltyFormula,
      rentDueDay: rentDueParsed.value,
      latestRentGraceDays: graceParsed.value,
      configRemarkHtml: createForm.remarkHtml.trim() ? createForm.remarkHtml : null,
      contractTemplate: createForm.contractTemplate,
      terminationRentMultiple,
      terminationDaysPastDue,
      billPushToTenant: createForm.billPushToTenant === 'yes',
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
              <option value="WAIT_TENANT_MOVEOUT_SIGN">待租客确认退租</option>
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
              <button className="a-btn ghost" onClick={() => setPage(1)}>
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
              <th>到期提醒</th>
              <th>备注</th>
              <th>附件</th>
              <th>关联来源</th>
              <th>合同来源</th>
              <th className="contracts-op-col">操作</th>
            </tr>
          </thead>
          <tbody>
            {pageData.items.map((c) => (
              <tr key={c.id}>
                <td>
                  <span style={{ fontWeight: 600 }}>{formatContractNo(c.contractNo)}</span>
                  {c.mergedBundle && c.mergedBundle.lines.length > 0 ? (
                    <div className="a-muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>
                      合并合同 · 在租 {c.mergedBundle.lineCount} 套
                      {c.mergedBundle.lineHistoryCount != null &&
                      c.mergedBundle.lineHistoryCount > c.mergedBundle.lineCount
                        ? `（共 ${c.mergedBundle.lineHistoryCount} 条资产记录）`
                        : ''}
                      · 在租月租合计 ¥{c.mergedBundle.rentMonthlySum}
                    </div>
                  ) : null}
                </td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                  <div style={{ fontWeight: 800 }}>{c.house.houseBizId}</div>
                  {c.mergedBundle && c.mergedBundle.lines.length > 0 ? (
                    <div className="a-muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.45 }}>
                      {c.mergedBundle.lines
                        .filter((ln) => !ln.releasedAt && ln.houseBizId !== c.house.houseBizId)
                        .map((ln) => ln.houseBizId)
                        .join(' · ')}
                    </div>
                  ) : null}
                </td>
                <td style={{ fontWeight: 600 }}>
                  {c.mergedBundle && c.mergedBundle.lines.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {c.mergedBundle.lines.map((ln) => (
                        <div key={ln.houseBizId} style={{ opacity: ln.releasedAt ? 0.55 : 1 }}>
                          {ln.apartmentName}
                          <span className="a-muted" style={{ fontWeight: 700 }}>
                            {' '}
                            · {ln.houseNo}
                          </span>
                          {ln.lineStatus && ln.lineStatus !== 'IN_USE' ? (
                            <span
                              className={`a-badge ${ln.lineStatus === 'CHANGED' ? 'status-wait' : 'status-void'}`}
                              style={{ marginLeft: 6, fontSize: 11 }}
                              title={
                                ln.lineStatus === 'CHANGED' && ln.changeHouseNewContractNo
                                  ? `新合同 ${formatContractNo(ln.changeHouseNewContractNo)}`
                                  : undefined
                              }
                            >
                              {ln.lineStatusLabel ?? (ln.lineStatus === 'CHANGED' ? '已换' : '已迁出')}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    c.house.apartmentName
                  )}
                </td>
                <td style={{ fontWeight: 600 }}>
                  {c.mergedBundle && c.mergedBundle.lines.length > 0 ? (
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {c.mergedBundle.lines
                        .filter((ln) => !ln.releasedAt)
                        .map((ln) => ln.houseNo)
                        .join('、') || '—'}
                    </span>
                  ) : (
                    c.house.houseNo
                  )}
                </td>
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
                    if (Number.isNaN(daysLeft) || daysLeft > EXPIRY_WARN_DAYS) return null
                    const isSoon = daysLeft <= 7
                    const isExpired = daysLeft < 0
                    return (
                      <span style={{ fontWeight: 800, color: isExpired || isSoon ? '#b91c1c' : '#f59e0b' }}>
                        {expiryWarnText(daysLeft)}
                        {c.leaseExpired && c.houseStatus === 'VACANT' ? (
                          <span className="a-muted" style={{ display: 'block', fontWeight: 500, fontSize: 11, marginTop: 2 }}>
                            房源已空置
                          </span>
                        ) : null}
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
                      {(c.attachmentFiles ?? []).map((a) => {
                        const attLocked = contractAttachmentsLockedUntilPaid(c.status)
                        return (
                        <span key={a.file} style={{ whiteSpace: 'nowrap' }}>
                          <span title={a.name}>{a.name.length > 14 ? `${a.name.slice(0, 14)}…` : a.name}</span>{' '}
                          <button
                            type="button"
                            className="a-btn ghost"
                            style={{ padding: '0 6px', fontSize: 11 }}
                            onClick={() =>
                              previewFileWithAuth(
                                `/api/admin/contracts/${c.id}/attachment/${encodeURIComponent(a.file)}`,
                              ).catch((e) => setError(e instanceof Error ? e.message : '预览失败'))
                            }
                          >
                            预览
                          </button>
                          <button
                            type="button"
                            className="a-btn ghost"
                            style={{ padding: '0 6px', fontSize: 11 }}
                            disabled={attLocked}
                            title={attLocked ? '租客完成首笔缴费后方可下载' : undefined}
                            onClick={() =>
                              downloadFileWithAuth(
                                `/api/admin/contracts/${c.id}/attachment/${encodeURIComponent(a.file)}?download=1`,
                                a.name,
                              ).catch((e) => setError(e instanceof Error ? e.message : '下载失败'))
                            }
                          >
                            下载
                          </button>
                        </span>
                        )
                      })}
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
                        loadDetail(c.id)
                      }}
                      disabled={detailLoadingId === c.id}
                    >
                      {detailLoadingId === c.id ? '加载中…' : '查看详情'}
                    </button>
                    <button
                      className="a-btn ghost"
                      onClick={() => {
                        downloadFileWithAuth(
                          '/api/admin/contracts/' + c.id + '/download',
                          `合同摘要-${c.contractNo}.txt`,
                        ).catch((e) => setError(e instanceof Error ? e.message : '下载失败'))
                      }}
                    >
                      下载
                    </button>
                    {c.status === 'ACTIVE' ? (
                      <div className="contracts-op-group">
                        <button
                          className="a-btn"
                          onClick={() => {
                            openRenewModal(c)
                          }}
                        >
                          续签
                        </button>
                        <button
                          className="a-btn ghost"
                          onClick={() => {
                            openChangeHouseModal(c)
                          }}
                        >
                          换房
                        </button>
                        <button
                          className="a-btn secondary"
                          onClick={() => {
                            openMoveOutModal(c)
                          }}
                        >
                          退租
                        </button>
                        {c.billingPaused ? (
                          <button
                            type="button"
                            className="a-btn ghost"
                            disabled={billingActionSubmitting}
                            onClick={() => {
                              setBillingResumeFrom(new Date().toISOString().slice(0, 10))
                              setBillingResumeModal(c)
                            }}
                          >
                            恢复计费
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="a-btn ghost"
                            disabled={billingActionSubmitting}
                            onClick={async () => {
                              if (!window.confirm(`确认暂停合同 ${formatContractNo(c.contractNo)} 的计费？\n暂停后不再计入应收报表，也不再推送新费用；租客 H5 仍可查看应缴账单。`)) return
                              setBillingActionSubmitting(true)
                              setError('')
                              const r = await apiPost<{ ok: true }>(`/api/admin/contracts/${c.id}/billing-pause`, {})
                              setBillingActionSubmitting(false)
                              if (!r.ok) return setError(apiErrorZh(r.error))
                              setMsg('已暂停计费')
                              await load()
                            }}
                          >
                            暂停计费
                          </button>
                        )}
                        {c.billingPaused ? (
                          <span className="a-badge status-wait-stamp" style={{ fontSize: 11 }}>
                            计费已暂停
                            {c.billingResumeFrom ? ` · ${c.billingResumeFrom} 起恢复` : ''}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {c.status === 'WAIT_TENANT_MOVEOUT_SIGN' && c.moveOutSignDeadlineAt ? (
                      <div className="contracts-op-group" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                        <div
                          style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            background: '#fffbeb',
                            border: '1px solid #fcd34d',
                          }}
                        >
                          <div style={{ fontWeight: 800, color: '#92400e' }}>退租确认签字倒计时（7 天）</div>
                          <div
                            style={{
                              fontSize: 26,
                              fontWeight: 900,
                              marginTop: 6,
                              color: '#b45309',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {formatSignLikeCountdown(new Date(c.moveOutSignDeadlineAt).getTime() - nowTick) ?? '—'}
                          </div>
                        </div>
                        <button className="a-btn ghost" type="button" onClick={() => void cancelMoveOutRequest(c)}>
                          撤销退租申请
                        </button>
                      </div>
                    ) : null}
                    {c.status === 'TERMINATED' ? (
                      <button
                        className="a-btn"
                        onClick={() => {
                          openRefundDepositModal(c)
                        }}
                      >
                        {c.depositRefunded ? '再次退押金' : '退押金'}
                      </button>
                    ) : null}
                    {canShowEditContractConfigButton(c) ? (
                      <button
                        type="button"
                        className="a-btn ghost"
                        onClick={() => {
                          setEditLoadingId(c.id)
                        }}
                        disabled={editLoadingId === c.id}
                        title={
                          c.modificationRejectedAt
                            ? '租客申请已驳回，可重新配置合同'
                            : '租客已申请修改合同配置，点击处理'
                        }
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
          <div className={`a-modal ${moveOutModal.status === 'ACTIVE' ? 'moveout-workflow-modal' : 'a-modal--narrow'}`} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div>
                <div className="a-modal-title">办理退租 · {formatContractNo(moveOutModal.contractNo)}</div>
                {moveOutModal.status === 'ACTIVE' ? <div className="a-muted" style={{ marginTop: 4 }}>附件五退租核验、押金试算与双方签字</div> : null}
              </div>
              <button className="a-modal-close" onClick={() => setMoveOutModal(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body moveout-workflow-body">
              {moveOutModal.status === 'PENDING_PAYMENT' ? (
                <div className="moveout-simple-void">
                  <div className="moveout-notice">当前为待支付：确认后合同作废，房源释放为空置。</div>
                  <div className="a-kv">
                    <div className="a-kv-row"><div className="a-kv-k">作废日期</div><div className="a-kv-v"><input className="a-filter-input" type="date" value={moveOutDate} onChange={(e) => setMoveOutDate(e.target.value)} /></div></div>
                    <div className="a-kv-row"><div className="a-kv-k">退租原因</div><div className="a-kv-v"><select className="a-filter-select" value={moveOutReason} onChange={(e) => setMoveOutReason(e.target.value)}><option value="">请选择</option>{MOVE_OUT_REASON_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div></div>
                  </div>
                  <div className="moveout-footer"><button className="a-btn ghost" onClick={() => setMoveOutModal(null)}>取消</button><button className="a-btn secondary" onClick={submitMoveOut} disabled={moveOutSubmitting}>确认办理作废</button></div>
                </div>
              ) : (
                <>
                  <div className="moveout-steps">
                    {['退租信息', '房屋交接与赔偿', '结算明细', '审批表与发起'].map((label, index) => {
                      const step = (index + 1) as 1 | 2 | 3 | 4
                      return <button type="button" key={label} className={moveOutStep === step ? 'active' : moveOutStep > step ? 'done' : ''} onClick={() => setMoveOutStep(step)}><b>{moveOutStep > step ? '✓' : step}</b><span>{label}</span></button>
                    })}
                  </div>

                  {moveOutStep === 1 ? (
                    <div className="moveout-step-panel">
                      <div className="moveout-notice">按实际退租类型填写日期与原因；系统将根据“是否需要租户确认”分流办理。</div>
                      {moveOutModal.mergedBundle && moveOutModal.mergedBundle.lines.filter((l) => !l.releasedAt).length > 1 ? (
                        <section className="moveout-section"><h3>退租范围</h3><label className="moveout-choice"><input type="radio" name="moveOutScope" checked={moveOutScope === 'ALL'} onChange={() => { setMoveOutScope('ALL'); setMoveOutReleaseHouseIds([]) }} /><span><strong>整套退租</strong><small>合同终止，全部在租子房源一并结案</small></span></label><label className="moveout-choice"><input type="radio" name="moveOutScope" checked={moveOutScope === 'PARTIAL'} onChange={() => setMoveOutScope('PARTIAL')} /><span><strong>仅退部分子房源</strong><small>其余房源仍在租，未结清账单按剩余套数重算</small></span></label>{moveOutScope === 'PARTIAL' ? <div className="moveout-house-options">{moveOutModal.mergedBundle.lines.filter((line) => !line.releasedAt).map((line) => <label key={line.houseId}><input type="checkbox" checked={moveOutReleaseHouseIds.includes(line.houseId)} onChange={(e) => setMoveOutReleaseHouseIds((ids) => e.target.checked ? [...ids, line.houseId] : ids.filter((id) => id !== line.houseId))} /> {line.apartmentName} · {line.houseNo}</label>)}</div> : null}</section>
                      ) : null}
                      <section className="moveout-section"><h3>基本信息</h3><div className="moveout-form-grid">
                        <label><span>退租类型 *</span><select className="a-filter-select" value={moveOutSettlementType} onChange={(e) => setMoveOutSettlementType(e.target.value as MoveOutSettlementType)}>{MOVE_OUT_SETTLEMENT_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select><small>{MOVE_OUT_SETTLEMENT_TYPE_OPTIONS.find((item) => item.value === moveOutSettlementType)?.hint}</small></label>
                        <label><span>退租原因 *</span><select className="a-filter-select" value={moveOutReason} onChange={(e) => setMoveOutReason(e.target.value)}><option value="">请选择</option>{MOVE_OUT_REASON_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></label>
                        {moveOutReason === '其他' ? <label className="wide"><span>其他原因 *</span><input className="a-filter-input" value={moveOutReasonOther} onChange={(e) => setMoveOutReasonOther(e.target.value)} placeholder="请说明具体退租原因" /></label> : null}
                        <label><span>退租日期 *</span><input className="a-filter-input" type="date" value={moveOutDate} onChange={(e) => { setMoveOutDate(e.target.value); setMoveOutStopRentDate(e.target.value) }} /></label>
                        <label><span>停止计租日期 *</span><input className="a-filter-input" type="date" value={moveOutStopRentDate} onChange={(e) => setMoveOutStopRentDate(e.target.value)} /></label>
                        <label className="wide"><span>是否需要租户确认 *</span><div className="moveout-confirm-choice"><label><input type="radio" name="tenantConfirm" checked={moveOutRequireTenantConfirmation} onChange={() => setMoveOutRequireTenantConfirmation(true)} /> 需要：租户核对交接单、退租申请、结算明细并提交银行卡</label><label><input type="radio" name="tenantConfirm" checked={!moveOutRequireTenantConfirmation} onChange={() => setMoveOutRequireTenantConfirmation(false)} /> 不需要：店长保留手动办理权，直接生成审批表</label></div></label>
                        <label className="wide"><span>备注</span><textarea className="a-filter-input" rows={3} placeholder="补充说明本次退租情况；无需租户确认时请写明依据" value={moveOutRemark} onChange={(e) => setMoveOutRemark(e.target.value)} /></label>
                        <label className="wide"><span>现场附件</span><input type="file" className="a-filter-input" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f || !moveOutModal) return; const r = await apiUploadMoveOutFile(moveOutModal.id, f); if (!r.ok) return setError(r.error); setMoveOutAttachments((prev) => [...prev, r.data.attachment]) }} /><small>支持房屋现场图片、协商依据、维修估价单等，将随退租单归档。</small>{moveOutAttachments.length > 0 ? <ul className="moveout-attachment-list">{moveOutAttachments.map((item) => <li key={item.id}><span>{item.name}</span><button type="button" onClick={() => setMoveOutAttachments((rows) => rows.filter((row) => row.id !== item.id))}>移除</button></li>)}</ul> : null}</label>
                      </div></section>
                    </div>
                  ) : null}

                  {moveOutStep === 2 ? (
                    <div className="moveout-step-panel">
                      <div className="moveout-baseline"><div><strong>入住清单基线</strong><span>版本 V1 · 店长与租客已于 2026/03/01 签字</span></div><button type="button" className="a-btn ghost">查看入住签字原件</button></div>
                      <div className="moveout-inspection-toolbar">
                        <span>退租时可调整项目、数量、单价和赔偿金，所有内容将进入双方签字版本。</span>
                        <button type="button" className="a-btn secondary" onClick={() => setMoveOutAnnex5Items((rows) => [...rows, { id: `mo-${Date.now()}`, category: '其他', name: '', unit: '个', moveInQuantity: 1, moveInStatus: '未记录', moveOutStatus: '完好', compensationQuantity: 0, referencePrice: 0, actualCompensation: 0, remark: '', isMoveOutAdded: true }])}>+ 添加项目</button>
                      </div>
                      <div className="moveout-table-wrap">
                        <table className="annex5-reference-table moveout-reference-table">
                          <thead>
                            <tr><th rowSpan={2}>序号</th><th rowSpan={2}>清点及核验项目</th><th rowSpan={2}>单位</th><th rowSpan={2}>数量</th><th rowSpan={2}>单价（元）</th><th colSpan={2}>状态确认</th><th rowSpan={2}>赔偿数量</th><th rowSpan={2}>赔偿金</th><th rowSpan={2}>备注</th></tr>
                            <tr><th>入住</th><th>退租</th></tr>
                          </thead>
                          <tbody>
                            {moveOutAnnex5Items.map((item, index) => (
                              <tr key={item.id} className={item.actualCompensation > 0 ? 'has-damage' : ''}>
                                <td>{index + 1}</td>
                                <td><textarea rows={2} value={item.name} placeholder="请填写清点项目" onChange={(e) => setMoveOutAnnex5Items((rows) => rows.map((row) => row.id === item.id ? { ...row, name: e.target.value } : row))} /></td>
                                <td><input value={item.unit} onChange={(e) => setMoveOutAnnex5Items((rows) => rows.map((row) => row.id === item.id ? { ...row, unit: e.target.value } : row))} /></td>
                                <td><input type="number" min="0.01" step="0.01" value={item.moveInQuantity} onChange={(e) => setMoveOutAnnex5Items((rows) => rows.map((row) => row.id === item.id ? { ...row, moveInQuantity: Number(e.target.value) || 0 } : row))} /></td>
                                <td><input type="number" min="0" step="0.01" value={item.referencePrice} onChange={(e) => setMoveOutAnnex5Items((rows) => rows.map((row) => row.id === item.id ? { ...row, referencePrice: Math.max(0, Number(e.target.value) || 0) } : row))} /></td>
                                <td className="annex5-check-cell"><input type="checkbox" checked={item.moveInStatus === '完好'} disabled aria-label={`第${index + 1}项入住状态`} /></td>
                                <td><select value={item.moveOutStatus} onChange={(e) => setMoveOutAnnex5Items((rows) => rows.map((row) => row.id === item.id ? { ...row, moveOutStatus: e.target.value as MoveOutAnnex5Item['moveOutStatus'], actualCompensation: e.target.value === '完好' || e.target.value === '正常损耗' ? 0 : row.actualCompensation } : row))} aria-label={`第${index + 1}项退租状态`}><option>完好</option><option>正常损耗</option><option>损坏</option><option>缺失</option><option>数量减少</option></select></td>
                                <td><input type="number" min="0" step="0.01" value={item.compensationQuantity} onChange={(e) => setMoveOutAnnex5Items((rows) => rows.map((row) => row.id === item.id ? { ...row, compensationQuantity: Math.max(0, Number(e.target.value) || 0) } : row))} /></td>
                                <td><div className="moveout-money"><span>¥</span><input type="number" min="0" step="0.01" value={item.actualCompensation} onChange={(e) => setMoveOutAnnex5Items((rows) => rows.map((row) => row.id === item.id ? { ...row, actualCompensation: Math.max(0, Number(e.target.value) || 0) } : row))} /></div></td>
                                <td><textarea rows={2} value={item.remark} placeholder={item.actualCompensation > 0 || !['完好', '正常损耗'].includes(item.moveOutStatus) ? '请说明异常或赔偿原因' : '选填'} onChange={(e) => setMoveOutAnnex5Items((rows) => rows.map((row) => row.id === item.id ? { ...row, remark: e.target.value } : row))} /></td>
                              </tr>
                            ))}
                            <tr className="annex5-total-row"><td></td><td>合计</td><td></td><td>{moveOutAnnex5Items.reduce((sum, item) => sum + item.moveInQuantity, 0)}</td><td></td><td></td><td></td><td>{moveOutAnnex5Items.reduce((sum, item) => sum + item.compensationQuantity, 0)}</td><td>¥{moveOutDamageCompensation.toFixed(2)}</td><td></td></tr>
                            <tr className="annex5-hygiene-row"><td colSpan={2}>退租卫生核验</td><td colSpan={8}><label><input type="radio" name="moveOutHygiene" checked={moveOutHygiene === 'PASS'} onChange={() => { setMoveOutHygiene('PASS'); setMoveOutCleaningFee(0) }} /> 无需保洁，符合重新出租标准</label><label><input type="radio" name="moveOutHygiene" checked={moveOutHygiene === 'FAIL'} onChange={() => setMoveOutHygiene('FAIL')} /> 需保洁，清洁程度不满足出租要求</label></td></tr>
                          </tbody>
                        </table>
                      </div>
                      <div className="moveout-comp-summary"><span>核验 {moveOutAnnex5Items.length} 项 · 异常 {moveOutAnnex5Items.filter((item) => item.actualCompensation > 0).length} 项</span><div>损坏赔偿合计 <strong>¥{moveOutDamageCompensation.toFixed(2)}</strong><small>将实时计入下一步押金试算</small></div></div>
                    </div>
                  ) : null}

                  {moveOutStep === 3 ? (
                    <div className="moveout-step-panel">
                      <div className="moveout-notice">按审批表口径核对“已交款项”和“应收款项”。履约保证金默认读取合同押金 ¥{moveOutDeposit.toFixed(2)}；损坏赔偿与保洁费由交接清单自动带入。</div>
                      <div className="moveout-ledger-editors">
                        <section className="moveout-ledger-card"><div className="moveout-ledger-head"><h3>已交款项</h3><button type="button" className="a-btn ghost" onClick={() => setMoveOutPaidItems((rows) => [...rows, { id: `paid-${Date.now()}`, name: '其他已交款项', amount: 0, remark: '' }])}>+ 添加</button></div><table><thead><tr><th>项目</th><th>金额（元）</th><th>备注</th><th /></tr></thead><tbody>{moveOutPaidItems.map((item) => <tr key={item.id}><td><input value={item.name} onChange={(e) => setMoveOutPaidItems((rows) => rows.map((row) => row.id === item.id ? { ...row, name: e.target.value } : row))} /></td><td><input type="number" min="0" step="0.01" value={item.amount} onChange={(e) => setMoveOutPaidItems((rows) => rows.map((row) => row.id === item.id ? { ...row, amount: Math.max(0, Number(e.target.value) || 0) } : row))} /></td><td><input value={item.remark} onChange={(e) => setMoveOutPaidItems((rows) => rows.map((row) => row.id === item.id ? { ...row, remark: e.target.value } : row))} /></td><td>{item.id.startsWith('paid-') ? <button type="button" onClick={() => setMoveOutPaidItems((rows) => rows.filter((row) => row.id !== item.id))}>删除</button> : null}</td></tr>)}</tbody></table></section>
                        <section className="moveout-ledger-card"><div className="moveout-ledger-head"><h3>应收款项</h3><button type="button" className="a-btn ghost" onClick={() => setMoveOutReceivableItems((rows) => [...rows, { id: `receivable-${Date.now()}`, name: '其他应收款项', amount: 0, remark: '' }])}>+ 添加</button></div><table><thead><tr><th>项目</th><th>金额（元）</th><th>备注</th><th /></tr></thead><tbody>{moveOutReceivableItemsForSubmit.map((item) => { const automatic = item.id === 'damage-compensation' || item.id === 'cleaning-fee'; return <tr key={item.id}><td><input value={item.name} disabled={automatic} onChange={(e) => setMoveOutReceivableItems((rows) => rows.map((row) => row.id === item.id ? { ...row, name: e.target.value } : row))} /></td><td><input type="number" min="0" step="0.01" disabled={automatic || (item.id === 'cleaning-fee' && moveOutHygiene === 'PASS')} value={item.amount} onChange={(e) => setMoveOutReceivableItems((rows) => rows.map((row) => row.id === item.id ? { ...row, amount: Math.max(0, Number(e.target.value) || 0) } : row))} /></td><td><input value={item.remark} onChange={(e) => setMoveOutReceivableItems((rows) => rows.map((row) => row.id === item.id ? { ...row, remark: e.target.value } : row))} /></td><td>{item.id.startsWith('receivable-') ? <button type="button" onClick={() => setMoveOutReceivableItems((rows) => rows.filter((row) => row.id !== item.id))}>删除</button> : null}</td></tr> })}</tbody></table>{moveOutHygiene === 'FAIL' ? <label className="moveout-cleaning-input">保洁费（由交接结果带入）<input type="number" min="0" step="0.01" value={moveOutCleaningFee} onChange={(e) => setMoveOutCleaningFee(Math.max(0, Number(e.target.value) || 0))} /></label> : null}</section>
                      </div>
                      <div className="moveout-settlement-summary"><div><span>已交小计</span><strong>¥{moveOutSettlementTotals.paidTotal.toFixed(2)}</strong></div><i>−</i><div><span>应收小计</span><strong>¥{moveOutSettlementTotals.receivableTotal.toFixed(2)}</strong></div><i>=</i><div className={moveOutSettlementTotals.amountDue > 0 ? 'due' : ''}><span>{moveOutSettlementTotals.amountDue > 0 ? '租户应补' : '预计应退'}</span><strong>¥{(moveOutSettlementTotals.amountDue || moveOutSettlementTotals.refundAmount).toFixed(2)}</strong></div></div>
                      <section className="moveout-section"><h3>申请事项</h3><textarea className="a-filter-input" rows={4} value={moveOutApplicationNote} onChange={(e) => setMoveOutApplicationNote(e.target.value)} placeholder={moveOutSettlementSnapshot.applicationNote} /><small>留空时由系统按已交、应收和应退/应补金额自动生成。</small></section>
                    </div>
                  ) : null}

                  {moveOutStep === 4 ? (
                    <div className="moveout-step-panel">
                      <div className="moveout-route-summary"><div><span>办理分支</span><strong>{moveOutRequireTenantConfirmation ? '需要租户确认' : '无需租户确认，店长直接办理'}</strong></div><p>{moveOutRequireTenantConfirmation ? '提交后租户将依次核对交接清单与结算明细、填写退款银行卡并电子签字。' : '提交后立即生成并归档审批表，可打印后报财务走退款流程。'}</p></div>
                      <MoveOutApprovalSheet tenantName={moveOutModal.tenant.name} houseName={`${moveOutModal.house.apartmentName} ${moveOutModal.house.houseNo}`} contractNo={formatContractNo(moveOutModal.contractNo)} rentMonthly={moveOutContractDetail?.rentMonthly ?? 0} leaseRange={`${moveOutContractDetail?.startDate ?? '—'} — ${moveOutContractDetail?.endDate ?? '—'}`} terminateDate={moveOutDate} reason={moveOutReason === '其他' ? moveOutReasonOther : moveOutReason} settlement={moveOutSettlementSnapshot} showPrintButton={false} />
                    </div>
                  ) : null}

                  <div className="moveout-footer"><button className="a-btn ghost" onClick={() => setMoveOutModal(null)}>取消</button><div>{moveOutStep > 1 ? <button className="a-btn ghost" onClick={() => setMoveOutStep((moveOutStep - 1) as 1 | 2 | 3)}>上一步</button> : null}{moveOutStep < 4 ? <button className="a-btn secondary" onClick={() => goNextMoveOutStep()}>下一步：{moveOutStep === 1 ? '房屋交接' : moveOutStep === 2 ? '结算明细' : '审批表预览'}</button> : <button className="a-btn secondary" onClick={submitMoveOut} disabled={moveOutSubmitting}>{moveOutSubmitting ? '提交中…' : moveOutRequireTenantConfirmation ? '店长签字并发起租户确认' : '确认并生成审批表'}</button>}</div></div>
                </>
              )}
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
                仅支持已退租（已终止）合同。退押金额须从本合同账单/首期款记录勾选，不可手填任意数字。
                <br />
                合同押金：<strong>¥{refundDepositOptions?.contractDeposit ?? '—'}</strong>
                {' · '}
                已退累计：<strong>¥{refundDepositOptions?.refundedAmount ?? refundDepositModal.refundedDepositAmount ?? 0}</strong>
                {' · '}
                可退上限：<strong>¥{refundDepositOptions?.maxRefundable ?? '—'}</strong>
              </div>
              {refundDepositOptionsLoading ? (
                <div className="a-muted">正在加载可退来源…</div>
              ) : refundDepositOptions ? (
                <>
                  {refundDepositOptions.maxRefundable <= 0 ? (
                    <div className="a-muted">该合同押金已全部退还，无可操作项。</div>
                  ) : (
                    <div className="a-kv">
                      <div className="a-kv-row">
                        <div className="a-kv-k">退押方式</div>
                        <div className="a-kv-v" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <label className="m-verify-agree" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <input
                              type="radio"
                              name="refundDepositMode"
                              checked={refundDepositMode === 'FULL'}
                              onChange={() => setRefundDepositMode('FULL')}
                            />
                            <span>
                              全额退押（剩余可退 <strong>¥{refundDepositOptions.maxRefundable}</strong>）
                            </span>
                          </label>
                          <label className="m-verify-agree" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <input
                              type="radio"
                              name="refundDepositMode"
                              checked={refundDepositMode === 'SELECTED'}
                              onChange={() => {
                                setRefundDepositMode('SELECTED')
                                if (
                                  refundDepositOptions.balanceSource &&
                                  !refundDepositOptions.paymentSource &&
                                  refundDepositOptions.billSources.length === 0
                                ) {
                                  setRefundDepositIncludeBalance(true)
                                }
                              }}
                            />
                            <span>按来源勾选（账单 / 首期款 / 押金余额，合计不超过可退上限）</span>
                          </label>
                        </div>
                      </div>
                      {refundDepositMode === 'SELECTED' ? (
                        <div className="a-kv-row">
                          <div className="a-kv-k">勾选来源</div>
                          <div className="a-kv-v">
                            {refundDepositOptions.paymentSource ? (
                              <label
                                style={{
                                  display: 'flex',
                                  gap: 8,
                                  alignItems: 'flex-start',
                                  marginBottom: 8,
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={refundDepositIncludePayment}
                                  onChange={(e) => setRefundDepositIncludePayment(e.target.checked)}
                                />
                                <span>
                                  {refundDepositOptions.paymentSource.label}
                                  <span className="a-muted" style={{ marginLeft: 6 }}>
                                    可退 ¥{refundDepositOptions.paymentSource.maxAmount}
                                    {refundDepositOptions.paymentSource.paidAt
                                      ? ` · 支付于 ${new Date(refundDepositOptions.paymentSource.paidAt).toLocaleString()}`
                                      : ''}
                                  </span>
                                </span>
                              </label>
                            ) : null}
                            {refundDepositOptions.balanceSource ? (
                              <label
                                style={{
                                  display: 'flex',
                                  gap: 8,
                                  alignItems: 'flex-start',
                                  marginBottom: 8,
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={refundDepositIncludeBalance}
                                  onChange={(e) => setRefundDepositIncludeBalance(e.target.checked)}
                                />
                                <span>
                                  {refundDepositOptions.balanceSource.label}
                                  <span className="a-muted" style={{ marginLeft: 6 }}>
                                    可退 ¥{refundDepositOptions.balanceSource.maxAmount}
                                  </span>
                                </span>
                              </label>
                            ) : null}
                            {refundDepositOptions.billSources.length === 0 ? (
                              <div className="a-muted" style={{ fontSize: 12, marginBottom: 8 }}>
                                本合同账单中暂无带「押金/保证金」明细的已收款项；可勾选上方「合同押金余额」或首期款记录。
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {refundDepositOptions.billSources.map((b) => (
                                  <label
                                    key={b.billId}
                                    style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={refundDepositBillIds.includes(b.billId)}
                                      onChange={(e) => {
                                        setRefundDepositBillIds((prev) =>
                                          e.target.checked
                                            ? [...prev, b.billId]
                                            : prev.filter((id) => id !== b.billId),
                                        )
                                      }}
                                    />
                                    <span>
                                      {b.label}
                                      <span className="a-muted" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                                        实收 ¥{b.amountReceived} · 本项可退 ¥{b.maxAmount} · {b.itemSummary}
                                      </span>
                                    </span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                      <div className="a-kv-row">
                        <div className="a-kv-k">本次退押</div>
                        <div className="a-kv-v" style={{ fontWeight: 800, fontSize: 18 }}>
                          ¥{refundDepositSelectedAmount}
                        </div>
                      </div>
                      <div className="a-kv-row">
                        <div className="a-kv-k">模板类型</div>
                        <div className="a-kv-v">
                          <select
                            className="a-filter-select"
                            value={refundDepositTemplate}
                            onChange={(e) => setRefundDepositTemplate(e.target.value)}
                          >
                            {DEPOSIT_REFUND_TEMPLATES.map((t) => (
                              <option key={t.code} value={t.code}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                          <div className="a-muted" style={{ marginTop: 6, fontSize: 12 }}>
                            将写入退款记录备注，便于审计追溯。
                          </div>
                        </div>
                      </div>
                      <div className="a-kv-row">
                        <div className="a-kv-k">备注</div>
                        <div className="a-kv-v">
                          <textarea
                            className="a-filter-input"
                            placeholder="可选：例如 扣除保洁费说明（金额仍须通过勾选来源确定）"
                            rows={3}
                            value={refundDepositRemark}
                            onChange={(e) => setRefundDepositRemark(e.target.value)}
                            style={{ resize: 'vertical', minHeight: 60 }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="a-muted">未能加载可退来源，请关闭后重试。</div>
              )}
              <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="a-btn"
                  onClick={submitRefundDeposit}
                  disabled={
                    refundDepositSubmitting ||
                    refundDepositOptionsLoading ||
                    !refundDepositOptions ||
                    refundDepositOptions.maxRefundable <= 0 ||
                    refundDepositSelectedAmount <= 0
                  }
                >
                  {refundDepositSubmitting ? '提交中…' : `确认退押金 ¥${refundDepositSelectedAmount}`}
                </button>
                <button
                  type="button"
                  className="a-btn ghost"
                  onClick={() => {
                    setRefundDepositModal(null)
                    setRefundDepositOptions(null)
                  }}
                >
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
                        <div className="a-muted" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.5 }}>
                          一般为旧合同结束日的次日（即新合同第一天）。支持倒签（可早于今天）。租客须在该日起 24
                          小时内完成确认、签字与首期款支付，超时新合同自动作废。
                        </div>
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
                              rentCycle: e.target.value as RentCycle,
                            }))
                          }
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
                          value={renewForm.penaltyFormula}
                          onChange={(e) => setRenewForm((f) => ({ ...f, penaltyFormula: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="a-kv-row">
                      <div className="a-kv-k">交租日</div>
                      <div className="a-kv-v">
                        <input
                          className="a-filter-input"
                          type="number"
                          min={1}
                          max={31}
                          value={renewForm.rentDueDay}
                          onChange={(e) =>
                            setRenewForm((f) => ({ ...f, rentDueDay: e.target.value.replace(/\D/g, '').slice(0, 2) }))
                          }
                        />
                        <div className="a-muted" style={{ marginTop: 4, fontSize: 12 }}>
                          {rentCycleDueDayHint(renewForm.rentCycle)}；当月无该日则取月末。
                        </div>
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

      {billingResumeModal && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !billingActionSubmitting) setBillingResumeModal(null)
          }}
        >
          <div className="a-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">恢复计费 · {formatContractNo(billingResumeModal.contractNo)}</div>
              <button type="button" className="a-modal-close" onClick={() => setBillingResumeModal(null)} disabled={billingActionSubmitting}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <p className="a-muted" style={{ marginTop: 0, lineHeight: 1.55 }}>
                可指定从某一日起恢复推送租金、水电、滞纳金等计费；若选未来日期，则到期前仍视为暂停（不计入应收报表）。
              </p>
              <div className="a-kv" style={{ marginTop: 12 }}>
                <div className="a-kv-row">
                  <div className="a-kv-k">恢复计费日</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="date"
                      value={billingResumeFrom}
                      onChange={(e) => setBillingResumeFrom(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="a-row" style={{ marginTop: 16, gap: 10 }}>
                <button
                  type="button"
                  className="a-btn"
                  disabled={billingActionSubmitting || !billingResumeFrom}
                  onClick={async () => {
                    setBillingActionSubmitting(true)
                    setError('')
                    const r = await apiPost<{ ok: true; billingPaused: boolean }>(
                      `/api/admin/contracts/${billingResumeModal.id}/billing-resume`,
                      { resumeFrom: billingResumeFrom },
                    )
                    setBillingActionSubmitting(false)
                    if (!r.ok) return setError(apiErrorZh(r.error))
                    setMsg(r.data.billingPaused ? `已设定 ${billingResumeFrom} 起恢复计费` : '已恢复计费')
                    setBillingResumeModal(null)
                    await load()
                  }}
                >
                  {billingActionSubmitting ? '提交中…' : '确认恢复'}
                </button>
                <button type="button" className="a-btn ghost" onClick={() => setBillingResumeModal(null)} disabled={billingActionSubmitting}>
                  取消
                </button>
              </div>
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
              {changeHouseModal.mergedBundle &&
              changeHouseModal.mergedBundle.lines.filter((l) => !l.releasedAt).length > 1 ? (
                <div className="a-kv" style={{ marginBottom: 12 }}>
                  <div className="a-kv-row">
                    <div className="a-kv-k">换房范围</div>
                    <div className="a-kv-v" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="radio"
                          name="chScope"
                          checked={chScope === 'ALL'}
                          onChange={() => {
                            setChScope('ALL')
                            setChSourceHouseId('')
                          }}
                        />
                        <span>整套换房</span>
                      </label>
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="radio"
                          name="chScope"
                          checked={chScope === 'PARTIAL'}
                          onChange={() => setChScope('PARTIAL')}
                        />
                        <span>仅迁出一套</span>
                      </label>
                      {chScope === 'PARTIAL' ? (
                        <select
                          className="a-filter-select"
                          style={{ maxWidth: 380 }}
                          value={chSourceHouseId}
                          onChange={(e) => setChSourceHouseId(e.target.value)}
                        >
                          <option value="">请选择要迁出的子房源</option>
                          {changeHouseModal.mergedBundle.lines
                            .filter((l) => !l.releasedAt)
                            .map((ln) => (
                              <option key={ln.houseId} value={ln.houseId}>
                                {ln.apartmentName} · {ln.houseNo}
                              </option>
                            ))}
                        </select>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

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
                  <div className="a-kv-k">签订日期</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="date"
                      value={editForm.agreementSignDate}
                      onChange={(e) => setEditForm((f) => ({ ...f, agreementSignDate: e.target.value }))}
                    />
                    <div className="a-muted" style={{ marginTop: 4, fontSize: 12 }}>
                      可选；书面合同落款用「签订日期」。留空则不在档案中单独记录（与电子签字时间可能不同）。
                    </div>
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
                      onChange={(e) => setEditForm((f) => ({ ...f, rentCycle: e.target.value as RentCycle }))}
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
                      type="text"
                      placeholder="如 amount*0.1%*days"
                      value={editForm.penaltyFormula}
                      onChange={(e) => setEditForm((f) => ({ ...f, penaltyFormula: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">交租日</div>
                  <div className="a-kv-v">
                    <input
                      className="a-filter-input"
                      type="number"
                      min={1}
                      max={31}
                      value={editForm.rentDueDay}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, rentDueDay: e.target.value.replace(/\D/g, '').slice(0, 2) }))
                      }
                    />
                    <div className="a-muted" style={{ marginTop: 4, fontSize: 12 }}>
                      {rentCycleDueDayHint(editForm.rentCycle)}；当月无该日则取月末。
                    </div>
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
                    {contractAttachmentsLockedUntilPaid(editContract.status) ? (
                      <div className="a-muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.6 }}>
                        待支付：预览带水印，租客缴费生效后方可下载正式附件。
                      </div>
                    ) : null}
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
                            onClick={() => previewFileWithAuth(a.previewUrl).catch((e) => setError(e instanceof Error ? e.message : '预览失败'))}
                          >
                            预览
                          </button>{' '}
                          <button
                            type="button"
                            className="a-btn ghost"
                            style={{ padding: '2px 8px', fontSize: 12 }}
                            disabled={contractAttachmentsLockedUntilPaid(editContract.status)}
                            title={
                              contractAttachmentsLockedUntilPaid(editContract.status)
                                ? '租客完成首笔缴费后方可下载'
                                : undefined
                            }
                            onClick={() =>
                              downloadFileWithAuth(a.downloadUrl, a.name).catch((e) =>
                                setError(e instanceof Error ? e.message : '下载失败'),
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
          <div className="a-modal a-modal--change-log">
            <div className="a-modal-header">
              <div className="a-modal-title">新建合同（管理员手动创建，直接生效）</div>
              <button className="a-modal-close" onClick={() => setCreateModalOpen(false)} disabled={createSubmitting}>
                关闭
              </button>
            </div>

            <div className="a-modal-body">
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">合同模板</div>
                  <div className="a-kv-v">
                    <ContractTemplateSelect
                      value={createForm.contractTemplate}
                      onChange={(next) => {
                        setCreateForm((f) => ({ ...f, contractTemplate: next }))
                        if (next === 'JIANGNAN_FACTORY') setJiangnanForm(defaultJiangnanFactoryForm())
                        if (next === 'NON_RESIDENTIAL') setNonResidentialForm(defaultNonResidentialForm())
                        if (next === 'RESIDENTIAL_ASSET') setResidentialForm(defaultResidentialAssetForm())
                        if (next === 'NANNING_HOUSING') setNanningHousingForm(defaultNanningHousingForm())
                      }}
                    />
                  </div>
                </div>
                {createForm.contractTemplate === 'JIANGNAN_FACTORY' ? (
                  <JiangnanFactoryContractForm
                    value={jiangnanForm}
                    onChange={setJiangnanForm}
                    pendingFiles={createPendingFiles}
                    onPendingFilesChange={setCreatePendingFiles}
                  />
                ) : createForm.contractTemplate === 'NON_RESIDENTIAL' ? (
                  <NonResidentialContractForm
                    value={nonResidentialForm}
                    onChange={setNonResidentialForm}
                    pendingFiles={createPendingFiles}
                    onPendingFilesChange={setCreatePendingFiles}
                  />
                ) : createForm.contractTemplate === 'RESIDENTIAL_ASSET' ? (
                  <ResidentialAssetContractForm
                    value={residentialForm}
                    onChange={setResidentialForm}
                    pendingFiles={createPendingFiles}
                    onPendingFilesChange={setCreatePendingFiles}
                  />
                ) : createForm.contractTemplate === 'NANNING_HOUSING' ? (
                  <NanningHousingContractForm
                    value={nanningHousingForm}
                    onChange={setNanningHousingForm}
                    pendingFiles={createPendingFiles}
                    onPendingFilesChange={setCreatePendingFiles}
                  />
                ) : null}
              </div>

              <div className="a-kv">
                {createForm.contractTemplate === 'JIANGNAN_FACTORY' ||
                createForm.contractTemplate === 'NON_RESIDENTIAL' ||
                createForm.contractTemplate === 'RESIDENTIAL_ASSET' ||
                createForm.contractTemplate === 'NANNING_HOUSING' ? (
                  <div className="a-kv-row">
                    <div className="a-kv-k">操作</div>
                    <div className="a-kv-v">
                      <div className="a-row">
                        <button
                          className="a-btn ghost"
                          onClick={() => setCreateModalOpen(false)}
                          disabled={createSubmitting}
                        >
                          取消
                        </button>
                        <button className="a-btn" onClick={() => void submitCreate()} disabled={createSubmitting}>
                          {createSubmitting ? '创建中…' : '确认创建并生效'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                <>
                <div className="a-kv-row">
                  <div className="a-kv-k">合同预览</div>
                  <div className="a-kv-v">
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>租赁合同（预览）</div>
                    <div className="a-muted" style={{ lineHeight: 1.8 }}>
                      租客：
                      {createForm.tenantName.trim() || '—'}
                      {createForm.tenantPhone.trim() ? `（${createForm.tenantPhone.trim()}）` : ''}
                      <br />
                      房源：
                      {createSelectedHouse
                        ? `${createSelectedHouse.apartmentName} ${createSelectedHouse.houseNo}（${createSelectedHouse.storeName}）`
                        : '—'}
                      <br />
                      租期：{createForm.leaseMonths} 个月，入住：{createForm.startDate || '—'}
                      <br />
                      月租：¥{createForm.rentMonthly}，押金：¥
                      {Math.round(createForm.rentMonthly * createForm.depositMultiple)}
                      <br />
                      缴费周期：{rentCycleLabel(createForm.rentCycle)}
                      <br />
                      滞纳金：{createForm.penaltyFormula}
                      <br />
                      交租日：每期起始月 {createForm.rentDueDay || '—'} 日（{rentCycleLabel(createForm.rentCycle)}）
                      <br />
                      最晚交租宽限期：
                      {createForm.latestRentGraceDays.trim()
                        ? `${createForm.latestRentGraceDays.trim()} 天`
                        : '未约定'}
                      <br />
                      合同模板：{contractTemplateZh(createForm.contractTemplate)}
                      <br />
                      合同来源：手动导入（创建后直接生效，无需租客签字/支付）
                      <br />
                      {contractTemplateUsesRentMultipleTermination(createForm.contractTemplate) ? (
                        <>
                          解除类短信：逾期金额超过月租的 {createForm.terminationRentMulti.trim() || '—'} 倍时触发
                        </>
                      ) : (
                        <>
                          解除类短信：超过最晚缴费日后满 {createForm.terminationDaysPastDue.trim() || '—'} 天时触发
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">操作</div>
                  <div className="a-kv-v">
                    <div className="a-row">
                      <button
                        className="a-btn ghost"
                        onClick={() => setCreateModalOpen(false)}
                        disabled={createSubmitting}
                      >
                        取消
                      </button>
                      <button className="a-btn" onClick={() => void submitCreate()} disabled={createSubmitting}>
                        {createSubmitting ? '创建中…' : '确认创建并生效'}
                      </button>
                    </div>
                  </div>
                </div>
                </>
                )}
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
          <div className="a-modal a-modal--contract-detail" onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">合同详情 · {formatContractNo(detailContract.contractNo)}</div>
              <button className="a-modal-close" onClick={() => setDetailContract(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv a-contract-detail-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">当前状态</div>
                  <div className="a-kv-v">
                    <span className={statusBadgeClass(detailContract.status)}>
                      {CONTRACT_STATUS_ZH[detailContract.status] ?? detailContract.status}
                    </span>
                  </div>
                </div>
                {detailContract.status === 'WAIT_TENANT_MOVEOUT_SIGN' &&
                detailContract.moveOutSignDeadlineAt &&
                detailContract.moveOutPending ? (
                  <div className="a-kv-row">
                    <div className="a-kv-k">退租确认</div>
                    <div className="a-kv-v">
                      <div
                        style={{
                          padding: '10px 12px',
                          borderRadius: 8,
                          background: '#fffbeb',
                          border: '1px solid #fcd34d',
                          marginBottom: 8,
                        }}
                      >
                        <div style={{ fontWeight: 800, color: '#92400e' }}>租客签字倒计时（7 天）</div>
                        <div
                          style={{
                            fontSize: 26,
                            fontWeight: 900,
                            marginTop: 6,
                            color: '#b45309',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {formatSignLikeCountdown(
                            new Date(detailContract.moveOutSignDeadlineAt).getTime() - nowTick,
                          ) ?? '—'}
                        </div>
                        <div className="a-muted" style={{ marginTop: 8, fontSize: 12 }}>
                          截止：{new Date(detailContract.moveOutSignDeadlineAt).toLocaleString('zh-CN', { hour12: false })}
                        </div>
                      </div>
                      <div className="a-muted" style={{ fontSize: 13, marginBottom: 6 }}>
                        拟定退租日：<strong>{detailContract.moveOutPending.terminateDate}</strong>
                        {detailContract.moveOutPending.partial ? '（部分退租）' : ''}
                      </div>
                      <div style={{ fontSize: 13, marginBottom: 8 }}>{detailContract.moveOutPending.reasonFull}</div>
                      {detailContract.moveOutPending.attachments.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {detailContract.moveOutPending.attachments.map((a) => (
                            <li key={a.file} style={{ marginBottom: 4 }}>
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
                              </button>
                              <button
                                type="button"
                                className="a-btn ghost"
                                style={{ padding: '2px 8px', fontSize: 12 }}
                                onClick={() =>
                                  downloadFileWithAuth(a.downloadUrl, a.name).catch((e) =>
                                    setError(e instanceof Error ? e.message : '下载失败'),
                                  )
                                }
                              >
                                下载
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="a-muted">无附件</span>
                      )}
                    </div>
                  </div>
                ) : null}
                {detailContract.moveOutArchive?.settlement ? (
                  <div className="a-kv-row a-kv-row--wide">
                    <div className="a-kv-k">退租结算审批表</div>
                    <div className="a-kv-v">
                      <MoveOutApprovalSheet
                        tenantName={detailContract.tenant.name}
                        houseName={`${detailContract.house.apartmentName} ${detailContract.house.houseNo}`}
                        contractNo={formatContractNo(detailContract.contractNo)}
                        rentMonthly={detailContract.rentMonthly}
                        leaseRange={`${detailContract.startDate} — ${detailContract.endDate}`}
                        terminateDate={detailContract.moveOutArchive.terminateDate}
                        reason={detailContract.moveOutArchive.reasonFull}
                        settlement={detailContract.moveOutArchive.settlement}
                        completedAt={detailContract.moveOutArchive.completedAt}
                        completedBy={detailContract.moveOutArchive.completedBy}
                        bank={detailContract.moveOutArchive.tenantConfirmation ?? null}
                      />
                    </div>
                  </div>
                ) : null}
                <div className="a-kv-row">
                  <div className="a-kv-k">房源</div>
                  <div className="a-kv-v">
                    {detailContract.mergedBundle && detailContract.mergedBundle.lines.length > 0 ? (
                      <div>
                        <div className="a-muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
                          本合同为<strong>合并签约</strong>：当前在租 {detailContract.mergedBundle.lineCount} 套
                          {detailContract.mergedBundle.lineHistoryCount != null &&
                          detailContract.mergedBundle.lineHistoryCount > detailContract.mergedBundle.lineCount
                            ? `（历史共 ${detailContract.mergedBundle.lineHistoryCount} 条子订单）`
                            : ''}
                          ；在租月租快照合计 ¥{detailContract.mergedBundle.rentMonthlySum}（与合同月租字段一致）。
                        </div>
                        <div className="a-table-wrap a-contract-detail-merged-table">
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
                              {detailContract.mergedBundle.lines.map((ln) => (
                              <tr key={ln.houseBizId}>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{ln.houseBizId}</td>
                                <td>
                                  {ln.apartmentName} · {ln.houseNo}
                                </td>
                                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                  ¥{ln.rentMonthlySnapshot}
                                </td>
                                <td className="a-muted" style={{ fontSize: 12 }}>
                                  {ln.lineStatusLabel ?? (ln.releasedAt ? '已迁出' : '在用')}
                                  {ln.lineStatus === 'CHANGED' && ln.changeHouseNewContractNo ? (
                                    <div style={{ marginTop: 4 }}>
                                      新合同 {formatContractNo(ln.changeHouseNewContractNo)}
                                    </div>
                                  ) : null}
                                </td>
                              </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="a-muted" style={{ fontSize: 12, marginTop: 8 }}>
                          主房源（合同/报备挂接）：{detailContract.house.apartmentName} {detailContract.house.houseNo}（
                          {detailContract.house.storeName}）
                        </div>
                      </div>
                    ) : (
                      <>
                        {detailContract.house.apartmentName} {detailContract.house.houseNo}（
                        {detailContract.house.storeName}）
                      </>
                    )}
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
                {detailContract.billPushToTenant ? (
                  <div className="a-kv-row">
                    <div className="a-kv-k">账单推送</div>
                    <div className="a-kv-v">
                      <span
                        className={
                          detailContract.billPushStatus === 'ACTIVE'
                            ? 'a-badge status-active'
                            : detailContract.billPushStatus === 'PENDING_TENANT'
                              ? 'a-badge status-wait-sign'
                              : 'a-badge'
                        }
                      >
                        {BILL_PUSH_STATUS_ZH[detailContract.billPushStatus ?? ''] ??
                          detailContract.billPushStatus ??
                          '—'}
                      </span>
                      {detailContract.billPushStatus === 'PENDING_TENANT' ? (
                        <div className="a-muted" style={{ marginTop: 6, fontSize: 12 }}>
                          租户尚未在移动端完成实名认证（按身份证号匹配），账单已生成但暂不可在租户端查看。
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
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
                {detailContract.changeHouseMoney ? (
                  <div className="a-kv-row" style={{ alignItems: 'flex-start' }}>
                    <div className="a-kv-k">换房资金</div>
                    <div className="a-kv-v" style={{ fontSize: 13, lineHeight: 1.65 }}>
                      <div className="a-muted" style={{ marginBottom: 8 }}>
                        以下为换房生成新合同时的系统快照，便于财务核对；账单列表以「账单」页为准。
                      </div>
                      <div>
                        旧合同：<strong>{formatContractNo(detailContract.changeHouseMoney.oldContractNo)}</strong>
                        ，换房日 {detailContract.changeHouseMoney.moveDateYmd}
                      </div>
                      <div>预付租金可结转：¥{detailContract.changeHouseMoney.prepaidRentCredit}</div>
                      {detailContract.changeHouseMoney.prepaidRentSources.length > 0 ? (
                        <ul style={{ margin: '6px 0 0 18px' }}>
                          {detailContract.changeHouseMoney.prepaidRentSources.map((s) => (
                            <li key={s.period}>
                              账期 {s.period}：¥{s.amount}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {detailContract.changeHouseMoney.prepaidAppliedToPeriods.length > 0 ? (
                        <div style={{ marginTop: 8 }}>
                          已抵扣至新合同账期：
                          <ul style={{ margin: '4px 0 0 18px' }}>
                            {detailContract.changeHouseMoney.prepaidAppliedToPeriods.map((s) => (
                              <li key={s.period}>
                                {s.period}：¥{s.amount}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <div style={{ marginTop: 8 }}>押金少补（换房补差账单）：¥{detailContract.changeHouseMoney.depositSupplement}</div>
                      {detailContract.changeHouseMoney.prepaidSkippedReason ? (
                        <div className="a-muted" style={{ marginTop: 8 }}>
                          {detailContract.changeHouseMoney.prepaidSkippedReason}
                        </div>
                      ) : null}
                      <pre
                        style={{
                          marginTop: 10,
                          padding: 10,
                          background: '#f8fafc',
                          borderRadius: 8,
                          fontSize: 12,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {detailContract.changeHouseMoney.ruleSummary}
                      </pre>
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
                  <div className="a-kv-k">签订日期</div>
                  <div className="a-kv-v">{detailContract.agreementSignDate ?? '—'}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">交租日</div>
                  <div className="a-kv-v">
                    {detailContract.rentDueDay != null
                      ? `每期起始月 ${detailContract.rentDueDay} 日`
                      : '—'}
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
                      {contractAttachmentsLockedUntilPaid(detailContract.status) ? (
                        <div className="a-muted" style={{ fontSize: 12, marginBottom: 8 }}>
                          待支付：预览为带水印稿；租客完成首笔缴费后方可下载。
                        </div>
                      ) : null}
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {detailContract.attachments.map((a) => (
                          <li key={a.id} style={{ marginBottom: 6 }}>
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
                              disabled={contractAttachmentsLockedUntilPaid(detailContract.status)}
                              title={
                                contractAttachmentsLockedUntilPaid(detailContract.status)
                                  ? '租客完成首笔缴费后方可下载'
                                  : undefined
                              }
                              onClick={() =>
                                downloadFileWithAuth(a.downloadUrl, a.name).catch((e) =>
                                  setError(e instanceof Error ? e.message : '下载失败'),
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
                  <div className="a-kv-k">住建报备</div>
                  <div className="a-kv-v">
                    <div>
                      {detailContract.housingReport
                        ? `${REPORT_STATUS_ZH[detailContract.housingReport.status] ?? detailContract.housingReport.status}${detailContract.housingReport.reportedAt ? ` · ${new Date(detailContract.housingReport.reportedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}${detailContract.housingReport.lastError ? ` · ${detailContract.housingReport.lastError}` : ''}`
                        : '未报备'}
                    </div>
                    {detailContract.housingReport?.status === 'SUCCESS' ? (
                      <div style={{ marginTop: 10 }}>
                        <button
                          type="button"
                          className="a-btn ghost"
                          onClick={() =>
                            downloadFileWithAuth(
                              '/api/admin/contracts/' + detailContract.id + '/housing-receipt',
                              `住建报备回执-${detailContract.contractNo}.pdf`,
                            ).catch((e) =>
                              setError(
                                e instanceof Error ? apiErrorZh(e.message) || e.message : '下载失败',
                              ),
                            )
                          }
                        >
                          下载报备回执
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">住建备案编号</div>
                  <div className="a-kv-v" style={{ fontWeight: 600 }}>
                    {detailContract.housingReport?.bureauRecordNo ?? '—'}
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
