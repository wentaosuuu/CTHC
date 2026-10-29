import { Link } from 'react-router-dom'
import { readEnabledDemoSubMerchants } from '../subMerchantDemoData'
import type { AssetSupplement } from '../assetDevelopment'

type Section = 'finance' | 'ownership' | 'certificate' | 'gas' | 'lease' | 'pricing'

/** 与原房源字段分区组合；草稿由父表单统一保存，避免分段保存造成误解。 */
export function AssetDevelopmentFields({ section, value, onChange, storeOptions }: {
  section: Section
  value: AssetSupplement
  onChange: (next: AssetSupplement) => void
  storeOptions: string[]
}) {
  const merchants = readEnabledDemoSubMerchants()
  const stores = [...new Set([value.storeName, ...storeOptions].filter(Boolean))]
  function patch<K extends keyof AssetSupplement>(key: K, next: AssetSupplement[K]) {
    onChange({ ...value, [key]: next, ...(key === 'ownerName' ? { ownerManuallyMaintained: true } : {}) })
  }
  if (section === 'finance') return <div className="a-kv-row">
    <label className="a-kv-k" htmlFor="asset-supplement-merchant">收款子商户 *</label><div className="a-kv-v">
      <select id="asset-supplement-merchant" className="a-filter-select" value={value.merchantId} aria-required="true" onChange={(event) => patch('merchantId', event.target.value)}>
        <option value="">请选择收款子商户</option>
        {value.merchantId && !merchants.some((merchant) => merchant.id === value.merchantId) ? <option value={value.merchantId}>已停用或已删除，请重新选择</option> : null}
        {merchants.map((merchant) => <option key={merchant.id} value={merchant.id}>{merchant.name}</option>)}
      </select>
      <div className="a-muted" style={{ fontSize: 12, marginTop: 4 }}>收款子商户决定租客支付的收款方；未配置的资产不可下单。<Link to="/sub-merchants">维护子商户</Link></div>
    </div>
  </div>
  if (section === 'ownership') return <>
    <div className="a-kv-row"><label className="a-kv-k" htmlFor="asset-supplement-owner">权属单位</label><div className="a-kv-v">
      <input id="asset-supplement-owner" className="a-filter-input" value={value.ownerName} onChange={(event) => patch('ownerName', event.target.value)} />
      <div className="a-muted" style={{ fontSize: 12 }}>人工修改后，后续资产同步不再覆盖。</div>
    </div></div>
    <div className="a-kv-row"><label className="a-kv-k" htmlFor="asset-supplement-store">所属门店</label><div className="a-kv-v">
      <select id="asset-supplement-store" className="a-filter-select" value={value.storeName} onChange={(event) => patch('storeName', event.target.value)}>
        <option value="">未绑定门店</option>{stores.map((store) => <option key={store} value={store}>{store}</option>)}
      </select><div className="a-muted" style={{ fontSize: 12 }}>未绑定门店的资产不可下单。</div>
    </div></div>
  </>
  if (section === 'certificate') return <div className="a-kv-row"><label className="a-kv-k" htmlFor="asset-supplement-certificate">权证类型</label><div className="a-kv-v"><input id="asset-supplement-certificate" className="a-filter-input" value={value.certificateType} onChange={(event) => patch('certificateType', event.target.value)} /></div></div>
  if (section === 'gas') return <div className="a-kv-row"><label className="a-kv-k" htmlFor="asset-supplement-gas">燃气表号</label><div className="a-kv-v"><input id="asset-supplement-gas" className="a-filter-input" value={value.gasMeterNo} placeholder="例如 GS-001，多个可用逗号或换行分隔" onChange={(event) => patch('gasMeterNo', event.target.value)} /><div className="a-muted" style={{ fontSize: 12, marginTop: 4 }}>与水表号、电表号一起保存到资产。导入账单时可按燃气表号匹配这套房，并记到在租租户名下。</div></div></div>
  if (section === 'lease') return <>
    <div className="a-kv-row"><div className="a-kv-k">是否可出租 *</div><div className="a-kv-v">
      <div className="a-row" style={{ gap: 18 }}>
        <label><input type="radio" name="asset-rentable" checked={value.rentable} onChange={() => patch('rentable', true)} /> 可出租</label>
        <label><input type="radio" name="asset-rentable" checked={!value.rentable} onChange={() => patch('rentable', false)} /> 不可出租</label>
      </div><div className="a-muted" style={{ fontSize: 12, marginTop: 4 }}>不可出租的资产不能上架；可出租资产可在列表页配置上架。</div>
    </div></div>
    <div className="a-kv-row"><label className="a-kv-k" htmlFor="asset-supplement-negotiated">协议签约租金定价</label><div className="a-kv-v"><input id="asset-supplement-negotiated" type="number" className="a-filter-input" min="0" step="0.01" value={value.negotiatedRent} onChange={(event) => patch('negotiatedRent', Number(event.target.value))} />
      <div className="a-muted" style={{ fontSize: 12 }}>仅后台可见，不对外展示。</div>
    </div></div>
  </>
  return <>
    <div className="a-kv-row"><label className="a-kv-k" htmlFor="asset-supplement-pricing">定价依据</label><div className="a-kv-v"><input id="asset-supplement-pricing" className="a-filter-input" value={value.pricingBasis} onChange={(event) => patch('pricingBasis', event.target.value)} /></div></div>
    <div className="a-kv-row"><label className="a-kv-k" htmlFor="asset-supplement-cleaning">保洁押金(元)</label><div className="a-kv-v"><input id="asset-supplement-cleaning" type="number" className="a-filter-input" min="0" step="0.01" value={value.cleaningDeposit} onChange={(event) => patch('cleaningDeposit', Number(event.target.value))} /></div></div>
    <div className="a-kv-row"><label className="a-kv-k" htmlFor="asset-supplement-utility">水电押金(元)</label><div className="a-kv-v"><input id="asset-supplement-utility" type="number" className="a-filter-input" min="0" step="0.01" value={value.utilityDeposit} onChange={(event) => patch('utilityDeposit', Number(event.target.value))} /></div></div>
  </>
}
