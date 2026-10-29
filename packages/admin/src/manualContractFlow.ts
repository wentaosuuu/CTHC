export type ManualInteractionMode = 'SIGN_AND_PAY' | 'BILL_ONLY' | 'NONE'
export type ManualFlowInfo = {
  interactionMode?: ManualInteractionMode | null
  manualFlowStage?: 'READY_TO_SEND' | 'SIGNING' | 'MATERIALS_PENDING' | 'WAIT_PAYMENT' | 'ACTIVE' | null
  canPushSignature?: boolean
  canCompleteMaterials?: boolean
  canSimulateSigned?: boolean
  canSimulatePaid?: boolean
}
export const MANUAL_MODE_OPTIONS: { value: ManualInteractionMode; label: string; description: string; submitLabel: string }[] = [
  { value: 'SIGN_AND_PAY', label: '推送租户签字并付款', description: '创建后为待签字合同，不生成账单。业务流程是在合同列表点击“推送签署”，由系统创建契约锁签署合同并发送短信；租户签完后生成账单并进入待支付，首期款结清后生效。', submitLabel: '创建待签合同' },
  { value: 'BILL_ONLY', label: '上传线下已签合同，仅推账单', description: '线下已签字盖章，必须上传合同附件。附件完成后生成首期租金与押金账单并推送给租户，租户只读查看合同并付款，首期租金与押金结清后生效。', submitLabel: '确认创建并生成账单' },
  { value: 'NONE', label: '仅记录，不推送租户', description: '合同直接生效并生成账单，租户不可见，请线下收款后在后台核销。可选择空置或已签约资产；选择已签约资产会新增生效合同，请确认不会重复计费。', submitLabel: '确认创建并生效（不推送租户）' },
]

export function manualFlowStatusLabel(info: ManualFlowInfo & { status?: string }, fallback: string): string {
  if (info.status && info.status !== 'WAIT_TENANT_SIGN') return fallback
  if (info.manualFlowStage === 'MATERIALS_PENDING') return '待补合同附件'
  if (info.manualFlowStage === 'READY_TO_SEND') return '待推送签署'
  if (info.manualFlowStage === 'SIGNING') return '待租户签字'
  return fallback
}
