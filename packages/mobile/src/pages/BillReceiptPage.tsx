import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiGet, getTenantPhone, type MyBillReceiptView } from '../api'
import { buildMergedDemoBaseLineItems, demoPeriodHasReceipt } from '../mergedDemoBill'

export function BillReceiptPage() {
  const { id } = useParams()
  const phone = getTenantPhone()
  const [data, setData] = useState<MyBillReceiptView | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      if (!id) return
      setError('')

      if (id.startsWith('DEMO-BILL-')) {
        const demo = buildDemoBillReceipt(id)
        if (!demo) {
          setError('该账单暂无可用收据')
          setData(null)
          return
        }
        setData(demo)
        return
      }

      if (!phone) {
        setError('请先登录租客账号')
        return
      }

      const r = await apiGet<MyBillReceiptView>(`/api/bills/${id}/receipt`, {
        headers: { 'x-tenant-phone': phone },
      })
      if (!r.ok) {
        setError(r.error === 'RECEIPT_NOT_AVAILABLE' ? '该账单暂无可用收据' : r.error)
        setData(null)
        return
      }
      setData(r.data)
    }
    load()
  }, [id, phone])

  if (!id) {
    return <div className="m-card m-error">缺少账单ID。</div>
  }

  return (
    <div className="m-col">
      <div className="m-card">
        <div className="m-h1">收款收据</div>
        <div className="m-muted" style={{ marginTop: 4 }}>
          对应后台交易流水已导出的收据（正式套打文件接入前为预览）。
        </div>
      </div>

      {error ? <div className="m-card m-error">{error}</div> : null}
      {!error && !data ? <div className="m-card">加载中…</div> : null}

      {data
        ? data.receipts.map((rcpt, idx) => (
            <div key={rcpt.transactionId} className="m-card m-receipt-sheet">
              {data.receipts.length > 1 ? (
                <div className="m-muted" style={{ marginBottom: 8, fontSize: 13 }}>
                  收据 {idx + 1} / {data.receipts.length}
                </div>
              ) : null}
              <div className="m-receipt-title">{rcpt.receiptKindLabel}</div>
              <div className="m-receipt-amount">¥{data.totalAmount}</div>
              <div className="m-kv" style={{ marginTop: 12 }}>
                <div className="m-k">流水号</div>
                <div>{rcpt.txNo}</div>
                <div className="m-k">支付渠道</div>
                <div>{rcpt.channel === 'ONLINE' ? '线上支付' : '线下收款'}</div>
                <div className="m-k">开具时间</div>
                <div>{rcpt.printedAt ? new Date(rcpt.printedAt).toLocaleString() : '—'}</div>
                <div className="m-k">账期</div>
                <div>{data.period}</div>
                <div className="m-k">应缴日期</div>
                <div>{data.dueDate}</div>
                <div className="m-k">支付时间</div>
                <div>{data.paidAt ? new Date(data.paidAt).toLocaleString() : '—'}</div>
                <div className="m-k">合同号</div>
                <div>{data.contractNo}</div>
                <div className="m-k">房源</div>
                <div>
                  {data.mergedUnits && data.mergedUnits.length > 1 ? (
                    <div className="m-col" style={{ gap: 4 }}>
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
              </div>

              <div style={{ fontWeight: 800, marginTop: 14, marginBottom: 8 }}>费用明细</div>
              <div className="m-col" style={{ gap: 6 }}>
                {data.items.map((it) => (
                  <div key={it.name} className="m-row" style={{ justifyContent: 'space-between' }}>
                    <div style={{ wordBreak: 'break-word', paddingRight: 8 }}>{it.name}</div>
                    <div style={{ fontVariantNumeric: 'tabular-nums' }}>¥{it.amount}</div>
                  </div>
                ))}
                <div
                  className="m-row"
                  style={{
                    justifyContent: 'space-between',
                    marginTop: 4,
                    borderTop: '1px solid #e2e8f0',
                    paddingTop: 8,
                    fontWeight: 700,
                  }}
                >
                  <div>合计</div>
                  <div>¥{data.totalAmount}</div>
                </div>
              </div>
            </div>
          ))
        : null}

      <Link className="m-btn m-btn-block ghost" to={`/bills/${encodeURIComponent(id)}`}>
        返回账单详情
      </Link>
    </div>
  )
}

function buildDemoBillReceipt(id: string): MyBillReceiptView | null {
  const mMrg = /^DEMO-BILL-MRG-(\d{4}-\d{2})-(BASE|ADJ)$/.exec(id)
  if (mMrg) {
    const period = mMrg[1]
    const kind = mMrg[2] === 'ADJ' ? 'ADJUSTMENT' : 'BASE'
    if (!demoPeriodHasReceipt(period)) return null

    const mergedUnits = [
      { apartmentName: '江南·梧桐公寓', houseNo: '624' },
      { apartmentName: '西乡塘·青年社区', houseNo: '927' },
      { apartmentName: '邕宁·花园公寓', houseNo: '514' },
    ]
    const [yy, mm] = period.split('-').map((x) => parseInt(x, 10))
    const paidAt = new Date(yy, mm - 1, 6, 10, 28, 0).toISOString()
    const printedAt = new Date(yy, mm - 1, 6, 16, 5, 0).toISOString()

    if (kind === 'ADJUSTMENT') {
      const items = [
        { name: '水费', amount: 68 },
        { name: '电费', amount: 74 },
        { name: '物业费', amount: 44 },
      ]
      const totalAmount = items.reduce((s, x) => s + x.amount, 0)
      return {
        billId: id,
        period,
        dueDate: `${period}-22`,
        totalAmount,
        paidAt,
        contractNo: 'HT20260288118',
        apartmentName: mergedUnits[0]!.apartmentName,
        houseNo: mergedUnits[0]!.houseNo,
        storeName: '南宁市-江南区',
        tenantName: '陆晨',
        tenantPhone: '13900001730',
        mergedUnits,
        items,
        receipts: [
          {
            transactionId: `bill_${id}`,
            txNo: `TXP${id.slice(-10)}`,
            receiptKind: 'RENT',
            receiptKindLabel: '租金收据',
            printedAt,
            channel: 'ONLINE',
          },
        ],
      }
    }

    const { items, totalAmount } = buildMergedDemoBaseLineItems()
    return {
      billId: id,
      period,
      dueDate: `${period}-08`,
      totalAmount,
      paidAt,
      contractNo: 'HT20260288118',
      apartmentName: mergedUnits[0]!.apartmentName,
      houseNo: mergedUnits[0]!.houseNo,
      storeName: '南宁市-江南区',
      tenantName: '陆晨',
      tenantPhone: '13900001730',
      mergedUnits,
      items,
      receipts: [
        {
          transactionId: `bill_${id}`,
          txNo: `TXP${id.slice(-10)}`,
          receiptKind: 'RENT',
          receiptKindLabel: '租金收据',
          printedAt,
          channel: 'ONLINE',
        },
      ],
    }
  }

  const m = /^DEMO-BILL-(\d{4}-\d{2})-(BASE|ADJ)$/.exec(id)
  if (!m) return null
  const period = m[1]
  const kind = m[2] === 'ADJ' ? 'ADJUSTMENT' : 'BASE'
  if (!demoPeriodHasReceipt(period)) return null

  const [yy, mm] = period.split('-').map((x) => parseInt(x, 10))
  const paidAt = new Date(yy, mm - 1, 4, 11, 12, 0).toISOString()
  const printedAt = new Date(yy, mm - 1, 4, 15, 40, 0).toISOString()

  if (kind === 'ADJUSTMENT') {
    const items = [
      { name: '水费', amount: 47 },
      { name: '电费', amount: 92 },
      { name: '物业费', amount: 62 },
    ]
    const totalAmount = items.reduce((s, x) => s + x.amount, 0)
    return {
      billId: id,
      period,
      dueDate: `${period}-20`,
      totalAmount,
      paidAt,
      contractNo: 'HT20260316001',
      apartmentName: '良庆·悦居公寓',
      houseNo: '330',
      storeName: '南宁市-良庆区',
      tenantName: '周宁',
      tenantPhone: '13800000001',
      items,
      receipts: [
        {
          transactionId: `bill_${id}`,
          txNo: `TXP${id.slice(-10)}`,
          receiptKind: 'RENT',
          receiptKindLabel: '租金收据',
          printedAt,
          channel: 'ONLINE',
        },
      ],
    }
  }

  const rentMonthly = 4200
  const extras = [
    { label: '水费', amount: 72 },
    { label: '电费', amount: 118 },
    { label: '物业费', amount: 55 },
    { label: '垃圾处理费', amount: 28 },
    { label: '公摊电费', amount: 32 },
    { label: '燃气费', amount: 18 },
    { label: '网络费', amount: 36 },
  ]
  const totalAmount = rentMonthly + extras.reduce((s, x) => s + x.amount, 0)
  return {
    billId: id,
    period,
    dueDate: `${period}-05`,
    totalAmount,
    paidAt,
    contractNo: 'HT20260316001',
    apartmentName: '良庆·悦居公寓',
    houseNo: '330',
    storeName: '南宁市-良庆区',
    tenantName: '周宁',
    tenantPhone: '13800000001',
    items: [
      {
        name: `月账单（${period}）`,
        amount: totalAmount,
        breakdown: [{ label: '月租', amount: rentMonthly }, ...extras],
      },
    ],
    receipts: [
      {
        transactionId: `bill_${id}`,
        txNo: `TXP${id.slice(-10)}`,
        receiptKind: 'RENT',
        receiptKindLabel: '租金收据',
        printedAt,
        channel: 'ONLINE',
      },
    ],
  }
}
