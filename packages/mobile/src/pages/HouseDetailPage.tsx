import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiGet } from '../api'

type BusStop = { name: string; routes: string[] }

type House = {
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
  /// 后台「部门管理」里门店配置的电话与二维码（无配置时可为空）
  viewingContact?: { phone: string | null; qrUrl: string | null } | null
  // 以下为增强展示用字段：后端不一定返回，前端会做 demo 补全
  address?: string
  location?: { lat: number; lng: number }
  nearbySubway?: { name: string; distanceMeters?: number }[]
  nearbySchools?: { name: string; type?: string; distanceMeters?: number }[]
  nearbyBusStops?: BusStop[]
}

const STATUS_LABEL: Record<string, string> = {
  VACANT: '空置 · 可下单',
  RESERVED: '预留锁定（待签约/待付）',
  ORDERED: '下单锁定（待店长审核）',
  SIGNED: '已签约',
  TERMINATED: '已终止',
}

function houseDetailImageUrls(houseId: string): string[] {
  return [
    `https://picsum.photos/seed/${houseId}-1/800/600`,
    `https://picsum.photos/seed/${houseId}-2/800/600`,
    `https://picsum.photos/seed/${houseId}-3/800/600`,
  ]
}

// 后台未配置二维码时的占位（正式环境应主要在「部门管理」上传 / 填写 URL）
const VIEWING_QR_FALLBACK = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://work.weixin.qq.com'

function fmtDistance(m?: number) {
  if (!m || Number.isNaN(m)) return ''
  if (m >= 1000) return `${(m / 1000).toFixed(1)}km`
  return `${m}m`
}

function getHouseExtras(house: House): Pick<
  House,
  'address' | 'location' | 'nearbySubway' | 'nearbySchools' | 'nearbyBusStops'
> {
  // 真实业务里建议由后端直接返回这些字段；这里先用前端 Demo 补全，保证功能完整可演示
  const key = `${house.apartmentName}·${house.houseNo}`
  if (key.includes('邕宁') || key.includes('D1291')) {
    return {
      address: '广西壮族自治区南宁市邕宁区龙岗大道 88 号 花园公寓（示例地址）',
      location: { lat: 22.7596, lng: 108.4882 },
      nearbySubway: [
        { name: '龙岗站', distanceMeters: 650 },
        { name: '五象新区站', distanceMeters: 1900 },
      ],
      nearbySchools: [
        { name: '邕宁区实验小学', type: '小学', distanceMeters: 1100 },
        { name: '南宁市邕宁中学', type: '中学', distanceMeters: 2100 },
      ],
      nearbyBusStops: [
        { name: '龙岗大道·花园公寓站', routes: ['W12', 'B02', 'B15'] },
        { name: '龙岗站（地铁接驳）', routes: ['W12', 'K1'] },
      ],
    }
  }

  // 通用兜底：保证页面结构一致
  return {
    address: `${house.storeName} ${house.apartmentName}（示例地址待补充）`,
    location: { lat: 22.817, lng: 108.366 }, // 南宁附近的示例坐标
    nearbySubway: [],
    nearbySchools: [],
    nearbyBusStops: [],
  }
}

