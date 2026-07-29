import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api'
import { Pagination, paginate } from '../components/Pagination'

type ReportTab =
  | 'business-bills'
  | 'monthly-receivable'
  | 'collection-transactions'
  | 'offline-verify-status'
  | 'monthly-rent-collected'

type AdminStore = { id: string; name: string }

type BusinessBillRow = {
  billId: string
  billNo: string
  assetType: string
  assetName: string
  projectName: string
  districtArea: string
  mgmtDepartment: string
  contractNo: string
  tenantName: string
  billType: string
  billingStart: string
  billingEnd: string
  totalAmount: number
  amountReceived: number
  amountOwed: number
  billStatus: string
  reversalBillNo: string
  lateFeeBillNo: string
  latestRentDueDate: string
  firstVerifyDate: string
  overdueDays: number
  collectionChannel: string
  expenseNaturalMonth: string
  financeCloseMonth: string
  creationMethod: string
  operator: string
  operatedAt: string
  remark: string
}

type BusinessBillSummary = {
  billCount: number
  totalReceivable: number
  totalReceived: number
  totalOwed: number
}

type MonthlyReceivableRow = {
  billId: string
  batchNo: string
  batchDate: string
  batchOperator: string
  accountingYear: string
  accountingMonth: string
  billNo: string
  assetType: string
  assetName: string
  projectName: string
  districtArea: string
  mgmtDepartment: string
  contractNo: string
  tenantName: string
  billType: string
  billingStart: string
  billingEnd: string
  receivableAmount: number
  reversalBillNo: string
  lateFeeBillNo: string
  expenseNaturalMonth: string
  receivableSource: string
  remark: string
}

type MonthlyReceivableSummary = {
  billCount: number
  totalReceivable: number
  lockedBatchCount: number
}

type CollectionTransactionRow = {
  txId: string
  assetName: string
  projectName: string
  districtArea: string
  mgmtDepartment: string
  contractNo: string
  tenantName: string
  totalReceivable: number
  actualReceived: number
  feePayable: number
  feeWaived: number
  settlementAmount: number
  billingStart: string
  billingEnd: string
  paidAt: string
  settlementStatus: string
  settlementEntryDate: string
  relatedBillNos: string
  remark: string
  rentAmount: number
  propertyFeeAmount: number
}

type CollectionTransactionSummary = {
  txCount: number
  totalActualReceived: number
  totalReceivable: number
}

type OfflineVerifyStatusRow = {
  logId: string
  assetName: string
  contractNo: string
  tenantName: string
  billNo: string
  billTotalReceivable: number
  verifyAmount: number
  billStatusAfter: string
  verifyStatus: string
  verifyFailReason: string
  prepayAmount: number
  operator: string
  operatedAt: string
  remark: string
}

type OfflineVerifyStatusSummary = {
  verifyCount: number
  totalVerifyAmount: number
  totalPrepayAmount: number
  successCount: number
  partialCount: number
  failedCount: number
  prepayCount: number
}

type MonthlyRentCollectedRow = {
  rowId: string
  assetName: string
  projectName: string
  districtArea: string
  mgmtDepartment: string
  contractNo: string
  tenantName: string
  collectionSource: string
  actualReceived: number
  feePayable: number
  feeWaived: number
  settlementAmount: number
  tenantPaymentDate: string
  billNo: string
  billingPeriod: string
  billStatus: string
  settlementStatus: string
  settlementEntryDate: string
  operator: string
  operatedAt: string
  remark: string
  rentAmount: number
  propertyFeeAmount: number
}

type MonthlyRentCollectedSummary = {
  rowCount: number
  totalActualReceived: number
  totalSettlementAmount: number
  autoCollectionCount: number
  offlineCollectionCount: number
}

type ColumnDef<T> = {
  key: keyof T | 'index'
  label: string
  hint: string
  money?: boolean
  highlight?: boolean
}

const BUSINESS_BILL_COLUMNS: ColumnDef<BusinessBillRow>[] = [
  { key: 'index', label: '序号', hint: '导出表格时自动递增的序号' },
  { key: 'billNo', label: '账单编号', hint: '系统全平台唯一账单主键 ID 对应的展示编号' },
  { key: 'assetType', label: '资产类型', hint: '住宅/商铺/车位等' },
  { key: 'assetName', label: '资产名称', hint: '房源门牌号/地址' },
  { key: 'projectName', label: '项目名称', hint: '资产所属房地产项目' },
  { key: 'districtArea', label: '所属片区', hint: '片区管理划分' },
  { key: 'mgmtDepartment', label: '管理部门', hint: '负责运营的管理部门' },
  { key: 'contractNo', label: '合同编号', hint: '系统租赁合同唯一编码' },
  { key: 'tenantName', label: '租户名称', hint: '个人或企业租户全称' },
  { key: 'billType', label: '账单类型', hint: '租金/物业费等' },
  { key: 'billingStart', label: '计费起始期', hint: '本笔费用对应的资产使用起始日' },
  { key: 'billingEnd', label: '计费止期', hint: '本笔费用对应的资产使用截止日' },
  { key: 'totalAmount', label: '应收金额（元）', hint: '账单应收总额', money: true },
  { key: 'amountReceived', label: '已缴金额（元）', hint: '租户实际缴纳或核销的总额', money: true },
  { key: 'amountOwed', label: '欠费金额（元）', hint: '应收减已缴，剩余未付金额', money: true },
  { key: 'billStatus', label: '账单状态', hint: '未支付/部分结清/已结清/冲红' },
  { key: 'reversalBillNo', label: '关联冲红账单编号', hint: '冲红账单关联的原账单编号' },
  { key: 'lateFeeBillNo', label: '关联滞纳金账单编号', hint: '滞纳金账单关联的原账单编号' },
  { key: 'latestRentDueDate', label: '最晚交租日期', hint: '账单最晚支付截止日' },
  { key: 'firstVerifyDate', label: '首次收款核销日期', hint: '首次线上或线下核销日期' },
  { key: 'overdueDays', label: '逾期时长（天）', hint: '超过截止日未付的天数，未逾期为 0' },
  { key: 'collectionChannel', label: '账单收款渠道', hint: '租客线上自助支付/后台手工核销' },
  { key: 'expenseNaturalMonth', label: '费用归属自然月', hint: '计费周期所属自然年月' },
  { key: 'financeCloseMonth', label: '财务关账归属月', hint: '按账单生成日：每月 25 日关账，25 日后计入次月' },
  { key: 'creationMethod', label: '账单创建方式', hint: '系统自动生成/后台手工新增' },
  { key: 'operator', label: '操作人', hint: '最后修改账单的管理员账号' },
  { key: 'operatedAt', label: '操作时间', hint: '账单最后一次变更的系统时间' },
  { key: 'remark', label: '备注', hint: '调账、冲红、补录等特殊业务说明' },
]

