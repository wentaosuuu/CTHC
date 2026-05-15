import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  apiGet,
  apiPost,
  downloadContractAttachmentWithPhone,
  getTenantPhone,
  previewContractAttachmentWithPhone,
  setTenantPhone,
} from '../api'

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
  confirmedAt: string | null
  stampedAt: string | null
  modificationRequestedAt: string | null
  payment: { id: string; amount: number; status: string; paidAt: string | null } | null
  bills: { id: string; period: string; dueDate: string; totalAmount: number; status: string; paidAt: string | null }[]
  housingReport: { status: string; receiptPdfPath: string | null; reportedAt: string | null; lastError: string | null } | null
  attachments: { id: string; name: string; file: string }[]
}

export function ContractPage() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const [data, setData] = useState<Contract | null>(null)
  const [error, setError] = useState('')
  const [actionMsg, setActionMsg] = useState('')

  const phoneFromUrl = sp.get('phone') || ''
  useEffect(() => {
    if (phoneFromUrl) setTenantPhone(phoneFromUrl)
  }, [phoneFromUrl])

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
    setActionMsg('已确认合同（等待电子章完成后进入付款倒计时）')
    await load()
    // 盖章/签章是异步完成的：跳转到“付款提醒页”，由该页轮询状态并展示倒计时
    nav(`/remind-pay/${id}`, { replace: true })
  }

  async function requestModification() {
    if (!id) return
    setActionMsg('')
    const r = await apiPost<{ ok: true; message?: string }>('/api/contracts/' + id + '/request-modification', {}, { headers })
    if (!r.ok) return setActionMsg('申请失败：' + r.error)
    setActionMsg(r.data.message ?? '已提交修改申请，请等待管理员处理')
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
              <div>{data.status}</div>
              <div className="m-k">租客</div>
              <div>
                {data.tenant.name}（{data.tenant.phone}）
              </div>
              <div className="m-k">起止</div>
              <div>
                {data.startDate} ~ {data.endDate}
              </div>
              <div className="m-k">月租/押金</div>
              <div>
                ¥{data.rentMonthly} / ¥{data.deposit}
              </div>
              <div className="m-k">确认时间</div>
              <div>{data.confirmedAt ?? '-'}</div>
            </div>
          </div>

          <div className="m-card">
            <div style={{ fontWeight: 900 }}>付款提醒</div>
            <div className="m-muted">
              {data.status === 'PENDING_PAYMENT'
                ? '已盖章：请在 24 小时内完成付款，逾期合同将失效。'
                : data.status === 'WAIT_STAMP'
                  ? '已确认合同，系统正在盖章中。盖章完成后将进入 24 小时待付款倒计时。'
                  : data.status === 'ACTIVE'
                    ? '合同已生效，无需付款。'
                    : data.status === 'VOID' || data.status === 'TERMINATED'
                      ? '合同已失效。'
                      : '请先完成合同确认/签字，系统随后盖章并开启付款倒计时。'}
            </div>
            <div style={{ height: 10 }} />
            <div className="m-row">
              <Link className="m-btn" to={`/remind-pay/${data.id}`}>
                付款提醒（倒计时）
              </Link>
              {data.status === 'PENDING_PAYMENT' ? (
                <Link className="m-btn ghost" to={`/pay/${data.id}`}>
                  立即支付
                </Link>
              ) : null}
            </div>
          </div>

          {data.status !== 'VOID' && data.status !== 'TERMINATED' ? (
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
            <div className="m-muted">MVP：合同生效后，后台定时/手动报备并生成“模拟回执文件路径”。</div>
            <div style={{ height: 10 }} />
            <div className="m-kv">
              <div className="m-k">状态</div>
              <div>{data.housingReport?.status ?? '-'}</div>
              <div className="m-k">回执路径</div>
              <div style={{ wordBreak: 'break-all' }}>{data.housingReport?.receiptPdfPath ?? '-'}</div>
            </div>
          </div>

          <div className="m-card">
            <div style={{ fontWeight: 900 }}>合同附件</div>
            <div className="m-muted">附件可在线预览或下载到本机查看。</div>
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

          {data.status !== 'VOID' && data.status !== 'TERMINATED' ? (
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
                ) : (
                  <button type="button" className="m-btn" onClick={confirm}>
                    确认合同信息
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

