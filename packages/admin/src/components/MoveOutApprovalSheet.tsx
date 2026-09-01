import { settlementTypeLabel, type MoveOutBankAccount, type MoveOutSettlementSnapshot } from '../moveOutSettlement'

type Props = {
  tenantName: string
  /** 铺号 / 房号展示 */
  unitLabel: string
  contractNo: string
  rentMonthly: number
  areaSqm?: number | null
  /** 计租日期（合同起租日） */
  rentStartDate: string
  terminateDate: string
  reason: string
  settlement: MoveOutSettlementSnapshot
  completedAt?: string | null
  completedBy?: 'TENANT_CONFIRMED' | 'STORE_DIRECT'
  bank?: MoveOutBankAccount | null
  showPrintButton?: boolean
  /** 是否展示内部审批签字栏（店长打印用；租户端不展示） */
  showInternalApprovals?: boolean
}

function money(value: number) {
  return Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function maskBankCard(value: string) {
  if (!value) return '—'
  if (value.length <= 8) return value
  return `${value.slice(0, 4)} **** **** ${value.slice(-4)}`
}

const INTERNAL_APPROVAL_ROLES = [
  '华创经办人',
  '华创部门领导审核',
  '华创副总经理审核',
  '华创总经理审批',
  '华创董事长审批',
  '集团资产运营管理部审核',
] as const

export function MoveOutApprovalSheet({
  tenantName,
  unitLabel,
  contractNo,
  rentMonthly,
  areaSqm,
  rentStartDate,
  terminateDate,
  reason,
  settlement,
  completedAt,
  completedBy,
  bank,
  showPrintButton = true,
  showInternalApprovals = true,
}: Props) {
  const sheetDate = new Date(completedAt ?? terminateDate).toLocaleDateString('zh-CN')

  return (
    <div className="moveout-approval-wrap">
      {showPrintButton ? (
        <div className="moveout-print-actions no-print">
          <span>打印材料后报财务走退款流程（非本系统动作）；系统内保留本次结算快照。</span>
          <button type="button" className="a-btn secondary" onClick={() => window.print()}>
            打印审批表
          </button>
        </div>
      ) : null}
      <article className="moveout-approval-sheet">
        <header>
          <h2>租户退租结算审批表</h2>
          <div>
            <span>租户：{tenantName}</span>
            <span>日期：{sheetDate}</span>
          </div>
        </header>

        <table className="moveout-approval-meta">
          <tbody>
            <tr>
              <th>铺号</th>
              <td colSpan={3}>{unitLabel}</td>
            </tr>
            <tr>
              <th>合同号</th>
              <td>{contractNo}</td>
              <th>月租金</th>
              <td>{money(rentMonthly)} 元</td>
            </tr>
            <tr>
              <th>面积</th>
              <td>{areaSqm != null && Number.isFinite(areaSqm) ? `${areaSqm} ㎡` : '—'}</td>
              <th>计租日期</th>
              <td>{rentStartDate}</td>
            </tr>
            <tr>
              <th>退租日期</th>
              <td>{terminateDate}</td>
              <th>停止计租</th>
              <td>{settlement.stopRentDate}</td>
            </tr>
          </tbody>
        </table>

        <div className="moveout-approval-ledgers">
          <table>
            <thead>
              <tr>
                <th colSpan={3}>已交款项</th>
              </tr>
              <tr>
                <th>项目</th>
                <th>金额（元）</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {settlement.paidItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{money(item.amount)}</td>
                  <td>{item.remark || '—'}</td>
                </tr>
              ))}
              <tr className="total">
                <td>小计</td>
                <td>{money(settlement.paidTotal)}</td>
                <td />
              </tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th colSpan={3}>应收款项</th>
              </tr>
              <tr>
                <th>项目</th>
                <th>金额（元）</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {settlement.receivableItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{money(item.amount)}</td>
                  <td>{item.remark || '—'}</td>
                </tr>
              ))}
              <tr className="total">
                <td>小计</td>
                <td>{money(settlement.receivableTotal)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        <table className="moveout-approval-totals">
          <tbody>
            <tr>
              <th>应交金额</th>
              <td>{money(settlement.amountDue)} 元</td>
              <th>应退金额</th>
              <td>{money(settlement.refundAmount)} 元</td>
            </tr>
          </tbody>
        </table>

        <section className="moveout-approval-notes">
          <h3>备注</h3>
          <p>退租类型：{settlementTypeLabel(settlement.settlementType)}；原因：{reason || '—'}</p>
          {settlement.hygieneStatus === 'FAIL' ? <p>卫生情况：需保洁</p> : null}
          {settlement.inspectionItems.some((item) => item.compensation > 0) ? (
            <p>
              损坏赔偿：
              {settlement.inspectionItems
                .filter((item) => item.compensation > 0)
                .map((item) => `${item.name} ${money(item.compensation)} 元`)
                .join('；')}
            </p>
          ) : null}
          <p>{settlement.applicationNote || '—'}</p>
        </section>

        {showInternalApprovals ? (
          <footer className="moveout-approval-sign-grid" aria-label="内部审批栏">
            {INTERNAL_APPROVAL_ROLES.map((role) => (
              <div key={role}>
                <span>{role}</span>
                <b />
              </div>
            ))}
          </footer>
        ) : null}

        <footer className="moveout-approval-tenant-row">
          <div>
            <span>租户确认</span>
            <b>
              {completedBy === 'TENANT_CONFIRMED'
                ? `已确认 ${completedAt ? new Date(completedAt).toLocaleString('zh-CN') : ''}`
                : completedBy === 'STORE_DIRECT'
                  ? settlement.requireTenantConfirmation
                    ? '店长手动办结（未等租户确认）'
                    : '无需租户确认'
                  : settlement.requireTenantConfirmation
                    ? '待租户确认'
                    : '无需确认'}
            </b>
          </div>
          <div>
            <span>退款账户（费报）</span>
            <b>
              {bank
                ? [
                    bank.accountName,
                    bank.bankName,
                    bank.bankBranch,
                    maskBankCard(bank.bankCardNo),
                    bank.cnapsCode ? `联行号 ${bank.cnapsCode}` : null,
                    bank.bankRegion || null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : '待租户提交'}
            </b>
          </div>
        </footer>
      </article>
    </div>
  )
}
