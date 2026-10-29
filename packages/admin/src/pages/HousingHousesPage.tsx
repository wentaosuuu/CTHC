import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiGet } from '../api'
import { readAssetSupplement } from '../assetDevelopment'
import { readEnabledDemoBrokers } from '../brokerDemoData'
import { DemoDialog } from '../components/DemoDialog'
import { Pagination, paginate } from '../components/Pagination'
import { emptyHousing, readHousingRecords, HOUSING_STORAGE_KEY, type HousingRecord } from '../housingDemoData'

type House = { id: string; houseBizId: string; apartmentName: string; houseNo: string; storeName: string; projectName?: string | null; images?: string[] }
type Stage = '流程中' | '待开始' | '全部'
type MaintenanceTab = '基础信息' | '产权核验' | '住建上架'
const VERIFY_STATES = ['未上报', '核验中', '核验不通过', '已核验'] as const
const RELEASE_STATES = ['未上架', '已上架'] as const
function getRecord(id: string, records = readHousingRecords()): HousingRecord {
  const record = records[id]
  const defaults = emptyHousing()
  const next: HousingRecord = { ...defaults, owner: readAssetSupplement(id).ownerName }
  if (!record || typeof record !== 'object') return next
  for (const key of Object.keys(defaults) as (keyof HousingRecord)[]) {
    if (key === 'logs') continue
    const value = record[key]
    if (typeof value === typeof defaults[key] && (typeof value !== 'number' || Number.isFinite(value))) {
      Object.assign(next, { [key]: value })
    }
  }
  next.logs = Array.isArray(record.logs) ? record.logs.filter((log) => log && typeof log === 'object'
    && typeof log.action === 'string' && typeof log.result === 'string' && typeof log.reason === 'string' && typeof log.time === 'string') : []
  if (!(VERIFY_STATES as readonly string[]).includes(next.verifyStatus)) next.verifyStatus = '未上报'
  if (!(RELEASE_STATES as readonly string[]).includes(next.releaseStatus)) next.releaseStatus = '未上架'
  return next
}
function progress(record: HousingRecord) {
  if (record.releaseStatus === '已上架') return '已上架'
  if (record.verifyStatus === '已核验') return '已核验待上架'
  if (record.verifyStatus === '未上报') return '待核验'
  return record.verifyStatus
}
function formatTime(value: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

export function HousingHousesPage() {
  const location = useLocation()
  const requestedHouseId = new URLSearchParams(location.search).get('houseId') || ''
  const [houses, setHouses] = useState<House[]>([])
  const [records, setRecords] = useState(readHousingRecords)
  const [selectedId, setSelectedId] = useState(requestedHouseId)
  const [draft, setDraft] = useState(() => getRecord(requestedHouseId))
  const [tab, setTab] = useState<MaintenanceTab>('产权核验')
  const [stage, setStage] = useState<Stage>('流程中')
  const [keyword, setKeyword] = useState('')
  const [verifyFilter, setVerifyFilter] = useState('')
  const [releaseFilter, setReleaseFilter] = useState('')
  const [applied, setApplied] = useState({ keyword: '', verify: '', release: '' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalError, setModalError] = useState('')
  const [message, setMessage] = useState('')
  const [modalMessage, setModalMessage] = useState('')
  const [scenario, setScenario] = useState('')

  useEffect(() => {
    let active = true
    void apiGet<{ items: House[] }>('/api/admin/houses').then((result) => {
      if (!active) return
      if (result.ok) setHouses(result.data.items)
      else setError(result.error)
    }).catch(() => { if (active) setError('房源加载失败，请检查本地演示服务后重试。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  async function reload() {
    setLoading(true); setError('')
    try {
      const result = await apiGet<{ items: House[] }>('/api/admin/houses')
      if (result.ok) { setHouses(result.data.items); setRecords(readHousingRecords()) }
      else setError(result.error)
    } catch { setError('房源加载失败，请重试。') }
    finally { setLoading(false) }
  }
  const selectedHouse = houses.find((house) => house.id === selectedId)
  const persisted = selectedId ? getRecord(selectedId, records) : emptyHousing()
  const brokers = readEnabledDemoBrokers()
  const missingBase = [!persisted.ownerId.trim() ? '权利人证件号' : '', !persisted.certificate.trim() ? '产权证号' : ''].filter(Boolean)
  const canVerify = missingBase.length === 0 && brokers.some((broker) => broker.id === draft.broker)
  const stats = useMemo(() => {
    const result = { '流程中': 0, '待核验': 0, '核验中': 0, '核验不通过': 0, '已核验待上架': 0, '已上架': 0 }
    for (const house of houses) {
      const row = getRecord(house.id, records)
      if (row.verifyStatus !== '未上报' || row.releaseStatus === '已上架') result['流程中'] += 1
      const key = progress(row)
      if (key in result) result[key as keyof typeof result] += 1
    }
    return result
  }, [houses, records])
  const filtered = useMemo(() => houses.filter((house) => {
    const row = getRecord(house.id, records)
    const started = row.verifyStatus !== '未上报' || row.releaseStatus === '已上架'
    if (stage === '流程中' && !started) return false
    if (stage === '待开始' && started) return false
    if (applied.verify && row.verifyStatus !== applied.verify) return false
    if (applied.release && row.releaseStatus !== applied.release) return false
    const text = `${house.apartmentName} ${house.houseNo} ${house.houseBizId} ${house.storeName} ${house.projectName ?? ''}`.toLowerCase()
    return !applied.keyword.trim() || text.includes(applied.keyword.trim().toLowerCase())
  }), [houses, records, stage, applied])
  const paged = paginate(filtered, page, pageSize)
  function openMaintenance(house: House) {
    setSelectedId(house.id); setDraft(getRecord(house.id, records)); setTab('产权核验')
    setModalError(''); setModalMessage(''); setScenario('')
  }
  function patch<K extends keyof HousingRecord>(key: K, value: HousingRecord[K]) {
    setDraft((previous) => ({ ...previous, [key]: value })); setModalError(''); setModalMessage('')
  }
  function commit(next: HousingRecord, action: string, result: string, reason = '') {
    if (!selectedId) return false
    const now = new Date().toISOString()
    const saved = { ...next, updatedAt: now, logs: [{ action, result, reason, time: now }, ...persisted.logs] }
    const nextRecords = { ...readHousingRecords(), [selectedId]: saved }
    try {
      localStorage.setItem(HOUSING_STORAGE_KEY, JSON.stringify({ version: 1, records: nextRecords }))
    } catch {
      setModalError('本机存储不可用或空间不足，本次操作未保存。请重试。')
      return false
    }
    setRecords(nextRecords); setDraft(saved); setModalError('')
    setModalMessage(`${action}已保存，仅用于本地原型评审。`)
    window.dispatchEvent(new Event('cthc:housing-changed'))
    return true
  }
  function saveBase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    commit({ ...persisted, owner: draft.owner.trim(), ownerId: draft.ownerId.trim(), certificate: draft.certificate.trim(),
      district: draft.district.trim(), source: draft.source.trim() }, '保存基础信息', '本地保存成功')
  }
  function startVerification() {
    if (!canVerify) { setModalError('请先保存权利人证件号、产权证号并选择启用经纪人。'); return }
    commit({ ...persisted, broker: draft.broker, method: draft.method, verifyStatus: '核验中', code: '', releaseStatus: '未上架' },
      '发起核验（演示）', '核验中', '仅变更本地演示状态，未向住建平台提交')
  }
  function applyScenario() {
    if (!scenario) return
    if (missingBase.length > 0 || !brokers.some((broker) => broker.id === draft.broker)) {
      setModalError('演示后续场景前，请先补齐基础信息并选择启用经纪人。'); return
    }
    const approved = scenario === '已核验'
    commit({ ...persisted, broker: draft.broker, method: draft.method, verifyStatus: scenario, releaseStatus: '未上架',
      code: approved ? `DEMO-HY-${selectedId.slice(-6).toUpperCase()}` : '' },
    '切换评审演示场景', approved ? '已核验（模拟）' : '核验不通过（模拟）', approved ? '模拟场景，无真实核验效力' : '演示失败原因：产权资料待补正')
    setScenario('')
  }
  function release() {
    setModalError('')
    if (persisted.verifyStatus !== '已核验') { setModalError('须先完成产权核验。'); return }
    try {
      const url = new URL(draft.h5)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid')
    } catch { setModalError('请填写以 http:// 或 https:// 开头的 H5 展示链接。'); return }
    if (draft.floor > draft.floors) { setModalError('所在层不能大于总楼层。'); return }
    commit({ ...draft, releaseStatus: '已上架' }, '住建上架（演示）', '本地上架成功', '未向住建平台提交上架请求')
  }

  return <div className="a-col">
    <div className="a-row" style={{ justifyContent: 'space-between' }}><div className="a-h1">房源住建</div>
      <button type="button" className="a-btn ghost" onClick={reload} disabled={loading}>{loading ? '加载中…' : '刷新'}</button></div>
    <div className="a-card a-muted">本页使用本地 DEMO 房源及本机保存的住建资料。核验、上架与下架均为评审演示，不向外部住建平台提交。</div>
    {error ? <div className="a-card a-error" role="alert">{error}</div> : null}
    {message ? <div className="a-card a-success" role="status">{message}</div> : null}
    {!loading && requestedHouseId && !houses.some((house) => house.id === requestedHouseId) ? <div className="a-card a-muted">资产链接对应的本地房源不存在，请从下方列表重新选择。</div> : null}
    <div className="a-row" role="group" aria-label="房源流程范围">{(['流程中', '待开始', '全部'] as Stage[]).map((value) => <button key={value} type="button"
      className={stage === value ? 'a-btn' : 'a-btn ghost'} aria-pressed={stage === value} onClick={() => { setStage(value); setPage(1) }}>{value}</button>)}</div>
    <section className="a-row" aria-label="住建流程统计" style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>
      {Object.entries(stats).map(([label, count]) => <article key={label} className="a-card" style={{ flex: '1 1 130px' }}><div className="a-muted">{label}</div><div style={{ fontSize: 26, fontWeight: 900, marginTop: 8 }}>{count}</div></article>)}
    </section>
    <form className="a-card a-filterbar" style={{ flexWrap: 'wrap' }} onSubmit={(event) => { event.preventDefault(); setApplied({ keyword, verify: verifyFilter, release: releaseFilter }); setPage(1) }}>
      <label>关键词 <input className="a-filter-input" value={keyword} placeholder="公寓名/房号/房源ID/门店/项目" onChange={(event) => setKeyword(event.target.value)} /></label>
      <label>核验状态 <select className="a-filter-select" value={verifyFilter} onChange={(event) => setVerifyFilter(event.target.value)}><option value="">全部核验状态</option>{VERIFY_STATES.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>上架状态 <select className="a-filter-select" value={releaseFilter} onChange={(event) => setReleaseFilter(event.target.value)}><option value="">全部上架状态</option>{RELEASE_STATES.map((value) => <option key={value}>{value}</option>)}</select></label>
      <button className="a-btn" type="submit">搜索</button><button className="a-btn ghost" type="button" onClick={() => { setKeyword(''); setVerifyFilter(''); setReleaseFilter(''); setApplied({ keyword: '', verify: '', release: '' }); setPage(1) }}>重置</button>
    </form>
    <div className="a-card"><div className="a-table-wrap"><table className="a-table"><thead><tr>{['房源', '房源ID', '门店', '项目', '城区', '权利人', '流程进度', '核验码', '最近更新', '操作'].map((label) => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{paged.items.map((house) => { const record = getRecord(house.id, records); return <tr key={house.id}>
        <td>{house.apartmentName}<div className="a-muted">房号：{house.houseNo || '—'}</div></td><td>{house.houseBizId}</td><td>{house.storeName}</td><td>{house.projectName || '—'}</td><td>{record.district || '—'}</td><td>{record.owner || '—'}</td><td><span className="a-badge">{progress(record)}</span></td><td>{record.code || '—'}</td><td>{formatTime(record.updatedAt)}</td>
        <td><button className="a-btn ghost" type="button" onClick={() => openMaintenance(house)}>去核验</button></td></tr> })}
      {paged.items.length === 0 ? <tr><td colSpan={10} style={{ textAlign: 'center', padding: 36 }}>
        {loading ? '正在加载房源…' : '暂无符合条件的房源'}
        {!loading && stage === '流程中' ? <div style={{ marginTop: 12 }}><button type="button" className="a-btn" onClick={() => { setStage('待开始'); setPage(1) }}>去待开始房源发起核验</button></div> : null}
      </td></tr> : null}</tbody></table></div>
      <Pagination total={paged.total} page={paged.page} pageSize={paged.pageSize} onChange={(next) => { setPage(next.page); setPageSize(next.pageSize) }} /></div>
    {selectedHouse ? <DemoDialog title={`住建维护 · ${selectedHouse.apartmentName} ${selectedHouse.houseNo}`} wide onClose={() => { setSelectedId(''); setMessage(modalMessage) }}>
      <div className="a-row" role="tablist" aria-label="住建维护">{(['基础信息', '产权核验', '住建上架'] as MaintenanceTab[]).map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? 'a-btn' : 'a-btn ghost'} onClick={() => { setTab(value); setModalError('') }}>{value}</button>)}</div>
      <p className="a-muted">房源ID：{selectedHouse.houseBizId} · 全部操作仅用于本机评审演示。</p>
      {modalError ? <div className="a-card a-error" role="alert">{modalError}</div> : null}
      {modalMessage ? <div className="a-card a-success" role="status">{modalMessage}</div> : null}
      {tab === '基础信息' ? <div role="tabpanel" aria-label="基础信息">
        <form className="a-col" onSubmit={saveBase} style={{ marginTop: 16 }}>
          <label className="a-col">权利人姓名/单位<input className="a-filter-input" value={draft.owner} onChange={(event) => patch('owner', event.target.value)} /></label>
          <label className="a-col">权利人证件号<input className="a-filter-input" value={draft.ownerId} onChange={(event) => patch('ownerId', event.target.value)} /></label>
          <label className="a-col">产权证号<input className="a-filter-input" value={draft.certificate} onChange={(event) => patch('certificate', event.target.value)} /></label>
          <label className="a-col">城区编码<input className="a-filter-input" value={draft.district} onChange={(event) => patch('district', event.target.value)} /></label>
          <label className="a-col">房屋来源<input className="a-filter-input" value={draft.source} onChange={(event) => patch('source', event.target.value)} /></label>
          <div><button className="a-btn" type="submit">保存基础信息</button></div>
        </form>
        <div className="a-table-wrap" style={{ marginTop: 20 }}><table className="a-table"><thead><tr>{['动作', '结果', '失败原因', '操作人', '时间'].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>
          {persisted.logs.map((log, index) => <tr key={`${log.time}-${index}`}><td>{log.action}</td><td>{log.result}</td><td>{log.reason || '—'}</td><td>演示操作人</td><td>{formatTime(log.time)}</td></tr>)}
          {persisted.logs.length === 0 ? <tr><td colSpan={5} className="a-muted">暂无数据</td></tr> : null}</tbody></table></div>
      </div> : null}
      {tab === '产权核验' ? <div role="tabpanel" aria-label="产权核验" className="a-col" style={{ marginTop: 16 }}>
        {missingBase.length ? <div className="a-card a-muted">核验前请先补全以下信息 · {missingBase.join('、')}<div style={{ marginTop: 8 }}><button className="a-btn ghost" type="button" onClick={() => setTab('基础信息')}>去基础信息填写</button></div></div> : null}
        <p>核验状态：<strong>{persisted.verifyStatus}</strong></p>
        <label className="a-col">经纪人 *<select className="a-filter-select" value={draft.broker} onChange={(event) => patch('broker', event.target.value)}><option value="">请选择经纪人</option>
          {draft.broker && !brokers.some((broker) => broker.id === draft.broker) ? <option value={draft.broker}>经纪人已停用或删除，请重新选择</option> : null}
          {brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.name} · {broker.agency}</option>)}</select></label>
        {!brokers.length ? <p className="a-muted">暂无启用经纪人，请先到<Link to="/brokers">经纪人</Link>维护。</p> : null}
        <div className="a-row" role="group" aria-label="核验方式">核验方式 {['自动核验', '人工核验'].map((value) => <label key={value}><input type="radio" name="housing-verify-method" checked={draft.method === value} onChange={() => patch('method', value)} /> {value}</label>)}</div>
        <div><button className="a-btn" type="button" disabled={!canVerify || persisted.verifyStatus === '核验中'} onClick={startVerification}>发起核验</button></div>
        <div className="a-card" style={{ marginTop: 12 }}><strong>评审演示场景</strong><p className="a-muted">用于展示核验后的页面，不是实际住建核验结果。</p>
          <div className="a-row"><select className="a-filter-select" aria-label="评审演示场景" value={scenario} onChange={(event) => setScenario(event.target.value)}><option value="">请选择演示场景</option><option>已核验</option><option>核验不通过</option></select><button className="a-btn ghost" type="button" disabled={!scenario} onClick={applyScenario}>应用演示场景</button></div></div>
      </div> : null}
      {tab === '住建上架' ? <div role="tabpanel" aria-label="住建上架" className="a-col" style={{ marginTop: 16 }}>
        <div className="a-row">核验状态：<strong>{persisted.verifyStatus}</strong> 上架状态：<strong>{persisted.releaseStatus}</strong></div>
        <form className="a-col" onSubmit={(event) => { event.preventDefault(); release() }}>
          <label className="a-col">H5展示链接 *<input className="a-filter-input" type="url" required value={draft.h5} onChange={(event) => patch('h5', event.target.value)} /></label>
          <div className="a-row" style={{ flexWrap: 'wrap' }}>{(['rentMode', 'paymentMode', 'building', 'direction', 'decoration'] as const).map((key) => {
            const label = { rentMode: '出租方式', paymentMode: '付款方式', building: '建筑类型', direction: '朝向', decoration: '装修' }[key]
            return <label className="a-col" key={key}>{label}<select className="a-filter-select" value={draft[key]} onChange={(event) => patch(key, event.target.value)}><option value={emptyHousing()[key]}>{emptyHousing()[key]}</option></select></label>
          })}</div>
          <div className="a-row" style={{ flexWrap: 'wrap' }}>{(['rooms', 'halls', 'baths', 'kitchens', 'floors', 'floor'] as const).map((key) => {
            const label = { rooms: '室', halls: '厅', baths: '卫', kitchens: '厨房', floors: '总楼层', floor: '所在层' }[key]
            return <label className="a-col" key={key} style={{ flex: '1 1 100px' }}>{label}<input className="a-filter-input" style={{ width: '100%', minWidth: 80 }} type="number" min={key === 'floor' || key === 'floors' ? 1 : 0} step={1} required value={draft[key]} onChange={(event) => patch(key, Number(event.target.value))} /></label>
          })}</div>
          <label className="a-col">联系人<input className="a-filter-input" value={draft.contact} onChange={(event) => patch('contact', event.target.value)} /></label>
          <label className="a-col">联系电话<input className="a-filter-input" type="tel" value={draft.phone} onChange={(event) => patch('phone', event.target.value)} /></label>
          <label className="a-col">图片链接<input className="a-filter-input" value={draft.pictures} onChange={(event) => patch('pictures', event.target.value)} /></label>
          <div className="a-row"><button className="a-btn" type="submit" disabled={persisted.verifyStatus !== '已核验' || persisted.releaseStatus === '已上架'}>住建上架</button>
            <button className="a-btn ghost" type="button" disabled={persisted.verifyStatus !== '已核验' || persisted.releaseStatus !== '已上架'} onClick={() => commit({ ...persisted, releaseStatus: '未上架' }, '住建下架（演示）', '本地下架成功', '未向住建平台提交下架请求')}>住建下架</button></div>
        </form>
      </div> : null}
    </DemoDialog> : null}
  </div>
}
