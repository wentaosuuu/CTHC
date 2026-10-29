export const HOUSING_STORAGE_KEY = 'cthc.prototype-sync.v1.housing'
export type HousingRecord = {
  owner: string; ownerId: string; certificate: string; district: string; source: string
  broker: string; method: string; verifyStatus: string; releaseStatus: string; code: string
  h5: string; rentMode: string; paymentMode: string; rooms: number; halls: number; baths: number
  kitchens: number; building: string; direction: string; floors: number; floor: number
  decoration: string; contact: string; phone: string; pictures: string; updatedAt: string
  logs: { action: string; result: string; reason: string; time: string }[]
}
export function emptyHousing(): HousingRecord {
  return { owner: '', ownerId: '', certificate: '', district: '', source: '', broker: '', method: '自动核验',
    verifyStatus: '未上报', releaseStatus: '未上架', code: '', h5: '', rentMode: '整租', paymentMode: '押1付1',
    rooms: 1, halls: 1, baths: 1, kitchens: 1, building: '电梯', direction: '南', floors: 1, floor: 1,
    decoration: '毛坯', contact: '', phone: '', pictures: '', updatedAt: '', logs: [] }
}
export function readHousingRecords(): Record<string, HousingRecord> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HOUSING_STORAGE_KEY) ?? 'null')
    if (raw && typeof raw === 'object' && 'version' in raw && raw.version === 1 && 'records' in raw
      && raw.records && typeof raw.records === 'object' && !Array.isArray(raw.records)) {
      return raw.records as Record<string, HousingRecord>
    }
  } catch { /* A damaged demonstration record must not prevent the page opening. */ }
  return {}
}
export function readHousingStatus(houseId: string): string {
  const row = readHousingRecords()[houseId]
  return row?.releaseStatus === '已上架' ? '已上架' : row?.verifyStatus ?? '未上报'
}
