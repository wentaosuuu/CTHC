import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { apiGet, apiPost } from '../api'
import { getAdminToken } from '../auth'
import { Pagination, paginate } from '../components/Pagination'

/** 房源「房屋配置」常用项：始终展示，勾选表示具备（不可删除项，仅取消勾选） */
const PRESET_HOUSE_CONFIG_LABELS = [
  '电视',
  '沙发',
  '热水',
  '空调',
  '洗衣机',
  '冰箱',
  '宽带',
  '衣柜',
  '燃气灶',
  '热水器',
  '独立卫浴',
] as const

type HouseConfigRow = { label: string; on: boolean; preset: boolean }

function mergeHouseConfigWithPresets(saved: { label: string; on: boolean }[] | undefined): HouseConfigRow[] {
  const list = saved ?? []
  const map = new Map<string, boolean>()
  for (const x of list) {
    const k = (x.label ?? '').trim()
    if (k) map.set(k, Boolean(x.on))
  }
  const presetSet = new Set<string>([...PRESET_HOUSE_CONFIG_LABELS])
  const presets: HouseConfigRow[] = [...PRESET_HOUSE_CONFIG_LABELS].map((label) => ({
    label,
    on: map.get(label) ?? false,
    preset: true,
  }))
  const customs: HouseConfigRow[] = list
    .filter((x) => {
      const k = (x.label ?? '').trim()
      return k && !presetSet.has(k)
    })
    .map((x) => ({ label: x.label.trim(), on: Boolean(x.on), preset: false }))
  return [...presets, ...customs]
}

/** 写入接口：预设仅保存已勾选项；自定义标签无论是否具备均保存 */
function serializeHouseConfigForApi(rows: HouseConfigRow[]): { label: string; on: boolean }[] {
  const out: { label: string; on: boolean }[] = []
  const presetLabels = new Set<string>([...PRESET_HOUSE_CONFIG_LABELS])
  for (const row of rows) {
    const label = row.label.trim()
    if (!label) continue
    if (row.preset && presetLabels.has(label)) {
      if (row.on) out.push({ label, on: true })
      continue
    }
    out.push({ label, on: row.on })
  }
  return out
}

type HouseItem = {
  id: string
  houseBizId: string
  apartmentName: string
  assetType: string
  storeName: string
  projectName?: string | null
  rentCollectionUnit?: string | null
  managerName?: string | null
  mgmtDepartment?: string | null
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
  externalBrowseUrl?: string | null
  houseConfig?: { label: string; on: boolean }[]
  waterMeterNos?: string[]
  electricMeterNos?: string[]
  nearbySubway?: { name: string; distanceMeters?: number }[]
  nearbySchools?: { name: string; type?: string; distanceMeters?: number }[]
  nearbyBusStops?: { name: string; routes: string[] }[]
}

const MGMT_DEPARTMENT_OPTIONS = ['公寓管理部'] as const
const DEFAULT_MGMT_DEPARTMENT = '公寓管理部'

type HouseChangeLogRow = {
  id: string
  fieldLabel: string
  beforeValue: string
  afterValue: string
  changedAt: string
  operatorName: string
  operatorEmail: string
}

function projectDisplay(h: Pick<HouseItem, 'projectName' | 'storeName'>) {
  const p = (h.projectName ?? '').trim()
  return p || h.storeName
}

