import type { Apartment, Contract, House, Order, OrderLine, Store, Tenant } from '@prisma/client'
import { toYmd } from './time.js'

export type ContractForSummaryText = Contract & {
  tenant: Tenant
  house: House & { apartment: Apartment & { store: Store } }
  order:
    | (Pick<Order, 'isMergedBundle'> & {
        lines: (OrderLine & { house: House & { apartment: Apartment } })[]
      })
    | null
}

export function buildContractSummaryText(contract: ContractForSummaryText): string {
  const lines: string[] = []
  lines.push('租赁合同摘要（系统生成）')
  lines.push('')
  lines.push(`合同编号：${contract.contractNo}`)
  lines.push(`状态：${contract.status}`)
  lines.push(`门店：${contract.house.apartment.store.name}`)
  lines.push(`公寓：${contract.house.apartment.name}`)
  lines.push(`房号：${contract.house.houseNo}`)
  lines.push(`租客：${contract.tenant.name}  ${contract.tenant.phone}`)
  lines.push(`租期：${toYmd(contract.startDate)} 至 ${toYmd(contract.endDate)}`)
  lines.push(`月租：¥${contract.rentMonthly}  押金：¥${contract.deposit}`)
  lines.push(`缴费周期：${contract.rentCycle ?? '—'}  滞纳金公式：${contract.penaltyFormula ?? '—'}`)

  const ol = contract.order?.lines?.filter((l) => !l.releasedAt) ?? []
  if (contract.order?.isMergedBundle && ol.length > 0) {
    lines.push('')
    lines.push('合并签约（当前在租子房源）：')
    for (const ln of ol) {
      lines.push(
        `  · ${ln.house.apartment.name} ${ln.house.houseNo}  月租快照 ¥${ln.rentMonthlySnapshot}`,
      )
    }
  }
  lines.push('')
  lines.push(
    '说明：本文件为系统根据当前合同数据生成的文本摘要，供下载留存；正式权利义务以双方签章的纸质/电子合同为准。',
  )
  return lines.join('\n')
}
