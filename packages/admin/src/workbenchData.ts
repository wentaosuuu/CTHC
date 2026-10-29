/** 待办只从本地业务记录的明确状态派生，不生成申请、不代替业务页办理。 */
export const WORKBENCH_SOURCES = [
  { id: 'orders', label: '订单', path: '/api/admin/orders' },
  { id: 'contracts', label: '合同', path: '/api/admin/contracts' },
  { id: 'refunds', label: '退押金', path: '/api/admin/workbench/deposit-refunds' },
  { id: 'sublets', label: '转租', path: '/api/admin/sublets' },
  { id: 'transactions', label: '收据申请', path: '/api/admin/transactions' },
  { id: 'overdue', label: '逾期账单', path: '/api/admin/bills/overdue' },
] as const

export type WorkbenchSourceId = (typeof WORKBENCH_SOURCES)[number]['id']
export const WORKBENCH_CATEGORIES = [
  { id: 'orders', label: '订单待审核', source: 'orders', available: true },
  { id: 'internal', label: '合同待内部审核', source: 'contracts', available: true },
  { id: 'stamp', label: '合同待盖章', source: 'contracts', available: true },
  { id: 'refund', label: '押金退款待处理', source: 'refunds', available: true },
  { id: 'moveout', label: '退租待审批', source: 'contracts', available: false },
  { id: 'changehouse', label: '换房待跟进', source: 'contracts', available: false },
  { id: 'sublets', label: '转租待审核', source: 'sublets', available: true },
  { id: 'modification', label: '合同修改待审核', source: 'contracts', available: true },
  { id: 'reprint', label: '收据补打待审批', source: 'transactions', available: true },
  { id: 'overdue', label: '逾期账单待催收', source: 'overdue', available: true },
] as const satisfies readonly { id: string; label: string; source: WorkbenchSourceId; available: boolean }[]

export type WorkbenchCategoryId = (typeof WORKBENCH_CATEGORIES)[number]['id']
export type WorkbenchRecord = Record<string, unknown>
export type WorkbenchRow = {
  id: string
  category: WorkbenchCategoryId
  businessNo: string
  tenant: string
  store: string
  projectHouse: string
  amount: number | null
  waitingDays: number | null
  waitingStartedAt: number | null
  status: string
  href: string | null
  action: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function record(value: unknown): WorkbenchRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as WorkbenchRecord : {}
}

function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function startTime(value: unknown, now: number): number | null {
  const source = text(value)
  if (!source) return null
  // 业务日期采用中国时区，避免不同电脑时区把账单日期偏移一天。
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(source) ? `${source}T00:00:00+08:00` : source)
  return Number.isFinite(parsed) && parsed <= now ? parsed : null
}

function makeRow(
  source: WorkbenchSourceId,
  item: WorkbenchRecord,
  category: WorkbenchCategoryId,
  businessNo: string,
  path: string,
  status: string,
  action: string,
  waitingSince: unknown,
  now: number,
  rowAmount: unknown = null,
): WorkbenchRow {
  const house = record(item.house)
  const tenant = record(item.tenant)
  const startedAt = startTime(waitingSince, now)
  const projectHouse = [...new Set([
    text(house.projectName) || text(item.projectName),
    text(house.apartmentName) || text(item.apartmentName),
    text(house.houseNo) || text(item.houseNo),
  ].filter(Boolean))].join(' / ')
  return {
    id: `${source}:${category}:${text(item.id) || text(item.billId) || businessNo}`,
    category,
    businessNo: businessNo || '—',
    tenant: text(tenant.name) || text(item.tenantName) || '—',
    store: text(house.storeName) || text(item.storeName) || '—',
    projectHouse: projectHouse || '—',
    amount: amount(rowAmount),
    waitingDays: startedAt === null ? null : Math.floor((now - startedAt) / 86_400_000),
    waitingStartedAt: startedAt,
    status,
    href: businessNo ? `${path}?${new URLSearchParams({ q: businessNo }).toString()}` : null,
    action,
  }
}

