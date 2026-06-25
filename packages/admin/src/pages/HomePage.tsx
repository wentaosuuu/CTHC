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
  pendingOrders: number
  contracts: number
}

type DimRow = {
  storeName: string
  projectName?: string | null
  assetType: string
  rentCollectionUnit?: string | null
  managerName?: string | null
}

type HouseItem = {
  isPublished: boolean
  status: string
  storeName: string
  projectName?: string | null
  assetType: string
  rentCollectionUnit?: string | null
  managerName?: string | null
  area: number | null
}

type OrderListItem = {
  status: string
  house: DimRow
}

type ContractListItem = {
  house: DimRow
}

type BillMini = {
  dueDate: string
  totalAmount: number
  status: string
} & DimRow

type OverdueItem = {
  dueDate: string
  totalAmount: number
  penalty: number
} & DimRow

type TrendPoint = {
  label: string
  房源: number
  待办订单: number
  合同: number
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

function buildTrendData(stat: Stat, range: { start: Date; end: Date }, preset: TimePreset): TrendPoint[] {
  const result: TrendPoint[] = []
  const start = new Date(range.start)
  const end = new Date(range.end)
  const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
  const totalDays = Math.min(Math.max(days, 1), 31)

  for (let i = 0; i < totalDays; i += 1) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    if (d.getTime() > end.getTime()) break
    const ratio = totalDays <= 1 ? 1 : 0.5 + (0.5 * (i + 1)) / totalDays
    result.push({
      label: formatLabel(d, preset),
      房源: Math.max(0, Math.round(stat.houses * (0.6 + 0.4 * ratio))),
      待办订单: Math.max(0, Math.round(stat.pendingOrders * (0.55 + 0.45 * ratio))),
      合同: Math.max(0, Math.round(stat.contracts * (0.55 + 0.45 * ratio))),
    })
  }
  if (preset === 'yesterday' && result.length === 1) {
    result.push({
      label: '今日',
      房源: stat.houses,
      待办订单: stat.pendingOrders,
      合同: stat.contracts,
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
  待办订单: '#0ea5e9',
  合同: '#22c55e',
}

function projectLabel(row: DimRow) {
  const p = row.projectName?.trim()
  return p || row.storeName
}

function uniqSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort()
}

function matchDim(row: DimRow, project: string, asset: string, rent: string, mgr: string) {
  if (project && projectLabel(row) !== project) return false
  if (asset && row.assetType !== asset) return false
  if (rent && (row.rentCollectionUnit?.trim() || '') !== rent) return false
  if (mgr && (row.managerName?.trim() || '') !== mgr) return false
  return true
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

function toDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map((x) => Number(x))
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function formatPct(v: number): string {
  if (!Number.isFinite(v)) return '-'
  return `${(Math.round(v * 1000) / 10).toFixed(1)}%`
}

function formatCurrencyYuan(n: number): string {
  if (!Number.isFinite(n)) return '-'
  return `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`
}

function formatAreaSqm(n: number): string {
  if (!Number.isFinite(n)) return '-'
  return `${n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} ㎡`
}

function formatKpiMoney(n: number): { value: string; unit: string } {
  if (!Number.isFinite(n)) return { value: '-', unit: '' }
  if (n >= 100_000_000) return { value: (n / 100_000_000).toFixed(2), unit: '亿元' }
  if (n >= 10_000) return { value: (n / 10_000).toFixed(2), unit: '万元' }
  return { value: n.toLocaleString('zh-CN', { maximumFractionDigits: 0 }), unit: '元' }
}

function formatKpiArea(n: number): { value: string; unit: string } {
  if (!Number.isFinite(n)) return { value: '-', unit: '' }
  if (n >= 10_000) return { value: (n / 10_000).toFixed(2), unit: '万㎡' }
  return { value: n.toLocaleString('zh-CN', { maximumFractionDigits: 0 }), unit: '㎡' }
}

function HomeIndicatorCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <article className="a-home-ind">
      <div className="a-home-ind-head">
        <span className="a-home-ind-icon" aria-hidden />
        <span className="a-home-ind-label">{label}</span>
      </div>
      <div className="a-home-ind-divider" aria-hidden />
      <div className="a-home-ind-value-row">
        <span className="a-home-ind-value">{value}</span>
        {unit ? <span className="a-home-ind-unit">{unit}</span> : null}
      </div>
    </article>
  )
}

/** 领导看板：租金/面积类 demo，随筛选维度变化 */
function buildDemoLedger(seed: string, houseCount: number) {
  const h = hash01(seed)
  const receivable = Math.round((1_580_000 + h * 920_000) * (1 + Math.min(houseCount, 80) * 0.012))
  const payRatio = 0.76 + hash01(`${seed}|pay`) * 0.18
  const received = Math.round(receivable * payRatio)
  const totalArea = Math.round((9_200 + h * 5_100) + houseCount * 32)
  const leaseRatio = 0.68 + hash01(`${seed}|ar`) * 0.26
  const leasedArea = Math.round(totalArea * leaseRatio)
  const cumulativeRentalRate = leasedArea / Math.max(totalArea, 1)
  return { receivable, received, totalArea, leasedArea, cumulativeRentalRate }
}

export function HomePage() {
  const [housesItems, setHousesItems] = useState<HouseItem[]>([])
  const [orderItems, setOrderItems] = useState<OrderListItem[]>([])
  const [contractItems, setContractItems] = useState<ContractListItem[]>([])
  const [billItems, setBillItems] = useState<BillMini[]>([])
  const [overdueItems, setOverdueItems] = useState<OverdueItem[]>([])
  const [error, setError] = useState('')

  const [filterProject, setFilterProject] = useState('')
  const [filterAsset, setFilterAsset] = useState('')
  const [filterRentUnit, setFilterRentUnit] = useState('')
  const [filterManager, setFilterManager] = useState('')

  const [timePreset, setTimePreset] = useState<TimePreset>('thisMonth')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const [overduePreset, setOverduePreset] = useState<TimePreset>('thisMonth')
  const [overdueCustomStart, setOverdueCustomStart] = useState('')
  const [overdueCustomEnd, setOverdueCustomEnd] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [houses, orders, contracts, overdue, bills] = await Promise.all([
          apiGet<{ items: HouseItem[] }>('/api/admin/houses'),
          apiGet<{ items: OrderListItem[] }>('/api/admin/orders'),
          apiGet<{ items: ContractListItem[] }>('/api/admin/contracts'),
          apiGet<{ items: OverdueItem[]; rule: string }>('/api/admin/bills/overdue'),
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
        setHousesItems(houses.data.items)
        setOrderItems(orders.data.items)
        setContractItems(contracts.data.items)
        setOverdueItems(overdue.data.items)
        setBillItems(bills.data.items)
      } catch (e: unknown) {
        setError((e as Error)?.message || '加载失败')
      }
    }
    load()
  }, [])

  const projectOptions = useMemo(() => {
    return ['', ...uniqSorted(housesItems.map((h) => projectLabel(h)))]
  }, [housesItems])

  const assetOptions = useMemo(() => {
    return ['', ...uniqSorted(housesItems.map((h) => h.assetType))]
  }, [housesItems])

  const rentUnitOptions = useMemo(() => {
    return ['', ...uniqSorted(housesItems.map((h) => h.rentCollectionUnit?.trim() || ''))]
  }, [housesItems])

  const managerOptions = useMemo(() => {
    return ['', ...uniqSorted(housesItems.map((h) => h.managerName?.trim() || ''))]
  }, [housesItems])

  const filterSeed = useMemo(
    () => `${filterProject}|${filterAsset}|${filterRentUnit}|${filterManager}`,
    [filterProject, filterAsset, filterRentUnit, filterManager],
  )

  const filteredHouses = useMemo(
    () => housesItems.filter((h) => matchDim(h, filterProject, filterAsset, filterRentUnit, filterManager)),
    [housesItems, filterProject, filterAsset, filterRentUnit, filterManager],
  )

  const filteredBills = useMemo(
    () => billItems.filter((b) => matchDim(b, filterProject, filterAsset, filterRentUnit, filterManager)),
    [billItems, filterProject, filterAsset, filterRentUnit, filterManager],
  )

  const filteredContracts = useMemo(
    () =>
      contractItems.filter((c) => matchDim(c.house, filterProject, filterAsset, filterRentUnit, filterManager)),
    [contractItems, filterProject, filterAsset, filterRentUnit, filterManager],
  )

  const filteredOverdue = useMemo(
    () => overdueItems.filter((o) => matchDim(o, filterProject, filterAsset, filterRentUnit, filterManager)),
    [overdueItems, filterProject, filterAsset, filterRentUnit, filterManager],
  )

  const pendingOrders = useMemo(
    () =>
      orderItems.filter(
        (o) =>
          o.status === 'PENDING_REVIEW' &&
          matchDim(o.house, filterProject, filterAsset, filterRentUnit, filterManager),
      ).length,
    [orderItems, filterProject, filterAsset, filterRentUnit, filterManager],
  )

  const stat = useMemo<Stat>(
    () => ({
      houses: filteredHouses.length,
      pendingOrders,
      contracts: filteredContracts.length,
    }),
    [filteredHouses.length, pendingOrders, filteredContracts.length],
  )

  const demoLedger = useMemo(
    () => buildDemoLedger(filterSeed, filteredHouses.length),
    [filterSeed, filteredHouses.length],
  )

  const range = useMemo(() => {
    return getRangeForPreset(timePreset, customStart || undefined, customEnd || undefined)
  }, [timePreset, customStart, customEnd])

  const overdueRange = useMemo(() => {
    return getRangeForPreset(overduePreset, overdueCustomStart || undefined, overdueCustomEnd || undefined)
  }, [overduePreset, overdueCustomStart, overdueCustomEnd])

  const trendData = useMemo(() => {
    return buildTrendData(stat, range, timePreset)
  }, [stat, range, timePreset])

  const rentalRate = useMemo(() => {
    const published = filteredHouses.filter((h) => h.isPublished)
    const total = published.length
    if (total === 0) return null
    const occupied = published.filter((h) => h.status !== 'VACANT').length
    return clampRate(occupied / total)
  }, [filteredHouses])

  const vacancyRate = useMemo(() => {
    if (rentalRate == null) return null
    return 1 - rentalRate
  }, [rentalRate])

  const collectionRate = useMemo(() => {
    if (!filteredBills.length) return null
    const start = range.start.getTime()
    const endDay = new Date(range.end)
    endDay.setHours(23, 59, 59, 999)
    const inRange = filteredBills.filter((b) => {
      if (!b.dueDate) return false
      const t = toDate(b.dueDate).getTime()
      return t >= start && t <= endDay.getTime()
    })
    const dueSum = inRange.reduce((s, b) => s + (b.totalAmount ?? 0), 0)
    if (dueSum <= 0) return null
    const paidSum = inRange.filter((b) => b.status === 'PAID').reduce((s, b) => s + (b.totalAmount ?? 0), 0)
    return clampRate(paidSum / dueSum)
  }, [filteredBills, range])

  const cumulativeCollectionRate = useMemo(() => {
    if (!filteredBills.length) return null
    const endDay = new Date(range.end)
    endDay.setHours(23, 59, 59, 999)
    const upto = filteredBills.filter((b) => {
      if (!b.dueDate) return false
      const t = toDate(b.dueDate).getTime()
      return t <= endDay.getTime()
    })
    const dueSum = upto.reduce((s, b) => s + (b.totalAmount ?? 0), 0)
    if (dueSum <= 0) return null
    const paidSum = upto.filter((b) => b.status === 'PAID').reduce((s, b) => s + (b.totalAmount ?? 0), 0)
    return clampRate(paidSum / dueSum)
  }, [filteredBills, range])

  const rateTrendData = useMemo<RateTrendPoint[]>(() => {
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
      const progress = totalDays <= 1 ? 1 : i / (totalDays - 1)
      const waveWeekly = Math.sin(progress * Math.PI * 2) * 0.07
      const waveHalfMonth = Math.cos(progress * Math.PI) * 0.04
      const noiseRental = (hash01(`${label}-${i}`) - 0.5) * 0.08
      const noiseCollection = (hash01(`c-${label}-${i}`) - 0.5) * 0.1
      const spike =
        (hash01(`sp-${label}-${i}`) > 0.92 ? -0.06 : 0) + (hash01(`sp2-${label}-${i}`) < 0.08 ? 0.04 : 0)

      const rental = clampRate(baseRental + waveWeekly + waveHalfMonth + noiseRental, 0.58, 0.96)
      const vacancy = clampRate(1 - rental, 0.02, 0.45)

      const collection = clampRate(baseCollection + waveWeekly * 0.6 + noiseCollection + spike, 0.62, 0.97)
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

  const overdueRangeEnd = useMemo(() => {
    const d = new Date(overdueRange.end)
    d.setHours(23, 59, 59, 999)
    return d.getTime()
  }, [overdueRange])

  const overdueStats = useMemo(() => {
    const start = overdueRange.start.getTime()
    const rows = filteredOverdue.filter((o) => {
      const t = toDate(o.dueDate).getTime()
      return t >= start && t <= overdueRangeEnd
    })
    const amount = rows.reduce((s, o) => s + (o.totalAmount ?? 0) + (o.penalty ?? 0), 0)
    return { amount, count: rows.length }
  }, [filteredOverdue, overdueRange, overdueRangeEnd])

  const applyPreset = (preset: TimePreset) => {
    setTimePreset(preset)
    const r = preset === 'custom' ? getRangeForPreset('thisMonth') : getRangeForPreset(preset)
    setCustomStart(toYmd(r.start))
    setCustomEnd(toYmd(r.end))
  }

  const applyOverduePreset = (preset: TimePreset) => {
    setOverduePreset(preset)
    const r = preset === 'custom' ? getRangeForPreset('thisMonth') : getRangeForPreset(preset)
    setOverdueCustomStart(toYmd(r.start))
    setOverdueCustomEnd(toYmd(r.end))
  }

  const rangeLabel = useMemo(() => {
    if (timePreset === 'custom' && customStart && customEnd) return `${customStart} 至 ${customEnd}`
    return `${toYmd(range.start)} 至 ${toYmd(range.end)}`
  }, [timePreset, customStart, customEnd, range])

  const overdueRangeLabel = useMemo(() => {
    if (overduePreset === 'custom' && overdueCustomStart && overdueCustomEnd)
      return `${overdueCustomStart} 至 ${overdueCustomEnd}`
    return `${toYmd(overdueRange.start)} 至 ${toYmd(overdueRange.end)}`
  }, [overduePreset, overdueCustomStart, overdueCustomEnd, overdueRange])

  const showRateTrend = rateTrendData.length > 0
  const showStatTrend = trendData.length > 0

  return (
    <div className="a-home-dashboard a-col">
      {error ? (
        <div className="a-home-alert" role="alert">
          <span className="a-home-alert-title">加载失败</span>
          <span className="a-home-alert-msg">{error}</span>
        </div>
      ) : null}

      <header className="a-home-hero">
        <div className="a-home-hero-top">
          <div>
            <p className="a-home-eyebrow">管理驾驶舱</p>
            <h1 className="a-home-title">经营总览</h1>
          </div>
        </div>
        <div className="a-home-filter-panel">
          <div className="a-dashboard-filters a-home-filter-grid">
            <label className="a-filter-field">
              <span className="a-filter-label">项目名称</span>
              <select
                className="a-filter-input a-home-select"
                value={filterProject}
                onChange={(e) => setFilterProject(e.target.value)}
              >
                <option value="">全部项目</option>
                {projectOptions
                  .filter(Boolean)
                  .map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="a-filter-field">
              <span className="a-filter-label">资产类型</span>
              <select
                className="a-filter-input a-home-select"
                value={filterAsset}
                onChange={(e) => setFilterAsset(e.target.value)}
              >
                <option value="">全部类型</option>
                {assetOptions
                  .filter(Boolean)
                  .map((at) => (
                    <option key={at} value={at}>
                      {at}
                    </option>
                  ))}
              </select>
            </label>
            <label className="a-filter-field">
              <span className="a-filter-label">收租单位</span>
              <select
                className="a-filter-input a-home-select"
                value={filterRentUnit}
                onChange={(e) => setFilterRentUnit(e.target.value)}
              >
                <option value="">全部</option>
                {rentUnitOptions
                  .filter(Boolean)
                  .map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
              </select>
            </label>
            <label className="a-filter-field">
              <span className="a-filter-label">管理人</span>
              <select
                className="a-filter-input a-home-select"
                value={filterManager}
                onChange={(e) => setFilterManager(e.target.value)}
              >
                <option value="">全部</option>
                {managerOptions
                  .filter(Boolean)
                  .map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </div>
      </header>

      <section className="a-home-section a-home-section--time">
        <div className="a-home-section-head">
          <h2 className="a-home-section-title">统计周期</h2>
          <p className="a-home-section-meta">{rangeLabel}</p>
        </div>
        <div className="a-time-segments">
          {PRESETS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`a-time-seg${timePreset === key ? ' is-active' : ''}`}
              onClick={() => applyPreset(key)}
            >
              {label}
            </button>
          ))}
          {timePreset === 'custom' ? (
            <div className="a-time-custom">
              <input
                type="date"
                className="a-filter-input a-home-date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
              <span className="a-muted">至</span>
              <input
                type="date"
                className="a-filter-input a-home-date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="a-home-section">
        <div className="a-home-section-head">
          <h2 className="a-home-section-title">资金与面积</h2>
        </div>
        <div className="a-home-ind-grid">
          <HomeIndicatorCard label="应收租金" {...formatKpiMoney(demoLedger.receivable)} />
          <HomeIndicatorCard label="实收租金" {...formatKpiMoney(demoLedger.received)} />
          <HomeIndicatorCard label="总面积" {...formatKpiArea(demoLedger.totalArea)} />
          <HomeIndicatorCard label="出租面积" {...formatKpiArea(demoLedger.leasedArea)} />
        </div>
      </section>

      <section className="a-home-section">
        <div className="a-home-section-head">
          <h2 className="a-home-section-title">运营快照</h2>
        </div>
        <div className="a-home-ind-grid">
          <HomeIndicatorCard
            label="累计出租率"
            value={formatPct(demoLedger.cumulativeRentalRate).replace('%', '')}
            unit="%"
          />
          <HomeIndicatorCard label="房源数" value={String(stat.houses)} unit="套" />
          <HomeIndicatorCard label="待办订单数" value={String(stat.pendingOrders)} unit="单" />
          <HomeIndicatorCard label="合同数" value={String(stat.contracts)} unit="份" />
        </div>
      </section>

      <section className="a-home-section">
        <div className="a-home-section-head">
          <h2 className="a-home-section-title">出租与收缴</h2>
        </div>
        <div className="a-home-ind-grid">
          <HomeIndicatorCard
            label="出租率"
            value={rentalRate == null ? '-' : formatPct(rentalRate).replace('%', '')}
            unit={rentalRate == null ? '' : '%'}
          />
          <HomeIndicatorCard
            label="空置率"
            value={vacancyRate == null ? '-' : formatPct(vacancyRate).replace('%', '')}
            unit={vacancyRate == null ? '' : '%'}
          />
          <HomeIndicatorCard
            label="收缴率"
            value={collectionRate == null ? '-' : formatPct(collectionRate).replace('%', '')}
            unit={collectionRate == null ? '' : '%'}
          />
          <HomeIndicatorCard
            label="累计收缴率"
            value={cumulativeCollectionRate == null ? '-' : formatPct(cumulativeCollectionRate).replace('%', '')}
            unit={cumulativeCollectionRate == null ? '' : '%'}
          />
        </div>
      </section>

      <section className="a-home-overdue">
        <div className="a-home-overdue-head">
          <div>
            <h2 className="a-home-overdue-title">逾期风险</h2>
          </div>
          <p className="a-home-overdue-range">{overdueRangeLabel}</p>
        </div>
        <div className="a-time-segments a-time-segments--compact">
          {PRESETS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`a-time-seg${overduePreset === key ? ' is-active' : ''}`}
              onClick={() => applyOverduePreset(key)}
            >
              {label}
            </button>
          ))}
          {overduePreset === 'custom' ? (
            <div className="a-time-custom">
              <input
                type="date"
                className="a-filter-input a-home-date"
                value={overdueCustomStart}
                onChange={(e) => setOverdueCustomStart(e.target.value)}
              />
              <span className="a-muted">至</span>
              <input
                type="date"
                className="a-filter-input a-home-date"
                value={overdueCustomEnd}
                onChange={(e) => setOverdueCustomEnd(e.target.value)}
              />
            </div>
          ) : null}
        </div>
        <div className="a-home-overdue-sum">
          <div>
            <p className="a-home-overdue-sum-label">逾期金额合计</p>
            <p className="a-home-overdue-sum-num">{formatCurrencyYuan(overdueStats.amount)}</p>
          </div>
          <p className="a-home-overdue-count">
            命中账单 <strong>{overdueStats.count}</strong> 笔（当前筛选）
          </p>
        </div>
      </section>

      {showRateTrend || showStatTrend ? (
        <section className="a-home-section a-home-section--charts">
          <div className="a-home-section-head">
            <h2 className="a-home-section-title">趋势分析</h2>
          </div>
          <div className="a-home-charts">
          {showRateTrend ? (
            <div className="a-home-chart-card">
              <p className="a-home-chart-title">出租率 / 空置率</p>
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

              <p className="a-home-chart-title a-home-chart-title--spaced">收缴率 / 累计收缴率</p>
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

          {showStatTrend ? (
            <div className="a-home-chart-card">
              <p className="a-home-chart-title">房源数</p>
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

              <p className="a-home-chart-title a-home-chart-title--spaced">待办订单 / 合同</p>
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
                    <Line
                      type="monotone"
                      dataKey="待办订单"
                      stroke={CHART_COLORS.待办订单}
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      name="待办订单数"
                    >
                      <LabelList dataKey="待办订单" position="top" style={{ fontSize: 10, fontWeight: 700 }} />
                    </Line>
                    <Line type="monotone" dataKey="合同" stroke={CHART_COLORS.合同} strokeWidth={2} dot={{ r: 4 }} name="合同数">
                      <LabelList dataKey="合同" position="top" style={{ fontSize: 10, fontWeight: 700 }} />
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              </div>

            </div>
          ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
