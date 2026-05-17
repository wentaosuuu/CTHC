import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { apiGet, apiPost, getTenantPhone, type MyBillDetail } from '../api'
import { shortPayBlockedHint } from '../billPayHint'
import { buildMergedDemoBaseLineItems } from '../mergedDemoBill'

export function BillDetailPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const paySectionRef = useRef<HTMLDivElement | null>(null)
  const wantPay = searchParams.get('pay') === '1'
  const [data, setData] = useState<MyBillDetail | null>(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  /** 费用明细中可同时展开多行（按项目名称区分） */
  const [openItemNames, setOpenItemNames] = useState<Set<string>>(() => new Set())

  const displayRows = useMemo(() => {
    if (!data) return []
    const mergedMonthlyBase = Boolean(
      data.mergedUnits && data.mergedUnits.length > 1 && data.kind === 'BASE',
    )
    return buildDisplayItems(data.items, data.totalAmount, { mergedMonthlyBase })
  }, [data])

  const phone = getTenantPhone()

  async function load() {
    if (!id) return
    setError('')

    // 对于本地 Demo 账单，直接用前端内置的详情数据，避免 NOT_FOUND
    if (id.startsWith('DEMO-BILL-')) {
      setData(buildDemoBillDetail(id))
      return
    }

    if (!phone) return

    const r = await apiGet<MyBillDetail>(`/api/bills/${id}`, {
      headers: { 'x-tenant-phone': phone },
    })
    if (!r.ok) {
      // 若真实接口失败，退回到 Demo 详情，保证页面可用
      setError(r.error)
      setData(buildDemoBillDetail(id))
      return
    }
    setData(r.data)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, phone])

  useEffect(() => {
    setOpenItemNames(new Set())
  }, [id])

  useEffect(() => {
    if (!wantPay || !data || !canPayOnline(data)) return
    paySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [wantPay, data])

  async function pay() {
    if (!id || !phone) return
    setLoading(true)
    setMsg('')
    setError('')
    const r = await apiPost<{ ok: true; paidAt: string | null; status: string }>(
      `/api/bills/${id}/pay`,
      {},
      { headers: { 'x-tenant-phone': phone } },
    )
    setLoading(false)
    if (!r.ok) return setError(r.error)
    setMsg('支付成功，账单状态已更新。')
    await load()
  }

  if (!id) {
    return <div className="m-card m-error">缺少账单ID。</div>
  }

  return (
    <div className="m-col">
      <div className="m-card">
        <div className="m-h1">账单详情</div>
      </div>

      {error ? <div className="m-card m-error">加载失败：{error}</div> : null}
      {!error && !data ? <div className="m-card">加载中…</div> : null}

      {data ? (
        <>
          <div className="m-card">
            <div style={{ fontSize: 24, fontWeight: 900 }}>¥{data.totalAmount}</div>
            <div className="m-muted" style={{ marginTop: 4 }}>
              账期：{data.period} · 应缴日期：{data.dueDate}
            </div>
            {data.kind === 'ADJUSTMENT' ? (
              <div className="m-muted" style={{ marginTop: 4 }}>
                该账单为管理员导入生成的补缴情单（如水费/电费等）。
              </div>
            ) : null}
          </div>

          <div className="m-card">
            <div className="m-kv">
              <div className="m-k">状态</div>
              <div>{statusText(data.status)}</div>
              <div className="m-k">账单编号</div>
              <div>{data.id}</div>
              <div className="m-k">合同号</div>
              <div>{data.contractNo}</div>
              <div className="m-k">房源</div>
              <div>
                {data.mergedUnits && data.mergedUnits.length > 1 ? (
                  <div className="m-col" style={{ gap: 6 }}>
                    {data.mergedUnits.map((u) => (
                      <div key={`${u.apartmentName}-${u.houseNo}`}>
                        {u.apartmentName} · {u.houseNo}
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    {data.apartmentName} · {data.houseNo}
                  </>
                )}
              </div>
              <div className="m-k">门店</div>
              <div>{data.storeName}</div>
              <div className="m-k">租客</div>
              <div>
                {data.tenantName}（{data.tenantPhone}）
              </div>
              <div className="m-k">创建时间</div>
              <div>{new Date(data.createdAt).toLocaleString()}</div>
              <div className="m-k">支付时间</div>
              <div>{data.paidAt ? new Date(data.paidAt).toLocaleString() : '-'}</div>
            </div>
          </div>

          <div className="m-card">
            <div style={{ fontWeight: 900 }}>费用明细</div>
            <div className="m-muted" style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45 }}>
              本账单须一次性缴清下列全部收费项，不支持只付其中某一项。
            </div>
            <div style={{ height: 8 }} />
            <>
              <div
                className="m-row"
                style={{
                  justifyContent: 'space-between',
                  fontSize: 13,
                  color: '#64748b',
                  marginBottom: 4,
                }}
              >
                <div>项目</div>
                <div>金额</div>
              </div>
              <div className="m-col">
                {displayRows.map((it) => (
                  <div key={it.name} style={{ marginBottom: 6 }}>
                    <div className="m-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <div className="m-row" style={{ gap: 6, alignItems: 'center', flex: 1, minWidth: 0 }}>
                        {it.breakdown && it.breakdown.length > 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setOpenItemNames((prev) => {
                                const next = new Set(prev)
                                if (next.has(it.name)) next.delete(it.name)
                                else next.add(it.name)
                                return next
                              })
                            }
                            aria-expanded={openItemNames.has(it.name)}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              padding: '2px 6px',
                              cursor: 'pointer',
                              fontSize: 14,
                              color: '#64748b',
                            }}
                            title={openItemNames.has(it.name) ? '收起明细' : '展开明细'}
                          >
                            {openItemNames.has(it.name) ? '▾' : '▸'}
                          </button>
                        ) : (
                          <span style={{ width: 22, display: 'inline-block' }} />
                        )}
                        <div style={{ wordBreak: 'break-word' }}>{it.name}</div>
                      </div>
                      <div style={{ fontVariantNumeric: 'tabular-nums' }}>¥{it.amount}</div>
                    </div>
                    {it.breakdown && it.breakdown.length > 0 && openItemNames.has(it.name) ? (
                      <div className="m-col" style={{ paddingLeft: 28, marginTop: 4, gap: 4 }}>
                        {it.breakdown.map((b) => (
                          <div
                            key={b.label}
                            className="m-row"
                            style={{ justifyContent: 'space-between', fontSize: 13, color: '#64748b' }}
                          >
                            <div style={{ wordBreak: 'break-word', paddingRight: 8 }}>{b.label}</div>
                            <div style={{ fontVariantNumeric: 'tabular-nums' }}>¥{b.amount}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                <div
                  className="m-row"
                  style={{
                    justifyContent: 'space-between',
                    marginTop: 8,
                    borderTop: '1px solid #e2e8f0',
                    paddingTop: 6,
                    fontWeight: 700,
                  }}
                >
                  <div>总费用</div>
                  <div>¥{data.totalAmount}</div>
                </div>
              </div>
            </>
          </div>

          {msg ? (
            <div className="m-card">
              <div className="m-success">{msg}</div>
            </div>
          ) : null}

          {data.payBlockedReason ? (
            <div className="m-bill-pay-blocked m-bill-pay-blocked--card">
              {shortPayBlockedHint(data.payBlockedReason)}
            </div>
          ) : null}

          <div ref={paySectionRef}>
          <button
            className="m-btn m-btn-block"
            type="button"
            onClick={pay}
            disabled={loading || !canPayOnline(data)}
          >
            {canPayOnline(data) ? '立即支付' : data.payBlockedReason ? '请先结清旧欠' : '无需支付'}
          </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

function statusText(status: string) {
  if (status === 'UNPAID') return '待支付'
  if (status === 'PAID') return '已支付'
  if (status === 'OVERDUE') return '已逾期'
  return status
}

function canPay(status: string) {
  return status === 'UNPAID' || status === 'OVERDUE'
}

function canPayOnline(bill: { status: string; payBlockedReason?: string }) {
  return canPay(bill.status) && !bill.payBlockedReason
}

type BillRow = MyBillDetail['items'][number]

function buildDisplayItems(
  rawItems: BillRow[],
  totalAmount: number,
  opts?: { mergedMonthlyBase?: boolean },
): BillRow[] {
  if (opts?.mergedMonthlyBase) {
    return rawItems.map((it) => ({ ...it }))
  }
  // 单条「月账单」且 breakdown 已含各项费用时，直接展示，不再追加一堆 0 元预设行
  if (
    rawItems.length === 1 &&
    rawItems[0]!.breakdown &&
    rawItems[0]!.breakdown.length > 0 &&
    (rawItems[0]!.name.includes('月账单') ||
      rawItems[0]!.name.includes('房租') ||
      rawItems[0]!.name.includes('租金'))
  ) {
    return [{ ...rawItems[0]! }]
  }

  // 1. 优先处理“房租”相关项目：名称里包含“房租”或“租金”的都汇总到第一行
  const rentItems = rawItems.filter(
    (it) =>
      it.name.includes('房租') ||
      it.name.includes('租金') ||
      it.name.includes('月账单'),
  )
  const otherItems = rawItems.filter((it) => !rentItems.includes(it))

  const result: BillRow[] = []

  if (rentItems.length > 0) {
    const rentAmount = rentItems.reduce((s, it) => s + it.amount, 0)
    const rentBreakdown = rentItems.find((it) => it.breakdown && it.breakdown.length)?.breakdown
    result.push({
      name: rentItems[0].name,
      amount: rentAmount,
      ...(rentBreakdown?.length ? { breakdown: rentBreakdown } : {}),
    })
  } else if (rentItems.length === 0 && otherItems.length === 0 && totalAmount !== 0) {
    // 后端没拆明细时，默认认为「月账单 = 总金额」（总额可为负，如导入冲减）
    result.push({ name: '月账单', amount: totalAmount })
  }

  // 2. 常见收费项目（不含房租）：水费、电费、物业费、垃圾处理费、公摊电费、燃气费、网络费、滞纳金
  const presets = ['水费', '电费', '物业费', '垃圾处理费', '公摊电费', '燃气费', '网络费', '滞纳金']

  const map = new Map<string, number>()
  otherItems.forEach((it) => {
    const prev = map.get(it.name) ?? 0
    map.set(it.name, prev + it.amount)
  })

  presets.forEach((name) => {
    const v = map.has(name) ? map.get(name)! : 0
    result.push({ name, amount: v })
    if (map.has(name)) map.delete(name)
  })

  // 3. 后台其它自定义项目，排在最后
  map.forEach((v, k) => {
    result.push({ name: k, amount: v })
  })

  return result
}

function buildDemoBillDetail(id: string): MyBillDetail {
  const mergedUnits: { apartmentName: string; houseNo: string }[] = [
    { apartmentName: '江南·梧桐公寓', houseNo: '624' },
    { apartmentName: '西乡塘·青年社区', houseNo: '927' },
    { apartmentName: '邕宁·花园公寓', houseNo: '514' },
  ]
  const mMrg = /^DEMO-BILL-MRG-(\d{4}-\d{2})-(BASE|ADJ)$/.exec(id)
  if (mMrg) {
    const period = mMrg[1]
    const kind = mMrg[2] === 'ADJ' ? 'ADJUSTMENT' : 'BASE'
    const [yy, mm] = period.split('-').map((x) => parseInt(x, 10))
    const contractId = 'DEMO-CONTRACT-MRG'
    const contractNo = 'HT20260288118'
    const apartmentName = mergedUnits[0]!.apartmentName
    const houseNo = mergedUnits[0]!.houseNo
    const storeName = '南宁市-江南区'
    const tenantName = '陆晨'
    const tenantPhone = '13900001730'

    if (kind === 'ADJUSTMENT') {
      const water = 68
      const elec = 74
      const property = 44
      const total = water + elec + property
      return {
        id,
        period,
        dueDate: `${yy}-${String(mm).padStart(2, '0')}-22`,
        totalAmount: total,
        status: 'UNPAID',
        kind: 'ADJUSTMENT',
        paidAt: null,
        contractId,
        contractNo,
        apartmentName,
        houseNo,
        storeName,
        tenantName,
        tenantPhone,
        createdAt: new Date().toISOString(),
        mergedUnits,
        items: [
          { name: '水费', amount: water },
          { name: '电费', amount: elec },
          { name: '物业费', amount: property },
        ],
      }
    }

    const { items: mergedItems, totalAmount: mergedBaseTotal } = buildMergedDemoBaseLineItems()
    return {
      id,
      period,
      dueDate: `${yy}-${String(mm).padStart(2, '0')}-08`,
      totalAmount: mergedBaseTotal,
      status: 'UNPAID',
      kind: 'BASE',
      paidAt: null,
      contractId,
      contractNo,
      apartmentName,
      houseNo,
      storeName,
      tenantName,
      tenantPhone,
      createdAt: new Date().toISOString(),
      mergedUnits,
      items: mergedItems,
    }
  }

  const m = /^DEMO-BILL-(\d{4}-\d{2})-(BASE|ADJ)$/.exec(id)
  const period = m?.[1] ?? '2026-03'
  const kind = m?.[2] === 'ADJ' ? 'ADJUSTMENT' : 'BASE'

  const contractId = 'DEMO-CONTRACT-001'
  const contractNo = 'HT20260316001'
  const apartmentName = '良庆·悦居公寓'
  const houseNo = '330'
  const storeName = '南宁市-良庆区'
  const tenantName = '周宁'
  const tenantPhone = '13800000001'

  const [yy, mm] = period.split('-').map((x) => parseInt(x, 10))
  const dueDate = `${yy}-${String(mm).padStart(2, '0')}-05`

  if (kind === 'ADJUSTMENT') {
    const water = 47
    const elec = 92
    const property = 62
    const total = water + elec + property
    return {
      id,
      period,
      dueDate: `${yy}-${String(mm).padStart(2, '0')}-20`,
      totalAmount: total,
      status: 'UNPAID',
      kind: 'ADJUSTMENT',
      paidAt: null,
      contractId,
      contractNo,
      apartmentName,
      houseNo,
      storeName,
      tenantName,
      tenantPhone,
      createdAt: new Date().toISOString(),
      items: [
        { name: '水费', amount: water },
        { name: '电费', amount: elec },
        { name: '物业费', amount: property },
      ],
    }
  }

  const rentMonthly = 4200
  const water = 72
  const elec = 118
  const property = 55
  const garbage = 28
  const sharedElec = 32
  const gas = 18
  const net = 36
  const late = 0
  const baseTotal =
    rentMonthly + water + elec + property + garbage + sharedElec + gas + net + late
  return {
    id,
    period,
    dueDate,
    totalAmount: baseTotal,
    status: 'UNPAID',
    kind: 'BASE',
    paidAt: null,
    contractId,
    contractNo,
    apartmentName,
    houseNo,
    storeName,
    tenantName,
    tenantPhone,
    createdAt: new Date().toISOString(),
    items: [
      {
        name: `月账单（${period}）`,
        amount: baseTotal,
        breakdown: [
          { label: '月租', amount: rentMonthly },
          { label: '水费', amount: water },
          { label: '电费', amount: elec },
          { label: '物业费', amount: property },
          { label: '垃圾处理费', amount: garbage },
          { label: '公摊电费', amount: sharedElec },
          { label: '燃气费', amount: gas },
          { label: '网络费', amount: net },
          ...(late > 0 ? [{ label: '滞纳金' as const, amount: late }] : []),
        ],
      },
    ],
  }
}


