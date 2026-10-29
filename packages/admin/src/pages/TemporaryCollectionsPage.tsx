import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { apiGet } from '../api'
import { DemoDialog } from '../components/DemoDialog'
import { Pagination, paginate } from '../components/Pagination'
import { useDemoRecords } from '../demoStorage'
import { TemporaryCollectionPaymentCode } from '../components/TemporaryCollectionPaymentCode'
import {
  EMPTY_TEMPORARY_COLLECTION_FILTERS, TEMPORARY_COLLECTION_FEE_TYPES, TEMPORARY_COLLECTION_STATUS_LABEL,
  TEMPORARY_COLLECTION_STORAGE_KEY, createTemporaryCollection, emptyTemporaryCollectionDraft,
  filterTemporaryCollections, isTemporaryCollection, temporaryCollectionMoney, transitionTemporaryCollection,
  type TemporaryCollection, type TemporaryCollectionDraft, type TemporaryCollectionFilters,
} from '../temporaryCollectionData'

type ContractReference = { contractNo: string; house: { storeName: string } }
type CollectionDialog = { type: 'detail' | 'payment' | 'cancel'; id: string }
const INITIAL_COLLECTIONS: TemporaryCollection[] = []
const FORM_FIELDS: { key: Exclude<keyof TemporaryCollectionDraft, 'remark'>; label: string; required?: boolean }[] = [
  { key: 'contractNo', label: '合同编号' }, { key: 'tenantName', label: '租户姓名', required: true },
  { key: 'phone', label: '手机号' }, { key: 'feeType', label: '费用类型' },
  { key: 'amount', label: '金额(元)', required: true }, { key: 'period', label: '账期' },
  { key: 'houseBizId', label: '房源编号' }, { key: 'houseNo', label: '房号' },
]
function collectionTime(value: string): string {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—'
}
function CollectionDetails({ row }: { row: TemporaryCollection }) {
  const fields = [
    ['收款单号', row.number], ['门店', row.storeName], ['合同编号', row.contractNo], ['租户姓名', row.tenantName], ['手机号', row.phone],
    ['费用类型', row.feeType], ['金额', `¥${temporaryCollectionMoney(row.amountCents)}`], ['状态', TEMPORARY_COLLECTION_STATUS_LABEL[row.status]],
    ['渠道', row.channel], ['支付时间', collectionTime(row.paidAt)], ['创建时间', collectionTime(row.createdAt)], ['取消时间', collectionTime(row.cancelledAt)],
    ['账期', row.period], ['房源编号', row.houseBizId], ['房号', row.houseNo], ['备注', row.remark],
  ]
  return <dl style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: '12px 16px', overflowWrap: 'anywhere' }}>
    {fields.map(([label, value]) => <div key={label} style={{ display: 'contents' }}><dt className="a-muted">{label}</dt><dd style={{ margin: 0 }}>{value || '—'}</dd></div>)}
  </dl>
}