function formatChangedAt(iso: string | undefined) {
  const t = (iso ?? '').trim()
  if (!t) return '—'
  try {
    const d = new Date(t)
    if (Number.isNaN(d.getTime())) return t
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${day} ${hh}:${mm}`
  } catch {
    return t
  }
}

function formatHouseConfigSummary(items: { label: string; on: boolean }[] | undefined) {
  if (!items?.length) return '—'
  const parts = items
    .filter((x) => (x.label ?? '').trim())
    .map((x) => `${x.label.trim()}${x.on ? '' : '（无）'}`)
  return parts.length ? parts.join('、') : '—'
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
  <text x="150" y="265" font-family="system-ui, -apple-system, Segoe UI, Roboto" font-size="22" fill="#334155">${title} · 示意图 ${idx}</text>
  <g opacity="0.9">
    <rect x="150" y="360" width="260" height="160" rx="18" fill="#0f172a"/>
    <rect x="430" y="360" width="260" height="160" rx="18" fill="#1e293b"/>
    <rect x="710" y="360" width="320" height="160" rx="18" fill="#334155"/>
  </g>
  <text x="150" y="560" font-family="system-ui, -apple-system, Segoe UI, Roboto" font-size="18" fill="rgba(15,23,42,0.55)">该图片为系统内置生成示意图</text>
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
    remark: '后续可从资产系统同步或在后台补录。',
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
  const [dimProject, setDimProject] = useState('')
  const [dimAsset, setDimAsset] = useState('')
  const [dimRentUnit, setDimRentUnit] = useState('')
  const [dimManager, setDimManager] = useState('')
  const [apartmentFilter, setApartmentFilter] = useState('')
  const [houseTypeFilter, setHouseTypeFilter] = useState('')

  function resetHouseFilters() {
    setQ('')
    setStatus('')
    setStoreFilter('')
    setDimProject('')
    setDimAsset('')
    setDimRentUnit('')
    setDimManager('')
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
  const [configSubwayText, setConfigSubwayText] = useState<string>('')
  const [configSchoolsText, setConfigSchoolsText] = useState<string>('')
  const [configBusText, setConfigBusText] = useState<string>('')
  const [configExternalBrowseUrl, setConfigExternalBrowseUrl] = useState<string>('')
  const [configProjectName, setConfigProjectName] = useState('')
  const [configAssetType, setConfigAssetType] = useState('')
  const [configRentCollectionUnit, setConfigRentCollectionUnit] = useState('')
  const [configManagerName, setConfigManagerName] = useState('')
  const [configMgmtDepartment, setConfigMgmtDepartment] = useState(DEFAULT_MGMT_DEPARTMENT)
  const [configWaterMeters, setConfigWaterMeters] = useState<string[]>([''])
  const [configElectricMeters, setConfigElectricMeters] = useState<string[]>([''])
  const [configHouseConfig, setConfigHouseConfig] = useState<HouseConfigRow[]>([])
  const [newHouseTag, setNewHouseTag] = useState('')
  const [importResult, setImportResult] = useState<{ updated: number; errors: string[] } | null>(null)

  const [logModalHouse, setLogModalHouse] = useState<HouseItem | null>(null)
  const [changeLogs, setChangeLogs] = useState<HouseChangeLogRow[]>([])
  const [changeLogsLoading, setChangeLogsLoading] = useState(false)
  const [changeLogsError, setChangeLogsError] = useState('')

  async function openChangeLogModal(h: HouseItem) {
    setLogModalHouse(h)
    setChangeLogs([])
    setChangeLogsError('')
    setChangeLogsLoading(true)
    const r = await apiGet<{ items: HouseChangeLogRow[] }>(`/api/admin/houses/${h.id}/change-logs`)
    setChangeLogsLoading(false)
    if (!r.ok) {
      setChangeLogsError(r.error)
      return
    }
    setChangeLogs(r.data.items)
  }

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
    setImportResult(null)
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
    setImportResult(null)
    const r = await apiPost<{ ok: true; upsertedHouses: number }>('/api/admin/integrations/asset/sync-demo', {})
    if (!r.ok) return setError(r.error)
    setMsg(`已完成同步，更新房源数：${r.data.upsertedHouses}`)
    await load()
  }

  async function downloadHouseImportTemplate() {
    setError('')
    setImportResult(null)
    const token = getAdminToken()
    const res = await fetch('/api/admin/houses/import-template', {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) return setError('下载模板失败')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '资产维护模板.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function onHouseImportExcel(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    setError('')
    setImportResult(null)
    setMsg('')
    const fd = new FormData()
    fd.append('file', file)
    const token = getAdminToken()
    const res = await fetch('/api/admin/houses/import', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
    const j = (await res.json()) as { ok?: boolean; updated?: number; errors?: string[]; error?: string }
    if (!res.ok) return setError(j.error || '批量资产维护失败')
    const errors = j.errors ?? []
    const updated = j.updated ?? 0
    setImportResult({ updated, errors })
    setMsg(`资产维护已更新 ${updated} 条房源` + (errors.length ? `；另有 ${errors.length} 条提示见下方` : '。'))
    await load()
  }

  function addHouseTag() {
    const raw = newHouseTag.trim().slice(0, 80)
    if (!raw) return
    const presetSet = new Set<string>([...PRESET_HOUSE_CONFIG_LABELS])
    if (presetSet.has(raw)) {
      setNewHouseTag('')
      return
    }
    setConfigHouseConfig((prev) => {
      if (prev.some((x) => x.label.trim() === raw)) return prev
      return [...prev, { label: raw, on: true, preset: false }]
    })
    setNewHouseTag('')
  }

  function openConfigModal(h: HouseItem) {
    setConfigTarget(h)
    setConfigRentMonthly(h.rentMonthly)
    setConfigImages(h.images)
    setConfigImgIndex(0)
    setConfigAddress(h.address ? String(h.address) : '')
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
    setConfigExternalBrowseUrl((h.externalBrowseUrl ?? '').trim())
    setConfigProjectName((h.projectName ?? '').trim())
    setConfigAssetType(h.assetType || '')
    setConfigRentCollectionUnit((h.rentCollectionUnit ?? '').trim())
    setConfigManagerName((h.managerName ?? '').trim())
    setConfigMgmtDepartment((h.mgmtDepartment ?? '').trim() || DEFAULT_MGMT_DEPARTMENT)
    const wm = (h.waterMeterNos ?? []).map((x) => String(x).trim()).filter(Boolean)
    const em = (h.electricMeterNos ?? []).map((x) => String(x).trim()).filter(Boolean)
    setConfigWaterMeters(wm.length ? wm : [''])
    setConfigElectricMeters(em.length ? em : [''])
    setConfigHouseConfig(mergeHouseConfigWithPresets(h.houseConfig))
    setNewHouseTag('')
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
    const nearbySubway = parseSubway(configSubwayText)
    const nearbySchools = parseSchools(configSchoolsText)
    const nearbyBusStops = parseBusStops(configBusText)

    if (!address) {
      setError('请填写公寓地址')
      return
    }

    if (!configAssetType.trim()) {
      setError('请填写资产类型')
      return
    }

    const houseConfig = serializeHouseConfigForApi(configHouseConfig)

    const r = await apiPost<{ ok: true; id: string }>(`/api/admin/houses/${configTarget.id}/config`, {
      rentMonthly,
      images,
      address,
      nearbySubway,
      nearbySchools,
      nearbyBusStops,
      externalBrowseUrl: configExternalBrowseUrl.trim() === '' ? '' : configExternalBrowseUrl.trim(),
      houseConfig,
      projectName: configProjectName.trim() === '' ? '' : configProjectName.trim(),
      assetType: configAssetType.trim(),
      rentCollectionUnit: configRentCollectionUnit.trim() === '' ? '' : configRentCollectionUnit.trim(),
      managerName: configManagerName.trim() === '' ? '' : configManagerName.trim(),
      mgmtDepartment: configMgmtDepartment.trim() === '' ? '' : configMgmtDepartment.trim(),
      waterMeterNos: configWaterMeters.map((s) => s.trim()).filter(Boolean),
      electricMeterNos: configElectricMeters.map((s) => s.trim()).filter(Boolean),
    })
    if (!r.ok) return setError(r.error)
    setMsg('已保存房源配置（含首页同源维度：项目名称 / 资产类型 / 收租单位 / 管理人 / 管理部门）')
    setConfigTarget(null)
    await load()
  }

  const filterOptions = useMemo(() => {
    const stores = Array.from(new Set(items.map((h) => h.storeName).filter(Boolean))).sort()
    const projects = Array.from(new Set(items.map((h) => projectDisplay(h)).filter(Boolean))).sort()
    const dimAssets = Array.from(new Set(items.map((h) => h.assetType).filter(Boolean))).sort()
    const rentUnits = Array.from(new Set(items.map((h) => (h.rentCollectionUnit ?? '').trim()).filter(Boolean))).sort()
    const managers = Array.from(new Set(items.map((h) => (h.managerName ?? '').trim()).filter(Boolean))).sort()
    const apartments = Array.from(new Set(items.map((h) => h.apartmentName).filter(Boolean))).sort()
    const houseTypes = Array.from(new Set(items.map((h) => h.houseType).filter(Boolean))).sort()
    return { stores, projects, dimAssets, rentUnits, managers, apartments, houseTypes }
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
      if (dimProject && projectDisplay(h) !== dimProject) return false
      if (dimAsset && h.assetType !== dimAsset) return false
      if (dimRentUnit && (h.rentCollectionUnit?.trim() || '') !== dimRentUnit) return false
      if (dimManager && (h.managerName?.trim() || '') !== dimManager) return false
      if (apartmentFilter && h.apartmentName !== apartmentFilter) return false
      if (houseTypeFilter && h.houseType !== houseTypeFilter) return false
      if (!kw) return true
      const hay = `${h.houseBizId} ${h.storeName} ${projectDisplay(h)} ${h.apartmentName} ${h.assetType ?? ''} ${(h.rentCollectionUnit ?? '').trim()} ${(h.managerName ?? '').trim()} ${h.houseNo} ${h.houseType}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, status, storeFilter, dimProject, dimAsset, dimRentUnit, dimManager, apartmentFilter, houseTypeFilter])

  const pageData = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize])

  return (
    <div className="a-col">
      <div className="a-h1">资产管理</div>
      {error ? <div className="a-card a-error">操作失败：{error}</div> : null}
      {msg ? <div className="a-card a-success">{msg}</div> : null}

      {importResult?.errors?.length ? (
        <div className="a-card" style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', borderColor: '#fde68a' }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>导入提示（前若干条）</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {importResult.errors.slice(0, 20).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          {importResult.errors.length > 20 ? <div className="a-muted" style={{ marginTop: 6 }}>…共 {importResult.errors.length} 条</div> : null}
        </div>
      ) : null}

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
            placeholder="搜索：资产编号/门店/项目/公寓/房号/房型"
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
            value={dimProject}
            onChange={(e) => {
              setDimProject(e.target.value)
              setPage(1)
            }}
            title="项目名称（空则沿用门店名）"
          >
            <option value="">全部项目</option>
            {filterOptions.projects.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            className="a-filter-select"
            value={dimAsset}
            onChange={(e) => {
              setDimAsset(e.target.value)
              setPage(1)
            }}
            title="资产类型"
          >
            <option value="">全部资产类型</option>
            {filterOptions.dimAssets.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select
            className="a-filter-select"
            value={dimRentUnit}
            onChange={(e) => {
              setDimRentUnit(e.target.value)
              setPage(1)
            }}
            title="收租单位"
          >
            <option value="">全部收租单位</option>
            {filterOptions.rentUnits.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <select
            className="a-filter-select"
            value={dimManager}
            onChange={(e) => {
              setDimManager(e.target.value)
              setPage(1)
            }}
            title="管理人"
          >
            <option value="">全部管理人</option>
            {filterOptions.managers.map((m) => (
              <option key={m} value={m}>{m}</option>
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
          <button type="button" className="a-btn ghost" onClick={downloadHouseImportTemplate}>
            下载资产维护模板
          </button>
          <label className="a-btn ghost" style={{ cursor: 'pointer' }}>
            批量资产维护
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              style={{ display: 'none' }}
              onChange={onHouseImportExcel}
            />
          </label>
        </div>
      </div>

      <div className="a-card a-muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
        <strong style={{ color: '#334155' }}>状态说明：</strong>
        租客下单 →「下单锁定」（他人不可下单）；店长通过 →「预留锁定」（待签约/待付）；支付成功 →「已签约」。
        未上架/未配置（缺租金、图片或公寓地址）→ 状态会显示「未配置/未上架」，H5 不可见、不可下单。
        未支付超时、作废待付合同、审核拒绝 → 恢复「空置 · 可下单」（前提是已上架）。
        批量维护：先「下载资产维护模板」，第一列为房源业务编号（与列表「房源ID」FY 开头一致），其余列按需填写后使用「批量资产维护」上传。
      </div>

      <div className="a-card">
        <div className="a-table-wrap">
        <table className="a-table a-table-sticky-op">
          <thead>
            <tr>
              <th>房源ID</th>
              <th>门店</th>
              <th>项目名称</th>
              <th>资产类型</th>
              <th>收租单位</th>
              <th>管理人</th>
              <th>管理部门</th>
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
                <td>
                  <div style={{ fontWeight: 800 }}>{projectDisplay(h)}</div>
                  {(h.projectName ?? '').trim() ? (
                    <div className="a-muted" style={{ fontSize: 11, marginTop: 2 }}>
                      门店：{h.storeName}
                    </div>
                  ) : null}
                </td>
                <td>{h.assetType}</td>
                <td>{(h.rentCollectionUnit ?? '').trim() || '—'}</td>
                <td>{(h.managerName ?? '').trim() || '—'}</td>
                <td>{(h.mgmtDepartment ?? '').trim() || DEFAULT_MGMT_DEPARTMENT}</td>
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
                  <div className="a-op-actions a-op-actions--assets">
                    <button type="button" className="a-btn" onClick={() => openConfigModal(h)}>
                      房源配置
                    </button>
                    <button type="button" className="a-btn ghost" onClick={() => void openChangeLogModal(h)}>
                      变更记录
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
                <td colSpan={15} className="a-muted">
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
                    { k: '项目名称', v: projectDisplay(detail) },
                    { k: '资产类型', v: detail.assetType },
                    { k: '收租单位', v: (detail.rentCollectionUnit ?? '').trim() || '—' },
                    { k: '管理人', v: (detail.managerName ?? '').trim() || '—' },
                    { k: '管理部门', v: (detail.mgmtDepartment ?? '').trim() || DEFAULT_MGMT_DEPARTMENT },
                    { k: '水表号', v: (detail.waterMeterNos ?? []).filter(Boolean).join('、') || '—' },
                    { k: '电表号', v: (detail.electricMeterNos ?? []).filter(Boolean).join('、') || '—' },
                    { k: '公寓', v: detail.apartmentName },
                    { k: '房号', v: detail.houseNo },
                    { k: '房型', v: detail.houseType },
                    { k: '面积', v: `${detail.area}㎡` },
                    { k: '月租', v: `¥${detail.rentMonthly}` },
                    { k: '押金', v: `¥${detail.deposit}` },
                    { k: '状态', v: adminStatusLabel(detail) },
                    { k: 'H5仅浏览外链', v: detail.externalBrowseUrl?.trim() || '—' },
                    { k: '房屋配置', v: formatHouseConfigSummary(detail.houseConfig) },
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

                <div className="a-kv-row" style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, marginTop: 4 }}>
                  <div className="a-kv-k">项目名称</div>
                  <div className="a-kv-v">
                    <input
                      type="text"
                      className="a-filter-input"
                      value={configProjectName}
                      onChange={(e) => setConfigProjectName(e.target.value)}
                      placeholder={`默认与门店一致：${configTarget.storeName}`}
                      style={{ maxWidth: 380 }}
                    />
                    <div className="a-muted" style={{ fontSize: 11, marginTop: 4 }}>
                      留空则首页/列表「项目名称」与门店名称一致；填写后用于经营看板独立展示。
                    </div>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">资产类型</div>
                  <div className="a-kv-v">
                    <input
                      type="text"
                      className="a-filter-input"
                      value={configAssetType}
                      onChange={(e) => setConfigAssetType(e.target.value)}
                      style={{ maxWidth: 280 }}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">收租单位</div>
                  <div className="a-kv-v">
                    <input
                      type="text"
                      className="a-filter-input"
                      value={configRentCollectionUnit}
                      onChange={(e) => setConfigRentCollectionUnit(e.target.value)}
                      placeholder="如：物业公司 / 运营中心"
                      style={{ maxWidth: 320 }}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">管理人</div>
                  <div className="a-kv-v">
                    <input
                      type="text"
                      className="a-filter-input"
                      value={configManagerName}
                      onChange={(e) => setConfigManagerName(e.target.value)}
                      placeholder="责任人姓名"
                      style={{ maxWidth: 240 }}
                    />
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">管理部门</div>
                  <div className="a-kv-v">
                    <select
                      className="a-filter-select"
                      value={configMgmtDepartment}
                      onChange={(e) => setConfigMgmtDepartment(e.target.value)}
                      style={{ minWidth: 200 }}
                    >
                      {MGMT_DEPARTMENT_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                      {configMgmtDepartment &&
                      !(MGMT_DEPARTMENT_OPTIONS as readonly string[]).includes(configMgmtDepartment) ? (
                        <option value={configMgmtDepartment}>{configMgmtDepartment}</option>
                      ) : null}
                    </select>
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">水表号</div>
                  <div className="a-kv-v">
                    <div className="a-muted" style={{ marginBottom: 6, fontSize: 12 }}>
                      可维护多个；账单导入时可填「水表号」与合同/资产联动。
                    </div>
                    {configWaterMeters.map((row, idx) => (
                      <div key={`wm-${idx}`} className="a-row" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <input
                          className="a-filter-input"
                          style={{ minWidth: 220 }}
                          value={row}
                          onChange={(e) =>
                            setConfigWaterMeters((p) => p.map((x, j) => (j === idx ? e.target.value : x)))
                          }
                          placeholder="例如 WS-001"
                        />
                        <button
                          type="button"
                          className="a-btn ghost"
                          onClick={() =>
                            setConfigWaterMeters((p) => (p.length <= 1 ? [''] : p.filter((_, j) => j !== idx)))
                          }
                        >
                          删除
                        </button>
                      </div>
                    ))}
                    <button type="button" className="a-btn ghost" onClick={() => setConfigWaterMeters((p) => [...p, ''])}>
                      添加水表号
                    </button>
                  </div>
                </div>
                <div className="a-kv-row">
                  <div className="a-kv-k">电表号</div>
                  <div className="a-kv-v">
                    <div className="a-muted" style={{ marginBottom: 6, fontSize: 12 }}>
                      可维护多个；账单导入时可填「电表号」与合同/资产联动。
                    </div>
                    {configElectricMeters.map((row, idx) => (
                      <div key={`em-${idx}`} className="a-row" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <input
                          className="a-filter-input"
                          style={{ minWidth: 220 }}
                          value={row}
                          onChange={(e) =>
                            setConfigElectricMeters((p) => p.map((x, j) => (j === idx ? e.target.value : x)))
                          }
                          placeholder="例如 EL-001"
                        />
                        <button
                          type="button"
                          className="a-btn ghost"
                          onClick={() =>
                            setConfigElectricMeters((p) => (p.length <= 1 ? [''] : p.filter((_, j) => j !== idx)))
                          }
                        >
                          删除
                        </button>
                      </div>
                    ))}
                    <button type="button" className="a-btn ghost" onClick={() => setConfigElectricMeters((p) => [...p, ''])}>
                      添加电表号
                    </button>
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
                  <div className="a-kv-k">H5 仅浏览外链</div>
                  <div className="a-kv-v">
                    <div className="a-muted" style={{ marginBottom: 8 }}>
                      非「泊湾公寓」资产在租客端下单页会显示「仅浏览」按钮，用于打开合作方展示页。
                      「直接下单」始终提交订单至本系统后台，无需配置外链。链接须以 http:// 或 https:// 开头。
                    </div>
                    <input
                      type="url"
                      className="a-filter-input"
                      value={configExternalBrowseUrl}
                      onChange={(e) => setConfigExternalBrowseUrl(e.target.value)}
                      placeholder="https://…"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">房屋配置</div>
                  <div className="a-kv-v">
                    <div className="a-muted" style={{ marginBottom: 10 }}>
                      <strong>常用配置（预设）</strong>：直接勾选表示具备；取消勾选表示不具备（不可删除预设项）。
                      若仍不够，可在下方<strong>自定义标签</strong>中补充，自定义项可删除。
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>常用配置</div>
                    <div
                      className="a-row"
                      style={{
                        flexWrap: 'wrap',
                        gap: 8,
                        alignItems: 'center',
                        marginBottom: 14,
                      }}
                    >
                      {configHouseConfig
                        .filter((row) => row.preset)
                        .map((row) => (
                          <label
                            key={`preset-${row.label}`}
                            className="a-row"
                            style={{
                              alignItems: 'center',
                              gap: 6,
                              padding: '6px 12px',
                              borderRadius: 999,
                              border: '1px solid rgba(15,23,42,0.14)',
                              background: row.on ? 'rgba(219,234,254,0.65)' : 'rgba(248,250,252,0.95)',
                              cursor: 'pointer',
                              margin: 0,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={row.on}
                              onChange={(e) => {
                                const on = e.target.checked
                                setConfigHouseConfig((prev) =>
                                  prev.map((r) => (r.preset && r.label === row.label ? { ...r, on } : r)),
                                )
                              }}
                            />
                            <span style={{ fontSize: 13 }}>{row.label}</span>
                          </label>
                        ))}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>自定义标签</div>
                    <div
                      className="a-row"
                      style={{
                        flexWrap: 'wrap',
                        gap: 8,
                        alignItems: 'center',
                        marginBottom: 10,
                        minHeight: 28,
                      }}
                    >
                      {configHouseConfig.filter((r) => !r.preset).length === 0 ? (
                        <span className="a-muted">暂无，可在下方添加</span>
                      ) : (
                        configHouseConfig
                          .map((row, idx) => ({ row, idx }))
                          .filter(({ row }) => !row.preset)
                          .map(({ row, idx }) => (
                            <span
                              key={`custom-${row.label}-${idx}`}
                              className="a-row"
                              style={{
                                alignItems: 'center',
                                gap: 6,
                                padding: '4px 8px 4px 6px',
                                borderRadius: 999,
                                border: '1px solid rgba(15,23,42,0.14)',
                                background: 'rgba(248,250,252,0.95)',
                              }}
                            >
                              <label className="a-row" style={{ gap: 4, cursor: 'pointer', margin: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={row.on}
                                  onChange={(e) => {
                                    const on = e.target.checked
                                    setConfigHouseConfig((prev) =>
                                      prev.map((r, i) => (i === idx ? { ...r, on } : r)),
                                    )
                                  }}
                                />
                                <span style={{ fontSize: 13 }}>{row.label}</span>
                              </label>
                              <button
                                type="button"
                                className="a-modal-close"
                                style={{
                                  width: 22,
                                  height: 22,
                                  fontSize: 14,
                                  lineHeight: 1,
                                  padding: 0,
                                }}
                                title="删除该自定义标签"
                                onClick={() =>
                                  setConfigHouseConfig((prev) => prev.filter((_, i) => i !== idx))
                                }
                              >
                                ×
                              </button>
                            </span>
                          ))
                      )}
                    </div>
                    <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input
                        className="a-filter-input"
                        style={{ flex: 1, minWidth: 160, maxWidth: 280 }}
                        value={newHouseTag}
                        placeholder="自定义标签，如：地暖（与预设重复则请直接勾选预设）"
                        maxLength={80}
                        onChange={(e) => setNewHouseTag(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            addHouseTag()
                          }
                        }}
                      />
                      <button type="button" className="a-btn ghost" onClick={addHouseTag}>
                        添加标签
                      </button>
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

      {logModalHouse ? (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLogModalHouse(null)
          }}
        >
          <div className="a-modal a-modal--change-log">
            <div className="a-modal-header">
              <div className="a-modal-title">
                变更记录 · {logModalHouse.apartmentName} {logModalHouse.houseNo}（{projectDisplay(logModalHouse)}）
              </div>
              <button className="a-modal-close" onClick={() => setLogModalHouse(null)}>
                关闭
              </button>
            </div>
            <div className="a-modal-body">
              {changeLogsLoading ? <div className="a-muted">加载中…</div> : null}
              {changeLogsError ? <div className="a-card a-error">加载失败：{changeLogsError}</div> : null}
              {!changeLogsLoading && !changeLogsError && changeLogs.length === 0 ? (
                <div className="a-muted">暂无变更记录（保存「房源配置」或上下架后会自动生成）。</div>
              ) : null}
              {!changeLogsLoading && !changeLogsError && changeLogs.length > 0 ? (
                <div className="a-table-wrap a-change-log-wrap">
                  <table className="a-table a-change-log-table" style={{ minWidth: 920, width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ width: 120 }}>变更项</th>
                        <th>变更前</th>
                        <th>变更后</th>
                        <th style={{ width: 168 }}>变更时间</th>
                        <th style={{ width: 200 }}>操作人</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changeLogs.map((row) => (
                        <tr key={row.id}>
                          <td style={{ fontWeight: 800 }}>{row.fieldLabel}</td>
                          <td className="a-change-log-cell">{row.beforeValue || '—'}</td>
                          <td className="a-change-log-cell">{row.afterValue || '—'}</td>
                          <td className="a-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                            {formatChangedAt(row.changedAt)}
                          </td>
                          <td style={{ fontSize: 12 }}>
                            <div style={{ fontWeight: 800 }}>{row.operatorName}</div>
                            <div className="a-muted">{row.operatorEmail}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

