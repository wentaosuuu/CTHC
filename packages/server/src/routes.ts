import type { Express, Request, RequestHandler } from 'express'
import type { PrismaClient, Admin, AdminRoleCode, Prisma, TenantCreditTier } from '@prisma/client'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import fs from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { signAdminToken, verifyAdminToken } from './auth.js'
import { getBearerToken } from './http.js'
import { env } from './env.js'
import {
  addMonths,
  fmtPeriod,
  isRenewWithinTwoMonthWindow,
  renewEarliestStartDate,
  startOfMonth,
  toYmd,
} from './time.js'
import { buildRentBillSchedule, normalizeRentDueDay } from './rentBillSchedule.js'
import { buildContractSummaryText } from './contractSummaryText.js'
import {
  applyPrepaidRentCreditToNewContract,
  buildChangeHouseMoneySnapshot,
  computePrepaidRentCredit,
  moveMonthPeriod,
} from './changeHouseSettlement.js'
import {
  mergedOrderLineStatus,
  mergedOrderLineStatusLabel,
  reconcileBaseBillsAfterMergedLineRelease,
} from './orderLineRelease.js'
import { upsertAssetSnapshot } from './services/assetSync.js'
import { ensureHousingReportRecord, performHousingReportNow } from './services/housingReport.js'
import { computePenalty } from './services/penalty.js'
import {
  assertBillsPayableInOrder,
  payBlockedReasonForBill,
  type BillPayOrderRow,
  unpaidBillsQueueForContract,
} from './billPayOrder.js'
import {
  isContractBillingPaused,
  shouldClearBillingPause,
} from './contractBilling.js'
import {
  contractExpiryDaysLeft,
  isContractLeaseExpired,
  syncExpiredActiveContractHouses,
} from './contractExpiry.js'
import { buildBillImportTemplateBuffer, parseAndImportBills, parseMeterNoListJson } from './services/billImport.js'
import { buildOfflineVerifyBatchTemplateBuffer, parseAndBatchOfflineVerify } from './services/billOfflineVerifyBatch.js'
import {
  applyBillPushForContract,
  billPushStatusLabel,
  mobileBillsWhere,
  normalizeIdNumber,
  retryBillPushForIdNumber,
  tenantCanAccessBill,
  tenantPushStatusLabel,
} from './billPush.js'
import {
  isOfflineCollectionChannel,
  parseCollectionDateYmd,
  parseOfflineCollectionAmount,
} from './offlineVerify.js'
import { buildHouseImportTemplateBuffer, parseAndImportHouses } from './services/houseImport.js'
import { buildBusinessBillsReport } from './services/businessBillsReport.js'
import { buildCollectionTransactionReport } from './services/collectionTransactionReport.js'
import { buildMonthlyReceivableReport } from './services/monthlyReceivableReport.js'
import { buildMonthlyRentCollectedReport } from './services/monthlyRentCollectedReport.js'
import { buildOfflineVerifyStatusReport } from './services/offlineVerifyStatusReport.js'
import { buildCollectedReport, buildReceivableReport } from './services/financeReports.js'
import { insertHouseChangeLogs, jsonArrayCount, truncateLogValue } from './services/houseChangeLog.js'
import { insertTenantProfileLog, mergeTenantProfileLogs } from './services/tenantProfileLog.js'
import { houseBizId, numericCodeFromId } from './houseBizId.js'
import {
  buildReceiptDto,
  isFinanceRole,
  loadReceiptMap,
  printTransactionReceipts,
} from './transactionReceipt.js'
import { parseHouseConfigItems, serializeHouseConfigItems } from './houseConfigJson.js'
import {
  applyContractPreviewWatermark,
  contractAttachmentLockedUntilTenantPaid,
} from './contractAttachmentWatermark.js'
import {
  ensureMoveOutUploadDir,
  executeAdminContractTerminate,
  expireTenantMoveOutIfNeeded,
  MOVEOUT_UPLOAD_ROOT,
  unlinkMoveOutFiles,
  type MoveOutPendingPayload,
} from './contractMoveOut.js'
import {
  decodeBase64ImagePayload,
  recognizeIdCardSide,
} from './idCardRec.js'
import {
  normalizeIdDocType,
  optionalDocValidUntilOk,
  validateIdNumberForDocType,
  type IdDocType,
} from './orderIdDoc.js'
import {
  computeRenewalTenantActionDeadline,
  computeTenantSignDeadline,
  voidContractReleaseHouseAndCancelOrder,
} from './contractLifecycle.js'
import {
  promoteOrderedHousesToReservedForOrder,
  releaseOrderedHousesForOrder,
} from './orderBundle.js'
import { syncBaseRentBillItemsForContract } from './billRentItems.js'
import { buildDepositRefundOptions, resolveDepositRefundAmount } from './depositRefund.js'
import { contractTemplateTerminationData } from './contractTemplate.js'
import { maskIdNumber, maskMobilePhone, maskPersonName } from './piiMask.js'
import { isMainland18Id, isUscc18 } from './orderIdDoc.js'

const MS_HOUR = 3600_000

const zRentCycle = z.enum(['MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'])
const zRentDueDay = z.number().int().min(1).max(31)
const zContractTemplate = z.enum([
  'RESIDENTIAL_ASSET',
  'JIANGNAN_FACTORY',
  'NON_RESIDENTIAL',
  'NANNING_HOUSING',
  'TRIPARTITE',
  'APARTMENT',
])

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } })
const houseImportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } })
const contractFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
})

type TenantProfileDbRow = {
  id: string
  name: string
  phone: string
  wechat: string | null
  idDocType: string
  idNumber: string
  creditTier: string
  createdAt: Date
  mobileVerifiedAt: Date | null
  tenantKind: string
  createdSource: string
  createdByAdmin?: { name: string } | null
  _count: { orders: number; contracts: number }
}

function mapTenantProfileRow(t: TenantProfileDbRow, forContractSelect: boolean) {
  return {
    id: t.id,
    name: forContractSelect ? t.name : maskPersonName(t.name),
    phone: forContractSelect ? t.phone : maskMobilePhone(t.phone),
    wechat: t.wechat,
    idDocType: t.idDocType,
    idNumber: forContractSelect ? t.idNumber : undefined,
    idNumberMasked: maskIdNumber(t.idNumber),
    creditTier: t.creditTier,
    tenantKind: t.tenantKind,
    tenantKindLabel: t.tenantKind === 'ENTERPRISE' ? '企业' : '个人',
    mobileVerified: Boolean(t.mobileVerifiedAt),
    mobileVerifiedLabel: t.mobileVerifiedAt ? '已实名' : '未实名',
    createdSource: t.createdSource,
    createdByLabel:
      t.createdSource === 'ADMIN'
        ? t.createdByAdmin?.name
          ? `后台·${t.createdByAdmin.name}`
          : '后台创建'
        : '租客自主',
    enteredAt: t.createdAt.toISOString(),
    orderCount: t._count.orders,
    contractCount: t._count.contracts,
  }
}

function tenantProfilesWhere(auth: ReturnType<typeof getAdminAuth>): Prisma.TenantWhereInput {
  if (auth.admin.roleCode === 'SYSTEM_ADMIN') return {}
  if (auth.storeIds.length === 0) return { id: '__none__' }
  return {
    OR: [
      { orders: { some: { house: { apartment: { storeId: { in: auth.storeIds } } } } } },
      { contracts: { some: { house: { apartment: { storeId: { in: auth.storeIds } } } } } },
      { createdSource: 'ADMIN', createdByAdminId: auth.admin.id },
    ],
  }
}

/** 退押金打印/归档模板（占位，后续可换真实文书） */
const DEPOSIT_REFUND_TEMPLATE_LABEL: Record<string, string> = {
  BOWAN_APT_STANDARD: '泊湾公寓 · 标准退押结算单',
  SHOP_STANDARD: '商铺 · 退租退押结算模板',
  FACTORY_STANDARD: '厂房 · 退租退押结算模板',
  RESIDENTIAL_STANDARD: '住宅 · 退租退押结算模板',
  CO_LIVING: '合租/分散式 · 退押结算模板',
  SERVICED_APT: '服务式公寓 · 退押结算模板',
  GENERIC_MINIMAL: '通用 · 简化退款确认书',
}

const CONTRACT_UPLOAD_ROOT = path.join(process.cwd(), 'data', 'contract-uploads')
const BILL_VERIFY_UPLOAD_ROOT = path.join(process.cwd(), 'data', 'bill-verify-uploads')
const DEPT_QR_PUBLIC_ROOT = path.join(process.cwd(), 'data', 'dept-qr-public')

function ensureDeptQrPublicDir() {
  fs.mkdirSync(DEPT_QR_PUBLIC_ROOT, { recursive: true })
}

function viewingContactFromStore(store: {
  wecomQrUrl: string | null
  department: { contactPhone: string | null; wecomQrUrl: string | null } | null
}) {
  const dept = store.department
  const phone = (dept?.contactPhone && dept.contactPhone.trim()) || null
  const qrUrlRaw = (dept?.wecomQrUrl && dept.wecomQrUrl.trim()) || (store.wecomQrUrl && store.wecomQrUrl.trim()) || null
  return { phone, qrUrl: qrUrlRaw }
}

