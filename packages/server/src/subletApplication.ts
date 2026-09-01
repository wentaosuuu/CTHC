import fs from 'node:fs'
import path from 'node:path'
import type { SubletApplication, SubletApplicationStatus } from '@prisma/client'

export const SUBLET_UPLOAD_ROOT = path.join(process.cwd(), 'data', 'sublet-uploads')

export type SubletFileAttachment = {
  id: string
  name: string
  file: string
  category?: string
}

export const SUBLET_OPEN_STATUSES: SubletApplicationStatus[] = [
  'PENDING_REVIEW',
  'WAIT_OA',
  'WAIT_FILING',
  'FILING_REVIEW',
  'WAIT_MINUTES',
]

export function subletStatusZh(status: SubletApplicationStatus | string): string {
  switch (status) {
    case 'PENDING_REVIEW':
      return '待初审'
    case 'WAIT_OA':
      return '待OA审批'
    case 'WAIT_FILING':
      return '待提交备案材料'
    case 'FILING_REVIEW':
      return '待复审备案材料'
    case 'WAIT_MINUTES':
      return '待上传会议纪要'
    case 'COMPLETED':
      return '已完成'
    case 'REJECTED':
      return '已结束'
    default:
      return String(status)
  }
}

export function ensureSubletUploadDir(applicationId: string) {
  const dir = path.join(SUBLET_UPLOAD_ROOT, applicationId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function parseSubletAttachmentsJson(raw: string | null | undefined): SubletFileAttachment[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
      .map((x) => ({
        id: String(x.id ?? ''),
        name: String(x.name ?? ''),
        file: String(x.file ?? ''),
        category: x.category != null ? String(x.category) : undefined,
      }))
      .filter((x) => x.id && x.file)
  } catch {
    return []
  }
}

export function serializeSubletAttachments(
  list: SubletFileAttachment[],
  applicationId: string,
  kind: 'filing' | 'minutes',
) {
  const base = `/api/sublets/${applicationId}/${kind}-file`
  const adminBase = `/api/admin/sublets/${applicationId}/${kind}-file`
  return list.map((a) => ({
    id: a.id,
    name: a.name,
    file: a.file,
    category: a.category ?? null,
    previewUrl: `${base}/${encodeURIComponent(a.file)}`,
    downloadUrl: `${base}/${encodeURIComponent(a.file)}?download=1`,
    adminPreviewUrl: `${adminBase}/${encodeURIComponent(a.file)}`,
    adminDownloadUrl: `${adminBase}/${encodeURIComponent(a.file)}?download=1`,
  }))
}

export function unlinkSubletFiles(applicationId: string, list: SubletFileAttachment[]) {
  for (const a of list) {
    const full = path.join(SUBLET_UPLOAD_ROOT, applicationId, a.file)
    try {
      if (fs.existsSync(full)) fs.unlinkSync(full)
    } catch {
      /* ignore */
    }
  }
}

type SubletRow = SubletApplication & {
  tenant?: { id: string; name: string; phone: string }
  contract?: {
    id: string
    contractNo: string
    status: string
    house?: {
      houseNo: string
      area: number
      apartment?: { name: string; storeId: string; store?: { id: string; name: string } }
    }
  }
}

export function serializeSubletApplication(row: SubletRow) {
  const filing = parseSubletAttachmentsJson(row.filingMaterialsJson)
  const minutes = parseSubletAttachmentsJson(row.meetingMinutesJson)
  const storeName = row.contract?.house?.apartment?.store?.name ?? ''
  const apartmentName = row.contract?.house?.apartment?.name ?? ''
  const houseNo = row.contract?.house?.houseNo ?? ''
  return {
    id: row.id,
    applicationNo: row.applicationNo,
    contractId: row.contractId,
    contractNo: row.contract?.contractNo ?? '',
    contractStatus: row.contract?.status ?? null,
    tenantId: row.tenantId,
    tenantName: row.tenant?.name ?? '',
    tenantPhone: row.tenant?.phone ?? '',
    storeId: row.storeId,
    storeName,
    apartmentName,
    houseNo,
    houseArea: row.contract?.house?.area ?? null,
    status: row.status,
    statusLabel: subletStatusZh(row.status),
    subletArea: row.subletArea,
    subletUnit: row.subletUnit,
    remark: row.remark,
    rejectReason: row.rejectReason,
    filingRejectReason: row.filingRejectReason,
    filingMaterials: serializeSubletAttachments(filing, row.id, 'filing'),
    meetingMinutes: serializeSubletAttachments(minutes, row.id, 'minutes'),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedByName: row.reviewedByName,
    oaPassedAt: row.oaPassedAt?.toISOString() ?? null,
    oaRecordedByName: row.oaRecordedByName,
    filingSubmittedAt: row.filingSubmittedAt?.toISOString() ?? null,
    filingReviewedAt: row.filingReviewedAt?.toISOString() ?? null,
    filingReviewedByName: row.filingReviewedByName,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedByName: row.completedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 生成展示编号 ZZYYYYMMDD + 当日序号（3 位） */
export async function nextSubletApplicationNo(
  prisma: { subletApplication: { count: (args: { where: { createdAt: { gte: Date; lt: Date } } }) => Promise<number> } },
  now = new Date(),
) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const dayStart = new Date(y, now.getMonth(), now.getDate())
  const dayEnd = new Date(y, now.getMonth(), now.getDate() + 1)
  const count = await prisma.subletApplication.count({
    where: { createdAt: { gte: dayStart, lt: dayEnd } },
  })
  return `ZZ${y}${m}${d}${String(count + 1).padStart(3, '0')}`
}
