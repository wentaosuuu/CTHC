import type { PrismaClient } from '@prisma/client'

export type BillPushStatus = 'NOT_ENABLED' | 'PENDING_TENANT' | 'ACTIVE'

export function normalizeIdNumber(idNumber: string): string {
  return idNumber.trim().toUpperCase()
}

export function billPushStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'PENDING_TENANT':
      return '等待租户移动端实名'
    case 'ACTIVE':
      return '推送已开通'
    case 'NOT_ENABLED':
    default:
      return '未开启推送'
  }
}

export function tenantPushStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'PENDING_TENANT':
      return '待推送（租户未注册）'
    case 'PUSHED':
      return '已推送'
    case 'SKIPPED':
      return '不推送'
    case 'NONE':
    default:
      return '—'
  }
}

export async function findRegisteredTenantByIdNumber(prisma: PrismaClient, idNumber: string) {
  const norm = normalizeIdNumber(idNumber)
  if (!norm) return null
  return prisma.tenant.findFirst({
    where: { idNumber: norm, mobileVerifiedAt: { not: null } },
    orderBy: { mobileVerifiedAt: 'desc' },
  })
}

export async function applyBillPushForContract(prisma: PrismaClient, contractId: string) {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { tenant: true },
  })
  if (!contract) return

  if (!contract.billPushToTenant) {
    await prisma.contract.update({
      where: { id: contractId },
      data: { billPushStatus: 'NOT_ENABLED' },
    })
    await prisma.bill.updateMany({
      where: { contractId },
      data: { tenantPushStatus: 'SKIPPED', pushedToTenantAt: null },
    })
    return
  }

  const registered = await findRegisteredTenantByIdNumber(prisma, contract.tenant.idNumber)
  if (!registered) {
    await prisma.contract.update({
      where: { id: contractId },
      data: { billPushStatus: 'PENDING_TENANT' },
    })
    await prisma.bill.updateMany({
      where: { contractId, tenantPushStatus: { not: 'PUSHED' } },
      data: { tenantPushStatus: 'PENDING_TENANT', pushedToTenantAt: null },
    })
    return
  }

  const now = new Date()
  await prisma.contract.update({
    where: { id: contractId },
    data: { billPushStatus: 'ACTIVE' },
  })
  await prisma.bill.updateMany({
    where: { contractId },
    data: { tenantPushStatus: 'PUSHED', pushedToTenantAt: now },
  })
}

export async function retryBillPushForIdNumber(prisma: PrismaClient, idNumber: string) {
  const norm = normalizeIdNumber(idNumber)
  if (!norm) return
  const contracts = await prisma.contract.findMany({
    where: {
      billPushToTenant: true,
      tenant: { idNumber: norm },
    },
    select: { id: true },
  })
  for (const c of contracts) {
    await applyBillPushForContract(prisma, c.id)
  }
}

export async function mobileBillsWhere(prisma: PrismaClient, phone: string) {
  const verifiedCaller = await prisma.tenant.findFirst({
    where: { phone: phone.trim(), mobileVerifiedAt: { not: null } },
    select: { idNumber: true },
  })
  const normId = verifiedCaller?.idNumber ? normalizeIdNumber(verifiedCaller.idNumber) : null

  const or: Array<Record<string, unknown>> = [{ contract: { tenant: { phone: phone.trim() } } }]
  if (normId) {
    or.push({
      contract: {
        billPushToTenant: true,
        tenant: { idNumber: normId },
      },
      tenantPushStatus: 'PUSHED',
    })
  }
  return { OR: or }
}

export async function tenantCanAccessBill(
  prisma: PrismaClient,
  phone: string,
  bill: {
    tenantPushStatus: string
    contract: { billPushToTenant: boolean; tenant: { phone: string; idNumber: string } }
  },
): Promise<boolean> {
  const p = phone.trim()
  if (bill.contract.tenant.phone === p) return true
  if (!bill.contract.billPushToTenant || bill.tenantPushStatus !== 'PUSHED') return false
  const caller = await prisma.tenant.findFirst({
    where: { phone: p, mobileVerifiedAt: { not: null } },
    select: { idNumber: true },
  })
  if (!caller?.idNumber) return false
  return normalizeIdNumber(caller.idNumber) === normalizeIdNumber(bill.contract.tenant.idNumber)
}