export function parseWorkbenchItems(payload: unknown): WorkbenchRecord[] {
  const items = record(payload).items
  if (!Array.isArray(items) || items.some(item => item === null || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('业务记录格式异常，请重试。')
  }
  return items as WorkbenchRecord[]
}

export function deriveWorkbenchRows(source: WorkbenchSourceId, items: WorkbenchRecord[], now: number): WorkbenchRow[] {
  const rows: WorkbenchRow[] = []
  for (const item of items) {
    const status = text(item.status)
    if (source === 'orders' && status === 'PENDING_REVIEW') {
      rows.push(makeRow(source, item, 'orders', text(item.orderNo), '/orders', '待审核', '去审核', item.createdAt, now))
    }
    if (source === 'contracts') {
      const number = text(item.contractNo)
      if (status === 'WAIT_INTERNAL_OA') {
        rows.push(makeRow(source, item, 'internal', number, '/contracts', '待内部审核', '去审核', null, now))
      }
      if (status === 'WAIT_STAMP') {
        rows.push(makeRow(source, item, 'stamp', number, '/contracts', '待盖章', '去盖章', item.oaPassedAt, now))
      }
      if (text(item.modificationRequestedAt) && !text(item.modificationRejectedAt)) {
        rows.push(makeRow(source, item, 'modification', number, '/contracts', '修改待审核', '去审核', item.modificationRequestedAt, now))
      }
      // 待租客退租签字不代表待审批，换房历史关系不代表待跟进。
      // 当前合同接口没有这两类申请的明确待办状态，因此保留分类，不把历史合同计为待办。
    }
    if (source === 'refunds' && status === 'TERMINATED' && (amount(item.maxRefundable) ?? 0) > 0) {
      rows.push(makeRow(source, item, 'refund', text(item.contractNo), '/contracts',
        '已终止待退押金', '去退押金', null, now, item.maxRefundable))
    }
    if (source === 'sublets' && (status === 'PENDING_REVIEW' || status === 'FILING_REVIEW')) {
      rows.push(makeRow(source, item, 'sublets', text(item.applicationNo), '/sublets',
        status === 'PENDING_REVIEW' ? '待初审' : '待复审备案材料', '去审核',
        status === 'PENDING_REVIEW' ? item.createdAt : item.filingSubmittedAt, now))
    }
    if (source === 'transactions') {
      const receipt = record(item.receipt)
      if (receipt.reprintRequestStatus === 'PENDING' && receipt.status !== 'VOID') {
        rows.push(makeRow(source, item, 'reprint', text(item.txNo), '/reprint-approvals', '待审批', '去审批', receipt.reprintRequestedAt, now, item.amount))
      }
    }
    if (source === 'overdue') {
      const row = makeRow(source, item, 'overdue', text(item.billNo) || text(item.billId), '/overdue',
        '逾期', '去催收', item.dueDate, now, item.amountRemaining)
      const days = amount(item.daysOverdue)
      if (days !== null && Number.isInteger(days)) row.waitingDays = days
      // 应收总额不等于未缴余额；接口没给余额时金额保持空白。
      rows.push(row)
    }
  }
  return rows
}

export function sortWorkbenchRows(rows: WorkbenchRow[]): WorkbenchRow[] {
  return [...rows].sort((a, b) => {
    if (a.waitingDays === null && b.waitingDays !== null) return 1
    if (a.waitingDays !== null && b.waitingDays === null) return -1
    return (b.waitingDays ?? -1) - (a.waitingDays ?? -1)
      || (a.waitingStartedAt ?? Number.MAX_SAFE_INTEGER) - (b.waitingStartedAt ?? Number.MAX_SAFE_INTEGER)
      || a.businessNo.localeCompare(b.businessNo, 'zh-CN')
  })
}

export function workbenchWaitingLabel(days: number | null): string {
  return days === null ? '等待开始时间未知' : days === 0 ? '不足 1 天' : `已等待 ${days} 天`
}
