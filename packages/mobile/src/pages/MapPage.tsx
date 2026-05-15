import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

function useQuery() {
  const loc = useLocation()
  return useMemo(() => new URLSearchParams(loc.search), [loc.search])
}

function toNum(v: string | null) {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function MapPage() {
  const q = useQuery()
  const lat = toNum(q.get('lat'))
  const lng = toNum(q.get('lng'))
  const name = q.get('name') ?? '地图'
  const address = q.get('address') ?? ''

  if (lat == null || lng == null) {
    return (
      <div className="m-col">
        <div className="m-card m-error">缺少定位信息，无法展示地图。</div>
      </div>
    )
  }

  // OpenStreetMap embed（无需 key，适合 Demo/开发演示）
  const delta = 0.01
  const left = lng - delta
  const right = lng + delta
  const top = lat + delta
  const bottom = lat - delta
  const osmEmbed = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
    `${left},${bottom},${right},${top}`,
  )}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lng}`)}`

  return (
    <div className="m-col">
      <div className="m-card">
        <div className="m-h1">地图位置</div>
        <div className="m-muted" style={{ marginTop: 4 }}>
          {name}
          {address ? ` · ${address}` : ''}
        </div>
      </div>

      <div className="m-card" style={{ padding: 0, overflow: 'hidden' }}>
        <iframe
          title="map"
          src={osmEmbed}
          className="m-map-iframe"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  )
}