const MONTHLY_RECEIVABLE_COLUMNS: ColumnDef<MonthlyReceivableRow>[] = [
  { key: 'index', label: '序号', hint: '导出表格时自动排序的序号' },
  { key: 'batchNo', label: '关联批次号', hint: '与财务应收账款快照表绑定的系统唯一批次号' },
  { key: 'batchDate', label: '关联日期', hint: '账期锁定/关联操作日期' },
  { key: 'batchOperator', label: '关联操作人', hint: '执行账期锁定关联的管理员' },
  { key: 'accountingYear', label: '会计年度', hint: '本次关联所属的会计年度' },
  { key: 'accountingMonth', label: '会计月份', hint: '本次关联所属的会计月份' },
  { key: 'billNo', label: '账单编号', hint: '与业务账单表一一对应的系统唯一编号' },
  { key: 'assetType', label: '资产类型', hint: '住宅/商铺/车位等' },
  { key: 'assetName', label: '资产名称', hint: '房源门牌号/资产全称' },
  { key: 'projectName', label: '项目名称', hint: '资产所属房地产项目' },
  { key: 'districtArea', label: '所属片区', hint: '片区管理划分' },
  { key: 'mgmtDepartment', label: '管理部门', hint: '负责运营的管理部门' },
  { key: 'contractNo', label: '合同编号', hint: '系统租赁合同唯一编码' },
  { key: 'tenantName', label: '租户名称', hint: '个人或企业租户全称' },
  { key: 'billType', label: '账单类型', hint: '租金/物业费/水费/电费/逾期滞纳金等' },
  { key: 'billingStart', label: '计费起期', hint: '本笔应收费用对应的资产使用起始日' },
  { key: 'billingEnd', label: '计费止期', hint: '本笔应收费用对应的资产使用截止日' },
  { key: 'receivableAmount', label: '应收金额（元）', hint: '纯应收金额，不含实收抵扣', money: true },
  { key: 'reversalBillNo', label: '关联冲红账单编号', hint: '冲红账单填写原账单编号；正常应收留空' },
  { key: 'lateFeeBillNo', label: '关联滞纳金账单编号', hint: '滞纳金账单填写原账单编号；普通应收留空' },
  { key: 'expenseNaturalMonth', label: '费用归属自然月', hint: '计费周期所属的实际自然年月' },
  { key: 'receivableSource', label: '应收生成来源', hint: '系统正常生成/后台手工录入/上期调整结转' },
  { key: 'remark', label: '备注', hint: '调账、冲红、补录等特殊业务说明' },
]

const COLLECTION_TRANSACTION_COLUMNS: ColumnDef<CollectionTransactionRow>[] = [
  { key: 'index', label: '序号', hint: '导出表格时自动排序的序号' },
  { key: 'assetName', label: '资产名称', hint: '房源门牌号/资产全称' },
  { key: 'projectName', label: '项目名称', hint: '资产所属项目/小区名称' },
  { key: 'districtArea', label: '所属片区', hint: '片区管理划分' },
  { key: 'mgmtDepartment', label: '管理部门', hint: '负责运营的管理部门' },
  { key: 'contractNo', label: '合同编号', hint: '系统租赁合同唯一编码' },
  { key: 'tenantName', label: '租户名称', hint: '个人或企业租户全称' },
  {
    key: 'totalReceivable',
    label: '应收总金额（元）',
    hint: '本笔收款对应账单的应收原价总额',
    money: true,
    highlight: true,
  },
  { key: 'actualReceived', label: '实际收款金额（元）', hint: '本笔交易实际到账金额', money: true },
  { key: 'feePayable', label: '应付手续费（元）', hint: '支付渠道应付手续费', money: true },
  { key: 'feeWaived', label: '免除手续费（元）', hint: '渠道减免的手续费', money: true },
  { key: 'settlementAmount', label: '结算金额（元）', hint: '扣除手续费后的结算入账金额', money: true },
  { key: 'billingStart', label: '计费起期', hint: '关联账单计费起始日' },
  { key: 'billingEnd', label: '计费止期', hint: '关联账单计费截止日' },
  { key: 'paidAt', label: '支付时间', hint: '用户支付或资金到账的精确时间' },
  { key: 'settlementStatus', label: '结算状态', hint: '待结算/结算成功/结算失败/已退款' },
  { key: 'settlementEntryDate', label: '结算入账日期', hint: '财务确认入账的日期' },
  { key: 'relatedBillNos', label: '关联账单编号', hint: '绑定的业务账单编号，多条以逗号分隔' },
  { key: 'remark', label: '备注', hint: '付款人与租户不一致、退款说明等特殊场景' },
  { key: 'rentAmount', label: '租金', hint: '账单明细中的租金金额', money: true, highlight: true },
  { key: 'propertyFeeAmount', label: '物业费', hint: '账单明细中的物业费金额', money: true, highlight: true },
]

