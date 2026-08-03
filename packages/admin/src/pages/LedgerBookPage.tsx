import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { apiGet, apiPost } from '../api'
import { getAdminToken } from '../auth'
import { Pagination, paginate } from '../components/Pagination'

type TabKey = 'create' | 'pending' | 'paid' | 'all'

type LedgerPayment = {
  id: string
  displayNo: string
  contractNo: string
  billNo: string | null
  tenantName: string
  tenantPhone: string | null
  amount: number
  feeType: string
  feeTypeLabel: string
  remark: string | null
  status: 'PENDING' | 'PAID' | 'CANCELLED' | string
  payChannel: string | null
  paidAt: string | null
  createdByName: string | null
  cancelledAt: string | null
  cancelReason: string | null
  createdAt: string
  payUrl: string
  qrImageUrl: string
}

type ListResponse = {
  items: LedgerPayment[]
  summary: {
    pending: number
    paid: number
    cancelled: number
    paidAmount: number
    pendingAmount: number
  }
}

type CreateForm = {
  contractNo: string
  billNo: string
  tenantName: string
  tenantPhone: string
  amount: string
  feeType: 'RENT' | 'PROPERTY' | 'UTILITY' | 'DEPOSIT' | 'OTHER'
  remark: string
}

const FEE_OPTIONS: { value: CreateForm['feeType']; label: string }[] = [
  { value: 'RENT', label: '租金' },
  { value: 'PROPERTY', label: '物业费' },
  { value: 'UTILITY', label: '水电费' },
  { value: 'DEPOSIT', label: '押金' },
  { value: 'OTHER', label: '其他' },
]

const TAB_META: Record<TabKey, { label: string; desc: string }> = {
  create: {
    label: '发起收款',
    desc: '填写合同/账单等信息后生成付款二维码，发给租户用微信或支付宝扫码付款。',
  },
  pending: {
    label: '待付款',
    desc: '已生成二维码、等待租户付款的记录。可再次查看二维码，或取消收款。',
  },
  paid: {
    label: '已收款',
    desc: '租户扫码支付成功后的流水记录。',
  },
  all: {
    label: '全部流水',
    desc: '记账本全部收款记录（含待付、已收、已取消）。可按创建/付款时间筛选并导出 CSV。',
  },
}

function guessMobilePayOrigin() {
  if (typeof window === 'undefined') return 'http://localhost:5173'
  const { protocol, hostname } = window.location
  const port = hostname === 'localhost' || hostname === '127.0.0.1' ? '5173' : window.location.port || '5173'
  return `${protocol}//${hostname}:${port}`
}

function fmtDt(iso: string | null | undefined) {
  if (!iso) return '—'
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

function statusLabel(status: string) {
  if (status === 'PENDING') return '待付款'
  if (status === 'PAID') return '已收款'
  if (status === 'CANCELLED') return '已取消'
  return status
}

function channelLabel(ch: string | null) {
  if (ch === 'WECHAT') return '微信支付'
  if (ch === 'ALIPAY') return '支付宝'
  return '—'
}

function csvEscape(v: unknown) {
  const s = String(v ?? '')
  const needs = /[",\n\r]/.test(s)
  const escaped = s.replace(/"/g, '""')
  return needs ? `"${escaped}"` : escaped
}

function ymdLocal(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = x.getDay() || 7
  x.setDate(x.getDate() - (day - 1))
  return x
}

async function downloadQrImage(item: LedgerPayment): Promise<void> {
  const filename = `收款码_${item.displayNo}.png`
  const token = getAdminToken()
  const proxyUrl = `/api/admin/ledger-payments/${encodeURIComponent(item.id)}/qr-image?mobileOrigin=${encodeURIComponent(guessMobilePayOrigin())}`

  const saveBlob = (blob: Blob) => {
    const obj = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = obj
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(obj)
  }

  // 优先走同源代理，避免跨域导致无法下载
  if (token) {
    const res = await fetch(proxyUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      saveBlob(await res.blob())
      return
    }
  }

  try {
    const res = await fetch(item.qrImageUrl, { mode: 'cors' })
    if (!res.ok) throw new Error('fetch failed')
    saveBlob(await res.blob())
    return
  } catch {
    /* canvas fallback */
  }

  await new Promise<void>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || 300
        canvas.height = img.naturalHeight || 300
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no canvas')
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('toBlob failed'))
            return
          }
          saveBlob(blob)
          resolve()
        }, 'image/png')
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error('img load failed'))
    img.src = `${item.qrImageUrl}${item.qrImageUrl.includes('?') ? '&' : '?'}t=${Date.now()}`
  })
}

