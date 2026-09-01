import type { PrismaClient } from '@prisma/client'

/**
 * 合同生效后回写产投资产管理系统（演示 stub：写日志，不接真实接口）。
 * 流程图：合同生效 → 同步资产状态及合同信息。
 */
export async function notifyAssetSystemOnContractActive(
  prisma: PrismaClient,
  contractId: string,
): Promise<{ ok: true; stub: true; payload: Record<string, unknown> }> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: {
      house: { include: { apartment: { include: { store: true } } } },
      tenant: true,
    },
  })
  if (!contract) {
    return { ok: true, stub: true, payload: { skipped: true, reason: 'NOT_FOUND' } }
  }

  const payload = {
    event: 'CONTRACT_ACTIVE',
    at: new Date().toISOString(),
    contractNo: contract.contractNo,
    contractId: contract.id,
    houseExternalId: contract.house.externalId,
    houseBiz: {
      storeName: contract.house.apartment.store.name,
      apartmentName: contract.house.apartment.name,
      houseNo: contract.house.houseNo,
      assetType: contract.house.apartment.assetType,
    },
    assetStatus: 'SIGNED',
    tenantName: contract.tenant.name,
    lease: {
      startDate: contract.startDate.toISOString().slice(0, 10),
      endDate: contract.endDate.toISOString().slice(0, 10),
      rentMonthly: contract.rentMonthly,
    },
  }

  // eslint-disable-next-line no-console
  console.log('[asset-system-stub] outbound sync', JSON.stringify(payload))
  return { ok: true, stub: true, payload }
}
