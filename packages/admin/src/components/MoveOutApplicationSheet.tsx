import {
  MOVE_OUT_APPLICATION_CASE_OPTIONS,
  TENANT_EARLY_REASON_OPTIONS,
  formatCnDate,
  type MoveOutApplicationCase,
  type MoveOutApplicationSnapshot,
  type MoveOutTenantEarlyReason,
} from '../moveOutApplication'

type Props = {
  value: MoveOutApplicationSnapshot
  mode: 'configure' | 'preview'
  /** configure 模式下是否展示情况三店长备注（preview 租户视角应隐藏） */
  showLandlordInternalNote?: boolean
  onChange?: (next: MoveOutApplicationSnapshot) => void
}

const IMPORTANT_TIPS = [
  '本申请仅为启动退租办理的依据，最终退租交房日、停止计租日以双方完成房屋实物查验、交接手续之日为准；房屋、附属设施设备及配套物品的查验与损坏责任认定，以原租赁合同及《附件五：房屋、设备、设施交接清单及损坏赔偿价格表》为准。',
  '履约保证金、押金及各项费用的核算与退还，以最终交接结算结果及原租赁合同约定为准。',
  '本申请书经线上电子签名后，与纸质签字文件具备同等法律效力。',
]

function Check({ checked }: { checked: boolean }) {
  return <span className="mo-app-check" aria-hidden>{checked ? '☑' : '☐'}</span>
}