function normalizeMeterNosInput(arr: unknown, max = 40): string[] {
  if (!Array.isArray(arr)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of arr) {
    const s = String(raw ?? '').trim().slice(0, 80)
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

function billItemsToApi(
  items: { name: string; amount: number; breakdownJson: string | null }[],
): { name: string; amount: number; breakdown?: { label: string; amount: number }[] }[] {
  return items.map((i) => {
    let breakdown: { label: string; amount: number }[] | undefined
    if (i.breakdownJson) {
      try {
        const p = JSON.parse(i.breakdownJson) as unknown
        if (Array.isArray(p)) {
          breakdown = p
            .filter((x) => x && typeof x === 'object')
            .map((x) => ({
              label: String((x as { label?: unknown }).label ?? ''),
              amount: Number((x as { amount?: unknown }).amount ?? 0),
            }))
            .filter((x) => x.label && Number.isFinite(x.amount))
        }
      } catch {
        breakdown = undefined
      }
    }
    return { name: i.name, amount: i.amount, ...(breakdown?.length ? { breakdown } : {}) }
  })
}

function mergedUnitsFromContract(
  contract: {
    order: {
      isMergedBundle: boolean
      lines: { releasedAt: Date | null; house: { apartment: { name: string }; houseNo: string } }[]
    } | null
  },
): { apartmentName: string; houseNo: string }[] | undefined {
  const ord = contract.order
  if (!ord?.isMergedBundle || !ord.lines?.length) return undefined
  const active = ord.lines.filter((l) => !l.releasedAt)
  if (!active.length) return undefined
  return active.map((l) => ({
    apartmentName: l.house.apartment.name,
    houseNo: l.house.houseNo,
  }))
}

function mapMergedBundleFromOrder(
  order: {
    isMergedBundle: boolean
    lines: {
      houseId: string
      rentMonthlySnapshot: number
      releasedAt: Date | null
      changeHouseNewContractId: string | null
      changeHouseNewContract?: { contractNo: string } | null
      house: { id: string; houseNo: string; apartment: { name: string } }
    }[]
  } | null,
) {
  if (!order?.isMergedBundle || !order.lines.length) return null
  const lines = order.lines
  const activeLines = lines.filter((l) => !l.releasedAt)
  return {
    lineCount: activeLines.length,
    lineHistoryCount: lines.length,
    rentMonthlySum: activeLines.reduce((s, l) => s + l.rentMonthlySnapshot, 0),
    lines: lines.map((l) => {
      const lineStatus = mergedOrderLineStatus(l)
      return {
        houseId: l.houseId,
        houseBizId: houseBizId(l.house.id),
        apartmentName: l.house.apartment.name,
        houseNo: l.house.houseNo,
        rentMonthlySnapshot: l.rentMonthlySnapshot,
        releasedAt: l.releasedAt?.toISOString() ?? null,
        changeHouseNewContractId: l.changeHouseNewContractId,
        changeHouseNewContractNo: l.changeHouseNewContract?.contractNo ?? null,
        lineStatus,
        lineStatusLabel: mergedOrderLineStatusLabel(lineStatus),
      }
    }),
  }
}

function ensureContractUploadDir(contractId: string) {
  const dir = path.join(CONTRACT_UPLOAD_ROOT, contractId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function ensureBillVerifyUploadDir(billId: string) {
  const dir = path.join(BILL_VERIFY_UPLOAD_ROOT, billId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function parseContractAttachmentsJson(s: string | null | undefined): { id: string; name: string; file: string }[] {
  try {
    const a = JSON.parse(s || '[]')
    if (!Array.isArray(a)) return []
    return a.filter((x) => x && typeof x.file === 'string' && typeof x.name === 'string')
  } catch {
    return []
  }
}

function mimeFromFileKey(fileKey: string) {
  const ext = path.extname(fileKey).toLowerCase()
  const mime =
    ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.gif'
          ? 'image/gif'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.pdf'
              ? 'application/pdf'
              : 'application/octet-stream'
  return { ext, mime }
}

function parseBillVerifyAttachmentsJson(s: string | null | undefined): { id: string; name: string; file: string }[] {
  try {
    const a = JSON.parse(s || '[]')
    if (!Array.isArray(a)) return []
    return a.filter((x) => x && typeof x.file === 'string' && typeof x.name === 'string')
  } catch {
    return []
  }
}

async function isBillPeriodLocked(prisma: PrismaClient, storeId: string, period: string) {
  // 精确到日的账期也受对应年月账期锁定约束
  const candidates = /^\d{4}-\d{2}-\d{2}$/.test(period) ? [period, period.slice(0, 7)] : [period]
  for (const p of candidates) {
    const bp = await prisma.billPeriod.findUnique({ where: { storeId_period: { storeId, period: p } } })
    if (bp?.lockedAt) return true
  }
  return false
}

/** 账期 YYYY-MM / YYYY-MM-DD 是否与合同租期存在交集（与建合同时按月生成 BASE 账单的口径一致） */
function periodOverlapsLease(startDate: Date, endDate: Date, period: string) {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period)
  if (day) {
    const y = Number(day[1])
    const mo = Number(day[2])
    const d = Number(day[3])
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return false
    const dayStart = new Date(Date.UTC(y, mo - 1, d))
    const dayEndEx = new Date(Date.UTC(y, mo - 1, d + 1))
    return startDate < dayEndEx && endDate > dayStart
  }
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  if (!y || mo < 1 || mo > 12) return false
  const monthStart = new Date(Date.UTC(y, mo - 1, 1))
  const monthEndEx = new Date(Date.UTC(y, mo, 1))
  return startDate < monthEndEx && endDate > monthStart
}

function remarkPlainPreview(html: string | null | undefined, max = 40): string {
  if (!html) return ''
  const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function getDepositRefundSummary(refunds: Array<{ amount: number; reason: string }>) {
  const depositRefunds = refunds.filter((r) => r.reason.startsWith('退押金'))
  const refundedDepositAmount = depositRefunds.reduce((s, r) => s + Math.max(0, r.amount), 0)
  return {
    depositRefunded: refundedDepositAmount > 0,
    refundedDepositAmount,
  }
}

type Ctx = { prisma: PrismaClient }

type AdminAuth = {
  admin: Admin
  storeIds: string[]
}

function adminAuth(prisma: PrismaClient): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = getBearerToken(req)
      if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' })
      const payload = verifyAdminToken(token)
      const admin = await prisma.admin.findUnique({ where: { id: payload.adminId } })
      if (!admin) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const stores = await prisma.adminStore.findMany({
        where: { adminId: admin.id },
        select: { storeId: true },
      })
      ;(req as any).adminAuth = { admin, storeIds: stores.map((s) => s.storeId) } satisfies AdminAuth
      next()
    } catch {
      return res.status(401).json({ error: 'UNAUTHORIZED' })
    }
  }
}

function getAdminAuth(req: Request): AdminAuth {
  return (req as any).adminAuth as AdminAuth
}

function canAccessStore(auth: AdminAuth, storeId: string) {
  if (auth.admin.roleCode === 'SYSTEM_ADMIN' || auth.admin.roleCode === 'FINANCE') return true
  return auth.storeIds.includes(storeId)
}

function mustBeFinance(auth: AdminAuth) {
  return isFinanceRole(auth.admin.roleCode)
}

function mustBeSystemAdmin(auth: AdminAuth) {
  return auth.admin.roleCode === 'SYSTEM_ADMIN'
}

type BillWriteClient = Pick<PrismaClient, 'bill'>

async function syncContractBaseRentBills(
  client: BillWriteClient,
  params: {
    contractId: string
    startDate: Date
    leaseMonths: number
    rentMonthly: number
    rentCycle: string
    rentDueDay: number
  },
  mode: 'upsert' | 'create',
) {
  const schedule = buildRentBillSchedule({
    startDate: params.startDate,
    leaseMonths: params.leaseMonths,
    rentMonthly: params.rentMonthly,
    rentCycle: params.rentCycle,
    rentDueDay: params.rentDueDay,
  })
  for (const p of schedule) {
    const data = {
      contractId: params.contractId,
      period: p.period,
      dueDate: p.dueDate,
      totalAmount: p.totalAmount,
      status: 'UNPAID' as const,
      kind: 'BASE' as const,
    }
    if (mode === 'upsert') {
      await client.bill.upsert({
        where: {
          contractId_period_kind: { contractId: params.contractId, period: p.period, kind: 'BASE' },
        },
        create: data,
        update: { dueDate: p.dueDate, totalAmount: p.totalAmount },
      })
    } else {
      await client.bill.create({ data })
    }
  }
}

export function registerRoutes(app: Express, prisma: PrismaClient) {
  const ctx: Ctx = { prisma }

  ensureDeptQrPublicDir()
  app.get('/api/public/dept-qr/:fileName', (req, res) => {
    const raw = String(req.params.fileName ?? '')
    const base = path.basename(raw)
    if (!base || base !== raw) return res.status(400).end()
    const fp = path.resolve(DEPT_QR_PUBLIC_ROOT, base)
    if (!fp.startsWith(path.resolve(DEPT_QR_PUBLIC_ROOT))) return res.status(400).end()
    if (!fs.existsSync(fp)) return res.status(404).end()
    res.sendFile(fp)
  })

  // ---------- Public (H5) ----------
  app.get('/api/houses', async (req, res) => {
    const status = z
      .enum(['VACANT', 'RESERVED', 'ORDERED', 'SIGNED', 'TERMINATED'])
      .optional()
      .safeParse(req.query.status)
    const browse = req.query.browse === '1' || req.query.browse === 'true'
    const whereStatus = status.success ? status.data : undefined
    const where = browse
      ? { isPublished: true, status: { in: ['VACANT', 'ORDERED', 'RESERVED'] as any } }
      : whereStatus
        ? { isPublished: true, status: whereStatus }
        : { isPublished: true }

    const houses = await ctx.prisma.house.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { apartment: { include: { store: { include: { department: true } } } } },
      take: 200,
    })
    res.json({
      items: houses.map((h) => ({
        id: h.id,
        apartmentName: h.apartment.name,
        assetType: h.apartment.assetType,
        storeName: h.apartment.store.name,
        houseNo: h.houseNo,
        houseType: h.houseType,
        area: h.area,
        rentMonthly: h.rentMonthly,
        deposit: h.deposit,
        status: h.status,
        address: h.address,
        location: h.geoLat != null && h.geoLng != null ? { lat: h.geoLat, lng: h.geoLng } : null,
        nearbySubway: (() => {
          try {
            const parsed = JSON.parse(h.nearbySubwayJson ?? '[]')
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        })(),
        nearbySchools: (() => {
          try {
            const parsed = JSON.parse(h.nearbySchoolsJson ?? '[]')
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        })(),
        nearbyBusStops: (() => {
          try {
            const parsed = JSON.parse(h.nearbyBusStopsJson ?? '[]')
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        })(),
        images: (() => {
          try {
            const parsed = JSON.parse(h.houseImagesJson)
            return Array.isArray(parsed) ? parsed.map((x) => String(x)) : []
          } catch {
            return []
          }
        })(),
      })),
    })
  })

  app.get('/api/houses/:id', async (req, res) => {
    const house = await ctx.prisma.house.findUnique({
      where: { id: String(req.params.id) },
      include: { apartment: { include: { store: { include: { department: true } } } } },
    })
    if (!house || !house.isPublished) return res.status(404).json({ error: 'NOT_FOUND' })
    const viewingContact = viewingContactFromStore(house.apartment.store)
    res.json({
      id: house.id,
      apartmentName: house.apartment.name,
      assetType: house.apartment.assetType,
      storeName: house.apartment.store.name,
      houseNo: house.houseNo,
      houseType: house.houseType,
      area: house.area,
      rentMonthly: house.rentMonthly,
      deposit: house.deposit,
      status: house.status,
      externalBrowseUrl: house.externalBrowseUrl,
      houseConfig: parseHouseConfigItems(house.houseConfigJson),
      address: house.address,
      location: house.geoLat != null && house.geoLng != null ? { lat: house.geoLat, lng: house.geoLng } : null,
      nearbySubway: (() => {
        try {
          const parsed = JSON.parse(house.nearbySubwayJson ?? '[]')
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      })(),
      nearbySchools: (() => {
        try {
          const parsed = JSON.parse(house.nearbySchoolsJson ?? '[]')
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      })(),
      nearbyBusStops: (() => {
        try {
          const parsed = JSON.parse(house.nearbyBusStopsJson ?? '[]')
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      })(),
      images: (() => {
        try {
          const parsed = JSON.parse(house.houseImagesJson)
          return Array.isArray(parsed) ? parsed.map((x) => String(x)) : []
        } catch {
          return []
        }
      })(),
      viewingContact,
    })
  })

  /** H5 下单：身份证人像面/国徽面 OCR（Base64 data URL 或纯 base64） */
  app.post('/api/id-card/recognize', async (req, res) => {
    const Body = z.object({
      side: z.enum(['front', 'back']),
      image: z.string().min(80).max(12_000_000),
    })
    let body: z.infer<typeof Body>
    try {
      body = Body.parse(req.body ?? {})
    } catch {
      return res.status(400).json({ error: 'INVALID_BODY' })
    }
    try {
      const buf = decodeBase64ImagePayload(body.image)
      if (buf.length < 32) return res.status(400).json({ error: 'INVALID_IMAGE' })
      if (buf.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'IMAGE_TOO_LARGE' })
      const out = await recognizeIdCardSide(buf, body.side)
      res.json({ ok: true, ...out })
    } catch (e) {
      console.error('[id-card/recognize]', e)
      res.status(500).json({ error: 'OCR_FAILED' })
    }
  })

  app.post('/api/orders', async (req, res) => {
    const Body = z.object({
      houseId: z.string().min(1),
      leaseMonths: z.number().int().min(1).max(36).optional(),
      moveInDate: z.string().min(8).optional(),
      name: z.string().min(1),
      idNumber: z.string().min(1),
      phone: z.string().min(6),
      wechat: z.string().optional(),
      emergencyContactName: z.string().max(80).optional(),
      emergencyContactPhone: z.string().max(40).optional(),
      idDocType: z.enum(['IDCARD', 'PASSPORT', 'HKM_TW_PERMIT', 'USCC']).optional(),
      idCardLongTerm: z.boolean().optional(),
      idCardValidUntil: z.string().optional(),
      /** 护照 / 港澳台通行证 可选「有效期至」YYYY-MM-DD */
      docValidUntil: z.string().optional(),
    })
    const body = Body.parse(req.body)
    const idDocType: IdDocType = normalizeIdDocType(body.idDocType)

    const house = await ctx.prisma.house.findUnique({
      where: { id: body.houseId },
      include: { apartment: true },
    })
    if (!house) return res.status(404).json({ error: 'HOUSE_NOT_FOUND' })
    if (!house.isPublished) return res.status(409).json({ error: 'HOUSE_NOT_PUBLISHED' })
    const isBowanApartment = house.apartment.assetType === '泊湾公寓'
    let leaseMonths = body.leaseMonths
    let moveInDateStr = body.moveInDate
    if (isBowanApartment) {
      if (leaseMonths == null || moveInDateStr == null || String(moveInDateStr).trim() === '') {
        return res.status(400).json({ error: 'LEASE_MOVEIN_REQUIRED' })
      }
    } else {
      if (leaseMonths == null) leaseMonths = 12
      if (moveInDateStr == null || String(moveInDateStr).trim() === '') {
        moveInDateStr = new Date().toISOString().slice(0, 10)
      }
    }
    if (house.rentMonthly <= 0) return res.status(409).json({ error: 'HOUSE_RENT_NOT_CONFIGURED' })
    const houseImgs = (() => {
      try {
        const parsed = JSON.parse(house.houseImagesJson)
        return Array.isArray(parsed) ? parsed.map((x) => String(x)) : []
      } catch {
        return []
      }
    })()
    if (houseImgs.length === 0) return res.status(409).json({ error: 'HOUSE_IMAGES_NOT_CONFIGURED' })
    if (house.status !== 'VACANT') return res.status(409).json({ error: 'HOUSE_NOT_VACANT' })
    const activeLease = await ctx.prisma.contract.findFirst({
      where: { houseId: house.id, status: 'ACTIVE' },
      select: { id: true },
    })
    if (activeLease) return res.status(409).json({ error: 'HOUSE_HAS_ACTIVE_CONTRACT' })

    const idErr = validateIdNumberForDocType(idDocType, body.idNumber)
    if (idErr) return res.status(400).json({ error: idErr })

    const docUntilErr = optionalDocValidUntilOk(body.docValidUntil)
    if (docUntilErr) return res.status(400).json({ error: docUntilErr })

    let longTerm = false
    let idCardValidUntilDate: Date | null = null

    if (idDocType === 'IDCARD') {
      longTerm = body.idCardLongTerm === true
      if (!longTerm) {
        const vu = (body.idCardValidUntil ?? '').trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(vu)) {
          return res.status(400).json({ error: 'ID_CARD_VALID_UNTIL_REQUIRED' })
        }
        idCardValidUntilDate = new Date(`${vu}T12:00:00.000Z`)
      }
    } else {
      const dv = (body.docValidUntil ?? '').trim()
      if (dv && /^\d{4}-\d{2}-\d{2}$/.test(dv)) {
        idCardValidUntilDate = new Date(`${dv}T12:00:00.000Z`)
      }
    }

    const idStored =
      idDocType === 'PASSPORT' || idDocType === 'HKM_TW_PERMIT'
        ? body.idNumber.trim()
        : body.idNumber.trim().toUpperCase()

    const emergencyName = (body.emergencyContactName ?? '').trim() || null
    const emergencyPhone = (body.emergencyContactPhone ?? '').trim() || null

    const tenant = await ctx.prisma.tenant.create({
      data: {
        name: body.name.trim(),
        idNumber: idStored,
        phone: body.phone.trim(),
        wechat: body.wechat,
        emergencyContactName: emergencyName,
        emergencyContactPhone: emergencyPhone,
        idDocType,
        idCardLongTerm: idDocType === 'IDCARD' ? longTerm : false,
        idCardValidUntil: idDocType === 'IDCARD' && longTerm ? null : idCardValidUntilDate,
        tenantKind: idDocType === 'USCC' ? 'ENTERPRISE' : 'INDIVIDUAL',
        createdSource: 'MOBILE_SELF',
      },
    })
    await insertTenantProfileLog(ctx.prisma, {
      tenantId: tenant.id,
      actionLabel: '档案入档',
      detail: `租客自主（移动端下单，${idDocType === 'USCC' ? '企业' : '个人'}）`,
      operatorKind: 'TENANT',
    })

    const order = await ctx.prisma.order.create({
      data: {
        houseId: house.id,
        tenantId: tenant.id,
        leaseMonths,
        moveInDate: new Date(moveInDateStr),
        status: 'PENDING_REVIEW',
      },
      include: { house: { include: { apartment: { include: { store: true } } } } },
    })

    await ctx.prisma.house.update({
      where: { id: house.id },
      data: { status: 'ORDERED' },
    })

    res.json({
      id: order.id,
      status: order.status,
      house: {
        id: order.house.id,
        apartmentName: order.house.apartment.name,
        storeName: order.house.apartment.store.name,
        houseNo: order.house.houseNo,
      },
      storeWecomQrUrl: order.house.apartment.store.wecomQrUrl ?? null,
      tenantPhone: tenant.phone,
      tips: '已提交订单，等待店长审核。',
    })
  })

  /**
   * H5 购物车结算：多房源一次实名，支持「一资产一合同」或「多资产一单合并合同」。
   * - ONE_PER_ASSET：为每个房源各建订单（同一租客），各自后续配合同。
   * - MERGED：一单多 OrderLine，店长配置合同时月租须等于各子资产月租快照之和；账单租金行带 breakdown。
   */
  app.post('/api/orders/checkout', async (req, res) => {
    const Line = z.object({
      houseId: z.string().min(1),
      leaseMonths: z.number().int().min(1).max(36),
      moveInDate: z.string().min(8),
    })
    const Body = z.object({
      contractMode: z.enum(['ONE_PER_ASSET', 'MERGED']),
      lines: z.array(Line).min(1).max(15),
      name: z.string().min(1),
      idNumber: z.string().min(1),
      phone: z.string().min(6),
      wechat: z.string().optional(),
      emergencyContactName: z.string().max(80).optional(),
      emergencyContactPhone: z.string().max(40).optional(),
      idDocType: z.enum(['IDCARD', 'PASSPORT', 'HKM_TW_PERMIT', 'USCC']).optional(),
      idCardLongTerm: z.boolean().optional(),
      idCardValidUntil: z.string().optional(),
      docValidUntil: z.string().optional(),
    })
    const body = Body.parse(req.body)
    const idDocType: IdDocType = normalizeIdDocType(body.idDocType)

    const houseIds = body.lines.map((l) => l.houseId)
    if (new Set(houseIds).size !== houseIds.length) {
      return res.status(400).json({ error: 'DUPLICATE_HOUSE_IN_CHECKOUT' })
    }

    if (body.contractMode === 'MERGED') {
      const lm0 = body.lines[0].leaseMonths
      const d0 = String(body.lines[0].moveInDate).trim()
      for (const ln of body.lines) {
        if (ln.leaseMonths !== lm0 || String(ln.moveInDate).trim() !== d0) {
          return res.status(400).json({ error: 'MERGED_LEASE_MISMATCH' })
        }
      }
    }

    const idErr = validateIdNumberForDocType(idDocType, body.idNumber)
    if (idErr) return res.status(400).json({ error: idErr })

    const docUntilErr = optionalDocValidUntilOk(body.docValidUntil)
    if (docUntilErr) return res.status(400).json({ error: docUntilErr })

    let longTerm = false
    let idCardValidUntilDate: Date | null = null

    if (idDocType === 'IDCARD') {
      longTerm = body.idCardLongTerm === true
      if (!longTerm) {
        const vu = (body.idCardValidUntil ?? '').trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(vu)) {
          return res.status(400).json({ error: 'ID_CARD_VALID_UNTIL_REQUIRED' })
        }
        idCardValidUntilDate = new Date(`${vu}T12:00:00.000Z`)
      }
    } else {
      const dv = (body.docValidUntil ?? '').trim()
      if (dv && /^\d{4}-\d{2}-\d{2}$/.test(dv)) {
        idCardValidUntilDate = new Date(`${dv}T12:00:00.000Z`)
      }
    }

    const idStored =
      idDocType === 'PASSPORT' || idDocType === 'HKM_TW_PERMIT'
        ? body.idNumber.trim()
        : body.idNumber.trim().toUpperCase()

    type HouseCheckoutLoaded = Prisma.HouseGetPayload<{
      include: { apartment: { include: { store: true } } }
    }>
    const loaded: HouseCheckoutLoaded[] = []
    for (const ln of body.lines) {
      const house = await ctx.prisma.house.findUnique({
        where: { id: ln.houseId },
        include: { apartment: { include: { store: true } } },
      })
      if (!house) return res.status(404).json({ error: 'HOUSE_NOT_FOUND' })
      if (!house.isPublished) return res.status(409).json({ error: 'HOUSE_NOT_PUBLISHED' })
      const isBowanApartment = house.apartment.assetType === '泊湾公寓'
      let leaseMonths = ln.leaseMonths
      let moveInDateStr = ln.moveInDate
      if (isBowanApartment) {
        if (leaseMonths == null || moveInDateStr == null || String(moveInDateStr).trim() === '') {
          return res.status(400).json({ error: 'LEASE_MOVEIN_REQUIRED' })
        }
      } else {
        if (leaseMonths == null) leaseMonths = 12
        if (moveInDateStr == null || String(moveInDateStr).trim() === '') {
          moveInDateStr = new Date().toISOString().slice(0, 10)
        }
      }
      if (house.rentMonthly <= 0) return res.status(409).json({ error: 'HOUSE_RENT_NOT_CONFIGURED' })
      const houseImgs = (() => {
        try {
          const parsed = JSON.parse(house.houseImagesJson)
          return Array.isArray(parsed) ? parsed.map((x) => String(x)) : []
        } catch {
          return []
        }
      })()
      if (houseImgs.length === 0) return res.status(409).json({ error: 'HOUSE_IMAGES_NOT_CONFIGURED' })
      if (house.status !== 'VACANT') return res.status(409).json({ error: 'HOUSE_NOT_VACANT' })
      const activeLease = await ctx.prisma.contract.findFirst({
        where: { houseId: house.id, status: 'ACTIVE' },
        select: { id: true },
      })
      if (activeLease) return res.status(409).json({ error: 'HOUSE_HAS_ACTIVE_CONTRACT' })
      loaded.push(house)
    }

    const hasBowan = loaded.some((h) => h.apartment.assetType === '泊湾公寓')
    const hasOther = loaded.some((h) => h.apartment.assetType !== '泊湾公寓')
    if (hasBowan && hasOther) {
      return res.status(400).json({ error: 'CART_MIXED_ASSET_LANE' })
    }

    const emergencyName = (body.emergencyContactName ?? '').trim() || null
    const emergencyPhone = (body.emergencyContactPhone ?? '').trim() || null

    const tenant = await ctx.prisma.tenant.create({
      data: {
        name: body.name.trim(),
        idNumber: idStored,
        phone: body.phone.trim(),
        wechat: body.wechat,
        emergencyContactName: emergencyName,
        emergencyContactPhone: emergencyPhone,
        idDocType,
        idCardLongTerm: idDocType === 'IDCARD' ? longTerm : false,
        idCardValidUntil: idDocType === 'IDCARD' && longTerm ? null : idCardValidUntilDate,
        tenantKind: idDocType === 'USCC' ? 'ENTERPRISE' : 'INDIVIDUAL',
        createdSource: 'MOBILE_SELF',
      },
    })
    await insertTenantProfileLog(ctx.prisma, {
      tenantId: tenant.id,
      actionLabel: '档案入档',
      detail: `租客自主（移动端下单，${idDocType === 'USCC' ? '企业' : '个人'}）`,
      operatorKind: 'TENANT',
    })

    if (body.contractMode === 'ONE_PER_ASSET') {
      const ordersOut: {
        id: string
        status: string
        house: { id: string; apartmentName: string; storeName: string; houseNo: string }
      }[] = []
      for (let i = 0; i < body.lines.length; i += 1) {
        const ln = body.lines[i]
        const house = loaded[i]
        const order = await ctx.prisma.order.create({
          data: {
            houseId: house.id,
            tenantId: tenant.id,
            leaseMonths: ln.leaseMonths,
            moveInDate: new Date(ln.moveInDate),
            status: 'PENDING_REVIEW',
            isMergedBundle: false,
          },
          include: { house: { include: { apartment: { include: { store: true } } } } },
        })
        await ctx.prisma.house.update({ where: { id: house.id }, data: { status: 'ORDERED' } })
        ordersOut.push({
          id: order.id,
          status: order.status,
          house: {
            id: order.house.id,
            apartmentName: order.house.apartment.name,
            storeName: order.house.apartment.store.name,
            houseNo: order.house.houseNo,
          },
        })
      }
      const sw = loaded[0].apartment.store.wecomQrUrl ?? null
      return res.json({
        contractMode: 'ONE_PER_ASSET',
        orders: ordersOut,
        tenantPhone: tenant.phone,
        storeWecomQrUrl: sw,
        tips: `已提交 ${ordersOut.length} 笔订单，等待店长审核。`,
      })
    }

    const ln0 = body.lines[0]
    const house0 = loaded[0]
    const order = await ctx.prisma.order.create({
      data: {
        houseId: house0.id,
        tenantId: tenant.id,
        leaseMonths: ln0.leaseMonths,
        moveInDate: new Date(ln0.moveInDate),
        status: 'PENDING_REVIEW',
        isMergedBundle: true,
      },
      include: { house: { include: { apartment: { include: { store: true } } } } },
    })
    for (let i = 0; i < body.lines.length; i += 1) {
      const h = loaded[i]
      await ctx.prisma.orderLine.create({
        data: {
          orderId: order.id,
          houseId: h.id,
          rentMonthlySnapshot: h.rentMonthly,
          depositSnapshot: h.deposit,
          sortOrder: i,
        },
      })
      await ctx.prisma.house.update({ where: { id: h.id }, data: { status: 'ORDERED' } })
    }

    return res.json({
      contractMode: 'MERGED',
      orders: [
        {
          id: order.id,
          status: order.status,
          house: {
            id: order.house.id,
            apartmentName: order.house.apartment.name,
            storeName: order.house.apartment.store.name,
            houseNo: `${order.house.apartment.name} 等 ${body.lines.length} 个资产`,
          },
        },
      ],
      tenantPhone: tenant.phone,
      storeWecomQrUrl: order.house.apartment.store.wecomQrUrl ?? null,
      tips: `已提交合并订单（${body.lines.length} 个资产），后续将签署同一份合同；请等待店长审核。`,
    })
  })

  // Tenant actions: provide phone as simple "identity" for MVP
  // 当前租客的合同列表（用于「确认订单」后跳转到合同页）
  app.get('/api/contracts', async (req, res) => {
    const phone = req.header('x-tenant-phone')
    if (!phone) return res.status(401).json({ error: 'NEED_TENANT_PHONE' })

    const contracts = await ctx.prisma.contract.findMany({
      where: { tenant: { phone } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        contractNo: true,
        status: true,
        orderId: true,
        tenantSignDeadlineAt: true,
        stampedAt: true,
        renewedFromId: true,
        moveOutPendingJson: true,
      },
    })
    res.json({
      items: contracts.map((c) => {
        let moveOutSignDeadlineAt: string | null = null
        if (c.status === 'WAIT_TENANT_MOVEOUT_SIGN' && c.moveOutPendingJson) {
          try {
            const p = JSON.parse(c.moveOutPendingJson) as { deadlineAt?: string }
            if (p.deadlineAt) moveOutSignDeadlineAt = p.deadlineAt
          } catch {
            /* ignore */
          }
        }
        return {
          id: c.id,
          contractNo: c.contractNo,
          status: c.status,
          orderId: c.orderId,
          tenantSignDeadlineAt: c.tenantSignDeadlineAt ? c.tenantSignDeadlineAt.toISOString() : null,
          stampedAt: c.stampedAt ? c.stampedAt.toISOString() : null,
          renewedFromId: c.renewedFromId,
          moveOutSignDeadlineAt,
        }
      }),
    })
  })

  app.get('/api/contracts/:id', async (req, res) => {
    const phone = req.header('x-tenant-phone')
    if (!phone) return res.status(401).json({ error: 'NEED_TENANT_PHONE' })

    const cid = String(req.params.id)
    await expireTenantMoveOutIfNeeded(ctx.prisma, cid)

    const contract = await ctx.prisma.contract.findUnique({
      where: { id: cid },
      include: {
        tenant: true,
        house: { include: { apartment: { include: { store: true } } } },
        payments: true,
        bills: { orderBy: { period: 'asc' } },
        housingReport: true,
      },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (contract.tenant.phone !== phone) return res.status(403).json({ error: 'FORBIDDEN' })

    let moveOutSignDeadlineAt: string | null = null
    let moveOutPending: {
      deadlineAt: string
      reasonFull: string
      terminateDate: string
      partial: boolean
      attachments: { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }[]
    } | null = null
    if (contract.status === 'WAIT_TENANT_MOVEOUT_SIGN' && contract.moveOutPendingJson) {
      try {
        const p = JSON.parse(contract.moveOutPendingJson) as MoveOutPendingPayload
        moveOutSignDeadlineAt = p.deadlineAt
        moveOutPending = {
          deadlineAt: p.deadlineAt,
          reasonFull: p.reasonFull,
          terminateDate: p.terminateDate,
          partial: Boolean(p.partial),
          attachments: (p.attachments ?? []).map((a) => ({
            id: a.id,
            name: a.name,
            file: a.file,
            previewUrl: `/api/contracts/${contract.id}/move-out-file/${encodeURIComponent(a.file)}`,
            downloadUrl: `/api/contracts/${contract.id}/move-out-file/${encodeURIComponent(a.file)}?download=1`,
          })),
        }
      } catch {
        moveOutPending = null
      }
    }

    res.json({
      id: contract.id,
      contractNo: contract.contractNo,
      status: contract.status,
      apartmentName: contract.house.apartment.name,
      storeName: contract.house.apartment.store.name,
      houseNo: contract.house.houseNo,
      tenant: { name: contract.tenant.name, phone: contract.tenant.phone },
      rentMonthly: contract.rentMonthly,
      deposit: contract.deposit,
      startDate: toYmd(contract.startDate),
      endDate: toYmd(contract.endDate),
      agreementSignDate: contract.agreementSignDate ? toYmd(contract.agreementSignDate) : null,
      confirmedAt: contract.confirmedAt ? contract.confirmedAt.toISOString() : null,
      signedAt: contract.signedAt ? contract.signedAt.toISOString() : null,
      stampedAt: contract.stampedAt ? contract.stampedAt.toISOString() : null,
      tenantSignDeadlineAt: contract.tenantSignDeadlineAt
        ? contract.tenantSignDeadlineAt.toISOString()
        : null,
      renewedFromId: contract.renewedFromId,
      moveOutSignDeadlineAt,
      moveOutPending,
      payment: contract.payments[0]
        ? {
            id: contract.payments[0].id,
            amount: contract.payments[0].amount,
            status: contract.payments[0].status,
            paidAt: contract.payments[0].paidAt ? contract.payments[0].paidAt.toISOString() : null,
          }
        : null,
      bills: contract.bills.map((b) => ({
        id: b.id,
        period: b.period,
        dueDate: toYmd(b.dueDate),
        totalAmount: b.totalAmount,
        status: b.status,
        paidAt: b.paidAt ? b.paidAt.toISOString() : null,
      })),
      housingReport: contract.housingReport
        ? {
            status: contract.housingReport.status,
            bureauRecordNo: contract.housingReport.bureauRecordNo,
            receiptPdfPath: contract.housingReport.receiptPdfPath,
            reportedAt: contract.housingReport.reportedAt
              ? contract.housingReport.reportedAt.toISOString()
              : null,
            lastError: contract.housingReport.lastError,
          }
        : null,
      modificationRequestedAt: contract.modificationRequestedAt ? contract.modificationRequestedAt.toISOString() : null,
      attachments: parseContractAttachmentsJson(contract.attachmentsJson),
    })
  })

  app.get('/api/contracts/:id/attachment/:fileKey', async (req, res) => {
    const phone = req.header('x-tenant-phone')
    if (!phone) return res.status(401).json({ error: 'NEED_TENANT_PHONE' })

    const fileKey = decodeURIComponent(String(req.params.fileKey))
    if (!/^[a-zA-Z0-9._-]+$/.test(fileKey)) return res.status(400).json({ error: 'BAD_KEY' })

    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: { tenant: true },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (contract.tenant.phone !== phone) return res.status(403).json({ error: 'FORBIDDEN' })

    const list = parseContractAttachmentsJson(contract.attachmentsJson)
    const att = list.find((a) => a.file === fileKey)
    if (!att) return res.status(404).json({ error: 'FILE_NOT_IN_CONTRACT' })

    const full = path.join(CONTRACT_UPLOAD_ROOT, contract.id, fileKey)
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'FILE_MISSING' })

    const { ext, mime } = mimeFromFileKey(fileKey)
    const lockPreview = contractAttachmentLockedUntilTenantPaid(contract.status)

    if (lockPreview && req.query.download === '1') {
      return res.status(403).json({ error: 'PAYMENT_REQUIRED_FOR_DOWNLOAD' })
    }

    if (
      lockPreview &&
      req.query.download !== '1' &&
      ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf'].includes(ext)
    ) {
      const raw = await readFile(full)
      const out = await applyContractPreviewWatermark(raw, ext)
      res.setHeader('Content-Type', mime)
      res.setHeader('Content-Disposition', 'inline')
      return res.send(out)
    }

    res.setHeader('Content-Type', mime)
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`)
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf'].includes(ext)) {
      res.setHeader('Content-Disposition', 'inline')
    }
    res.sendFile(path.resolve(full))
  })

  /** 租客下载/预览退租确认附件（仅待租客确认退租状态） */
  app.get('/api/contracts/:id/move-out-file/:fileKey', async (req, res) => {
    const phone = req.header('x-tenant-phone')
    if (!phone) return res.status(401).json({ error: 'NEED_TENANT_PHONE' })

    const fileKey = decodeURIComponent(String(req.params.fileKey))
    if (!/^[a-zA-Z0-9._-]+$/.test(fileKey)) return res.status(400).json({ error: 'BAD_KEY' })

    const cid = String(req.params.id)
    await expireTenantMoveOutIfNeeded(ctx.prisma, cid)

    const contract = await ctx.prisma.contract.findUnique({
      where: { id: cid },
      include: { tenant: true },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (contract.tenant.phone !== phone) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status !== 'WAIT_TENANT_MOVEOUT_SIGN' || !contract.moveOutPendingJson) {
      return res.status(409).json({ error: 'NO_MOVEOUT_PENDING' })
    }
    let pending: MoveOutPendingPayload
    try {
      pending = JSON.parse(contract.moveOutPendingJson) as MoveOutPendingPayload
    } catch {
      return res.status(409).json({ error: 'BAD_PENDING' })
    }
    const att = (pending.attachments ?? []).find((a) => a.file === fileKey)
    if (!att) return res.status(404).json({ error: 'FILE_NOT_IN_PENDING' })
    const full = path.join(MOVEOUT_UPLOAD_ROOT, contract.id, fileKey)
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'FILE_MISSING' })

    const { ext, mime } = mimeFromFileKey(fileKey)
    res.setHeader('Content-Type', mime)
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`)
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf'].includes(ext)) {
      res.setHeader('Content-Disposition', 'inline')
    }
    res.sendFile(path.resolve(full))
  })

  app.post('/api/contracts/:id/confirm', async (req, res) => {
    const phone = req.header('x-tenant-phone')
    if (!phone) return res.status(401).json({ error: 'NEED_TENANT_PHONE' })

    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: { tenant: true },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (contract.tenant.phone !== phone) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status !== 'WAIT_TENANT_SIGN') return res.status(409).json({ error: 'INVALID_STATUS' })

    const now = new Date()
    if (contract.tenantSignDeadlineAt && now.getTime() > contract.tenantSignDeadlineAt.getTime()) {
      return res.status(409).json({ error: 'TENANT_SIGN_DEADLINE_EXCEEDED' })
    }

    const updated = await ctx.prisma.contract.update({
      where: { id: contract.id },
      data: {
        confirmedAt: contract.confirmedAt ?? now,
        signedAt: contract.signedAt ?? now,
        status: 'WAIT_STAMP',
      },
    })
    res.json({ ok: true, confirmedAt: updated.confirmedAt?.toISOString() })
  })

  /** 租客确认退租（电子签字）：执行实际退租结案并清理退租附件 */
  app.post('/api/contracts/:id/confirm-move-out', async (req, res) => {
    const phone = req.header('x-tenant-phone')
    if (!phone) return res.status(401).json({ error: 'NEED_TENANT_PHONE' })

    const cid = String(req.params.id)
    await expireTenantMoveOutIfNeeded(ctx.prisma, cid)

    const contract = await ctx.prisma.contract.findUnique({
      where: { id: cid },
      include: {
        tenant: true,
        order: { include: { lines: { include: { house: true } } } },
      },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (contract.tenant.phone !== phone) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status !== 'WAIT_TENANT_MOVEOUT_SIGN' || !contract.moveOutPendingJson) {
      return res.status(409).json({ error: 'INVALID_STATUS' })
    }
    let pending: MoveOutPendingPayload
    try {
      pending = JSON.parse(contract.moveOutPendingJson) as MoveOutPendingPayload
    } catch {
      return res.status(409).json({ error: 'BAD_PENDING' })
    }
    const deadline = new Date(pending.deadlineAt)
    if (Number.isNaN(deadline.getTime()) || deadline.getTime() < Date.now()) {
      return res.status(409).json({ error: 'TENANT_MOVEOUT_DEADLINE_EXCEEDED' })
    }
    const moveAt = new Date(pending.terminateDate)
    const reasonText = pending.reasonFull

    try {
      const { result, attachments } = await ctx.prisma.$transaction(async (tx) => {
        const fresh = await tx.contract.findUnique({
          where: { id: cid },
          include: { order: { include: { lines: { include: { house: true } } } } },
        })
        if (!fresh || fresh.status !== 'WAIT_TENANT_MOVEOUT_SIGN' || !fresh.moveOutPendingJson) {
          throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' })
        }
        let p2: MoveOutPendingPayload
        try {
          p2 = JSON.parse(fresh.moveOutPendingJson) as MoveOutPendingPayload
        } catch {
          throw Object.assign(new Error('BAD_PENDING'), { code: 'BAD_PENDING' })
        }
        const result = await executeAdminContractTerminate(
          tx,
          {
            id: fresh.id,
            houseId: fresh.houseId,
            order: fresh.order
              ? {
                  id: fresh.order.id,
                  isMergedBundle: fresh.order.isMergedBundle,
                  lines: fresh.order.lines.map((l) => ({
                    houseId: l.houseId,
                    releasedAt: l.releasedAt,
                    rentMonthlySnapshot: l.rentMonthlySnapshot,
                    depositSnapshot: l.depositSnapshot,
                  })),
                }
              : null,
          },
          moveAt,
          reasonText,
          p2.releaseHouseIds ?? [],
        )
        return { result, attachments: p2.attachments ?? [] }
      })
      unlinkMoveOutFiles(cid, attachments)
      return res.json({ ok: true, ...result })
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code
      if (code === 'INVALID_RELEASE_HOUSE') return res.status(400).json({ error: 'INVALID_RELEASE_HOUSE' })
      if (code === 'CONFLICT') return res.status(409).json({ error: 'CONFLICT' })
      if (code === 'BAD_PENDING') return res.status(409).json({ error: 'BAD_PENDING' })
      if ((e as Error)?.message === 'NO_ACTIVE_LINES') return res.status(500).json({ error: 'NO_ACTIVE_LINES' })
      console.error(e)
      return res.status(500).json({ error: 'MOVEOUT_CONFIRM_FAILED' })
    }
  })

  // 租客申请修改合同信息（仅记录申请时间，管理员在后台看到后再处理）
  app.post('/api/contracts/:id/request-modification', async (req, res) => {
    const phone = req.header('x-tenant-phone')
    if (!phone) return res.status(401).json({ error: 'NEED_TENANT_PHONE' })

    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: { tenant: true },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (contract.tenant.phone !== phone) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status === 'VOID' || contract.status === 'TERMINATED') {
      return res.status(409).json({ error: 'CONTRACT_ALREADY_ENDED' })
    }
    if (contract.status === 'WAIT_TENANT_MOVEOUT_SIGN') {
      return res.status(409).json({ error: 'CONTRACT_MOVEOUT_PENDING' })
    }

    await ctx.prisma.contract.update({
      where: { id: contract.id },
      data: { modificationRequestedAt: new Date() },
    })
    res.json({ ok: true, message: '已提交修改申请，请等待管理员处理' })
  })

  app.post('/api/payments', async (req, res) => {
    const Body = z.object({
      contractId: z.string().min(1),
    })
    const body = Body.parse(req.body)

    const phone = req.header('x-tenant-phone')
    if (!phone) return res.status(401).json({ error: 'NEED_TENANT_PHONE' })

    const contract = await ctx.prisma.contract.findUnique({
      where: { id: body.contractId },
      include: { tenant: true, house: true, payments: true },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (contract.tenant.phone !== phone) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status !== 'PENDING_PAYMENT') return res.status(409).json({ error: 'INVALID_STATUS' })
    if (!contract.stampedAt) return res.status(409).json({ error: 'NOT_STAMPED_YET' })

    const unpaidBillsForChangeHouse =
      contract.changeHouseFromId != null
        ? await ctx.prisma.bill.count({
            where: { contractId: contract.id, status: { in: ['UNPAID', 'OVERDUE'] } },
          })
        : 0
    if (contract.changeHouseFromId && unpaidBillsForChangeHouse > 0) {
      return res.status(409).json({ error: 'CHANGE_HOUSE_NEED_BILLS_SETTLED' })
    }

    const stampEnd = new Date(contract.stampedAt.getTime() + 24 * MS_HOUR)
    const payDeadline =
      contract.renewedFromId && contract.tenantSignDeadlineAt
        ? new Date(
            Math.min(stampEnd.getTime(), contract.tenantSignDeadlineAt.getTime()),
          )
        : stampEnd
    if (Date.now() > payDeadline.getTime()) {
      return res.status(409).json({ error: 'PAYMENT_WINDOW_EXPIRED' })
    }

    let amount = contract.deposit + contract.rentMonthly
    if (contract.changeHouseFromId) {
      amount = contract.deposit
    }

    if (amount <= 0 && contract.changeHouseFromId) {
      await ctx.prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'ACTIVE', signedAt: new Date() },
      })
      await ctx.prisma.house.update({
        where: { id: contract.houseId },
        data: { status: 'SIGNED' },
      })
      await ensureHousingReportRecord(ctx.prisma, contract.id)
      return res.json({ ok: true, amount: 0, contractStatus: 'ACTIVE' })
    }

    const payment =
      contract.payments[0] ??
      (await ctx.prisma.payment.create({
        data: { contractId: contract.id, amount, status: 'PENDING' },
      }))

    // MVP: mock pay success immediately
    await ctx.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'PAID', paidAt: new Date() },
    })

    await ctx.prisma.contract.update({
      where: { id: contract.id },
      data: { status: 'ACTIVE', signedAt: new Date() },
    })

    await ctx.prisma.house.update({
      where: { id: contract.houseId },
      data: { status: 'SIGNED' },
    })

    await ensureHousingReportRecord(ctx.prisma, contract.id)

    res.json({ ok: true, amount, contractStatus: 'ACTIVE' })
  })

  // Tenant bills (H5)
  app.post('/api/tenant/realname-verify', async (req, res) => {
    const Body = z.object({
      phone: z.string().min(6),
      name: z.string().min(1),
      idNumber: z.string().min(6),
    })
    const body = Body.parse(req.body)
    const normId = normalizeIdNumber(body.idNumber)
    const phone = body.phone.trim()
    const now = new Date()

    let tenant = await ctx.prisma.tenant.findFirst({ where: { phone } })
    const wasVerified = Boolean(tenant?.mobileVerifiedAt)
    if (tenant) {
      tenant = await ctx.prisma.tenant.update({
        where: { id: tenant.id },
        data: { name: body.name.trim(), idNumber: normId, mobileVerifiedAt: now },
      })
      if (!wasVerified) {
        await insertTenantProfileLog(ctx.prisma, {
          tenantId: tenant.id,
          actionLabel: '完成实名认证',
          detail: '移动端实名认证通过',
          operatorKind: 'TENANT',
          occurredAt: now,
        })
      }
    } else {
      tenant = await ctx.prisma.tenant.create({
        data: {
          name: body.name.trim(),
          phone,
          idNumber: normId,
          mobileVerifiedAt: now,
          tenantKind: 'INDIVIDUAL',
          createdSource: 'MOBILE_SELF',
        },
      })
      await insertTenantProfileLog(ctx.prisma, {
        tenantId: tenant.id,
        actionLabel: '档案入档',
        detail: '租客自主（移动端实名注册）',
        operatorKind: 'TENANT',
        occurredAt: now,
      })
      await insertTenantProfileLog(ctx.prisma, {
        tenantId: tenant.id,
        actionLabel: '完成实名认证',
        detail: '移动端实名认证通过',
        operatorKind: 'TENANT',
        occurredAt: now,
      })
    }

    await retryBillPushForIdNumber(ctx.prisma, normId)
    res.json({ ok: true, tenantId: tenant.id, mobileVerifiedAt: now.toISOString() })
  })

  app.get('/api/bills', async (req, res) => {
    const phone = req.header('x-tenant-phone')
    if (!phone) return res.status(401).json({ error: 'NEED_TENANT_PHONE' })

    const bills = await ctx.prisma.bill.findMany({
      where: await mobileBillsWhere(ctx.prisma, phone),
      include: {
        contract: {
          include: {
            tenant: true,
            house: { include: { apartment: { include: { store: true } } } },
            order: {
              include: {
                lines: {
                  orderBy: { sortOrder: 'asc' },
                  include: { house: { include: { apartment: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { dueDate: 'desc' },
      take: 200,
    })

    const unpaidRows: BillPayOrderRow[] = bills
      .filter((b) => b.status === 'UNPAID' || b.status === 'OVERDUE')
      .map((b) => ({
        id: b.id,
        contractId: b.contractId,
        period: b.period,
        dueDate: b.dueDate,
        kind: b.kind,
        createdAt: b.createdAt,
        status: b.status,
        amountReceived: b.amountReceived,
        totalAmount: b.totalAmount,
      }))

    res.json({
      items: bills.map((b) => {
        const mergedUnits = mergedUnitsFromContract(b.contract)
        const row: BillPayOrderRow = {
          id: b.id,
          contractId: b.contractId,
          period: b.period,
          dueDate: b.dueDate,
          kind: b.kind,
          createdAt: b.createdAt,
          status: b.status,
          amountReceived: b.amountReceived,
          totalAmount: b.totalAmount,
        }
        const queue = unpaidBillsQueueForContract(unpaidRows, b.contractId)
        const payBlockedReason = payBlockedReasonForBill(queue, row)
        return {
          id: b.id,
          period: b.period,
          dueDate: toYmd(b.dueDate),
          totalAmount: b.totalAmount,
          amountReceived: b.amountReceived,
          amountRemaining: Math.max(0, b.totalAmount - b.amountReceived),
          status: b.status,
          kind: b.kind,
          contractId: b.contractId,
          contractNo: b.contract.contractNo,
          apartmentName: b.contract.house.apartment.name,
          houseNo: b.contract.house.houseNo,
          storeName: b.contract.house.apartment.store.name,
          ...(mergedUnits ? { mergedUnits } : {}),
          ...(payBlockedReason ? { payBlockedReason } : {}),
        }
      }),
    })
  })

  app.get('/api/bills/:id', async (req, res) => {
    const phone = req.header('x-tenant-phone')
    if (!phone) return res.status(401).json({ error: 'NEED_TENANT_PHONE' })

    const bill = await ctx.prisma.bill.findUnique({
      where: { id: String(req.params.id) },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        contract: {
          include: {
            tenant: true,
            house: { include: { apartment: { include: { store: true } } } },
            order: {
              include: {
                lines: {
                  orderBy: { sortOrder: 'asc' },
                  include: { house: { include: { apartment: true } } },
                },
              },
            },
          },
        },
      },
    })
    if (!bill) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!(await tenantCanAccessBill(ctx.prisma, phone, bill))) return res.status(403).json({ error: 'FORBIDDEN' })

    const mergedUnits = mergedUnitsFromContract(bill.contract)
    const unpaidOnContract = await ctx.prisma.bill.findMany({
      where: {
        contractId: bill.contractId,
        status: { in: ['UNPAID', 'OVERDUE'] },
      },
      select: {
        id: true,
        contractId: true,
        period: true,
        dueDate: true,
        kind: true,
        createdAt: true,
        status: true,
        amountReceived: true,
        totalAmount: true,
      },
    })
    const queue = unpaidBillsQueueForContract(unpaidOnContract, bill.contractId)
    const payRow: BillPayOrderRow = {
      id: bill.id,
      contractId: bill.contractId,
      period: bill.period,
      dueDate: bill.dueDate,
      kind: bill.kind,
      createdAt: bill.createdAt,
      status: bill.status,
      amountReceived: bill.amountReceived,
      totalAmount: bill.totalAmount,
    }
    const payBlockedReason = payBlockedReasonForBill(queue, payRow)
    res.json({
      id: bill.id,
      period: bill.period,
      dueDate: toYmd(bill.dueDate),
      totalAmount: bill.totalAmount,
      amountReceived: bill.amountReceived,
      amountRemaining: Math.max(0, bill.totalAmount - bill.amountReceived),
      status: bill.status,
      kind: bill.kind,
      paidAt: bill.paidAt ? bill.paidAt.toISOString() : null,
      contractId: bill.contractId,
      contractNo: bill.contract.contractNo,
      apartmentName: bill.contract.house.apartment.name,
      houseNo: bill.contract.house.houseNo,
      storeName: bill.contract.house.apartment.store.name,
      tenantName: bill.contract.tenant.name,
      tenantPhone: bill.contract.tenant.phone,
      createdAt: bill.createdAt.toISOString(),
      ...(mergedUnits ? { mergedUnits } : {}),
      ...(payBlockedReason ? { payBlockedReason } : {}),
      items: billItemsToApi(bill.items),
    })
  })

  app.post('/api/bills/:id/pay', async (req, res) => {
    const phone = req.header('x-tenant-phone')
    if (!phone) return res.status(401).json({ error: 'NEED_TENANT_PHONE' })

    const bill = await ctx.prisma.bill.findUnique({
      where: { id: String(req.params.id) },
      include: {
        contract: {
          include: {
            tenant: true,
          },
        },
      },
    })
    if (!bill) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!(await tenantCanAccessBill(ctx.prisma, phone, bill))) return res.status(403).json({ error: 'FORBIDDEN' })
    if (bill.status !== 'UNPAID' && bill.status !== 'OVERDUE') {
      return res.status(409).json({ error: 'INVALID_STATUS' })
    }
    if (bill.amountReceived > 0 && bill.amountReceived < bill.totalAmount) {
      return res.status(409).json({
        error: 'PARTIAL_PAID_OFFLINE',
        message: '该账单已有线下部分收款，剩余金额请继续由门店线下核销或联系管理员处理。',
      })
    }

    const unpaidOnContract = await ctx.prisma.bill.findMany({
      where: {
        contractId: bill.contractId,
        status: { in: ['UNPAID', 'OVERDUE'] },
      },
      select: {
        id: true,
        contractId: true,
        period: true,
        dueDate: true,
        kind: true,
        createdAt: true,
        status: true,
        amountReceived: true,
        totalAmount: true,
      },
    })
    const payOrderCheck = assertBillsPayableInOrder(unpaidOnContract, [bill.id])
    if (!payOrderCheck.ok) {
      return res.status(409).json({ error: payOrderCheck.error, message: payOrderCheck.message })
    }

    const updated = await ctx.prisma.bill.update({
      where: { id: bill.id },
      data: { status: 'PAID', paidAt: new Date(), amountReceived: bill.totalAmount },
    })

    res.json({
      ok: true,
      paidAt: updated.paidAt?.toISOString() ?? null,
      status: updated.status,
    })
  })

  /** 租客合并支付多笔账单：每笔须整单结清，此处原子更新多笔为已付 */
  app.post('/api/bills/pay-batch', async (req, res) => {
    const phone = req.header('x-tenant-phone')
    if (!phone) return res.status(401).json({ error: 'NEED_TENANT_PHONE' })

    const Body = z.object({ billIds: z.array(z.string().min(1)).min(1).max(40) })
    const body = Body.parse(req.body)
    const uniq = [...new Set(body.billIds)]

    const bills = await ctx.prisma.bill.findMany({
      where: { id: { in: uniq } },
      include: {
        contract: {
          include: { tenant: true },
        },
      },
    })
    if (bills.length !== uniq.length) return res.status(400).json({ error: 'NOT_FOUND' })

    for (const b of bills) {
      if (!(await tenantCanAccessBill(ctx.prisma, phone, b))) return res.status(403).json({ error: 'FORBIDDEN' })
      if (b.status !== 'UNPAID' && b.status !== 'OVERDUE') {
        return res.status(409).json({ error: 'INVALID_STATUS', billId: b.id })
      }
      if (b.amountReceived > 0 && b.amountReceived < b.totalAmount) {
        return res.status(409).json({
          error: 'PARTIAL_PAID_OFFLINE',
          billId: b.id,
          message: '存在已线下部分收款的账单，无法在线合并支付，请联系门店处理。',
        })
      }
    }

    const contractIds = [...new Set(bills.map((b) => b.contractId))]
    const unpaidForContracts = await ctx.prisma.bill.findMany({
      where: {
        contractId: { in: contractIds },
        status: { in: ['UNPAID', 'OVERDUE'] },
      },
      select: {
        id: true,
        contractId: true,
        period: true,
        dueDate: true,
        kind: true,
        createdAt: true,
        status: true,
        amountReceived: true,
        totalAmount: true,
      },
    })
    const payOrderCheck = assertBillsPayableInOrder(unpaidForContracts, uniq)
    if (!payOrderCheck.ok) {
      return res.status(409).json({ error: payOrderCheck.error, message: payOrderCheck.message })
    }

    const paidAt = new Date()
    await ctx.prisma.$transaction(
      uniq.map((id) => {
        const b = bills.find((x) => x.id === id)
        return ctx.prisma.bill.update({
          where: { id },
          data: { status: 'PAID', paidAt, amountReceived: b?.totalAmount ?? 0 },
        })
      }),
    )

    const totalAmount = bills.reduce((s, b) => s + b.totalAmount, 0)
    res.json({
      ok: true,
      paidCount: bills.length,
      totalAmount,
      paidAt: paidAt.toISOString(),
    })
  })

  // ---------- Admin ----------
  app.post('/api/admin/login', async (req, res) => {
    const Body = z.object({ email: z.string().email(), password: z.string().min(1) })
    const body = Body.parse(req.body)

    const admin = await ctx.prisma.admin.findUnique({ where: { email: body.email } })
    if (!admin) return res.status(401).json({ error: 'INVALID_CREDENTIALS' })
    const ok = await bcrypt.compare(body.password, admin.passwordHash)
    if (!ok) return res.status(401).json({ error: 'INVALID_CREDENTIALS' })

    const token = signAdminToken({ adminId: admin.id })
    res.json({
      token,
      admin: { id: admin.id, name: admin.name, email: admin.email, roleCode: admin.roleCode },
    })
  })

  app.get('/api/admin/me', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    res.json({
      id: auth.admin.id,
      name: auth.admin.name,
      email: auth.admin.email,
      roleCode: auth.admin.roleCode,
      storeIds: auth.storeIds,
    })
  })

  // ---------- Admin: 租客档案（产生过订单/合同的租客，或后台代建档案）----------
  app.get('/api/admin/tenants', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const forContractSelect = req.query.forContractSelect === '1'
    const where = tenantProfilesWhere(auth)
    if ('id' in where && where.id === '__none__') return res.json({ items: [] })

    const rows = await ctx.prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        _count: { select: { orders: true, contracts: true } },
        createdByAdmin: { select: { name: true } },
      },
    })

    res.json({
      items: rows.map((t) => mapTenantProfileRow(t, forContractSelect)),
    })
  })

  app.post('/api/admin/tenants', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      tenantKind: z.enum(['INDIVIDUAL', 'ENTERPRISE']),
      name: z.string().min(1),
      phone: z.string().min(6),
      idNumber: z.string().min(6),
      wechat: z.union([z.string(), z.null()]).optional(),
    })
    const body = Body.parse(req.body)

    const idDocType = body.tenantKind === 'ENTERPRISE' ? 'USCC' : 'IDCARD'
    const idStored =
      body.tenantKind === 'ENTERPRISE'
        ? body.idNumber.trim().toUpperCase()
        : normalizeIdNumber(body.idNumber)

    if (body.tenantKind === 'ENTERPRISE' && !isUscc18(idStored)) {
      return res.status(400).json({ error: 'INVALID_USCC' })
    }
    if (body.tenantKind === 'INDIVIDUAL' && !isMainland18Id(idStored)) {
      return res.status(400).json({ error: 'INVALID_ID_NUMBER' })
    }

    const dup = await ctx.prisma.tenant.findFirst({ where: { phone: body.phone.trim() } })
    if (dup) return res.status(409).json({ error: 'PHONE_ALREADY_EXISTS' })

    const created = await ctx.prisma.tenant.create({
      data: {
        name: body.name.trim(),
        phone: body.phone.trim(),
        idNumber: idStored,
        idDocType,
        wechat: body.wechat?.trim() ? body.wechat.trim() : null,
        tenantKind: body.tenantKind,
        createdSource: 'ADMIN',
        createdByAdminId: auth.admin.id,
      },
      include: {
        _count: { select: { orders: true, contracts: true } },
        createdByAdmin: { select: { name: true } },
      },
    })

    await insertTenantProfileLog(ctx.prisma, {
      tenantId: created.id,
      actionLabel: '档案入档',
      detail: `后台代建${body.tenantKind === 'ENTERPRISE' ? '企业' : '个人'}档案`,
      operatorKind: 'ADMIN',
      admin: auth.admin,
    })

    res.json({ ok: true, item: mapTenantProfileRow(created, false) })
  })

  app.get('/api/admin/tenants/:id/operation-logs', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const id = String(req.params.id ?? '')
    const scoped: Prisma.TenantWhereInput = { AND: [{ id }, tenantProfilesWhere(auth)] }
    const tenant = await ctx.prisma.tenant.findFirst({
      where: scoped,
      include: { createdByAdmin: { select: { name: true, email: true } } },
    })
    if (!tenant) return res.status(404).json({ error: 'NOT_FOUND' })

    const dbLogs = await ctx.prisma.tenantProfileLog.findMany({
      where: { tenantId: tenant.id },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    })

    res.json({
      tenantName: maskPersonName(tenant.name),
      items: mergeTenantProfileLogs(tenant, dbLogs),
    })
  })

  app.patch('/api/admin/tenants/:id', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const id = String(req.params.id ?? '')
    const Body = z.object({ creditTier: z.enum(['A', 'B', 'C', 'D']) })
    const body = Body.parse(req.body)

    if (auth.admin.roleCode !== 'SYSTEM_ADMIN' && auth.storeIds.length === 0) {
      return res.status(403).json({ error: 'FORBIDDEN' })
    }

    const scoped: Prisma.TenantWhereInput = { AND: [{ id }, tenantProfilesWhere(auth)] }

    const found = await ctx.prisma.tenant.findFirst({ where: scoped })
    if (!found) return res.status(404).json({ error: 'NOT_FOUND' })

    const prevTier = found.creditTier
    const updated = await ctx.prisma.tenant.update({
      where: { id: found.id },
      data: { creditTier: body.creditTier as TenantCreditTier },
      include: {
        _count: { select: { orders: true, contracts: true } },
        createdByAdmin: { select: { name: true } },
      },
    })

    if (prevTier !== body.creditTier) {
      await insertTenantProfileLog(ctx.prisma, {
        tenantId: updated.id,
        actionLabel: '信誉度调整',
        detail: `${prevTier} → ${body.creditTier}`,
        operatorKind: 'ADMIN',
        admin: auth.admin,
      })
    }

    res.json({
      ok: true,
      item: mapTenantProfileRow(updated, false),
    })
  })

  // 修改当前登录管理员密码（需提供旧密码）
  app.post('/api/admin/me/change-password', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      oldPassword: z.string().min(1),
      newPassword: z.string().min(6).max(72),
    })
    const body = Body.parse(req.body)

    const admin = await ctx.prisma.admin.findUnique({ where: { id: auth.admin.id } })
    if (!admin) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const ok = await bcrypt.compare(body.oldPassword, admin.passwordHash)
    if (!ok) return res.status(409).json({ error: 'OLD_PASSWORD_INCORRECT' })

    const nextHash = await bcrypt.hash(body.newPassword, 10)
    await ctx.prisma.admin.update({
      where: { id: admin.id },
      data: { passwordHash: nextHash },
    })
    res.json({ ok: true })
  })

  app.get('/api/admin/stores', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const stores = await ctx.prisma.store.findMany({ orderBy: { createdAt: 'asc' } })
    const items = stores.filter((s) => canAccessStore(auth, s.id))
    res.json({ items })
  })

  // ---------- Admin: Departments（组织架构；门店级预约电话与企业微信二维码）----------
  app.get('/api/admin/departments', adminAuth(ctx.prisma), async (_req, res) => {
    const rows = await ctx.prisma.department.findMany({
      include: { store: { select: { id: true, name: true } } },
      orderBy: { code: 'asc' },
    })
    res.json({
      items: rows.map((d) => ({
        id: d.id,
        name: d.name,
        code: d.code,
        parentId: d.parentId,
        remark: d.remark,
        contactPhone: d.contactPhone,
        wecomQrUrl: d.wecomQrUrl,
        linkedStoreId: d.store?.id ?? null,
        linkedStoreName: d.store?.name ?? null,
      })),
    })
  })

  app.post('/api/admin/departments', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    if (!mustBeSystemAdmin(auth)) return res.status(403).json({ error: 'FORBIDDEN' })
    const Body = z.object({
      name: z.string().min(1),
      code: z.string().min(1),
      parentId: z.string().nullable().optional(),
      remark: z.string().optional(),
      contactPhone: z.string().nullable().optional(),
      wecomQrUrl: z.string().nullable().optional(),
      linkedStoreId: z.string().nullable().optional(),
    })
    const body = Body.parse(req.body)
    const codeDup = await ctx.prisma.department.findUnique({ where: { code: body.code } })
    if (codeDup) return res.status(409).json({ error: 'CODE_EXISTS' })
    if (body.linkedStoreId) {
      const st = await ctx.prisma.store.findUnique({ where: { id: body.linkedStoreId } })
      if (!st) return res.status(400).json({ error: 'STORE_NOT_FOUND' })
    }
    const created = await ctx.prisma.$transaction(async (tx) => {
      const d = await tx.department.create({
        data: {
          name: body.name,
          code: body.code,
          parentId: body.parentId ?? null,
          remark: body.remark ?? '',
          contactPhone: body.contactPhone ?? null,
          wecomQrUrl: body.wecomQrUrl ?? null,
        },
      })
      if (body.linkedStoreId) {
        await tx.store.updateMany({ where: { departmentId: d.id }, data: { departmentId: null } })
        await tx.store.update({
          where: { id: body.linkedStoreId },
          data: { departmentId: d.id },
        })
      }
      return d
    })
    const full = await ctx.prisma.department.findUnique({
      where: { id: created.id },
      include: { store: { select: { id: true, name: true } } },
    })
    res.json({
      item: {
        id: full!.id,
        name: full!.name,
        code: full!.code,
        parentId: full!.parentId,
        remark: full!.remark,
        contactPhone: full!.contactPhone,
        wecomQrUrl: full!.wecomQrUrl,
        linkedStoreId: full!.store?.id ?? null,
        linkedStoreName: full!.store?.name ?? null,
      },
    })
  })

  app.patch('/api/admin/departments/:id', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const id = String(req.params.id)
    const dept = await ctx.prisma.department.findUnique({
      where: { id },
      include: { store: { select: { id: true } } },
    })
    if (!dept) return res.status(404).json({ error: 'NOT_FOUND' })
    const isSys = mustBeSystemAdmin(auth)
    const isMgrOk = Boolean(dept.store?.id && canAccessStore(auth, dept.store.id))
    if (!isSys && !isMgrOk) return res.status(403).json({ error: 'FORBIDDEN' })

    const Body = z.object({
      name: z.string().min(1).optional(),
      code: z.string().min(1).optional(),
      parentId: z.string().nullable().optional(),
      remark: z.string().optional(),
      contactPhone: z.string().nullable().optional(),
      wecomQrUrl: z.string().nullable().optional(),
      linkedStoreId: z.string().nullable().optional(),
    })
    const body = Body.parse(req.body)

    if (!isSys) {
      if (
        body.name !== undefined ||
        body.code !== undefined ||
        body.parentId !== undefined ||
        body.linkedStoreId !== undefined
      ) {
        return res.status(403).json({ error: 'FORBIDDEN' })
      }
    }

    if (body.code !== undefined && body.code !== dept.code) {
      const exists = await ctx.prisma.department.findFirst({
        where: { code: body.code, id: { not: id } },
      })
      if (exists) return res.status(409).json({ error: 'CODE_EXISTS' })
    }

    if (body.linkedStoreId !== undefined && !isSys) {
      return res.status(403).json({ error: 'FORBIDDEN' })
    }

    if (body.linkedStoreId) {
      const st = await ctx.prisma.store.findUnique({ where: { id: body.linkedStoreId } })
      if (!st) return res.status(400).json({ error: 'STORE_NOT_FOUND' })
      if (!canAccessStore(auth, body.linkedStoreId)) return res.status(403).json({ error: 'FORBIDDEN' })
    }

    await ctx.prisma.$transaction(async (tx) => {
      await tx.department.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.code !== undefined ? { code: body.code } : {}),
          ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
          ...(body.remark !== undefined ? { remark: body.remark } : {}),
          ...(body.contactPhone !== undefined ? { contactPhone: body.contactPhone } : {}),
          ...(body.wecomQrUrl !== undefined ? { wecomQrUrl: body.wecomQrUrl } : {}),
        },
      })
      if (body.linkedStoreId !== undefined) {
        await tx.store.updateMany({ where: { departmentId: id }, data: { departmentId: null } })
        if (body.linkedStoreId) {
          await tx.store.update({
            where: { id: body.linkedStoreId },
            data: { departmentId: id },
          })
        }
      }
    })

    const full = await ctx.prisma.department.findUnique({
      where: { id },
      include: { store: { select: { id: true, name: true } } },
    })
    res.json({
      item: {
        id: full!.id,
        name: full!.name,
        code: full!.code,
        parentId: full!.parentId,
        remark: full!.remark,
        contactPhone: full!.contactPhone,
        wecomQrUrl: full!.wecomQrUrl,
        linkedStoreId: full!.store?.id ?? null,
        linkedStoreName: full!.store?.name ?? null,
      },
    })
  })

  app.post(
    '/api/admin/departments/:id/qr',
    adminAuth(ctx.prisma),
    upload.single('file'),
    async (req, res) => {
      const auth = getAdminAuth(req)
      const id = String(req.params.id)
      const dept = await ctx.prisma.department.findUnique({
        where: { id },
        include: { store: { select: { id: true } } },
      })
      if (!dept) return res.status(404).json({ error: 'NOT_FOUND' })
      const isSys = mustBeSystemAdmin(auth)
      const isMgrOk = Boolean(dept.store?.id && canAccessStore(auth, dept.store.id))
      if (!isSys && !isMgrOk) return res.status(403).json({ error: 'FORBIDDEN' })

      const file = req.file
      if (!file?.buffer) return res.status(400).json({ error: 'FILE_REQUIRED' })

      ensureDeptQrPublicDir()
      const ext =
        file.mimetype === 'image/png'
          ? '.png'
          : file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg'
            ? '.jpg'
            : file.mimetype === 'image/webp'
              ? '.webp'
              : null
      if (!ext) return res.status(400).json({ error: 'UNSUPPORTED_TYPE' })

      const fileName = `${randomBytes(18).toString('hex')}${ext}`
      const fp = path.join(DEPT_QR_PUBLIC_ROOT, fileName)
      fs.writeFileSync(fp, file.buffer)

      const publicPath = `/api/public/dept-qr/${fileName}`
      await ctx.prisma.department.update({
        where: { id },
        data: { wecomQrUrl: publicPath },
      })
      res.json({ ok: true, wecomQrUrl: publicPath })
    },
  )

  app.get('/api/admin/houses', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const houses = await ctx.prisma.house.findMany({
      include: { apartment: { include: { store: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    })
    const items = houses.filter((h) => canAccessStore(auth, h.apartment.storeId))
    res.json({
      items: items.map((h) => ({
        id: h.id,
        houseBizId: houseBizId(h.id),
        apartmentName: h.apartment.name,
        assetType: h.apartment.assetType,
        storeName: h.apartment.store.name,
        projectName: h.projectName,
        rentCollectionUnit: h.rentCollectionUnit,
        managerName: h.managerName,
        mgmtDepartment: h.mgmtDepartment,
        houseNo: h.houseNo,
        houseType: h.houseType,
        area: h.area,
        rentMonthly: h.rentMonthly,
        deposit: h.deposit,
        status: h.status,
        isPublished: h.isPublished,
        address: h.address,
        geoLat: h.geoLat,
        geoLng: h.geoLng,
        externalBrowseUrl: h.externalBrowseUrl,
        nearbySubway: (() => {
          try {
            const parsed = JSON.parse(h.nearbySubwayJson ?? '[]')
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        })(),
        nearbySchools: (() => {
          try {
            const parsed = JSON.parse(h.nearbySchoolsJson ?? '[]')
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        })(),
        nearbyBusStops: (() => {
          try {
            const parsed = JSON.parse(h.nearbyBusStopsJson ?? '[]')
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        })(),
        images: (() => {
          try {
            const parsed = JSON.parse(h.houseImagesJson)
            return Array.isArray(parsed) ? parsed.map((x) => String(x)) : []
          } catch {
            return []
          }
        })(),
        houseConfig: parseHouseConfigItems(h.houseConfigJson),
        waterMeterNos: parseMeterNoListJson(h.waterMeterNosJson),
        electricMeterNos: parseMeterNoListJson(h.electricMeterNosJson),
      })),
    })
  })

  app.get('/api/admin/houses/import-template', adminAuth(ctx.prisma), (_req, res) => {
    const buf = buildHouseImportTemplateBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('资产维护模板.xlsx')}`)
    res.send(buf)
  })

  app.post('/api/admin/houses/import', adminAuth(ctx.prisma), houseImportUpload.single('file'), async (req, res) => {
    const auth = getAdminAuth(req)
    const file = (req as any).file
    if (!file?.buffer) return res.status(400).json({ error: '请上传 Excel 文件', ok: true, updated: 0, errors: [] })
    const result = await parseAndImportHouses(ctx.prisma, file.buffer, (sid) => canAccessStore(auth, sid))
    res.json({ ok: true, ...result })
  })

  app.get('/api/admin/houses/:id/change-logs', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const house = await ctx.prisma.house.findUnique({
      where: { id: String(req.params.id) },
      include: { apartment: true },
    })
    if (!house) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })

    const logs = await ctx.prisma.houseChangeLog.findMany({
      where: { houseId: house.id },
      orderBy: { changedAt: 'desc' },
      take: 300,
    })
    res.json({
      items: logs.map((l) => ({
        id: l.id,
        fieldLabel: l.fieldLabel,
        beforeValue: l.beforeValue,
        afterValue: l.afterValue,
        changedAt: l.changedAt.toISOString(),
        operatorName: l.adminName ?? '—',
        operatorEmail: l.adminEmail ?? '—',
      })),
    })
  })

  // ---------- Admin: Houses config & publish ----------
  app.post('/api/admin/houses/:id/config', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      rentMonthly: z.number().int().min(0).optional(),
      images: z.array(z.string().min(1)).optional(),
      address: z.string().min(1).optional(),
      geoLat: z.number().optional().nullable(),
      geoLng: z.number().optional().nullable(),
      nearbySubway: z.array(z.any()).optional(),
      nearbySchools: z.array(z.any()).optional(),
      nearbyBusStops: z.array(z.any()).optional(),
      externalBrowseUrl: z.union([z.string().max(2048), z.literal(''), z.null()]).optional(),
      houseConfig: z
        .array(z.object({ label: z.string().min(1).max(80), on: z.boolean() }))
        .optional(),
      projectName: z.union([z.string().max(120), z.literal('')]).optional(),
      assetType: z.string().min(1).max(80).optional(),
      rentCollectionUnit: z.union([z.string().max(120), z.literal('')]).optional(),
      managerName: z.union([z.string().max(120), z.literal('')]).optional(),
      mgmtDepartment: z.union([z.string().max(120), z.literal('')]).optional(),
      waterMeterNos: z.array(z.string()).optional(),
      electricMeterNos: z.array(z.string()).optional(),
    })
    const body = Body.parse(req.body)

    const house = await ctx.prisma.house.findUnique({
      where: { id: String(req.params.id) },
      include: { apartment: { include: { store: true } } },
    })
    if (!house) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })

    let nextImages = undefined as string[] | undefined
    if (body.images !== undefined) nextImages = body.images

    const images = (() => {
      if (nextImages !== undefined) return nextImages
      try {
        const parsed = JSON.parse(house.houseImagesJson)
        return Array.isArray(parsed) ? parsed.map((x) => String(x)) : []
      } catch {
        return []
      }
    })()

    const rentMonthly = body.rentMonthly !== undefined ? body.rentMonthly : house.rentMonthly
    const deposit = body.rentMonthly !== undefined ? body.rentMonthly : house.deposit

    const address = body.address !== undefined ? body.address : house.address
    const geoLat = body.geoLat !== undefined ? body.geoLat : house.geoLat
    const geoLng = body.geoLng !== undefined ? body.geoLng : house.geoLng
    const nearbySubwayJson =
      body.nearbySubway !== undefined ? JSON.stringify(body.nearbySubway) : house.nearbySubwayJson
    const nearbySchoolsJson =
      body.nearbySchools !== undefined ? JSON.stringify(body.nearbySchools) : house.nearbySchoolsJson
    const nearbyBusStopsJson =
      body.nearbyBusStops !== undefined ? JSON.stringify(body.nearbyBusStops) : house.nearbyBusStopsJson

    const normOptUrl = (v: string | null | undefined) => {
      if (v === undefined) return undefined as string | null | undefined
      if (v === null) return null
      const s = String(v).trim()
      return s === '' ? null : s
    }
    const nextBrowse = normOptUrl(body.externalBrowseUrl)
    const urlHttpErr = (u: string | null | undefined): string | null => {
      if (u === undefined || u === null || u === '') return null
      try {
        const p = new URL(u)
        if (p.protocol !== 'http:' && p.protocol !== 'https:') return '须为以 http:// 或 https:// 开头的有效地址'
      } catch {
        return '须为以 http:// 或 https:// 开头的有效地址'
      }
      return null
    }
    if (nextBrowse !== undefined) {
      const e = urlHttpErr(nextBrowse)
      if (e) return res.status(400).json({ error: `「仅浏览」外链${e}` })
    }

    const normOptStr = (v: string | undefined): string | null | undefined => {
      if (v === undefined) return undefined
      const t = String(v).trim()
      return t === '' ? null : t
    }

    const nextWaterMeters = body.waterMeterNos !== undefined ? normalizeMeterNosInput(body.waterMeterNos) : undefined
    const nextElectricMeters = body.electricMeterNos !== undefined ? normalizeMeterNosInput(body.electricMeterNos) : undefined

    const updated = await ctx.prisma.house.update({
      where: { id: house.id },
      data: {
        rentMonthly,
        deposit,
        houseImagesJson: JSON.stringify(images),
        address,
        geoLat,
        geoLng,
        nearbySubwayJson,
        nearbySchoolsJson,
        nearbyBusStopsJson,
        ...(nextBrowse !== undefined ? { externalBrowseUrl: nextBrowse } : {}),
        ...(body.houseConfig !== undefined
          ? { houseConfigJson: serializeHouseConfigItems(body.houseConfig) }
          : {}),
        ...(body.projectName !== undefined ? { projectName: normOptStr(body.projectName) } : {}),
        ...(body.rentCollectionUnit !== undefined ? { rentCollectionUnit: normOptStr(body.rentCollectionUnit) } : {}),
        ...(body.managerName !== undefined ? { managerName: normOptStr(body.managerName) } : {}),
        ...(body.mgmtDepartment !== undefined ? { mgmtDepartment: normOptStr(body.mgmtDepartment) } : {}),
        ...(nextWaterMeters !== undefined ? { waterMeterNosJson: JSON.stringify(nextWaterMeters) } : {}),
        ...(nextElectricMeters !== undefined ? { electricMeterNosJson: JSON.stringify(nextElectricMeters) } : {}),
      },
    })

    if (body.assetType !== undefined) {
      await ctx.prisma.apartment.update({
        where: { id: house.apartmentId },
        data: { assetType: body.assetType.trim() },
      })
    }

    const afterImagesJson = JSON.stringify(images)
    const auditChanges: { fieldLabel: string; beforeValue: string; afterValue: string }[] = []
    const pushDiff = (label: string, before: unknown, after: unknown) => {
      const b = before === null || before === undefined ? '' : String(before)
      const a = after === null || after === undefined ? '' : String(after)
      if (b !== a) auditChanges.push({ fieldLabel: label, beforeValue: b, afterValue: a })
    }

    pushDiff('月租(元)', house.rentMonthly, updated.rentMonthly)
    pushDiff('押金(元)', house.deposit, updated.deposit)
    if (house.houseImagesJson !== afterImagesJson) {
      auditChanges.push({
        fieldLabel: '房源图片',
        beforeValue: `共 ${jsonArrayCount(house.houseImagesJson)} 张`,
        afterValue: `共 ${jsonArrayCount(afterImagesJson)} 张`,
      })
    }
    pushDiff('公寓地址', house.address ?? '', updated.address ?? '')
    pushDiff('纬度', house.geoLat ?? '', updated.geoLat ?? '')
    pushDiff('经度', house.geoLng ?? '', updated.geoLng ?? '')
    pushDiff('附近地铁', truncateLogValue(house.nearbySubwayJson), truncateLogValue(nearbySubwayJson))
    pushDiff('附近学校', truncateLogValue(house.nearbySchoolsJson), truncateLogValue(nearbySchoolsJson))
    pushDiff('附近公交', truncateLogValue(house.nearbyBusStopsJson), truncateLogValue(nearbyBusStopsJson))
    pushDiff('H5仅浏览外链', house.externalBrowseUrl ?? '', updated.externalBrowseUrl ?? '')
    pushDiff('房屋配置', truncateLogValue(house.houseConfigJson), truncateLogValue(updated.houseConfigJson))
    pushDiff('项目名称', house.projectName ?? '', updated.projectName ?? '')
    pushDiff('收租单位', house.rentCollectionUnit ?? '', updated.rentCollectionUnit ?? '')
    pushDiff('管理人', house.managerName ?? '', updated.managerName ?? '')
    pushDiff('管理部门', house.mgmtDepartment ?? '', updated.mgmtDepartment ?? '')
    if (nextWaterMeters !== undefined) {
      pushDiff('水表号', truncateLogValue(house.waterMeterNosJson), truncateLogValue(updated.waterMeterNosJson))
    }
    if (nextElectricMeters !== undefined) {
      pushDiff('电表号', truncateLogValue(house.electricMeterNosJson), truncateLogValue(updated.electricMeterNosJson))
    }

    const nextAssetType = body.assetType !== undefined ? body.assetType.trim() : house.apartment.assetType
    if (nextAssetType !== house.apartment.assetType) {
      auditChanges.push({ fieldLabel: '资产类型', beforeValue: house.apartment.assetType, afterValue: nextAssetType })
    }

    await insertHouseChangeLogs(ctx.prisma, { houseId: house.id, admin: auth.admin, changes: auditChanges })

    res.json({
      ok: true,
      id: updated.id,
      rentMonthly: updated.rentMonthly,
      deposit: updated.deposit,
      isPublished: updated.isPublished,
    })
  })

  app.post('/api/admin/houses/:id/publish', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const house = await ctx.prisma.house.findUnique({
      where: { id: String(req.params.id) },
      include: { apartment: { include: { store: true } } },
    })
    if (!house) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })

    let images: string[] = []
    try {
      const parsed = JSON.parse(house.houseImagesJson)
      images = Array.isArray(parsed) ? parsed.map((x) => String(x)) : []
    } catch {
      images = []
    }

    if (house.rentMonthly <= 0) return res.status(409).json({ error: 'RENT_NOT_CONFIGURED' })
    if (images.length === 0) return res.status(409).json({ error: 'IMAGES_NOT_CONFIGURED' })
    if (!(house.address && String(house.address).trim()))
      return res.status(409).json({ error: 'ADDRESS_NOT_CONFIGURED' })

    const updated = await ctx.prisma.house.update({
      where: { id: house.id },
      data: { isPublished: true },
    })

    if (!house.isPublished) {
      await insertHouseChangeLogs(ctx.prisma, {
        houseId: house.id,
        admin: auth.admin,
        changes: [{ fieldLabel: '上架状态', beforeValue: '未上架', afterValue: '已上架' }],
      })
    }

    res.json({ ok: true, id: updated.id, isPublished: updated.isPublished })
  })

  app.post('/api/admin/houses/:id/unpublish', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const house = await ctx.prisma.house.findUnique({
      where: { id: String(req.params.id) },
      include: { apartment: { include: { store: true } } },
    })
    if (!house) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })

    const updated = await ctx.prisma.house.update({
      where: { id: house.id },
      data: { isPublished: false },
    })

    if (house.isPublished) {
      await insertHouseChangeLogs(ctx.prisma, {
        houseId: house.id,
        admin: auth.admin,
        changes: [{ fieldLabel: '上架状态', beforeValue: '已上架', afterValue: '未上架' }],
      })
    }

    res.json({ ok: true, id: updated.id, isPublished: updated.isPublished })
  })

  app.get('/api/admin/orders', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const orders = await ctx.prisma.order.findMany({
      include: {
        tenant: true,
        house: { include: { apartment: { include: { store: true } } } },
        contract: true,
        lines: {
          include: { house: { include: { apartment: true } } },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    const items = orders.filter((o) => canAccessStore(auth, o.house.apartment.storeId))
    res.json({
      items: items.map((o) => ({
        id: o.id,
        orderNo: numericCodeFromId(o.id, 12),
        status: o.status,
        reviewReason: o.reviewReason,
        createdAt: o.createdAt.toISOString(),
        leaseMonths: o.leaseMonths,
        moveInDate: o.moveInDate.toISOString().slice(0, 10),
        isMergedBundle: o.isMergedBundle,
        bundleLineCount: o.lines.length,
        bundleRentMonthlySum:
          o.isMergedBundle && o.lines.length > 0
            ? o.lines.reduce((s, l) => s + l.rentMonthlySnapshot, 0)
            : o.house.rentMonthly,
        tenantId: o.tenantId,
        tenant: {
          name: o.tenant.name,
          phone: o.tenant.phone,
          wechat: o.tenant.wechat ?? null,
          idDocType: o.tenant.idDocType,
          idNumber: o.tenant.idNumber,
          idCardLongTerm: o.tenant.idCardLongTerm,
          idCardValidUntil: o.tenant.idCardValidUntil ? o.tenant.idCardValidUntil.toISOString().slice(0, 10) : null,
        },
        house: {
          id: o.house.id,
          houseBizId: houseBizId(o.house.id),
          storeName: o.house.apartment.store.name,
          projectName: o.house.projectName,
          rentCollectionUnit: o.house.rentCollectionUnit,
          managerName: o.house.managerName,
          apartmentName: o.house.apartment.name,
          houseNo: o.house.houseNo,
          rentMonthly: o.house.rentMonthly,
          deposit: o.house.deposit,
          assetType: o.house.apartment.assetType,
        },
        bundleLines:
          o.isMergedBundle && o.lines.length > 0
            ? o.lines.map((l) => ({
                houseId: l.houseId,
                houseBizId: houseBizId(l.houseId),
                apartmentName: l.house.apartment.name,
                houseNo: l.house.houseNo,
                rentMonthlySnapshot: l.rentMonthlySnapshot,
                depositSnapshot: l.depositSnapshot,
                releasedAt: l.releasedAt ? l.releasedAt.toISOString() : null,
              }))
            : null,
        contractId: o.contract?.id ?? null,
        contractStatus: o.contract?.status ?? null,
        contractModificationRequestedAt: o.contract?.modificationRequestedAt
          ? o.contract.modificationRequestedAt.toISOString()
          : null,
        contractModificationRejectedAt: o.contract?.modificationRejectedAt
          ? o.contract.modificationRejectedAt.toISOString()
          : null,
        contractConfirmedAt: o.contract?.confirmedAt ? o.contract.confirmedAt.toISOString() : null,
      })),
    })
  })

  app.get('/api/admin/orders/:id', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const order = await ctx.prisma.order.findUnique({
      where: { id: String(req.params.id) },
      include: {
        tenant: true,
        house: { include: { apartment: { include: { store: true } } } },
        contract: true,
        lines: {
          include: { house: { include: { apartment: true } } },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
    })
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, order.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    const o = order
    res.json({
      id: o.id,
      orderNo: numericCodeFromId(o.id, 12),
      status: o.status,
      reviewReason: o.reviewReason,
      createdAt: o.createdAt.toISOString(),
      leaseMonths: o.leaseMonths,
      moveInDate: o.moveInDate.toISOString().slice(0, 10),
      isMergedBundle: o.isMergedBundle,
      bundleLineCount: o.lines.length,
      bundleRentMonthlySum:
        o.isMergedBundle && o.lines.length > 0
          ? o.lines.reduce((s, l) => s + l.rentMonthlySnapshot, 0)
          : o.house.rentMonthly,
      tenantId: o.tenantId,
      tenant: {
        name: o.tenant.name,
        phone: o.tenant.phone,
        wechat: o.tenant.wechat ?? null,
        idDocType: o.tenant.idDocType,
        idNumber: o.tenant.idNumber,
        idCardLongTerm: o.tenant.idCardLongTerm,
        idCardValidUntil: o.tenant.idCardValidUntil ? o.tenant.idCardValidUntil.toISOString().slice(0, 10) : null,
      },
      house: {
        id: o.house.id,
        houseBizId: houseBizId(o.house.id),
        storeName: o.house.apartment.store.name,
        projectName: o.house.projectName,
        rentCollectionUnit: o.house.rentCollectionUnit,
        managerName: o.house.managerName,
        apartmentName: o.house.apartment.name,
        houseNo: o.house.houseNo,
        rentMonthly: o.house.rentMonthly,
        deposit: o.house.deposit,
        assetType: o.house.apartment.assetType,
      },
      bundleLines:
        o.isMergedBundle && o.lines.length > 0
          ? o.lines.map((l) => ({
              houseId: l.houseId,
              houseBizId: houseBizId(l.houseId),
              apartmentName: l.house.apartment.name,
              houseNo: l.house.houseNo,
              rentMonthlySnapshot: l.rentMonthlySnapshot,
              depositSnapshot: l.depositSnapshot,
              releasedAt: l.releasedAt ? l.releasedAt.toISOString() : null,
            }))
          : null,
      contractId: o.contract?.id ?? null,
      contractStatus: o.contract?.status ?? null,
      contractModificationRequestedAt: o.contract?.modificationRequestedAt
        ? o.contract.modificationRequestedAt.toISOString()
        : null,
      contractModificationRejectedAt: o.contract?.modificationRejectedAt
        ? o.contract.modificationRejectedAt.toISOString()
        : null,
      contractConfirmedAt: o.contract?.confirmedAt ? o.contract.confirmedAt.toISOString() : null,
    })
  })

  /**
   * 修改订单：租期（月）、入住日。租客已在 H5 确认合同后（contract.confirmedAt 有值）禁止修改；
   * 合同状态为已生效/已终止/已作废时亦禁止修改。
   * 若已生成合同且尚未确认，会同步更新合同起止日；待签字时顺带重算 tenantSignDeadlineAt。
   */
  app.patch('/api/admin/orders/:id', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      leaseMonths: z.number().int().min(1).max(36),
      moveInDate: z.string().min(8),
      tenantName: z.string().min(1).max(80).optional(),
      tenantPhone: z.string().min(6).max(20).optional(),
      tenantWechat: z.string().max(80).optional(),
    })
    const body = Body.parse(req.body)

    const order = await ctx.prisma.order.findUnique({
      where: { id: String(req.params.id) },
      include: { house: { include: { apartment: true } }, contract: true },
    })
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, order.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (order.status !== 'PENDING_REVIEW' && order.status !== 'APPROVED') {
      return res.status(409).json({ error: 'ORDER_NOT_EDITABLE_STATUS' })
    }
    if (order.contract?.confirmedAt) {
      return res.status(409).json({ error: 'TENANT_CONFIRMED_ORDER_LOCKED' })
    }
    if (
      order.contract?.status &&
      (order.contract.status === 'ACTIVE' ||
        order.contract.status === 'TERMINATED' ||
        order.contract.status === 'VOID')
    ) {
      return res.status(409).json({ error: 'CONTRACT_EFFECTIVE_ORDER_LOCKED' })
    }

    const moveIn = new Date(body.moveInDate)
    const endDate = addMonths(moveIn, body.leaseMonths)

    await ctx.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { leaseMonths: body.leaseMonths, moveInDate: moveIn },
      })
      const tenantData: { name?: string; phone?: string; wechat?: string | null } = {}
      if (body.tenantName !== undefined) tenantData.name = body.tenantName.trim()
      if (body.tenantPhone !== undefined) tenantData.phone = body.tenantPhone.trim()
      if (body.tenantWechat !== undefined) {
        const w = body.tenantWechat.trim()
        tenantData.wechat = w.length > 0 ? w : null
      }
      if (Object.keys(tenantData).length > 0) {
        await tx.tenant.update({ where: { id: order.tenantId }, data: tenantData })
      }
      if (order.contract) {
        await tx.contract.update({
          where: { id: order.contract.id },
          data: {
            startDate: moveIn,
            endDate,
            ...(order.contract.status === 'WAIT_TENANT_SIGN'
              ? {
                  tenantSignDeadlineAt: order.contract.renewedFromId
                    ? computeRenewalTenantActionDeadline(moveIn)
                    : computeTenantSignDeadline(),
                }
              : {}),
          },
        })
      }
    })

    res.json({ ok: true })
  })

  app.post('/api/admin/orders/:id/review', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      approved: z.boolean(),
      reason: z.string().optional(),
    })
    const body = Body.parse(req.body)

    const order = await ctx.prisma.order.findUnique({
      where: { id: String(req.params.id) },
      include: { house: { include: { apartment: true } } },
    })
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, order.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (order.status !== 'PENDING_REVIEW') return res.status(409).json({ error: 'INVALID_STATUS' })

    if (body.approved) {
      const updated = await ctx.prisma.order.update({
        where: { id: order.id },
        data: { status: 'APPROVED', reviewReason: null },
      })
      await promoteOrderedHousesToReservedForOrder(ctx.prisma, order.id, order.houseId)
      return res.json({ ok: true, status: updated.status })
    }

    const updated = await ctx.prisma.order.update({
      where: { id: order.id },
      data: { status: 'REJECTED', reviewReason: body.reason ?? '不通过' },
    })
    await releaseOrderedHousesForOrder(ctx.prisma, order.id, order.houseId)
    return res.json({ ok: true, status: updated.status })
  })

  /** 待审核订单取消：释放房源，他人可再次下单（与「审核拒绝」效果类似） */
  app.post('/api/admin/orders/:id/cancel', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const order = await ctx.prisma.order.findUnique({
      where: { id: String(req.params.id) },
      include: { house: { include: { apartment: true } } },
    })
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, order.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (order.status !== 'PENDING_REVIEW') {
      return res.status(409).json({ error: 'ONLY_PENDING_REVIEW_CAN_CANCEL' })
    }
    await ctx.prisma.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', reviewReason: '店长取消订单，房源已解锁' },
    })
    await releaseOrderedHousesForOrder(ctx.prisma, order.id, order.houseId)
    return res.json({ ok: true })
  })

  app.post('/api/admin/contracts', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      orderId: z.string().min(1),
      tenantId: z.string().min(1),
      leaseMonths: z.number().int().min(1).max(36),
      moveInDate: z.string().min(8),
      endDate: z.string().min(8).optional(),
      rentMonthly: z.number().int().positive(),
      depositMultiple: z.number().positive(),
      rentCycle: zRentCycle,
      penaltyFormula: z.string().min(1),
      rentDueDay: zRentDueDay.optional(),
      latestRentGraceDays: z.union([z.number().int().min(0).max(999), z.null()]).optional(),
      configRemarkHtml: z.string().optional(),
      attachmentsJson: z.string().optional(),
      agreementSignDate: z.union([z.string().min(8), z.null()]).optional(),
      contractTemplate: zContractTemplate.optional(),
      terminationRentMultiple: z.union([z.number().positive().max(999), z.null()]).optional(),
      terminationDaysPastDue: z.union([z.number().int().min(0).max(999), z.null()]).optional(),
      contractTemplateDataJson: z.string().optional(),
      billPushToTenant: z.boolean().optional(),
    })
    const body = Body.parse(req.body)
    const tmplFields = contractTemplateTerminationData(body)
    const billPushToTenant =
      tmplFields.contractTemplate === 'NANNING_HOUSING' && Boolean(body.billPushToTenant)

    const order = await ctx.prisma.order.findUnique({
      where: { id: body.orderId },
      include: {
        tenant: true,
        house: { include: { apartment: true } },
        contract: true,
        lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      },
    })
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, order.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (order.status !== 'APPROVED') return res.status(409).json({ error: 'ORDER_NOT_APPROVED' })
    if (order.isMergedBundle && order.lines.length > 0) {
      const sumSnap = order.lines.reduce((s, l) => s + l.rentMonthlySnapshot, 0)
      if (sumSnap !== body.rentMonthly) {
        return res.status(400).json({ error: 'MERGED_RENT_SUM_MISMATCH' })
      }
    }
    if (order.contract) {
      const canModifyConfiguredContract = Boolean(
        order.contract.modificationRequestedAt || order.contract.modificationRejectedAt,
      )
      if (!canModifyConfiguredContract) {
        return res.status(409).json({ error: 'CONTRACT_LOCKED_WAIT_TENANT_CONFIRM_OR_MODIFY_REQUEST' })
      }
      // Ensure bills exist even if a previous attempt partially failed.
      const startDate = new Date(body.moveInDate)
      const rentDueDay = normalizeRentDueDay(body.rentDueDay, startDate)
      await syncContractBaseRentBills(
        ctx.prisma,
        {
          contractId: order.contract.id,
          startDate,
          leaseMonths: body.leaseMonths,
          rentMonthly: body.rentMonthly,
          rentCycle: body.rentCycle,
          rentDueDay,
        },
        'upsert',
      )
      const contractId = order.contract.id
      await ctx.prisma.$transaction(async (tx) => {
        await syncBaseRentBillItemsForContract(tx, {
          contractId,
          orderId: order.id,
          rentMonthly: body.rentMonthly,
        })
      })
      const deposit = Math.round(body.rentMonthly * body.depositMultiple)
      const startDate2 = new Date(body.moveInDate)
      const endDate2 = body.endDate ? new Date(body.endDate) : addMonths(startDate2, body.leaseMonths)
      const rentDueDay2 = normalizeRentDueDay(body.rentDueDay, startDate2)
      const updated = await ctx.prisma.contract.update({
        where: { id: order.contract.id },
        data: {
          tenantId: body.tenantId,
          startDate: startDate2,
          endDate: endDate2,
          rentMonthly: body.rentMonthly,
          deposit,
          depositMultiple: body.depositMultiple,
          rentCycle: body.rentCycle,
          penaltyFormula: body.penaltyFormula,
          rentDueDay: rentDueDay2,
          ...(body.latestRentGraceDays !== undefined
            ? {
                latestRentGraceDays: body.latestRentGraceDays,
                latestRentDueDate: null,
              }
            : {}),
          status: 'WAIT_TENANT_SIGN',
          confirmedAt: null,
          signedAt: null,
          stampedAt: null,
          voidedAt: null,
          terminatedAt: null,
          tenantSignDeadlineAt: computeTenantSignDeadline(),
          ...(body.configRemarkHtml !== undefined ? { configRemarkHtml: body.configRemarkHtml || null } : {}),
          ...(body.attachmentsJson !== undefined ? { attachmentsJson: body.attachmentsJson || '[]' } : {}),
          ...(body.agreementSignDate !== undefined
            ? { agreementSignDate: body.agreementSignDate ? new Date(body.agreementSignDate) : null }
            : {}),
          ...(body.contractTemplateDataJson !== undefined
            ? { contractTemplateDataJson: body.contractTemplateDataJson || null }
            : {}),
          billPushToTenant,
          billPushStatus: billPushToTenant ? 'PENDING_TENANT' : 'NOT_ENABLED',
          ...tmplFields,
        },
      })
      return res.json({ id: updated.id, contractNo: updated.contractNo, tenantPhone: order.tenant.phone })
    }

    const startDate = new Date(body.moveInDate)
    const endDate = body.endDate ? new Date(body.endDate) : addMonths(startDate, body.leaseMonths)
    const contractNo = `C${new Date().getFullYear()}${String(Date.now()).slice(-8)}`
    const deposit = Math.round(body.rentMonthly * body.depositMultiple)
    const rentDueDay = normalizeRentDueDay(body.rentDueDay, startDate)

    const contract = await ctx.prisma.contract.create({
      data: {
        contractNo,
        houseId: order.houseId,
        tenantId: body.tenantId,
        orderId: order.id,
        status: 'WAIT_TENANT_SIGN',
        source: 'SYSTEM',
        startDate,
        endDate,
        rentMonthly: body.rentMonthly,
        deposit,
        depositMultiple: body.depositMultiple,
        rentCycle: body.rentCycle,
        penaltyFormula: body.penaltyFormula,
        rentDueDay,
        latestRentGraceDays: body.latestRentGraceDays ?? null,
        latestRentDueDate: null,
        configRemarkHtml: body.configRemarkHtml ?? null,
        attachmentsJson: body.attachmentsJson ?? '[]',
        tenantSignDeadlineAt: computeTenantSignDeadline(),
        agreementSignDate: body.agreementSignDate ? new Date(body.agreementSignDate) : null,
        contractTemplateDataJson: body.contractTemplateDataJson ?? null,
        billPushToTenant,
        billPushStatus: billPushToTenant ? 'PENDING_TENANT' : 'NOT_ENABLED',
        ...tmplFields,
      },
    })

    const schedule = buildRentBillSchedule({
      startDate,
      leaseMonths: body.leaseMonths,
      rentMonthly: body.rentMonthly,
      rentCycle: body.rentCycle,
      rentDueDay,
    })
    const firstPeriod = schedule[0]?.period ?? fmtPeriod(startOfMonth(startDate))
    await syncContractBaseRentBills(
      ctx.prisma,
      {
        contractId: contract.id,
        startDate,
        leaseMonths: body.leaseMonths,
        rentMonthly: body.rentMonthly,
        rentCycle: body.rentCycle,
        rentDueDay,
      },
      'upsert',
    )

    await ctx.prisma.$transaction(async (tx) => {
      await syncBaseRentBillItemsForContract(tx, {
        contractId: contract.id,
        orderId: order.id,
        rentMonthly: body.rentMonthly,
      })
    })

    res.json({ id: contract.id, contractNo, tenantPhone: order.tenant.phone, firstPeriod })
  })

  /**
   * 管理员手动新建合同（不走租客签字/盖章/支付流程）：直接生成「已生效」合同
   * - 自动创建租客 + 订单（APPROVED）
   * - 房源需为空置 VACANT，创建后标记为 RESERVED
   * - 合同来源 source=MANUAL_IMPORT，便于列表筛选
   */
  app.post('/api/admin/contracts/manual', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      houseId: z.string().min(1).optional(),
      houseIds: z.array(z.string().min(1)).optional(),
      tenantId: z.string().min(1).optional(),
      tenantIds: z.array(z.string().min(1)).optional(),
      tenant: z
        .object({
          name: z.string().min(1),
          phone: z.string().min(6),
          idNumber: z.string().min(6),
        })
        .optional(),
      leaseMonths: z.number().int().min(1).max(36),
      startDate: z.string().min(8),
      endDate: z.string().min(8).optional(),
      rentMonthly: z.number().int().positive(),
      depositMultiple: z.number().positive(),
      rentCycle: zRentCycle,
      penaltyFormula: z.string().min(1),
      rentDueDay: zRentDueDay.optional(),
      latestRentGraceDays: z.union([z.number().int().min(0).max(999), z.null()]).optional(),
      configRemarkHtml: z.union([z.string(), z.null()]).optional(),
      agreementSignDate: z.union([z.string().min(8), z.null()]).optional(),
      contractTemplate: zContractTemplate.optional(),
      terminationRentMultiple: z.union([z.number().positive().max(999), z.null()]).optional(),
      terminationDaysPastDue: z.union([z.number().int().min(0).max(999), z.null()]).optional(),
      contractTemplateDataJson: z.string().optional(),
      billPushToTenant: z.boolean().optional(),
    })
    const body = Body.parse(req.body)
    const tmplFields = contractTemplateTerminationData(body)
    const deposit = Math.round(body.rentMonthly * body.depositMultiple)
    const billPushToTenant = tmplFields.contractTemplate === 'NANNING_HOUSING' && Boolean(body.billPushToTenant)

    const resolvedHouseIds =
      body.houseIds && body.houseIds.length > 0 ? body.houseIds : body.houseId ? [body.houseId] : []
    if (!resolvedHouseIds.length) return res.status(400).json({ error: 'HOUSE_REQUIRED' })

    const houses = await ctx.prisma.house.findMany({
      where: { id: { in: resolvedHouseIds } },
      include: { apartment: true },
    })
    if (houses.length !== resolvedHouseIds.length) return res.status(404).json({ error: 'TARGET_NOT_FOUND' })
    for (const h of houses) {
      if (!canAccessStore(auth, h.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
      if (h.status !== 'VACANT') return res.status(409).json({ error: 'TARGET_NOT_VACANT' })
    }
    const primaryHouse = houses[0]!

    let primaryTenantId = body.tenantId ?? body.tenantIds?.[0] ?? null
    let tenantCreateData = body.tenant

    if (!primaryTenantId && tenantCreateData) {
      // legacy inline tenant
    } else if (primaryTenantId) {
      const existing = await ctx.prisma.tenant.findUnique({ where: { id: primaryTenantId } })
      if (!existing) return res.status(404).json({ error: 'TENANT_NOT_FOUND' })
    } else {
      return res.status(400).json({ error: 'TENANT_REQUIRED' })
    }

    const start = new Date(body.startDate)
    const end = body.endDate ? new Date(body.endDate) : addMonths(start, body.leaseMonths)
    const contractNo = `C${new Date().getFullYear()}M${String(Date.now()).slice(-8)}`
    const rentDueDay = normalizeRentDueDay(body.rentDueDay, start)

    const out = await ctx.prisma.$transaction(async (tx) => {
      let tenantId = primaryTenantId!
      let inlineTenantCreated = false
      if (!primaryTenantId && tenantCreateData) {
        const tenant = await tx.tenant.create({
          data: {
            name: tenantCreateData.name,
            phone: tenantCreateData.phone,
            idNumber: normalizeIdNumber(tenantCreateData.idNumber),
            tenantKind: 'INDIVIDUAL',
            createdSource: 'ADMIN',
            createdByAdminId: auth.admin.id,
          },
        })
        tenantId = tenant.id
        inlineTenantCreated = true
      }
      const isMerged = resolvedHouseIds.length > 1
      const order = await tx.order.create({
        data: {
          houseId: primaryHouse.id,
          tenantId,
          leaseMonths: body.leaseMonths,
          moveInDate: start,
          isMergedBundle: isMerged,
          status: 'APPROVED',
          reviewReason: '管理员手动创建合同',
          ...(isMerged
            ? {
                lines: {
                  create: houses.map((h, idx) => ({
                    houseId: h.id,
                    rentMonthlySnapshot: h.rentMonthly,
                    depositSnapshot: h.deposit,
                    sortOrder: idx,
                  })),
                },
              }
            : {}),
        },
      })
      const contract = await tx.contract.create({
        data: {
          contractNo,
          houseId: primaryHouse.id,
          tenantId,
          orderId: order.id,
          status: 'ACTIVE',
          source: 'MANUAL_IMPORT',
          startDate: start,
          endDate: end,
          rentMonthly: body.rentMonthly,
          deposit,
          depositMultiple: body.depositMultiple,
          rentCycle: body.rentCycle,
          penaltyFormula: body.penaltyFormula,
          rentDueDay,
          latestRentGraceDays: body.latestRentGraceDays ?? null,
          latestRentDueDate: null,
          configRemarkHtml: body.configRemarkHtml === undefined ? null : body.configRemarkHtml,
          agreementSignDate: body.agreementSignDate ? new Date(body.agreementSignDate) : null,
          contractTemplateDataJson: body.contractTemplateDataJson ?? null,
          billPushToTenant,
          billPushStatus: billPushToTenant ? 'PENDING_TENANT' : 'NOT_ENABLED',
          ...tmplFields,
          confirmedAt: new Date(),
          signedAt: new Date(),
          stampedAt: new Date(),
        },
      })
      await syncContractBaseRentBills(
        tx,
        {
          contractId: contract.id,
          startDate: start,
          leaseMonths: body.leaseMonths,
          rentMonthly: body.rentMonthly,
          rentCycle: body.rentCycle,
          rentDueDay,
        },
        'create',
      )
      for (const h of houses) {
        await tx.house.update({ where: { id: h.id }, data: { status: 'RESERVED' } })
      }
      return { contractId: contract.id, contractNo: contract.contractNo, inlineTenantId: inlineTenantCreated ? tenantId : null }
    })

    if (out.inlineTenantId) {
      await insertTenantProfileLog(ctx.prisma, {
        tenantId: out.inlineTenantId,
        actionLabel: '档案入档',
        detail: '后台代建个人档案（手动创建合同时）',
        operatorKind: 'ADMIN',
        admin: auth.admin,
      })
    }

    await applyBillPushForContract(ctx.prisma, out.contractId)

    res.json({ ok: true, ...out })
  })

  app.get('/api/admin/contracts', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    await syncExpiredActiveContractHouses(ctx.prisma)
    const contracts = await ctx.prisma.contract.findMany({
      include: {
        tenant: true,
        house: { include: { apartment: { include: { store: true } } } },
        housingReport: true,
        refunds: {
          select: { amount: true, reason: true },
          take: 20,
          orderBy: { createdAt: 'desc' },
        },
        renewedFrom: { select: { id: true, contractNo: true } },
        changeHouseFrom: { select: { id: true, contractNo: true } },
        order: {
          select: {
            isMergedBundle: true,
            lines: {
              orderBy: { sortOrder: 'asc' },
              include: {
                house: {
                  select: { id: true, houseNo: true, apartment: { select: { name: true } } },
                },
                changeHouseNewContract: { select: { contractNo: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    const items = contracts.filter((c) => canAccessStore(auth, c.house.apartment.storeId))

    // 为演示优化“前 10 条”：混排置顶换房/续租/退租样例，避免同类样例刷屏
    const topSize = 10
    const perKind = 2
    const used = new Set<string>()
    const pick = <T extends { id: string }>(arr: T[], n: number) => {
      const out: T[] = []
      for (const x of arr) {
        if (out.length >= n) break
        if (used.has(x.id)) continue
        used.add(x.id)
        out.push(x)
      }
      return out
    }

    const changeHouseNew = items.filter((c) => c.changeHouseFrom?.id)
    const renewedNew = items.filter((c) => c.renewedFrom?.id)
    const moveOutDemo = items.filter((c) =>
      c.status === 'TERMINATED' && (c.refunds ?? []).some((r) => r.reason.includes('退租') || r.reason.includes('作废')),
    )
    const normal = items.filter(
      (c) =>
        !c.changeHouseFrom?.id &&
        !c.renewedFrom?.id &&
        !(c.refunds ?? []).some((r) => r.reason.includes('退租') || r.reason.includes('作废')),
    )

    const top: typeof items = [
      ...pick(changeHouseNew, perKind),
      ...pick(renewedNew, perKind),
      ...pick(moveOutDemo, perKind),
    ]
    const filled: typeof items = [...top]
    for (const x of normal) {
      if (filled.length >= topSize) break
      if (used.has(x.id)) continue
      used.add(x.id)
      filled.push(x)
    }
    const rest = items.filter((x) => !used.has(x.id))
    const mixedItems = [...filled, ...rest]
    res.json({
      items: mixedItems.map((c) => {
        const atts = parseContractAttachmentsJson(c.attachmentsJson)
        const depositRefund = getDepositRefundSummary(c.refunds)
        let moveOutSignDeadlineAt: string | null = null
        if (c.status === 'WAIT_TENANT_MOVEOUT_SIGN' && c.moveOutPendingJson) {
          try {
            const p = JSON.parse(c.moveOutPendingJson) as { deadlineAt?: string }
            if (p.deadlineAt) moveOutSignDeadlineAt = p.deadlineAt
          } catch {
            /* ignore */
          }
        }
        const mergedBundle = mapMergedBundleFromOrder(c.order ?? null)
        return {
          id: c.id,
          contractNo: c.contractNo,
          status: c.status,
          source: c.source,
          // 用于列表展示「到期预警」
          endDate: toYmd(c.endDate),
          tenant: { name: c.tenant.name, phone: c.tenant.phone },
          house: {
            id: c.house.id,
            houseBizId: houseBizId(c.house.id),
            storeName: c.house.apartment.store.name,
            projectName: c.house.projectName,
            rentCollectionUnit: c.house.rentCollectionUnit,
            managerName: c.house.managerName,
            assetType: c.house.apartment.assetType,
            apartmentName: c.house.apartment.name,
            houseNo: c.house.houseNo,
          },
          mergedBundle,
          housingReportStatus: c.housingReport?.status ?? null,
          modificationRequestedAt: c.modificationRequestedAt ? c.modificationRequestedAt.toISOString() : null,
          modificationRejectedAt: c.modificationRejectedAt ? c.modificationRejectedAt.toISOString() : null,
          remarkPreview: remarkPlainPreview(c.configRemarkHtml) || '—',
          attachmentCount: atts.length,
          attachmentFiles: atts.map((a) => ({ name: a.name, file: a.file })),
          renewedFromContractNo: c.renewedFrom?.contractNo ?? null,
          changeHouseFromContractNo: c.changeHouseFrom?.contractNo ?? null,
          depositRefunded: depositRefund.depositRefunded,
          refundedDepositAmount: depositRefund.refundedDepositAmount,
          moveOutSignDeadlineAt,
          billingPaused: isContractBillingPaused(c),
          billingPausedAt: c.billingPausedAt ? c.billingPausedAt.toISOString() : null,
          billingResumeFrom: c.billingResumeFrom ? toYmd(c.billingResumeFrom) : null,
          houseStatus: c.house.status,
          leaseDaysLeft: contractExpiryDaysLeft(c.endDate),
          leaseExpired: isContractLeaseExpired(c),
          contractTemplate: c.contractTemplate,
          billPushToTenant: c.billPushToTenant,
          billPushStatus: c.billPushToTenant ? c.billPushStatus : null,
        }
      }),
    })
  })

  app.post('/api/admin/contracts/:id/billing-pause', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: { house: { include: { apartment: true } } },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status !== 'ACTIVE') return res.status(409).json({ error: 'NEED_ACTIVE_CONTRACT' })
    if (isContractBillingPaused(contract)) return res.status(409).json({ error: 'ALREADY_PAUSED' })
    const now = new Date()
    const updated = await ctx.prisma.contract.update({
      where: { id: contract.id },
      data: { billingPausedAt: now, billingResumeFrom: null },
    })
    res.json({
      ok: true,
      billingPausedAt: updated.billingPausedAt?.toISOString() ?? null,
      billingResumeFrom: null,
    })
  })

  app.post('/api/admin/contracts/:id/billing-resume', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      resumeFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    const body = Body.safeParse(req.body)
    if (!body.success) return res.status(400).json({ error: 'INVALID_BODY' })

    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: { house: { include: { apartment: true } } },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status !== 'ACTIVE') return res.status(409).json({ error: 'NEED_ACTIVE_CONTRACT' })
    if (!contract.billingPausedAt) return res.status(409).json({ error: 'NOT_PAUSED' })

    const resumeFrom = new Date(`${body.data.resumeFrom}T12:00:00.000Z`)
    const now = new Date()
    const clearNow = shouldClearBillingPause(
      { billingPausedAt: contract.billingPausedAt, billingResumeFrom: resumeFrom },
      now,
    )
    const updated = await ctx.prisma.contract.update({
      where: { id: contract.id },
      data: clearNow
        ? { billingPausedAt: null, billingResumeFrom: null }
        : { billingResumeFrom: resumeFrom },
    })
    res.json({
      ok: true,
      billingPaused: isContractBillingPaused(updated),
      billingPausedAt: updated.billingPausedAt?.toISOString() ?? null,
      billingResumeFrom: updated.billingResumeFrom ? toYmd(updated.billingResumeFrom) : null,
    })
  })

  app.get('/api/admin/contracts/:id', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const cid = String(req.params.id)
    await expireTenantMoveOutIfNeeded(ctx.prisma, cid)

    const contract = await ctx.prisma.contract.findUnique({
      where: { id: cid },
      include: {
        tenant: true,
        house: { include: { apartment: { include: { store: true } } } },
        housingReport: true,
        refunds: { orderBy: { createdAt: 'desc' } },
        renewedFrom: { select: { id: true, contractNo: true } },
        changeHouseFrom: { select: { id: true, contractNo: true } },
        order: {
          select: {
            isMergedBundle: true,
            lines: {
              orderBy: { sortOrder: 'asc' },
              include: {
                house: {
                  select: { id: true, houseNo: true, apartment: { select: { name: true } } },
                },
                changeHouseNewContract: { select: { contractNo: true } },
              },
            },
          },
        },
      },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })

    const atts = parseContractAttachmentsJson(contract.attachmentsJson)
    const attUrls = (f: string) => ({
      previewUrl: `/api/admin/contracts/${contract.id}/attachment/${encodeURIComponent(f)}`,
      downloadUrl: `/api/admin/contracts/${contract.id}/attachment/${encodeURIComponent(f)}?download=1`,
    })
    const depositRefund = getDepositRefundSummary(
      contract.refunds.map((r) => ({ amount: r.amount, reason: r.reason })),
    )

    const mergedBundle = mapMergedBundleFromOrder(contract.order ?? null)

    let changeHouseMoney: unknown = null
    if (contract.changeHouseMoneyJson) {
      try {
        changeHouseMoney = JSON.parse(contract.changeHouseMoneyJson)
      } catch {
        changeHouseMoney = null
      }
    }

    let moveOutSignDeadlineAt: string | null = null
    let moveOutPending: {
      deadlineAt: string
      reasonFull: string
      terminateDate: string
      partial: boolean
      attachments: { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }[]
    } | null = null
    if (contract.status === 'WAIT_TENANT_MOVEOUT_SIGN' && contract.moveOutPendingJson) {
      try {
        const p = JSON.parse(contract.moveOutPendingJson) as MoveOutPendingPayload
        moveOutSignDeadlineAt = p.deadlineAt
        moveOutPending = {
          deadlineAt: p.deadlineAt,
          reasonFull: p.reasonFull,
          terminateDate: p.terminateDate,
          partial: Boolean(p.partial),
          attachments: (p.attachments ?? []).map((a) => ({
            id: a.id,
            name: a.name,
            file: a.file,
            previewUrl: `/api/admin/contracts/${contract.id}/move-out-file/${encodeURIComponent(a.file)}`,
            downloadUrl: `/api/admin/contracts/${contract.id}/move-out-file/${encodeURIComponent(a.file)}?download=1`,
          })),
        }
      } catch {
        moveOutPending = null
      }
    }

    res.json({
      id: contract.id,
      contractNo: contract.contractNo,
      status: contract.status,
      source: contract.source,
      tenant: {
        name: contract.tenant.name,
        phone: contract.tenant.phone,
        idNumber: contract.tenant.idNumber,
        wechat: contract.tenant.wechat ?? null,
      },
      house: {
        storeName: contract.house.apartment.store.name,
        apartmentName: contract.house.apartment.name,
        houseNo: contract.house.houseNo,
      },
      mergedBundle,
      startDate: toYmd(contract.startDate),
      endDate: toYmd(contract.endDate),
      rentMonthly: contract.rentMonthly,
      deposit: contract.deposit,
      rentCycle: contract.rentCycle,
      rentDueDay: contract.rentDueDay,
      contractTemplate: contract.contractTemplate,
      contractTemplateDataJson: contract.contractTemplateDataJson ?? null,
      terminationRentMultiple: contract.terminationRentMultiple ?? null,
      terminationDaysPastDue: contract.terminationDaysPastDue ?? null,
      penaltyFormula: contract.penaltyFormula,
      latestRentGraceDays: contract.latestRentGraceDays ?? null,
      configRemarkHtml: contract.configRemarkHtml ?? '',
      agreementSignDate: contract.agreementSignDate ? toYmd(contract.agreementSignDate) : null,
      attachments: atts.map((a) => ({ id: a.id, name: a.name, file: a.file, ...attUrls(a.file) })),
      renewedFromContractNo: contract.renewedFrom?.contractNo ?? null,
      renewedFromId: contract.renewedFrom?.id ?? null,
      changeHouseFromContractNo: contract.changeHouseFrom?.contractNo ?? null,
      changeHouseFromId: contract.changeHouseFrom?.id ?? null,
      changeHouseMoney,
      createdAt: contract.createdAt.toISOString(),
      confirmedAt: contract.confirmedAt?.toISOString() ?? null,
      signedAt: contract.signedAt?.toISOString() ?? null,
      stampedAt: contract.stampedAt?.toISOString() ?? null,
      tenantSignDeadlineAt: contract.tenantSignDeadlineAt?.toISOString() ?? null,
      moveOutSignDeadlineAt,
      moveOutPending,
      voidedAt: contract.voidedAt?.toISOString() ?? null,
      terminatedAt: contract.terminatedAt?.toISOString() ?? null,
      housingReport: contract.housingReport
        ? {
            status: contract.housingReport.status,
            bureauRecordNo: contract.housingReport.bureauRecordNo,
            receiptPdfPath: contract.housingReport.receiptPdfPath,
            reportedAt: contract.housingReport.reportedAt?.toISOString() ?? null,
            lastError: contract.housingReport.lastError,
          }
        : null,
      depositRefunded: depositRefund.depositRefunded,
      refundedDepositAmount: depositRefund.refundedDepositAmount,
      refunds: contract.refunds.map((r) => ({
        amount: r.amount,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      })),
      billingPaused: isContractBillingPaused(contract),
      billingPausedAt: contract.billingPausedAt?.toISOString() ?? null,
      billingResumeFrom: contract.billingResumeFrom ? toYmd(contract.billingResumeFrom) : null,
      houseStatus: contract.house.status,
      leaseDaysLeft: contractExpiryDaysLeft(contract.endDate),
      leaseExpired: isContractLeaseExpired(contract),
      billPushToTenant: contract.billPushToTenant,
      billPushStatus: contract.billPushToTenant ? contract.billPushStatus : null,
      billPushStatusLabel: contract.billPushToTenant ? billPushStatusLabel(contract.billPushStatus) : null,
    })
  })

  /** 管理端：下载合同摘要 PDF（含关键条款字段，供留存） */
  app.get('/api/admin/contracts/:id/download', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: {
        tenant: true,
        house: { include: { apartment: { include: { store: true } } } },
        order: {
          select: {
            isMergedBundle: true,
            lines: {
              orderBy: { sortOrder: 'asc' },
              include: { house: { include: { apartment: true } } },
            },
          },
        },
      },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    try {
      const text = buildContractSummaryText(contract)
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(`合同摘要-${contract.contractNo}.txt`)}`,
      )
      res.send('\uFEFF' + text)
    } catch (e) {
      console.error(e)
      return res.status(500).json({ error: 'CONTRACT_SUMMARY_BUILD_FAILED' })
    }
  })

  /** 管理端：下载住建局报备回执文件 */
  app.get('/api/admin/contracts/:id/housing-receipt', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: { house: { include: { apartment: true } }, housingReport: true },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    const hr = contract.housingReport
    if (!hr || hr.status !== 'SUCCESS' || !hr.receiptPdfPath) {
      return res.status(409).json({ error: 'HOUSING_RECEIPT_NOT_READY' })
    }
    let abs = hr.receiptPdfPath
    if (!path.isAbsolute(abs)) abs = path.join(process.cwd(), abs)
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'HOUSING_RECEIPT_FILE_MISSING' })
    const raw = await readFile(abs)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`住建报备回执-${contract.contractNo}.pdf`)}`,
    )
    res.send(raw)
  })

  // 修改配置合同信息（租期、月租、押金、缴费周期、滞纳金公式等）
  app.patch('/api/admin/contracts/:id', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      startDate: z.string().min(8).optional(),
      endDate: z.string().min(8).optional(),
      rentMonthly: z.number().int().positive().optional(),
      deposit: z.number().int().nonnegative().optional(),
      rentCycle: zRentCycle.optional(),
      rentDueDay: zRentDueDay.optional(),
      penaltyFormula: z.string().min(1).optional(),
      latestRentGraceDays: z.union([z.number().int().min(0).max(999), z.null()]).optional(),
      configRemarkHtml: z.string().nullable().optional(),
      attachmentsJson: z.string().optional(),
      agreementSignDate: z.union([z.string().min(8), z.null()]).optional(),
      contractTemplate: zContractTemplate.optional(),
      terminationRentMultiple: z.union([z.number().positive().max(999), z.null()]).optional(),
      terminationDaysPastDue: z.union([z.number().int().min(0).max(999), z.null()]).optional(),
      contractTemplateDataJson: z.string().optional(),
    })
    const body = Body.safeParse(req.body)
    if (!body.success) return res.status(400).json({ error: 'INVALID_BODY', details: body.error.flatten() })

    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: { house: { include: { apartment: true } } },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status === 'VOID' || contract.status === 'TERMINATED') {
      return res.status(409).json({ error: 'CONTRACT_ALREADY_ENDED' })
    }
    if (contract.status === 'WAIT_TENANT_MOVEOUT_SIGN') {
      return res.status(409).json({ error: 'CONTRACT_MOVEOUT_PENDING' })
    }

    const data: Record<string, unknown> = {}
    if (body.data.startDate != null) data.startDate = new Date(body.data.startDate)
    if (body.data.endDate != null) data.endDate = new Date(body.data.endDate)
    if (body.data.rentMonthly != null) data.rentMonthly = body.data.rentMonthly
    if (body.data.deposit != null) data.deposit = body.data.deposit
    if (body.data.rentCycle != null) data.rentCycle = body.data.rentCycle
    if (body.data.rentDueDay != null) data.rentDueDay = body.data.rentDueDay
    if (body.data.penaltyFormula != null) data.penaltyFormula = body.data.penaltyFormula
    if (body.data.latestRentGraceDays !== undefined) {
      data.latestRentGraceDays = body.data.latestRentGraceDays
      data.latestRentDueDate = null
    }
    if (body.data.configRemarkHtml !== undefined) {
      data.configRemarkHtml = body.data.configRemarkHtml
    }
    if (body.data.attachmentsJson !== undefined) {
      data.attachmentsJson = body.data.attachmentsJson
    }
    if (body.data.agreementSignDate !== undefined) {
      data.agreementSignDate =
        body.data.agreementSignDate === null ? null : new Date(body.data.agreementSignDate)
    }

    if (
      body.data.contractTemplate !== undefined ||
      body.data.terminationRentMultiple !== undefined ||
      body.data.terminationDaysPastDue !== undefined
    ) {
      const tmpl = body.data.contractTemplate ?? contract.contractTemplate
      const trm =
        body.data.terminationRentMultiple !== undefined
          ? body.data.terminationRentMultiple
          : contract.terminationRentMultiple
      const tday =
        body.data.terminationDaysPastDue !== undefined
          ? body.data.terminationDaysPastDue
          : contract.terminationDaysPastDue
      Object.assign(
        data,
        contractTemplateTerminationData({
          contractTemplate: tmpl,
          terminationRentMultiple: trm,
          terminationDaysPastDue: tday,
        }),
      )
    }

    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'NO_FIELDS_TO_UPDATE' })

    await ctx.prisma.contract.update({
      where: { id: contract.id },
      data: { ...(data as any), modificationRequestedAt: null, modificationRejectedAt: null },
    })
    res.json({ ok: true })
  })

  app.post(
    '/api/admin/contracts/:id/upload-attachment',
    adminAuth(ctx.prisma),
    contractFileUpload.single('file'),
    async (req, res) => {
      const auth = getAdminAuth(req)
      if (!req.file) return res.status(400).json({ error: 'NO_FILE' })
      const contract = await ctx.prisma.contract.findUnique({
        where: { id: String(req.params.id) },
        include: { house: { include: { apartment: true } } },
      })
      if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
      if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
      if (contract.status === 'WAIT_TENANT_MOVEOUT_SIGN') {
        return res.status(409).json({ error: 'CONTRACT_MOVEOUT_PENDING' })
      }

      const ext = path.extname(req.file.originalname || '').slice(0, 12) || '.bin'
      const stored = `${Date.now()}-${randomBytes(8).toString('hex')}${ext.replace(/[^a-zA-Z0-9.]/g, '')}`
      if (!/^[a-zA-Z0-9._-]+$/.test(stored)) return res.status(400).json({ error: 'BAD_FILENAME' })
      const dir = ensureContractUploadDir(contract.id)
      fs.writeFileSync(path.join(dir, stored), req.file.buffer)

      const list = parseContractAttachmentsJson(contract.attachmentsJson)
      const id = randomBytes(6).toString('hex')
      list.push({ id, name: req.file.originalname || stored, file: stored })
      await ctx.prisma.contract.update({
        where: { id: contract.id },
        data: { attachmentsJson: JSON.stringify(list) },
      })
      res.json({ ok: true, attachments: list })
    },
  )

  app.get('/api/admin/contracts/:id/attachment/:fileKey', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const fileKey = decodeURIComponent(String(req.params.fileKey))
    if (!/^[a-zA-Z0-9._-]+$/.test(fileKey)) return res.status(400).json({ error: 'BAD_KEY' })
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: { house: { include: { apartment: true } } },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    const list = parseContractAttachmentsJson(contract.attachmentsJson)
    const att = list.find((a) => a.file === fileKey)
    if (!att) return res.status(404).json({ error: 'FILE_NOT_IN_CONTRACT' })
    const full = path.join(CONTRACT_UPLOAD_ROOT, contract.id, fileKey)
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'FILE_MISSING' })
    const { ext, mime } = mimeFromFileKey(fileKey)
    const lockPreview = contractAttachmentLockedUntilTenantPaid(contract.status)

    if (lockPreview && req.query.download === '1') {
      return res.status(403).json({ error: 'PAYMENT_REQUIRED_FOR_DOWNLOAD' })
    }

    if (
      lockPreview &&
      req.query.download !== '1' &&
      ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf'].includes(ext)
    ) {
      const raw = await readFile(full)
      const out = await applyContractPreviewWatermark(raw, ext)
      res.setHeader('Content-Type', mime)
      res.setHeader('Content-Disposition', 'inline')
      return res.send(out)
    }

    res.setHeader('Content-Type', mime)
    if (req.query.download === '1') {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`,
      )
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf'].includes(ext)) {
      res.setHeader('Content-Disposition', 'inline')
    }
    res.sendFile(path.resolve(full))
  })

  app.delete('/api/admin/contracts/:id/attachment/:fileKey', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const fileKey = decodeURIComponent(String(req.params.fileKey))
    if (!/^[a-zA-Z0-9._-]+$/.test(fileKey)) return res.status(400).json({ error: 'BAD_KEY' })
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: { house: { include: { apartment: true } } },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    const list = parseContractAttachmentsJson(contract.attachmentsJson).filter((a) => a.file !== fileKey)
    const full = path.join(CONTRACT_UPLOAD_ROOT, contract.id, fileKey)
    try {
      if (fs.existsSync(full)) fs.unlinkSync(full)
    } catch {
      /* ignore */
    }
    await ctx.prisma.contract.update({
      where: { id: contract.id },
      data: { attachmentsJson: JSON.stringify(list) },
    })
    res.json({ ok: true, attachments: list })
  })

  app.post(
    '/api/admin/contracts/:id/move-out-file',
    adminAuth(ctx.prisma),
    contractFileUpload.single('file'),
    async (req, res) => {
      const auth = getAdminAuth(req)
      if (!req.file) return res.status(400).json({ error: 'NO_FILE' })
      const contract = await ctx.prisma.contract.findUnique({
        where: { id: String(req.params.id) },
        include: { house: { include: { apartment: true } } },
      })
      if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
      if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
      if (contract.status !== 'ACTIVE') return res.status(409).json({ error: 'INVALID_STATUS' })
      const ext = path.extname(req.file.originalname || '').slice(0, 12) || '.bin'
      const stored = `${Date.now()}-${randomBytes(8).toString('hex')}${ext.replace(/[^a-zA-Z0-9.]/g, '')}`
      if (!/^[a-zA-Z0-9._-]+$/.test(stored)) return res.status(400).json({ error: 'BAD_FILENAME' })
      const dir = ensureMoveOutUploadDir(contract.id)
      fs.writeFileSync(path.join(dir, stored), req.file.buffer)
      const id = randomBytes(6).toString('hex')
      res.json({
        ok: true,
        attachment: { id, name: req.file.originalname || stored, file: stored },
      })
    },
  )

  app.delete('/api/admin/contracts/:id/move-out-file/:fileKey', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const fileKey = decodeURIComponent(String(req.params.fileKey))
    if (!/^[a-zA-Z0-9._-]+$/.test(fileKey)) return res.status(400).json({ error: 'BAD_KEY' })
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: { house: { include: { apartment: true } } },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status !== 'ACTIVE') return res.status(409).json({ error: 'INVALID_STATUS' })
    const full = path.join(MOVEOUT_UPLOAD_ROOT, contract.id, fileKey)
    try {
      if (fs.existsSync(full)) fs.unlinkSync(full)
    } catch {
      /* ignore */
    }
    res.json({ ok: true })
  })

  app.get('/api/admin/contracts/:id/move-out-file/:fileKey', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const fileKey = decodeURIComponent(String(req.params.fileKey))
    if (!/^[a-zA-Z0-9._-]+$/.test(fileKey)) return res.status(400).json({ error: 'BAD_KEY' })
    const cid = String(req.params.id)
    await expireTenantMoveOutIfNeeded(ctx.prisma, cid)
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: cid },
      include: { house: { include: { apartment: true } } },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    let allowed = false
    const full = path.join(MOVEOUT_UPLOAD_ROOT, contract.id, fileKey)
    if (contract.status === 'ACTIVE') {
      allowed = fs.existsSync(full)
    } else if (contract.status === 'WAIT_TENANT_MOVEOUT_SIGN' && contract.moveOutPendingJson) {
      try {
        const p = JSON.parse(contract.moveOutPendingJson) as MoveOutPendingPayload
        allowed = Boolean((p.attachments ?? []).some((a) => a.file === fileKey) && fs.existsSync(full))
      } catch {
        allowed = false
      }
    }
    if (!allowed) return res.status(404).json({ error: 'FILE_NOT_FOUND' })
    const { ext, mime } = mimeFromFileKey(fileKey)
    res.setHeader('Content-Type', mime)
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''move-out-file")
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf'].includes(ext)) {
      res.setHeader('Content-Disposition', 'inline')
    }
    res.sendFile(path.resolve(full))
  })

  app.post('/api/admin/contracts/:id/void', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      terminateDate: z.string().optional(),
      reason: z.string().optional(),
      remark: z.string().optional(),
    })
    const body = Body.parse(req.body ?? {})
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: {
        house: { include: { apartment: true } },
        order: { include: { lines: true } },
      },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status !== 'PENDING_PAYMENT') return res.status(409).json({ error: 'INVALID_STATUS' })

    const now = new Date()
    await ctx.prisma.contract.update({
      where: { id: contract.id },
      data: { status: 'VOID', voidedAt: body.terminateDate ? new Date(body.terminateDate) : now },
    })
    const o = contract.order
    if (o?.isMergedBundle && o.lines.length > 0) {
      await ctx.prisma.house.updateMany({
        where: { id: { in: o.lines.map((l) => l.houseId) } },
        data: { status: 'VACANT' },
      })
    } else {
      await ctx.prisma.house.update({ where: { id: contract.houseId }, data: { status: 'VACANT' } })
    }
    const reasonText = [body.reason && `作废：${body.reason}`, body.remark && `备注：${body.remark}`].filter(Boolean).join('；') || '作废'
    await ctx.prisma.refund.create({
      data: { contractId: contract.id, amount: 0, reason: reasonText },
    })
    res.json({ ok: true })
  })

  app.post('/api/admin/contracts/:id/terminate-request', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      terminateDate: z.string().min(8),
      reason: z.string().min(1),
      remark: z.string().optional(),
      releaseHouseIds: z.array(z.string().min(1)).optional(),
      attachments: z
        .array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            file: z.string().min(1),
          }),
        )
        .optional()
        .default([]),
    })
    const body = Body.parse(req.body)
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: {
        house: { include: { apartment: true } },
        order: { include: { lines: { include: { house: true } } } },
      },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status !== 'ACTIVE') return res.status(409).json({ error: 'INVALID_STATUS' })
    if (contract.moveOutPendingJson) return res.status(409).json({ error: 'MOVEOUT_REQUEST_ALREADY_PENDING' })

    const order = contract.order
    const merged = Boolean(order?.isMergedBundle && order.lines.length > 0)
    const releaseIds = (body.releaseHouseIds ?? []).filter(Boolean)
    const partial =
      merged &&
      releaseIds.length > 0 &&
      releaseIds.length < order!.lines.filter((l) => !l.releasedAt).length

    if (merged && releaseIds.length > 0) {
      const activeLines = order!.lines.filter((l) => !l.releasedAt)
      const idSet = new Set(activeLines.map((l) => l.houseId))
      for (const hid of releaseIds) {
        if (!idSet.has(hid)) return res.status(400).json({ error: 'INVALID_RELEASE_HOUSE' })
      }
    }

    for (const a of body.attachments) {
      if (!/^[a-zA-Z0-9._-]+$/.test(a.file)) return res.status(400).json({ error: 'BAD_FILENAME' })
      const fp = path.join(MOVEOUT_UPLOAD_ROOT, contract.id, a.file)
      if (!fs.existsSync(fp)) return res.status(400).json({ error: 'MOVEOUT_FILE_MISSING' })
    }

    const reasonText = [`退租：${body.reason}`, body.remark && `备注：${body.remark}`].filter(Boolean).join('；')
    const now = new Date()
    const deadline = new Date(now.getTime() + 7 * 24 * 3600 * 1000)
    const pending: MoveOutPendingPayload = {
      version: 1,
      terminateDate: body.terminateDate,
      reasonFull: reasonText,
      releaseHouseIds: partial ? releaseIds : [],
      partial,
      attachments: body.attachments,
      deadlineAt: deadline.toISOString(),
      createdAt: now.toISOString(),
    }
    await ctx.prisma.contract.update({
      where: { id: contract.id },
      data: {
        status: 'WAIT_TENANT_MOVEOUT_SIGN',
        moveOutPendingJson: JSON.stringify(pending),
      },
    })
    res.json({ ok: true, deadlineAt: pending.deadlineAt, partial: pending.partial })
  })

  app.post('/api/admin/contracts/:id/cancel-move-out-request', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: { house: { include: { apartment: true } } },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status !== 'WAIT_TENANT_MOVEOUT_SIGN' || !contract.moveOutPendingJson) {
      return res.status(409).json({ error: 'NO_MOVEOUT_PENDING' })
    }
    let pending: MoveOutPendingPayload
    try {
      pending = JSON.parse(contract.moveOutPendingJson) as MoveOutPendingPayload
    } catch {
      return res.status(409).json({ error: 'BAD_PENDING' })
    }
    unlinkMoveOutFiles(contract.id, pending.attachments)
    await ctx.prisma.contract.update({
      where: { id: contract.id },
      data: { status: 'ACTIVE', moveOutPendingJson: null },
    })
    res.json({ ok: true })
  })

  /** 已生效合同退租须先走「发起退租确认」；本接口仅保留兼容，返回明确错误码 */
  app.post('/api/admin/contracts/:id/terminate', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: { house: { include: { apartment: true } } },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status === 'ACTIVE') {
      return res.status(409).json({ error: 'USE_TERMINATE_REQUEST' })
    }
    return res.status(409).json({ error: 'INVALID_STATUS' })
  })

  app.get('/api/admin/contracts/:id/refund-deposit-options', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: {
        house: { include: { apartment: true } },
        refunds: { select: { amount: true, reason: true }, orderBy: { createdAt: 'desc' } },
        bills: {
          include: { items: { orderBy: { createdAt: 'asc' } } },
          orderBy: [{ period: 'asc' }, { kind: 'asc' }],
        },
        payments: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status !== 'TERMINATED') return res.status(409).json({ error: 'DEPOSIT_REFUND_NEED_TERMINATED' })

    const { refundedDepositAmount } = getDepositRefundSummary(contract.refunds)
    const options = buildDepositRefundOptions({
      contractDeposit: contract.deposit,
      refundedAmount: refundedDepositAmount,
      changeHouseFromId: contract.changeHouseFromId,
      bills: contract.bills.map((b) => ({
        id: b.id,
        period: b.period,
        kind: b.kind,
        status: b.status,
        amountReceived: b.amountReceived,
        items: b.items.map((i) => ({ name: i.name, amount: i.amount })),
      })),
      payments: contract.payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        status: p.status,
        paidAt: p.paidAt,
      })),
    })
    res.json(options)
  })

  app.post('/api/admin/contracts/:id/refund-deposit', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      mode: z.enum(['FULL', 'SELECTED']),
      billIds: z.array(z.string().min(1)).optional(),
      includePayment: z.boolean().optional(),
      includeContractBalance: z.boolean().optional(),
      remark: z.string().max(200).optional(),
      refundTemplateCode: z.string().max(64).optional(),
    })
    const body = Body.parse(req.body)
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: {
        house: { include: { apartment: true } },
        refunds: { select: { amount: true, reason: true }, orderBy: { createdAt: 'desc' } },
        bills: {
          include: { items: { orderBy: { createdAt: 'asc' } } },
          orderBy: [{ period: 'asc' }, { kind: 'asc' }],
        },
        payments: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status !== 'TERMINATED') return res.status(409).json({ error: 'DEPOSIT_REFUND_NEED_TERMINATED' })

    const { refundedDepositAmount } = getDepositRefundSummary(contract.refunds)
    const options = buildDepositRefundOptions({
      contractDeposit: contract.deposit,
      refundedAmount: refundedDepositAmount,
      changeHouseFromId: contract.changeHouseFromId,
      bills: contract.bills.map((b) => ({
        id: b.id,
        period: b.period,
        kind: b.kind,
        status: b.status,
        amountReceived: b.amountReceived,
        items: b.items.map((i) => ({ name: i.name, amount: i.amount })),
      })),
      payments: contract.payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        status: p.status,
        paidAt: p.paidAt,
      })),
    })

    const resolved = resolveDepositRefundAmount({
      mode: body.mode,
      billIds: body.billIds ?? [],
      paymentSelected: Boolean(body.includePayment),
      balanceSelected: Boolean(body.includeContractBalance),
      options,
    })
    if (!resolved.ok) return res.status(409).json({ error: resolved.error })

    const tmpl =
      body.refundTemplateCode && DEPOSIT_REFUND_TEMPLATE_LABEL[body.refundTemplateCode]
        ? DEPOSIT_REFUND_TEMPLATE_LABEL[body.refundTemplateCode]
        : null
    const reason = [
      '退押金',
      `金额 ¥${resolved.amount}`,
      resolved.auditParts.length > 0 ? `来源：${resolved.auditParts.join('；')}` : null,
      tmpl && `模板：${tmpl}`,
      body.remark?.trim() && `备注：${body.remark.trim()}`,
    ]
      .filter(Boolean)
      .join('；')
    await ctx.prisma.refund.create({
      data: {
        contractId: contract.id,
        amount: resolved.amount,
        reason,
      },
    })
    res.json({ ok: true, amount: resolved.amount })
  })

  /** 续签资格：已生效 + 所有账单已结清 + 到期前 2 个月窗口内 */
  app.get('/api/admin/contracts/:id/renew-eligibility', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: { house: { include: { apartment: true } }, tenant: true },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (contract.status !== 'ACTIVE') {
      return res.json({
        eligible: false,
        reason: '仅「已生效」的合同可续签',
        tenant: {
          name: contract.tenant.name,
          phone: contract.tenant.phone,
          idNumber: contract.tenant.idNumber,
          wechat: contract.tenant.wechat ?? null,
        },
        previousContractNo: contract.contractNo,
      })
    }
    const unpaid = await ctx.prisma.bill.count({
      where: { contractId: contract.id, status: { in: ['UNPAID', 'OVERDUE'] } },
    })
    const openFrom = renewEarliestStartDate(contract.endDate)
    let eligible = unpaid === 0 && isRenewWithinTwoMonthWindow(contract.endDate)
    let reason: string | null = null
    if (unpaid > 0) {
      eligible = false
      reason = `尚有 ${unpaid} 期账单未结清，请先收租后再续签`
    } else if (!isRenewWithinTwoMonthWindow(contract.endDate)) {
      eligible = false
      reason = `续签最早可在 ${toYmd(openFrom)} 起发起（须在合同到期日 ${toYmd(contract.endDate)} 前 2 个月内操作）`
    }
    res.json({
      eligible,
      reason,
      tenant: {
        name: contract.tenant.name,
        phone: contract.tenant.phone,
        idNumber: contract.tenant.idNumber,
        wechat: contract.tenant.wechat ?? null,
      },
      previousContractNo: contract.contractNo,
      rentMonthly: contract.rentMonthly,
      depositMultiple: contract.depositMultiple,
      rentCycle: contract.rentCycle,
      penaltyFormula: contract.penaltyFormula,
    })
  })

  /**
   * 续签：旧合同结案（已终止），新订单+新合同（租客不变），需旧合同账单全部已付。
   * 新合同从「待租客签字」开始走流程。
   */
  app.post('/api/admin/contracts/:id/renew', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      leaseMonths: z.number().int().min(1).max(36),
      moveInDate: z.string().min(8),
      rentMonthly: z.number().int().positive().optional(),
      depositMultiple: z.number().positive().optional(),
      rentCycle: zRentCycle.optional(),
      rentDueDay: zRentDueDay.optional(),
      penaltyFormula: z.string().min(1).optional(),
      latestRentGraceDays: z.union([z.number().int().min(0).max(999), z.null()]).optional(),
      configRemarkHtml: z.string().nullable().optional(),
    })
    const body = Body.parse(req.body)

    const old = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: { house: { include: { apartment: true } }, order: true },
    })
    if (!old) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, old.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (old.status !== 'ACTIVE') return res.status(409).json({ error: 'RENEW_NEED_ACTIVE' })
    const unpaid = await ctx.prisma.bill.count({
      where: { contractId: old.id, status: { in: ['UNPAID', 'OVERDUE'] } },
    })
    if (unpaid > 0) return res.status(409).json({ error: 'BILLS_NOT_SETTLED' })
    if (!isRenewWithinTwoMonthWindow(old.endDate)) {
      return res.status(409).json({ error: 'RENEW_WINDOW_NOT_OPEN' })
    }

    const startDate = new Date(body.moveInDate)
    const endDate = addMonths(startDate, body.leaseMonths)
    const terminatedAt = new Date(startDate)
    terminatedAt.setDate(terminatedAt.getDate() - 1)
    terminatedAt.setHours(23, 59, 59, 999)

    const rentMonthly = body.rentMonthly ?? old.rentMonthly
    const depositMultiple = body.depositMultiple ?? old.depositMultiple
    const deposit = Math.round(rentMonthly * depositMultiple)
    const rentCycle = body.rentCycle ?? old.rentCycle
    const rentDueDay = normalizeRentDueDay(body.rentDueDay ?? old.rentDueDay, startDate)
    const contractNo = `C${new Date().getFullYear()}${String(Date.now()).slice(-8)}`
    const tenantSignDeadlineAt = computeRenewalTenantActionDeadline(startDate)

    const result = await ctx.prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          houseId: old.houseId,
          tenantId: old.tenantId,
          leaseMonths: body.leaseMonths,
          moveInDate: startDate,
          status: 'APPROVED',
        },
      })
      const nc = await tx.contract.create({
        data: {
          contractNo,
          houseId: old.houseId,
          tenantId: old.tenantId,
          orderId: newOrder.id,
          status: 'WAIT_TENANT_SIGN',
          startDate,
          endDate,
          rentMonthly,
          deposit,
          depositMultiple,
          rentCycle,
          penaltyFormula: body.penaltyFormula ?? old.penaltyFormula,
          rentDueDay,
          latestRentGraceDays:
            body.latestRentGraceDays !== undefined ? body.latestRentGraceDays : old.latestRentGraceDays,
          latestRentDueDate: null,
          renewedFromId: old.id,
          configRemarkHtml:
            body.configRemarkHtml === undefined ? null : body.configRemarkHtml || null,
          attachmentsJson: '[]',
          tenantSignDeadlineAt,
        },
      })
      await syncContractBaseRentBills(
        tx,
        {
          contractId: nc.id,
          startDate,
          leaseMonths: body.leaseMonths,
          rentMonthly,
          rentCycle,
          rentDueDay,
        },
        'create',
      )
      await tx.contract.update({
        where: { id: old.id },
        data: { status: 'TERMINATED', terminatedAt, endDate: terminatedAt },
      })
      await tx.refund.create({
        data: {
          contractId: old.id,
          amount: 0,
          reason: `续签结案，新合同 ${contractNo}（待租客签字）`,
        },
      })
      await tx.house.update({ where: { id: old.houseId }, data: { status: 'RESERVED' } })
      return { newContractId: nc.id, contractNo: nc.contractNo }
    })

    res.json({ ok: true, ...result })
  })

  /**
   * 换房：旧合同于「换房日」终止并释放旧房；生成新订单+新合同（新房）。
   * 合并合同可传 sourceHouseId 仅迁出其中一套，其余子资产留在原合同并自动重算后续账单。
   */
  app.post('/api/admin/contracts/:id/change-house', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      targetHouseId: z.string().min(1),
      moveDate: z.string().min(8),
      newStartDate: z.string().min(8),
      leaseMonths: z.number().int().min(1).max(36),
      newRentMonthly: z.number().int().positive(),
      newDeposit: z.number().int().nonnegative(),
      rentCycle: zRentCycle.optional(),
      penaltyFormula: z.string().min(1).optional(),
      latestRentGraceDays: z.union([z.number().int().min(0).max(999), z.null()]).optional(),
      /** 合并合同：指定迁出的子房源 houseId；不传表示整套换房 */
      sourceHouseId: z.string().min(1).optional(),
    })
    const body = Body.parse(req.body)

    if (body.newStartDate < body.moveDate) {
      return res.status(400).json({ error: 'NEW_START_BEFORE_MOVE' })
    }

    const old = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: {
        house: { include: { apartment: true } },
        order: { include: { lines: { include: { house: { include: { apartment: true } } } } } },
      },
    })
    if (!old) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, old.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (old.status !== 'ACTIVE') return res.status(409).json({ error: 'CHANGE_HOUSE_NEED_ACTIVE' })

    const unpaid = await ctx.prisma.bill.count({
      where: { contractId: old.id, status: { in: ['UNPAID', 'OVERDUE'] } },
    })
    if (unpaid > 0) return res.status(409).json({ error: 'BILLS_NOT_SETTLED' })

    const merged = Boolean(old.order?.isMergedBundle && (old.order.lines?.length ?? 0) > 0)
    const activeLines = merged ? old.order!.lines.filter((l) => !l.releasedAt) : []
    const activeHouseIds = new Set(merged ? activeLines.map((l) => l.houseId) : [old.houseId])
    if (activeHouseIds.has(body.targetHouseId)) {
      return res.status(400).json({ error: 'SAME_HOUSE' })
    }

    if (body.sourceHouseId && !merged) {
      return res.status(400).json({ error: 'SOURCE_HOUSE_NEED_MERGED' })
    }
    if (body.sourceHouseId && merged) {
      const hit = activeLines.find((l) => l.houseId === body.sourceHouseId)
      if (!hit) return res.status(400).json({ error: 'INVALID_SOURCE_HOUSE' })
    }

    const target = await ctx.prisma.house.findUnique({
      where: { id: body.targetHouseId },
      include: { apartment: true },
    })
    if (!target) return res.status(404).json({ error: 'TARGET_NOT_FOUND' })
    if (target.status !== 'VACANT') return res.status(409).json({ error: 'TARGET_NOT_VACANT' })
    if (!canAccessStore(auth, target.apartment.storeId)) return res.status(403).json({ error: 'TARGET_FORBIDDEN' })
    if (target.apartment.storeId !== old.house.apartment.storeId) {
      return res.status(409).json({ error: 'CROSS_STORE_NOT_ALLOWED' })
    }

    const moveEnd = new Date(`${body.moveDate}T23:59:59.999`)
    const moveYm = moveMonthPeriod(moveEnd)
    const newStart = new Date(body.newStartDate)
    const newEnd = addMonths(newStart, body.leaseMonths)
    const contractNo = `C${new Date().getFullYear()}${String(Date.now()).slice(-8)}`
    const depMul =
      body.newRentMonthly > 0 ? Math.round((body.newDeposit / body.newRentMonthly) * 100) / 100 : 1

    const newRent = body.newRentMonthly
    const newDep = body.newDeposit
    const partial =
      merged &&
      Boolean(body.sourceHouseId) &&
      activeLines.length > 1

    const oldDepForSupplement = partial
      ? (activeLines.find((l) => l.houseId === body.sourceHouseId)!.depositSnapshot ?? 0)
      : old.deposit

    const supplementItems: { name: string; amount: number }[] = []
    const depDiff = newDep - oldDepForSupplement
    if (depDiff > 0) {
      supplementItems.push({
        name: `换房—押金补足（新¥${newDep} − 迁出子资产押金¥${oldDepForSupplement}）`,
        amount: depDiff,
      })
    }

    const supplementTotal = supplementItems.reduce((s, x) => s + x.amount, 0)
    const supplementPeriod = `换房补差-${Date.now()}`
    const tenantSignDeadlineAt = computeTenantSignDeadline()

    const out = await ctx.prisma.$transaction(async (tx) => {
      const billsBeforeChange = await tx.bill.findMany({
        where: { contractId: old.id },
        select: { period: true, kind: true, status: true, totalAmount: true },
      })

      const persistChangeHouseMoneyJson = async (
        newContractId: string,
        opt: {
          prepaidSkippedReason: string | null
          prepaid: { credit: number; sources: { period: string; amount: number }[] }
          applied: { period: string; amount: number }[]
          remainingCredit: number
        },
      ) => {
        const snap = buildChangeHouseMoneySnapshot({
          moveDateYmd: body.moveDate,
          moveEnd,
          old: { id: old.id, contractNo: old.contractNo },
          prepaid: opt.prepaid,
          applied: opt.applied,
          remainingCredit: opt.remainingCredit,
          depositSupplement: supplementTotal,
          prepaidSkippedReason: opt.prepaidSkippedReason,
        })
        await tx.contract.update({
          where: { id: newContractId },
          data: { changeHouseMoneyJson: JSON.stringify(snap) },
        })
      }

      const createNewContractAndBills = async () => {
        const newOrder = await tx.order.create({
          data: {
            houseId: target.id,
            tenantId: old.tenantId,
            leaseMonths: body.leaseMonths,
            moveInDate: newStart,
            status: 'APPROVED',
          },
        })

        const nc = await tx.contract.create({
          data: {
            contractNo,
            houseId: target.id,
            tenantId: old.tenantId,
            orderId: newOrder.id,
            status: 'WAIT_TENANT_SIGN',
            startDate: newStart,
            endDate: newEnd,
            rentMonthly: newRent,
            deposit: newDep,
            depositMultiple: depMul,
            rentCycle: body.rentCycle ?? old.rentCycle,
            penaltyFormula: body.penaltyFormula ?? old.penaltyFormula,
            rentDueDay: old.rentDueDay,
            latestRentGraceDays:
              body.latestRentGraceDays !== undefined ? body.latestRentGraceDays : old.latestRentGraceDays,
            latestRentDueDate: null,
            changeHouseFromId: old.id,
            tenantSignDeadlineAt,
          },
        })

        await syncContractBaseRentBills(
          tx,
          {
            contractId: nc.id,
            startDate: newStart,
            leaseMonths: body.leaseMonths,
            rentMonthly: newRent,
            rentCycle: body.rentCycle ?? old.rentCycle,
            rentDueDay: old.rentDueDay,
          },
          'create',
        )

        await syncBaseRentBillItemsForContract(tx, {
          contractId: nc.id,
          orderId: newOrder.id,
          rentMonthly: newRent,
        })

        if (supplementTotal > 0) {
          const sb = await tx.bill.create({
            data: {
              contractId: nc.id,
              period: supplementPeriod,
              dueDate: newStart,
              totalAmount: supplementTotal,
              status: 'UNPAID',
              kind: 'ADJUSTMENT',
            },
          })
          for (const it of supplementItems) {
            await tx.billItem.create({
              data: { billId: sb.id, name: it.name, amount: it.amount },
            })
          }
        }

        await tx.house.update({ where: { id: target.id }, data: { status: 'RESERVED' } })

        return {
          newContractId: nc.id,
          contractNo: nc.contractNo,
          supplementBillCreated: supplementTotal > 0,
          supplementTotal,
          supplementItems,
        }
      }

      if (partial && body.sourceHouseId) {
        const srcLine = activeLines.find((l) => l.houseId === body.sourceHouseId)!
        const created = await createNewContractAndBills()
        await tx.orderLine.updateMany({
          where: { orderId: old.order!.id, houseId: body.sourceHouseId, releasedAt: null },
          data: { releasedAt: moveEnd, changeHouseNewContractId: created.newContractId },
        })
        await tx.house.update({ where: { id: body.sourceHouseId }, data: { status: 'VACANT' } })
        const after = await tx.orderLine.findMany({
          where: { orderId: old.order!.id, releasedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        })
        if (after.length === 0) throw new Error('NO_ACTIVE_LINES')
        const rentSum = after.reduce((s, l) => s + l.rentMonthlySnapshot, 0)
        const depSum = after.reduce((s, l) => s + l.depositSnapshot, 0)
        await tx.contract.update({
          where: { id: old.id },
          data: {
            houseId: after[0]!.houseId,
            rentMonthly: rentSum,
            deposit: depSum,
          },
        })
        await reconcileBaseBillsAfterMergedLineRelease(tx, {
          contractId: old.id,
          orderId: old.order!.id,
          rentMonthly: rentSum,
          moveEnd,
          leaseEnd: old.endDate,
        })
        await tx.refund.create({
          data: {
            contractId: old.id,
            amount: 0,
            reason: `部分换房：迁出 ${srcLine.house.apartment.name} ${srcLine.house.houseNo} → 新签 ${target.apartment.name} ${target.houseNo}，新合同 ${contractNo}`,
          },
        })
        await persistChangeHouseMoneyJson(created.newContractId, {
          prepaidSkippedReason: '合并合同部分换房：旧合同仍在租，预付租金跨合同结转需人工核对。',
          prepaid: { credit: 0, sources: [] },
          applied: [],
          remainingCredit: 0,
        })
        return { ...created, partial: true as const }
      }

      await tx.contract.update({
        where: { id: old.id },
        data: { status: 'TERMINATED', terminatedAt: moveEnd, endDate: moveEnd },
      })
      if (merged && old.order) {
        await tx.orderLine.updateMany({
          where: { orderId: old.order.id, releasedAt: null },
          data: { releasedAt: moveEnd },
        })
        for (const l of old.order.lines) {
          await tx.house.update({ where: { id: l.houseId }, data: { status: 'TERMINATED' } })
        }
      } else {
        await tx.house.update({ where: { id: old.houseId }, data: { status: 'TERMINATED' } })
      }
      await tx.refund.create({
        data: {
          contractId: old.id,
          amount: 0,
          reason: `换房结案：${body.moveDate} 迁出 ${old.house.apartment.name} ${old.house.houseNo} → 新签 ${target.apartment.name} ${target.houseNo}，新合同 ${contractNo}`,
        },
      })

      const created = await createNewContractAndBills()
      const prepaid = computePrepaidRentCredit(billsBeforeChange, moveYm)
      const { applied, remainingCredit } = await applyPrepaidRentCreditToNewContract(tx, {
        newContractId: created.newContractId,
        credit: prepaid.credit,
      })
      await persistChangeHouseMoneyJson(created.newContractId, {
        prepaidSkippedReason: null,
        prepaid,
        applied,
        remainingCredit,
      })
      return { ...created, partial: false as const }
    })

    res.json({ ok: true, ...out })
  })

  app.post('/api/admin/contracts/:id/stamp', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.id) },
      include: { house: { include: { apartment: true } } },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })

    // 只有租客确认后才能盖章
    if (!contract.confirmedAt || contract.status !== 'WAIT_STAMP') {
      return res.status(409).json({ error: 'NEED_TENANT_SIGN_FIRST' })
    }

    // MVP：模拟调用“盖章/签章服务”
    const updated = await ctx.prisma.contract.update({
      where: { id: contract.id },
      data: { stampedAt: contract.stampedAt ?? new Date(), status: 'PENDING_PAYMENT' },
    })
    res.json({ ok: true, stampedAt: updated.stampedAt?.toISOString(), status: updated.status })
  })

  app.get('/api/admin/bills/overdue', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const today = new Date()
    const bills = await ctx.prisma.bill.findMany({
      where: { dueDate: { lt: today }, status: { in: ['UNPAID', 'OVERDUE'] } },
      include: {
        contract: { include: { tenant: true, house: { include: { apartment: { include: { store: true } } } } } },
        arrears: true,
      },
      orderBy: { dueDate: 'asc' },
      take: 200,
    })

    const visible = bills.filter((b) => canAccessStore(auth, b.contract.house.apartment.storeId))
    const items = []
    for (const b of visible) {
      const daysOverdue = Math.max(0, Math.floor((today.getTime() - b.dueDate.getTime()) / (24 * 3600 * 1000)))
      const paused = isContractBillingPaused(b.contract)
      const penalty = paused ? 0 : computePenalty(b.totalAmount, daysOverdue)
      items.push({
        billId: b.id,
        contractNo: b.contract.contractNo,
        houseBizId: houseBizId(b.contract.house.id),
        apartmentName: b.contract.house.apartment.name,
        houseNo: b.contract.house.houseNo,
        storeName: b.contract.house.apartment.store.name,
        projectName: b.contract.house.projectName,
        rentCollectionUnit: b.contract.house.rentCollectionUnit,
        managerName: b.contract.house.managerName,
        assetType: b.contract.house.apartment.assetType,
        tenantName: b.contract.tenant.name,
        tenantPhone: b.contract.tenant.phone,
        period: b.period,
        dueDate: toYmd(b.dueDate),
        totalAmount: b.totalAmount,
        daysOverdue,
        penalty,
      })

      if (!paused && !b.arrears && daysOverdue > 0) {
        await ctx.prisma.arrears.create({
          data: { billId: b.id, daysOverdue, penalty },
        })
        await ctx.prisma.bill.update({ where: { id: b.id }, data: { status: 'OVERDUE' } })
      }
    }

    res.json({ items, rule: 'MVP：滞纳金=账单金额*0.1%*逾期天数（可替换为客户公式）' })
  })

  /**
   * 催租短信（演示）：创建一条催租台账记录
   * - 仅针对 UNPAID/OVERDUE 的账单
   * - 不对接真实短信服务，仅记录“发送时间+内容”
   */
  app.post('/api/admin/bills/:id/send-rent-reminder', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      message: z.string().min(1).max(500),
      penaltySnapshot: z.number().int().min(0).optional(),
    })
    const body = Body.safeParse(req.body)
    if (!body.success) return res.status(400).json({ error: 'INVALID_BODY', details: body.error.flatten() })

    const bill = await ctx.prisma.bill.findUnique({
      where: { id: String(req.params.id) },
      include: {
        contract: { include: { tenant: true, house: { include: { apartment: { include: { store: true } } } } } },
      },
    })
    if (!bill) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, bill.contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (bill.status !== 'UNPAID' && bill.status !== 'OVERDUE') return res.status(409).json({ error: 'INVALID_STATUS' })

    const penalty = body.data.penaltySnapshot ?? 0
    const totalDue = bill.totalAmount + penalty
    const sentAt = new Date()

    const rr = await ctx.prisma.rentReminder.create({
      data: {
        billId: bill.id,
        contractId: bill.contractId,
        period: bill.period,
        dueDate: bill.dueDate,
        billAmount: bill.totalAmount,
        penalty,
        totalDue,
        tenantName: bill.contract.tenant.name,
        tenantPhone: bill.contract.tenant.phone,
        storeName: bill.contract.house.apartment.store.name,
        apartmentName: bill.contract.house.apartment.name,
        houseNo: bill.contract.house.houseNo,
        message: body.data.message.trim(),
        sentAt,
        sentByAdminId: auth.admin.id,
      },
    })

    // demo: 模拟发送成功（真实项目可在此对接短信服务并记录回执）
    console.log('[DEMO_SMS]', {
      to: rr.tenantPhone,
      name: rr.tenantName,
      billId: rr.billId,
      period: rr.period,
      message: rr.message,
    })

    res.json({ ok: true, id: rr.id, sentAt: rr.sentAt.toISOString() })
  })

  /** 催租记录台账：用于查询追溯 */
  app.get('/api/admin/rent-reminders', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const list = await ctx.prisma.rentReminder.findMany({
      orderBy: { sentAt: 'desc' },
      take: 500,
    })
    // 以门店名作为快照字段，避免额外 join；同时仍需按门店权限过滤（通过 bill->contract->store 校验）
    const billIds = Array.from(new Set(list.map((x) => x.billId)))
    const bills = await ctx.prisma.bill.findMany({
      where: { id: { in: billIds } },
      include: { contract: { include: { house: { include: { apartment: true } } } } },
    })
    const billStoreMap = new Map(bills.map((b) => [b.id, b.contract.house.apartment.storeId]))
    const visible = list.filter((x) => {
      const storeId = billStoreMap.get(x.billId)
      if (!storeId) return false
      return canAccessStore(auth, storeId)
    })
    res.json({
      items: visible.map((x) => ({
        id: x.id,
        sentAt: x.sentAt.toISOString(),
        billId: x.billId,
        contractId: x.contractId,
        period: x.period,
        dueDate: toYmd(x.dueDate),
        billAmount: x.billAmount,
        penalty: x.penalty,
        totalDue: x.totalDue,
        tenantName: x.tenantName,
        tenantPhone: x.tenantPhone,
        storeName: x.storeName,
        apartmentName: x.apartmentName,
        houseNo: x.houseNo,
        message: x.message,
      })),
    })
  })

  // 账期汇总（按门店+账期）
  app.get('/api/admin/bill-periods', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const bills = await ctx.prisma.bill.findMany({
      include: {
        contract: { include: { tenant: true, house: { include: { apartment: { include: { store: true } } } } } },
      },
      orderBy: [{ period: 'desc' }, { dueDate: 'desc' }],
      take: 600,
    })
    const visible = bills.filter((b) => {
      // 过滤掉用于演示的「换房补差」等非标准账期；标准账期为 YYYY-MM 或 YYYY-MM-DD
      if (!/^\d{4}-\d{2}(-\d{2})?$/.test(b.period)) return false
      if (!canAccessStore(auth, b.contract.house.apartment.storeId)) return false
      if (isContractBillingPaused(b.contract)) return false
      return true
    })
    type Agg = {
      storeId: string
      storeName: string
      period: string
      contractIds: Set<string>
      billCount: number
      totalAmount: number
      dueFrom: Date
      dueTo: Date
    }
    const map = new Map<string, Agg>()
    for (const b of visible) {
      const storeId = b.contract.house.apartment.storeId
      const storeName = b.contract.house.apartment.store.name
      const key = `${storeId}__${b.period}`
      const due = b.dueDate
      if (!map.has(key)) {
        map.set(key, {
          storeId,
          storeName,
          period: b.period,
          contractIds: new Set<string>([b.contractId]),
          billCount: 1,
          totalAmount: b.totalAmount,
          dueFrom: due,
          dueTo: due,
        })
      } else {
        const a = map.get(key)!
        a.contractIds.add(b.contractId)
        a.billCount += 1
        a.totalAmount += b.totalAmount
        if (due < a.dueFrom) a.dueFrom = due
        if (due > a.dueTo) a.dueTo = due
      }
    }

    const locks = await ctx.prisma.billPeriod.findMany({ take: 1000 })
    const lockMap = new Map<string, (typeof locks)[number]>()
    for (const l of locks) lockMap.set(`${l.storeId}__${l.period}`, l)

    const lockAdminIds = Array.from(
      new Set(locks.map((l) => l.lockedByAdminId).filter((x): x is string => Boolean(x))),
    )
    const lockAdmins =
      lockAdminIds.length > 0
        ? await ctx.prisma.admin.findMany({
            where: { id: { in: lockAdminIds } },
            select: { id: true, name: true },
          })
        : []
    const lockAdminNameById = new Map(lockAdmins.map((a) => [a.id, a.name]))

    const out = Array.from(map.values())
      .map((a) => {
        const lock = lockMap.get(`${a.storeId}__${a.period}`)
        const locked = Boolean(lock?.lockedAt)
        const lockedByName =
          lock?.lockedByAdminId && lockAdminNameById.get(lock.lockedByAdminId)
            ? lockAdminNameById.get(lock.lockedByAdminId)!
            : null
        return {
          storeId: a.storeId,
          storeName: a.storeName,
          period: a.period,
          contractCount: locked ? lock?.snapshotContractCount ?? a.contractIds.size : a.contractIds.size,
          billCount: locked ? lock?.snapshotBillCount ?? a.billCount : a.billCount,
          totalAmount: locked ? lock?.snapshotTotalAmount ?? a.totalAmount : a.totalAmount,
          dueDateFrom: locked
            ? lock?.snapshotDueDateFrom
              ? toYmd(lock.snapshotDueDateFrom)
              : toYmd(a.dueFrom)
            : toYmd(a.dueFrom),
          dueDateTo: locked
            ? lock?.snapshotDueDateTo
              ? toYmd(lock.snapshotDueDateTo)
              : toYmd(a.dueTo)
            : toYmd(a.dueTo),
          locked,
          lockedAt: lock?.lockedAt ? lock.lockedAt.toISOString() : null,
          lockedByName,
        }
      })
      .sort((x, y) => (x.period < y.period ? 1 : x.period > y.period ? -1 : x.storeName.localeCompare(y.storeName)))

    res.json({ items: out })
  })

  // 账期明细（按门店+账期）
  app.get('/api/admin/bill-periods/:storeId/:period', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const storeId = String(req.params.storeId)
    const period = String(req.params.period)
    if (!storeId || !period) return res.status(400).json({ error: 'BAD_PARAMS' })
    if (!canAccessStore(auth, storeId)) return res.status(403).json({ error: 'FORBIDDEN' })

    const qContractNo = String(req.query.contractNo ?? '').trim()
    const qTenantName = String(req.query.tenantName ?? '').trim()
    const qTenantIdNumber = String(req.query.tenantIdNumber ?? '').trim()
    const qTenantPhone = String(req.query.tenantPhone ?? '').trim()
    const qAssetName = String(req.query.assetName ?? '').trim()
    const qStatus = String(req.query.status ?? '').trim()
    const qDueFrom = String(req.query.dueDateFrom ?? '').trim()
    const qDueTo = String(req.query.dueDateTo ?? '').trim()
    const qKeyword = String(req.query.keyword ?? '').trim()

    const contractWhere: Prisma.ContractWhereInput = {
      house: { apartment: { storeId } },
    }
    if (qContractNo) contractWhere.contractNo = { contains: qContractNo }
    if (qTenantName || qTenantIdNumber || qTenantPhone) {
      contractWhere.tenant = {
        ...(qTenantName ? { name: { contains: qTenantName } } : {}),
        ...(qTenantIdNumber ? { idNumber: { contains: qTenantIdNumber } } : {}),
        ...(qTenantPhone ? { phone: { contains: qTenantPhone } } : {}),
      }
    }
    if (qAssetName) {
      contractWhere.house = {
        apartment: { storeId },
        OR: [
          { apartment: { name: { contains: qAssetName } } },
          { houseNo: { contains: qAssetName } },
          { projectName: { contains: qAssetName } },
        ],
      }
    }

    const billWhere: Prisma.BillWhereInput = {
      period,
      contract: contractWhere,
    }
    if (qStatus && (qStatus === 'UNPAID' || qStatus === 'PAID' || qStatus === 'OVERDUE')) {
      billWhere.status = qStatus
    }
    const dueRange: { gte?: Date; lte?: Date } = {}
    if (qDueFrom) {
      const d = new Date(`${qDueFrom}T00:00:00.000Z`)
      if (!Number.isNaN(d.getTime())) dueRange.gte = d
    }
    if (qDueTo) {
      const d = new Date(`${qDueTo}T23:59:59.999Z`)
      if (!Number.isNaN(d.getTime())) dueRange.lte = d
    }
    if (dueRange.gte || dueRange.lte) billWhere.dueDate = dueRange

    const bills = await ctx.prisma.bill.findMany({
      where: billWhere,
      include: {
        contract: { include: { tenant: true, house: { include: { apartment: { include: { store: true } } } } } },
        items: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { totalAmount: 'desc' },
      take: 600,
    })
    const visible = bills.filter((b) => b.contract.house.apartment.storeId === storeId)

    const kw = qKeyword.toLowerCase()
    const visibleFiltered =
      kw.length === 0
        ? visible
        : visible.filter((b) => {
            const hay = [
              b.id,
              b.contract.contractNo,
              b.contract.tenant.name,
              b.contract.tenant.phone,
              b.contract.tenant.idNumber,
              houseBizId(b.contract.house.id),
              b.contract.house.apartment.name,
              b.contract.house.houseNo,
            ]
              .join(' ')
              .toLowerCase()
            return hay.includes(kw)
          })

    const periodLock = await ctx.prisma.billPeriod.findUnique({
      where: { storeId_period: { storeId, period } },
    })
    const lockAdmin = periodLock?.lockedByAdminId
      ? await ctx.prisma.admin.findUnique({
          where: { id: periodLock.lockedByAdminId },
          select: { name: true },
        })
      : null

    res.json({
      items: visibleFiltered.map((b) => ({
        id: b.id,
        contractId: b.contractId,
        contractNo: b.contract.contractNo,
        houseBizId: houseBizId(b.contract.house.id),
        apartmentName: b.contract.house.apartment.name,
        houseNo: b.contract.house.houseNo,
        storeName: b.contract.house.apartment.store.name,
        tenantName: b.contract.tenant.name,
        tenantPhone: b.contract.tenant.phone,
        tenantIdNumber: b.contract.tenant.idNumber,
        period: b.period,
        dueDate: toYmd(b.dueDate),
        totalAmount: b.totalAmount,
        amountReceived: b.amountReceived,
        amountRemaining: Math.max(0, b.totalAmount - b.amountReceived),
        status: b.status,
        billingRemark: b.billingRemark ?? null,
        contractBillingPaused: isContractBillingPaused(b.contract),
        tenantPushStatus: b.tenantPushStatus,
        tenantPushStatusLabel: tenantPushStatusLabel(b.tenantPushStatus),
        billPushToTenant: b.contract.billPushToTenant,
        items: b.items.map((i) => ({ name: i.name, amount: i.amount })),
      })),
      locked: Boolean(periodLock?.lockedAt),
      lockedAt: periodLock?.lockedAt ? periodLock.lockedAt.toISOString() : null,
      lockedByName: lockAdmin?.name ?? null,
    })
  })

  // 锁定账期（不可解锁）
  app.post('/api/admin/bill-periods/:storeId/:period/lock', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const storeId = String(req.params.storeId)
    const period = String(req.params.period)
    if (!storeId || !period) return res.status(400).json({ error: 'BAD_PARAMS' })
    if (!canAccessStore(auth, storeId)) return res.status(403).json({ error: 'FORBIDDEN' })

    const existing = await ctx.prisma.billPeriod.findUnique({ where: { storeId_period: { storeId, period } } })
    if (existing?.lockedAt) return res.status(409).json({ error: 'ALREADY_LOCKED' })

    const bills = await ctx.prisma.bill.findMany({
      where: { period },
      include: { contract: { include: { house: { include: { apartment: true } } } } },
      take: 800,
    })
    const visible = bills.filter((b) => b.contract.house.apartment.storeId === storeId)
    const contractIds = new Set(visible.map((b) => b.contractId))
    const billCount = visible.length
    const totalAmount = visible.reduce((s, b) => s + b.totalAmount, 0)
    const dueDates = visible.map((b) => b.dueDate).sort((a, b) => (a < b ? -1 : 1))
    const dueFrom = dueDates[0] ?? new Date(`${period}-01`)
    const dueTo = dueDates[dueDates.length - 1] ?? dueFrom

    const now = new Date()
    await ctx.prisma.billPeriod.upsert({
      where: { storeId_period: { storeId, period } },
      create: {
        storeId,
        period,
        lockedAt: now,
        lockedByAdminId: auth.admin.id,
        snapshotContractCount: contractIds.size,
        snapshotBillCount: billCount,
        snapshotTotalAmount: totalAmount,
        snapshotDueDateFrom: dueFrom,
        snapshotDueDateTo: dueTo,
      },
      update: {
        lockedAt: now,
        lockedByAdminId: auth.admin.id,
        snapshotContractCount: contractIds.size,
        snapshotBillCount: billCount,
        snapshotTotalAmount: totalAmount,
        snapshotDueDateFrom: dueFrom,
        snapshotDueDateTo: dueTo,
      },
    })
    res.json({ ok: true, lockedAt: now.toISOString() })
  })

  /**
   * 新建账期账单（BASE 租金）
   * - 指定门店 + 账期，为租期覆盖该月的生效合同补建缺失的 BASE 账单
   * - statStartDate 用于记录统计开始时间（展示与审计）
   */
  app.post('/api/admin/bill-periods/generate', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      mode: z.literal('manual'),
      storeId: z.string().min(1),
      period: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
      statStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    const parsed = Body.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'BAD_BODY' })

    const { storeId, period, statStartDate, dueDate } = parsed.data
    if (!canAccessStore(auth, storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (await isBillPeriodLocked(ctx.prisma, storeId, period)) {
      return res.status(409).json({ error: 'PERIOD_LOCKED' })
    }

    const parts = period.split('-').map(Number)
    const defaultDue =
      parts.length === 3
        ? new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!))
        : new Date(Date.UTC(parts[0]!, parts[1]! - 1, 1))
    const due = dueDate ? new Date(`${dueDate}T12:00:00.000Z`) : defaultDue
    const statFrom = new Date(`${statStartDate}T12:00:00.000Z`)

    const contracts = await ctx.prisma.contract.findMany({
      where: { status: 'ACTIVE', house: { apartment: { storeId } } },
      take: 3000,
    })

    let created = 0
    let skippedExisting = 0
    let skippedOutOfLease = 0

    for (const c of contracts) {
      if (isContractBillingPaused(c)) {
        skippedOutOfLease += 1
        continue
      }
      if (!periodOverlapsLease(c.startDate, c.endDate, period)) {
        skippedOutOfLease += 1
        continue
      }
      const existing = await ctx.prisma.bill.findUnique({
        where: { contractId_period_kind: { contractId: c.id, period, kind: 'BASE' } },
      })
      if (existing) {
        skippedExisting += 1
        continue
      }
      await ctx.prisma.bill.create({
        data: {
          contractId: c.id,
          period,
          dueDate: due,
          totalAmount: c.rentMonthly,
          status: 'UNPAID',
          kind: 'BASE',
        },
      })
      created += 1
    }

    res.json({
      ok: true,
      mode: 'manual',
      created,
      skippedExisting,
      skippedOutOfLease,
      contractsScanned: contracts.length,
      statStartDate: toYmd(statFrom),
      dueDate: toYmd(due),
    })
  })

  app.get('/api/admin/bills', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const bills = await ctx.prisma.bill.findMany({
      include: {
        contract: {
          include: { tenant: true, house: { include: { apartment: { include: { store: true } } } } },
        },
      },
      orderBy: { dueDate: 'desc' },
      take: 300,
    })
    const visible = bills.filter((b) => canAccessStore(auth, b.contract.house.apartment.storeId))
    res.json({
      items: visible.map((b) => ({
        id: b.id,
        contractNo: b.contract.contractNo,
        houseBizId: houseBizId(b.contract.house.id),
        apartmentName: b.contract.house.apartment.name,
        houseNo: b.contract.house.houseNo,
        storeName: b.contract.house.apartment.store.name,
        projectName: b.contract.house.projectName,
        rentCollectionUnit: b.contract.house.rentCollectionUnit,
        managerName: b.contract.house.managerName,
        assetType: b.contract.house.apartment.assetType,
        tenantName: b.contract.tenant.name,
        tenantPhone: b.contract.tenant.phone,
        period: b.period,
        dueDate: toYmd(b.dueDate),
        totalAmount: b.totalAmount,
        amountReceived: b.amountReceived,
        amountRemaining: Math.max(0, b.totalAmount - b.amountReceived),
        status: b.status,
        billingRemark: b.billingRemark ?? null,
        tenantPushStatus: b.tenantPushStatus,
        tenantPushStatusLabel: tenantPushStatusLabel(b.tenantPushStatus),
        billPushToTenant: b.contract.billPushToTenant,
      })),
    })
  })

  /** 线下核销记录：用于审计/追溯与附件查看 */
  app.get('/api/admin/bills/offline-verifications', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const bills = await ctx.prisma.bill.findMany({
      where: { offlineVerifiedAt: { not: null } },
      include: {
        contract: {
          include: { tenant: true, house: { include: { apartment: { include: { store: true } } } } },
        },
      },
      orderBy: { offlineVerifiedAt: 'desc' },
      take: 400,
    })
    const visible = bills.filter((b) => canAccessStore(auth, b.contract.house.apartment.storeId))
    res.json({
      items: visible.map((b) => {
        const atts = parseBillVerifyAttachmentsJson(b.offlineVerifyAttachmentsJson)
        const attUrls = (f: string) => ({
          previewUrl: `/api/admin/bills/${b.id}/offline-verify-attachment/${encodeURIComponent(f)}`,
          downloadUrl: `/api/admin/bills/${b.id}/offline-verify-attachment/${encodeURIComponent(f)}?download=1`,
        })
        return {
          billId: b.id,
          contractNo: b.contract.contractNo,
          houseBizId: houseBizId(b.contract.house.id),
          apartmentName: b.contract.house.apartment.name,
          houseNo: b.contract.house.houseNo,
          storeName: b.contract.house.apartment.store.name,
          tenantName: b.contract.tenant.name,
          tenantPhone: b.contract.tenant.phone,
          period: b.period,
          dueDate: toYmd(b.dueDate),
          totalAmount: b.totalAmount,
          status: b.status,
          paidAt: b.paidAt ? b.paidAt.toISOString() : null,
          offlineVerifiedAt: b.offlineVerifiedAt ? b.offlineVerifiedAt.toISOString() : null,
          offlineVerifiedRemark: b.offlineVerifiedRemark ?? null,
          offlineVerifyAttachments: atts.map((a) => ({ id: a.id, name: a.name, file: a.file, ...attUrls(a.file) })),
        }
      }),
    })
  })

  app.get('/api/admin/bills/import-template', adminAuth(ctx.prisma), (_req, res) => {
    const buf = buildBillImportTemplateBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('账单导入模板.xlsx')}`)
    res.send(buf)
  })

  app.post('/api/admin/bills/import', adminAuth(ctx.prisma), upload.single('file'), async (req, res) => {
    const auth = getAdminAuth(req)
    const file = (req as any).file
    if (!file || !file.buffer) return res.status(400).json({ error: '请上传 Excel 文件', created: 0, errors: [] })
    const result = await parseAndImportBills(ctx.prisma, file.buffer, (storeId) => canAccessStore(auth, storeId))
    res.json({ ok: true, ...result })
  })

  app.get('/api/admin/bills/offline-verify-batch-template', adminAuth(ctx.prisma), (_req, res) => {
    const buf = buildOfflineVerifyBatchTemplateBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('批量核销模板.xlsx')}`)
    res.send(buf)
  })

  app.post('/api/admin/bills/offline-verify-batch', adminAuth(ctx.prisma), upload.single('file'), async (req, res) => {
    const auth = getAdminAuth(req)
    const file = (req as any).file
    if (!file || !file.buffer)
      return res.status(400).json({ error: '请上传 Excel 文件', ok: false, verified: 0, errors: ['请上传 Excel 文件'] })
    const result = await parseAndBatchOfflineVerify(ctx.prisma, file.buffer, auth.admin.id, (storeId) =>
      canAccessStore(auth, storeId),
    )
    res.json({ ok: true, verified: result.verified, errors: result.errors })
  })

  app.get('/api/admin/bills/:id', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const bill = await ctx.prisma.bill.findUnique({
      where: { id: String(req.params.id) },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        contract: {
          include: {
            tenant: true,
            house: { include: { apartment: { include: { store: true } } } },
          },
        },
        changeLogs: { orderBy: { changedAt: 'desc' }, include: { admin: true } },
      },
    })
    if (!bill) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, bill.contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    const atts = parseBillVerifyAttachmentsJson((bill as any).offlineVerifyAttachmentsJson)
    const attUrls = (f: string) => ({
      previewUrl: `/api/admin/bills/${bill.id}/offline-verify-attachment/${encodeURIComponent(f)}`,
      downloadUrl: `/api/admin/bills/${bill.id}/offline-verify-attachment/${encodeURIComponent(f)}?download=1`,
    })
    const prep = await ctx.prisma.contractCredit.findUnique({
      where: { contractId: bill.contractId },
      select: { balanceAmount: true },
    })
    res.json({
      id: bill.id,
      contractNo: bill.contract.contractNo,
      houseBizId: houseBizId(bill.contract.house.id),
      apartmentName: bill.contract.house.apartment.name,
      houseNo: bill.contract.house.houseNo,
      storeName: bill.contract.house.apartment.store.name,
      tenantName: bill.contract.tenant.name,
      tenantPhone: bill.contract.tenant.phone,
      tenantIdNumber: bill.contract.tenant.idNumber,
      period: bill.period,
      dueDate: toYmd(bill.dueDate),
      totalAmount: bill.totalAmount,
      amountReceived: bill.amountReceived,
      amountRemaining: Math.max(0, bill.totalAmount - bill.amountReceived),
      contractPrepayBalance: prep?.balanceAmount ?? 0,
      status: bill.status,
      paidAt: bill.paidAt ? bill.paidAt.toISOString() : null,
      offlineVerifiedAt: (bill as any).offlineVerifiedAt ? (bill as any).offlineVerifiedAt.toISOString() : null,
      offlineVerifiedRemark: (bill as any).offlineVerifiedRemark ?? null,
      offlineVerifyAttachments: atts.map((a) => ({ id: a.id, name: a.name, file: a.file, ...attUrls(a.file) })),
      createdAt: bill.createdAt.toISOString(),
      billingRemark: bill.billingRemark ?? null,
      items: billItemsToApi(bill.items),
      changeLogs: bill.changeLogs.map((c) => ({
        id: c.id,
        changedAt: c.changedAt.toISOString(),
        adminName: c.admin?.name ?? '—',
        remark: c.remark ?? '',
        beforeJson: c.beforeJson,
        afterJson: c.afterJson,
      })),
    })
  })

  /** 生成租客扫码支付链接与二维码（演示：二维码指向 H5 账单详情并自动唤起支付） */
  app.post('/api/admin/bills/:id/payment-qr', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      mobileOrigin: z.string().min(1).optional(),
    })
    const body = Body.safeParse(req.body ?? {})
    if (!body.success) return res.status(400).json({ error: 'INVALID_BODY' })

    const bill = await ctx.prisma.bill.findUnique({
      where: { id: String(req.params.id) },
      include: {
        contract: {
          include: {
            tenant: true,
            house: { include: { apartment: { include: { store: true } } } },
          },
        },
      },
    })
    if (!bill) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, bill.contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (bill.status === 'PAID') return res.status(409).json({ error: 'ALREADY_PAID' })

    const originRaw = (body.data.mobileOrigin || '').trim()
    const origin = originRaw || 'http://localhost:5173'
    const payUrl = `${origin.replace(/\/$/, '')}/bills/${encodeURIComponent(bill.id)}?pay=1`
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(payUrl)}`
    const amountRemaining = Math.max(0, bill.totalAmount - bill.amountReceived)

    res.json({
      payUrl,
      qrImageUrl,
      billId: bill.id,
      period: bill.period,
      contractNo: bill.contract.contractNo,
      tenantName: bill.contract.tenant.name,
      tenantPhone: bill.contract.tenant.phone,
      totalAmount: bill.totalAmount,
      amountRemaining,
    })
  })

  /**
   * 修改账单信息（仅后台）：支持调整到期日和收费明细，自动记录变更前后快照
   */
  app.patch('/api/admin/bills/:id', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      dueDate: z.string().min(8).optional(),
      items: z
        .array(z.object({ name: z.string().min(1), amount: z.number().int().min(0) }))
        .optional(),
      remark: z.string().optional(),
      billingRemark: z.union([z.string().max(500), z.literal('')]).optional(),
    })
    const body = Body.safeParse(req.body)
    if (!body.success) return res.status(400).json({ error: 'INVALID_BODY', details: body.error.flatten() })

    const bill = await ctx.prisma.bill.findUnique({
      where: { id: String(req.params.id) },
      include: {
        items: true,
        contract: { include: { house: { include: { apartment: true } } } },
      },
    })
    if (!bill) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, bill.contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (!mustBeSystemAdmin(auth)) return res.status(403).json({ error: 'ADMIN_ONLY' })

    // 锁定账期禁止修改
    const locked = await isBillPeriodLocked(ctx.prisma, bill.contract.house.apartment.storeId, bill.period)
    if (locked) return res.status(409).json({ error: 'BILL_PERIOD_LOCKED' })

    const beforeSnapshot = {
      dueDate: toYmd(bill.dueDate),
      items: bill.items.map((i) => ({ name: i.name, amount: i.amount })),
      totalAmount: bill.totalAmount,
      billingRemark: bill.billingRemark ?? '',
    }

    const newDueDate = body.data.dueDate ? new Date(body.data.dueDate) : bill.dueDate
    const newItems =
      body.data.items ??
      bill.items.map((i) => ({
        name: i.name,
        amount: i.amount,
      }))
    const cleanedItems = newItems.filter((i) => i.amount > 0)
    const totalAmount = cleanedItems.reduce((s, i) => s + i.amount, 0)
    if (totalAmount <= 0) return res.status(400).json({ error: 'ITEMS_SUM_MUST_BE_POSITIVE' })
    if (totalAmount < bill.amountReceived) {
      return res.status(400).json({ error: 'TOTAL_BELOW_RECEIVED', message: '调整后应收不能小于已核销金额' })
    }

    const nextBillingRemark =
      body.data.billingRemark === undefined
        ? bill.billingRemark
        : body.data.billingRemark.trim() === ''
          ? null
          : body.data.billingRemark.trim().slice(0, 500)

    const updated = await ctx.prisma.$transaction(async (tx) => {
      const u = await tx.bill.update({
        where: { id: bill.id },
        data: { dueDate: newDueDate, totalAmount, billingRemark: nextBillingRemark },
      })
      await tx.billItem.deleteMany({ where: { billId: bill.id } })
      for (const it of cleanedItems) {
        await tx.billItem.create({
          data: { billId: bill.id, name: it.name, amount: it.amount },
        })
      }
      await tx.billChangeLog.create({
        data: {
          billId: bill.id,
          adminId: auth.admin.id,
          beforeJson: JSON.stringify(beforeSnapshot),
          afterJson: JSON.stringify({
            dueDate: toYmd(newDueDate),
            items: cleanedItems,
            totalAmount,
            billingRemark: nextBillingRemark ?? '',
          }),
          remark: body.data.remark ?? '',
        },
      })
      return u
    })

    res.json({
      ok: true,
      id: updated.id,
      totalAmount: updated.totalAmount,
      dueDate: toYmd(updated.dueDate),
    })
  })

  /**
   * 线下核销：支持「核销金额」小于/等于/大于账单剩余应付
   * - 小于：账单仍待支付，已收累加；待付 = 应收 - 已收
   * - 等于或覆盖全额：账单结清（PAID）
   * - 大于：超出部分记入「合同预收余额」，可在「合同预收款」页查看流水
   */
  app.post(
    '/api/admin/bills/:id/offline-verify',
    adminAuth(ctx.prisma),
    contractFileUpload.array('files', 5),
    async (req, res) => {
      const auth = getAdminAuth(req)
      const bill = await ctx.prisma.bill.findUnique({
        where: { id: String(req.params.id) },
        include: { contract: { include: { house: { include: { apartment: true } } } } },
      })
      if (!bill) return res.status(404).json({ error: 'NOT_FOUND' })
      if (!canAccessStore(auth, bill.contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
      if (bill.status === 'PAID') return res.status(409).json({ error: 'ALREADY_PAID' })
      if (bill.status !== 'UNPAID' && bill.status !== 'OVERDUE') return res.status(409).json({ error: 'INVALID_STATUS' })

      const remark = String((req.body as any)?.remark ?? '').trim()
      const amountRaw = (req.body as any)?.amount
      const collectionChannel = String((req.body as any)?.collectionChannel ?? '').trim()
      const collectionDateRaw = (req.body as any)?.collectionDate
      const assetName = String((req.body as any)?.assetName ?? '').trim().slice(0, 200)

      if (!isOfflineCollectionChannel(collectionChannel)) {
        return res.status(400).json({ error: 'INVALID_COLLECTION_CHANNEL' })
      }
      const collectionDate = parseCollectionDateYmd(collectionDateRaw)
      if (!collectionDate) return res.status(400).json({ error: 'INVALID_COLLECTION_DATE' })

      const billReceived = bill.amountReceived
      const remaining = Math.max(0, bill.totalAmount - billReceived)

      let verifyAmount = remaining > 0 ? remaining : bill.totalAmount
      if (amountRaw !== undefined && amountRaw !== null && String(amountRaw).trim() !== '') {
        const n = parseOfflineCollectionAmount(amountRaw)
        if (n === null) return res.status(400).json({ error: 'INVALID_AMOUNT' })
        verifyAmount = n
      } else {
        return res.status(400).json({ error: 'INVALID_AMOUNT' })
      }

      const applyToBill = Math.min(verifyAmount, remaining)
      const excess = verifyAmount - applyToBill

      const files = ((req as any).files ?? []) as Express.Multer.File[]
      const now = new Date()
      const dir = ensureBillVerifyUploadDir(bill.id)
      const list = parseBillVerifyAttachmentsJson((bill as any).offlineVerifyAttachmentsJson)
      const newMeta: { id: string; name: string; file: string }[] = []

      for (const f of files) {
        if (!f || !f.buffer) continue
        const ext = path.extname(f.originalname || '').slice(0, 12) || '.bin'
        const stored = `${Date.now()}-${randomBytes(8).toString('hex')}${ext.replace(/[^a-zA-Z0-9.]/g, '')}`
        if (!/^[a-zA-Z0-9._-]+$/.test(stored)) return res.status(400).json({ error: 'BAD_FILENAME' })
        fs.writeFileSync(path.join(dir, stored), f.buffer)
        const id = randomBytes(6).toString('hex')
        const meta = { id, name: f.originalname || stored, file: stored }
        list.push(meta)
        newMeta.push(meta)
      }

      const nextReceived = Math.min(billReceived + applyToBill, bill.totalAmount)
      const paidFull = nextReceived >= bill.totalAmount
      const sod = new Date()
      sod.setHours(0, 0, 0, 0)
      const isOverdue = bill.dueDate.getTime() < sod.getTime()
      const nextStatus = paidFull ? 'PAID' : isOverdue ? 'OVERDUE' : 'UNPAID'

      const updated = await ctx.prisma.$transaction(async (tx) => {
        await tx.billOfflineVerifyLog.create({
          data: {
            billId: bill.id,
            amount: verifyAmount,
            collectionChannel,
            collectionDate,
            assetName: assetName || null,
            remark: remark || null,
            attachmentsJson: JSON.stringify(newMeta),
            adminId: auth.admin.id,
          },
        })

        if (excess > 0) {
          let creditRow = await tx.contractCredit.findUnique({ where: { contractId: bill.contractId } })
          const prev = creditRow?.balanceAmount ?? 0
          const nextBal = prev + excess
          const saved = creditRow
            ? await tx.contractCredit.update({ where: { id: creditRow.id }, data: { balanceAmount: nextBal } })
            : await tx.contractCredit.create({ data: { contractId: bill.contractId, balanceAmount: nextBal } })
          await tx.contractCreditLedger.create({
            data: {
              contractCreditId: saved.id,
              deltaAmount: excess,
              balanceAfterAmount: nextBal,
              kind: 'OVERPAY_OFFLINE',
              billId: bill.id,
              remark: `线下核销超额入账 ¥${excess}（账单 ${bill.period}）`,
              adminId: auth.admin.id,
            },
          })
        }

        return tx.bill.update({
          where: { id: bill.id },
          data: {
            amountReceived: nextReceived,
            status: nextStatus,
            paidAt: paidFull ? bill.paidAt ?? now : null,
            offlineVerifiedAt: bill.offlineVerifiedAt ?? now,
            offlineVerifiedByAdminId: bill.offlineVerifiedByAdminId ?? auth.admin.id,
            offlineVerifiedRemark: remark || null,
            offlineVerifyAttachmentsJson: JSON.stringify(list),
          },
        })
      })

      res.json({
        ok: true,
        status: updated.status,
        amountReceived: updated.amountReceived,
        amountRemaining: Math.max(0, updated.totalAmount - updated.amountReceived),
        prepaidCredited: excess,
        paidAt: updated.paidAt?.toISOString() ?? null,
        offlineVerifiedAt: updated.offlineVerifiedAt ? updated.offlineVerifiedAt.toISOString() : null,
        offlineVerifyAttachmentCount: list.length,
      })
    },
  )

  app.get(
    '/api/admin/bills/:id/offline-verify-attachment/:fileKey',
    adminAuth(ctx.prisma),
    async (req, res) => {
      const auth = getAdminAuth(req)
      const fileKey = decodeURIComponent(String(req.params.fileKey))
      if (!/^[a-zA-Z0-9._-]+$/.test(fileKey)) return res.status(400).json({ error: 'BAD_KEY' })
      const bill = await ctx.prisma.bill.findUnique({
        where: { id: String(req.params.id) },
        include: { contract: { include: { house: { include: { apartment: true } } } } },
      })
      if (!bill) return res.status(404).json({ error: 'NOT_FOUND' })
      if (!canAccessStore(auth, bill.contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
      const list = parseBillVerifyAttachmentsJson((bill as any).offlineVerifyAttachmentsJson)
      let att = list.find((a) => a.file === fileKey)
      if (!att) {
        const logs = await ctx.prisma.billOfflineVerifyLog.findMany({
          where: { billId: bill.id },
          select: { attachmentsJson: true },
        })
        for (const lg of logs) {
          const sub = parseBillVerifyAttachmentsJson(lg.attachmentsJson)
          att = sub.find((a) => a.file === fileKey)
          if (att) break
        }
      }
      if (!att) return res.status(404).json({ error: 'FILE_NOT_IN_BILL' })
      const full = path.join(BILL_VERIFY_UPLOAD_ROOT, bill.id, fileKey)
      if (!fs.existsSync(full)) return res.status(404).json({ error: 'FILE_MISSING' })
      const ext = path.extname(fileKey).toLowerCase()
      const mime =
        ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.gif'
              ? 'image/gif'
              : ext === '.webp'
                ? 'image/webp'
                : ext === '.pdf'
                  ? 'application/pdf'
                  : 'application/octet-stream'
      res.setHeader('Content-Type', mime)
      if (req.query.download === '1') {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`,
        )
      } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf'].includes(ext)) {
        res.setHeader('Content-Disposition', 'inline')
      }
      res.sendFile(path.resolve(full))
    },
  )

  // 交易记录：线上整笔支付、线下核销分笔流水、合同预收入账、退款
  app.get('/api/admin/transactions', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)

    const logs = await ctx.prisma.billOfflineVerifyLog.findMany({
      include: {
        bill: {
          include: {
            contract: {
              include: {
                tenant: true,
                house: { include: { apartment: { include: { store: true } } } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 400,
    })

    const paidBills = await ctx.prisma.bill.findMany({
      where: { status: 'PAID', paidAt: { not: null } },
      include: {
        contract: {
          include: {
            tenant: true,
            house: { include: { apartment: { include: { store: true } } } },
          },
        },
        _count: { select: { offlineVerifyLogs: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: 300,
    })

    const prepayLedgers = await ctx.prisma.contractCreditLedger.findMany({
      where: { kind: 'OVERPAY_OFFLINE' },
      include: {
        contractCredit: {
          include: {
            contract: {
              include: {
                tenant: true,
                house: { include: { apartment: { include: { store: true } } } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    const refunds = await ctx.prisma.refund.findMany({
      include: {
        contract: {
          include: {
            tenant: true,
            house: { include: { apartment: { include: { store: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    type Tx = {
      id: string
      txNo: string
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
      receipt: ReturnType<typeof buildReceiptDto>
    }

    const txs: Tx[] = []

    for (const log of logs) {
      const b = log.bill
      if (!canAccessStore(auth, b.contract.house.apartment.storeId)) continue
      const atts = parseBillVerifyAttachmentsJson(log.attachmentsJson)
      const attUrls = (f: string) => ({
        previewUrl: `/api/admin/bills/${b.id}/offline-verify-attachment/${encodeURIComponent(f)}`,
        downloadUrl: `/api/admin/bills/${b.id}/offline-verify-attachment/${encodeURIComponent(f)}?download=1`,
      })
      const offlineVerifyAttachments = atts.map((a) => ({
        id: a.id,
        name: a.name,
        file: a.file,
        ...attUrls(a.file),
      }))
      txs.push({
        id: `offlog_${log.id}`,
        txNo: `HX${log.id.slice(-10)}`,
        orderId: b.contract.orderId,
        type: 'OFFLINE_VERIFY',
        channel: 'OFFLINE',
        amount: log.amount,
        occurredAt: log.createdAt.toISOString(),
        contractId: b.contractId,
        contractNo: b.contract.contractNo,
        tenant: { name: b.contract.tenant.name, phone: b.contract.tenant.phone },
        house: {
          storeName: b.contract.house.apartment.store.name,
          apartmentName: b.contract.house.apartment.name,
          houseNo: b.contract.house.houseNo,
        },
        houseBizId: houseBizId(b.contract.house.id),
        period: b.period,
        dueDate: toYmd(b.dueDate),
        attachmentCount: offlineVerifyAttachments.length,
        note: log.remark?.trim()
          ? `线下核销 · ${String(log.remark).trim().slice(0, 160)}`
          : `线下核销 · ${b.period}`,
        verify: {
          billId: b.id,
          offlineVerifiedAt: log.createdAt.toISOString(),
          offlineVerifiedRemark: log.remark ?? null,
          offlineVerifyAttachments,
        },
      })
    }

    for (const b of paidBills) {
      if (!canAccessStore(auth, b.contract.house.apartment.storeId)) continue
      if (b._count.offlineVerifyLogs > 0) continue
      txs.push({
        id: `bill_${b.id}`,
        txNo: `TX${b.paidAt ? 'P' : 'B'}${b.id.slice(-10)}`,
        orderId: b.contract.orderId,
        type: 'BILL_PAYMENT',
        channel: 'ONLINE',
        amount: b.totalAmount,
        occurredAt: (b.paidAt ?? b.createdAt).toISOString(),
        contractId: b.contractId,
        contractNo: b.contract.contractNo,
        tenant: { name: b.contract.tenant.name, phone: b.contract.tenant.phone },
        house: {
          storeName: b.contract.house.apartment.store.name,
          apartmentName: b.contract.house.apartment.name,
          houseNo: b.contract.house.houseNo,
        },
        houseBizId: houseBizId(b.contract.house.id),
        period: b.period,
        dueDate: toYmd(b.dueDate),
        attachmentCount: 0,
        note: b.period.startsWith('换房补差') ? `换房补差已支付：${b.period}` : `账单已支付：${b.period}`,
        verify: null,
      })
    }

    for (const row of prepayLedgers) {
      const c = row.contractCredit.contract
      if (!canAccessStore(auth, c.house.apartment.storeId)) continue
      txs.push({
        id: `prepay_${row.id}`,
        txNo: `YS${row.id.slice(-10)}`,
        orderId: c.orderId,
        type: 'PREPAYMENT',
        channel: 'OFFLINE',
        amount: row.deltaAmount,
        occurredAt: row.createdAt.toISOString(),
        contractId: c.id,
        contractNo: c.contractNo,
        tenant: { name: c.tenant.name, phone: c.tenant.phone },
        house: {
          storeName: c.house.apartment.store.name,
          apartmentName: c.house.apartment.name,
          houseNo: c.house.houseNo,
        },
        houseBizId: houseBizId(c.house.id),
        period: null,
        dueDate: null,
        attachmentCount: 0,
        note: row.remark ?? '合同预收余额入账（线下核销超额）',
        verify: null,
      })
    }

    for (const r of refunds) {
      if (!canAccessStore(auth, r.contract.house.apartment.storeId)) continue
      txs.push({
        id: `refund_${r.id}`,
        txNo: `TXR${r.id.slice(-10)}`,
        orderId: r.contract.orderId,
        type: 'REFUND',
        channel: 'OFFLINE',
        amount: -Math.abs(r.amount),
        occurredAt: r.createdAt.toISOString(),
        contractId: r.contractId,
        contractNo: r.contract.contractNo,
        tenant: { name: r.contract.tenant.name, phone: r.contract.tenant.phone },
        house: {
          storeName: r.contract.house.apartment.store.name,
          apartmentName: r.contract.house.apartment.name,
          houseNo: r.contract.house.houseNo,
        },
        houseBizId: houseBizId(r.contract.house.id),
        period: null,
        dueDate: null,
        attachmentCount: 0,
        note: `退款：${r.reason}`,
        verify: null,
      })
    }

    txs.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))
    const sliced = txs.slice(0, 500)
    const receiptMap = await loadReceiptMap(
      ctx.prisma,
      sliced.map((x) => x.id),
    )
    const items = sliced.map((x) => ({
      ...x,
      receipt: buildReceiptDto(receiptMap.get(x.id) ?? null, x.id, auth.admin),
    }))
    res.json({ items })
  })

  app.post('/api/admin/transactions/receipts/print', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const body = z
      .object({
        transactionIds: z.array(z.string().min(1)).min(1),
        receiptKind: z.enum(['RENT', 'DEPOSIT']),
      })
      .safeParse(req.body)
    if (!body.success) return res.status(400).json({ error: 'BAD_REQUEST' })

    try {
      const results = await printTransactionReceipts(
        ctx.prisma,
        auth.admin,
        body.data.transactionIds,
        body.data.receiptKind,
      )
      res.json({
        ok: true,
        receiptKind: body.data.receiptKind,
        results,
        message: `已记录 ${results.length} 条收据导出（第 ${results.map((r) => r.printCount).join('、')} 次）。正式套打文件待模板接入后生成。`,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.startsWith('PRINT_BLOCKED:')) {
        const parts = msg.split(':')
        const reason = parts.slice(2).join(':') || '不可打印'
        return res.status(403).json({ error: reason })
      }
      if (msg === 'EMPTY_TRANSACTION_IDS') return res.status(400).json({ error: '请选择交易记录' })
      throw e
    }
  })

  app.post('/api/admin/transactions/receipts/reprint-request', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const body = z
      .object({
        transactionId: z.string().min(1),
        reason: z.string().trim().min(2).max(500),
      })
      .safeParse(req.body)
    if (!body.success) return res.status(400).json({ error: '请填写再次导出原因（至少 2 字）' })

    const receipt = await ctx.prisma.transactionReceipt.upsert({
      where: { transactionId: body.data.transactionId },
      create: { transactionId: body.data.transactionId },
      update: {},
    })
    const dto = buildReceiptDto(receipt, body.data.transactionId, auth.admin)
    if (!dto.canRequestReprint) {
      return res.status(403).json({ error: dto.printBlockedReason ?? '当前不可申请再次导出' })
    }

    const updated = await ctx.prisma.transactionReceipt.update({
      where: { id: receipt.id },
      data: {
        reprintRequestStatus: 'PENDING',
        reprintRequestReason: body.data.reason,
        reprintRequestedAt: new Date(),
        reprintRequestedByAdminId: auth.admin.id,
        reprintApproved: false,
        reprintReviewedAt: null,
        reprintReviewedByAdminId: null,
        reprintReviewRemark: null,
      },
    })
    res.json({ ok: true, receipt: buildReceiptDto(updated, body.data.transactionId, auth.admin) })
  })

  app.post('/api/admin/transactions/receipts/reprint-review', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    if (!mustBeFinance(auth)) return res.status(403).json({ error: '仅财务可审批再次导出申请' })

    const body = z
      .object({
        transactionId: z.string().min(1),
        action: z.enum(['APPROVE', 'REJECT']),
        remark: z.string().trim().max(500).optional(),
      })
      .safeParse(req.body)
    if (!body.success) return res.status(400).json({ error: 'BAD_REQUEST' })

    const receipt = await ctx.prisma.transactionReceipt.findUnique({
      where: { transactionId: body.data.transactionId },
    })
    if (!receipt) return res.status(404).json({ error: '未找到收据记录' })
    if (receipt.status === 'VOID') return res.status(403).json({ error: '收据已作废' })
    if (receipt.reprintRequestStatus !== 'PENDING') {
      return res.status(403).json({ error: '当前无待审批的再次导出申请' })
    }

    const now = new Date()
    const approved = body.data.action === 'APPROVE'
    const updated = await ctx.prisma.transactionReceipt.update({
      where: { id: receipt.id },
      data: {
        reprintRequestStatus: approved ? 'APPROVED' : 'REJECTED',
        reprintApproved: approved,
        reprintReviewedAt: now,
        reprintReviewedByAdminId: auth.admin.id,
        reprintReviewRemark: body.data.remark?.trim() || null,
      },
    })
    res.json({ ok: true, receipt: buildReceiptDto(updated, body.data.transactionId, auth.admin) })
  })

  app.get('/api/admin/transactions/receipts/reprint-pending', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    if (!mustBeFinance(auth)) return res.status(403).json({ error: '仅财务可查看待审批列表' })

    const rows = await ctx.prisma.transactionReceipt.findMany({
      where: { reprintRequestStatus: 'PENDING', status: 'ACTIVE' },
      orderBy: { reprintRequestedAt: 'asc' },
      take: 100,
    })
    res.json({
      items: rows.map((r) => ({
        transactionId: r.transactionId,
        printCount: r.printCount,
        reprintRequestReason: r.reprintRequestReason,
        reprintRequestedAt: r.reprintRequestedAt?.toISOString() ?? null,
        receipt: buildReceiptDto(r, r.transactionId, auth.admin),
      })),
    })
  })

  app.post('/api/admin/transactions/receipts/void', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    if (!mustBeFinance(auth)) return res.status(403).json({ error: '仅财务可作废收据' })

    const body = z
      .object({
        transactionId: z.string().min(1),
        reason: z.string().trim().min(2).max(500),
      })
      .safeParse(req.body)
    if (!body.success) return res.status(400).json({ error: '请填写作废原因（至少 2 字）' })

    const receipt = await ctx.prisma.transactionReceipt.upsert({
      where: { transactionId: body.data.transactionId },
      create: { transactionId: body.data.transactionId },
      update: {},
    })
    if (receipt.status === 'VOID') return res.status(403).json({ error: '收据已作废' })

    const now = new Date()
    const updated = await ctx.prisma.transactionReceipt.update({
      where: { id: receipt.id },
      data: {
        status: 'VOID',
        voidedAt: now,
        voidedByAdminId: auth.admin.id,
        voidReason: body.data.reason,
        reprintApproved: false,
        reprintRequestStatus: null,
      },
    })
    res.json({ ok: true, receipt: buildReceiptDto(updated, body.data.transactionId, auth.admin) })
  })

  app.get('/api/admin/transactions/receipts/:transactionId/print-logs', adminAuth(ctx.prisma), async (req, res) => {
    const transactionId = String(req.params.transactionId)
    const receipt = await ctx.prisma.transactionReceipt.findUnique({
      where: { transactionId },
      include: { printLogs: { orderBy: { printedAt: 'desc' } } },
    })
    if (!receipt) return res.json({ items: [] })

    const adminIds = [
      ...new Set(receipt.printLogs.map((l) => l.printedByAdminId).filter((id): id is string => Boolean(id))),
    ]
    const admins =
      adminIds.length > 0
        ? await ctx.prisma.admin.findMany({
            where: { id: { in: adminIds } },
            select: { id: true, email: true, name: true },
          })
        : []
    const adminMap = new Map(admins.map((a) => [a.id, a]))

    res.json({
      items: receipt.printLogs.map((l) => {
        const admin = l.printedByAdminId ? adminMap.get(l.printedByAdminId) : undefined
        return {
          id: l.id,
          receiptKind: l.receiptKind,
          printSeq: l.printSeq,
          printedAt: l.printedAt.toISOString(),
          printedByAdminName: l.printedByAdminName ?? admin?.name ?? null,
          printedByAdminEmail: l.printedByAdminEmail ?? admin?.email ?? null,
        }
      }),
    })
  })

  /** 合同预收余额列表（线下核销超额等入账） */
  app.get('/api/admin/contract-credits', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const rows = await ctx.prisma.contractCredit.findMany({
      where: { balanceAmount: { gt: 0 } },
      include: {
        contract: {
          include: {
            tenant: true,
            house: { include: { apartment: { include: { store: true } } } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    })
    const items = rows
      .filter((r) => canAccessStore(auth, r.contract.house.apartment.storeId))
      .map((r) => ({
        contractId: r.contractId,
        contractNo: r.contract.contractNo,
        tenantName: r.contract.tenant.name,
        tenantPhone: r.contract.tenant.phone,
        storeName: r.contract.house.apartment.store.name,
        apartmentName: r.contract.house.apartment.name,
        houseNo: r.contract.house.houseNo,
        balanceAmount: r.balanceAmount,
        updatedAt: r.updatedAt.toISOString(),
      }))
    res.json({ items })
  })

  app.get('/api/admin/contract-credits/:contractId/ledger', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const contractId = String(req.params.contractId)
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: contractId },
      include: { house: { include: { apartment: true } } },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    const cc = await ctx.prisma.contractCredit.findUnique({
      where: { contractId },
      include: {
        ledgerEntries: { orderBy: { createdAt: 'desc' }, take: 200 },
      },
    })
    res.json({
      contractId,
      balanceAmount: cc?.balanceAmount ?? 0,
      entries: (cc?.ledgerEntries ?? []).map((e) => ({
        id: e.id,
        deltaAmount: e.deltaAmount,
        balanceAfterAmount: e.balanceAfterAmount,
        kind: e.kind,
        billId: e.billId,
        remark: e.remark,
        createdAt: e.createdAt.toISOString(),
      })),
    })
  })

  app.post('/api/admin/bills', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const Body = z.object({
      contractId: z.string().min(1),
      period: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
      dueDate: z.string().min(8),
      items: z.array(z.object({ name: z.string().min(1), amount: z.number().int().min(0) })),
      billingRemark: z.union([z.string().max(500), z.literal('')]).optional(),
    })
    const body = Body.parse(req.body)
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: body.contractId },
      include: { house: { include: { apartment: { include: { store: true } } } } },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    if (await isBillPeriodLocked(ctx.prisma, contract.house.apartment.storeId, body.period)) {
      return res.status(409).json({ error: 'BILL_PERIOD_LOCKED' })
    }
    const totalAmount = body.items.reduce((s, i) => s + i.amount, 0)
    if (totalAmount <= 0) return res.status(400).json({ error: 'ITEMS_SUM_MUST_BE_POSITIVE' })
    const existing = await ctx.prisma.bill.findFirst({
      where: { contractId: body.contractId, period: body.period, kind: 'ADJUSTMENT' },
    })
    if (existing) return res.status(409).json({ error: 'PERIOD_ALREADY_EXISTS' })
    const remark =
      body.billingRemark !== undefined && String(body.billingRemark).trim() !== ''
        ? String(body.billingRemark).trim().slice(0, 500)
        : null
    const bill = await ctx.prisma.bill.create({
      data: {
        contractId: body.contractId,
        period: body.period,
        dueDate: new Date(body.dueDate),
        totalAmount,
        status: 'UNPAID',
        kind: 'ADJUSTMENT',
        billingRemark: remark,
      },
    })
    for (const it of body.items) {
      if (it.amount <= 0) continue
      await ctx.prisma.billItem.create({
        data: { billId: bill.id, name: it.name, amount: it.amount },
      })
    }
    res.json({ ok: true, id: bill.id })
  })

  // ---------- Integrations (mock) ----------
  app.post('/api/integrations/asset/sync', async (req, res) => {
    const token = req.header('x-asset-token')
    if (token !== env.ASSET_SYNC_TOKEN) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const Body = z.object({
      stores: z.array(z.object({ externalId: z.string().min(1), name: z.string().min(1) })),
      apartments: z.array(
        z.object({
          externalId: z.string().min(1),
          storeExternalId: z.string().min(1),
          name: z.string().min(1),
        }),
      ),
      houses: z.array(
        z.object({
          externalId: z.string().min(1),
          apartmentExternalId: z.string().min(1),
          houseNo: z.string().min(1),
          houseType: z.string().min(1),
          area: z.number().positive(),
          rentMonthly: z.number().int().positive().optional(),
          deposit: z.number().int().nonnegative().optional(),
          status: z.enum(['VACANT', 'RESERVED', 'ORDERED', 'SIGNED', 'TERMINATED']),
        }),
      ),
    })
    const body = Body.parse(req.body)
    const result = await upsertAssetSnapshot(ctx.prisma, body)
    res.json({ ok: true, ...result })
  })

  app.post('/api/admin/integrations/asset/sync-demo', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    if (!mustBeSystemAdmin(auth)) return res.status(403).json({ error: 'FORBIDDEN' })
    const stores = [
      { externalId: 'S001', name: '南宁市-江南区' },
      { externalId: 'S002', name: '南宁市-青秀区' },
      { externalId: 'S003', name: '南宁市-兴宁区' },
      { externalId: 'S004', name: '南宁市-西乡塘区' },
      { externalId: 'S005', name: '南宁市-邕宁区' },
      { externalId: 'S006', name: '南宁市-武鸣区' },
      { externalId: 'S007', name: '南宁市-良庆区' },
    ]

    const apartments = [
      { externalId: 'A001', storeExternalId: 'S001', name: '江南·梧桐公寓' },
      { externalId: 'A002', storeExternalId: 'S002', name: '青秀·江景公寓' },
      { externalId: 'A003', storeExternalId: 'S003', name: '兴宁·里弄公寓' },
      { externalId: 'A004', storeExternalId: 'S004', name: '西乡塘·青年社区' },
      { externalId: 'A005', storeExternalId: 'S005', name: '邕宁·花园公寓' },
      { externalId: 'A006', storeExternalId: 'S006', name: '武鸣·精装公寓' },
      { externalId: 'A007', storeExternalId: 'S007', name: '良庆·悦居公寓' },
    ] as const

    const houseTypes = ['开间', '一室一厅', '两室一厅', '三室一厅', 'Loft'] as const
    // 同步演示房源：30 条全部设为空置，便于 H5 列表展示
    const houseSpecs: Array<{ aptIndex: number; typeIndex: number; area: number; rent: number; no: string }> = []
    const aptCount = apartments.length
    const typeCount = houseTypes.length
    for (let i = 0; i < 30; i++) {
      const aptIndex = i % aptCount
      const typeIndex = i % typeCount
      const area = 28 + (typeIndex * 12) + (i % 8)
      const rentBase = [4200, 5500, 7200, 9000, 6800][typeIndex]
      const rent = rentBase + (i % 5) * 200
      const no = `${1 + (i % 9)}${String(10 + (i % 90)).slice(-2)}`
      houseSpecs.push({ aptIndex, typeIndex, area, rent, no })
    }

    const houses = houseSpecs.map((spec, i) => {
      const apt = apartments[spec.aptIndex]
      const houseType = houseTypes[spec.typeIndex]
      return {
        externalId: `H${String(i + 1).padStart(3, '0')}`,
        apartmentExternalId: apt.externalId,
        houseNo: spec.no,
        houseType,
        area: spec.area,
        // 演示：资产系统仅同步基础房子信息（租金/押金等需后台补录）
        rentMonthly: undefined,
        deposit: undefined,
        status: 'VACANT' as const,
      }
    })

    const demo = await upsertAssetSnapshot(ctx.prisma, { stores, apartments: apartments as any, houses })
    res.json({ ok: true, ...demo })
  })

  app.post('/api/admin/integrations/housing/report-now/:contractId', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const contract = await ctx.prisma.contract.findUnique({
      where: { id: String(req.params.contractId) },
      include: { house: { include: { apartment: true } } },
    })
    if (!contract) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canAccessStore(auth, contract.house.apartment.storeId)) return res.status(403).json({ error: 'FORBIDDEN' })

    const result = await performHousingReportNow(ctx.prisma, contract.id)
    res.json({ ok: true, ...result })
  })

  /** 报表管理：月度实收租金明细表 */
  app.get('/api/admin/reports/monthly-rent-collected', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const storeId = String(req.query.storeId ?? '').trim() || undefined
    const periodFrom = String(req.query.periodFrom ?? '').trim() || undefined
    const periodTo = String(req.query.periodTo ?? '').trim() || undefined
    const collectedFrom = String(req.query.collectedFrom ?? '').trim() || undefined
    const collectedTo = String(req.query.collectedTo ?? '').trim() || undefined
    if (storeId && !canAccessStore(auth, storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    const data = await buildMonthlyRentCollectedReport(
      ctx.prisma,
      { storeId, periodFrom, periodTo, collectedFrom, collectedTo },
      (id) => canAccessStore(auth, id),
    )
    res.json(data)
  })

  /** 报表管理：核销情况表 */
  app.get('/api/admin/reports/offline-verify-status', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const storeId = String(req.query.storeId ?? '').trim() || undefined
    const periodFrom = String(req.query.periodFrom ?? '').trim() || undefined
    const periodTo = String(req.query.periodTo ?? '').trim() || undefined
    const collectedFrom = String(req.query.collectedFrom ?? '').trim() || undefined
    const collectedTo = String(req.query.collectedTo ?? '').trim() || undefined
    if (storeId && !canAccessStore(auth, storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    const data = await buildOfflineVerifyStatusReport(
      ctx.prisma,
      { storeId, periodFrom, periodTo, collectedFrom, collectedTo },
      (id) => canAccessStore(auth, id),
    )
    res.json(data)
  })

  /** 报表管理：系统收款交易流水表 */
  app.get('/api/admin/reports/collection-transactions', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const storeId = String(req.query.storeId ?? '').trim() || undefined
    const periodFrom = String(req.query.periodFrom ?? '').trim() || undefined
    const periodTo = String(req.query.periodTo ?? '').trim() || undefined
    const collectedFrom = String(req.query.collectedFrom ?? '').trim() || undefined
    const collectedTo = String(req.query.collectedTo ?? '').trim() || undefined
    if (storeId && !canAccessStore(auth, storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    const data = await buildCollectionTransactionReport(
      ctx.prisma,
      { storeId, periodFrom, periodTo, collectedFrom, collectedTo },
      (id) => canAccessStore(auth, id),
    )
    res.json(data)
  })

  /** 报表管理：月度应收明细表 */
  app.get('/api/admin/reports/monthly-receivable', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const storeId = String(req.query.storeId ?? '').trim() || undefined
    const periodFrom = String(req.query.periodFrom ?? '').trim() || undefined
    const periodTo = String(req.query.periodTo ?? '').trim() || undefined
    if (storeId && !canAccessStore(auth, storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    const data = await buildMonthlyReceivableReport(
      ctx.prisma,
      { storeId, periodFrom, periodTo },
      (id) => canAccessStore(auth, id),
    )
    res.json(data)
  })

  /** 报表管理：业务账单表（实时） */
  app.get('/api/admin/reports/business-bills', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const storeId = String(req.query.storeId ?? '').trim() || undefined
    const periodFrom = String(req.query.periodFrom ?? '').trim() || undefined
    const periodTo = String(req.query.periodTo ?? '').trim() || undefined
    if (storeId && !canAccessStore(auth, storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    const data = await buildBusinessBillsReport(
      ctx.prisma,
      { storeId, periodFrom, periodTo },
      (id) => canAccessStore(auth, id),
    )
    res.json(data)
  })

  /** 报表管理：应收报表（按账期汇总各账单应收/已收/待收） */
  app.get('/api/admin/reports/receivable', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const storeId = String(req.query.storeId ?? '').trim() || undefined
    const periodFrom = String(req.query.periodFrom ?? '').trim() || undefined
    const periodTo = String(req.query.periodTo ?? '').trim() || undefined
    if (storeId && !canAccessStore(auth, storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    const data = await buildReceivableReport(
      ctx.prisma,
      { storeId, periodFrom, periodTo },
      (id) => canAccessStore(auth, id),
    )
    res.json(data)
  })

  /** 报表管理：实收报表（按收款发生日统计线上支付与线下核销） */
  app.get('/api/admin/reports/collected', adminAuth(ctx.prisma), async (req, res) => {
    const auth = getAdminAuth(req)
    const storeId = String(req.query.storeId ?? '').trim() || undefined
    const periodFrom = String(req.query.periodFrom ?? '').trim() || undefined
    const periodTo = String(req.query.periodTo ?? '').trim() || undefined
    const collectedFrom = String(req.query.collectedFrom ?? '').trim() || undefined
    const collectedTo = String(req.query.collectedTo ?? '').trim() || undefined
    if (storeId && !canAccessStore(auth, storeId)) return res.status(403).json({ error: 'FORBIDDEN' })
    const data = await buildCollectedReport(
      ctx.prisma,
      { storeId, periodFrom, periodTo, collectedFrom, collectedTo },
      (id) => canAccessStore(auth, id),
    )
    res.json(data)
  })
}

