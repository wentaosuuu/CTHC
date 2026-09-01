import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiGet, apiPost, getTenantPhone } from '../api'

type EligibleContract = {
  id: string
  contractNo: string
  storeName: string
  apartmentName: string
  houseNo: string
  houseArea: number
  openSubletId: string | null
  openSubletNo: string | null
  openSubletStatus: string | null
}

export function SubletCreatePage() {
  const nav = useNavigate()
  const phone = getTenantPhone()
  const [contracts, setContracts] = useState<EligibleContract[]>([])
  const [contractId, setContractId] = useState('')
  const [subletArea, setSubletArea] = useState('')
  const [subletUnit, setSubletUnit] = useState('')
  const [remark, setRemark] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      setError('')
      if (!phone.trim()) {
        setLoading(false)
        return
      }
      const r = await apiGet<{ items: EligibleContract[] }>('/api/sublets/eligible-contracts', {
        headers: { 'x-tenant-phone': phone },
      })
      if (!alive) return
      if (!r.ok) {
        setError(r.error)
        setContracts([])
      } else {
        setContracts(r.data.items ?? [])
        const firstOpen = (r.data.items ?? []).find((c) => !c.openSubletId)
        if (firstOpen) setContractId(firstOpen.id)
      }
      setLoading(false)
    }
    load()
    return () => {
      alive = false
    }
  }, [phone])

  const selected = contracts.find((c) => c.id === contractId)

  async function submit() {
    setError('')
    if (!phone.trim()) return setError('请先绑定手机号')
    if (!contractId) return setError('请选择在租合同')
    if (selected?.openSubletId) return setError('该合同已有进行中的转租申请')
    const area = Number(subletArea)
    if (!Number.isFinite(area) || area <= 0) return setError('请填写有效的转租面积')
    if (selected && area > selected.houseArea + 0.01) {
      return setError(`转租面积不能超过房源面积（${selected.houseArea}㎡）`)
    }
    if (!subletUnit.trim()) return setError('请填写转租单位')

    setSubmitting(true)
    const r = await apiPost<{ id: string }>('/api/sublets', {
      contractId,
      subletArea: area,
      subletUnit: subletUnit.trim(),
      remark: remark.trim() || undefined,
    }, { headers: { 'x-tenant-phone': phone } })
    setSubmitting(false)
    if (!r.ok) {
      const map: Record<string, string> = {
        CONTRACT_NOT_ACTIVE: '仅在租生效合同可发起转租',
        SUBLET_ALREADY_OPEN: '该合同已有进行中的转租申请',
        SUBLET_AREA_EXCEEDS_HOUSE: '转租面积不能超过房源面积',
        INVALID_BODY: '请检查填写内容',
      }
      return setError(map[r.error] || r.error)
    }
    nav(`/me/sublets/${encodeURIComponent(r.data.id)}`, { replace: true })
  }

  if (!phone.trim()) {
    return (
      <div className="m-col">
        <div className="m-card">
          <div style={{ fontWeight: 800 }}>请先绑定手机号</div>
          <div style={{ marginTop: 12 }}>
            <Link className="m-btn" to="/me/profile">
              去填写手机号
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="m-col">
      <div className="m-card">
        <div className="m-h1">新建转租申请</div>
        <div className="m-muted" style={{ marginTop: 6 }}>
          提交后由店长初审；通过后需等待华创内部 OA（线下），再补交备案材料。
        </div>
      </div>

      {error ? <div className="m-card m-error">{error}</div> : null}
      {loading ? <div className="m-card m-muted">加载可转租合同…</div> : null}

      {!loading && contracts.length === 0 ? (
        <div className="m-card">
          <div style={{ fontWeight: 700 }}>暂无在租合同</div>
          <div className="m-muted" style={{ marginTop: 6 }}>
            仅「已生效」合同可发起转租。请确认手机号与签约手机号一致。
          </div>
        </div>
      ) : null}

      {!loading && contracts.length > 0 ? (
        <div className="m-card m-col" style={{ gap: 12 }}>
          <label>
            <div className="m-muted m-label-required">选择在租合同</div>
            <select
              className="m-input"
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              style={{ marginTop: 6 }}
            >
              {contracts.map((c) => (
                <option key={c.id} value={c.id} disabled={Boolean(c.openSubletId)}>
                  {c.contractNo} · {c.apartmentName} {c.houseNo}
                  {c.openSubletId ? '（已有申请）' : ''}
                </option>
              ))}
            </select>
          </label>

          {selected ? (
            <div className="m-muted" style={{ fontSize: 13 }}>
              {selected.storeName} · 房源面积 {selected.houseArea}㎡
              {selected.openSubletNo ? ` · 进行中申请 ${selected.openSubletNo}` : ''}
            </div>
          ) : null}

          <label>
            <div className="m-muted m-label-required">转租面积（㎡）</div>
            <input
              className="m-input"
              inputMode="decimal"
              value={subletArea}
              onChange={(e) => setSubletArea(e.target.value)}
              placeholder={selected ? `不超过 ${selected.houseArea}` : '例如 50'}
              style={{ marginTop: 6 }}
            />
          </label>

          <label>
            <div className="m-muted m-label-required">转租单位</div>
            <input
              className="m-input"
              value={subletUnit}
              onChange={(e) => setSubletUnit(e.target.value)}
              placeholder="承接方公司或个人名称"
              style={{ marginTop: 6 }}
            />
          </label>

          <label>
            <div className="m-muted">其他说明</div>
            <textarea
              className="m-input"
              rows={3}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="用途、租期意向等（选填）"
              style={{ marginTop: 6, resize: 'vertical' }}
            />
          </label>

          <button type="button" className="m-btn m-btn-block" disabled={submitting} onClick={submit}>
            {submitting ? '提交中…' : '提交申请'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
