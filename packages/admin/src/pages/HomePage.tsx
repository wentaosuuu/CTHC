import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  LabelList,
} from 'recharts'
import { apiGet } from '../api'

type Stat = {
  houses: number
  orders: number
  contracts: number
  bills: number
  overdueBills: number
}

type HouseMini = { isPublished: boolean; status: string }

type BillMini = { dueDate: string; totalAmount: number; status: string }

type TrendPoint = {
  label: string
  房源: number
  订单: number
  合同: number
  账单: number
}

type RateTrendPoint = {
  label: string
  出租率: number
  空置率: number
  收缴率: number
  累计收缴率: number
}

type TimePreset = 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'custom'

function getRangeForPreset(preset: TimePreset, customStart?: string, customEnd?: string): { start: Date; end: Date } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let end = new Date(today)
  let start = new Date(today)

  switch (preset) {
    case 'yesterday':
      start.setDate(start.getDate() - 1)
      break
    case 'thisWeek':
      start.setDate(start.getDate() - 6)
      break
    case 'lastWeek':
      start.setDate(start.getDate() - 13)
      end.setDate(end.getDate() - 7)
      break
    case 'thisMonth':
      start.setDate(1)
      break
    case 'custom':
      if (customStart && customEnd) {
        start = new Date(customStart)
        end = new Date(customEnd)
        if (start.getTime() > end.getTime()) [start, end] = [end, start]
      }
      break
  }
  return { start, end }
}