const emptyForm = (): CreateForm => ({
  contractNo: '',
  billNo: '',
  tenantName: '',
  tenantPhone: '',
  amount: '',
  feeType: 'RENT',
  remark: '',
})

export function LedgerBookPage() {
  const [tab, setTab] = useState<TabKey>('create')
  const [form, setForm] = useState<CreateForm>(emptyForm)
  const [created, setCreated] = useState<LedgerPayment | null>(null)
  const [creating, setCreating] = useState(false)

  const [items, setItems] = useState<LedgerPayment[]>([])
  const [summary, setSummary] = useState<ListResponse['summary']>({
    pending: 0,
    paid: 0,
    cancelled: 0,
    paidAmount: 0,
    pendingAmount: 0,
  })
  const [q, setQ] = useState('')
  const [dateField, setDateField] = useState<'createdAt' | 'paidAt'>('createdAt')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingQr, setSavingQr] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [qrDetail, setQrDetail] = useState<LedgerPayment | null>(null)
  const [busyId, setBusyId] = useState('')

  const loadList = useCallback(
    async (opts?: {
      status?: string
      withDate?: boolean
      dateFromOverride?: string
      dateToOverride?: string
      dateFieldOverride?: 'createdAt' | 'paidAt'
      qOverride?: string
    }) => {
      setLoading(true)
      setError('')
      const params = new URLSearchParams()
      if (opts?.status) params.set('status', opts.status)
      const kw = opts?.qOverride !== undefined ? opts.qOverride : q
      if (kw.trim()) params.set('q', kw.trim())
      if (opts?.withDate) {
        params.set('dateField', opts.dateFieldOverride ?? dateField)
        const from = opts.dateFromOverride !== undefined ? opts.dateFromOverride : dateFrom
        const to = opts.dateToOverride !== undefined ? opts.dateToOverride : dateTo
        if (from) params.set('dateFrom', from)
        if (to) params.set('dateTo', to)
      }
      params.set('mobileOrigin', guessMobilePayOrigin())
      const r = await apiGet<ListResponse>(`/api/admin/ledger-payments?${params.toString()}`)
      setLoading(false)
      if (!r.ok) {
        setError(r.error)
        return
      }
      setItems(r.data.items ?? [])
      if (r.data.summary) setSummary(r.data.summary)
    },
    [q, dateField, dateFrom, dateTo],
  )

  function currentListOpts() {
    const status = tab === 'pending' ? 'PENDING' : tab === 'paid' ? 'PAID' : undefined
    return { status, withDate: tab === 'all' }
  }

  useEffect(() => {
    if (tab === 'create') return
    setPage(1)
    void loadList(currentListOpts())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loadList])

  const pageData = useMemo(() => paginate(items, page, pageSize), [items, page, pageSize])

  function updateField<K extends keyof CreateForm>(key: K, value: CreateForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError('')
    setMsg('')
    const amount = Number(form.amount)
    if (!form.contractNo.trim()) return setError('请填写合同编号')
    if (!form.tenantName.trim()) return setError('请填写租户姓名')
    if (!Number.isFinite(amount) || amount <= 0) return setError('请填写有效的收款金额')

    setCreating(true)
    const r = await apiPost<LedgerPayment>('/api/admin/ledger-payments', {
      contractNo: form.contractNo.trim(),
      billNo: form.billNo.trim() || null,
      tenantName: form.tenantName.trim(),
      tenantPhone: form.tenantPhone.trim() || null,
      amount,
      feeType: form.feeType,
      remark: form.remark.trim() || null,
      mobileOrigin: guessMobilePayOrigin(),
    })
    setCreating(false)
    if (!r.ok) return setError(r.error)
    setCreated(r.data)
    setMsg(`已生成收款码 ${r.data.displayNo}，可将二维码或链接发给租户付款。`)
    setForm(emptyForm())
  }

  async function cancelPayment(id: string) {
    if (!window.confirm('确认取消该笔待付款？取消后租户将无法再扫码支付。')) return
    setBusyId(id)
    setError('')
    const r = await apiPost<LedgerPayment>(`/api/admin/ledger-payments/${id}/cancel`, {
      reason: '管理员取消',
    })
    setBusyId('')
    if (!r.ok) return setError(r.error)
    setMsg(`已取消 ${r.data.displayNo}`)
    if (qrDetail?.id === id) setQrDetail(null)
    await loadList(currentListOpts())
  }

  async function simulatePay(id: string, channel: 'WECHAT' | 'ALIPAY') {
    setBusyId(id)
    setError('')
    const r = await apiPost<LedgerPayment>(`/api/admin/ledger-payments/${id}/simulate-pay`, {
      payChannel: channel,
    })
    setBusyId('')
    if (!r.ok) return setError(r.error)
    setMsg(`模拟付款成功：${r.data.displayNo}（${channelLabel(channel)}）`)
    if (qrDetail?.id === id) setQrDetail({ ...r.data })
    if (created?.id === id) setCreated({ ...r.data })
    if (tab !== 'create') await loadList(currentListOpts())
  }

  function copyText(text: string, tip: string) {
    void navigator.clipboard.writeText(text).then(
      () => setMsg(tip),
      () => setError('复制失败，请手动选择文本'),
    )
  }

  async function handleSaveQr(item: LedgerPayment) {
    setSavingQr(true)
    setError('')
    try {
      await downloadQrImage(item)
      setMsg(`已保存二维码图片：收款码_${item.displayNo}.png`)
    } catch {
      setError('保存图片失败，请右键二维码另存为，或检查网络后重试')
    } finally {
      setSavingQr(false)
    }
  }

  function applyDatePreset(preset: 'today' | 'week' | 'month' | 'clear') {
    const now = new Date()
    let from = ''
    let to = ''
    if (preset === 'today') {
      from = ymdLocal(now)
      to = from
    } else if (preset === 'week') {
      from = ymdLocal(startOfWeek(now))
      to = ymdLocal(now)
    } else if (preset === 'month') {
      from = ymdLocal(new Date(now.getFullYear(), now.getMonth(), 1))
      to = ymdLocal(now)
    }
    setDateFrom(from)
    setDateTo(to)
    setPage(1)
    void loadList({
      status: undefined,
      withDate: true,
      dateFromOverride: from,
      dateToOverride: to,
    })
  }

  function exportCsv() {
    const rows = items
    if (!rows.length) {
      setError('当前没有可导出的流水')
      return
    }
    const header = [
      '流水号',
      '创建时间',
      '合同编号',
      '账单编号',
      '租户姓名',
      '租户手机',
      '费用类型',
      '金额',
      '状态',
      '付款渠道',
      '付款时间',
      '备注',
      '操作人',
      '取消时间',
      '取消原因',
      '付款链接',
    ]
    const lines = [
      header.map(csvEscape).join(','),
      ...rows.map((x) =>
        [
          x.displayNo,
          fmtDt(x.createdAt),
          x.contractNo,
          x.billNo ?? '',
          x.tenantName,
          x.tenantPhone ?? '',
          x.feeTypeLabel,
          x.amount,
          statusLabel(x.status),
          channelLabel(x.payChannel),
          fmtDt(x.paidAt),
          x.remark ?? '',
          x.createdByName ?? '',
          fmtDt(x.cancelledAt),
          x.cancelReason ?? '',
          x.payUrl,
        ]
          .map(csvEscape)
          .join(','),
      ),
    ]
    const bom = '\uFEFF'
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const ymd = ymdLocal(new Date())
    a.download = `记账本流水_${ymd}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setMsg(`已导出 ${rows.length} 条流水（当前筛选结果）`)
  }

  const meta = TAB_META[tab]

  return (
    <div className="a-col" style={{ width: '100%', minWidth: 0 }}>
      <div className="a-card">
        <div className="a-h1">记账本</div>
        <div className="a-muted">
          录入收款信息并生成二维码，租户微信/支付宝扫码付款后自动记入流水。适用于临时收款、补缴或与账单管理并行使用的快捷收款场景。
        </div>
      </div>

      <div className="a-card a-report-tabs-card">
        <div className="a-report-tabs" role="tablist" aria-label="记账本功能">
          {(Object.keys(TAB_META) as TabKey[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`a-report-tab${tab === key ? ' is-active' : ''}`}
              onClick={() => {
                setTab(key)
                setError('')
                setMsg('')
              }}
            >
              {TAB_META[key].label}
              {key === 'pending' && summary.pending > 0 ? ` (${summary.pending})` : ''}
              {key === 'paid' && summary.paid > 0 ? ` (${summary.paid})` : ''}
            </button>
          ))}
        </div>
        <div className="a-muted a-report-tab-desc">{meta.desc}</div>
      </div>

      {(summary.pending > 0 || summary.paid > 0) && tab !== 'create' ? (
        <div className="a-card">
          <div className="a-row" style={{ gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div className="a-muted">待付款</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>
                {summary.pending} 笔 · ¥{summary.pendingAmount.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="a-muted">已收款</div>
              <div style={{ fontWeight: 800, fontSize: 18, color: '#047857' }}>
                {summary.paid} 笔 · ¥{summary.paidAmount.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="a-muted">已取消</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{summary.cancelled} 笔</div>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <div className="a-card a-error">{error}</div> : null}
      {msg ? <div className="a-card a-success">{msg}</div> : null}

      {tab === 'create' ? (
        <div className="a-row" style={{ alignItems: 'stretch', gap: 16, flexWrap: 'wrap' }}>
          <div className="a-card" style={{ flex: '1 1 420px', minWidth: 0 }}>
            <div className="a-h2" style={{ marginBottom: 12 }}>
              收款信息
            </div>
            <form onSubmit={(e) => void handleCreate(e)}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: 14,
                }}
              >
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="a-muted">合同编号 *</span>
                  <input
                    className="a-input"
                    style={{ minWidth: 0, width: '100%' }}
                    value={form.contractNo}
                    onChange={(e) => updateField('contractNo', e.target.value)}
                    placeholder="如 HT2026-001"
                    required
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="a-muted">账单编号</span>
                  <input
                    className="a-input"
                    style={{ minWidth: 0, width: '100%' }}
                    value={form.billNo}
                    onChange={(e) => updateField('billNo', e.target.value)}
                    placeholder="选填，如 ZD0000123456"
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="a-muted">租户姓名 *</span>
                  <input
                    className="a-input"
                    style={{ minWidth: 0, width: '100%' }}
                    value={form.tenantName}
                    onChange={(e) => updateField('tenantName', e.target.value)}
                    placeholder="付款人姓名"
                    required
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="a-muted">租户手机</span>
                  <input
                    className="a-input"
                    style={{ minWidth: 0, width: '100%' }}
                    value={form.tenantPhone}
                    onChange={(e) => updateField('tenantPhone', e.target.value)}
                    placeholder="选填"
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="a-muted">收款金额（元）*</span>
                  <input
                    className="a-input"
                    style={{ minWidth: 0, width: '100%' }}
                    type="number"
                    min={1}
                    step={1}
                    value={form.amount}
                    onChange={(e) => updateField('amount', e.target.value)}
                    placeholder="如 3500"
                    required
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="a-muted">费用类型</span>
                  <select
                    className="a-filter-select"
                    style={{ width: '100%', minHeight: 42 }}
                    value={form.feeType}
                    onChange={(e) => updateField('feeType', e.target.value as CreateForm['feeType'])}
                  >
                    {FEE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    gridColumn: '1 / -1',
                  }}
                >
                  <span className="a-muted">备注</span>
                  <input
                    className="a-input"
                    style={{ minWidth: 0, width: '100%' }}
                    value={form.remark}
                    onChange={(e) => updateField('remark', e.target.value)}
                    placeholder="选填，如账期、房号说明等"
                  />
                </label>
              </div>
              <div className="a-row" style={{ marginTop: 16, gap: 10 }}>
                <button type="submit" className="a-btn" disabled={creating}>
                  {creating ? '生成中…' : '生成二维码'}
                </button>
                <button
                  type="button"
                  className="a-btn ghost"
                  onClick={() => {
                    setForm(emptyForm())
                    setCreated(null)
                    setError('')
                    setMsg('')
                  }}
                >
                  清空
                </button>
              </div>
            </form>
          </div>

          <div className="a-card" style={{ flex: '1 1 320px', minWidth: 280, maxWidth: 420 }}>
            <div className="a-h2" style={{ marginBottom: 12 }}>
              付款二维码
            </div>
            {created ? (
              <QrPanel
                item={created}
                onCopy={copyText}
                onSimulate={(ch) => void simulatePay(created.id, ch)}
                onSaveQr={() => void handleSaveQr(created)}
                savingQr={savingQr}
                busy={busyId === created.id}
              />
            ) : (
              <div className="a-muted" style={{ padding: '40px 12px', textAlign: 'center', lineHeight: 1.6 }}>
                填写左侧信息并点击「生成二维码」后，将在此展示。
                <br />
                租户可用微信或支付宝扫码打开付款页完成支付。
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="a-card a-row">
            <div className="a-filterbar" style={{ flexWrap: 'wrap', gap: 8, width: '100%', alignItems: 'center' }}>
              <span className="a-filter-label">筛选</span>
              <input
                className="a-filter-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="流水号 / 合同 / 账单 / 租户 / 手机"
                style={{ minWidth: 220 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setPage(1)
                    void loadList(currentListOpts())
                  }
                }}
              />

              {tab === 'all' ? (
                <>
                  <span className="a-filter-label">时间维度</span>
                  <select
                    className="a-filter-select"
                    value={dateField}
                    onChange={(e) => setDateField(e.target.value as 'createdAt' | 'paidAt')}
                    title="按创建时间或付款时间筛选"
                  >
                    <option value="createdAt">创建时间</option>
                    <option value="paidAt">付款时间</option>
                  </select>
                  <input
                    className="a-filter-input"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    title="开始日期"
                  />
                  <span className="a-muted">至</span>
                  <input
                    className="a-filter-input"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    title="结束日期"
                  />
                  <button type="button" className="a-btn ghost" onClick={() => applyDatePreset('today')}>
                    今日
                  </button>
                  <button type="button" className="a-btn ghost" onClick={() => applyDatePreset('week')}>
                    本周
                  </button>
                  <button type="button" className="a-btn ghost" onClick={() => applyDatePreset('month')}>
                    本月
                  </button>
                </>
              ) : null}

              <button
                type="button"
                className="a-btn"
                onClick={() => {
                  setPage(1)
                  void loadList(currentListOpts())
                }}
              >
                查询
              </button>
              <button
                type="button"
                className="a-btn ghost"
                onClick={() => {
                  setQ('')
                  setDateFrom('')
                  setDateTo('')
                  setDateField('createdAt')
                  setPage(1)
                  void loadList({
                    status: tab === 'pending' ? 'PENDING' : tab === 'paid' ? 'PAID' : undefined,
                    withDate: tab === 'all',
                    qOverride: '',
                    dateFromOverride: '',
                    dateToOverride: '',
                    dateFieldOverride: 'createdAt',
                  })
                }}
              >
                重置
              </button>
              {tab === 'all' ? (
                <button
                  type="button"
                  className="a-btn"
                  disabled={!items.length}
                  onClick={exportCsv}
                  title="导出当前筛选结果为 CSV"
                >
                  导出
                </button>
              ) : null}
              {loading ? <span className="a-muted">加载中…</span> : null}
            </div>
          </div>

          <div className="a-card">
            <div className="a-table-wrap">
              <table className="a-table" style={{ width: '100%', minWidth: 960 }}>
                <thead>
                  <tr>
                    <th>流水号</th>
                    <th>创建时间</th>
                    <th>合同编号</th>
                    <th>账单编号</th>
                    <th>租户</th>
                    <th>费用类型</th>
                    <th>金额</th>
                    <th>状态</th>
                    <th>付款渠道</th>
                    <th>付款时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pageData.items.map((row) => (
                    <tr key={row.id}>
                      <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{row.displayNo}</td>
                      <td className="a-muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                        {fmtDt(row.createdAt)}
                      </td>
                      <td>{row.contractNo}</td>
                      <td className="a-muted">{row.billNo || '—'}</td>
                      <td>
                        <div>{row.tenantName}</div>
                        {row.tenantPhone ? (
                          <div className="a-muted" style={{ fontSize: 12 }}>
                            {row.tenantPhone}
                          </div>
                        ) : null}
                      </td>
                      <td>{row.feeTypeLabel}</td>
                      <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                        ¥{row.amount.toLocaleString()}
                      </td>
                      <td>
                        <span
                          style={{
                            color:
                              row.status === 'PAID'
                                ? '#047857'
                                : row.status === 'CANCELLED'
                                  ? '#64748b'
                                  : '#1d4ed8',
                            fontWeight: 700,
                          }}
                        >
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td className="a-muted">{channelLabel(row.payChannel)}</td>
                      <td className="a-muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                        {fmtDt(row.paidAt)}
                      </td>
                      <td>
                        <div className="a-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <button type="button" className="a-btn ghost" onClick={() => setQrDetail(row)}>
                            {row.status === 'PENDING' ? '二维码' : '详情'}
                          </button>
                          {row.status === 'PENDING' ? (
                            <>
                              <button
                                type="button"
                                className="a-btn ghost"
                                disabled={busyId === row.id}
                                onClick={() => void simulatePay(row.id, 'WECHAT')}
                                title="演示：模拟微信已付"
                              >
                                模拟微信付
                              </button>
                              <button
                                type="button"
                                className="a-btn ghost"
                                disabled={busyId === row.id}
                                onClick={() => void cancelPayment(row.id)}
                              >
                                取消
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pageData.items.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="a-muted">
                        {loading ? '加载中…' : '暂无记录'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <Pagination
              total={pageData.total}
              page={pageData.page}
              pageSize={pageSize}
              onChange={({ page: p, pageSize: ps }) => {
                setPage(p)
                setPageSize(ps)
              }}
            />
          </div>
        </>
      )}

      {qrDetail ? (
        <div className="a-modal-backdrop" onClick={() => setQrDetail(null)}>
          <div className="a-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-h2">{qrDetail.status === 'PENDING' ? '付款二维码' : '收款详情'}</div>
              <button type="button" className="a-icon-btn" aria-label="关闭" onClick={() => setQrDetail(null)}>
                ×
              </button>
            </div>
            <div className="a-modal-body">
              <QrPanel
                item={qrDetail}
                onCopy={copyText}
                onSimulate={(ch) => void simulatePay(qrDetail.id, ch)}
                onSaveQr={() => void handleSaveQr(qrDetail)}
                savingQr={savingQr}
                busy={busyId === qrDetail.id}
                onCancel={
                  qrDetail.status === 'PENDING' ? () => void cancelPayment(qrDetail.id) : undefined
                }
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function QrPanel(props: {
  item: LedgerPayment
  onCopy: (text: string, tip: string) => void
  onSimulate: (channel: 'WECHAT' | 'ALIPAY') => void
  onSaveQr: () => void
  savingQr?: boolean
  busy?: boolean
  onCancel?: () => void
}) {
  const { item, onCopy, onSimulate, onSaveQr, savingQr, busy, onCancel } = props
  return (
    <div>
      <div className="a-kv" style={{ marginBottom: 12 }}>
        <div className="a-kv-row">
          <div className="a-kv-k">流水号</div>
          <div className="a-kv-v" style={{ fontWeight: 800 }}>
            {item.displayNo}
          </div>
        </div>
        <div className="a-kv-row">
          <div className="a-kv-k">合同编号</div>
          <div className="a-kv-v">{item.contractNo}</div>
        </div>
        <div className="a-kv-row">
          <div className="a-kv-k">账单编号</div>
          <div className="a-kv-v">{item.billNo || '—'}</div>
        </div>
        <div className="a-kv-row">
          <div className="a-kv-k">租户</div>
          <div className="a-kv-v">
            {item.tenantName}
            {item.tenantPhone ? ` · ${item.tenantPhone}` : ''}
          </div>
        </div>
        <div className="a-kv-row">
          <div className="a-kv-k">费用类型</div>
          <div className="a-kv-v">{item.feeTypeLabel}</div>
        </div>
        <div className="a-kv-row">
          <div className="a-kv-k">金额</div>
          <div className="a-kv-v" style={{ fontWeight: 900, fontSize: 18, color: '#1d4ed8' }}>
            ¥{item.amount.toLocaleString()}
          </div>
        </div>
        <div className="a-kv-row">
          <div className="a-kv-k">状态</div>
          <div className="a-kv-v" style={{ fontWeight: 700 }}>
            {statusLabel(item.status)}
            {item.status === 'PAID' ? ` · ${channelLabel(item.payChannel)}` : ''}
          </div>
        </div>
        {item.remark ? (
          <div className="a-kv-row">
            <div className="a-kv-k">备注</div>
            <div className="a-kv-v">{item.remark}</div>
          </div>
        ) : null}
      </div>

      {item.status === 'PENDING' ? (
        <>
          <div className="a-bill-pay-qr-wrap">
            <img src={item.qrImageUrl} alt="付款二维码" crossOrigin="anonymous" />
          </div>
          <p className="a-muted" style={{ fontSize: 13, lineHeight: 1.5, textAlign: 'center' }}>
            请租户使用微信或支付宝扫一扫打开付款页。请确保手机能访问同一局域网下的 H5 地址。
          </p>
          <div className="a-bill-pay-qr-url">{item.payUrl}</div>
          <div className="a-row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="a-btn" onClick={() => onCopy(item.payUrl, '已复制付款链接')}>
              复制链接
            </button>
            <button type="button" className="a-btn" disabled={savingQr} onClick={onSaveQr}>
              {savingQr ? '保存中…' : '保存图片'}
            </button>
            <button
              type="button"
              className="a-btn ghost"
              disabled={busy}
              onClick={() => onSimulate('WECHAT')}
            >
              模拟微信支付
            </button>
            <button
              type="button"
              className="a-btn ghost"
              disabled={busy}
              onClick={() => onSimulate('ALIPAY')}
            >
              模拟支付宝
            </button>
            {onCancel ? (
              <button type="button" className="a-btn ghost" disabled={busy} onClick={onCancel}>
                取消收款
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="a-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
          {item.status === 'PAID'
            ? `已于 ${fmtDt(item.paidAt)} 通过${channelLabel(item.payChannel)}收款。`
            : `已取消${item.cancelReason ? `：${item.cancelReason}` : ''}（${fmtDt(item.cancelledAt)}）`}
        </div>
      )}
    </div>
  )
}
