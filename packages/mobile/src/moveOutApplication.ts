/** 与店长端《退租申请书》配置对齐的只读展示类型 */

export type MoveOutApplicationCase =
  | 'CASE_1_NORMAL_EXPIRY'
  | 'CASE_2_NEGOTIATED_TENANT'
  | 'CASE_3_NEGOTIATED_LANDLORD'
  | 'CASE_4_SETTLED_EARLY'

export type MoveOutTenantEarlyReason = 'JOB_RELOCATION' | 'FAMILY_ILLNESS' | 'OTHER'

export type MoveOutApplicationSnapshot = {
  caseType: MoveOutApplicationCase
  tenantEarlyReason?: MoveOutTenantEarlyReason | null
  tenantEarlyReasonOther?: string
  earlyTerminateDate?: string
  coveredUntilDate?: string
  /** 店长内部备注：租户端不应展示 */
  landlordInternalReason?: string
  tenantName: string
  tenantIdNumber: string
  contractNo: string
  propertyAddress: string
  leaseStartDate: string
  leaseEndDate: string
}

export const TENANT_EARLY_REASON_LABEL: Record<MoveOutTenantEarlyReason, string> = {
  JOB_RELOCATION: '工作异地调动',
  FAMILY_ILLNESS: '本人或直系亲属患病需返乡照料',
  OTHER: '其他特殊原因',
}

export function formatCnDate(ymd: string | undefined | null) {
  if (!ymd || ymd.length < 8) return '____年__月__日'
  const [y, m, d] = ymd.split('-')
  if (!y || !m || !d) return '____年__月__日'
  return `${y}年${Number(m)}月${Number(d)}日`
}

export function applicationCaseShortLabel(caseType: MoveOutApplicationCase) {
  switch (caseType) {
    case 'CASE_1_NORMAL_EXPIRY':
      return '情况一（正常到期退租）'
    case 'CASE_2_NEGOTIATED_TENANT':
      return '情况二（协商提前退租 · 承租方原因）'
    case 'CASE_3_NEGOTIATED_LANDLORD':
      return '情况三（协商提前退租 · 出租方原因）'
    case 'CASE_4_SETTLED_EARLY':
      return '情况四（结清提前退租）'
  }
}
