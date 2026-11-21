import type { Express, RequestHandler } from 'express'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { sessionDurationMs } from './adminActivity.js'
import {
  ensureDemoOccupancy,
  ensureTodayBusinessSnapshots,
  reportKindLabel,
  reportKindsForDate,
  startOfLocalDay,
  upsertBusinessSnapshot,
  type BusinessReportKind,
} from './businessMetrics.js'

function roleLabel(code: string) {
  if (code === 'SYSTEM_ADMIN') return '系统管理员'
  if (code === 'STORE_MANAGER') return '店长'
  if (code === 'FINANCE') return '财务'
  return code
}

function ymd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseMonth(raw: unknown) {
  const text = String(raw ?? '')
  const m = /^(\d{4})-(\d{2})$/.exec(text)
  if (!m) {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  }
  return { year: Number(m[1]), month: Number(m[2]) }
}

function monthRange(year: number, month: number) {
  const from = new Date(year, month - 1, 1)
  const to = new Date(year, month, 0, 23, 59, 59, 999)
  return { from, to }
}

const DEMO_OPS: Array<{ label: string; detail: (day: string, n: number) => string }> = [
  { label: '登录系统', detail: (day) => `账号密码登录成功 · ${day}` },
  { label: '查看订单列表', detail: (day, n) => `筛选待审核订单 · ${day} · 第 ${n} 次` },
  { label: '订单审核', detail: (day, n) => `审核通过订单 DD${String(20261100 + n).slice(-6)} · ${day}` },
  { label: '配置合同', detail: (day, n) => `保存合同草稿 HT${String(20261100 + n).slice(-6)} · ${day}` },
  { label: '登记合同 OA 结果', detail: (day) => `登记内部 OA 通过 · ${day}` },
  { label: '房源上架', detail: (day, n) => `上架房源 ${100 + n} 室 · ${day}` },
  { label: '房源配置', detail: (day, n) => `更新收款方/坐落资料 · 房源 ${100 + n} · ${day}` },
  { label: '查看账单', detail: (day) => `打开账单管理并筛选本月账期 · ${day}` },
  { label: '账单操作', detail: (day, n) => `线下核销账单 ¥${(800 + n * 37).toFixed(0)} · ${day}` },
  { label: '处理逾期催缴', detail: (day, n) => `发送催缴提醒 · 逾期 ${n % 5 + 1} 天 · ${day}` },
  { label: '查看交易记录', detail: (day) => `导出交易流水预览 · ${day}` },
  { label: '交易/收据操作', detail: (day, n) => `打印收据 · 流水 ${n} · ${day}` },
  { label: '更新租客档案', detail: (day, n) => `调整信誉度标记 · 租客档案 #${n} · ${day}` },
  { label: '处理转租申请', detail: (day, n) => `初审转租申请 ZZ${String(20261100 + n).slice(-6)} · ${day}` },
  { label: '合同操作', detail: (day) => `查看合同详情与账单明细 · ${day}` },
  { label: '退出系统', detail: (day) => `主动退出登录 · ${day}` },
]

/** 把接近 0 时长的空开会话补成合理演示时长，避免列表出现「0 分钟」 */
async function polishTinySessions(prisma: PrismaClient) {
  const open = await prisma.adminLoginSession.findMany({
    where: { logoutAt: null },
    select: { id: true, adminId: true, loginAt: true, lastSeenAt: true },
  })
  for (const session of open) {
    const ms = sessionDurationMs(session.loginAt, null, session.lastSeenAt)
    if (ms >= 60_000) continue
    const mins = 85 + (session.adminId.charCodeAt(session.adminId.length - 1) % 95)
    const end = new Date(session.loginAt.getTime() + mins * 60_000)
    await prisma.adminLoginSession.update({
      where: { id: session.id },
      data: { lastSeenAt: end, logoutAt: end },
    })
  }
}