export function TemporaryCollectionsPage() {
  const { records, commit, storageIssue } = useDemoRecords(TEMPORARY_COLLECTION_STORAGE_KEY, INITIAL_COLLECTIONS, isTemporaryCollection)
  const [inputs, setInputs] = useState<TemporaryCollectionFilters>(EMPTY_TEMPORARY_COLLECTION_FILTERS)
  const [filters, setFilters] = useState<TemporaryCollectionFilters>(EMPTY_TEMPORARY_COLLECTION_FILTERS)
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10 })
  const [draft, setDraft] = useState<TemporaryCollectionDraft | null>(null)
  const [dialog, setDialog] = useState<CollectionDialog | null>(null)
  const [contracts, setContracts] = useState<ContractReference[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const activeRecord = records.find(row => row.id === dialog?.id)

  useEffect(() => {
    let active = true
    // 只读本地合同提供已知门店；本页录入内容不提交业务或支付接口。
    void apiGet<{ items: ContractReference[] }>('/api/admin/contracts').then(result => {
      if (active && result.ok && Array.isArray(result.data.items)) setContracts(result.data.items)
    }).catch(() => { /* 合同关联选填，未知门店保持空白。 */ })
    return () => { active = false }
  }, [])
  const filtered = useMemo(() => filterTemporaryCollections(records, filters), [records, filters])
  const paged = paginate(filtered, pagination.page, pagination.pageSize)
  function query(event: FormEvent) {
    event.preventDefault(); setError('')
    if (inputs.from && inputs.to && inputs.from > inputs.to) { setError('创建时间的开始日期不能晚于结束日期。'); return }
    setFilters({ ...inputs }); setPagination(previous => ({ ...previous, page: 1 }))
  }
  function open(type: CollectionDialog['type'], id: string) { setError(''); setMessage(''); setDialog({ type, id }) }
  function close() { setError(''); setDialog(null) }
  function save(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    const contract = contracts.find(row => row.contractNo === draft.contractNo.trim())
    const result = createTemporaryCollection(draft, crypto.randomUUID(), new Date().toISOString(), contract?.house.storeName ?? '')
    if (!result.ok) { setError(result.error); return }
    if (!commit([result.record, ...records])) { setError('本机存储不可用，收款单尚未保存。'); return }
    setDraft(null); setInputs(EMPTY_TEMPORARY_COLLECTION_FILTERS); setFilters(EMPTY_TEMPORARY_COLLECTION_FILTERS)
    setPagination(previous => ({ ...previous, page: 1 })); setError('')
    setMessage('演示收款单已保存到本机，可打开付款码演示；未创建真实付款订单。')
  }
  function transition(next: 'PAID' | 'CANCELLED') {
    if (!activeRecord) return
    const result = transitionTemporaryCollection(activeRecord, next, new Date().toISOString())
    if (!result.ok) { setError(result.error); return }
    if (!commit(records.map(row => row.id === activeRecord.id ? result.record : row))) { setError('本机存储不可用，状态尚未保存。'); return }
    setError(''); setDialog(null)
    setMessage(next === 'PAID' ? '已完成本地演示支付，收款单更新为已支付；未发生真实扣款。' : '已取消本机演示收款单；未调用真实收款服务。')
  }
  return <div>
    <div className="a-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <h1 className="a-h1" style={{ margin: 0 }}>临时收款</h1>
      <button type="button" className="a-btn" onClick={() => { setDraft(emptyTemporaryCollectionDraft()); setError(''); setMessage('') }}>新增收款</button>
    </div>
    <p className="a-muted">店长录入临时收款信息生成付款二维码，租户扫码支付成功后记录自动置为已支付。</p>
    <p className="a-muted" style={{ fontSize: 12 }}>评审演示：本页收款资料仅保存在当前浏览器，付款码和状态操作用于本地演示，不发起真实支付。</p>
    {storageIssue ? <p role="alert" style={{ color: '#b91c1c' }}>{storageIssue}</p> : null}
    {error && !draft && !dialog ? <p role="alert" style={{ color: '#b91c1c' }}>{error}</p> : null}
    {message ? <p role="status" style={{ color: '#166534' }}>{message}</p> : null}
    <form className="a-card a-filterbar" onSubmit={query} style={{ margin: '20px 0', gap: 16, alignItems: 'end' }}>
      <label className="a-col" style={{ gap: 6 }}>搜索<input className="a-filter-input" placeholder="收款单号/合同/租户/手机号" value={inputs.query} onChange={event => setInputs({ ...inputs, query: event.target.value })} /></label>
      <label className="a-col" style={{ gap: 6 }}>状态<select className="a-filter-input" style={{ minWidth: 150 }} value={inputs.status} onChange={event => setInputs({ ...inputs, status: event.target.value as TemporaryCollectionFilters['status'] })}>
        <option value="">全部状态</option><option value="PENDING">待支付</option><option value="PAID">已支付</option><option value="CANCELLED">已取消</option>
      </select></label>
      <div className="a-col" style={{ gap: 6 }}><span>创建时间</span><div className="a-row" style={{ gap: 8 }}>
        <input aria-label="创建时间开始日期" className="a-filter-input" style={{ minWidth: 150 }} type="date" value={inputs.from} onChange={event => setInputs({ ...inputs, from: event.target.value })} />
        <span className="a-muted">至</span><input aria-label="创建时间结束日期" className="a-filter-input" style={{ minWidth: 150 }} type="date" value={inputs.to} onChange={event => setInputs({ ...inputs, to: event.target.value })} />
      </div></div>
      <button type="submit" className="a-btn">查询</button><button type="button" className="a-btn ghost" onClick={() => {
        setInputs(EMPTY_TEMPORARY_COLLECTION_FILTERS); setFilters(EMPTY_TEMPORARY_COLLECTION_FILTERS); setError(''); setPagination(previous => ({ ...previous, page: 1 }))
      }}>重置</button>
    </form>
    <div className="a-card" style={{ padding: 0 }}><div className="a-table-wrap"><table className="a-table" style={{ minWidth: 1500 }}>
      <thead><tr>{['收款单号', '门店', '合同', '租户', '手机号', '费用类型', '金额', '状态', '渠道', '支付时间', '创建时间', '操作'].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{paged.items.map(row => <tr key={row.id}>
        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{row.number}</td><td>{row.storeName || '—'}</td><td>{row.contractNo || '—'}</td><td>{row.tenantName}</td><td>{row.phone || '—'}</td>
        <td>{row.feeType}</td><td style={{ whiteSpace: 'nowrap' }}>¥{temporaryCollectionMoney(row.amountCents)}</td><td><span className={`a-badge ${row.status === 'PAID' ? 'report-success' : row.status === 'CANCELLED' ? 'report-failed' : ''}`}>{TEMPORARY_COLLECTION_STATUS_LABEL[row.status]}</span></td>
        <td>{row.channel || '—'}</td><td>{collectionTime(row.paidAt)}</td><td>{collectionTime(row.createdAt)}</td>
        <td><div className="a-row" style={{ gap: 6, flexWrap: 'wrap', minWidth: 190 }}><button type="button" className="a-btn ghost" onClick={() => open('detail', row.id)}>详情</button>
          {row.status === 'PENDING' ? <><button type="button" className="a-btn ghost" onClick={() => open('payment', row.id)}>付款码</button><button type="button" className="a-btn ghost" onClick={() => open('cancel', row.id)}>演示取消</button></> : null}
        </div></td>
      </tr>)}{paged.items.length === 0 ? <tr><td colSpan={12} style={{ textAlign: 'center', padding: 48, color: '#64748b' }}>暂无数据</td></tr> : null}</tbody>
    </table></div><Pagination total={paged.total} page={paged.page} pageSize={paged.pageSize} onChange={setPagination} /></div>

    {draft ? <DemoDialog title="新增收款" onClose={() => { setDraft(null); setError('') }}><form onSubmit={save}>
      <p className="a-muted" style={{ marginTop: 0 }}>请使用虚构资料评审；保存内容仅留在本机，不生成真实收款订单。</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px 20px' }}>
        {FORM_FIELDS.map(field => <label className="a-col" style={{ gap: 6 }} key={field.key}>
          <span>{field.required ? <span style={{ color: '#dc2626' }}>* </span> : null}{field.label}</span>
          {field.key === 'feeType' ? <select className="a-filter-input" style={{ minWidth: 0 }} value={draft.feeType} onChange={event => setDraft({ ...draft, feeType: event.target.value as TemporaryCollection['feeType'] })}>
            {TEMPORARY_COLLECTION_FEE_TYPES.map(type => <option key={type}>{type}</option>)}</select>
            : <input className="a-filter-input" style={{ minWidth: 0 }} type={field.key === 'phone' ? 'tel' : 'text'}
              inputMode={field.key === 'amount' ? 'decimal' : undefined} required={field.required} placeholder={field.required ? '' : '选填'}
              list={field.key === 'contractNo' ? 'temporary-collection-contracts' : undefined} value={draft[field.key]}
              onChange={event => setDraft({ ...draft, [field.key]: event.target.value })} />}
          {field.key === 'amount' ? <small className="a-muted">大于 0，最多两位小数</small> : null}
        </label>)}
        <datalist id="temporary-collection-contracts">{contracts.map(row => <option value={row.contractNo} key={row.contractNo} />)}</datalist>
        <label className="a-col" style={{ gap: 6, gridColumn: '1 / -1' }}>备注<textarea className="a-filter-input" style={{ minWidth: 0 }} rows={3} placeholder="选填" value={draft.remark} onChange={event => setDraft({ ...draft, remark: event.target.value })} /></label>
      </div>
      {error ? <p role="alert" style={{ color: '#b91c1c' }}>{error}</p> : null}
      <div className="a-row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 22 }}><button type="button" className="a-btn ghost" onClick={() => { setDraft(null); setError('') }}>取消</button><button type="submit" className="a-btn">确定</button></div>
    </form></DemoDialog> : null}

    {dialog && activeRecord ? <DemoDialog title={dialog.type === 'detail' ? '收款详情' : dialog.type === 'payment' ? '付款码 · 本地演示' : '取消收款 · 本地演示'} onClose={close}>
      <div className="a-muted" style={{ marginBottom: 16 }}>此收款单仅供本地评审演示，未接入真实收款服务。</div>
      {dialog.type === 'detail' ? <CollectionDetails row={activeRecord} /> : null}
      {dialog.type === 'payment' ? <div style={{ textAlign: 'center' }}>
        <p>{activeRecord.number}</p><div style={{ fontSize: 30, fontWeight: 800, color: '#1d4ed8' }}>¥{temporaryCollectionMoney(activeRecord.amountCents)}</div>
        <TemporaryCollectionPaymentCode id={activeRecord.id} /><p className="a-muted">本地演示支付只更新此浏览器记录，不发生扣款。</p>
        <button type="button" className="a-btn" disabled={activeRecord.status !== 'PENDING'} onClick={() => transition('PAID')}>演示支付成功</button>
      </div> : null}
      {dialog.type === 'cancel' ? <><p>确认取消此本机演示收款单？取消后不能继续演示支付。</p><p>{activeRecord.number} · ¥{temporaryCollectionMoney(activeRecord.amountCents)}</p>
        <div className="a-row" style={{ justifyContent: 'flex-end', gap: 10 }}><button type="button" className="a-btn ghost" onClick={close}>返回</button><button type="button" className="a-btn" onClick={() => transition('CANCELLED')}>确认演示取消</button></div></> : null}
      {error ? <p role="alert" style={{ color: '#b91c1c' }}>{error}</p> : null}
    </DemoDialog> : null}
  </div>
}
