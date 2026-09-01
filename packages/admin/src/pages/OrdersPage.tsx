import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPatch, apiPost, apiUploadContractAttachment, apiDeleteContractAttachment } from '../api'
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
  normalizeContractTemplate,
  type ContractTemplateKind,
} from '../contractTemplate'
import {
  defaultJiangnanFactoryForm,
  leaseEndFromStartMonths,
  leaseMonthsFromRange,
  parseJiangnanFactoryForm,
  performanceBondAmount,
  serializeJiangnanFactoryForm,
  sumHouseRentMonthly,
  syncJiangnanDerivedFields,
  validateJiangnanFactoryForm,
  type JiangnanFactoryFormData,
  type JiangnanHousePick,
} from '../jiangnanFactoryContract'
import {
  defaultNonResidentialForm,
  nonResidentialPerformanceBondAmount,
  parseNonResidentialForm,
  serializeNonResidentialForm,
  sumHouseRentMonthly as nrSumHouseRentMonthly,
  syncNonResidentialDerivedFields,
  validateNonResidentialForm,
  type NonResidentialFormData,
} from '../nonResidentialContract'
import {
  defaultResidentialAssetForm,
  parseResidentialAssetForm,
  residentialHousingBondAmount,
  serializeResidentialAssetForm,
  sumHouseRentMonthly as raSumHouseRentMonthly,
  syncResidentialDerivedFields,
  validateResidentialAssetForm,
  type ResidentialAssetFormData,
} from '../residentialAssetContract'
import {
  bowanMonthlyRentNumber,
  bowanPenaltyFormula,
  bowanPerformanceBondAmount,
  defaultNanningHousingForm,
  parseNanningHousingForm,
  serializeNanningHousingForm,
  syncNanningHousingDerivedFields,
  toBowanHousePick,
  validateNanningHousingForm,
  type NanningHousingFormData,
} from '../nanningHousingContract'
import type { ContractHousePick } from '../contractFormShared'
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
  faceVerifiedAt?: string | null
  attachments?: {
    id: string
    name: string
    file: string
    category: string
    previewUrl: string
    downloadUrl: string
  }[]
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
    case 'NEED_REVISION':
      return 'a-badge status-unpaid'
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
    case 'NEED_REVISION':
      return '待租客修改'
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

function orderAttachmentCategoryZh(cat: string) {
  if (cat === 'DEAL_CONFIRMATION') return '成交确认书'
  if (cat === 'BUSINESS_LICENSE') return '营业执照'
  return '其他'
}