/** 丰富考勤/操作演示数据；不足时重建（保留进行中的登录会话） */
async function ensureAttendanceDemo(prisma: PrismaClient) {
  await polishTinySessions(prisma)

  const opCount = await prisma.adminOperationLog.count()
  const sessionCount = await prisma.adminLoginSession.count()
  if (opCount >= 150 && sessionCount >= 30) return

  const admins = await prisma.admin.findMany({
    include: { adminStores: { include: { store: true } } },
    orderBy: { createdAt: 'asc' },
  })
  if (!admins.length) return

  await prisma.adminOperationLog.deleteMany({})
  await prisma.adminLoginSession.deleteMany({ where: { logoutAt: { not: null } } })

  const now = new Date()
  const sessions: Array<{
    adminId: string
    loginAt: Date
    logoutAt: Date
    lastSeenAt: Date
    ip: string
  }> = []
  const ops: Array<{
    adminId: string
    actionLabel: string
    detail: string
    method: string
    path: string
    occurredAt: Date
  }> = []

  for (const admin of admins) {
    const storeName = admin.adminStores[0]?.store.name ?? '总部'
    for (let dayOffset = 0; dayOffset <= 45; dayOffset += 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset)
      const weekend = day.getDay() === 0 || day.getDay() === 6
      const baseChance = admin.roleCode === 'SYSTEM_ADMIN' ? 0.95 : admin.roleCode === 'STORE_MANAGER' ? 0.86 : 0.8
      const chance = weekend ? baseChance * 0.42 : baseChance
      const seed = (admin.id.charCodeAt(admin.id.length - 1) + dayOffset * 17 + admin.name.length * 3) % 100
      if (seed / 100 > chance) continue

      const sessionCount = !weekend && seed % 7 === 0 ? 2 : 1
      for (let s = 0; s < sessionCount; s += 1) {
        const loginHour = (s === 0 ? 8 : 14) + (seed % 3)
        const loginMin = (seed * 7 + s * 11) % 50
        const loginAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), loginHour, loginMin)
        const durationMin = 55 + (seed % 160) + s * 25
        const lastSeenAt = new Date(loginAt.getTime() + durationMin * 60_000)
        const logoutAt = new Date(lastSeenAt.getTime() + (3 + (seed % 8)) * 60_000)
        const dayText = ymd(day)
        sessions.push({
          adminId: admin.id,
          loginAt,
          logoutAt,
          lastSeenAt,
          ip: `10.0.${(seed % 20) + 1}.${(seed % 200) + 10}`,
        })

        ops.push({
          adminId: admin.id,
          actionLabel: '登录系统',
          detail: `账号密码登录成功 · ${storeName} · ${dayText}`,
          method: 'POST',
          path: '/api/admin/login',
          occurredAt: loginAt,
        })

        const opCountToday = 4 + (seed % 6)
        for (let i = 0; i < opCountToday; i += 1) {
          const spec = DEMO_OPS[(seed + i + s * 3) % (DEMO_OPS.length - 2) + 1]
          ops.push({
            adminId: admin.id,
            actionLabel: spec.label,
            detail: `${spec.detail(dayText, seed + i)} · ${storeName}`,
            method: i % 3 === 0 ? 'GET' : 'POST',
            path: `/api/admin/demo/${encodeURIComponent(spec.label)}`,
            occurredAt: new Date(loginAt.getTime() + (i + 1) * (12 + (seed % 9)) * 60_000),
          })
        }

        ops.push({
          adminId: admin.id,
          actionLabel: '退出系统',
          detail: `主动退出登录 · ${storeName} · ${dayText}`,
          method: 'POST',
          path: '/api/admin/logout',
          occurredAt: logoutAt,
        })
      }
    }
  }

  if (sessions.length) await prisma.adminLoginSession.createMany({ data: sessions })
  if (ops.length) await prisma.adminOperationLog.createMany({ data: ops })
}

async function ensureBusinessDemo(prisma: PrismaClient) {
  await ensureDemoOccupancy(prisma)

  const total = await prisma.businessMetricSnapshot.count()
  const zeroOcc = await prisma.businessMetricSnapshot.count({
    where: {
      houseCount: { gt: 0 },
      OR: [{ signedCount: 0 }, { rentedArea: 0 }, { occupancyRate: 0 }],
    },
  })
  // 已有非空快照且出租相关字段正常时，仅补当天节点
  if (total > 0 && zeroOcc === 0) {
    await ensureTodayBusinessSnapshots(prisma)
    return
  }

  await prisma.businessMetricSnapshot.deleteMany({})
  const now = new Date()
  for (let offset = 0; offset <= 60; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
    for (const kind of reportKindsForDate(day)) {
      await upsertBusinessSnapshot(prisma, day, kind)
    }
  }
  const after = await prisma.businessMetricSnapshot.count()
  if (!after) await upsertBusinessSnapshot(prisma, now, 'MANUAL')
}