const OFFLINE_VERIFY_STATUS_COLUMNS: ColumnDef<OfflineVerifyStatusRow>[] = [
  { key: 'index', label: '序号', hint: '导出表格时自动递增的序号' },
  { key: 'assetName', label: '资产名称', hint: '上级资产经营单元名称，与流水表一致' },
  { key: 'contractNo', label: '合同编号', hint: '系统租赁合同唯一编码，与流水表、导入模板一致' },
  { key: 'tenantName', label: '租户名称', hint: '个人或企业租户全称，与流水表、导入模板一致' },
  { key: 'billNo', label: '对应账单编号', hint: '本次核销绑定的业务账单编号，对应流水表关联账单编号' },
  { key: 'billTotalReceivable', label: '账单应收总金额（元）', hint: '该账单原始应收总额，与流水表应收总金额一致', money: true },
  { key: 'verifyAmount', label: '本次核销金额（元）', hint: '本期收款中实际用于冲抵/支付该账单的金额', money: true },
  { key: 'billStatusAfter', label: '核销后账单状态', hint: '未支付/部分结清/已结清/已冲红' },
  { key: 'verifyStatus', label: '核销状态', hint: '核销成功/部分核销/核销失败/预收挂账' },
  {
    key: 'verifyFailReason',
    label: '核销失败原因',
    hint: '租户/资产/合同信息不匹配；无对应有效待核销账单；账单已全额结清；核销金额超应收上限',
  },
  { key: 'prepayAmount', label: '预收挂账金额（元）', hint: '超出账单总额的剩余金额，自动转入预收账户', money: true },
  { key: 'operator', label: '操作人', hint: '录入线下核销的人员或系统全自动操作' },
  { key: 'operatedAt', label: '操作时间', hint: '系统执行核销动作的时间戳' },
  { key: 'remark', label: '备注', hint: '部分核销、冲红调整、预收说明、异常处理等，与流水表备注一致' },
]

const MONTHLY_RENT_COLLECTED_COLUMNS: ColumnDef<MonthlyRentCollectedRow>[] = [
  { key: 'index', label: '序号', hint: '导出表格时自动排序的序号' },
  { key: 'assetName', label: '资产名称', hint: '上级资产经营单元名称，与流水表一致' },
  { key: 'projectName', label: '项目名称', hint: '资产所属项目/小区名称，与流水表一致' },
  { key: 'districtArea', label: '所属片区', hint: '小区名称，与流水表一致' },
  { key: 'mgmtDepartment', label: '管理部门', hint: '负责运营的管理部门，与流水表一致' },
  { key: 'contractNo', label: '合同编号', hint: '系统租赁合同唯一编码，与流水表、导入模板一致' },
  { key: 'tenantName', label: '租户名称', hint: '个人或企业租户全称，与流水表、导入模板一致' },
  { key: 'collectionSource', label: '收款来源', hint: '核心区分字段：系统自动收款 / 后台核销收款' },
  { key: 'actualReceived', label: '实际收款金额（元）', hint: '本笔交易实际到账总额，与流水表实际收款金额一致', money: true },
  { key: 'feePayable', label: '应付手续费（元）', hint: '支付渠道应付手续费', money: true },
  { key: 'feeWaived', label: '免除手续费（元）', hint: '渠道减免的手续费', money: true },
  { key: 'settlementAmount', label: '结算金额（元）', hint: '本笔交易最终结算入账金额，与流水表结算金额一致', money: true },
  {
    key: 'tenantPaymentDate',
    label: '租户支付日期',
    hint: '资金到账或用户支付的日期，与流水表支付时间或导入模板收款日期一致',
  },
  { key: 'billNo', label: '对应账单编号', hint: '本次收款核销绑定的业务账单编号，与流水表关联账单编号一致' },
  { key: 'billingPeriod', label: '计费周期', hint: '对应账单计费周期，YYYY-MM 格式，与流水表计费起止期一致' },
  { key: 'billStatus', label: '账单状态', hint: '未支付/部分结清/已结清/已冲红' },
  { key: 'settlementStatus', label: '结算状态', hint: '待结算/结算成功/结算失败/已退款；后台录入为无需结算' },
  { key: 'settlementEntryDate', label: '结算入账日期', hint: '财务确认入账日期，与流水表结算入账日期一致' },
  { key: 'operator', label: '操作人', hint: '录入收款的人员或系统自动操作' },
  { key: 'operatedAt', label: '操作时间', hint: '系统生成或录入该笔收款的时间' },
  { key: 'remark', label: '备注', hint: '付款人差异、分期支付、预收说明等特殊场景，与流水表/核销表备注一致' },
  { key: 'rentAmount', label: '租金', hint: '账单明细中的租金金额', money: true, highlight: true },
  { key: 'propertyFeeAmount', label: '物业费', hint: '账单明细中的物业费金额', money: true, highlight: true },
]

const TAB_META: Record<
  ReportTab,
  { label: string; desc: string; exportName: string; apiPath: string }
> = {
  'business-bills': {
    label: '业务账单表（实时）',
    desc: '全量账单宽表：含资产、合同、计费周期、收付状态、核销渠道与财务归属月等 28 项字段；不含暂停计费合同。',
    exportName: '业务账单表（实时）',
    apiPath: '/api/admin/reports/business-bills',
  },
  'monthly-receivable': {
    label: '月度应收明细表',
    desc: '按费用归属自然月列示纯应收明细；账期锁定后写入关联批次号，与财务应收快照绑定。',
    exportName: '月度应收明细表',
    apiPath: '/api/admin/reports/monthly-receivable',
  },
  'collection-transactions': {
    label: '系统收款交易流水表',
    desc: '汇总线上支付、线下核销、预收入账与退款等收款流水；含结算状态与租金/物业费拆分列。',
    exportName: '系统收款交易流水表',
    apiPath: '/api/admin/reports/collection-transactions',
  },
  'offline-verify-status': {
    label: '核销情况表',
    desc: '逐笔列示线下核销结果：含账单冲抵金额、核销后状态、预收挂账与失败原因；与收款流水表字段口径一致。',
    exportName: '核销情况表',
    apiPath: '/api/admin/reports/offline-verify-status',
  },
  'monthly-rent-collected': {
    label: '月度实收租金明细表',
    desc: '按租户支付日期列示系统自动收款与后台核销收款明细；含账单状态、结算状态及租金/物业费拆分，与流水表口径一致。',
    exportName: '月度实收租金明细表',
    apiPath: '/api/admin/reports/monthly-rent-collected',
  },
}

function currentPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function monthStartYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function formatContractNo(contractNo: string) {
  const digits = (contractNo || '').replace(/\D/g, '')
  return digits ? `HT${digits}` : contractNo
}

