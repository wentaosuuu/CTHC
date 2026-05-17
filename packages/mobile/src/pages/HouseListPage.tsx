import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '../api'
import { assetTypePillClass } from '../houseConfigDisplay'
import { addToCart, defaultCartLineFromHouse, getCart, removeFromCart, subscribeCart } from '../cartStorage'

const ASSET_TYPE_OPTIONS = ['泊湾公寓', '人才公寓', '商铺', '厂房', '住宅'] as const

type HouseItem = {
  id: string
  apartmentName: string
  assetType: string
  storeName: string
  houseNo: string
  houseType: string
  area: number
  rentMonthly: number
  deposit: number
  status: string
  images: string[]
}

// 从门店名解析城区（如 "南宁市-江南区" -> "江南区"）
function parseDistrict(storeName: string): string {
  const part = storeName.split('-')[1]?.trim()
  return part || storeName
}

function houseImageUrl(houseId: string) {
  return `https://picsum.photos/seed/${houseId}/400/300`
}

function HouseCardCartIcon({ inCart }: { inCart: boolean }) {
  if (inCart) {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
        <path
          d="M5 12.5l4.5 4.5L19 7.5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M6 7h15l-1.5 9h-11L6 7z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M6 7L5 4H3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="19" r="1.35" fill="currentColor" />
      <circle cx="17" cy="19" r="1.35" fill="currentColor" />
      <path d="M12 11v5M9.5 13.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function HouseListPage() {
  const [items, setItems] = useState<HouseItem[]>([])
  const [error, setError] = useState<string>('')
  const [cartTick, setCartTick] = useState(0)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterAssetType, setFilterAssetType] = useState<string>('')
  const [filterStore, setFilterStore] = useState<string>('')
  const [filterType, setFilterType] = useState<string>('')
  const [filterDistrict, setFilterDistrict] = useState<string>('')
  const [filterRentMin, setFilterRentMin] = useState<string>('')
  const [filterRentMax, setFilterRentMax] = useState<string>('')
  const [filterAreaMin, setFilterAreaMin] = useState<string>('')
  const [filterAreaMax, setFilterAreaMax] = useState<string>('')

  useEffect(() => subscribeCart(() => setCartTick((t) => t + 1)), [])

  const cartHouseIds = useMemo(() => new Set(getCart().map((l) => l.houseId)), [cartTick])

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
  const districtOptions = useMemo(() => {
    const set = new Set(items.map((h) => parseDistrict(h.storeName)))
    return Array.from(set).sort()
  }, [items])

  const filtered = useMemo(() => {
    return items.filter((h) => {
      if (filterAssetType && h.assetType !== filterAssetType) return false
      if (filterStore && h.storeName !== filterStore) return false
      if (filterType && h.houseType !== filterType) return false
      if (filterDistrict && parseDistrict(h.storeName) !== filterDistrict) return false
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
  }, [items, filterAssetType, filterStore, filterType, filterDistrict, filterRentMin, filterRentMax, filterAreaMin, filterAreaMax])

  const hasFilter =
    filterAssetType || filterStore || filterType || filterDistrict || filterRentMin || filterRentMax ||
    filterAreaMin || filterAreaMax

  const clearFilter = () => {
    setFilterAssetType('')
    setFilterStore('')
    setFilterType('')
    setFilterDistrict('')
    setFilterRentMin('')
    setFilterRentMax('')
    setFilterAreaMin('')
    setFilterAreaMax('')
  }

  return (
    <div className="m-house-list-shell">
      {/* 顶部固定：快速筛选（不随房源列表滚动） */}
      <div className="m-house-list-top">
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
                <label className="m-filter-label">资产类型</label>
                <select
                  className="m-filter-select"
                  value={filterAssetType}
                  onChange={(e) => setFilterAssetType(e.target.value)}
                >
                  <option value="">全部</option>
                  {ASSET_TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            <div className="m-filter-row">
              <label className="m-filter-label">城区</label>
              <select
                className="m-filter-select"
                value={filterDistrict}
                onChange={(e) => setFilterDistrict(e.target.value)}
              >
                <option value="">全部</option>
                {districtOptions.map((d) => (
                  <option key={d} value={d}>{d}</option>
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
      </div>

      {/* 仅红色框区域：房源卡片列表滚动 */}
      <div className="m-house-list-scroll">
      {error ? <div className="m-card m-error">加载失败：{error}</div> : null}

      {filtered.map((h) => {
        const inCart = cartHouseIds.has(h.id)
        const canAddCart = h.status === 'VACANT'
        return (
          <div key={h.id} className="m-house-card">
            <Link to={`/houses/${h.id}`} className="m-house-card-link">
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
              <div className="m-house-card-main">
                <div className="m-house-card-head">
                  <span className={assetTypePillClass(h.assetType)} title="资产类型">
                    {h.assetType || '未分类'}
                  </span>
                </div>
                <div className="m-house-card-title">
                  {h.apartmentName} · {h.houseNo}
                </div>
                <div className="m-house-card-meta-line">
                  <span>{h.storeName}</span>
                  <span className="m-house-card-meta-dot" aria-hidden>·</span>
                  <span>{h.houseType} · {h.area}㎡</span>
                </div>
              </div>
            </Link>
            <div className="m-house-card-aside">
              <div className="m-house-card-rent">¥{h.rentMonthly}/月</div>
              {canAddCart ? (
                <button
                  type="button"
                  className={`m-house-card-add-cart${inCart ? ' is-in-cart' : ''}`}
                  aria-label={
                    inCart
                      ? `将 ${h.apartmentName} · ${h.houseNo} 移出购物车`
                      : `将 ${h.apartmentName} · ${h.houseNo} 加入购物车`
                  }
                  title={inCart ? '移出购物车' : '加入购物车'}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (inCart) removeFromCart(h.id)
                    else addToCart(defaultCartLineFromHouse(h))
                    setCartTick((t) => t + 1)
                  }}
                >
                  <HouseCardCartIcon inCart={inCart} />
                </button>
              ) : null}
            </div>
          </div>
        )
      })}

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
    </div>
  )
}
