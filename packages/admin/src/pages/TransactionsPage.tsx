import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '../api'
import { Pagination, paginate } from '../components/Pagination'

type TxItem = {
  id: string
  txNo: string
  orderId: string
  type: 'BILL_PAYMENT' | 'REFUND' | 'OFFLINE_VERIFY' | 'PREPAYMENT'
  channel: 'ONLINE' | 'OFFLINE'
  amount: number
  occurredAt: string
  contractId: string
  contractNo: string
  tenant: { name: string; phone: string }
  house: { storeName: string; apartmentName: string; houseNo: string }
  houseBizId: string
  period: string | null
  dueDate: string | null
  attachmentCount: number
  note: string
  verify: {
    billId: string
    offlineVerifiedAt: string
    offlineVerifiedRemark: string | null
    offlineVerifyAttachments: {
      id: string
      name: string
      file: string
      previewUrl: string
      downloadUrl: string
    }[]
  } | null
}

const TYPE_ZH: Record<TxItem['type'], string> = {
  BILL_PAYMENT: '收款',
  REFUND: '退款',
  OFFLINE_VERIFY: '线下核销',
  PREPAYMENT: '预收入账',
}

/** 悬浮在「类型」旁问号上展示（浏览器原生 tooltip） */
const TX_TYPE_HELP_TITLE = [
  '【收款】租客通过 H5 等线上渠道，对账单整笔支付成功后产生的入账记录。',
  '',
  '【线下核销】在「账单管理」中每提交一次「线下核销」即产生一条流水；金额为本次实收总额，可小于、等于或大于该账单剩余应付。小于时账单仍待付；等于或大于时结清该期。',
  '',
  '【预收入账】与「线下核销」的关系：当本次核销实收金额大于该账单剩余应付时，超出部分会记入合同的「预收余额」（侧栏「合同预收款」可查看余额与流水）。超额部分会额外记一条「预收入账」流水，金额仅为超额；同一次操作中您会先看到一条「线下核销」（整笔实收），若存在超额则紧接出现「预收入账」，便于区分「进账单」与「进预收池」。',
  '',
  '【退款】合同侧退款产生的流水。',
].join('\n')

const CHANNEL_ZH: Record<TxItem['channel'], string> = {
  ONLINE: '线上支付',
  OFFLINE: '线下支付',
}

type ReceiptKind = 'RENT' | 'DEPOSIT'

const RECEIPT_KIND_ZH: Record<ReceiptKind, string> = {
  RENT: '租金收据',
  DEPOSIT: '押金收据',
}

function formatContractNo(contractNo: string) {
  const digits = (contractNo || '').replace(/\D/g, '')
  return digits ? `HT${digits}` : contractNo
}

function fmtMoney(n: number) {
  const sign = n < 0 ? '-' : ''
  const v = Math.abs(n)
  return `${sign}¥${v.toLocaleString('zh-CN')}`
}