function contractStatusZh(status: string | null) {
  if (!status) return '未生成'
  switch (status) {
    case 'WAIT_INTERNAL_OA':
      return '待华创OA'
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
    case 'WAIT_INTERNAL_OA':
      return 'a-badge status-ordered'
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
    const reason = approved ? '' : prompt('请输入退回修改原因（必填，租客可改附件后重提）') || ''
    if (!approved && !reason.trim()) return
    if (!approved && !confirm('确认退回该订单？房源保持锁定，租客可修改附件后重新提交。')) return
    const r = await apiPost<{ ok: true }>('/api/admin/orders/' + orderId + '/review', { approved, reason })
    if (!r.ok) {
      const map: Record<string, string> = {
        DEAL_CONFIRMATION_REQUIRED: '租客尚未上传成交确认书，无法通过',
        BUSINESS_LICENSE_REQUIRED: '企业租户尚未上传营业执照，无法通过',
        REASON_REQUIRED: '请填写退回原因',
      }
      return setError(map[r.error] || r.error)
    }
    setMsg(approved ? '审核已通过' : '已退回租客修改（房源仍锁定）')
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
  const [cfgContractTemplate, setCfgContractTemplate] = useState<ContractTemplateKind>('RESIDENTIAL_ASSET')
  const [cfgTerminationRentMulti, setCfgTerminationRentMulti] = useState('2')
  const [cfgTerminationDaysPastDue, setCfgTerminationDaysPastDue] = useState('7')
  const [jiangnanForm, setJiangnanForm] = useState<JiangnanFactoryFormData>(() => defaultJiangnanFactoryForm())
  const [nonResidentialForm, setNonResidentialForm] = useState<NonResidentialFormData>(() => defaultNonResidentialForm())
  const [residentialForm, setResidentialForm] = useState<ResidentialAssetFormData>(() => defaultResidentialAssetForm())
  const [nanningHousingForm, setNanningHousingForm] = useState<NanningHousingFormData>(() => defaultNanningHousingForm())
  const [cfgPendingFiles, setCfgPendingFiles] = useState<File[]>([])

  function prefillJiangnanFromOrder(o: OrderItem): JiangnanFactoryFormData {
    const leaseStart = o.moveInDate || new Date().toISOString().slice(0, 10)
    const leaseEnd = leaseEndFromStartMonths(leaseStart, o.leaseMonths || 12)
    const tenants = [
      {
        id: o.tenantId,
        name: o.tenant.name,
        phone: o.tenant.phone,
        idNumber: o.tenant.idNumber,
      },
    ]
    let houses: JiangnanHousePick[] = []
    if (o.isMergedBundle && o.bundleLines?.length) {
      houses = o.bundleLines.map((l) => ({
        id: l.houseId,
        apartmentName: l.apartmentName,
        houseNo: l.houseNo,
        storeName: o.house.storeName,
        address: '',
        area: 0,
        rentMonthly: l.rentMonthlySnapshot,
      }))
    } else {
      houses = [
        {
          id: o.house.id,
          apartmentName: o.house.apartmentName,
          houseNo: o.house.houseNo,
          storeName: o.house.storeName,
          address: '',
          area: 0,
          rentMonthly: o.bundleRentMonthlySum ?? o.house.rentMonthly,
        },
      ]
    }
    return syncJiangnanDerivedFields({
      ...defaultJiangnanFactoryForm(),
      tenantIds: [o.tenantId],
      tenants,
      houseIds: houses.map((h) => h.id),
      houses,
      leaseStart,
      leaseEnd,
      rentDueDay: String(rentDueDayFromYmd(leaseStart)),
    })
  }

  async function enrichJiangnanHousesFromApi(form: JiangnanFactoryFormData): Promise<JiangnanFactoryFormData> {
    if (!form.houseIds.length) return form
    const r = await apiGet<{ items: JiangnanHousePick[] }>('/api/admin/houses')
    if (!r.ok) return form
    const map = new Map(r.data.items.map((h) => [h.id, h]))
    const houses = form.houseIds
      .map((id) => map.get(id))
      .filter(Boolean)
      .map((h) => ({
        id: h!.id,
        apartmentName: h!.apartmentName,
        houseNo: h!.houseNo,
        storeName: h!.storeName,
        address: h!.address ?? '',
        area: h!.area,
        rentMonthly: h!.rentMonthly,
        status: h!.status,
      }))
    return syncJiangnanDerivedFields(form, { houses, houseIds: houses.map((x) => x.id) })
  }

  function prefillNonResidentialFromOrder(o: OrderItem): NonResidentialFormData {
    const leaseStart = o.moveInDate || new Date().toISOString().slice(0, 10)
    const leaseEnd = leaseEndFromStartMonths(leaseStart, o.leaseMonths || 12)
    const tenants = [
      {
        id: o.tenantId,
        name: o.tenant.name,
        phone: o.tenant.phone,
        idNumber: o.tenant.idNumber,
      },
    ]
    let houses: ContractHousePick[] = []
    if (o.isMergedBundle && o.bundleLines?.length) {
      houses = o.bundleLines.map((l) => ({
        id: l.houseId,
        apartmentName: l.apartmentName,
        houseNo: l.houseNo,
        storeName: o.house.storeName,
        address: '',
        area: 0,
        rentMonthly: l.rentMonthlySnapshot,
      }))
    } else {
      houses = [
        {
          id: o.house.id,
          apartmentName: o.house.apartmentName,
          houseNo: o.house.houseNo,
          storeName: o.house.storeName,
          address: '',
          area: 0,
          rentMonthly: o.bundleRentMonthlySum ?? o.house.rentMonthly,
        },
      ]
    }
    return syncNonResidentialDerivedFields({
      ...defaultNonResidentialForm(),
      tenantIds: [o.tenantId],
      tenants,
      houseIds: houses.map((h) => h.id),
      houses,
      leaseStart,
      leaseEnd,
      rentDueDay: '20',
    })
  }

  async function enrichNonResidentialHousesFromApi(form: NonResidentialFormData): Promise<NonResidentialFormData> {
    if (!form.houseIds.length) return form
    const r = await apiGet<{ items: ContractHousePick[] }>('/api/admin/houses')
    if (!r.ok) return form
    const map = new Map(r.data.items.map((h) => [h.id, h]))
    const houses = form.houseIds
      .map((id) => map.get(id))
      .filter(Boolean)
      .map((h) => ({
        id: h!.id,
        apartmentName: h!.apartmentName,
        houseNo: h!.houseNo,
        storeName: h!.storeName,
        address: h!.address ?? '',
        area: h!.area,
        rentMonthly: h!.rentMonthly,
        status: h!.status,
      }))
    return syncNonResidentialDerivedFields(form, { houses, houseIds: houses.map((x) => x.id) })
  }

  function prefillResidentialFromOrder(o: OrderItem): ResidentialAssetFormData {
    const leaseStart = o.moveInDate || new Date().toISOString().slice(0, 10)
    const leaseEnd = leaseEndFromStartMonths(leaseStart, o.leaseMonths || 12)
    const tenants = [
      {
        id: o.tenantId,
        name: o.tenant.name,
        phone: o.tenant.phone,
        idNumber: o.tenant.idNumber,
      },
    ]
    let houses: ContractHousePick[] = []
    if (o.isMergedBundle && o.bundleLines?.length) {
      houses = o.bundleLines.map((l) => ({
        id: l.houseId,
        apartmentName: l.apartmentName,
        houseNo: l.houseNo,
        storeName: o.house.storeName,
        address: '',
        area: 0,
        rentMonthly: l.rentMonthlySnapshot,
      }))
    } else {
      houses = [
        {
          id: o.house.id,
          apartmentName: o.house.apartmentName,
          houseNo: o.house.houseNo,
          storeName: o.house.storeName,
          address: '',
          area: 0,
          rentMonthly: o.bundleRentMonthlySum ?? o.house.rentMonthly,
        },
      ]
    }
    return syncResidentialDerivedFields({
      ...defaultResidentialAssetForm(),
      tenantIds: [o.tenantId],
      tenants,
      houseIds: houses.map((h) => h.id),
      houses,
      leaseStart,
      leaseEnd,
      rentDueDay: String(rentDueDayFromYmd(leaseStart)),
    })
  }

  async function enrichResidentialHousesFromApi(form: ResidentialAssetFormData): Promise<ResidentialAssetFormData> {
    if (!form.houseIds.length) return form
    const r = await apiGet<{ items: ContractHousePick[] }>('/api/admin/houses')
    if (!r.ok) return form
    const map = new Map(r.data.items.map((h) => [h.id, h]))
    const houses = form.houseIds
      .map((id) => map.get(id))
      .filter(Boolean)
      .map((h) => ({
        id: h!.id,
        apartmentName: h!.apartmentName,
        houseNo: h!.houseNo,
        storeName: h!.storeName,
        address: h!.address ?? '',
        area: h!.area,
        rentMonthly: h!.rentMonthly,
        status: h!.status,
      }))
    return syncResidentialDerivedFields(form, { houses, houseIds: houses.map((x) => x.id) })
  }

  function prefillNanningHousingFromOrder(o: OrderItem): NanningHousingFormData {
    const leaseStart = o.moveInDate || new Date().toISOString().slice(0, 10)
    const leaseEnd = leaseEndFromStartMonths(leaseStart, o.leaseMonths || 12)
    const tenants = [
      {
        id: o.tenantId,
        name: o.tenant.name,
        phone: o.tenant.phone,
        idNumber: o.tenant.idNumber,
      },
    ]
    let houses: ContractHousePick[] = []
    if (o.isMergedBundle && o.bundleLines?.length) {
      houses = o.bundleLines.map((l) => ({
        id: l.houseId,
        apartmentName: l.apartmentName,
        houseNo: l.houseNo,
        storeName: o.house.storeName,
        address: '',
        area: 0,
        rentMonthly: l.rentMonthlySnapshot,
      }))
    } else {
      houses = [
        {
          id: o.house.id,
          apartmentName: o.house.apartmentName,
          houseNo: o.house.houseNo,
          storeName: o.house.storeName,
          address: '',
          area: 0,
          rentMonthly: o.bundleRentMonthlySum ?? o.house.rentMonthly,
        },
      ]
    }
    return syncNanningHousingDerivedFields({
      ...defaultNanningHousingForm(),
      tenantIds: [o.tenantId],
      tenants,
      houseIds: houses.map((h) => h.id),
      houses: houses.map((h) => toBowanHousePick(h)),
      leaseStart,
      leaseEnd,
      rentDueDay: String(rentDueDayFromYmd(leaseStart)),
      monthlyRentTouched: false,
    })
  }

  async function enrichNanningHousingHousesFromApi(form: NanningHousingFormData): Promise<NanningHousingFormData> {
    if (!form.houseIds.length) return form
    const r = await apiGet<{ items: (ContractHousePick & { houseType?: string })[] }>('/api/admin/houses')
    if (!r.ok) return form
    const map = new Map(r.data.items.map((h) => [h.id, h]))
    const houses = form.houseIds
      .map((id) => map.get(id))
      .filter(Boolean)
      .map((h) =>
        toBowanHousePick({
          id: h!.id,
          apartmentName: h!.apartmentName,
          houseNo: h!.houseNo,
          storeName: h!.storeName,
          address: h!.address ?? '',
          area: h!.area,
          rentMonthly: h!.rentMonthly,
          status: h!.status,
          houseType: h!.houseType,
        }),
      )
    return syncNanningHousingDerivedFields(form, { houses, houseIds: houses.map((x) => x.id), monthlyRentTouched: false })
  }

  type ContractCfgResp = {
    status?: string
    rentCycle?: string
    rentDueDay?: number | null
    contractTemplate?: string
    contractTemplateDataJson?: string | null
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
    setCfgContractTemplate('RESIDENTIAL_ASSET')
    setCfgTerminationRentMulti('2')
    setCfgTerminationDaysPastDue('7')
    setCfgPendingFiles([])
    setJiangnanForm(prefillJiangnanFromOrder(o))
    void enrichJiangnanHousesFromApi(prefillJiangnanFromOrder(o)).then(setJiangnanForm)
    setNonResidentialForm(prefillNonResidentialFromOrder(o))
    void enrichNonResidentialHousesFromApi(prefillNonResidentialFromOrder(o)).then(setNonResidentialForm)
    setResidentialForm(prefillResidentialFromOrder(o))
    void enrichResidentialHousesFromApi(prefillResidentialFromOrder(o)).then(setResidentialForm)
    setNanningHousingForm(prefillNanningHousingFromOrder(o))
    void enrichNanningHousingHousesFromApi(prefillNanningHousingFromOrder(o)).then(setNanningHousingForm)
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
      const parsedJn = parseJiangnanFactoryForm(r.data.contractTemplateDataJson)
      if (parsedJn) setJiangnanForm(parsedJn)
      const parsedNr = parseNonResidentialForm(r.data.contractTemplateDataJson)
      if (parsedNr) setNonResidentialForm(parsedNr)
      const parsedRa = parseResidentialAssetForm(r.data.contractTemplateDataJson)
      if (parsedRa) setResidentialForm(parsedRa)
      const parsedNh = parseNanningHousingForm(r.data.contractTemplateDataJson)
      if (parsedNh) setNanningHousingForm(parsedNh)
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

    if (cfgContractTemplate === 'JIANGNAN_FACTORY') {
      return saveConfigJiangnan(sendToTenant)
    }
    if (cfgContractTemplate === 'NON_RESIDENTIAL') {
      return saveConfigNonResidential(sendToTenant)
    }
    if (cfgContractTemplate === 'RESIDENTIAL_ASSET') {
      return saveConfigResidential(sendToTenant)
    }
    if (cfgContractTemplate === 'NANNING_HOUSING') {
      return saveConfigNanningHousing(sendToTenant)
    }

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
    if (contractTemplateUsesRentMultipleTermination(cfgContractTemplate)) {
      const x = parseFloat(cfgTerminationRentMulti.trim())
      if (Number.isNaN(x) || x <= 0) {
        setError(`${contractTemplateZh(cfgContractTemplate)}：请填写大于 0 的月租倍数`)
        return
      }
      terminationRentMultiple = x
    } else {
      const d = parseInt(cfgTerminationDaysPastDue.trim(), 10)
      if (Number.isNaN(d) || d < 0) {
        setError(`${contractTemplateZh(cfgContractTemplate)}：请填写不小于 0 的逾期天数（整数）`)
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

  async function saveConfigResidential(sendToTenant: boolean) {
    if (!configOrder) return
    setError('')
    setMsg('')
    const formErr = validateResidentialAssetForm(residentialForm)
    if (formErr) return setError(formErr)

    const rentMonthly = raSumHouseRentMonthly(residentialForm.houses)
    if (rentMonthly <= 0) return setError('所选资产月租须大于 0')
    const bondAmount = residentialHousingBondAmount(residentialForm)
    const depositMultiple = rentMonthly > 0 ? bondAmount / rentMonthly : 1
    const leaseMonths = leaseMonthsFromRange(residentialForm.leaseStart, residentialForm.leaseEnd)
    const rentDueParsed = parseRentDueDayInput(
      residentialForm.rentCycle === 'MONTHLY' ? residentialForm.rentDueDay : '1',
    )
    if (!rentDueParsed.ok) return setError(rentDueParsed.message)

    let latestRentGraceDays: number | null = null
    if (residentialForm.latestRentGraceDays.trim()) {
      latestRentGraceDays = parseInt(residentialForm.latestRentGraceDays.trim(), 10)
    }
    const terminationDaysPastDue = parseInt(residentialForm.terminationDaysPastDue.trim() || '0', 10)
    const primaryTenantId = residentialForm.tenantIds[0] ?? configOrder.tenantId

    const r = await apiPost<{ id: string; contractNo: string; tenantPhone: string }>('/api/admin/contracts', {
      orderId: configOrder.id,
      tenantId: primaryTenantId,
      leaseMonths,
      moveInDate: residentialForm.leaseStart,
      endDate: residentialForm.leaseEnd,
      rentMonthly,
      depositMultiple,
      rentCycle: residentialForm.rentCycle,
      penaltyFormula: 'amount*0.1%*days',
      rentDueDay: rentDueParsed.value,
      latestRentGraceDays,
      configRemarkHtml: residentialForm.remarkHtml.trim() ? residentialForm.remarkHtml : undefined,
      agreementSignDate: residentialForm.agreementSignDate.trim() === '' ? null : residentialForm.agreementSignDate,
      contractTemplate: 'RESIDENTIAL_ASSET',
      contractTemplateDataJson: serializeResidentialAssetForm(residentialForm),
      terminationDaysPastDue,
    })
    if (!r.ok) return setError(r.error)

    const contractId = r.data.id
    for (const f of cfgPendingFiles) {
      const up = await apiUploadContractAttachment(contractId, f)
      if (!up.ok) return setError(`合同已保存，但附件「${f.name}」上传失败：${up.error}`)
    }

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

  async function saveConfigNanningHousing(sendToTenant: boolean) {
    if (!configOrder) return
    setError('')
    setMsg('')
    const formErr = validateNanningHousingForm(nanningHousingForm)
    if (formErr) return setError(formErr)

    const rentMonthly = bowanMonthlyRentNumber(nanningHousingForm)
    if (rentMonthly <= 0) return setError('所选资产月租须大于 0')
    const bondAmount = bowanPerformanceBondAmount(nanningHousingForm)
    const depositMultiple = rentMonthly > 0 ? bondAmount / rentMonthly : 1
    const leaseMonths = leaseMonthsFromRange(nanningHousingForm.leaseStart, nanningHousingForm.leaseEnd)
    const rentDueParsed = parseRentDueDayInput(
      nanningHousingForm.rentCycle === 'MONTHLY' ? nanningHousingForm.rentDueDay : '1',
    )
    if (!rentDueParsed.ok) return setError(rentDueParsed.message)

    let latestRentGraceDays: number | null = null
    if (nanningHousingForm.latestRentGraceDays.trim()) {
      latestRentGraceDays = parseInt(nanningHousingForm.latestRentGraceDays.trim(), 10)
    }
    const terminationDaysPastDue = parseInt(nanningHousingForm.terminationDaysPastDue.trim() || '0', 10)
    const primaryTenantId = nanningHousingForm.tenantIds[0] ?? configOrder.tenantId

    const r = await apiPost<{ id: string; contractNo: string; tenantPhone: string }>('/api/admin/contracts', {
      orderId: configOrder.id,
      tenantId: primaryTenantId,
      leaseMonths,
      moveInDate: nanningHousingForm.leaseStart,
      endDate: nanningHousingForm.leaseEnd,
      rentMonthly,
      depositMultiple,
      rentCycle: nanningHousingForm.rentCycle,
      penaltyFormula: bowanPenaltyFormula(nanningHousingForm),
      rentDueDay: rentDueParsed.value,
      latestRentGraceDays,
      configRemarkHtml: nanningHousingForm.remarkHtml.trim() ? nanningHousingForm.remarkHtml : undefined,
      agreementSignDate:
        nanningHousingForm.agreementSignDate.trim() === '' ? null : nanningHousingForm.agreementSignDate,
      contractTemplate: 'NANNING_HOUSING',
      contractTemplateDataJson: serializeNanningHousingForm(nanningHousingForm),
      terminationDaysPastDue,
      billPushToTenant: nanningHousingForm.billPushToTenant === 'yes',
    })
    if (!r.ok) return setError(r.error)

    const contractId = r.data.id
    for (const f of cfgPendingFiles) {
      const up = await apiUploadContractAttachment(contractId, f)
      if (!up.ok) return setError(`合同已保存，但附件「${f.name}」上传失败：${up.error}`)
    }

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

  async function saveConfigNonResidential(sendToTenant: boolean) {
    if (!configOrder) return
    setError('')
    setMsg('')
    const formErr = validateNonResidentialForm(nonResidentialForm)
    if (formErr) return setError(formErr)

    const rentMonthly = nrSumHouseRentMonthly(nonResidentialForm.houses)
    if (rentMonthly <= 0) return setError('所选资产月租须大于 0')
    const bondAmount = nonResidentialPerformanceBondAmount(nonResidentialForm)
    const depositMultiple = rentMonthly > 0 ? bondAmount / rentMonthly : 1
    const leaseMonths = leaseMonthsFromRange(nonResidentialForm.leaseStart, nonResidentialForm.leaseEnd)
    const rentDueParsed = parseRentDueDayInput(
      nonResidentialForm.rentCycle === 'MONTHLY' ? nonResidentialForm.rentDueDay : '1',
    )
    if (!rentDueParsed.ok) return setError(rentDueParsed.message)

    let latestRentGraceDays: number | null = null
    if (nonResidentialForm.latestRentGraceDays.trim()) {
      latestRentGraceDays = parseInt(nonResidentialForm.latestRentGraceDays.trim(), 10)
    }
    const terminationRentMultiple = parseFloat(nonResidentialForm.terminationRentMultiple.trim() || '0')
    const primaryTenantId = nonResidentialForm.tenantIds[0] ?? configOrder.tenantId

    const r = await apiPost<{ id: string; contractNo: string; tenantPhone: string }>('/api/admin/contracts', {
      orderId: configOrder.id,
      tenantId: primaryTenantId,
      leaseMonths,
      moveInDate: nonResidentialForm.leaseStart,
      endDate: nonResidentialForm.leaseEnd,
      rentMonthly,
      depositMultiple,
      rentCycle: nonResidentialForm.rentCycle,
      penaltyFormula: 'amount*0.1%*days',
      rentDueDay: rentDueParsed.value,
      latestRentGraceDays,
      configRemarkHtml: nonResidentialForm.remarkHtml.trim() ? nonResidentialForm.remarkHtml : undefined,
      agreementSignDate: nonResidentialForm.agreementSignDate.trim() === '' ? null : nonResidentialForm.agreementSignDate,
      contractTemplate: 'NON_RESIDENTIAL',
      contractTemplateDataJson: serializeNonResidentialForm(nonResidentialForm),
      terminationRentMultiple,
    })
    if (!r.ok) return setError(r.error)

    const contractId = r.data.id
    for (const f of cfgPendingFiles) {
      const up = await apiUploadContractAttachment(contractId, f)
      if (!up.ok) return setError(`合同已保存，但附件「${f.name}」上传失败：${up.error}`)
    }

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

  async function saveConfigJiangnan(sendToTenant: boolean) {
    if (!configOrder) return
    setError('')
    setMsg('')
    const formErr = validateJiangnanFactoryForm(jiangnanForm)
    if (formErr) return setError(formErr)

    const rentMonthly = sumHouseRentMonthly(jiangnanForm.houses)
    if (rentMonthly <= 0) return setError('所选资产月租须大于 0')
    const bondAmount = performanceBondAmount(jiangnanForm)
    const depositMultiple = rentMonthly > 0 ? bondAmount / rentMonthly : 1
    const leaseMonths = leaseMonthsFromRange(jiangnanForm.leaseStart, jiangnanForm.leaseEnd)
    const rentDueParsed = parseRentDueDayInput(
      jiangnanForm.rentCycle === 'MONTHLY' ? jiangnanForm.rentDueDay : '1',
    )
    if (!rentDueParsed.ok) return setError(rentDueParsed.message)

    let latestRentGraceDays: number | null = null
    if (jiangnanForm.latestRentGraceDays.trim()) {
      latestRentGraceDays = parseInt(jiangnanForm.latestRentGraceDays.trim(), 10)
    }
    const terminationDaysPastDue = parseInt(jiangnanForm.terminationDaysPastDue.trim() || '0', 10)
    const primaryTenantId = jiangnanForm.tenantIds[0] ?? configOrder.tenantId

    const r = await apiPost<{ id: string; contractNo: string; tenantPhone: string }>('/api/admin/contracts', {
      orderId: configOrder.id,
      tenantId: primaryTenantId,
      leaseMonths,
      moveInDate: jiangnanForm.leaseStart,
      endDate: jiangnanForm.leaseEnd,
      rentMonthly,
      depositMultiple,
      rentCycle: jiangnanForm.rentCycle,
      penaltyFormula: 'amount*0.1%*days',
      rentDueDay: rentDueParsed.value,
      latestRentGraceDays,
      configRemarkHtml: jiangnanForm.remarkHtml.trim() ? jiangnanForm.remarkHtml : undefined,
      agreementSignDate: jiangnanForm.agreementSignDate.trim() === '' ? null : jiangnanForm.agreementSignDate,
      contractTemplate: 'JIANGNAN_FACTORY',
      contractTemplateDataJson: serializeJiangnanFactoryForm(jiangnanForm),
      terminationDaysPastDue,
    })
    if (!r.ok) return setError(r.error)

    const contractId = r.data.id
    for (const f of cfgPendingFiles) {
      const up = await apiUploadContractAttachment(contractId, f)
      if (!up.ok) return setError(`合同已保存，但附件「${f.name}」上传失败：${up.error}`)
    }

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
              <option value="NEED_REVISION">待租客修改</option>
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
              <option value="WAIT_INTERNAL_OA">待华创OA</option>
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
                          退回修改
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
                      <div className="a-kv-row">
                        <div className="a-kv-k">扫脸认证</div>
                        <div className="a-kv-v">
                          {orderDetail.faceVerifiedAt
                            ? new Date(orderDetail.faceVerifiedAt).toLocaleString('zh-CN', { hour12: false })
                            : orderDetail.house.assetType === '泊湾公寓'
                              ? '—'
                              : '未认证'}
                        </div>
                      </div>
                      <div className="a-kv-row" style={{ alignItems: 'flex-start' }}>
                        <div className="a-kv-k">订单附件</div>
                        <div className="a-kv-v">
                          {orderDetail.attachments && orderDetail.attachments.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {orderDetail.attachments.map((a) => (
                                <span key={a.id}>
                                  {orderAttachmentCategoryZh(a.category)} · {a.name}{' '}
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
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="a-muted">暂无</span>
                          )}
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
                    <ContractTemplateSelect
                      value={cfgContractTemplate}
                      onChange={(next) => {
                        setCfgContractTemplate(next)
                        if (next === 'JIANGNAN_FACTORY' && configOrder) {
                          void enrichJiangnanHousesFromApi(prefillJiangnanFromOrder(configOrder)).then(setJiangnanForm)
                        }
                        if (next === 'NON_RESIDENTIAL' && configOrder) {
                          void enrichNonResidentialHousesFromApi(prefillNonResidentialFromOrder(configOrder)).then(
                            setNonResidentialForm,
                          )
                        }
                        if (next === 'RESIDENTIAL_ASSET' && configOrder) {
                          void enrichResidentialHousesFromApi(prefillResidentialFromOrder(configOrder)).then(
                            setResidentialForm,
                          )
                        }
                        if (next === 'NANNING_HOUSING' && configOrder) {
                          void enrichNanningHousingHousesFromApi(prefillNanningHousingFromOrder(configOrder)).then(
                            setNanningHousingForm,
                          )
                        }
                      }}
                    />
                  </div>
                </div>
                {cfgContractTemplate === 'JIANGNAN_FACTORY' ? (
                  <JiangnanFactoryContractForm
                    value={jiangnanForm}
                    onChange={setJiangnanForm}
                    vacantHouseOnly={false}
                    pendingFiles={cfgPendingFiles}
                    onPendingFilesChange={setCfgPendingFiles}
                    attachments={cfgAttachments}
                    contractId={configOrder.contractId}
                    onDeleteAttachment={async (fileKey) => {
                      if (!configOrder.contractId) return
                      const r = await apiDeleteContractAttachment(configOrder.contractId, fileKey)
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
                ) : cfgContractTemplate === 'NON_RESIDENTIAL' ? (
                  <NonResidentialContractForm
                    value={nonResidentialForm}
                    onChange={setNonResidentialForm}
                    vacantHouseOnly={false}
                    leaseDatesEditable={false}
                    pendingFiles={cfgPendingFiles}
                    onPendingFilesChange={setCfgPendingFiles}
                    attachments={cfgAttachments}
                    contractId={configOrder.contractId}
                    onDeleteAttachment={async (fileKey) => {
                      if (!configOrder.contractId) return
                      const r = await apiDeleteContractAttachment(configOrder.contractId, fileKey)
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
                ) : cfgContractTemplate === 'RESIDENTIAL_ASSET' ? (
                  <ResidentialAssetContractForm
                    value={residentialForm}
                    onChange={setResidentialForm}
                    vacantHouseOnly={false}
                    pendingFiles={cfgPendingFiles}
                    onPendingFilesChange={setCfgPendingFiles}
                    attachments={cfgAttachments}
                    contractId={configOrder.contractId}
                    onDeleteAttachment={async (fileKey) => {
                      if (!configOrder.contractId) return
                      const r = await apiDeleteContractAttachment(configOrder.contractId, fileKey)
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
                ) : cfgContractTemplate === 'NANNING_HOUSING' ? (
                  <NanningHousingContractForm
                    value={nanningHousingForm}
                    onChange={setNanningHousingForm}
                    vacantHouseOnly={false}
                    pendingFiles={cfgPendingFiles}
                    onPendingFilesChange={setCfgPendingFiles}
                    attachments={cfgAttachments}
                    contractId={configOrder.contractId}
                    onDeleteAttachment={async (fileKey) => {
                      if (!configOrder.contractId) return
                      const r = await apiDeleteContractAttachment(configOrder.contractId, fileKey)
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
                ) : null}
              </div>

              <div className="a-kv">
                {cfgContractTemplate !== 'JIANGNAN_FACTORY' &&
                cfgContractTemplate !== 'NON_RESIDENTIAL' &&
                cfgContractTemplate !== 'RESIDENTIAL_ASSET' &&
                cfgContractTemplate !== 'NANNING_HOUSING' ? (
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
                      {contractTemplateUsesRentMultipleTermination(cfgContractTemplate) ? (
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
                ) : null}
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

