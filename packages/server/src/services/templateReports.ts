import type { Prisma, PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { displayBillNoFromId } from '../billDisplayNo.js'
import { financeCloseMonthFromCreatedAt } from './reportBillCommon.js'
import type { MoveOutArchivePayload, MoveOutMoneyItem } from '../contractMoveOut.js'

export const templateReportTypes = ['asset-register', 'tenant-register', 'contract-register', 'moveout-settlement', 'rent-income', 'other-income', 'rent-aging'] as const
export type TemplateReportType = typeof templateReportTypes[number]
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine(v => Number(v.slice(0, 4)) >= 1900 && Number(v.slice(0, 4)) <= 9998)
export const templateReportQuery = z.object({
  storeId: z.string().max(200).optional(), keyword: z.string().max(200).optional(),
  periodFrom: month.optional(), periodTo: month.optional(), asOf: month.optional(),
  groupBy: z.enum(['asset', 'project', 'district']).default('asset'), feeName: z.string().max(100).optional(),
  status: z.string().max(60).optional(), tenantKind: z.enum(['INDIVIDUAL', 'ENTERPRISE']).optional(),
}).refine(v => !v.periodFrom || !v.periodTo || v.periodFrom <= v.periodTo, { message: '开始月份不能晚于结束月份' })
export type TemplateReportFilters = z.infer<typeof templateReportQuery>
export type TemplateReportRow = { id: string; values: (string | number | null)[] }
export type TemplateReportResult = { rows: TemplateReportRow[]; notices: string[] }
const houseInclude = { apartment: { include: { store: { include: { department: { include: { parent: true } } } } } } } as const
const contractInclude = {
  house: { include: houseInclude }, tenant: true, housingReport: true,
  renewedFrom: { select: { contractNo: true } }, renewedTo: { select: { contractNo: true } },
  order: { include: { lines: { include: { house: { include: houseInclude } } } } },
} as const
const billInclude = { items: true, offlineVerifyLogs: { orderBy: { createdAt: 'asc' as const } }, changeLogs: true, contract: { include: contractInclude } } as const
type House = Prisma.HouseGetPayload<{ include: typeof houseInclude }>
type Contract = Prisma.ContractGetPayload<{ include: typeof contractInclude }>
type Bill = Prisma.BillGetPayload<{ include: typeof billInclude }>
const text = (v: string | null | undefined) => v?.trim() || null
const ymd = (v: Date | null | undefined) => v ? v.toISOString().slice(0, 10) : null
const money = (v: number) => Math.round(v * 100) / 100
const activeStatuses = new Set(['ACTIVE', 'WAIT_TENANT_MOVEOUT_SIGN'])
const statusNames: Record<string, string> = { WAIT_INTERNAL_OA: '待内部审批', WAIT_TENANT_SIGN: '待签署', WAIT_STAMP: '待盖章', PENDING_PAYMENT: '待付款', ACTIVE: '执行中', WAIT_TENANT_MOVEOUT_SIGN: '退租待确认', VOID: '已作废', TERMINATED: '已终止' }
const docNames: Record<string, string> = { IDCARD: '居民身份证', PASSPORT: '护照', HKM_TW_PERMIT: '港澳台通行证', USCC: '营业执照' }
function asset(h: House) {
  const d = h.apartment.store.department
  return { name: `${h.apartment.name} ${h.houseNo}`, project: text(h.projectName) ?? h.apartment.store.name, district: d?.parent?.name ?? d?.name ?? h.apartment.store.name, department: text(h.mgmtDepartment) ?? d?.name ?? null }
}
function assets(c: Contract) { return c.order?.isMergedBundle && c.order.lines.length ? c.order.lines.map(l => l.house) : [c.house] }
function contractVisible(c: Contract, allowed: Set<string>) { return assets(c).every(h => allowed.has(h.apartment.storeId)) }
function match(values: unknown[], keyword?: string) { return !keyword || values.join(' ').toLocaleLowerCase().includes(keyword.toLocaleLowerCase().trim()) }
function json<T>(v: string | null): T | null { try { return v ? JSON.parse(v) as T : null } catch { return null } }
function endOfMonth(v: string) { const [y, m] = v.split('-').map(Number); return new Date(Date.UTC(y!, m!, 1) - 1) }
function startOfMonth(v: string) { return new Date(`${v}-01T00:00:00.000Z`) }
function todayMonth() { return new Date().toISOString().slice(0, 7) }
function sumNullable(values: (number | null)[]): number | null { return values.some(v => v === null) ? null : money(values.reduce<number>((s, v) => s + (v ?? 0), 0)) }
export function isRentFee(name: string) { return /租金|房租/.test(name) && !/押金|保证金|违约金|滞纳金/.test(name) }
function category(name: string) { return isRentFee(name) ? '租金' : name.trim() }
function feeTotal(b: Bill, fee: string) { return b.items.filter(i => category(i.name) === fee).reduce((s, i) => s + i.amount, 0) }
type Receipt = { at: Date; amount: number; source: 'system' | 'offline' }
/** Receipts are capped to the bill: excess payments belong to contract credit, not this fee. */
export function receiptHistory(b: Pick<Bill, 'totalAmount' | 'amountReceived' | 'paidAt' | 'status' | 'offlineVerifyLogs'>): Receipt[] | null {
  if (b.totalAmount < 0 || b.amountReceived < 0) return null
  let used = 0
  const events: Receipt[] = []
  for (const l of b.offlineVerifyLogs) {
    if (l.amount < 0) return null
    const amount = Math.min(l.amount, Math.max(0, b.totalAmount - used))
    used += amount
    events.push({ at: l.collectionDate ?? l.createdAt, amount, source: 'offline' })
  }
  if (!b.offlineVerifyLogs.length && b.paidAt && b.status === 'PAID') {
    used = b.amountReceived > 0 ? b.amountReceived : b.totalAmount
    events.push({ at: b.paidAt, amount: used, source: 'system' })
  }
  const recorded = b.amountReceived > 0 ? b.amountReceived : b.status === 'PAID' ? b.totalAmount : 0
  return used === recorded ? events : null
}
/** Fee-level split is exact only for a single fee category, or a single full settlement. */
function feeEvents(b: Bill, fee: string): Receipt[] | null {
  const all = receiptHistory(b)
  if (!all) return null
  const total = feeTotal(b, fee)
  if (!all.length || total === 0) return []
  const itemSum = b.items.reduce((s, i) => s + i.amount, 0)
  if (itemSum !== b.totalAmount || b.items.some(i => i.amount < 0)) return null
  if (new Set(b.items.filter(i => i.amount !== 0).map(i => category(i.name))).size === 1) return all
  if (all.length === 1 && all[0]!.amount === b.totalAmount) return [{ ...all[0]!, amount: total }]
  return null
}
function receivedAt(b: Bill, fee: string, cutoff: Date): number | null {
  // A changed bill cannot be treated as an immutable historic snapshot.
  if (b.changeLogs.some(l => l.changedAt > cutoff)) return null
  const events = feeEvents(b, fee)
  return events ? money(events.filter(e => e.at <= cutoff).reduce((s, e) => s + e.amount, 0)) : null
}
function paidItems(items: MoveOutMoneyItem[] | undefined, re: RegExp): number | null { return items ? money(items.filter(i => re.test(i.name)).reduce((s, i) => s + i.amount, 0)) : null }
function itemList(items: MoveOutMoneyItem[] | undefined, re: RegExp): string | null { return items ? items.filter(i => !re.test(i.name)).map(i => `${i.name}：${i.amount}`).join('；') || null : null }

export async function buildTemplateReport(prisma: PrismaClient, type: TemplateReportType, filters: TemplateReportFilters, canAccessStore: (id: string) => boolean): Promise<TemplateReportResult> {
  const allowed = new Set((await prisma.store.findMany({ select: { id: true } })).filter(s => canAccessStore(s.id) && (!filters.storeId || s.id === filters.storeId)).map(s => s.id))
  const houseWhere = { apartment: { storeId: { in: [...allowed] } } }
  const notices = new Set<string>()
  notices.add('空白表示未记录、不适用或无法可靠计算，不等于 0。')
  const rows: TemplateReportRow[] = []
  const push = (id: string, values: (string | number | null)[]) => rows.push({ id, values })
  if (type === 'tenant-register') {
    const tenants = await prisma.tenant.findMany({ where: { OR: [{ contracts: { some: { house: houseWhere } } }, { orders: { some: { house: houseWhere } } }] }, orderBy: { createdAt: 'desc' } })
    for (const t of tenants) {
      if (filters.tenantKind && t.tenantKind !== filters.tenantKind) continue
      if (!match([t.name, t.phone, t.idNumber], filters.keyword)) continue
      push(t.id, [rows.length + 1, t.tenantKind === 'ENTERPRISE' ? '单位' : '个人', t.name, null, null, docNames[t.idDocType] ?? t.idDocType, t.idNumber, t.idCardLongTerm ? '长期' : ymd(t.idCardValidUntil), null, t.tenantKind === 'INDIVIDUAL' ? t.name : null, t.phone, null, null, null, text(t.emergencyContactName), text(t.emergencyContactPhone), t.creditTier, null])
    }
    notices.add('仅展示与所选可访问门店有订单或合同关联的租户；法人、性别、证件地址、企业联系人及银行信息尚无独立档案字段。')
    return { rows, notices: [...notices] }
  }
  notices.add('合并合同含不可访问或未选中门店的资产时，整份合同不纳入，避免跨门店数据泄露。')
  const contracts = (await prisma.contract.findMany({ where: { house: houseWhere }, include: contractInclude, orderBy: { createdAt: 'desc' } })).filter(c => contractVisible(c, allowed))
  const contractMatch = (c: Contract) => (!filters.status || c.status === filters.status) && (!filters.tenantKind || c.tenant.tenantKind === filters.tenantKind) && match([c.contractNo, c.tenant.name, ...assets(c).flatMap(h => Object.values(asset(h)))], filters.keyword)
  if (type === 'asset-register') {
    const houses = await prisma.house.findMany({ where: houseWhere, include: houseInclude, orderBy: [{ apartmentId: 'asc' }, { houseNo: 'asc' }] })
    for (const h of houses) {
      const a = asset(h)
      if (filters.status && h.status !== filters.status || !match([h.externalId, h.houseNo, h.address, ...Object.values(a)], filters.keyword)) continue
      const c = contracts.find(c => activeStatuses.has(c.status) && assets(c).some(ch => ch.id === h.id) && !c.order?.lines.find(l => l.houseId === h.id)?.releasedAt)
      const line = c?.order?.isMergedBundle ? c.order.lines.find(l => l.houseId === h.id) : null
      push(h.id, [rows.length + 1, text(h.externalId), a.district, a.project, a.name, text(h.address), h.apartment.assetType, h.area, 1, null, text(h.rentCollectionUnit), null, a.department, null, null, null, h.houseType, null, null, ({ VACANT: '空置', RESERVED: '已预订', ORDERED: '已下单', SIGNED: '已签约', TERMINATED: '已退租' } as Record<string, string>)[h.status], null, c?.tenant.name ?? null, c?.contractNo ?? null, ymd(c?.startDate), ymd(c?.endDate), line?.rentMonthlySnapshot ?? c?.rentMonthly ?? null, null, null, null, null, null, h.isPublished ? h.rentMonthly : null, null, null, text(h.externalBrowseUrl), null, null, null, null, null, null, null, text(h.managerName), null])
    }
    notices.add('资产与在租合同按实时数据展示；未维护权属、权证、出租资格、空置起点、评估、定价依据和分项押金，相关列留空。系统押金未等同于履约保证金。')
    return { rows, notices: [...notices] }
  }
  if (type === 'contract-register') {
    for (const c of contracts.filter(contractMatch)) {
      const hs = assets(c); const a = asset(c.house)
      push(c.id, [c.renewedFrom?.contractNo ?? null, c.renewedTo.map(x => x.contractNo).join('；') || null, c.source === 'MANUAL_IMPORT' ? '线下录入' : '系统签约', statusNames[c.status] ?? c.status, c.contractNo, null, c.tenant.name, c.tenant.tenantKind === 'ENTERPRISE' ? '单位' : '个人', docNames[c.tenant.idDocType] ?? c.tenant.idDocType, c.tenant.idNumber, c.tenant.phone, ymd(c.agreementSignDate ?? c.signedAt), ymd(c.startDate), ymd(c.endDate), null, null, null, hs.reduce((s, h) => s + h.area, 0), ({ MONTHLY: '月付', BIMONTHLY: '双月付', QUARTERLY: '季付', YEARLY: '年付' } as Record<string, string>)[c.rentCycle] ?? c.rentCycle, [...new Set(hs.map(h => h.apartment.assetType))].join('；'), hs.map(h => asset(h).name).join('；'), a.project, a.district, a.department, c.rentMonthly, null, null, null, null, `系统合同押金：${c.deposit}`, text(c.configRemarkHtml?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')), null, c.signedAt?.toISOString() ?? null, null, (c.voidedAt ?? c.terminatedAt)?.toISOString() ?? null, c.housingReport?.bureauRecordNo ?? null, c.housingReport?.reportedAt?.toISOString() ?? null])
    }
    notices.add('租金为当前合同月租；合并合同按整份合同展示所有资产。免租期、独立计租起止、周期费及押金细分类、签约/关闭操作人缺少统一结构化记录，保留空白。系统合同押金展示于其他押金，未推定为履约保证金。')
    return { rows, notices: [...notices] }
  }
  if (type === 'moveout-settlement') {
    const from = filters.periodFrom ?? filters.periodTo ?? todayMonth(); const to = filters.periodTo ?? from
    for (const c of contracts.filter(contractMatch)) {
      const archive = json<MoveOutArchivePayload>(c.moveOutArchiveJson)
      const date = archive?.terminateDate ?? ymd(c.terminatedAt)
      if (!date || date.slice(0, 7) < from || date.slice(0, 7) > to) continue
      const s = archive?.settlement; const p = s?.paidItems; const r = s?.receivableItems
      const hs = archive?.releaseHouseIds?.length ? assets(c).filter(h => archive.releaseHouseIds.includes(h.id)) : assets(c)
      const a = asset(hs[0] ?? c.house)
      push(c.id, [rows.length + 1, null, hs.map(h => asset(h).name).join('；'), hs.reduce((sum, h) => sum + h.area, 0), a.project, a.district, a.department, c.contractNo, c.tenant.name, ymd(c.startDate), ymd(c.endDate), date, s?.stopRentDate ?? null, s ? ({ NORMAL_EXPIRY: '正常到期', BREACH_EARLY: '违约提前退租', SETTLED_EARLY: '结清提前退租', NEGOTIATED_EARLY: '协商提前退租' })[s.settlementType] : null, paidItems(p, /履约|保证金/), paidItems(p, /水电押金/), paidItems(p, /保洁押金/), paidItems(p, /租金|房租/), itemList(p, /履约|保证金|水电押金|保洁押金|租金|房租/), s?.paidTotal ?? null, paidItems(r, /^(租金|房租)/), paidItems(r, /逾期|滞纳/), paidItems(r, /物业/), paidItems(r, /^水费/), paidItems(r, /^电费/), paidItems(r, /保洁/), paidItems(r, /损坏|赔偿/), paidItems(r, /提前.*违约/), paidItems(r, /其他/), itemList(r, /^(租金|房租)|逾期|滞纳|物业|^水费|^电费|保洁|损坏|赔偿|提前.*违约|其他/), s?.receivableTotal ?? null, s?.refundAmount ?? null, null, null, null, archive ? '已完成退租结算' : null, archive?.completedAt ?? null, null, [archive?.reasonFull, s?.applicationNote, archive?.partial ? '部分资产退租' : null].filter(Boolean).join('；') || null])
    }
    notices.add('按退租日期筛选，只展示已归档结算；费用来自退租结算快照，不代表退款已支付。退租流水、账单关联、视同缴费日期与审批人缺少独立记录，保持空白；同合同仅保存最近一次退租归档。')
    return { rows, notices: [...notices] }
  }
  const bills = (await prisma.bill.findMany({ where: { contract: { house: houseWhere } }, include: billInclude, orderBy: [{ period: 'asc' }, { id: 'asc' }] })).filter(b => contractVisible(b.contract, allowed) && contractMatch(b.contract))
  notices.add('应收按已生成账单的费用归属月统计，不预测未生成账单；收款按实际到账日期（未登记时按核销时间）统计。多费项分次核销、历史账单改动或收款流水不完整时，无法确定的金额留空，不按比例分摊。')
  if (type === 'rent-aging') {
    const asOf = filters.asOf ?? todayMonth(); const cutoff = endOfMonth(asOf); const year = asOf.slice(0, 4)
    for (const b of bills) {
      const close = financeCloseMonthFromCreatedAt(b.createdAt)
      if (b.createdAt > cutoff || close > asOf) continue
      const total = feeTotal(b, '租金'); if (total <= 0) continue
      const received = receivedAt(b, '租金', cutoff); const outstanding = received === null ? null : money(Math.max(0, total - received))
      if (outstanding === 0) continue
      const a = asset(b.contract.house)
      const buckets: (number | null)[] = Array(13).fill(0)
      const index = close.slice(0, 4) < year ? 0 : Number(close.slice(5, 7))
      buckets[index] = outstanding
      const days = Math.max(0, Math.floor((cutoff.getTime() - b.dueDate.getTime()) / 86400000))
      push(b.id, [rows.length + 1, text(b.contract.house.externalId) ?? b.contract.house.id, a.name, a.project, a.district, a.department, b.contract.contractNo, b.contract.tenant.name, displayBillNoFromId(b.id), close, b.changeLogs.some(l => l.changedAt > cutoff) ? null : total, received, outstanding, ...buckets, outstanding === null ? null : days, outstanding === null ? '收款待核对' : received! > 0 ? '部分结清' : '未支付', [b.billingRemark, outstanding === null ? '无法确认截止月费项余额' : null, b.changeLogs.some(l => l.changedAt > cutoff) ? '截止月之后有账单修改，当前应收非历史快照' : null].filter(Boolean).join('；') || null])
    }
    notices.add(`截至 ${asOf} 月末；账龄按现有财务规则“创建日 25 日之后归属次月”拆分。未收金额不确定的账单保留待核对行，合并合同归属主资产。`)
    return { rows, notices: [...notices] }
  }
  const from = filters.periodFrom ?? filters.periodTo ?? todayMonth(); const to = filters.periodTo ?? from
  const begin = startOfMonth(from); const cutoff = endOfMonth(to); const opening = new Date(begin.getTime() - 1)
  const houses = await prisma.house.findMany({ where: houseWhere, include: houseInclude, orderBy: [{ apartmentId: 'asc' }, { houseNo: 'asc' }] })
  type Group = { houses: House[]; bills: Bill[] }
  const groups = new Map<string, Group>()
  const groupKey = (h: House) => filters.groupBy === 'district' ? asset(h).district : filters.groupBy === 'project' ? `${asset(h).district}\u0000${asset(h).project}` : h.id
  for (const h of houses) {
    if (!match([h.houseNo, h.address, ...Object.values(asset(h))], filters.keyword) && !bills.some(b => b.contract.houseId === h.id)) continue
    const key = groupKey(h); const group = groups.get(key) ?? { houses: [], bills: [] }; group.houses.push(h); groups.set(key, group)
  }
  for (const b of bills) { const key = groupKey(b.contract.house); const group = groups.get(key); if (group) group.bills.push(b) }
  for (const [key, group] of groups) {
    const a = asset(group.houses[0]!)
    const fees = type === 'rent-income' ? ['租金'] : [...new Set(group.bills.flatMap(b => b.items.map(i => category(i.name))).filter(f => f !== '租金' && !/押金|保证金/.test(f) && (!filters.feeName || f.includes(filters.feeName))))]
    for (const fee of fees) {
      const relevant = group.bills.filter(b => feeTotal(b, fee) !== 0)
      const prior = relevant.filter(b => b.period < from && b.createdAt <= opening)
      const current = relevant.filter(b => b.period >= from && b.period <= to && b.createdAt <= cutoff)
      const oldDue = sumNullable(prior.map(b => { const paid = receivedAt(b, fee, opening); return paid === null ? null : Math.max(0, feeTotal(b, fee) - paid) }))
      const due = sumNullable(current.map(b => b.changeLogs.some(l => l.changedAt > cutoff) ? null : feeTotal(b, fee)))
      const unpaid = sumNullable(relevant.filter(b => b.period <= to && b.createdAt <= cutoff).map(b => { const paid = receivedAt(b, fee, cutoff); return paid === null ? null : Math.max(0, feeTotal(b, fee) - paid) }))
      const receipts = (predicate: (b: Bill, e: Receipt) => boolean): number | null => sumNullable(relevant.map(b => {
        const events = feeEvents(b, fee)
        if (!events || b.changeLogs.some(l => l.changedAt > cutoff)) return null
        return events.filter(e => e.at >= begin && e.at <= cutoff && predicate(b, e)).reduce((sum, e) => sum + e.amount, 0)
      }))
      const preReceived = sumNullable(current.map(b => receivedAt(b, fee, opening)))
      const system = receipts((_b, e) => e.source === 'system'); const offline = receipts((_b, e) => e.source === 'offline')
      const occupancy = group.houses.filter(h => h.status === 'SIGNED')
      const base: (string | number | null)[] = [rows.length + 1, filters.groupBy === 'asset' ? a.name : null, filters.groupBy === 'district' ? null : a.project, a.district, [...new Set(group.houses.map(h => asset(h).department).filter(Boolean))].join('；') || null, null, occupancy.length, null, null, money(occupancy.reduce((s, h) => s + h.area, 0)), null]
      const remark = '经营指标为当前已签约状态；收款不含无法关联的记账本及预收余额；退租抵扣未连接账单核销。'
      if (type === 'rent-income') {
        const priorYears = receipts(b => b.period.slice(0, 4) < from.slice(0, 4))
        const priorThisYear = receipts(b => b.period.slice(0, 4) === from.slice(0, 4) && b.period < from)
        const overdueCurrent = receipts((b, e) => b.period >= from && b.period <= to && e.at > b.dueDate)
        const normalCurrent = receipts((b, e) => b.period >= from && b.period <= to && e.at <= b.dueDate)
        const futureYear = receipts(b => b.period > to && b.period.slice(0, 4) > to.slice(0, 4))
        const futureThisYear = receipts(b => b.period > to && b.period.slice(0, 4) === to.slice(0, 4))
        push(`${key}:${fee}`, [...base, oldDue, due, sumNullable([oldDue, due]), preReceived, priorYears, priorThisYear, overdueCurrent, normalCurrent, futureThisYear, futureYear, sumNullable([preReceived, receipts(() => true)]), unpaid, null, system, offline, null, null, remark])
      } else {
        const old = receipts(b => b.period < from); const now = receipts(b => b.period >= from && b.period <= to); const future = receipts(b => b.period > to)
        push(`${key}:${fee}`, [...base, fee, oldDue, due, sumNullable([oldDue, due]), preReceived, old, now, future, sumNullable([preReceived, old, now, future]), unpaid, system, offline, null, null, remark])
      }
    }
  }
  notices.add('经营指标为当前已签约资产数及面积，不代表统计期间历史出租情况；系统未记录可出租资格，因此可出租数/面积、出租率留空。合并合同收入归属合同主资产，按项目汇总时沿用主资产项目。')
  notices.add('系统收款与线下核销分别显示可确认金额；退租押金抵扣、预收余额转入和独立记账本缺少费项关联，无法保证完整性，按来源收款合计保留空白。其他收入排除租金与押金/保证金。跨年范围的“本年”以开始月份年份为准，“预收本年/来年”以结束月份年份划分。')
  return { rows, notices: [...notices] }
}

/** Export the same authorized result with original template header merges. */
export async function exportTemplateReport(type: TemplateReportType, result: TemplateReportResult): Promise<Buffer> {
  const XLSX = await import('xlsx')
  const { default: catalog } = await import('./templateReportHeaders.json', { with: { type: 'json' } })
  const meta = catalog[type]
  const cells: (string | number | null)[][] = Array.from({ length: meta.headerRows.length }, () => Array(meta.columns.length).fill(null))
  const occupied = new Set<string>()
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = []
  meta.headerRows.forEach((row, r) => {
    let c = 0
    for (const header of row) {
      while (occupied.has(`${r}:${c}`)) c++
      cells[r]![c] = header.label
      for (let y = r; y < r + header.rowSpan; y++) for (let x = c; x < c + header.colSpan; x++) occupied.add(`${y}:${x}`)
      if (header.rowSpan > 1 || header.colSpan > 1) merges.push({ s: { r, c }, e: { r: r + header.rowSpan - 1, c: c + header.colSpan - 1 } })
      c += header.colSpan
    }
  })
  const sheet = XLSX.utils.aoa_to_sheet([...cells, ...result.rows.map(r => r.values)])
  sheet['!merges'] = merges
  sheet['!cols'] = meta.columns.map(c => ({ wch: c.format === 'text' ? 24 : 18 }))
  for (let r = cells.length; r < cells.length + result.rows.length; r++) {
    for (let c = 0; c < meta.columns.length; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      if (cell?.t === 'n') cell.z = meta.columns[c]!.format === 'percent' ? '0.00"%"' : meta.columns[c]!.format === 'money' ? '#,##0.00' : '#,##0.##'
    }
  }
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, meta.title.slice(0, 31))
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['统计口径与数据说明'], ...result.notices.map(n => [n])]), '口径说明')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
