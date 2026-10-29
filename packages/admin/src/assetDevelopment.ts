/** 新增资产字段仅用于本机原型评审，不写入原业务数据库。 */
export const ASSET_SUPPLEMENT_STORAGE_KEY = 'cthc.prototype-sync.v1.asset-supplements'
export const ASSET_SUPPLEMENTS_CHANGED = 'cthc:asset-supplements-changed'

export type AssetSupplement = {
  merchantId: string
  ownerName: string
  storeName: string
  certificateType: string
  gasMeterNo: string
  rentable: boolean
  negotiatedRent: number
  displayPrice: number | null
  pricingBasis: string
  cleaningDeposit: number
  utilityDeposit: number
  ownerManuallyMaintained: boolean
  updatedAt: string
}

type AssetSupplementStore = { version: 1; records: Record<string, AssetSupplement> }

export function readAssetSupplements(): Record<string, AssetSupplement> {
  try {
    const raw = localStorage.getItem(ASSET_SUPPLEMENT_STORAGE_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw) as Partial<AssetSupplementStore>
    return data.version === 1 && data.records && typeof data.records === 'object' ? data.records : {}
  } catch {
    return {}
  }
}

export function defaultAssetSupplement(storeName: string): AssetSupplement {
  return { merchantId: '', ownerName: '', storeName, certificateType: '', gasMeterNo: '', rentable: true,
    negotiatedRent: 0, displayPrice: null, pricingBasis: '', cleaningDeposit: 0, utilityDeposit: 0,
    ownerManuallyMaintained: false, updatedAt: '' }
}

export function readAssetSupplement(houseId: string, storeName = ''): AssetSupplement {
  return { ...defaultAssetSupplement(storeName), ...readAssetSupplements()[houseId] }
}

export function saveAssetSupplement(houseId: string, supplement: AssetSupplement): void {
  const next: AssetSupplementStore = { version: 1, records: { ...readAssetSupplements(), [houseId]: supplement } }
  localStorage.setItem(ASSET_SUPPLEMENT_STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event(ASSET_SUPPLEMENTS_CHANGED))
}
