import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiGet, apiPost } from '../api'
import { DemoDialog } from '../components/DemoDialog'

type Application = {
  id: string; txNo: string; amount: number; house: { storeName: string }
  receipt: { reprintRequestStatus: string | null; reprintRequestReason: string | null
    reprintRequestedAt: string | null; canApproveReprint: boolean }
}
export function ReprintApprovalsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const q = (searchParams.get('q') ?? searchParams.get('txNo') ?? '').trim()
  const [rows, setRows] = useState<Application[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState<Application | null>(null)
  const [reviewAction, setReviewAction] = useState<'APPROVE' | 'REJECT'>('APPROVE')
  const [remark, setRemark] = useState('')
  async function load() {
    setBusy(true); setError('')
    try {
      const result = await apiGet<{ items: Application[] }>('/api/admin/transactions')
      if (result.ok) setRows(result.data.items.filter(row => row.receipt?.reprintRequestStatus === 'PENDING'))
      else setError(result.error)
    } catch { setError('审批申请加载失败，请重试。') }
    finally { setBusy(false) }
  }
  useEffect(() => {
    let active = true
    apiGet<{ items: Application[] }>('/api/admin/transactions').then(result => {
      if (!active) return
      if (result.ok) setRows(result.data.items.filter(row => row.receipt?.reprintRequestStatus === 'PENDING'))
      else setError(result.error)
    }).catch(() => { if (active) setError('审批申请加载失败，请重试。') })
    return () => { active = false }
  }, [])
  async function submit(action: 'APPROVE' | 'REJECT') {
    if (!review) return
    setBusy(true); setError('')
    try {
      const result = await apiPost('/api/admin/transactions/receipts/reprint-review', {
        transactionId: review.id, action, remark: remark.trim() || undefined,
      })
      if (!result.ok) { setError(result.error); return }
      setMessage(action === 'APPROVE' ? '已通过，可回到交易记录重新导出收据。' : '已驳回再次导出申请。')
      setRows(previous => previous.filter(row => row.id !== review.id)); setReview(null)
    } catch { setError('审批提交失败，请重试。') }
    finally { setBusy(false) }
  }
  const visibleRows = q ? rows.filter(row => row.txNo.toLowerCase().includes(q.toLowerCase())) : rows
  return <div>
    <div className="a-row" style={{ justifyContent: 'space-between' }}><div className="a-h1">再次导出审批</div>
      <button className="a-btn ghost" disabled={busy} onClick={load}>{busy ? '加载中…' : '刷新'}</button></div>
    <p className="a-muted">审批用户提交的再次导出收据申请，审批通过后方可重新导出收据。</p>
    {q ? <div className="a-row" style={{ marginBottom: 16 }}>
      <span>已定位流水号：{q}</span>
      <button className="a-btn ghost" onClick={() => {
        const next = new URLSearchParams(searchParams)
        next.delete('q'); next.delete('txNo'); setSearchParams(next, { replace: true })
      }}>清除定位</button>
    </div> : null}
    {error ? <p role="alert" style={{ color: '#b91c1c' }}>{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <div className="a-card a-table-wrap"><table className="a-table"><thead><tr>
      {['申请编号', '收据编号', '流水号', '金额', '申请人', '申请原因', '门店', '申请时间', '操作'].map(label => <th key={label}>{label}</th>)}
    </tr></thead><tbody>{visibleRows.map(row => <tr key={row.id}>
      <td>—</td><td>—</td><td>{row.txNo}</td><td>¥{row.amount.toFixed(2)}</td><td>—</td>
      <td>{row.receipt.reprintRequestReason || '—'}</td><td>{row.house.storeName}</td>
      <td>{row.receipt.reprintRequestedAt ? new Date(row.receipt.reprintRequestedAt).toLocaleString('zh-CN') : '—'}</td>
      <td><div className="a-row" style={{ flexWrap: 'wrap' }}>
        <button className="a-btn" disabled={busy || !row.receipt.canApproveReprint} onClick={() => { setReview(row); setReviewAction('APPROVE'); setRemark('') }}>批准</button>
        <button className="a-btn ghost" disabled={busy || !row.receipt.canApproveReprint} onClick={() => { setReview(row); setReviewAction('REJECT'); setRemark('') }}>驳回</button>
      </div></td>
    </tr>)}{visibleRows.length === 0 ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40 }}>{q ? '该流水暂无待审批申请' : '暂无待审批的再次导出申请'}</td></tr> : null}</tbody></table></div>
    <p className="a-muted">申请数据与本地 DEMO 的<Link to="/transactions">交易记录列表</Link>联通。未提供的申请编号、收据编号和申请人以“—”显示。</p>
    {review ? <DemoDialog title={`${reviewAction === 'APPROVE' ? '批准' : '驳回'}再次导出申请 · ${review.txNo}`} onClose={() => { if (!busy) setReview(null) }}>
      <p>申请原因：{review.receipt.reprintRequestReason}</p>
      <label className="a-col">审批意见<textarea className="a-filter-input" value={remark} onChange={event => setRemark(event.target.value)} /></label>
      <div className="a-row" style={{ marginTop: 20 }}><button className="a-btn" disabled={busy} onClick={() => submit(reviewAction)}>{busy ? '提交中…' : reviewAction === 'APPROVE' ? '确认批准' : '确认驳回'}</button>
        <button className="a-btn ghost" disabled={busy} onClick={() => setReview(null)}>取消</button></div>
    </DemoDialog> : null}
  </div>
}