export function MoveOutApplicationSheet({
  value,
  mode,
  showLandlordInternalNote = true,
  onChange,
}: Props) {
  const editable = mode === 'configure' && onChange
  const patch = (partial: Partial<MoveOutApplicationSnapshot>) => {
    if (!onChange) return
    onChange({ ...value, ...partial })
  }
  const setCase = (caseType: MoveOutApplicationCase) => {
    if (!onChange) return
    onChange({
      ...value,
      caseType,
      tenantEarlyReason: caseType === 'CASE_2_NEGOTIATED_TENANT' ? value.tenantEarlyReason ?? 'JOB_RELOCATION' : null,
      tenantEarlyReasonOther: caseType === 'CASE_2_NEGOTIATED_TENANT' ? value.tenantEarlyReasonOther : '',
      landlordInternalReason: caseType === 'CASE_3_NEGOTIATED_LANDLORD' ? value.landlordInternalReason : '',
      coveredUntilDate:
        caseType === 'CASE_4_SETTLED_EARLY' ? value.coveredUntilDate || value.leaseEndDate : value.coveredUntilDate,
      earlyTerminateDate:
        caseType === 'CASE_1_NORMAL_EXPIRY' ? value.earlyTerminateDate : value.earlyTerminateDate || value.leaseEndDate,
    })
  }

  const reasonLabel =
    value.tenantEarlyReason === 'OTHER'
      ? `其他特殊原因：${value.tenantEarlyReasonOther?.trim() || '__________'}`
      : TENANT_EARLY_REASON_OPTIONS.find((o) => o.value === value.tenantEarlyReason)?.label ?? '__________'

  return (
    <div className={`mo-app-sheet ${mode === 'preview' ? 'is-preview' : 'is-configure'}`}>
      <div className="mo-app-sheet-title">退租申请书</div>
      <p className="mo-app-address">南宁产投华创投资发展集团有限责任公司：</p>
      <p className="mo-app-intro">
        本人【{value.tenantName || '租户姓名'}】，身份证号码：【{value.tenantIdNumber || '租户身份证号'}】，与贵司签订的《南宁市房屋租赁合同》（合同编号：【{value.contractNo || '_________'}】），房屋坐落：【{value.propertyAddress || '完整房屋地址'}】，租赁期限自【{formatCnDate(value.leaseStartDate)}】至【{formatCnDate(value.leaseEndDate)}】。现就退租事宜申请如下：
      </p>

      {editable ? (
        <div className="mo-app-case-picker">
          <div className="mo-app-case-picker-title">店长配置退租情形（租户端将显示为已勾选）</div>
          {MOVE_OUT_APPLICATION_CASE_OPTIONS.map((opt) => (
            <label key={opt.value} className={value.caseType === opt.value ? 'active' : ''}>
              <input
                type="radio"
                name="moAppCase"
                checked={value.caseType === opt.value}
                onChange={() => setCase(opt.value)}
              />
              <span>
                <strong>{opt.label}</strong>
                <small>{opt.hint}</small>
              </span>
            </label>
          ))}
        </div>
      ) : null}

      <section className={`mo-app-case ${value.caseType === 'CASE_1_NORMAL_EXPIRY' ? 'selected' : ''}`}>
        <h4><Check checked={value.caseType === 'CASE_1_NORMAL_EXPIRY'} /> 情况一（正常到期退租）</h4>
        {value.caseType === 'CASE_1_NORMAL_EXPIRY' || mode === 'configure' ? (
          <p>
            因上述房屋租赁期限即将届满，本人不续租，现提交退租申请。本人承诺于合同到期日前清空房屋内全部私人物品，遗留物品视为本人主动放弃所有权，贵司可自行处置。后续本人将配合贵司完成房屋、附属设施设备、配套物品查验与移交及费用核对结算相关流程，望贵司受理审核。
          </p>
        ) : null}
      </section>

      <section className={`mo-app-case ${value.caseType === 'CASE_2_NEGOTIATED_TENANT' ? 'selected' : ''}`}>
        <h4><Check checked={value.caseType === 'CASE_2_NEGOTIATED_TENANT'} /> 情况二（协商提前退租 · 承租方原因）</h4>
        {value.caseType === 'CASE_2_NEGOTIATED_TENANT' || mode === 'configure' ? (
          <>
            {editable && value.caseType === 'CASE_2_NEGOTIATED_TENANT' ? (
              <div className="mo-app-fields">
                <label>
                  <span>提前退租原因 *</span>
                  <select
                    value={value.tenantEarlyReason ?? 'JOB_RELOCATION'}
                    onChange={(e) => patch({ tenantEarlyReason: e.target.value as MoveOutTenantEarlyReason })}
                  >
                    {TENANT_EARLY_REASON_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
                {value.tenantEarlyReason === 'OTHER' ? (
                  <label>
                    <span>其他特殊原因 *</span>
                    <input
                      value={value.tenantEarlyReasonOther ?? ''}
                      onChange={(e) => patch({ tenantEarlyReasonOther: e.target.value })}
                      placeholder="请说明"
                    />
                  </label>
                ) : null}
                <label>
                  <span>申请提前退租交房日 *</span>
                  <input
                    type="date"
                    value={value.earlyTerminateDate ?? ''}
                    onChange={(e) => patch({ earlyTerminateDate: e.target.value })}
                  />
                </label>
              </div>
            ) : null}
            {value.caseType === 'CASE_2_NEGOTIATED_TENANT' ? (
              <p>
                因【{reasonLabel}】，本人申请于【{formatCnDate(value.earlyTerminateDate)}】提前办理退租交房，恳请贵司审核同意。本人承诺于所申请退租日前清空房屋内全部私人物品，遗留物品视为本人主动放弃所有权，贵司可自行处置；并配合完成房屋、附属设施设备、配套物品查验与移交及费用核对结算相关流程。如需，本人可补充提交相关佐证材料。
              </p>
            ) : mode === 'configure' ? (
              <p className="mo-app-muted">选择本情形后填写原因与交房日；租户端仅展示已勾选正文。</p>
            ) : null}
          </>
        ) : null}
      </section>

      <section className={`mo-app-case ${value.caseType === 'CASE_3_NEGOTIATED_LANDLORD' ? 'selected' : ''}`}>
        <h4><Check checked={value.caseType === 'CASE_3_NEGOTIATED_LANDLORD'} /> 情况三（协商提前退租 · 出租方原因）</h4>
        {value.caseType === 'CASE_3_NEGOTIATED_LANDLORD' || mode === 'configure' ? (
          <>
            {editable && value.caseType === 'CASE_3_NEGOTIATED_LANDLORD' ? (
              <div className="mo-app-fields">
                <label>
                  <span>申请提前退租交房日 *</span>
                  <input
                    type="date"
                    value={value.earlyTerminateDate ?? ''}
                    onChange={(e) => patch({ earlyTerminateDate: e.target.value })}
                  />
                </label>
                {showLandlordInternalNote ? (
                  <label>
                    <span>店长内部原因（租户签署页完全隐藏）*</span>
                    <input
                      value={value.landlordInternalReason ?? ''}
                      onChange={(e) => patch({ landlordInternalReason: e.target.value })}
                      placeholder="例如：房屋大修 / 资产调配"
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            {value.caseType === 'CASE_3_NEGOTIATED_LANDLORD' ? (
              <p>
                经双方协商一致，本人申请于【{formatCnDate(value.earlyTerminateDate)}】提前办理退租交房。本人承诺于所申请退租日前清空房屋内全部私人物品，遗留物品视为本人主动放弃所有权，贵司可自行处置；并配合完成房屋、附属设施设备、配套物品查验与移交及费用核对结算相关流程，望贵司受理审核。
              </p>
            ) : mode === 'configure' ? (
              <p className="mo-app-muted">选择本情形后填写交房日与内部原因。</p>
            ) : null}
            {showLandlordInternalNote && value.caseType === 'CASE_3_NEGOTIATED_LANDLORD' && mode === 'configure' ? (
              <p className="mo-app-internal-note">
                （备注：本次提前退租，系我司相关事由导致，具体原因为：
                <strong>{value.landlordInternalReason?.trim() || '__________'}</strong>
                ，本栏为店长填写，租户签署页面完全隐藏）
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <section className={`mo-app-case ${value.caseType === 'CASE_4_SETTLED_EARLY' ? 'selected' : ''}`}>
        <h4><Check checked={value.caseType === 'CASE_4_SETTLED_EARLY'} /> 情况四（结清提前退租）</h4>
        {value.caseType === 'CASE_4_SETTLED_EARLY' || mode === 'configure' ? (
          <>
            {editable && value.caseType === 'CASE_4_SETTLED_EARLY' ? (
              <div className="mo-app-fields">
                <label>
                  <span>费用覆盖至合同到期日 *</span>
                  <input
                    type="date"
                    value={value.coveredUntilDate ?? ''}
                    onChange={(e) => patch({ coveredUntilDate: e.target.value })}
                  />
                </label>
                <label>
                  <span>申请提前退租交房日 *</span>
                  <input
                    type="date"
                    value={value.earlyTerminateDate ?? ''}
                    onChange={(e) => patch({ earlyTerminateDate: e.target.value })}
                  />
                </label>
              </div>
            ) : null}
            {value.caseType === 'CASE_4_SETTLED_EARLY' ? (
              <p>
                本人确认租赁期间全部应付费用已结清，或可通过已缴纳的保证金、押金足额覆盖至合同到期日【{formatCnDate(value.coveredUntilDate)}】，现申请于【{formatCnDate(value.earlyTerminateDate)}】提前办理退租交房。本人承诺在所申请退租日前清空房屋内全部私人物品，遗留物品视为本人主动放弃所有权，贵司可自行处置。后续本人将配合贵司完成房屋、附属设施设备、配套物品查验与移交及费用核对结算相关流程，望贵司受理审核。
              </p>
            ) : mode === 'configure' ? (
              <p className="mo-app-muted">选择本情形后填写覆盖到期日与交房日。</p>
            ) : null}
          </>
        ) : null}
      </section>

      <div className="mo-app-tips">
        <p>本人已仔细阅读并完全知悉以下全部重要提示内容，无任何异议：</p>
        <ol>
          {IMPORTANT_TIPS.map((tip, i) => (
            <li key={i}>{tip}</li>
          ))}
        </ol>
      </div>

      {mode === 'preview' ? (
        <div className="mo-app-sign-placeholder">
          <div>申请人（电子签名）：____________</div>
          <div>联系电话：____________</div>
          <div>申请日期：____年__月__日</div>
        </div>
      ) : (
        <div className="mo-app-sign-placeholder muted">
          租户确认时将在此签署电子签名、填写联系电话与申请日期，并可上传佐证材料。
        </div>
      )}
    </div>
  )
}
