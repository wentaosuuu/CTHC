import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  apiGet,
  apiPost,
  downloadContractAttachmentWithPhone,
  downloadMoveOutFileWithPhone,
  getTenantPhone,
  previewContractAttachmentWithPhone,
  previewMoveOutFileWithPhone,
  setTenantPhone,
} from '../api'

const CONTRACT_STATUS_ZH: Record<string, string> = {
  WAIT_INTERNAL_OA: '内部审批中',
  WAIT_TENANT_SIGN: '待租客签字',
  WAIT_STAMP: '待盖章',
  PENDING_PAYMENT: '待支付',
  ACTIVE: '已生效',
  WAIT_TENANT_MOVEOUT_SIGN: '待确认退租',
  VOID: '已作废',
  TERMINATED: '已终止',
}

function formatSignCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(totalSeconds / 86400)
  const h = Math.floor((totalSeconds % 86400) / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (d > 0) return `${d}天${h}小时`
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

type MoveOutMoneyItem = { id: string; name: string; amount: number; remark: string }
type MoveOutSettlement = {
  settlementType: string
  stopRentDate: string
  requireTenantConfirmation: boolean
  hygieneStatus: 'PASS' | 'FAIL'
  inspectionItems: Array<{ id: string; name: string; unit: string; quantity: number; moveInStatus: string; moveOutStatus: string; compensationQuantity: number; referencePrice: number; compensation: number; remark: string }>
  paidItems: MoveOutMoneyItem[]
  receivableItems: MoveOutMoneyItem[]
  paidTotal: number
  receivableTotal: number
  refundAmount: number
  amountDue: number
  applicationNote: string
}

type Contract = {
  id: string
  contractNo: string
  status: string
  apartmentName: string
  storeName: string
  houseNo: string
  tenant: { name: string; phone: string }
  rentMonthly: number
  deposit: number
  startDate: string
  endDate: string
  agreementSignDate?: string | null
  confirmedAt: string | null
  signedAt: string | null
  stampedAt: string | null
  tenantSignDeadlineAt: string | null
  renewedFromId?: string | null
  modificationRequestedAt: string | null
  payment: { id: string; amount: number; status: string; paidAt: string | null } | null
  bills: { id: string; period: string; dueDate: string; totalAmount: number; status: string; paidAt: string | null }[]
  housingReport: {
    status: string
    bureauRecordNo?: string | null
    receiptPdfPath: string | null
    reportedAt: string | null
    lastError: string | null
  } | null
  attachments: { id: string; name: string; file: string }[]
  moveOutSignDeadlineAt?: string | null
  moveOutPending?: {
    deadlineAt: string
    reasonFull: string
    terminateDate: string
    partial: boolean
    settlement: MoveOutSettlement | null
    attachments: { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }[]
  } | null
}

export function ContractPage() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const [data, setData] = useState<Contract | null>(null)
  const [error, setError] = useState('')
  const [actionMsg, setActionMsg] = useState('')
  const [tenantMoveOutStep, setTenantMoveOutStep] = useState<1 | 2>(1)
  const [refundAccountName, setRefundAccountName] = useState('')
  const [refundBankName, setRefundBankName] = useState('')
  const [refundBankBranch, setRefundBankBranch] = useState('')
  const [refundBankCardNo, setRefundBankCardNo] = useState('')
  const [refundCnapsCode, setRefundCnapsCode] = useState('')
  const [refundBankRegion, setRefundBankRegion] = useState('')
  const [refundPhone, setRefundPhone] = useState('')
  const [refundIdNumber, setRefundIdNumber] = useState('')
  const [moveOutAcknowledged, setMoveOutAcknowledged] = useState(false)

  const phoneFromUrl = sp.get('phone') || ''
  useEffect(() => {
    if (phoneFromUrl) setTenantPhone(phoneFromUrl)
  }, [phoneFromUrl])

  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const signDeadlineMs = useMemo(() => {
    if (!data?.tenantSignDeadlineAt) return null
    const t = new Date(data.tenantSignDeadlineAt).getTime()
    return Number.isNaN(t) ? null : t
  }, [data?.tenantSignDeadlineAt])

  const signRemainingMs =
    data?.status === 'WAIT_TENANT_SIGN' && signDeadlineMs != null ? signDeadlineMs - nowTick : null

  const signExpired = signRemainingMs != null && signRemainingMs <= 0

  const moveOutDeadlineMs = useMemo(() => {
    if (!data?.moveOutSignDeadlineAt) return null
    const t = new Date(data.moveOutSignDeadlineAt).getTime()
    return Number.isNaN(t) ? null : t
  }, [data?.moveOutSignDeadlineAt])

  const moveOutRemainingMs =
    data?.status === 'WAIT_TENANT_MOVEOUT_SIGN' && moveOutDeadlineMs != null ? moveOutDeadlineMs - nowTick : null
  const moveOutExpired = moveOutRemainingMs != null && moveOutRemainingMs <= 0

  const phone = getTenantPhone()
  const headers = useMemo(() => ({ 'x-tenant-phone': phone }), [phone])

  async function load() {
    if (!id) return
    setError('')
    const r = await apiGet<Contract>(`/api/contracts/${id}`, { headers })
    if (!r.ok) return setError(r.error)
    setData(r.data)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, phone])

  async function confirm() {
    if (!id) return
    setActionMsg('')
    const r = await apiPost<{ ok: true }>('/api/contracts/' + id + '/confirm', {}, { headers })
    if (!r.ok) return setActionMsg('确认失败：' + r.error)
    setActionMsg('已确认合同，请下拉刷新本页；进入「待付款」后即可支付首期款。')
    await load()
  }

  async function requestModification() {
    if (!id) return
    setActionMsg('')
    const r = await apiPost<{ ok: true; message?: string }>('/api/contracts/' + id + '/request-modification', {}, { headers })
    if (!r.ok) return setActionMsg('申请失败：' + r.error)
    setActionMsg(r.data.message ?? '已提交修改申请，请等待管理员处理')
    await load()
  }

  async function confirmMoveOut() {
    if (!id) return
    setActionMsg('')
    if (!refundAccountName.trim() || !refundBankName.trim() || !refundBankBranch.trim()) {
      return setActionMsg('请填写收款人姓名、开户银行和开户支行。')
    }
    if (!/^\d{12,24}$/.test(refundBankCardNo.trim())) {
      return setActionMsg('请填写 12–24 位银行卡号。')
    }
    if (!moveOutAcknowledged) return setActionMsg('请勾选确认结算内容及退款账户信息无误。')
    const r = await apiPost<{ ok: true }>('/api/contracts/' + id + '/confirm-move-out', {
      accountName: refundAccountName.trim(),
      bankName: refundBankName.trim(),
      bankBranch: refundBankBranch.trim(),
      bankCardNo: refundBankCardNo.trim(),
      cnapsCode: refundCnapsCode.trim() || undefined,
      bankRegion: refundBankRegion.trim() || undefined,
      phone: refundPhone.trim() || undefined,
      idNumber: refundIdNumber.trim() || undefined,
      acknowledged: true,
    }, { headers })
    if (!r.ok) return setActionMsg('确认失败：' + r.error)
    setActionMsg('已确认退租，请下拉刷新本页查看合同状态。')
    await load()
  }

  if (!id) return <div className="m-card m-error">缺少合同ID</div>

  return (
    <div className="m-col">
      <div className="m-card">
        <div className="m-h1">合同详情</div>
        <div className="m-muted">需要在页面底部填对“租客手机号”，否则会提示无权限（MVP 权限校验）。</div>
      </div>

      {error ? <div className="m-card m-error">加载失败：{error}</div> : null}
      {!error && !data ? <div className="m-card">加载中…</div> : null}

      {data ? (
        <>
          <div className="m-card">
            <div style={{ fontWeight: 900 }}>
              {data.apartmentName} · {data.houseNo}
            </div>
            <div className="m-muted">{data.storeName}</div>
            <div style={{ height: 10 }} />
            <div className="m-kv">
              <div className="m-k">合同号</div>
              <div>{data.contractNo}</div>
              <div className="m-k">状态</div>
              <div>{CONTRACT_STATUS_ZH[data.status] ?? data.status}</div>
              <div className="m-k">租客</div>
              <div>
                {data.tenant.name}（{data.tenant.phone}）
              </div>
              <div className="m-k">起止</div>
              <div>
                {data.startDate} ~ {data.endDate}
              </div>
              <div className="m-k">签订日期</div>
              <div>{data.agreementSignDate ?? '—'}</div>
              <div className="m-k">月租/押金</div>
              <div>
                ¥{data.rentMonthly} / ¥{data.deposit}
              </div>
              <div className="m-k">确认/签字截止</div>
              <div>
                {data.tenantSignDeadlineAt
                  ? `${new Date(data.tenantSignDeadlineAt).toLocaleString('zh-CN')}${
                      data.status === 'WAIT_TENANT_SIGN' && signRemainingMs != null && !signExpired
                        ? `（剩余 ${formatSignCountdown(signRemainingMs)}）`
                        : ''
                    }`
                  : '-'}
              </div>
              <div className="m-k">确认时间</div>
              <div>{data.confirmedAt ?? '-'}</div>
              <div className="m-k">签字时间</div>
              <div>{data.signedAt ?? '-'}</div>
            </div>
          </div>

          <div className="m-card">
            <div style={{ fontWeight: 900 }}>首期款与时限</div>
            <div className="m-muted">
              {data.status === 'PENDING_PAYMENT'
                ? data.renewedFromId
                  ? '续签已进入待付款：须在起租首日起 24 小时内完成首期款（与盖章后 24 小时取较早截止），逾期合同将失效。'
                  : '已进入待付款：请在 24 小时内完成首期款支付，逾期合同将失效。'
                : data.status === 'WAIT_STAMP'
                  ? '合同已确认，系统处理完成后将自动进入待付款；请下拉刷新本页查看最新状态。'
                  : data.status === 'WAIT_INTERNAL_OA'
                  ? '合同已配置，正在等待内部审批（华创 OA）。通过后将可确认与签字。'
                  : data.status === 'WAIT_TENANT_SIGN'
                    ? data.renewedFromId
                      ? '续签：请在起租首日起 24 小时内完成「确认合同信息」与电子签字；须在同一截止时点前完成首期款支付，超时订单失效、房源将重新开放。'
                      : '请在推送后 3 天内完成「确认合同信息」（含电子签字），超时订单失效、房源将重新开放。'
                    : data.status === 'ACTIVE'
                      ? '合同已生效，无需付款。'
                      : data.status === 'WAIT_TENANT_MOVEOUT_SIGN'
                        ? '门店已发起退租确认：请核对《退租结算审批表》并提交退款银行卡（无需签字）；超时未确认将自动撤销申请。'
                        : data.status === 'VOID' || data.status === 'TERMINATED'
                          ? '合同已失效。'
                          : '请先完成合同确认与签字，通过后将进入待付款与首期款时限。'}
            </div>
            <div style={{ height: 10 }} />
            <div className="m-row">
              {data.status === 'PENDING_PAYMENT' ? (
                <>
                  <Link className="m-btn" to={`/pay/${data.id}`}>
                    立即支付
                  </Link>
                  <Link className="m-btn ghost" to={`/remind-pay/${data.id}`}>
                    首期款倒计时
                  </Link>
                </>
              ) : null}
              {data.status === 'WAIT_STAMP' || data.status === 'WAIT_TENANT_SIGN' || data.status === 'WAIT_TENANT_MOVEOUT_SIGN' ? (
                <button type="button" className="m-btn secondary" onClick={() => void load()}>
                  刷新状态
                </button>
              ) : null}
            </div>
          </div>

          {data.status === 'WAIT_TENANT_MOVEOUT_SIGN' && data.moveOutPending && !moveOutExpired ? (
            <div className="m-card">
              <div style={{ fontWeight: 900 }}>退租确认</div>
              <div className="m-muted" style={{ marginTop: 8 }}>
                请确认门店填写的《退租结算审批表》；确认后提交退押金银行卡信息（无需签字）。
              </div>
              {moveOutRemainingMs != null ? (
                <>
                  <div style={{ fontWeight: 900, marginTop: 14 }}>确认倒计时（7 天）</div>
                  <div style={{ fontSize: 28, fontWeight: 900, marginTop: 10, color: '#b45309' }}>
                    {formatSignCountdown(moveOutRemainingMs)}
                  </div>
                  <div className="m-muted" style={{ marginTop: 6 }}>
                    请在截止前完成确认；超时将自动撤销退租申请。
                  </div>
                </>
              ) : (
                <div className="m-muted" style={{ marginTop: 10 }}>正在获取截止时间…</div>
              )}
              <div className="m-muted" style={{ marginTop: 12, fontSize: 13 }}>
                拟定退租日：<strong>{data.moveOutPending.terminateDate}</strong>
                {data.moveOutPending.partial ? '（部分退租）' : ''}
              </div>
              <div style={{ marginTop: 8, fontSize: 14 }}>{data.moveOutPending.reasonFull}</div>
              <div className="tenant-moveout-steps">
                <span className={tenantMoveOutStep === 1 ? 'active' : tenantMoveOutStep > 1 ? 'done' : ''}>
                  1 确认审批表
                </span>
                <span className={tenantMoveOutStep === 2 ? 'active' : ''}>2 提交银行卡</span>
              </div>

              {tenantMoveOutStep === 1 ? (
                <section className="tenant-moveout-section">
                  <h3>确认《退租结算审批表》</h3>
                  <p className="m-muted" style={{ marginBottom: 10 }}>本步只需核对内容，无需签字。</p>
                  {data.moveOutPending.settlement ? (
                    <>
                      <div className="tenant-settlement-grid">
                        <div>
                          <h4>已交款项</h4>
                          {data.moveOutPending.settlement.paidItems.map((item) => (
                            <p key={item.id}>
                              <span>{item.name}</span>
                              <b>¥{item.amount.toFixed(2)}</b>
                            </p>
                          ))}
                          <p className="total">
                            <span>小计</span>
                            <b>¥{data.moveOutPending.settlement.paidTotal.toFixed(2)}</b>
                          </p>
                        </div>
                        <div>
                          <h4>应收款项</h4>
                          {data.moveOutPending.settlement.receivableItems.map((item) => (
                            <p key={item.id}>
                              <span>{item.name}</span>
                              <b>¥{item.amount.toFixed(2)}</b>
                            </p>
                          ))}
                          <p className="total">
                            <span>小计</span>
                            <b>¥{data.moveOutPending.settlement.receivableTotal.toFixed(2)}</b>
                          </p>
                        </div>
                      </div>
                      <div className={`tenant-settlement-result ${data.moveOutPending.settlement.amountDue > 0 ? 'due' : ''}`}>
                        <span>{data.moveOutPending.settlement.amountDue > 0 ? '应交金额' : '应退金额'}</span>
                        <strong>
                          ¥{(data.moveOutPending.settlement.amountDue || data.moveOutPending.settlement.refundAmount).toFixed(2)}
                        </strong>
                      </div>
                      <p className="m-muted">{data.moveOutPending.settlement.applicationNote}</p>
                      {data.moveOutPending.settlement.inspectionItems.length > 0 ? (
                        <div style={{ marginTop: 12 }}>
                          <h4>交接与赔偿（如有）</h4>
                          <div className="tenant-moveout-list">
                            {data.moveOutPending.settlement.inspectionItems.map((item) => (
                              <div key={item.id}>
                                <div>
                                  <strong>{item.name}</strong>
                                  <small>
                                    {item.quantity}
                                    {item.unit} · 入住：{item.moveInStatus} · 退租：{item.moveOutStatus}
                                  </small>
                                  {item.remark ? <small>{item.remark}</small> : null}
                                </div>
                                <b className={item.compensation > 0 ? 'money' : ''}>
                                  {item.compensation > 0 ? `赔偿 ¥${item.compensation.toFixed(2)}` : '无赔偿'}
                                </b>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="m-muted">请核对退租说明及附件。</div>
                  )}
                  {data.moveOutPending.attachments.length > 0 ? (
                    <div className="m-col tenant-moveout-files">
                      {data.moveOutPending.attachments.map((a) => (
                        <div key={a.id} className="m-row">
                          <span>{a.name}</span>
                          <button
                            type="button"
                            className="m-btn ghost"
                            onClick={async () => {
                              const r = await previewMoveOutFileWithPhone(data.id, a.file, phone)
                              if (!r.ok) setActionMsg(`预览失败：${r.error}`)
                            }}
                          >
                            预览
                          </button>
                          <button
                            type="button"
                            className="m-btn ghost"
                            onClick={async () => {
                              const r = await downloadMoveOutFileWithPhone(data.id, a.file, a.name, phone)
                              if (!r.ok) setActionMsg(`下载失败：${r.error}`)
                            }}
                          >
                            下载
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <button type="button" className="m-btn tenant-moveout-next" onClick={() => setTenantMoveOutStep(2)}>
                    审批表无误，下一步
                  </button>
                </section>
              ) : null}

              {tenantMoveOutStep === 2 ? (
                <section className="tenant-moveout-section">
                  <h3>提交押金退款银行卡</h3>
                  <p className="m-muted" style={{ marginBottom: 10 }}>字段参考集团费报系统，便于门店报财务退款。</p>
                  <label className="tenant-bank-field">
                    <span>收款人姓名 *</span>
                    <input value={refundAccountName} onChange={(e) => setRefundAccountName(e.target.value)} placeholder={data.tenant.name} />
                  </label>
                  <label className="tenant-bank-field">
                    <span>开户银行 *</span>
                    <input value={refundBankName} onChange={(e) => setRefundBankName(e.target.value)} placeholder="例如：中国建设银行" />
                  </label>
                  <label className="tenant-bank-field">
                    <span>开户支行 *</span>
                    <input value={refundBankBranch} onChange={(e) => setRefundBankBranch(e.target.value)} placeholder="例如：南宁东葛支行" />
                  </label>
                  <label className="tenant-bank-field">
                    <span>银行卡号 *</span>
                    <input
                      inputMode="numeric"
                      value={refundBankCardNo}
                      onChange={(e) => setRefundBankCardNo(e.target.value.replace(/\D/g, '').slice(0, 24))}
                      placeholder="请输入 12–24 位银行卡号"
                    />
                  </label>
                  <label className="tenant-bank-field">
                    <span>联行号</span>
                    <input value={refundCnapsCode} onChange={(e) => setRefundCnapsCode(e.target.value)} placeholder="选填" />
                  </label>
                  <label className="tenant-bank-field">
                    <span>开户省市</span>
                    <input value={refundBankRegion} onChange={(e) => setRefundBankRegion(e.target.value)} placeholder="例如：广西南宁" />
                  </label>
                  <label className="tenant-bank-field">
                    <span>联系电话</span>
                    <input value={refundPhone} onChange={(e) => setRefundPhone(e.target.value)} placeholder={data.tenant.phone} />
                  </label>
                  <label className="tenant-bank-field">
                    <span>证件号码</span>
                    <input value={refundIdNumber} onChange={(e) => setRefundIdNumber(e.target.value)} placeholder="选填，与费报收款人一致" />
                  </label>
                  <label className="tenant-bank-ack">
                    <input type="checkbox" checked={moveOutAcknowledged} onChange={(e) => setMoveOutAcknowledged(e.target.checked)} />
                    <span>我已核对《退租结算审批表》与退款账户信息，确认无误（无需签字）。</span>
                  </label>
                  <div className="m-row">
                    <button type="button" className="m-btn secondary" onClick={() => setTenantMoveOutStep(1)}>上一步</button>
                    <button type="button" className="m-btn" onClick={() => void confirmMoveOut()}>提交并确认退租</button>
                  </div>
                  <p className="m-muted">提交后由门店打印材料并报财务办理退款（非本系统动作）。</p>
                </section>
              ) : null}
              {actionMsg ? <div className="m-muted" style={{ marginTop: 8 }}>{actionMsg}</div> : null}
            </div>
          ) : null}

          {data.status === 'WAIT_TENANT_MOVEOUT_SIGN' && moveOutExpired ? (
            <div className="m-card">
              <div style={{ fontWeight: 900 }}>退租确认已超时</div>
              <div className="m-muted" style={{ marginTop: 8 }}>
                未在 7 日内完成确认，退租申请已自动撤销；请下拉刷新或联系门店如需再次办理退租。
              </div>
              <div className="m-row" style={{ marginTop: 12 }}>
                <button type="button" className="m-btn secondary" onClick={() => void load()}>刷新</button>
              </div>
            </div>
          ) : null}

          {data.status !== 'VOID' && data.status !== 'TERMINATED' && data.status !== 'WAIT_TENANT_MOVEOUT_SIGN' ? (
            <div className="m-card">
              <div style={{ fontWeight: 900 }}>修改合同申请</div>
              <div className="m-muted">如需变更租期、月租等，可提交申请，由管理员在后台处理。</div>
              <div style={{ height: 10 }} />
              {data.modificationRequestedAt ? (
                <div className="m-muted">
                  已申请修改，等待管理员处理（申请时间：{new Date(data.modificationRequestedAt).toLocaleString()}）
                </div>
              ) : (
                <button className="m-btn ghost" type="button" onClick={requestModification}>
                  申请修改合同信息
                </button>
              )}
            </div>
          ) : null}

          <div className="m-card">
            <div style={{ fontWeight: 900 }}>账单</div>
            <div className="m-muted">MVP：按租期自动生成每月租金账单。</div>
            <div style={{ height: 10 }} />
            <div className="m-col" style={{ gap: 8 }}>
              {data.bills.slice(0, 6).map((b) => (
                <div key={b.id} className="m-row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{b.period}</div>
                    <div className="m-muted">到期 {b.dueDate}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 900 }}>¥{b.totalAmount}</div>
                    <div className="m-muted">{b.status}</div>
                  </div>
                </div>
              ))}
              {data.bills.length > 6 ? <div className="m-muted">（仅展示前 6 期）</div> : null}
            </div>
          </div>

          <div className="m-card">
            <div style={{ fontWeight: 900 }}>住建局报备</div>
            <div className="m-muted">备案编号由住建局系统下发；报备成功时由系统生成。</div>
            <div style={{ height: 10 }} />
            <div className="m-kv">
              <div className="m-k">状态</div>
              <div>{data.housingReport?.status ?? '-'}</div>
              <div className="m-k">住建备案编号</div>
              <div style={{ wordBreak: 'break-all' }}>{data.housingReport?.bureauRecordNo ?? '-'}</div>
              <div className="m-k">回执路径</div>
              <div style={{ wordBreak: 'break-all' }}>{data.housingReport?.receiptPdfPath ?? '-'}</div>
            </div>
          </div>

          <div className="m-card">
            <div style={{ fontWeight: 900 }}>合同附件</div>
            <div className="m-muted">
              {data.status === 'PENDING_PAYMENT'
                ? '当前为待支付：预览为带水印稿；完成首笔缴费并生效后，可下载正式附件。'
                : '附件可在线预览或下载到本机查看。'}
            </div>
            <div style={{ height: 10 }} />
            {data.attachments && data.attachments.length > 0 ? (
              <div className="m-col" style={{ gap: 8 }}>
                {data.attachments.map((a) => (
                  <div key={a.file} className="m-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{a.name}</div>
                    <div className="m-row">
                      <button
                        type="button"
                        className="m-btn ghost"
                        onClick={async () => {
                          const r = await previewContractAttachmentWithPhone(data.id, a.file, phone)
                          if (!r.ok) setActionMsg(`附件预览失败：${r.error}`)
                        }}
                      >
                        预览
                      </button>
                      <button
                        type="button"
                        className="m-btn ghost"
                        disabled={data.status === 'PENDING_PAYMENT'}
                        title={
                          data.status === 'PENDING_PAYMENT' ? '完成首笔缴费后方可下载正式附件' : undefined
                        }
                        onClick={async () => {
                          const r = await downloadContractAttachmentWithPhone(data.id, a.file, a.name, phone)
                          if (!r.ok) setActionMsg(`附件下载失败：${r.error}`)
                        }}
                      >
                        下载
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="m-muted">暂无附件</div>
            )}
          </div>

          {data.status !== 'VOID' && data.status !== 'TERMINATED' && data.status !== 'WAIT_TENANT_MOVEOUT_SIGN' ? (
            <div className="m-card" style={{ marginTop: 4 }}>
              <div style={{ fontWeight: 900 }}>确认合同信息</div>
              <div className="m-muted" style={{ marginTop: 6 }}>
                请仔细阅读上方合同内容，确认租期、月租、押金等信息无误后，点击下方按钮确认。
              </div>
              <div style={{ marginTop: 12 }}>
                {data.confirmedAt ? (
                  <div className="m-muted" style={{ color: '#047857', fontWeight: 600 }}>
                    您已于 {new Date(data.confirmedAt).toLocaleString('zh-CN')} 确认合同信息
                  </div>
                ) : signExpired ? (
                  <div className="m-muted" style={{ color: '#b45309', fontWeight: 600 }}>
                    已超过确认与签字截止时间，订单将失效（请刷新页面查看最新状态）。
                  </div>
                ) : (
                  <button type="button" className="m-btn" onClick={confirm}>
                    确认合同信息（含签字）
                  </button>
                )}
              </div>
              {actionMsg ? <div className="m-muted" style={{ marginTop: 8 }}>{actionMsg}</div> : null}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="m-row">
        <Link className="m-btn ghost" to="/">
          返回房源
        </Link>
        <button className="m-btn secondary" onClick={load}>
          刷新
        </button>
      </div>
    </div>
  )
}
