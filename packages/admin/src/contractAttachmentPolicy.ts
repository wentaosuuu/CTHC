/** 与后端一致：已盖章、待租客完成首笔缴费（`PENDING_PAYMENT`） */
export function contractAttachmentsLockedUntilPaid(status: string | null | undefined): boolean {
  return status === 'PENDING_PAYMENT'
}
