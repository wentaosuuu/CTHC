import type { MoveOutSettlementType } from './moveOutSettlement'

/** 《退租申请书》四种情况（店长配置，租户端只读勾选） */
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
  /** 情况二/三/四：申请提前退租交房日 */
  earlyTerminateDate?: string
  /** 情况四：费用覆盖至合同到期日 */
  coveredUntilDate?: string
  /** 情况三店长内部备注（租户签署页隐藏） */
  landlordInternalReason?: string
  tenantName: string
  tenantIdNumber: string
  contractNo: string
  propertyAddress: string
  leaseStartDate: string
  leaseEndDate: string
}

export const MOVE_OUT_APPLICATION_CASE_OPTIONS: Array<{
  value: MoveOutApplicationCase
  label: string
  shortLabel: string
  hint: string
}> = [
  {
    value: 'CASE_1_NORMAL_EXPIRY',
    label: '情况一：正常到期退租',
    shortLabel: '情况一（正常到期退租）',
    hint: '租赁期限届满、不续租',
  },
  {
    value: 'CASE_2_NEGOTIATED_TENANT',
    label: '情况二：协商提前退租（承租方原因）',
    shortLabel: '情况二（协商提前退租 · 承租方原因）',
    hint: '租户原因协商提前退租，需填写原因与交房日',
  },
  {
    value: 'CASE_3_NEGOTIATED_LANDLORD',
    label: '情况三：协商提前退租（出租方原因）',
    shortLabel: '情况三（协商提前退租 · 出租方原因）',
    hint: '公司事由协商提前退租；内部原因仅店长可见',
  },
  {
    value: 'CASE_4_SETTLED_EARLY',
    label: '情况四：结清提前退租',
    shortLabel: '情况四（结清提前退租）',
    hint: '费用已结清或可由押金覆盖至到期日',
  },
]

export const TENANT_EARLY_REASON_OPTIONS: Array<{ value: MoveOutTenantEarlyReason; label: string }> = [
  { value: 'JOB_RELOCATION', label: '工作异地调动' },
  { value: 'FAMILY_ILLNESS', label: '本人或直系亲属患病需返乡照料' },
  { value: 'OTHER', label: '其他特殊原因' },
]

export function applicationCaseToSettlementType(caseType: MoveOutApplicationCase): MoveOutSettlementType {
  switch (caseType) {
    case 'CASE_1_NORMAL_EXPIRY':
      return 'NORMAL_EXPIRY'
    case 'CASE_4_SETTLED_EARLY':
      return 'SETTLED_EARLY'
    case 'CASE_2_NEGOTIATED_TENANT':
    case 'CASE_3_NEGOTIATED_LANDLORD':
      return 'NEGOTIATED_EARLY'
  }
}

export function settlementTypeToApplicationCase(type: MoveOutSettlementType): MoveOutApplicationCase {
  switch (type) {
    case 'NORMAL_EXPIRY':
      return 'CASE_1_NORMAL_EXPIRY'
    case 'SETTLED_EARLY':
      return 'CASE_4_SETTLED_EARLY'
    case 'NEGOTIATED_EARLY':
      return 'CASE_2_NEGOTIATED_TENANT'
    case 'BREACH_EARLY':
      return 'CASE_2_NEGOTIATED_TENANT'
  }
}

export function formatCnDate(ymd: string | undefined | null) {
  if (!ymd || ymd.length < 8) return '____年__月__日'
  const [y, m, d] = ymd.split('-')
  if (!y || !m || !d) return '____年__月__日'
  return `${y}年${Number(m)}月${Number(d)}日`
}

export function applicationCaseLabel(caseType: MoveOutApplicationCase) {
  return MOVE_OUT_APPLICATION_CASE_OPTIONS.find((o) => o.value === caseType)?.label ?? caseType
}

export function validateMoveOutApplication(app: MoveOutApplicationSnapshot): string | null {
  if (!app.caseType) return '请选择退租申请情形'
  if (app.caseType === 'CASE_2_NEGOTIATED_TENANT') {
    if (!app.earlyTerminateDate) return '请填写情况二的提前退租交房日'
    if (!app.tenantEarlyReason) return '请选择情况二的提前退租原因'
    if (app.tenantEarlyReason === 'OTHER' && !app.tenantEarlyReasonOther?.trim()) {
      return '请填写其他特殊原因'
    }
  }
  if (app.caseType === 'CASE_3_NEGOTIATED_LANDLORD') {
    if (!app.earlyTerminateDate) return '请填写情况三的提前退租交房日'
    if (!app.landlordInternalReason?.trim()) return '请填写情况三店长内部原因（租户端不展示）'
  }
  if (app.caseType === 'CASE_4_SETTLED_EARLY') {
    if (!app.coveredUntilDate) return '请填写情况四费用覆盖至合同到期日'
    if (!app.earlyTerminateDate) return '请填写情况四申请提前退租交房日'
  }
  return null
}
