import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '../api'
import { Pagination, paginate } from '../components/Pagination'

type HouseItem = {
  id: string
  houseBizId: string
  apartmentName: string
  storeName: string
  houseNo: string
  houseType: string
  area: number
  rentMonthly: number
  deposit: number
  status: string
  isPublished: boolean
  images: string[]
  address?: string | null
  geoLat?: number | null
  geoLng?: number | null
  nearbySubway?: { name: string; distanceMeters?: number }[]
  nearbySchools?: { name: string; type?: string; distanceMeters?: number }[]
  nearbyBusStops?: { name: string; routes: string[] }[]
}

/** 房源状态：突出「锁定 / 可租」，与下单锁定业务一致 */
function statusZh(status: string) {
  switch (status) {
    case 'VACANT':
      return '空置 · 可下单'
    case 'RESERVED':
      return '预留锁定'
    case 'ORDERED':
      return '下单锁定'
    case 'SIGNED':
      return '已签约 · 在租'
    case 'TERMINATED':
      return '已退租'
    default:
      return status
  }
}

function hashInt(s: string, mod: number) {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return mod ? h % mod : h
}

function svgDataUri(svg: string) {
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22')
  return `data:image/svg+xml;charset=utf-8,${encoded}`
}

function buildHouseImages(seed: string) {
  const themes = [
    { a: '#2563eb', b: '#0ea5e9', c: '#e0f2fe' },
    { a: '#7c3aed', b: '#22c55e', c: '#ecfccb' },
    { a: '#f97316', b: '#06b6d4', c: '#cffafe' },
  ]
  const t = themes[hashInt(seed, themes.length)]
  const title = `Room ${seed.slice(0, 4).toUpperCase()}`

  const common = (label: string, idx: number) => `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${t.a}"/>
      <stop offset="1" stop-color="${t.b}"/>
    </linearGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="rgba(0,0,0,0.25)"/>
    </filter>
  </defs>
  <rect width="1200" height="700" fill="url(#g)"/>
  <circle cx="220" cy="160" r="140" fill="rgba(255,255,255,0.18)"/>
  <circle cx="1040" cy="520" r="190" fill="rgba(255,255,255,0.14)"/>
  <rect x="90" y="110" width="1020" height="480" rx="28" fill="rgba(255,255,255,0.92)" filter="url(#s)"/>
  <rect x="120" y="140" width="960" height="180" rx="22" fill="${t.c}"/>
  <text x="150" y="205" font-family="system-ui, -apple-system, Segoe UI, Roboto" font-size="42" font-weight="800" fill="#0f172a">${label}</text>
  <text x="150" y="265" font-family="system-ui, -apple-system, Segoe UI, Roboto" font-size="22" fill="#334155">${title} · Demo Image ${idx}</text>
  <g opacity="0.9">
    <rect x="150" y="360" width="260" height="160" rx="18" fill="#0f172a"/>
    <rect x="430" y="360" width="260" height="160" rx="18" fill="#1e293b"/>
    <rect x="710" y="360" width="320" height="160" rx="18" fill="#334155"/>
  </g>
  <text x="150" y="560" font-family="system-ui, -apple-system, Segoe UI, Roboto" font-size="18" fill="rgba(15,23,42,0.55)">该图片为系统内置生成示意图（用于演示轮播效果）</text>
</svg>`

  return [
    svgDataUri(common('客厅 / Living Room', 1)),
    svgDataUri(common('卧室 / Bedroom', 2)),
    svgDataUri(common('厨房 / Kitchen', 3)),
  ]
}

