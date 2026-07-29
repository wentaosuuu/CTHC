export const CONTRACT_TEMPLATE_VALUES = [
  'RESIDENTIAL_ASSET',
  'JIANGNAN_FACTORY',
  'NON_RESIDENTIAL',
  'NANNING_HOUSING',
] as const

export type ContractTemplateKind = (typeof CONTRACT_TEMPLATE_VALUES)[number]

/** 兼容历史 TRIPARTITE / APARTMENT 存库值，写入时统一为新枚举 */
export function normalizeContractTemplate(v: string | undefined | null): ContractTemplateKind {
  if (
    v === 'RESIDENTIAL_ASSET' ||
    v === 'JIANGNAN_FACTORY' ||
    v === 'NON_RESIDENTIAL' ||
    v === 'NANNING_HOUSING'
  ) {
    return v
  }
  if (v === 'TRIPARTITE') return 'NON_RESIDENTIAL'
  if (v === 'APARTMENT') return 'RESIDENTIAL_ASSET'
  return 'RESIDENTIAL_ASSET'
}

export function contractTemplateUsesRentMultipleTermination(t: string | undefined | null): boolean {
  return normalizeContractTemplate(t) === 'NON_RESIDENTIAL'
}

export function contractTemplateTerminationData(body: {
  contractTemplate?: string | null
  terminationRentMultiple?: number | null
  terminationDaysPastDue?: number | null
}) {
  const tmpl = normalizeContractTemplate(body.contractTemplate)
  const usesRentMulti = contractTemplateUsesRentMultipleTermination(tmpl)
  return {
    contractTemplate: tmpl,
    terminationRentMultiple: usesRentMulti ? body.terminationRentMultiple ?? null : null,
    terminationDaysPastDue: !usesRentMulti ? body.terminationDaysPastDue ?? null : null,
  }
}