function formatLabel(d: Date, preset: TimePreset): string {
  if (preset === 'yesterday') {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    return d.getTime() === yesterday.getTime() ? '昨日' : '今日'
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 根据当前统计量与时间范围生成趋势数据（模拟） */
function buildTrendData(
  stat: Stat,
  range: { start: Date; end: Date },
  preset: TimePreset
): TrendPoint[] {
  const result: TrendPoint[] = []
  const start = new Date(range.start)
  const end = new Date(range.end)
  const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
  const totalDays = Math.min(Math.max(days, 1), 31)

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    if (d.getTime() > end.getTime()) break
    const ratio = totalDays <= 1 ? 1 : 0.5 + (0.5 * (i + 1)) / totalDays
    result.push({
      label: formatLabel(d, preset),
      房源: Math.max(0, Math.round(stat.houses * (0.6 + 0.4 * ratio))),
      订单: Math.max(0, Math.round(stat.orders * (0.55 + 0.45 * ratio))),
      合同: Math.max(0, Math.round(stat.contracts * (0.55 + 0.45 * ratio))),
      账单: Math.max(0, Math.round(stat.bills * (0.5 + 0.5 * ratio))),
    })
  }
  if (preset === 'yesterday' && result.length === 1) {
    const today = new Date(range.start)
    today.setDate(today.getDate() + 1)
    result.push({
      label: '今日',
      房源: stat.houses,
      订单: stat.orders,
      合同: stat.contracts,
      账单: stat.bills,
    })
  }
  return result
}

const PRESETS: { key: TimePreset; label: string }[] = [
  { key: 'yesterday', label: '昨日' },
  { key: 'thisWeek', label: '本周' },
  { key: 'lastWeek', label: '上周' },
  { key: 'thisMonth', label: '本月' },
  { key: 'custom', label: '自定义' },
]

const CHART_COLORS = {
  房源: '#2563eb',
  订单: '#0ea5e9',
  合同: '#22c55e',
  账单: '#f59e0b',
}

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function clampRate(raw: number, min = 0.02, max = 0.98) {
  if (!Number.isFinite(raw)) return raw
  return Math.min(max, Math.max(min, raw))
}

function hash01(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000
}

export function HomePage() {
  const [stat, setStat] = useState<Stat | null>(null)
  const [housesMini, setHousesMini] = useState<HouseMini[]>([])
  const [billsMini, setBillsMini] = useState<BillMini[]>([])
  const [error, setError] = useState('')
  const [timePreset, setTimePreset] = useState<TimePreset>('thisMonth')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [houses, orders, contracts, overdue, bills] = await Promise.all([
          apiGet<{ items: HouseMini[] }>('/api/admin/houses'),
          apiGet<{ items: unknown[] }>('/api/admin/orders'),
          apiGet<{ items: unknown[] }>('/api/admin/contracts'),
          apiGet<{ items: unknown[]; rule: string }>('/api/admin/bills/overdue'),
          apiGet<{ items: BillMini[] }>('/api/admin/bills'),
        ])
        if (!houses.ok || !orders.ok || !contracts.ok || !overdue.ok || !bills.ok) {
          const err =
            !houses.ok
              ? houses.error
              : !orders.ok
                ? orders.error
                : !contracts.ok
                  ? contracts.error
                  : !overdue.ok
                    ? overdue.error
                    : !bills.ok
                      ? bills.error
                      : '加载失败'
          throw new Error(err)
        }
        setStat({
          houses: houses.data.items.length,
          orders: orders.data.items.length,
          contracts: contracts.data.items.length,
          bills: bills.data.items.length,
          overdueBills: overdue.data.items.length,
        })
        setHousesMini(houses.data.items)
        setBillsMini(bills.data.items)
      } catch (e: unknown) {
        setError((e as Error)?.message || '加载失败')
      }
    }
    load()
  }, [])

  function toDate(ymd: string): Date {
    // ymd: YYYY-MM-DD
    const [y, m, d] = ymd.split('-').map((x) => Number(x))
    return new Date(y, (m ?? 1) - 1, d ?? 1)
  }

  function formatPct(v: number): string {
    if (!Number.isFinite(v)) return '-'
    // 展示习惯：尽量避免极值 0% / 100%，且显示更“常规”
    return `${(Math.round(v * 1000) / 10).toFixed(1)}%`
  }

  const range = useMemo(() => {
    return getRangeForPreset(timePreset, customStart || undefined, customEnd || undefined)
  }, [timePreset, customStart, customEnd])

  const trendData = useMemo(() => {
    if (!stat) return []
    return buildTrendData(stat, range, timePreset)
  }, [stat, range, timePreset])

  const rentalRate = useMemo(() => {
    const published = housesMini.filter((h) => h.isPublished)
    const total = published.length
    if (total === 0) return null
    const occupied = published.filter((h) => h.status !== 'VACANT').length
    return clampRate(occupied / total)
  }, [housesMini])

  const vacancyRate = useMemo(() => {
    // 保持与出租率互补，避免两端分别钳制造成“不相加为 100%”
    if (rentalRate == null) return null
    return 1 - rentalRate
  }, [housesMini])

  const collectionRate = useMemo(() => {
    if (!billsMini.length) return null
    const start = range.start.getTime()
    const end = range.end.getTime()
    const inRange = billsMini.filter((b) => {
      if (!b.dueDate) return false
      const t = toDate(b.dueDate).getTime()
      return t >= start && t <= end
    })
    const dueSum = inRange.reduce((s, b) => s + (b.totalAmount ?? 0), 0)
    if (dueSum <= 0) return null
    const paidSum = inRange.filter((b) => b.status === 'PAID').reduce((s, b) => s + (b.totalAmount ?? 0), 0)
    return clampRate(paidSum / dueSum)
  }, [billsMini, range])

  const cumulativeCollectionRate = useMemo(() => {
    if (!billsMini.length) return null
    const end = range.end.getTime()
    const upto = billsMini.filter((b) => {
      if (!b.dueDate) return false
      const t = toDate(b.dueDate).getTime()
      return t <= end
    })
    const dueSum = upto.reduce((s, b) => s + (b.totalAmount ?? 0), 0)
    if (dueSum <= 0) return null
    const paidSum = upto.filter((b) => b.status === 'PAID').reduce((s, b) => s + (b.totalAmount ?? 0), 0)
    return clampRate(paidSum / dueSum)
  }, [billsMini, range])

  const rateTrendData = useMemo<RateTrendPoint[]>(() => {
    // demo 趋势：围绕当前计算值做“可解释的”小幅波动，累计收缴率保持缓慢上升
    const baseRental = rentalRate ?? 0.86
    const baseCollection = collectionRate ?? 0.91
    const baseCum = cumulativeCollectionRate ?? 0.88

    const start = new Date(range.start)
    const end = new Date(range.end)
    const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
    const totalDays = Math.min(Math.max(days, 1), 31)

    const out: RateTrendPoint[] = []
    for (let i = 0; i < totalDays; i += 1) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      if (d.getTime() > end.getTime()) break

      const label = formatLabel(d, timePreset)
      // 让曲线更有“可视化变化”，便于演示：周期波动（周内/半月）+ 轻微随机扰动（可复现）
      const progress = totalDays <= 1 ? 1 : i / (totalDays - 1)
      const waveWeekly = Math.sin(progress * Math.PI * 2) * 0.07
      const waveHalfMonth = Math.cos(progress * Math.PI) * 0.04
      const noiseRental = (hash01(`${label}-${i}`) - 0.5) * 0.08 // ±4%
      const noiseCollection = (hash01(`c-${label}-${i}`) - 0.5) * 0.1 // ±5%
      const spike = (hash01(`sp-${label}-${i}`) > 0.92 ? -0.06 : 0) + (hash01(`sp2-${label}-${i}`) < 0.08 ? 0.04 : 0)

      const rental = clampRate(baseRental + waveWeekly + waveHalfMonth + noiseRental, 0.58, 0.96)
      const vacancy = clampRate(1 - rental, 0.02, 0.45)

      const collection = clampRate(baseCollection + waveWeekly * 0.6 + noiseCollection + spike, 0.62, 0.97)
      // 累计收缴率：缓慢爬升 + 轻微波动（不会剧烈跳）
      const cumStart = clampRate(Math.min(baseCum - 0.08, baseCum * 0.9), 0.5, 0.95)
      const cum = clampRate(
        cumStart + (baseCum - cumStart) * (0.25 + 0.75 * (i + 1) / totalDays) + waveHalfMonth * 0.15,
        0.5,
        0.98,
      )

      out.push({
        label,
        出租率: rental,
        空置率: vacancy,
        收缴率: collection,
        累计收缴率: cum,
      })
    }
    return out
  }, [rentalRate, collectionRate, cumulativeCollectionRate, range, timePreset])

  const applyPreset = (preset: TimePreset) => {
    setTimePreset(preset)
    const r = preset === 'custom' ? getRangeForPreset('thisMonth') : getRangeForPreset(preset)
    setCustomStart(toYmd(r.start))
    setCustomEnd(toYmd(r.end))
  }

  const rangeLabel = useMemo(() => {
    if (timePreset === 'custom' && customStart && customEnd) return `${customStart} 至 ${customEnd}`
    return `${toYmd(range.start)} 至 ${toYmd(range.end)}`
  }, [timePreset, customStart, customEnd, range])

  const showRateTrend = rateTrendData.length > 0
  const showStatTrend = Boolean(stat && trendData.length > 0)

  return (
    <div className="a-col" style={{ width: '100%', minWidth: 0 }}>
      {error ? (
        <div className="a-card" style={{ borderColor: '#f87171', background: 'rgba(248,113,113,0.08)' }}>
          加载失败：{error}
        </div>
      ) : null}

      {/* 全局时间维度筛选：统一控制本页所有指标与图表 */}
      <div className="a-card" style={{ overflow: 'hidden' }}>
        <div className="a-row" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <span className="a-h2" style={{ margin: 0 }}>时间维度</span>
          {PRESETS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={timePreset === key ? 'a-btn' : 'a-btn ghost'}
              style={{ padding: '6px 10px', fontSize: 13 }}
              onClick={() => applyPreset(key)}
            >
              {label}
            </button>
          ))}
          <span className="a-muted" style={{ fontSize: 12 }}>{rangeLabel}</span>

          {timePreset === 'custom' ? (
            <div className="a-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="date"
                className="a-filter-input"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                style={{ width: 130 }}
              />
              <span className="a-muted">至</span>
              <input
                type="date"
                className="a-filter-input"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                style={{ width: 130 }}
              />
            </div>
          ) : null}
        </div>
        <div className="a-muted" style={{ fontSize: 12, marginTop: 8 }}>
          说明：本页所有比例指标与趋势图均按该时间范围统计（demo 口径）。
        </div>
      </div>

      {/* 核心指标卡片：统一高度 */}
      <div className="a-row a-row-stat-cards" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div
          className="a-card stat-card"
          style={{ minHeight: 108, height: 108, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden' }}
        >
          <div className="a-muted">房源数</div>
          <div style={{ fontSize: 24, fontWeight: 900 }}>{stat ? stat.houses : '-'}</div>
          <div className="a-muted stat-card-desc">来自资产系统同步的在管房源</div>
        </div>
        <div
          className="a-card stat-card"
          style={{ minHeight: 108, height: 108, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden' }}
        >
          <div className="a-muted">订单数</div>
          <div style={{ fontSize: 24, fontWeight: 900 }}>{stat ? stat.orders : '-'}</div>
          <div className="a-muted stat-card-desc">租客在 H5 发起的租房订单</div>
        </div>
        <div
          className="a-card stat-card"
          style={{ minHeight: 108, height: 108, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden' }}
        >
          <div className="a-muted">合同数</div>
          <div style={{ fontSize: 24, fontWeight: 900 }}>{stat ? stat.contracts : '-'}</div>
          <div className="a-muted stat-card-desc">已生成的租赁合同（含待支付/生效/终止等）</div>
        </div>
        <div
          className="a-card stat-card"
          style={{ minHeight: 108, height: 108, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden' }}
        >
          <div className="a-muted">账单数</div>
          <div style={{ fontSize: 24, fontWeight: 900 }}>{stat ? stat.bills : '-'}</div>
          <div className="a-muted stat-card-desc">已生成租金账单</div>
        </div>
        <div
          className="a-card stat-card"
          style={{
            minHeight: 108,
            height: 108,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            overflow: 'hidden',
            borderColor: stat?.overdueBills ? '#f87171' : undefined,
          }}
        >
          <div className="a-muted">逾期账单</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: stat?.overdueBills ? '#b91c1c' : undefined }}>
            {stat ? stat.overdueBills : '-'}
          </div>
          <div className="a-muted stat-card-desc">已超到期日未完全支付的账单</div>
        </div>
      </div>

      {/* 经营率指标：出租率/收缴率/空置率 */}
      <div className="a-row a-row-stat-cards" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="a-card stat-card" style={{ minHeight: 108, height: 108, justifyContent: 'space-between' }}>
          <div>
            <div className="a-muted">出租率</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{rentalRate == null ? '-' : formatPct(rentalRate)}</div>
          </div>
          <div className="a-muted stat-card-desc">已发布房源中：非「空置」占比</div>
        </div>

        <div className="a-card stat-card" style={{ minHeight: 108, height: 108, justifyContent: 'space-between' }}>
          <div>
            <div className="a-muted">空置率</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{vacancyRate == null ? '-' : formatPct(vacancyRate)}</div>
          </div>
          <div className="a-muted stat-card-desc">已发布房源中：VACANT 占比（demo 口径）</div>
        </div>

        <div className="a-card stat-card" style={{ minHeight: 108, height: 108, justifyContent: 'space-between' }}>
          <div>
            <div className="a-muted">收缴率</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{collectionRate == null ? '-' : formatPct(collectionRate)}</div>
          </div>
          <div className="a-muted stat-card-desc">当前时间范围内：PAID 金额 / 应收金额（demo 口径）</div>
        </div>

        <div className="a-card stat-card" style={{ minHeight: 108, height: 108, justifyContent: 'space-between' }}>
          <div>
            <div className="a-muted">累计收缴率</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>
              {cumulativeCollectionRate == null ? '-' : formatPct(cumulativeCollectionRate)}
            </div>
          </div>
          <div className="a-muted stat-card-desc">截至当前范围结束：PAID 金额 / 累计应收金额</div>
        </div>
      </div>

      {/* 两块图表：左右排列（宽屏），窄屏自动上下 */}
      {showRateTrend || showStatTrend ? (
        <div className="a-dashboard-charts">
          {/* 经营指标趋势（领导偏爱可视化折线/柱状） */}
          {showRateTrend ? (
            <div className="a-card" style={{ overflow: 'hidden' }}>
              <div className="a-h2" style={{ marginBottom: 8, fontSize: 14 }}>出租率 / 空置率</div>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rateTrendData} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#64748b" />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      stroke="#64748b"
                      domain={[0, 1]}
                      tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0' }}
                      formatter={(v: number) => [formatPct(v), '']}
                      labelFormatter={(label) => `时间：${label}`}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="出租率" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="空置率" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="a-h2" style={{ marginBottom: 8, marginTop: 14, fontSize: 14 }}>收缴率 / 累计收缴率</div>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rateTrendData} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#64748b" />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      stroke="#64748b"
                      domain={[0, 1]}
                      tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0' }}
                      formatter={(v: number) => [formatPct(v), '']}
                      labelFormatter={(label) => `时间：${label}`}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="收缴率" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="累计收缴率" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}

          {/* 趋势图 */}
          {showStatTrend ? (
            <div className="a-card" style={{ overflow: 'hidden' }}>
              <div className="a-h2" style={{ marginBottom: 8, fontSize: 14 }}>房源数</div>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData} margin={{ top: 24, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#64748b" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#64748b" allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0' }}
                      formatter={(value: number) => [value, '房源数']}
                      labelFormatter={(label) => `时间：${label}`}
                    />
                    <Bar dataKey="房源" fill={CHART_COLORS.房源} name="房源数" radius={[4, 4, 0, 0]}>
                      <LabelList dataKey="房源" position="top" style={{ fontSize: 11, fontWeight: 700 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="a-h2" style={{ marginBottom: 8, marginTop: 16, fontSize: 14 }}>订单 / 合同 / 账单</div>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 24, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#64748b" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#64748b" allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0' }}
                      labelFormatter={(label) => `时间：${label}`}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="订单" stroke={CHART_COLORS.订单} strokeWidth={2} dot={{ r: 4 }} name="订单数">
                      <LabelList dataKey="订单" position="top" style={{ fontSize: 10, fontWeight: 700 }} />
                    </Line>
                    <Line type="monotone" dataKey="合同" stroke={CHART_COLORS.合同} strokeWidth={2} dot={{ r: 4 }} name="合同数">
                      <LabelList dataKey="合同" position="top" style={{ fontSize: 10, fontWeight: 700 }} />
                    </Line>
                    <Line type="monotone" dataKey="账单" stroke={CHART_COLORS.账单} strokeWidth={2} dot={{ r: 4 }} name="账单数">
                      <LabelList dataKey="账单" position="top" style={{ fontSize: 10, fontWeight: 700 }} />
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="a-muted" style={{ fontSize: 12, marginTop: 12 }}>
                基于当前数据模拟的趋势，供管理层参考；接入历史统计接口后可展示真实曲线。
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