function fmtDt(iso: string) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${dd} ${hh}:${mm}`
  } catch {
    return iso
  }
}

function fmtVerifyModalDt(iso: string) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

export function TransactionsPage() {
  const [items, setItems] = useState<TxItem[]>([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [apartmentFilter, setApartmentFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState('')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [receiptOpen, setReceiptOpen] = useState(false)
  const [receiptKind, setReceiptKind] = useState<ReceiptKind | ''>('')

  const [verifyDetail, setVerifyDetail] = useState<TxItem | null>(null)

  function resetTransactionFilters() {
    setQ('')
    setTypeFilter('')
    setChannelFilter('')
    setStoreFilter('')
    setApartmentFilter('')
    setPeriodFilter('')
    setPage(1)
  }

  async function load() {
    setError('')
    const r = await apiGet<{ items: TxItem[] }>('/api/admin/transactions')
    if (!r.ok) return setError(r.error)
    setItems(r.data.items ?? [])
    setMsg('')
    setSelectedIds(new Set())
  }

  useEffect(() => {
    load()
  }, [])

  const filterOptions = useMemo(() => {
    const stores = Array.from(new Set(items.map((x) => x.house.storeName).filter(Boolean))).sort()
    const apartments = Array.from(new Set(items.map((x) => x.house.apartmentName).filter(Boolean))).sort()
    const periods = Array.from(new Set(items.map((x) => x.period).filter(Boolean) as string[])).sort().reverse()
    return { stores, apartments, periods }
  }, [items])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return items.filter((x) => {
      if (typeFilter && x.type !== typeFilter) return false
      if (channelFilter && x.channel !== channelFilter) return false
      if (storeFilter && x.house.storeName !== storeFilter) return false
      if (apartmentFilter && x.house.apartmentName !== apartmentFilter) return false
      if (periodFilter && x.period !== periodFilter) return false
      if (!kw) return true
      const hay =
        `${x.txNo} ${x.orderId} ${x.contractNo} ${formatContractNo(x.contractNo)} ${x.tenant.name} ${x.tenant.phone} ${x.house.storeName} ${x.house.apartmentName} ${x.house.houseNo} ${x.houseBizId} ${x.period ?? ''} ${x.note} ${TYPE_ZH[x.type]} ${CHANNEL_ZH[x.channel]}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, typeFilter, channelFilter, storeFilter, apartmentFilter, periodFilter])

  const pageData = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize])

  const visibleIds = useMemo(() => pageData.items.map((x) => x.id), [pageData.items])
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id))

  function openReceiptExportModal() {
    setError('')
    setMsg('')
    if (selectedIds.size === 0) return setError('请先勾选要导出的交易记录')
    setReceiptKind('')
    setReceiptOpen(true)
  }

  function closeReceiptModal() {
    setReceiptOpen(false)
    setReceiptKind('')
  }

  function confirmReceiptExport() {
    const ids = Array.from(selectedIds)
    const kind = receiptKind
    if (!kind || ids.length === 0) return
    setMsg(
      `已导出请求：${ids.length} 条，收据类型「${RECEIPT_KIND_ZH[kind]}」。正式文件生成待收据模板接入后启用。`,
    )
    closeReceiptModal()
  }

  const emptyColSpan = 18

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">交易记录</div>
        <div className="a-muted">
          汇总系统内收款、退款与线下核销流水。线下核销可查看附件；原「核销记录」菜单已合并至本页，请用「类型」筛选。
        </div>
      </div>

      {error ? <div className="a-card a-error">加载失败：{error}</div> : null}
      {msg ? <div className="a-card a-success">{msg}</div> : null}

      <div className="a-card">
        <div className="a-row" style={{ justifyContent: 'space-between' }}>
          <div className="a-filterbar" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className="a-filter-label">筛选</span>
            <input
              className="a-filter-input"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
              placeholder="搜索：流水号/合同/租客/门店/房号/备注…"
              style={{ minWidth: 210 }}
            />
            <select
              className="a-filter-select"
              value={storeFilter}
              onChange={(e) => {
                setStoreFilter(e.target.value)
                setPage(1)
              }}
              title="所属门店"
            >
              <option value="">全部门店</option>
              {filterOptions.stores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="a-filter-select"
              value={apartmentFilter}
              onChange={(e) => {
                setApartmentFilter(e.target.value)
                setPage(1)
              }}
              title="公寓"
            >
              <option value="">全部公寓</option>
              {filterOptions.apartments.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              className="a-filter-select"
              value={periodFilter}
              onChange={(e) => {
                setPeriodFilter(e.target.value)
                setPage(1)
              }}
              title="账期"
            >
              <option value="">全部账期</option>
              {filterOptions.periods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              className="a-filter-select"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value)
                setPage(1)
              }}
              title="交易类型"
            >
              <option value="">全部类型</option>
              <option value="BILL_PAYMENT">收款</option>
              <option value="OFFLINE_VERIFY">线下核销</option>
              <option value="PREPAYMENT">预收入账</option>
              <option value="REFUND">退款</option>
            </select>
            <select
              className="a-filter-select"
              value={channelFilter}
              onChange={(e) => {
                setChannelFilter(e.target.value)
                setPage(1)
              }}
              title="交易渠道"
            >
              <option value="">全部渠道</option>
              <option value="ONLINE">线上支付</option>
              <option value="OFFLINE">线下支付</option>
            </select>
            <button className="a-btn ghost" onClick={() => setPage(1)} title="使用当前筛选条件进行查询">
              查询
            </button>
            <button className="a-btn ghost" onClick={resetTransactionFilters} title="清空筛选条件">
              重置
            </button>
            <span className="a-muted">共 {filtered.length} 条</span>
          </div>

          <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              className="a-btn ghost"
              onClick={() => setMsg('导出功能待业主提供模板后开启')}
              title="等待业主提供导出模板"
            >
              导出
            </button>
            <button className="a-btn ghost" onClick={openReceiptExportModal} title="导出所选交易的收据">
              导出收据
            </button>
            <button className="a-btn ghost" onClick={load}>
              刷新
            </button>
          </div>
        </div>

        <div style={{ height: 10 }} />
        <div className="a-table-wrap">
          <table className="a-table a-table-sticky-op">
            <thead>
              <tr>
                <th style={{ width: 48 }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected
                    }}
                    onChange={(e) => {
                      const checked = e.target.checked
                      setSelectedIds((prev) => {
                        const next = new Set(prev)
                        for (const id of visibleIds) {
                          if (checked) next.add(id)
                          else next.delete(id)
                        }
                        return next
                      })
                    }}
                    aria-label="全选当前页数据"
                  />
                </th>
                <th>时间</th>
                <th>流水号</th>
                <th>订单号</th>
                <th>
                  <span className="a-th-label-help">
                    类型
                    <span
                      className="a-help-icon"
                      tabIndex={0}
                      role="note"
                      title={TX_TYPE_HELP_TITLE}
                      aria-label="交易类型说明：收款、线下核销、预收入账、退款的含义及预收与核销的边界"
                    >
                      ?
                    </span>
                  </span>
                </th>
                <th>交易渠道</th>
                <th>金额</th>
                <th>合同</th>
                <th>房源ID</th>
                <th>租客</th>
                <th>手机号</th>
                <th>门店</th>
                <th>公寓</th>
                <th>房号</th>
                <th>账期 / 到期</th>
                <th>备注</th>
                <th>附件</th>
                <th className="a-op-col">操作</th>
              </tr>
            </thead>
            <tbody>
              {pageData.items.map((x) => (
                <tr key={x.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(x.id)}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setSelectedIds((prev) => {
                          const next = new Set(prev)
                          if (checked) next.add(x.id)
                          else next.delete(x.id)
                          return next
                        })
                      }}
                      aria-label={`选择 ${x.txNo}`}
                    />
                  </td>
                  <td className="a-muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                    {fmtDt(x.occurredAt)}
                  </td>
                  <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{x.txNo}</td>
                  <td className="a-muted" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {x.orderId}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 800 }}>{TYPE_ZH[x.type]}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{CHANNEL_ZH[x.channel]}</td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 900, color: x.amount < 0 ? '#b91c1c' : '#047857' }}>
                    {fmtMoney(x.amount)}
                  </td>
                  <td style={{ fontWeight: 700 }}>{formatContractNo(x.contractNo)}</td>
                  <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{x.houseBizId}</td>
                  <td>{x.tenant.name}</td>
                  <td className="a-muted">{x.tenant.phone}</td>
                  <td className="a-muted">{x.house.storeName}</td>
                  <td className="a-muted">{x.house.apartmentName}</td>
                  <td style={{ fontWeight: 700 }}>{x.house.houseNo}</td>
                  <td className="a-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {x.period || '—'} <span style={{ color: '#94a3b8' }}>/</span> {x.dueDate || '—'}
                  </td>
                  <td className="a-muted" style={{ maxWidth: 220, fontSize: 12 }}>
                    {x.note}
                  </td>
                  <td className="a-muted" style={{ whiteSpace: 'nowrap' }}>
                    {x.attachmentCount > 0 ? `${x.attachmentCount} 个` : '—'}
                  </td>
                  <td className="a-op-cell">
                    <div className="a-op-actions">
                      {x.type === 'OFFLINE_VERIFY' && x.verify ? (
                        <button type="button" className="a-btn ghost" onClick={() => setVerifyDetail(x)}>
                          核销详情
                        </button>
                      ) : (
                        <span className="a-muted">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={emptyColSpan} className="a-muted">
                    暂无交易记录。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <Pagination
          total={pageData.total}
          page={pageData.page}
          pageSize={pageData.pageSize}
          onChange={(p) => {
            setPage(p.page)
            setPageSize(p.pageSize)
          }}
        />
      </div>

      {receiptOpen ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && closeReceiptModal()}
        >
          <div className="a-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">导出收据</div>
              <button type="button" className="a-modal-close" onClick={closeReceiptModal}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <p className="a-muted" style={{ margin: '0 0 14px', lineHeight: 1.55, fontSize: 14 }}>
                已选择 <strong>{selectedIds.size}</strong> 条记录。请选择收据模板类型（业主提供 Word/PDF 模板后将自动套打）。
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label className="a-row" style={{ alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="receiptKind"
                    checked={receiptKind === 'RENT'}
                    onChange={() => setReceiptKind('RENT')}
                  />
                  <span>{RECEIPT_KIND_ZH.RENT}</span>
                </label>
                <label className="a-row" style={{ alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="receiptKind"
                    checked={receiptKind === 'DEPOSIT'}
                    onChange={() => setReceiptKind('DEPOSIT')}
                  />
                  <span>{RECEIPT_KIND_ZH.DEPOSIT}</span>
                </label>
              </div>
              <div className="a-row" style={{ marginTop: 18, gap: 10, flexWrap: 'wrap' }}>
                <button type="button" className="a-btn ghost" onClick={closeReceiptModal}>
                  取消
                </button>
                <button type="button" className="a-btn" disabled={!receiptKind} onClick={confirmReceiptExport}>
                  导出
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {verifyDetail && verifyDetail.verify ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setVerifyDetail(null)}
        >
          <div className="a-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">
                核销详情 · {formatContractNo(verifyDetail.contractNo)} {verifyDetail.period ?? ''}
              </div>
              <button type="button" className="a-modal-close" onClick={() => setVerifyDetail(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              <div className="a-kv">
                <div className="a-kv-row">
                  <div className="a-kv-k">核销时间</div>
                  <div className="a-kv-v">{fmtVerifyModalDt(verifyDetail.verify.offlineVerifiedAt)}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">金额</div>
                  <div className="a-kv-v">¥{verifyDetail.amount}</div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">房源</div>
                  <div className="a-kv-v">
                    {verifyDetail.house.apartmentName} {verifyDetail.house.houseNo}（{verifyDetail.house.storeName}）
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">租客</div>
                  <div className="a-kv-v">
                    {verifyDetail.tenant.name} {verifyDetail.tenant.phone}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">备注</div>
                  <div className="a-kv-v">
                    {verifyDetail.verify.offlineVerifiedRemark?.trim() ? verifyDetail.verify.offlineVerifiedRemark : '—'}
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">附件</div>
                  <div className="a-kv-v">
                    {verifyDetail.verify.offlineVerifyAttachments.length > 0 ? (
                      <div className="a-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                        {verifyDetail.verify.offlineVerifyAttachments.map((a) => (
                          <a
                            key={a.id}
                            className="a-btn ghost"
                            href={a.previewUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="点击预览；右键可另存为"
                          >
                            {a.name}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="a-muted">未上传</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <Link className="a-btn" to="/bills">
                  去账单管理
                </Link>
                <button type="button" className="a-btn ghost" onClick={() => setVerifyDetail(null)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