export function registerWorkbenchInsightRoutes(
  app: Express,
  prisma: PrismaClient,
  authorize: RequestHandler,
) {
  // ---------- 考勤记录表 ----------
  app.get('/api/admin/workbench/attendance', authorize, async (req, res) => {
    try {
      await ensureAttendanceDemo(prisma)
      const { year, month } = parseMonth(req.query.month)
      const { from, to } = monthRange(year, month)
      const storeId = typeof req.query.storeId === 'string' && req.query.storeId ? req.query.storeId : null

      const admins = await prisma.admin.findMany({
        include: {
          adminStores: { include: { store: { select: { id: true, name: true } } } },
        },
        orderBy: [{ roleCode: 'asc' }, { name: 'asc' }],
      })
      const filtered = storeId
        ? admins.filter((a) => a.adminStores.some((s) => s.storeId === storeId))
        : admins

      const adminIds = filtered.map((a) => a.id)
      const sessions = await prisma.adminLoginSession.findMany({
        where: { adminId: { in: adminIds }, loginAt: { gte: from, lte: to } },
        orderBy: { loginAt: 'asc' },
      })
      const opCounts = await prisma.adminOperationLog.groupBy({
        by: ['adminId'],
        where: { adminId: { in: adminIds }, occurredAt: { gte: from, lte: to } },
        _count: { _all: true },
      })
      const opMap = new Map(opCounts.map((r) => [r.adminId, r._count._all]))

      const items = filtered.map((admin) => {
        const mine = sessions.filter((s) => s.adminId === admin.id)
        const signedDays = new Set(mine.map((s) => ymd(s.loginAt)))
        const durationMs = mine.reduce(
          (sum, s) => sum + sessionDurationMs(s.loginAt, s.logoutAt, s.lastSeenAt),
          0,
        )
        const last = mine[mine.length - 1]
        return {
          adminId: admin.id,
          name: admin.name,
          email: admin.email,
          roleCode: admin.roleCode,
          roleLabel: roleLabel(admin.roleCode),
          stores: admin.adminStores.map((s) => s.store.name),
          loginCount: mine.length,
          signedDays: signedDays.size,
          operationCount: opMap.get(admin.id) ?? 0,
          durationMs,
          lastLoginAt: last?.loginAt?.toISOString() ?? null,
          lastLogoutAt: last?.logoutAt?.toISOString() ?? null,
        }
      })

      const stores = await prisma.store.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })

      res.json({
        month: `${year}-${String(month).padStart(2, '0')}`,
        stores,
        items,
      })
    } catch {
      res.status(500).json({ error: '考勤数据暂时无法读取，请重试。' })
    }
  })

  app.get('/api/admin/workbench/attendance/:adminId', authorize, async (req, res) => {
    try {
      await ensureAttendanceDemo(prisma)
      const adminId = String(req.params.adminId)
      const { year, month } = parseMonth(req.query.month)
      const { from, to } = monthRange(year, month)
      const dayFilter = typeof req.query.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day)
        ? req.query.day
        : null

      const admin = await prisma.admin.findUnique({
        where: { id: adminId },
        include: { adminStores: { include: { store: { select: { name: true } } } } },
      })
      if (!admin) return res.status(404).json({ error: '未找到该管理员' })

      const sessions = await prisma.adminLoginSession.findMany({
        where: { adminId, loginAt: { gte: from, lte: to } },
        orderBy: { loginAt: 'desc' },
      })

      const daySet = new Set(sessions.map((s) => ymd(s.loginAt)))
      const daysInMonth = new Date(year, month, 0).getDate()
      const calendar = Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const today = ymd(new Date())
        const future = date > today
        return {
          date,
          signed: daySet.has(date),
          status: future ? 'future' : daySet.has(date) ? 'signed' : 'absent',
        }
      })

      const sessionItems = sessions
        .filter((s) => !dayFilter || ymd(s.loginAt) === dayFilter)
        .map((s) => ({
          id: s.id,
          loginAt: s.loginAt.toISOString(),
          logoutAt: s.logoutAt?.toISOString() ?? null,
          lastSeenAt: s.lastSeenAt.toISOString(),
          durationMs: sessionDurationMs(s.loginAt, s.logoutAt, s.lastSeenAt),
          ip: s.ip,
        }))

      const opWhere = dayFilter
        ? {
            adminId,
            occurredAt: {
              gte: new Date(`${dayFilter}T00:00:00`),
              lte: new Date(`${dayFilter}T23:59:59.999`),
            },
          }
        : { adminId, occurredAt: { gte: from, lte: to } }

      const operations = await prisma.adminOperationLog.findMany({
        where: opWhere,
        orderBy: { occurredAt: 'desc' },
        take: 200,
      })

      res.json({
        month: `${year}-${String(month).padStart(2, '0')}`,
        day: dayFilter,
        admin: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          roleCode: admin.roleCode,
          roleLabel: roleLabel(admin.roleCode),
          stores: admin.adminStores.map((s) => s.store.name),
        },
        summary: {
          loginCount: sessions.length,
          signedDays: daySet.size,
          durationMs: sessions.reduce(
            (sum, s) => sum + sessionDurationMs(s.loginAt, s.logoutAt, s.lastSeenAt),
            0,
          ),
          operationCount: operations.length,
        },
        calendar,
        sessions: sessionItems,
        operations: operations.map((o) => ({
          id: o.id,
          actionLabel: o.actionLabel,
          detail: o.detail,
          method: o.method,
          path: o.path,
          occurredAt: o.occurredAt.toISOString(),
        })),
      })
    } catch {
      res.status(500).json({ error: '考勤详情暂时无法读取，请重试。' })
    }
  })

  // ---------- 阅读数据：领导查看使用人员操作轨迹 ----------
  app.get('/api/admin/workbench/reading', authorize, async (req, res) => {
    try {
      await ensureAttendanceDemo(prisma)

      const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30) || 30))
      const adminId = typeof req.query.adminId === 'string' && req.query.adminId ? req.query.adminId : null
      const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : ''
      const to = new Date()
      const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (days - 1), 0, 0, 0, 0)

      const admins = await prisma.admin.findMany({
        include: { adminStores: { include: { store: { select: { name: true } } } } },
        orderBy: [{ roleCode: 'asc' }, { name: 'asc' }],
      })
      const adminMap = new Map(admins.map((a) => [a.id, a]))

      const sessionWhere = {
        loginAt: { gte: from, lte: to },
        ...(adminId ? { adminId } : {}),
      }
      const sessions = await prisma.adminLoginSession.findMany({
        where: sessionWhere,
        orderBy: { loginAt: 'desc' },
        take: 500,
      })

      const opWhere = {
        occurredAt: { gte: from, lte: to },
        ...(adminId ? { adminId } : {}),
        ...(keyword
          ? {
              OR: [
                { actionLabel: { contains: keyword } },
                { detail: { contains: keyword } },
              ],
            }
          : {}),
      }
      const operations = await prisma.adminOperationLog.findMany({
        where: opWhere,
        orderBy: { occurredAt: 'desc' },
        take: 500,
      })

      const durationMs = sessions.reduce(
        (sum, s) => sum + sessionDurationMs(s.loginAt, s.logoutAt, s.lastSeenAt),
        0,
      )
      const activeAdminIds = new Set([
        ...sessions.map((s) => s.adminId),
        ...operations.map((o) => o.adminId),
      ])

      const byAdmin = admins.map((admin) => {
        const mineSessions = sessions.filter((s) => s.adminId === admin.id)
        const mineOps = operations.filter((o) => o.adminId === admin.id)
        return {
          adminId: admin.id,
          name: admin.name,
          roleLabel: roleLabel(admin.roleCode),
          stores: admin.adminStores.map((s) => s.store.name),
          loginCount: mineSessions.length,
          operationCount: mineOps.length,
          durationMs: mineSessions.reduce(
            (sum, s) => sum + sessionDurationMs(s.loginAt, s.logoutAt, s.lastSeenAt),
            0,
          ),
          lastActiveAt: mineOps[0]?.occurredAt?.toISOString()
            ?? mineSessions[0]?.loginAt?.toISOString()
            ?? null,
        }
      }).filter((row) => row.loginCount > 0 || row.operationCount > 0)

      res.json({
        range: { from: ymd(from), to: ymd(to), days },
        summary: {
          activeAdmins: activeAdminIds.size,
          loginCount: sessions.length,
          operationCount: operations.length,
          durationMs,
        },
        admins: admins.map((a) => ({
          id: a.id,
          name: a.name,
          roleLabel: roleLabel(a.roleCode),
          stores: a.adminStores.map((s) => s.store.name),
        })),
        byAdmin,
        operations: operations.map((o) => {
          const admin = adminMap.get(o.adminId)
          return {
            id: o.id,
            occurredAt: o.occurredAt.toISOString(),
            actionLabel: o.actionLabel,
            detail: o.detail,
            method: o.method,
            path: o.path,
            adminId: o.adminId,
            adminName: admin?.name ?? '未知',
            roleLabel: admin ? roleLabel(admin.roleCode) : '—',
            stores: admin?.adminStores.map((s) => s.store.name) ?? [],
          }
        }),
        sessions: sessions.map((s) => {
          const admin = adminMap.get(s.adminId)
          return {
            id: s.id,
            adminId: s.adminId,
            adminName: admin?.name ?? '未知',
            roleLabel: admin ? roleLabel(admin.roleCode) : '—',
            stores: admin?.adminStores.map((st) => st.store.name) ?? [],
            loginAt: s.loginAt.toISOString(),
            logoutAt: s.logoutAt?.toISOString() ?? null,
            durationMs: sessionDurationMs(s.loginAt, s.logoutAt, s.lastSeenAt),
            ip: s.ip,
          }
        }),
      })
    } catch {
      res.status(500).json({ error: '阅读数据暂时无法读取，请重试。' })
    }
  })

  // ---------- 业务数据 ----------
  app.get('/api/admin/workbench/business-metrics', authorize, async (_req, res) => {
    try {
      await ensureBusinessDemo(prisma)
      const items = await prisma.businessMetricSnapshot.findMany({
        orderBy: [{ reportDate: 'desc' }, { projectName: 'asc' }, { createdAt: 'desc' }],
        take: 500,
      })
      const projects = Array.from(new Set(items.map((row) => row.projectName).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, 'zh-CN'),
      )
      res.json({
        scheduleHint: '每周一、每月21日、月末最后一天按项目各生成一行；同日多节点会各记一行。',
        projects,
        items: items.map((row) => ({
          id: row.id,
          reportDate: ymd(row.reportDate),
          reportKind: row.reportKind,
          reportKindLabel: reportKindLabel(row.reportKind),
          projectName: row.projectName,
          occupancyRate: row.occupancyRate,
          collectionRate: row.collectionRate,
          rentableArea: row.rentableArea,
          rentedArea: row.rentedArea,
          receivableAmount: row.receivableAmount,
          collectedAmount: row.collectedAmount,
          houseCount: row.houseCount,
          signedCount: row.signedCount,
          createdAt: row.createdAt.toISOString(),
        })),
      })
    } catch {
      res.status(500).json({ error: '业务数据暂时无法读取，请重试。' })
    }
  })

  app.post('/api/admin/workbench/business-metrics/generate', authorize, async (req, res) => {
    try {
      const body = z
        .object({
          reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          reportKind: z.enum(['WEEKLY_MON', 'MONTH_21', 'MONTH_END', 'MANUAL']).optional(),
        })
        .parse(req.body ?? {})
      const day = body.reportDate
        ? startOfLocalDay(new Date(`${body.reportDate}T12:00:00`))
        : startOfLocalDay(new Date())
      const kind = (body.reportKind ?? 'MANUAL') as BusinessReportKind
      const rows = await upsertBusinessSnapshot(prisma, day, kind)
      res.json({
        ok: true,
        items: rows.map((row) => ({
          id: row.id,
          reportDate: ymd(row.reportDate),
          reportKind: row.reportKind,
          reportKindLabel: reportKindLabel(row.reportKind),
          projectName: row.projectName,
          occupancyRate: row.occupancyRate,
          collectionRate: row.collectionRate,
          rentableArea: row.rentableArea,
          rentedArea: row.rentedArea,
          receivableAmount: row.receivableAmount,
          collectedAmount: row.collectedAmount,
          houseCount: row.houseCount,
          signedCount: row.signedCount,
          createdAt: row.createdAt.toISOString(),
        })),
      })
    } catch {
      res.status(500).json({ error: '生成业务快照失败，请重试。' })
    }
  })
}