function buildMoreInfo(h: HouseItem) {
  const idx = hashInt(h.id, 1000)
  const district = ['江南区', '青秀区', '兴宁区', '西乡塘区', '邕宁区', '武鸣区', '良庆区'][hashInt(h.id + 'd', 7)]
  const road = ['梧桐路', '江景大道', '花园路', '瑞金路', '世纪大道'][hashInt(h.id + 'r', 5)]
  const no = 100 + (idx % 300)
  const fallbackAddress = `南宁市${district}${road}${no}号 ${h.apartmentName} ${h.houseNo}室`

  const landlords = ['南宁梧桐资产管理有限公司', '江景公寓运营（南宁）有限公司', '某某不动产管理（集团）有限公司']
  const landlord = landlords[hashInt(h.id + 'l', landlords.length)]
  const ownerName = ['张*', '李*', '王*', '赵*'][hashInt(h.id + 'o', 4)]
  const ownerPhone = `13${hashInt(h.id + 'p', 10)}-${String(8000 + (idx % 2000)).padStart(4, '0')}-****`

  const propertyNo = `邕房权证-${new Date().getFullYear()}-${String(100000 + idx).slice(-6)}`
  const landUse = ['住宅用地', '商住两用', '公寓用地'][hashInt(h.id + 'u', 3)]
  const builtYear = 2008 + (idx % 15)

  return {
    address: (h.address ?? '').trim() || fallbackAddress,
    landlord,
    ownerName,
    ownerPhone,
    propertyNo,
    landUse,
    builtYear: String(builtYear),
    remark: '演示字段：后续可从资产系统同步或在后台补录。',
  }
}

function formatGeoText(h: HouseItem) {
  const lat = h.geoLat
  const lng = h.geoLng
  if (lat == null || lng == null) return '未配置'
  return `${lat}, ${lng}`
}

function formatNearbySubway(h: HouseItem) {
  const list = h.nearbySubway ?? []
  if (!list.length) return '未配置'
  return list
    .map((x) => `${x.name}${x.distanceMeters != null ? `（约${x.distanceMeters}m）` : ''}`)
    .join('；')
}

function formatNearbySchools(h: HouseItem) {
  const list = h.nearbySchools ?? []
  if (!list.length) return '未配置'
  return list
    .map((x) => {
      const type = x.type ? `·${x.type}` : ''
      const dist = x.distanceMeters != null ? `（约${x.distanceMeters}m）` : ''
      return `${x.name}${type}${dist}`
    })
    .join('；')
}

function formatNearbyBusStops(h: HouseItem) {
  const list = h.nearbyBusStops ?? []
  if (!list.length) return '未配置'
  return list
    .map((x) => {
      const routes = (x.routes ?? []).filter(Boolean).join('、')
      return routes ? `${x.name}（${routes}）` : x.name
    })
    .join('；')
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'VACANT':
      return 'a-badge status-vacant'
    case 'RESERVED':
      return 'a-badge status-reserved'
    case 'ORDERED':
      return 'a-badge status-ordered'
    case 'SIGNED':
      return 'a-badge status-signed'
    case 'TERMINATED':
      return 'a-badge status-terminated'
    default:
      return 'a-badge'
  }
}

