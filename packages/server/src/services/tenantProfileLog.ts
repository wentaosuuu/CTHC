import type { Admin, PrismaClient, Tenant } from '@prisma/client'

export type TenantProfileLogOperatorKind = 'ADMIN' | 'TENANT'

export async function insertTenantProfileLog(
  prisma: PrismaClient,
  params: {
    tenantId: string
    actionLabel: string
    detail?: string
    operatorKind: TenantProfileLogOperatorKind
    admin?: Pick<Admin, 'id' | 'name' | 'email'> | null
    occurredAt?: Date
  },
): Promise<void> {
  await prisma.tenantProfileLog.create({
    data: {
      tenantId: params.tenantId,
      actionLabel: params.actionLabel,
      detail: params.detail ?? '',
      operatorKind: params.operatorKind,
      adminId: params.admin?.id ?? null,
      adminName: params.admin?.name ?? (params.operatorKind === 'TENANT' ? '租客自主' : null),
      adminEmail: params.admin?.email ?? null,
      occurredAt: params.occurredAt ?? new Date(),
    },
  })
}

type TenantForSynthetic = Pick<
  Tenant,
  'id' | 'createdAt' | 'createdSource' | 'tenantKind' | 'mobileVerifiedAt' | 'creditTier'
> & {
  createdByAdmin?: { name: string; email: string } | null
}

export function syntheticTenantProfileLogs(t: TenantForSynthetic) {
  const rows: {
    id: string
    actionLabel: string
    detail: string
    occurredAt: string
    operatorName: string
    operatorEmail: string
    operatorKind: TenantProfileLogOperatorKind
    synthetic: boolean
  }[] = []

  rows.push({
    id: `syn_create_${t.id}`,
    actionLabel: '档案入档',
    detail:
      t.createdSource === 'ADMIN'
        ? `后台代建${t.tenantKind === 'ENTERPRISE' ? '企业' : '个人'}档案`
        : '租客自主（移动端下单或实名注册）',
    occurredAt: t.createdAt.toISOString(),
    operatorName: t.createdSource === 'ADMIN' ? (t.createdByAdmin?.name ?? '后台') : '租客自主',
    operatorEmail: t.createdSource === 'ADMIN' ? (t.createdByAdmin?.email ?? '') : '',
    operatorKind: t.createdSource === 'ADMIN' ? 'ADMIN' : 'TENANT',
    synthetic: true,
  })

  if (t.mobileVerifiedAt) {
    rows.push({
      id: `syn_verify_${t.id}`,
      actionLabel: '完成实名认证',
      detail: '移动端实名认证通过',
      occurredAt: t.mobileVerifiedAt.toISOString(),
      operatorName: '租客自主',
      operatorEmail: '',
      operatorKind: 'TENANT',
      synthetic: true,
    })
  }

  return rows
}

export function mergeTenantProfileLogs(
  tenant: TenantForSynthetic,
  dbLogs: {
    id: string
    actionLabel: string
    detail: string
    occurredAt: Date
    operatorKind: string
    adminName: string | null
    adminEmail: string | null
  }[],
) {
  const dbMapped = dbLogs.map((l) => ({
    id: l.id,
    actionLabel: l.actionLabel,
    detail: l.detail,
    occurredAt: l.occurredAt.toISOString(),
    operatorName: l.operatorKind === 'TENANT' ? '租客自主' : (l.adminName ?? '后台'),
    operatorEmail: l.adminEmail ?? '',
    operatorKind: (l.operatorKind === 'TENANT' ? 'TENANT' : 'ADMIN') as TenantProfileLogOperatorKind,
    synthetic: false,
  }))

  const hasCreate = dbMapped.some((l) => l.actionLabel === '档案入档')
  const hasVerify = dbMapped.some((l) => l.actionLabel === '完成实名认证')
  const synthetic = syntheticTenantProfileLogs(tenant).filter((s) => {
    if (s.actionLabel === '档案入档' && hasCreate) return false
    if (s.actionLabel === '完成实名认证' && hasVerify) return false
    return true
  })

  return [...dbMapped, ...synthetic].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
}
