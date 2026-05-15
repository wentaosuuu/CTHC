import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiGet, apiPost, getTenantPhone, type MyBillDetail } from '../api'

export function BillDetailPage() {
  const { id } = useParams()
  const [data, setData] = useState<MyBillDetail | null>(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

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
    setMsg('支付成功（模拟），账单状态已更新为“已支付”。')
    await load()
  }

  if (!id) {
    return <div className="m-card m-error">缺少账单ID。</div>
  }

  return (
    <div className="m-col">
      <div className="m-card">
        <div className="m-h1">账单详情</div>
        <div className="m-muted">当前为演示版，支付结果为模拟成功。</div>
      </div>

      {error ? <div className="m-card m-error">加载失败：{error}</div> : null}
      {!error && !data ? <div className="m-card">加载中…</div> : null}

      {data ? (
        <>
          {/*
            根据后端返回的明细 + 预设项目，生成完整展示列表（即便金额为 0 也展示）
          */}
          {(() => {
            displayItems = buildDisplayItems(data.items, data.totalAmount)
            return null
          })()}
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
                {data.apartmentName} · {data.houseNo}
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
                {displayItems.map((it) => (
                  <div
                    key={it.name}
                    className="m-row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <div>{it.name}</div>
                    <div>¥{it.amount}</div>
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

          <button
            className="m-btn m-btn-block"
            type="button"
            onClick={pay}
            disabled={loading || !canPay(data.status)}
          >
            {canPay(data.status) ? '立即支付（模拟）' : '无需支付'}
          </button>
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

type BillItem = { name: string; amount: number }

let displayItems: BillItem[] = []

function buildDisplayItems(rawItems: BillItem[], totalAmount: number): BillItem[] {
  // 1. 优先处理“房租”相关项目：名称里包含“房租”或“租金”的都汇总到第一行
  const rentItems = rawItems.filter((it) => it.name.includes('房租') || it.name.includes('租金'))
  const otherItems = rawItems.filter((it) => !rentItems.includes(it))

  const result: BillItem[] = []

  if (rentItems.length > 0) {
    const rentAmount = rentItems.reduce((s, it) => s + it.amount, 0)
    // 为了保留账期信息，名称用第一条的 name，比如“房租（2026-03）”
    result.push({ name: rentItems[0].name, amount: rentAmount })
  } else if (totalAmount > 0) {
    // 后端没拆明细时，默认认为“房租 = 总金额”
    result.push({ name: '房租', amount: totalAmount })
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
  // 新版 Demo：根据账单 ID 规则自动生成明细
  // - BASE：租金固定，水电等不确定费用先为 0（但依旧展示）
  // - ADJ：补缴情单（只含水电等）
  const m = /^DEMO-BILL-(\d{4}-\d{2})-(BASE|ADJ)$/.exec(id)
  const period = m?.[1] ?? '2026-03'
  const kind = m?.[2] === 'ADJ' ? 'ADJUSTMENT' : 'BASE'

  const contractId = 'DEMO-CONTRACT-001'
  const contractNo = 'HT20260316001'
  const apartmentName = '良庆·悦居公寓'
  const houseNo = '330'
  const storeName = '南宁市-良庆区'
  const tenantName = '张三'
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
  return {
    id,
    period,
    dueDate,
    totalAmount: rentMonthly,
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
      { name: `房租（${period}）`, amount: rentMonthly },
      { name: '水费', amount: 0 },
      { name: '电费', amount: 0 },
      { name: '物业费', amount: 0 },
      { name: '垃圾处理费', amount: 0 },
      { name: '公摊电费', amount: 0 },
      { name: '燃气费', amount: 0 },
      { name: '网络费', amount: 0 },
      { name: '滞纳金', amount: 0 },
    ],
  }
}