function fmtMoney(n: number) {
  return `¥${n.toLocaleString('zh-CN')}`
}

function statusClass(status: string) {
  if (status === '已结清') return 'paid'
  if (status === '部分结清') return 'wait-stamp'
  if (status === '冲红' || status === '已冲红') return 'void'
  return 'unpaid'
}

function settlementStatusClass(status: string) {
  if (status === '结算成功') return 'paid'
  if (status === '已退款') return 'void'
  if (status === '结算失败') return 'overdue'
  if (status === '无需结算') return 'wait-stamp'
  return 'unpaid'
}

function verifyStatusClass(status: string) {
  if (status === '核销成功') return 'paid'
  if (status === '部分核销') return 'wait-stamp'
  if (status === '预收挂账') return 'unpaid'
  if (status === '核销失败') return 'overdue'
  return 'unpaid'
}

function buildQuery(params: Record<string, string | undefined>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    const t = (v ?? '').trim()
    if (t) p.set(k, t)
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

function businessCellValue(r: BusinessBillRow, key: keyof BusinessBillRow | 'index', index: number) {
  if (key === 'index') return index
  if (key === 'contractNo') return formatContractNo(r.contractNo)
  if (key === 'totalAmount' || key === 'amountReceived' || key === 'amountOwed') return r[key]
  if (key === 'overdueDays') return r.overdueDays
  return r[key] ?? ''
}

function monthlyCellValue(r: MonthlyReceivableRow, key: keyof MonthlyReceivableRow | 'index', index: number) {
  if (key === 'index') return index
  if (key === 'contractNo') return formatContractNo(r.contractNo)
  if (key === 'receivableAmount') return r.receivableAmount
  return r[key] ?? ''
}

function collectionCellValue(r: CollectionTransactionRow, key: keyof CollectionTransactionRow | 'index', index: number) {
  if (key === 'index') return index
  if (key === 'contractNo') return formatContractNo(r.contractNo)
  if (
    key === 'totalReceivable' ||
    key === 'actualReceived' ||
    key === 'feePayable' ||
    key === 'feeWaived' ||
    key === 'settlementAmount' ||
    key === 'rentAmount' ||
    key === 'propertyFeeAmount'
  ) {
    return r[key]
  }
  return r[key] ?? ''
}

function verifyCellValue(r: OfflineVerifyStatusRow, key: keyof OfflineVerifyStatusRow | 'index', index: number) {
  if (key === 'index') return index
  if (key === 'contractNo') return formatContractNo(r.contractNo)
  if (
    key === 'billTotalReceivable' ||
    key === 'verifyAmount' ||
    key === 'prepayAmount'
  ) {
    return r[key]
  }
  return r[key] ?? ''
}

function monthlyRentCellValue(r: MonthlyRentCollectedRow, key: keyof MonthlyRentCollectedRow | 'index', index: number) {
  if (key === 'index') return index
  if (key === 'contractNo') return formatContractNo(r.contractNo)
  if (
    key === 'actualReceived' ||
    key === 'feePayable' ||
    key === 'feeWaived' ||
    key === 'settlementAmount' ||
    key === 'rentAmount' ||
    key === 'propertyFeeAmount'
  ) {
    return r[key]
  }
  return r[key] ?? ''
}

export function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>('business-bills')
  const [stores, setStores] = useState<AdminStore[]>([])
  const [storeId, setStoreId] = useState('')
  const [periodFrom, setPeriodFrom] = useState(currentPeriod)
  const [periodTo, setPeriodTo] = useState(currentPeriod)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)

  const [businessRows, setBusinessRows] = useState<BusinessBillRow[]>([])
  const [businessSummary, setBusinessSummary] = useState<BusinessBillSummary | null>(null)
  const [monthlyRows, setMonthlyRows] = useState<MonthlyReceivableRow[]>([])
  const [monthlySummary, setMonthlySummary] = useState<MonthlyReceivableSummary | null>(null)
  const [collectionRows, setCollectionRows] = useState<CollectionTransactionRow[]>([])
  const [collectionSummary, setCollectionSummary] = useState<CollectionTransactionSummary | null>(null)
  const [verifyRows, setVerifyRows] = useState<OfflineVerifyStatusRow[]>([])
  const [verifySummary, setVerifySummary] = useState<OfflineVerifyStatusSummary | null>(null)
  const [monthlyRentRows, setMonthlyRentRows] = useState<MonthlyRentCollectedRow[]>([])
  const [monthlyRentSummary, setMonthlyRentSummary] = useState<MonthlyRentCollectedSummary | null>(null)
  const [collectedFrom, setCollectedFrom] = useState(monthStartYmd)
  const [collectedTo, setCollectedTo] = useState(todayYmd)

  useEffect(() => {
    apiGet<{ items: AdminStore[] }>('/api/admin/stores').then((r) => {
      if (r.ok) setStores(r.data.items ?? [])
    })
  }, [])

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    setPage(1)
    const query = buildQuery({
      storeId: storeId || undefined,
      periodFrom: periodFrom || undefined,
      periodTo: periodTo || undefined,
      ...(tab === 'collection-transactions' ||
      tab === 'offline-verify-status' ||
      tab === 'monthly-rent-collected'
        ? { collectedFrom: collectedFrom || undefined, collectedTo: collectedTo || undefined }
        : {}),
    })
    if (tab === 'business-bills') {
      const r = await apiGet<{ rows: BusinessBillRow[]; summary: BusinessBillSummary }>(
        `${TAB_META['business-bills'].apiPath}${query}`,
      )
      setLoading(false)
      if (!r.ok) return setError(r.error)
      setBusinessRows(r.data.rows ?? [])
      setBusinessSummary(r.data.summary ?? null)
    } else if (tab === 'monthly-receivable') {
      const r = await apiGet<{ rows: MonthlyReceivableRow[]; summary: MonthlyReceivableSummary }>(
        `${TAB_META['monthly-receivable'].apiPath}${query}`,
      )
      setLoading(false)
      if (!r.ok) return setError(r.error)
      setMonthlyRows(r.data.rows ?? [])
      setMonthlySummary(r.data.summary ?? null)
    } else if (tab === 'offline-verify-status') {
      const r = await apiGet<{ rows: OfflineVerifyStatusRow[]; summary: OfflineVerifyStatusSummary }>(
        `${TAB_META['offline-verify-status'].apiPath}${query}`,
      )
      setLoading(false)
      if (!r.ok) return setError(r.error)
      setVerifyRows(r.data.rows ?? [])
      setVerifySummary(r.data.summary ?? null)
    } else if (tab === 'monthly-rent-collected') {
      const r = await apiGet<{ rows: MonthlyRentCollectedRow[]; summary: MonthlyRentCollectedSummary }>(
        `${TAB_META['monthly-rent-collected'].apiPath}${query}`,
      )
      setLoading(false)
      if (!r.ok) return setError(r.error)
      setMonthlyRentRows(r.data.rows ?? [])
      setMonthlyRentSummary(r.data.summary ?? null)
    } else {
      const r = await apiGet<{ rows: CollectionTransactionRow[]; summary: CollectionTransactionSummary }>(
        `${TAB_META['collection-transactions'].apiPath}${query}`,
      )
      setLoading(false)
      if (!r.ok) return setError(r.error)
      setCollectionRows(r.data.rows ?? [])
      setCollectionSummary(r.data.summary ?? null)
    }
  }, [tab, storeId, periodFrom, periodTo, collectedFrom, collectedTo])

  useEffect(() => {
    load()
  }, [tab])

  const activeRows =
    tab === 'business-bills'
      ? businessRows
      : tab === 'monthly-receivable'
        ? monthlyRows
        : tab === 'offline-verify-status'
          ? verifyRows
          : tab === 'monthly-rent-collected'
            ? monthlyRentRows
            : collectionRows
  const pageData = useMemo(() => paginate(activeRows, page, 20), [activeRows, page])

  function resetFilters() {
    setStoreId('')
    setPeriodFrom(currentPeriod())
    setPeriodTo(currentPeriod())
    setCollectedFrom(monthStartYmd())
    setCollectedTo(todayYmd())
    setPage(1)
  }

  function exportCsv() {
    if (!activeRows.length) return
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    if (tab === 'business-bills') {
      const header = BUSINESS_BILL_COLUMNS.map((c) => c.label)
      const lines = businessRows.map((r, idx) =>
        BUSINESS_BILL_COLUMNS.map((c) => businessCellValue(r, c.key, idx + 1))
          .map(esc)
          .join(','),
      )
      const csv = '\uFEFF' + [header.join(','), ...lines].join('\n')
      downloadCsv(csv, `${TAB_META['business-bills'].exportName}_${todayYmd()}.csv`)
    } else if (tab === 'monthly-receivable') {
      const header = MONTHLY_RECEIVABLE_COLUMNS.map((c) => c.label)
      const lines = monthlyRows.map((r, idx) =>
        MONTHLY_RECEIVABLE_COLUMNS.map((c) => monthlyCellValue(r, c.key, idx + 1))
          .map(esc)
          .join(','),
      )
      const csv = '\uFEFF' + [header.join(','), ...lines].join('\n')
      downloadCsv(csv, `${TAB_META['monthly-receivable'].exportName}_${todayYmd()}.csv`)
    } else if (tab === 'offline-verify-status') {
      const header = OFFLINE_VERIFY_STATUS_COLUMNS.map((c) => c.label)
      const lines = verifyRows.map((r, idx) =>
        OFFLINE_VERIFY_STATUS_COLUMNS.map((c) => verifyCellValue(r, c.key, idx + 1))
          .map(esc)
          .join(','),
      )
      const csv = '\uFEFF' + [header.join(','), ...lines].join('\n')
      downloadCsv(csv, `${TAB_META['offline-verify-status'].exportName}_${todayYmd()}.csv`)
    } else if (tab === 'monthly-rent-collected') {
      const header = MONTHLY_RENT_COLLECTED_COLUMNS.map((c) => c.label)
      const lines = monthlyRentRows.map((r, idx) =>
        MONTHLY_RENT_COLLECTED_COLUMNS.map((c) => monthlyRentCellValue(r, c.key, idx + 1))
          .map(esc)
          .join(','),
      )
      const csv = '\uFEFF' + [header.join(','), ...lines].join('\n')
      downloadCsv(csv, `${TAB_META['monthly-rent-collected'].exportName}_${todayYmd()}.csv`)
    } else {
      const header = COLLECTION_TRANSACTION_COLUMNS.map((c) => c.label)
      const lines = collectionRows.map((r, idx) =>
        COLLECTION_TRANSACTION_COLUMNS.map((c) => collectionCellValue(r, c.key, idx + 1))
          .map(esc)
          .join(','),
      )
      const csv = '\uFEFF' + [header.join(','), ...lines].join('\n')
      downloadCsv(csv, `${TAB_META['collection-transactions'].exportName}_${todayYmd()}.csv`)
    }
  }

  function downloadCsv(content: string, filename: string) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const meta = TAB_META[tab]

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">报表管理</div>
        <div className="a-muted">按业主提供的报表模板逐张上线；各报表以标签页形式追加，字段与导出格式按模板对齐。</div>
      </div>

      <div className="a-card a-report-tabs-card">
        <div className="a-report-tabs" role="tablist" aria-label="报表类型">
          {(Object.keys(TAB_META) as ReportTab[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`a-report-tab${tab === key ? ' is-active' : ''}`}
              onClick={() => setTab(key)}
            >
              {TAB_META[key].label}
            </button>
          ))}
        </div>
        <div className="a-muted a-report-tab-desc">{meta.desc}</div>
      </div>

      {error ? <div className="a-card a-error">加载失败：{error}</div> : null}

      <div className="a-card a-row" style={{ justifyContent: 'space-between' }}>
        <div className="a-filterbar" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="a-filter-label">筛选</span>
          <select
            className="a-filter-select"
            value={storeId}
            onChange={(e) => {
              setStoreId(e.target.value)
              setPage(1)
            }}
          >
            <option value="">全部门店</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="a-filter-label">费用归属月</span>
          <input
            type="month"
            className="a-filter-input"
            value={periodFrom}
            onChange={(e) => {
              setPeriodFrom(e.target.value)
              setPage(1)
            }}
            title="归属月起"
          />
          <span className="a-muted">至</span>
          <input
            type="month"
            className="a-filter-input"
            value={periodTo}
            onChange={(e) => {
              setPeriodTo(e.target.value)
              setPage(1)
            }}
            title="归属月止"
          />
          {tab === 'collection-transactions' || tab === 'offline-verify-status' || tab === 'monthly-rent-collected' ? (
            <>
              <span className="a-filter-label">
                {tab === 'offline-verify-status' ? '操作日' : '支付日'}
              </span>
              <input
                type="date"
                className="a-filter-input"
                value={collectedFrom}
                onChange={(e) => {
                  setCollectedFrom(e.target.value)
                  setPage(1)
                }}
              />
              <span className="a-muted">至</span>
              <input
                type="date"
                className="a-filter-input"
                value={collectedTo}
                onChange={(e) => {
                  setCollectedTo(e.target.value)
                  setPage(1)
                }}
              />
            </>
          ) : null}
          <button type="button" className="a-btn ghost" onClick={load} disabled={loading}>
            {loading ? '查询中…' : '查询'}
          </button>
          <button type="button" className="a-btn ghost" onClick={resetFilters}>
            重置
          </button>
          <span className="a-muted">共 {activeRows.length} 条</span>
        </div>

        <div className="a-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="a-btn ghost" onClick={exportCsv} disabled={!activeRows.length}>
            导出
          </button>
          <button type="button" className="a-btn ghost" onClick={load} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {tab === 'business-bills' && businessSummary ? (
        <div className="a-report-summary-grid">
          <article className="a-report-kpi">
            <p className="a-report-kpi-label">应收合计</p>
            <p className="a-report-kpi-num">{fmtMoney(businessSummary.totalReceivable)}</p>
            <p className="a-report-kpi-foot">{businessSummary.billCount} 笔账单</p>
          </article>
          <article className="a-report-kpi a-report-kpi--green">
            <p className="a-report-kpi-label">已缴合计</p>
            <p className="a-report-kpi-num">{fmtMoney(businessSummary.totalReceived)}</p>
            <p className="a-report-kpi-foot">已核销/支付金额汇总</p>
          </article>
          <article className="a-report-kpi a-report-kpi--amber">
            <p className="a-report-kpi-label">欠费合计</p>
            <p className="a-report-kpi-num">{fmtMoney(businessSummary.totalOwed)}</p>
            <p className="a-report-kpi-foot">待收余额汇总</p>
          </article>
        </div>
      ) : null}

      {tab === 'monthly-receivable' && monthlySummary ? (
        <div className="a-report-summary-grid">
          <article className="a-report-kpi">
            <p className="a-report-kpi-label">应收合计</p>
            <p className="a-report-kpi-num">{fmtMoney(monthlySummary.totalReceivable)}</p>
            <p className="a-report-kpi-foot">{monthlySummary.billCount} 笔应收明细</p>
          </article>
          <article className="a-report-kpi a-report-kpi--slate">
            <p className="a-report-kpi-label">已关联批次</p>
            <p className="a-report-kpi-num">{monthlySummary.lockedBatchCount}</p>
            <p className="a-report-kpi-foot">账期锁定后生成 PC 批次号</p>
          </article>
        </div>
      ) : null}

      {tab === 'collection-transactions' && collectionSummary ? (
        <div className="a-report-summary-grid">
          <article className="a-report-kpi a-report-kpi--green">
            <p className="a-report-kpi-label">实收合计</p>
            <p className="a-report-kpi-num">{fmtMoney(collectionSummary.totalActualReceived)}</p>
            <p className="a-report-kpi-foot">{collectionSummary.txCount} 笔流水</p>
          </article>
          <article className="a-report-kpi">
            <p className="a-report-kpi-label">关联应收合计</p>
            <p className="a-report-kpi-num">{fmtMoney(collectionSummary.totalReceivable)}</p>
            <p className="a-report-kpi-foot">对应账单应收原价汇总</p>
          </article>
        </div>
      ) : null}

      {tab === 'offline-verify-status' && verifySummary ? (
        <div className="a-report-summary-grid">
          <article className="a-report-kpi a-report-kpi--green">
            <p className="a-report-kpi-label">核销冲抵合计</p>
            <p className="a-report-kpi-num">{fmtMoney(verifySummary.totalVerifyAmount)}</p>
            <p className="a-report-kpi-foot">{verifySummary.verifyCount} 笔核销记录</p>
          </article>
          <article className="a-report-kpi a-report-kpi--amber">
            <p className="a-report-kpi-label">预收挂账合计</p>
            <p className="a-report-kpi-num">{fmtMoney(verifySummary.totalPrepayAmount)}</p>
            <p className="a-report-kpi-foot">{verifySummary.prepayCount} 笔含超额转预收</p>
          </article>
          <article className="a-report-kpi a-report-kpi--slate">
            <p className="a-report-kpi-label">核销成功 / 部分</p>
            <p className="a-report-kpi-num">
              {verifySummary.successCount} / {verifySummary.partialCount}
            </p>
            <p className="a-report-kpi-foot">失败 {verifySummary.failedCount} 笔</p>
          </article>
        </div>
      ) : null}

      {tab === 'monthly-rent-collected' && monthlyRentSummary ? (
        <div className="a-report-summary-grid">
          <article className="a-report-kpi a-report-kpi--green">
            <p className="a-report-kpi-label">实收合计</p>
            <p className="a-report-kpi-num">{fmtMoney(monthlyRentSummary.totalActualReceived)}</p>
            <p className="a-report-kpi-foot">{monthlyRentSummary.rowCount} 笔收款明细</p>
          </article>
          <article className="a-report-kpi">
            <p className="a-report-kpi-label">结算金额合计</p>
            <p className="a-report-kpi-num">{fmtMoney(monthlyRentSummary.totalSettlementAmount)}</p>
            <p className="a-report-kpi-foot">扣除手续费后的入账汇总</p>
          </article>
          <article className="a-report-kpi a-report-kpi--slate">
            <p className="a-report-kpi-label">系统 / 后台收款</p>
            <p className="a-report-kpi-num">
              {monthlyRentSummary.autoCollectionCount} / {monthlyRentSummary.offlineCollectionCount}
            </p>
            <p className="a-report-kpi-foot">自动收款与核销收款笔数</p>
          </article>
        </div>
      ) : null}

      <div className="a-card">
        <div className="a-table-wrap a-table-wrap--wide">
          {tab === 'business-bills' ? (
            <table className="a-table a-table-report-wide">
              <thead>
                <tr>
                  {BUSINESS_BILL_COLUMNS.map((c) => (
                    <th key={c.key} title={c.hint}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(pageData.items as BusinessBillRow[]).map((r, i) => {
                  const seq = (page - 1) * 20 + i + 1
                  return (
                    <tr key={r.billId}>
                      {BUSINESS_BILL_COLUMNS.map((c) => {
                        const val = businessCellValue(r, c.key, seq)
                        if (c.key === 'billStatus') {
                          return (
                            <td key={c.key}>
                              <span className={`a-badge status-${statusClass(r.billStatus)}`}>{r.billStatus}</span>
                            </td>
                          )
                        }
                        if (c.key === 'amountOwed') {
                          return (
                            <td
                              key={c.key}
                              style={{ fontWeight: 700, color: r.amountOwed > 0 ? '#b45309' : '#64748b' }}
                            >
                              {fmtMoney(r.amountOwed)}
                            </td>
                          )
                        }
                        if (c.money && c.key !== 'index') {
                          return (
                            <td key={c.key} style={{ fontWeight: c.key === 'totalAmount' ? 800 : 400 }}>
                              {fmtMoney(r[c.key as keyof BusinessBillRow] as number)}
                            </td>
                          )
                        }
                        if (c.key === 'overdueDays') {
                          return (
                            <td key={c.key} style={{ color: r.overdueDays > 0 ? '#b91c1c' : '#64748b' }}>
                              {r.overdueDays}
                            </td>
                          )
                        }
                        if (c.key === 'remark') {
                          return (
                            <td key={c.key} className="a-muted" style={{ fontSize: 12, maxWidth: 180 }}>
                              {r.remark || '—'}
                            </td>
                          )
                        }
                        return (
                          <td
                            key={c.key}
                            className={c.key === 'index' || c.key === 'billNo' || c.key === 'contractNo' ? '' : 'a-muted'}
                            style={{
                              whiteSpace: 'nowrap',
                              fontWeight: c.key === 'billNo' || c.key === 'contractNo' ? 700 : undefined,
                            }}
                          >
                            {val === '' ? '—' : String(val)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {!loading && pageData.items.length === 0 ? (
                  <tr>
                    <td colSpan={BUSINESS_BILL_COLUMNS.length} className="a-muted">
                      当前筛选条件下暂无账单数据。可调整费用归属月或门店后重新查询。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : tab === 'monthly-receivable' ? (
            <table className="a-table a-table-report-wide">
              <thead>
                <tr>
                  {MONTHLY_RECEIVABLE_COLUMNS.map((c) => (
                    <th key={c.key} title={c.hint}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(pageData.items as MonthlyReceivableRow[]).map((r, i) => {
                  const seq = (page - 1) * 20 + i + 1
                  return (
                    <tr key={r.billId}>
                      {MONTHLY_RECEIVABLE_COLUMNS.map((c) => {
                        const val = monthlyCellValue(r, c.key, seq)
                        if (c.money && c.key !== 'index') {
                          return (
                            <td key={c.key} style={{ fontWeight: 800 }}>
                              {fmtMoney(r.receivableAmount)}
                            </td>
                          )
                        }
                        if (c.key === 'remark') {
                          return (
                            <td key={c.key} className="a-muted" style={{ fontSize: 12, maxWidth: 180 }}>
                              {r.remark || '—'}
                            </td>
                          )
                        }
                        if (c.key === 'batchNo' && r.batchNo) {
                          return (
                            <td key={c.key} style={{ fontWeight: 700 }}>
                              {r.batchNo}
                            </td>
                          )
                        }
                        return (
                          <td
                            key={c.key}
                            className={
                              c.key === 'index' || c.key === 'billNo' || c.key === 'contractNo' ? '' : 'a-muted'
                            }
                            style={{
                              whiteSpace: 'nowrap',
                              fontWeight: c.key === 'billNo' || c.key === 'contractNo' ? 700 : undefined,
                            }}
                          >
                            {val === '' ? '—' : String(val)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {!loading && pageData.items.length === 0 ? (
                  <tr>
                    <td colSpan={MONTHLY_RECEIVABLE_COLUMNS.length} className="a-muted">
                      当前筛选条件下暂无应收明细。可调整费用归属月或门店后重新查询。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : tab === 'offline-verify-status' ? (
            <table className="a-table a-table-report-wide">
              <thead>
                <tr>
                  {OFFLINE_VERIFY_STATUS_COLUMNS.map((c) => (
                    <th key={c.key} title={c.hint}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(pageData.items as OfflineVerifyStatusRow[]).map((r, i) => {
                  const seq = (page - 1) * 20 + i + 1
                  return (
                    <tr key={r.logId}>
                      {OFFLINE_VERIFY_STATUS_COLUMNS.map((c) => {
                        const val = verifyCellValue(r, c.key, seq)
                        if (c.key === 'billStatusAfter') {
                          return (
                            <td key={c.key}>
                              <span className={`a-badge status-${statusClass(r.billStatusAfter)}`}>{r.billStatusAfter}</span>
                            </td>
                          )
                        }
                        if (c.key === 'verifyStatus') {
                          return (
                            <td key={c.key}>
                              <span className={`a-badge status-${verifyStatusClass(r.verifyStatus)}`}>{r.verifyStatus}</span>
                            </td>
                          )
                        }
                        if (c.money && c.key !== 'index') {
                          const n = r[c.key as keyof OfflineVerifyStatusRow] as number
                          return (
                            <td key={c.key} style={{ fontWeight: 800 }}>
                              {fmtMoney(n)}
                            </td>
                          )
                        }
                        if (c.key === 'verifyFailReason' || c.key === 'remark') {
                          return (
                            <td key={c.key} className="a-muted" style={{ fontSize: 12, maxWidth: 200 }}>
                              {r[c.key] || '—'}
                            </td>
                          )
                        }
                        if (c.key === 'operatedAt') {
                          return (
                            <td key={c.key} className="a-muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                              {r.operatedAt}
                            </td>
                          )
                        }
                        return (
                          <td
                            key={c.key}
                            className={
                              c.key === 'index' || c.key === 'contractNo' || c.key === 'billNo' ? '' : 'a-muted'
                            }
                            style={{
                              whiteSpace: 'nowrap',
                              fontWeight: c.key === 'contractNo' || c.key === 'billNo' ? 700 : undefined,
                            }}
                          >
                            {val === '' ? '—' : String(val)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {!loading && pageData.items.length === 0 ? (
                  <tr>
                    <td colSpan={OFFLINE_VERIFY_STATUS_COLUMNS.length} className="a-muted">
                      当前筛选条件下暂无核销记录。可调整操作日或费用归属月后重新查询。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : tab === 'monthly-rent-collected' ? (
            <table className="a-table a-table-report-wide">
              <thead>
                <tr>
                  {MONTHLY_RENT_COLLECTED_COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      title={c.hint}
                      className={c.highlight ? 'a-report-col-highlight' : undefined}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(pageData.items as MonthlyRentCollectedRow[]).map((r, i) => {
                  const seq = (page - 1) * 20 + i + 1
                  return (
                    <tr key={r.rowId}>
                      {MONTHLY_RENT_COLLECTED_COLUMNS.map((c) => {
                        const val = monthlyRentCellValue(r, c.key, seq)
                        if (c.key === 'billStatus') {
                          return (
                            <td key={c.key}>
                              <span className={`a-badge status-${statusClass(r.billStatus)}`}>{r.billStatus}</span>
                            </td>
                          )
                        }
                        if (c.key === 'settlementStatus') {
                          return (
                            <td key={c.key}>
                              <span className={`a-badge status-${settlementStatusClass(r.settlementStatus)}`}>
                                {r.settlementStatus}
                              </span>
                            </td>
                          )
                        }
                        if (c.money && c.key !== 'index') {
                          const n = r[c.key as keyof MonthlyRentCollectedRow] as number
                          return (
                            <td
                              key={c.key}
                              className={c.highlight ? 'a-report-col-highlight' : undefined}
                              style={{ fontWeight: 800 }}
                            >
                              {fmtMoney(n)}
                            </td>
                          )
                        }
                        if (c.key === 'remark') {
                          return (
                            <td key={c.key} className="a-muted" style={{ fontSize: 12, maxWidth: 180 }}>
                              {r.remark || '—'}
                            </td>
                          )
                        }
                        if (c.key === 'operatedAt') {
                          return (
                            <td key={c.key} className="a-muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                              {r.operatedAt}
                            </td>
                          )
                        }
                        return (
                          <td
                            key={c.key}
                            className={
                              c.key === 'index' || c.key === 'contractNo' || c.key === 'billNo' ? '' : 'a-muted'
                            }
                            style={{
                              whiteSpace: 'nowrap',
                              fontWeight: c.key === 'contractNo' || c.key === 'billNo' ? 700 : undefined,
                            }}
                          >
                            {val === '' ? '—' : String(val)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {!loading && pageData.items.length === 0 ? (
                  <tr>
                    <td colSpan={MONTHLY_RENT_COLLECTED_COLUMNS.length} className="a-muted">
                      当前筛选条件下暂无实收租金明细。可调整支付日或费用归属月后重新查询。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : (
            <table className="a-table a-table-report-wide">
              <thead>
                <tr>
                  {COLLECTION_TRANSACTION_COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      title={c.hint}
                      className={c.highlight ? 'a-report-col-highlight' : undefined}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(pageData.items as CollectionTransactionRow[]).map((r, i) => {
                  const seq = (page - 1) * 20 + i + 1
                  return (
                    <tr key={r.txId}>
                      {COLLECTION_TRANSACTION_COLUMNS.map((c) => {
                        const val = collectionCellValue(r, c.key, seq)
                        if (c.key === 'settlementStatus') {
                          return (
                            <td key={c.key}>
                              <span className={`a-badge status-${settlementStatusClass(r.settlementStatus)}`}>
                                {r.settlementStatus}
                              </span>
                            </td>
                          )
                        }
                        if (c.money && c.key !== 'index') {
                          const n = r[c.key as keyof CollectionTransactionRow] as number
                          return (
                            <td
                              key={c.key}
                              className={c.highlight ? 'a-report-col-highlight' : undefined}
                              style={{
                                fontWeight: 800,
                                color: n < 0 ? '#b91c1c' : undefined,
                              }}
                            >
                              {fmtMoney(n)}
                            </td>
                          )
                        }
                        if (c.key === 'remark') {
                          return (
                            <td key={c.key} className="a-muted" style={{ fontSize: 12, maxWidth: 180 }}>
                              {r.remark || '—'}
                            </td>
                          )
                        }
                        if (c.key === 'paidAt') {
                          return (
                            <td key={c.key} className="a-muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                              {r.paidAt}
                            </td>
                          )
                        }
                        return (
                          <td
                            key={c.key}
                            className={
                              c.key === 'index' || c.key === 'contractNo' || c.key === 'relatedBillNos'
                                ? ''
                                : 'a-muted'
                            }
                            style={{
                              whiteSpace: 'nowrap',
                              fontWeight:
                                c.key === 'contractNo' || c.key === 'relatedBillNos' ? 700 : undefined,
                            }}
                          >
                            {val === '' || val === 0 ? (c.money ? fmtMoney(0) : '—') : String(val)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {!loading && pageData.items.length === 0 ? (
                  <tr>
                    <td colSpan={COLLECTION_TRANSACTION_COLUMNS.length} className="a-muted">
                      当前筛选条件下暂无收款流水。可调整支付日或费用归属月后重新查询。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
        <Pagination
          total={activeRows.length}
          page={pageData.page}
          pageSize={pageData.pageSize}
          onChange={(p) => setPage(p.page)}
        />
      </div>
    </div>
  )
}
