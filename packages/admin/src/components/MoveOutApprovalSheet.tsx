import { settlementTypeLabel, type MoveOutSettlementSnapshot } from '../moveOutSettlement'

type Props = {
  tenantName: string
  houseName: string
  contractNo: string
  rentMonthly: number
  leaseRange: string
  terminateDate: string
  reason: string
  settlement: MoveOutSettlementSnapshot
  completedAt?: string | null
  completedBy?: 'TENANT_CONFIRMED' | 'STORE_DIRECT'
  bank?: { accountName: string; bankName: string; bankCardNo: string; signedAt: string } | null
  showPrintButton?: boolean
}

function money(value: number) {
  return `¥${Number(value || 0).toFixed(2)}`
}

function maskBankCard(value: string) {
  if (value.length <= 8) return value
  return `${value.slice(0, 4)} **** **** ${value.slice(-4)}`
}

export function MoveOutApprovalSheet({
  tenantName,
  houseName,
  contractNo,
  rentMonthly,
  leaseRange,
  terminateDate,
  reason,
  settlement,
  completedAt,
  completedBy,
  bank,
  showPrintButton = true,
}: Props) {
  return (
    <div className="moveout-approval-wrap">
      {showPrintButton ? (
        <div className="moveout-print-actions no-print">
          <span>打印后报财务走退款流程；系统内保留本次结算快照。</span>
          <button type="button" className="a-btn secondary" onClick={() => window.print()}>打印审批表</button>
        </div>
      ) : null}
      <article className="moveout-approval-sheet">
        <header>
          <h2>租户退租结算审批表</h2>
          <div><span>租户：{tenantName}</span><span>单据生成日期：{new Date(completedAt ?? terminateDate).toLocaleDateString('zh-CN')}</span></div>
        </header>
        <table className="moveout-approval-meta"><tbody>
          <tr><th>房号</th><td>{houseName}</td><th>合同号</th><td>{contractNo}</td></tr>
          <tr><th>月租金</th><td>{money(rentMonthly)}</td><th>退租日期</th><td>{terminateDate}</td></tr>
          <tr><th>租赁期限</th><td>{leaseRange}</td><th>停止计租日期</th><td>{settlement.stopRentDate}</td></tr>
        </tbody></table>
        <div className="moveout-approval-ledgers">
          <table><thead><tr><th colSpan={3}>已交款项</th></tr><tr><th>项目</th><th>金额（元）</th><th>备注</th></tr></thead><tbody>
            {settlement.paidItems.map((item) => <tr key={item.id}><td>{item.name}</td><td>{money(item.amount)}</td><td>{item.remark || '—'}</td></tr>)}
            <tr className="total"><td>已交小计</td><td>{money(settlement.paidTotal)}</td><td /></tr>
          </tbody></table>
          <table><thead><tr><th colSpan={3}>应收款项</th></tr><tr><th>项目</th><th>金额（元）</th><th>备注</th></tr></thead><tbody>
            {settlement.receivableItems.map((item) => <tr key={item.id}><td>{item.name}</td><td>{money(item.amount)}</td><td>{item.remark || '—'}</td></tr>)}
            <tr className="total"><td>应收小计</td><td>{money(settlement.receivableTotal)}</td><td /></tr>
          </tbody></table>
        </div>
        <div className={`moveout-approval-result ${settlement.amountDue > 0 ? 'due' : ''}`}>
          {settlement.amountDue > 0 ? <>租户应补金额：<strong>{money(settlement.amountDue)}</strong></> : <>应退金额：<strong>{money(settlement.refundAmount)}</strong></>}
          <small>已交小计 − 应收小计</small>
        </div>
        <section className="moveout-approval-notes">
          <h3>备注及申请事项</h3>
          <p>退租类型：{settlementTypeLabel(settlement.settlementType)}；原因：{reason || '—'}</p>
          <p>卫生情况：{settlement.hygieneStatus === 'PASS' ? '无需保洁' : '需保洁'}</p>
          <p>损坏赔偿：{settlement.inspectionItems.filter((item) => item.compensation > 0).map((item) => `${item.name} ${money(item.compensation)}`).join('；') || '无'}</p>
          <p>{settlement.applicationNote}</p>
        </section>
        <footer className="moveout-approval-signatures">
          <div><span>店长/经办人</span><b>{completedBy === 'STORE_DIRECT' ? '已确认（无需租户确认）' : '已发起'}</b></div>
          <div><span>租户确认</span><b>{completedBy === 'TENANT_CONFIRMED' ? `已签字 ${completedAt ? new Date(completedAt).toLocaleString('zh-CN') : ''}` : settlement.requireTenantConfirmation ? '待签字' : '无需确认'}</b></div>
          <div><span>退款账户</span><b>{bank ? `${bank.accountName} · ${bank.bankName} · ${maskBankCard(bank.bankCardNo)}` : '待租户提交'}</b></div>
        </footer>
      </article>
    </div>
  )
}
