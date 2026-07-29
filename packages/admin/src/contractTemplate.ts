/** 后台合同配置弹窗可选的合同模板（存库值） */
export const CONTRACT_TEMPLATES = [
  { value: 'RESIDENTIAL_ASSET', label: '住宅资产租赁合同书' },
  { value: 'JIANGNAN_FACTORY', label: '产投江南企业公园厂房租赁合同' },
  { value: 'NON_RESIDENTIAL', label: '非住宅资产租赁合同' },
  { value: 'NANNING_HOUSING', label: '南宁市房屋租赁合同（泊湾公寓）' },
] as const

export type ContractTemplateKind = (typeof CONTRACT_TEMPLATES)[number]['value']

const LABEL_BY_VALUE = Object.fromEntries(CONTRACT_TEMPLATES.map((t) => [t.value, t.label])) as Record<
  ContractTemplateKind,
  string
>

/** 兼容历史 TRIPARTITE / APARTMENT 存库值 */
export function normalizeContractTemplate(v: string | undefined | null): ContractTemplateKind {
  if (v === 'RESIDENTIAL_ASSET' || v === 'JIANGNAN_FACTORY' || v === 'NON_RESIDENTIAL' || v === 'NANNING_HOUSING') {
    return v
  }
  if (v === 'TRIPARTITE') return 'NON_RESIDENTIAL'
  if (v === 'APARTMENT') return 'RESIDENTIAL_ASSET'
  return 'RESIDENTIAL_ASSET'
}

export function contractTemplateZh(t: string | undefined | null): string {
  const k = normalizeContractTemplate(t)
  return LABEL_BY_VALUE[k]
}

/** 解除类短信：按「逾期金额超过月租倍数」规则（非住宅类） */
export function contractTemplateUsesRentMultipleTermination(t: string | undefined | null): boolean {
  return normalizeContractTemplate(t) === 'NON_RESIDENTIAL'
}
