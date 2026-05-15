import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '../api'

type HouseItem = {
  id: string
  apartmentName: string
  storeName: string
  houseNo: string
  houseType: string
  area: number
  rentMonthly: number
  deposit: number
  status: string
  images: string[]
}

// 从门店名解析城市（如 "南宁市-江南区" -> "南宁市"）
function parseCity(storeName: string): string {
  const part = storeName.split('-')[0]?.trim() || storeName
  return part || '其他'
}

function houseImageUrl(houseId: string) {
  return `https://picsum.photos/seed/${houseId}/400/300`
}

export function HouseListPage() {
  const [items, setItems] = useState<HouseItem[]>([])
  const [error, setError] = useState<string>('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterStore, setFilterStore] = useState<string>('')
  const [filterType, setFilterType] = useState<string>('')
  const [filterCity, setFilterCity] = useState<string>('')
  const [filterRentMin, setFilterRentMin] = useState<string>('')
  const [filterRentMax, setFilterRentMax] = useState<string>('')
  const [filterAreaMin, setFilterAreaMin] = useState<string>('')
  const [filterAreaMax, setFilterAreaMax] = useState<string>('')

  useEffect(() => {
    let alive = true
    apiGet<{ items: HouseItem[] }>('/api/houses?browse=1').then((r) => {
      if (!alive) return
      if (!r.ok) return setError(r.error)
      const order = { VACANT: 0, ORDERED: 1, RESERVED: 2 } as Record<string, number>
      const sorted = [...r.data.items].sort(
        (a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9),
      )
      setItems(sorted)
    })
    return () => {
      alive = false
    }
  }, [])

  const storeOptions = useMemo(() => {
    const set = new Set(items.map((h) => h.storeName))
    return Array.from(set).sort()
  }, [items])
  const typeOptions = useMemo(() => {
    const set = new Set(items.map((h) => h.houseType))
    return Array.from(set).sort()
  }, [items])
  const cityOptions = useMemo(() => {
    const set = new Set(items.map((h) => parseCity(h.storeName)))
    return Array.from(set).sort()
  }, [items])

  const filtered = useMemo(() => {
    return items.filter((h) => {
      if (filterStore && h.storeName !== filterStore) return false
      if (filterType && h.houseType !== filterType) return false
      if (filterCity && parseCity(h.storeName) !== filterCity) return false
      const rentMin = Number(filterRentMin)
      const rentMax = Number(filterRentMax)
      if (filterRentMin !== '' && !Number.isNaN(rentMin) && h.rentMonthly < rentMin) return false
      if (filterRentMax !== '' && !Number.isNaN(rentMax) && h.rentMonthly > rentMax) return false
      const areaMin = Number(filterAreaMin)
      const areaMax = Number(filterAreaMax)
      if (filterAreaMin !== '' && !Number.isNaN(areaMin) && h.area < areaMin) return false
      if (filterAreaMax !== '' && !Number.isNaN(areaMax) && h.area > areaMax) return false
      return true
    })
  }, [items, filterStore, filterType, filterCity, filterRentMin, filterRentMax, filterAreaMin, filterAreaMax])

  const hasFilter =
    filterStore || filterType || filterCity || filterRentMin || filterRentMax ||
    filterAreaMin || filterAreaMax

  const clearFilter = () => {
    setFilterStore('')
    setFilterType('')
    setFilterCity('')
    setFilterRentMin('')
    setFilterRentMax('')
    setFilterAreaMin('')
    setFilterAreaMax('')
  }

  return (
    <div className="m-col">
      {/* 可折叠的快速筛选 */}
      <div className="m-card m-filter">
        <button
          type="button"
          className="m-filter-header"
          onClick={() => setFilterOpen((o) => !o)}
          aria-expanded={filterOpen}
        >
          <span className="m-filter-title">快速筛选</span>
          <span className="m-filter-chevron">{filterOpen ? '▼' : '▶'}</span>
        </button>
        {filterOpen && (
          <div className="m-filter-body">
            <div className="m-filter-row">
              <label className="m-filter-label">城市</label>
              <select
                className="m-filter-select"
                value={filterCity}
                onChange={(e) => setFilterCity(e.target.value)}
              >
                <option value="">全部</option>
                {cityOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="m-filter-row">
              <label className="m-filter-label">门店</label>
              <select
                className="m-filter-select"
                value={filterStore}
                onChange={(e) => setFilterStore(e.target.value)}
              >
                <option value="">全部</option>
                {storeOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="m-filter-row">
              <label className="m-filter-label">户型</label>
              <select
                className="m-filter-select"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
              >
                <option value="">全部</option>
                {typeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="m-filter-row m-filter-rent-range">
              <label className="m-filter-label">月租（元）</label>
              <div className="m-filter-rent-inputs">
                <input
                  type="number"
                  className="m-filter-input"
                  placeholder="最低"
                  value={filterRentMin}
                  onChange={(e) => setFilterRentMin(e.target.value)}
                />
                <span className="m-filter-rent-sep">－</span>
                <input
                  type="number"
                  className="m-filter-input"
                  placeholder="最高"
                  value={filterRentMax}
                  onChange={(e) => setFilterRentMax(e.target.value)}
                />
              </div>
            </div>
            <div className="m-filter-row m-filter-rent-range">
              <label className="m-filter-label">面积（㎡）</label>
              <div className="m-filter-rent-inputs">
                <input
                  type="number"
                  className="m-filter-input"
                  placeholder="最小"
                  value={filterAreaMin}
                  onChange={(e) => setFilterAreaMin(e.target.value)}
                />
                <span className="m-filter-rent-sep">－</span>
                <input
                  type="number"
                  className="m-filter-input"
                  placeholder="最大"
                  value={filterAreaMax}
                  onChange={(e) => setFilterAreaMax(e.target.value)}
                />
              </div>
            </div>
            {hasFilter ? (
              <button type="button" className="m-filter-clear" onClick={clearFilter}>
                清除筛选
              </button>
            ) : null}
          </div>
        )}
      </div>

      {error ? <div className="m-card m-error">加载失败：{error}</div> : null}

      {filtered.map((h) => (
        <Link key={h.id} to={`/houses/${h.id}`} className="m-house-card">
          <div className="m-house-card-img-wrap">
            <img
              src={h.images?.[0] ?? houseImageUrl(h.id)}
              alt=""
              className="m-house-card-img"
            />
            {h.status !== 'VACANT' ? (
              <span className="m-house-card-lock">锁定 · 仅可查看</span>
            ) : null}
          </div>
          <div className="m-house-card-body">
            <div className="m-house-card-main">
              <div className="m-house-card-title">
                {h.apartmentName} · {h.houseNo}
              </div>
              <div className="m-house-card-meta">
                {h.storeName}
              </div>
              <div className="m-house-card-meta">
                {h.houseType} · {h.area}㎡
              </div>
            </div>
            <div className="m-house-card-price-block">
              <div className="m-house-card-rent">¥{h.rentMonthly}/月</div>
            </div>
          </div>
        </Link>
      ))}

      {!error && filtered.length === 0 ? (
        <div className="m-card">
          <div style={{ fontWeight: 800 }}>
            {items.length === 0 ? '暂无在租房源' : '没有符合筛选条件的房源'}
          </div>
          <div className="m-muted">
            {items.length === 0
              ? '你可以去后台同步演示房源，或将锁定房源取消订单/审核拒绝后恢复可租。'
              : '试试调整筛选条件。'}
          </div>
        </div>
      ) : null}
    </div>
  )
}
