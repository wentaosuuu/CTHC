import {
  TENANT_EARLY_REASON_LABEL,
  applicationCaseShortLabel,
  formatCnDate,
  type MoveOutApplicationSnapshot,
} from '../moveOutApplication'

const IMPORTANT_TIPS = [
  '本申请仅为启动退租办理的依据，最终退租交房日、停止计租日以双方完成房屋实物查验、交接手续之日为准；房屋、附属设施设备及配套物品的查验与损坏责任认定，以原租赁合同及《附件五：房屋、设备、设施交接清单及损坏赔偿价格表》为准。',
  '履约保证金、押金及各项费用的核算与退还，以最终交接结算结果及原租赁合同约定为准。',
  '本申请书经线上电子签名后，与纸质签字文件具备同等法律效力。',
]

type Props = {
  application: MoveOutApplicationSnapshot
}

/** 租户端：仅展示店长已勾选的情形（情况三内部备注不展示） */
export function MoveOutApplicationView({ application }: Props) {
  const a = application
  const reasonLabel =
    a.tenantEarlyReason === 'OTHER'
      ? `其他特殊原因：${a.tenantEarlyReasonOther?.trim() || '__________'}`
      : a.tenantEarlyReason
        ? TENANT_EARLY_REASON_LABEL[a.tenantEarlyReason]
        : '__________'

  return (
    <div className="mo-app-view">
      <div className="mo-app-view-title">退租申请书</div>
      <p>南宁产投华创投资发展集团有限责任公司：</p>
      <p>
        本人【{a.tenantName}】，身份证号码：【{a.tenantIdNumber || '—'}】，与贵司签订的《南宁市房屋租赁合同》（合同编号：【{a.contractNo}】），房屋坐落：【{a.propertyAddress}】，租赁期限自【{formatCnDate(a.leaseStartDate)}】至【{formatCnDate(a.leaseEndDate)}】。现就退租事宜申请如下：
      </p>

      <div className="mo-app-view-case">
        <div className="mo-app-view-case-title">☑ {applicationCaseShortLabel(a.caseType)}</div>
        {a.caseType === 'CASE_1_NORMAL_EXPIRY' ? (
          <p>
            因上述房屋租赁期限即将届满，本人不续租，现提交退租申请。本人承诺于合同到期日前清空房屋内全部私人物品，遗留物品视为本人主动放弃所有权，贵司可自行处置。后续本人将配合贵司完成房屋、附属设施设备、配套物品查验与移交及费用核对结算相关流程，望贵司受理审核。
          </p>
        ) : null}
        {a.caseType === 'CASE_2_NEGOTIATED_TENANT' ? (
          <p>
            因【{reasonLabel}】，本人申请于【{formatCnDate(a.earlyTerminateDate)}】提前办理退租交房，恳请贵司审核同意。本人承诺于所申请退租日前清空房屋内全部私人物品，遗留物品视为本人主动放弃所有权，贵司可自行处置；并配合完成房屋、附属设施设备、配套物品查验与移交及费用核对结算相关流程。
          </p>
        ) : null}
        {a.caseType === 'CASE_3_NEGOTIATED_LANDLORD' ? (
          <p>
            经双方协商一致，本人申请于【{formatCnDate(a.earlyTerminateDate)}】提前办理退租交房。本人承诺于所申请退租日前清空房屋内全部私人物品，遗留物品视为本人主动放弃所有权，贵司可自行处置；并配合完成房屋、附属设施设备、配套物品查验与移交及费用核对结算相关流程，望贵司受理审核。
          </p>
        ) : null}
        {a.caseType === 'CASE_4_SETTLED_EARLY' ? (
          <p>
            本人确认租赁期间全部应付费用已结清，或可通过已缴纳的保证金、押金足额覆盖至合同到期日【{formatCnDate(a.coveredUntilDate)}】，现申请于【{formatCnDate(a.earlyTerminateDate)}】提前办理退租交房。本人承诺在所申请退租日前清空房屋内全部私人物品，遗留物品视为本人主动放弃所有权，贵司可自行处置。后续本人将配合贵司完成房屋、附属设施设备、配套物品查验与移交及费用核对结算相关流程，望贵司受理审核。
          </p>
        ) : null}
      </div>

      <div className="mo-app-view-tips">
        <p>本人已仔细阅读并完全知悉以下全部重要提示内容，无任何异议：</p>
        <ol>
          {IMPORTANT_TIPS.map((tip, i) => (
            <li key={i}>{tip}</li>
          ))}
        </ol>
      </div>
    </div>
  )
}