export function HouseDetailPage() {
  const { id } = useParams()
  const [house, setHouse] = useState<House | null>(null)
  const [error, setError] = useState('')
  const [showViewingModal, setShowViewingModal] = useState(false)
  const galleryRef = useRef<HTMLDivElement>(null)
  const [currentSlide, setCurrentSlide] = useState(0)

  const merged = useMemo<House | null>(() => {
    if (!house) return null
    const extras = getHouseExtras(house)
    return {
      ...extras,
      ...house,
      location: house.location ?? extras.location,
      address: house.address ?? extras.address,
      nearbySubway: house.nearbySubway?.length ? house.nearbySubway : extras.nearbySubway,
      nearbySchools: house.nearbySchools?.length ? house.nearbySchools : extras.nearbySchools,
      nearbyBusStops: house.nearbyBusStops?.length ? house.nearbyBusStops : extras.nearbyBusStops,
    }
  }, [house])

  const mapLink = useMemo(() => {
    if (!merged?.location) return ''
    return `/map?lat=${encodeURIComponent(String(merged.location.lat))}&lng=${encodeURIComponent(
      String(merged.location.lng),
    )}&name=${encodeURIComponent(`${merged.apartmentName}·${merged.houseNo}`)}&address=${encodeURIComponent(
      merged.address ?? '',
    )}`
  }, [merged])

  useEffect(() => {
    if (!id) return
    let alive = true
    apiGet<House>(`/api/houses/${id}`).then((r) => {
      if (!alive) return
      if (!r.ok) return setError(r.error)
      setHouse(r.data)
    })
    return () => {
      alive = false
    }
  }, [id])

  useEffect(() => {
    const el = galleryRef.current
    if (!el) return
    const onScroll = () => {
      const index = Math.round(el.scrollLeft / el.clientWidth)
      setCurrentSlide(Math.min(index, 2))
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [house?.id])

  if (error) return <div className="m-card m-error">加载失败：{error}</div>
  if (!house) return <div className="m-card">加载中…</div>

  if (!merged) return <div className="m-card">加载中…</div>

  const detailImages = merged.images?.length ? merged.images : houseDetailImageUrls(merged.id)
  const viewingQrSrc = merged.viewingContact?.qrUrl?.trim() || VIEWING_QR_FALLBACK
  const viewingPhone = merged.viewingContact?.phone?.trim() || ''

  return (
    <div className="m-col">
      {/* 房子图片：3 张可左右滑动 */}
      <div className="m-card" style={{ padding: 0 }}>
        <div className="m-detail-gallery" ref={galleryRef}>
          {detailImages.map((src, i) => (
            <div key={i} className="m-detail-gallery-slide">
              <img src={src} alt={`${merged.apartmentName} ${merged.houseNo} ${i + 1}`} />
            </div>
          ))}
        </div>
        <div className="m-detail-gallery-dots">
          {detailImages.map((_, i) => (
            <span
              key={i}
              className={`m-detail-gallery-dot ${i === currentSlide ? 'active' : ''}`}
              aria-hidden
            />
          ))}
        </div>
      </div>

      {/* 基本信息（不含押金，押金在签合同时配置） */}
      <div className="m-card">
        <div className="m-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="m-col" style={{ gap: 4 }}>
            <div className="m-h1">
              {merged.apartmentName} · {merged.houseNo}
            </div>
            <div className="m-muted">{merged.storeName}</div>
          </div>
          {mapLink ? (
            <Link
              to={mapLink}
              className="m-loc-btn"
              aria-label="查看地图位置"
              title="查看地图位置"
            >
              <span className="m-loc-btn-icon" aria-hidden>
                ⌖
              </span>
              <span className="m-loc-btn-text">地图</span>
            </Link>
          ) : null}
        </div>
        <div style={{ height: 14 }} />
        <div className="m-detail-grid">
          <div className="m-detail-item">
            <span className="m-detail-label">房型</span>
            <span className="m-detail-value">{merged.houseType}</span>
          </div>
          <div className="m-detail-item">
            <span className="m-detail-label">面积</span>
            <span className="m-detail-value">{merged.area}㎡</span>
          </div>
          <div className="m-detail-item">
            <span className="m-detail-label">月租</span>
            <span className="m-detail-value">¥{merged.rentMonthly}</span>
          </div>
          <div className="m-detail-item">
            <span className="m-detail-label">状态</span>
            <span className="m-detail-value">{STATUS_LABEL[merged.status] ?? merged.status}</span>
          </div>
        </div>
      </div>

      {/* 位置与交通 */}
      <div className="m-card">
        <div style={{ fontWeight: 900 }}>位置与交通</div>
        <div style={{ height: 10 }} />
        <div className="m-info-list">
          <div className="m-info-row">
            <div className="m-info-k">地址</div>
            <div className="m-info-v">{merged.address ?? '暂无'}</div>
          </div>

          <div className="m-info-row">
            <div className="m-info-k">地铁</div>
            <div className="m-info-v">
              {merged.nearbySubway && merged.nearbySubway.length > 0 ? (
                <div className="m-chip-wrap">
                  {merged.nearbySubway.map((s) => (
                    <span key={s.name} className="m-chip">
                      {s.name}
                      {fmtDistance(s.distanceMeters) ? ` · ${fmtDistance(s.distanceMeters)}` : ''}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="m-muted">暂无地铁信息</span>
              )}
            </div>
          </div>

          <div className="m-info-row">
            <div className="m-info-k">公交</div>
            <div className="m-info-v">
              {merged.nearbyBusStops && merged.nearbyBusStops.length > 0 ? (
                <div className="m-col" style={{ gap: 8 }}>
                  {merged.nearbyBusStops.map((bs) => (
                    <div key={bs.name} className="m-bus-row">
                      <div className="m-bus-name">{bs.name}</div>
                      <div className="m-chip-wrap">
                        {bs.routes.map((r) => (
                          <span key={r} className="m-chip subtle">
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="m-muted">暂无公交信息</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 周边配套 */}
      <div className="m-card">
        <div style={{ fontWeight: 900 }}>周边配套</div>
        <div style={{ height: 10 }} />
        <div className="m-info-list">
          <div className="m-info-row">
            <div className="m-info-k">学校</div>
            <div className="m-info-v">
              {merged.nearbySchools && merged.nearbySchools.length > 0 ? (
                <div className="m-col" style={{ gap: 8 }}>
                  {merged.nearbySchools.map((sch) => (
                    <div key={sch.name} className="m-school-row">
                      <div className="m-school-name">
                        {sch.name}
                        {sch.type ? <span className="m-school-type">{sch.type}</span> : null}
                      </div>
                      <div className="m-muted">{fmtDistance(sch.distanceMeters) ? `约 ${fmtDistance(sch.distanceMeters)}` : ''}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="m-muted">暂无学校信息</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {merged.status !== 'VACANT' ? (
        <div className="m-card" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
          <div style={{ fontWeight: 800, color: '#92400e' }}>该房源已被占用</div>
          <div className="m-muted" style={{ marginTop: 6 }}>
            他人已下单或流程进行中，您可浏览信息；开放下单后此处会恢复「直接下单」按钮。
          </div>
        </div>
      ) : null}

      {/* 预约看房 + 直接下单 */}
      <div className="m-row" style={{ gap: 10 }}>
        <button
          type="button"
          className="m-btn ghost"
          style={{ flex: 1 }}
          onClick={() => setShowViewingModal(true)}
        >
          预约看房
        </button>
        {merged.status === 'VACANT' ? (
          <Link className="m-btn" to={`/order/${merged.id}`} style={{ flex: 1, textAlign: 'center' }}>
            直接下单
          </Link>
        ) : (
          <span className="m-btn" style={{ flex: 1, textAlign: 'center', opacity: 0.5, pointerEvents: 'none' }}>
            暂不可下单
          </span>
        )}
      </div>

      {/* 预约看房弹窗：门店电话 + 二维码（数据来自后台部门管理-门店绑定） */}
      {showViewingModal ? (
        <div
          className="m-modal-backdrop"
          onClick={() => setShowViewingModal(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowViewingModal(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="m-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="m-modal-title">预约看房</div>
            <div className="m-modal-desc">
              可致电门店预约，或扫码添加企业微信联系客服
            </div>
            {viewingPhone ? (
              <div className="m-modal-phone">
                <span className="m-modal-phone-label">门店电话</span>
                <a className="m-modal-phone-num" href={`tel:${viewingPhone.replace(/\s+/g, '')}`}>
                  {viewingPhone}
                </a>
              </div>
            ) : (
              <div className="m-modal-desc" style={{ marginBottom: 12 }}>
                暂未配置门店电话，请优先扫码联系
              </div>
            )}
            <div className="m-modal-qr">
              <img src={viewingQrSrc} alt="企业微信二维码" />
            </div>
            <button
              type="button"
              className="m-modal-close"
              onClick={() => setShowViewingModal(false)}
            >
              关闭
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
