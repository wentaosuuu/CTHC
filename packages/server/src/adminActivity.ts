import type { PrismaClient } from '@prisma/client'
import type { Request } from 'express'

export function clientMeta(req: Request) {
  const forwarded = req.headers['x-forwarded-for']
  const ip = typeof forwarded === 'string'
    ? forwarded.split(',')[0]?.trim()
    : req.socket.remoteAddress ?? null
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null
  return { ip, userAgent }
}

export async function openAdminSession(
  prisma: PrismaClient,
  adminId: string,
  req: Request,
) {
  const meta = clientMeta(req)
  return prisma.adminLoginSession.create({
    data: {
      adminId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  })
}

export async function touchAdminSession(prisma: PrismaClient, adminId: string, sessionId?: string | null) {
  const now = new Date()
  if (sessionId) {
    const row = await prisma.adminLoginSession.findFirst({
      where: { id: sessionId, adminId, logoutAt: null },
    })
    if (row) {
      await prisma.adminLoginSession.update({
        where: { id: row.id },
        data: { lastSeenAt: now },
      })
      return row.id
    }
  }
  const open = await prisma.adminLoginSession.findFirst({
    where: { adminId, logoutAt: null },
    orderBy: { loginAt: 'desc' },
  })
  if (open) {
    await prisma.adminLoginSession.update({
      where: { id: open.id },
      data: { lastSeenAt: now },
    })
    return open.id
  }
  return null
}

export async function closeAdminSession(prisma: PrismaClient, adminId: string, sessionId?: string | null) {
  const now = new Date()
  if (sessionId) {
    const row = await prisma.adminLoginSession.findFirst({
      where: { id: sessionId, adminId, logoutAt: null },
    })
    if (row) {
      await prisma.adminLoginSession.update({
        where: { id: row.id },
        data: { logoutAt: now, lastSeenAt: now },
      })
      return
    }
  }
  const open = await prisma.adminLoginSession.findFirst({
    where: { adminId, logoutAt: null },
    orderBy: { loginAt: 'desc' },
  })
  if (open) {
    await prisma.adminLoginSession.update({
      where: { id: open.id },
      data: { logoutAt: now, lastSeenAt: now },
    })
  }
}

const ACTION_RULES: Array<{ test: RegExp; label: string }> = [
  { test: /\/orders\/[^/]+\/review$/, label: '订单审核' },
  { test: /\/orders\/[^/]+\/cancel$/, label: '取消订单' },
  { test: /\/orders(\/|$)/, label: '订单操作' },
  { test: /\/contracts\/[^/]+\/oa-result$/, label: '登记合同 OA 结果' },
  { test: /\/contracts\/[^/]+\/manual-flow$/, label: '合同流程操作' },
  { test: /\/contracts\/[^/]+\/billing-/, label: '合同计费暂停/恢复' },
  { test: /\/contracts/, label: '合同操作' },
  { test: /\/houses\/[^/]+\/publish$/, label: '房源上架' },
  { test: /\/houses\/[^/]+\/unpublish$/, label: '房源下架' },
  { test: /\/houses\/[^/]+\/config$/, label: '房源配置' },
  { test: /\/houses/, label: '资产操作' },
  { test: /\/bills/, label: '账单操作' },
  { test: /\/sublets/, label: '转租审核' },
  { test: /\/transactions/, label: '交易/收据操作' },
  { test: /\/tenants/, label: '租客档案操作' },
  { test: /\/workbench\/notices\/[^/]+\/read$/, label: '阅读系统公告' },
  { test: /\/me\/change-password$/, label: '修改密码' },
  { test: /\/session\/heartbeat$/, label: '' },
  { test: /\/logout$/, label: '' },
]

export function describeAdminAction(method: string, path: string): { actionLabel: string; detail: string } | null {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return null
  const normalized = path.replace(/\?.*$/, '')
  for (const rule of ACTION_RULES) {
    if (!rule.test.test(normalized)) continue
    if (!rule.label) return null
    return { actionLabel: rule.label, detail: `${method} ${normalized}` }
  }
  if (normalized.startsWith('/api/admin/')) {
    return { actionLabel: '后台写操作', detail: `${method} ${normalized}` }
  }
  return null
}

export async function writeAdminOperationLog(
  prisma: PrismaClient,
  adminId: string,
  actionLabel: string,
  detail = '',
  method?: string,
  path?: string,
) {
  await prisma.adminOperationLog.create({
    data: { adminId, actionLabel, detail, method, path },
  })
}

export function sessionDurationMs(loginAt: Date, logoutAt: Date | null, lastSeenAt: Date) {
  const end = logoutAt ?? lastSeenAt
  return Math.max(0, end.getTime() - loginAt.getTime())
}