export function HousesPage() {
  const [items, setItems] = useState<HouseItem[]>([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [apartmentFilter, setApartmentFilter] = useState('')
  const [houseTypeFilter, setHouseTypeFilter] = useState('')

  function resetHouseFilters() {
    setQ('')
    setStatus('')
    setStoreFilter('')
    setApartmentFilter('')
    setHouseTypeFilter('')
    setPage(1)
  }

  const [detail, setDetail] = useState<HouseItem | null>(null)
  const [imgIndex, setImgIndex] = useState(0)

  // 房源配置弹窗（配置月租 + 图片）
  const [configTarget, setConfigTarget] = useState<HouseItem | null>(null)
  const [configRentMonthly, setConfigRentMonthly] = useState<number>(0)
  const [configImages, setConfigImages] = useState<string[]>([])
  const [configImgIndex, setConfigImgIndex] = useState<number>(0)
  const [configAddress, setConfigAddress] = useState<string>('')
  const [configGeoLat, setConfigGeoLat] = useState<string>('')
  const [configGeoLng, setConfigGeoLng] = useState<string>('')
  const [configSubwayText, setConfigSubwayText] = useState<string>('')
  const [configSchoolsText, setConfigSchoolsText] = useState<string>('')
  const [configBusText, setConfigBusText] = useState<string>('')

  function missingPublishFields(h: HouseItem) {
    const missing: string[] = []
    if (h.rentMonthly <= 0) missing.push('租金')
    if ((h.images?.length ?? 0) === 0) missing.push('图片')
    if (!(h.address ?? '').trim()) missing.push('公寓地址')
    return missing
  }

  function isConfigReady(h: HouseItem) {
    return missingPublishFields(h).length === 0
  }

  /** 后台展示用的“状态标签”，不直接等同于数据库 status（因为未上架时不能显示“可下单”） */
  function adminStatusLabel(h: HouseItem) {
    if (!h.isPublished) {
      const m = missingPublishFields(h)
      if (m.length === 0) return '已配置 · 未上架'
      return `未填${m.join('、')} · 不可发布`
    }
    return statusZh(h.status)
  }

  function adminStatusBadgeClass(h: HouseItem) {
    if (!h.isPublished) {
      const ready = isConfigReady(h)
      return ready ? 'a-badge status-not-published' : 'a-badge status-not-configured'
    }
    return statusBadgeClass(h.status)
  }

  async function load() {
    setError('')
    const r = await apiGet<{ items: HouseItem[] }>('/api/admin/houses')
    if (!r.ok) return setError(r.error)
    setItems(r.data.items)
  }

  async function setHousePublished(h: HouseItem, next: boolean) {
    setError('')
    setMsg('')
    const path = next ? `/api/admin/houses/${h.id}/publish` : `/api/admin/houses/${h.id}/unpublish`
    const r = await apiPost<{ ok: true; id: string; isPublished: boolean }>(path, {})
    if (!r.ok) return setError(r.error)
    setMsg(next ? '已上架房源' : '已下架房源')
    await load()
  }

  useEffect(() => {
    load()
  }, [])

  async function syncDemo() {
    setError('')
    setMsg('')
    const r = await apiPost<{ ok: true; upsertedHouses: number }>('/api/admin/integrations/asset/sync-demo', {})
    if (!r.ok) return setError(r.error)
    setMsg(`已完成同步（演示），更新房源数：${r.data.upsertedHouses}`)
    await load()
  }

  function openConfigModal(h: HouseItem) {
    setConfigTarget(h)
    setConfigRentMonthly(h.rentMonthly)
    setConfigImages(h.images)
    setConfigImgIndex(0)
    setConfigAddress(h.address ? String(h.address) : '')
    setConfigGeoLat(h.geoLat != null ? String(h.geoLat) : '')
    setConfigGeoLng(h.geoLng != null ? String(h.geoLng) : '')
    setConfigSubwayText(
      (h.nearbySubway ?? [])
        .map((x) => `${x.name}${x.distanceMeters != null ? `|${x.distanceMeters}` : ''}`)
        .join('\n'),
    )
    setConfigSchoolsText(
      (h.nearbySchools ?? [])
        .map((x) => `${x.name}${x.type ? `|${x.type}` : ''}${x.distanceMeters != null ? `|${x.distanceMeters}` : ''}`)
        .join('\n'),
    )
    setConfigBusText(
      (h.nearbyBusStops ?? [])
        .map((x) => `${x.name}|${(x.routes ?? []).join(',')}`)
        .join('\n'),
    )
    setError('')
  }

  function parseSubway(text: string) {
    // 每行：站名|距离m（可省略距离）
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [nameRaw, distRaw] = line.split('|').map((x) => x.trim())
        const d = distRaw ? Number(distRaw) : undefined
        return { name: nameRaw, distanceMeters: Number.isFinite(d as number) ? (d as number) : undefined }
      })
      .filter((x) => x.name)
  }

  function parseSchools(text: string) {
    // 每行：学校名|类型(小学/中学/大学...)|距离m（后两项可省略）
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('|').map((x) => x.trim()).filter(Boolean)
        const name = parts[0] ?? ''
        const type = parts.length >= 2 ? parts[1] : undefined
        const distRaw = parts.length >= 3 ? parts[2] : undefined
        const d = distRaw ? Number(distRaw) : undefined
        return { name, type, distanceMeters: Number.isFinite(d as number) ? (d as number) : undefined }
      })
      .filter((x) => x.name)
  }

  function parseBusStops(text: string) {
    // 每行：站名|线路1,线路2,线路3
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [nameRaw, routesRaw] = line.split('|').map((x) => x.trim())
        const routes = (routesRaw ?? '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
        return { name: nameRaw, routes }
      })
      .filter((x) => x.name)
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onerror = () => reject(new Error('READ_FILE_FAILED'))
      fr.onload = () => resolve(String(fr.result))
      fr.readAsDataURL(file)
    })
  }

  async function onConfigUploadImages(files: FileList | null) {
    if (!files || files.length === 0) return
    try {
      const next: string[] = []
      for (const f of Array.from(files)) {
        if (!f.type.startsWith('image/')) continue
        next.push(await readFileAsDataUrl(f))
      }
      // 上限：最多 10 张
      setConfigImages((prev) => [...prev, ...next].slice(0, 10))
      setConfigImgIndex(0)
    } catch {
      setError('图片读取失败，请重试')
    }
  }

  async function saveConfigModal() {
    if (!configTarget) return
    setError('')
    setMsg('')
    const rentMonthly = Math.max(0, Math.floor(configRentMonthly))
    const images = configImages
    const address = configAddress.trim()
    const latNum = configGeoLat.trim() ? Number(configGeoLat.trim()) : null
    const lngNum = configGeoLng.trim() ? Number(configGeoLng.trim()) : null
    const geoLat = Number.isFinite(latNum as number) ? (latNum as number) : null
    const geoLng = Number.isFinite(lngNum as number) ? (lngNum as number) : null
    const nearbySubway = parseSubway(configSubwayText)
    const nearbySchools = parseSchools(configSchoolsText)
    const nearbyBusStops = parseBusStops(configBusText)

    if (!address) {
      setError('请填写公寓地址')
      return
    }

    const r = await apiPost<{ ok: true; id: string }>(`/api/admin/houses/${configTarget.id}/config`, {
      rentMonthly,
      images,
      address,
      geoLat,
      geoLng,
      nearbySubway,
      nearbySchools,
      nearbyBusStops,
    })
    if (!r.ok) return setError(r.error)
    setMsg('已保存房源配置（租金/图片/地址/交通/配套）')
    setConfigTarget(null)
    await load()
  }

  const filterOptions = useMemo(() => {
    const stores = Array.from(new Set(items.map((h) => h.storeName).filter(Boolean))).sort()
    const apartments = Array.from(new Set(items.map((h) => h.apartmentName).filter(Boolean))).sort()
    const houseTypes = Array.from(new Set(items.map((h) => h.houseType).filter(Boolean))).sort()
    return { stores, apartments, houseTypes }
  }, [items])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return items.filter((h) => {
      if (status) {
        // 这里的状态筛选只面向「已上架」的房源：未上架/未配置的房源不应该再显示为“空置可下单”等状态
        if (!h.isPublished) return false
        if (h.status !== status) return false
      }
      if (storeFilter && h.storeName !== storeFilter) return false
      if (apartmentFilter && h.apartmentName !== apartmentFilter) return false
      if (houseTypeFilter && h.houseType !== houseTypeFilter) return false
      if (!kw) return true
      const hay = `${h.houseBizId} ${h.storeName} ${h.apartmentName} ${h.houseNo} ${h.houseType}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, status, storeFilter, apartmentFilter, houseTypeFilter])

  const pageData = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize])

  return (
    <div className="a-col">
      {error ? <div className="a-card a-error">操作失败：{error}</div> : null}
      {msg ? <div className="a-card a-success">{msg}</div> : null}

      <div className="a-card a-row" style={{ justifyContent: 'space-between' }}>
        <div className="a-filterbar" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="a-filter-label">筛选</span>
          <input
            className="a-filter-input"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
            placeholder="搜索：房源ID/门店/公寓/房号/房型"
            style={{ minWidth: 140 }}
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
              <option key={s} value={s}>{s}</option>
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
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select
            className="a-filter-select"
            value={houseTypeFilter}
            onChange={(e) => {
              setHouseTypeFilter(e.target.value)
              setPage(1)
            }}
            title="房型"
          >
            <option value="">全部房型</option>
            {filterOptions.houseTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            className="a-filter-select"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
            title="房源状态"
          >
            <option value="">全部状态</option>
            <option value="VACANT">空置（可下单）</option>
            <option value="ORDERED">下单锁定</option>
            <option value="RESERVED">预留锁定（待签约/待付）</option>
            <option value="SIGNED">已签约（在租）</option>
            <option value="TERMINATED">已退租</option>
          </select>
          <button className="a-btn ghost" onClick={() => setPage(1)} title="使用当前筛选条件进行查询">
            查询
          </button>
          <button className="a-btn ghost" onClick={resetHouseFilters} title="清空筛选条件">
            重置
          </button>
          <span className="a-muted">共 {filtered.length} 套</span>
        </div>
        <div className="a-row">
          <button className="a-btn" onClick={syncDemo}>
            立即同步
          </button>
          <button className="a-btn ghost" onClick={load}>
            刷新
          </button>
        </div>
      </div>

      <div className="a-card a-muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
        <strong style={{ color: '#334155' }}>状态说明：</strong>
        租客下单 →「下单锁定」（他人不可下单）；店长通过 →「预留锁定」（待签约/待付）；支付成功 →「已签约」。
        未上架/未配置（缺租金、图片或公寓地址）→ 状态会显示「未配置/未上架」，H5 不可见、不可下单。
        未支付超时、作废待付合同、审核拒绝或「取消订单」→ 恢复「空置 · 可下单」（前提是已上架）。
      </div>

      <div className="a-card">
        <div className="a-table-wrap">
        <table className="a-table a-table-sticky-op">
          <thead>
            <tr>
              <th>房源ID</th>
              <th>门店</th>
              <th>公寓</th>
              <th>房号</th>
              <th>房型</th>
              <th>面积</th>
              <th>租金</th>
              <th>押金</th>
              <th>状态</th>
              <th>上架</th>
              <th className="a-op-col">操作</th>
            </tr>
          </thead>
          <tbody>
            {pageData.items.map((h) => (
              <tr key={h.id}>
                <td style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{h.houseBizId}</td>
                <td>{h.storeName}</td>
                <td>{h.apartmentName}</td>
                <td style={{ fontWeight: 900 }}>{h.houseNo}</td>
                <td>{h.houseType}</td>
                <td>{h.area}㎡</td>
                <td>¥{h.rentMonthly}/月</td>
                <td>¥{h.deposit}</td>
                <td>
                  <span className={adminStatusBadgeClass(h)}>{adminStatusLabel(h)}</span>
                </td>
                <td>
                  <label
                    className="a-switch"
                    title={
                      h.isPublished
                        ? '已上架（点击下架）'
                        : `上架校验：租金${h.rentMonthly > 0 ? '已填' : '未填'}，图片${h.images.length > 0 ? '已填' : '未填'}，地址${(h.address ?? '').trim() ? '已填' : '未填'}`
                    }
                  >
                    <input
                      type="checkbox"
                      checked={h.isPublished}
                      disabled={!isConfigReady(h) && !h.isPublished}
                      onChange={() => setHousePublished(h, !h.isPublished)}
                    />
                    <span className="a-switch-slider" />
                  </label>
                </td>
                <td className="a-op-cell">
                  <div className="a-op-actions">
                    <button type="button" className="a-btn" onClick={() => openConfigModal(h)}>
                      房源配置
                    </button>
                    <button
                      type="button"
                      className="a-btn ghost"
                      onClick={() => {
                        setDetail(h)
                        setImgIndex(0)
                      }}
                    >
                      查看详情
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={11} className="a-muted">
                  暂无房源。请先点“立即同步”。
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

      {detail ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetail(null)
          }}
        >
          <div className="a-modal">
            <div className="a-modal-header">
              <div className="a-modal-title">
                {detail.apartmentName} · {detail.houseNo}（{detail.storeName}）
              </div>
              <button className="a-modal-close" onClick={() => setDetail(null)}>
                关闭
              </button>
            </div>

            <div className="a-modal-body">
              <div className="a-carousel">
                {(() => {
                  const imgs = detail.images.length ? detail.images : buildHouseImages(detail.id)
                  const safeIdx = Math.min(Math.max(0, imgIndex), imgs.length - 1)
                  const more = buildMoreInfo(detail)
                  const configured =
                    detail.images.length > 0 &&
                    detail.rentMonthly > 0 &&
                    Boolean((detail.address ?? '').trim())
                  return (
                    <>
                      <img src={imgs[safeIdx]} alt="房源图片" />
                      <div className="a-carousel-bar">
                        <button
                          className="a-carousel-btn"
                          onClick={() => setImgIndex((v) => (v - 1 + imgs.length) % imgs.length)}
                        >
                          ←
                        </button>
                        <div className="a-muted">
                          图片 {safeIdx + 1} / {imgs.length} · {more.address} ·{' '}
                          {configured ? '已配置' : '未配置（不可上架）'}
                        </div>
                        <button
                          className="a-carousel-btn"
                          onClick={() => setImgIndex((v) => (v + 1) % imgs.length)}
                        >
                          →
                        </button>
                      </div>
                    </>
                  )
                })()}
              </div>

              <div className="a-kv">
                {(() => {
                  const more = buildMoreInfo(detail)
                  const rows: { k: string; v: string }[] = [
                    { k: '门店', v: detail.storeName },
                    { k: '公寓', v: detail.apartmentName },
                    { k: '房号', v: detail.houseNo },
                    { k: '房型', v: detail.houseType },
                    { k: '面积', v: `${detail.area}㎡` },
                    { k: '月租', v: `¥${detail.rentMonthly}` },
                    { k: '押金', v: `¥${detail.deposit}` },
                    { k: '状态', v: adminStatusLabel(detail) },
                    { k: '地址', v: more.address },
                    { k: '地图坐标', v: formatGeoText(detail) },
                    { k: '附近地铁', v: formatNearbySubway(detail) },
                    { k: '附近学校', v: formatNearbySchools(detail) },
                    { k: '附近公交', v: formatNearbyBusStops(detail) },
                    { k: '房东/机构', v: more.landlord },
                    { k: '房东联系人', v: `${more.ownerName}（${more.ownerPhone}）` },
                    { k: '产权证号', v: more.propertyNo },
                    { k: '土地性质', v: more.landUse },
                    { k: '建成年份', v: more.builtYear },
                    { k: '备注', v: more.remark },
                  ]
                  return rows.map((r) => (
                    <div key={r.k} className="a-kv-row">
                      <div className="a-kv-k">{r.k}</div>
                      <div className="a-kv-v">{r.v}</div>
                    </div>
                  ))
                })()}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {configTarget ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfigTarget(null)
          }}
        >
          <div className="a-modal" style={{ maxWidth: 820 }}>
            <div className="a-modal-header">
              <div className="a-modal-title">
                房源配置：{configTarget.apartmentName} · {configTarget.houseNo}（{configTarget.storeName}）
              </div>
              <button className="a-modal-close" onClick={() => setConfigTarget(null)}>
                关闭
              </button>
            </div>

            <div className="a-modal-body a-house-config-body">
              <div className="a-kv a-house-config-kv" style={{ flex: 1 }}>
                <div className="a-kv-row">
                  <div className="a-kv-k">月租（上架必填）</div>
                  <div className="a-kv-v">
                    <input
                      type="number"
                      className="a-filter-input"
                      value={configRentMonthly}
                      min={0}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        setConfigRentMonthly(Number.isNaN(n) ? 0 : Math.max(0, Math.floor(n)))
                      }}
                      style={{ width: 160 }}
                    />
                    <span className="a-muted" style={{ marginLeft: 8 }}>
                      元/月
                    </span>
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">房源图片（上架必填）</div>
                  <div className="a-kv-v">
                    <div className="a-muted" style={{ marginBottom: 8 }}>
                      已选 {configImages.length} 张（最多 10 张）；建议 2-3 张即可。
                    </div>

                    <div className="a-row" style={{ gap: 10, flexWrap: 'wrap' }}>
                      <label className="a-btn ghost" style={{ cursor: 'pointer' }}>
                        上传图片
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          style={{ display: 'none' }}
                          onChange={(e) => onConfigUploadImages(e.target.files)}
                        />
                      </label>
                      <button
                        type="button"
                        className="a-btn ghost"
                        onClick={() => setConfigImages(buildHouseImages(configTarget.id))}
                      >
                        生成3图
                      </button>
                      <button type="button" className="a-btn ghost" onClick={() => setConfigImages([])}>
                        清空
                      </button>
                    </div>

                    {configImages.length ? (
                      <div style={{ marginTop: 12 }}>
                        <div className="a-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                          {configImages.map((src, i) => (
                            <div
                              key={`${src}-${i}`}
                              style={{
                                width: 88,
                                height: 66,
                                borderRadius: 8,
                                overflow: 'hidden',
                                border: i === configImgIndex ? '2px solid #2563eb' : '1px solid rgba(15,23,42,0.12)',
                                position: 'relative',
                                cursor: 'pointer',
                              }}
                              onClick={() => setConfigImgIndex(i)}
                            >
                              <img src={src} alt={`房源图${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              <button
                                type="button"
                                className="a-modal-close"
                                style={{ position: 'absolute', top: -6, right: -6, fontSize: 12, width: 26, height: 26 }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setConfigImages((prev) => {
                                    const next = prev.filter((_, idx) => idx !== i)
                                    return next
                                  })
                                  setConfigImgIndex(0)
                                }}
                                title="删除"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">公寓地址（上架必填）</div>
                  <div className="a-kv-v">
                    <input
                      type="text"
                      className="a-filter-input"
                      value={configAddress}
                      onChange={(e) => setConfigAddress(e.target.value)}
                      placeholder="例如：南宁市邕宁区龙岗大道88号 花园公寓"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">地图坐标（非必填）</div>
                  <div className="a-kv-v">
                    <div className="a-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        className="a-filter-input"
                        value={configGeoLat}
                        onChange={(e) => setConfigGeoLat(e.target.value)}
                        placeholder="纬度 lat"
                        style={{ width: 160 }}
                      />
                      <input
                        type="text"
                        className="a-filter-input"
                        value={configGeoLng}
                        onChange={(e) => setConfigGeoLng(e.target.value)}
                        placeholder="经度 lng"
                        style={{ width: 160 }}
                      />
                      <span className="a-muted">不填也可以发布；不填则移动端地图页无法定位。</span>
                    </div>
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">附近地铁（非必填）</div>
                  <div className="a-kv-v">
                    <textarea
                      className="a-filter-input"
                      value={configSubwayText}
                      onChange={(e) => setConfigSubwayText(e.target.value)}
                      placeholder={'每行一条：站名|距离m\n例如：龙岗站|650'}
                      style={{ width: '100%', height: 84, resize: 'vertical' }}
                    />
                    <div className="a-muted" style={{ marginTop: 6 }}>
                      格式：站名|距离m（距离可不填）
                    </div>
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">附近学校（非必填）</div>
                  <div className="a-kv-v">
                    <textarea
                      className="a-filter-input"
                      value={configSchoolsText}
                      onChange={(e) => setConfigSchoolsText(e.target.value)}
                      placeholder={'每行一条：学校名|类型|距离m\n例如：邕宁区实验小学|小学|1100'}
                      style={{ width: '100%', height: 96, resize: 'vertical' }}
                    />
                    <div className="a-muted" style={{ marginTop: 6 }}>
                      格式：学校名|类型|距离m（后两项可不填）
                    </div>
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">附近公交（非必填）</div>
                  <div className="a-kv-v">
                    <textarea
                      className="a-filter-input"
                      value={configBusText}
                      onChange={(e) => setConfigBusText(e.target.value)}
                      placeholder={'每行一条：站名|线路1,线路2\n例如：龙岗大道·花园公寓站|W12,B02,B15'}
                      style={{ width: '100%', height: 96, resize: 'vertical' }}
                    />
                    <div className="a-muted" style={{ marginTop: 6 }}>
                      格式：站名|线路1,线路2（线路可留空）
                    </div>
                  </div>
                </div>

                <div className="a-muted">
                  上架校验：租金 {configRentMonthly > 0 ? '已填' : '未填'}，图片 {configImages.length > 0 ? '已填' : '未填'}，地址{' '}
                  {configAddress.trim() ? '已填' : '未填'}。
                </div>

                <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                  <button type="button" className="a-btn" onClick={saveConfigModal}>
                    保存配置
                  </button>
                  <button type="button" className="a-btn ghost" onClick={() => setConfigTarget(null)}>
                    取消
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

