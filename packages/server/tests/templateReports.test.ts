import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import { buildTemplateReport, exportTemplateReport, templateReportQuery, templateReportTypes, receiptHistory } from '../src/services/templateReports.js'
import catalog from '../src/services/templateReportHeaders.json'
const d = (v: string) => new Date(`${v}T00:00:00.000Z`)
const house = { id: 'h1', externalId: '001', houseNo: '101', houseType: '一房', area: 50, rentMonthly: 100, deposit: 100, status: 'SIGNED', address: '南宁', projectName: '项目', mgmtDepartment: '管理部', managerName: '管理员', isPublished: true, apartment: { id: 'a1', name: '公寓', assetType: '住宅', storeId: 's1', store: { id: 's1', name: '门店', department: { name: '片区', parent: null } } } }
const tenant = { id: 't1', name: '租户', phone: '13800000000', idNumber: '000001', tenantKind: 'INDIVIDUAL', idDocType: 'IDCARD', creditTier: 'A' }
const contract = { id: 'c1', contractNo: 'HT001', houseId: 'h1', house, tenant, status: 'ACTIVE', source: 'SYSTEM', startDate: d('2026-01-01'), endDate: d('2026-12-31'), rentMonthly: 100, deposit: 100, rentCycle: 'MONTHLY', renewedFrom: null, renewedTo: [], order: null, housingReport: null, createdAt: d('2026-01-01'), moveOutArchiveJson: JSON.stringify({ terminateDate: '2026-08-15', completedAt: '2026-08-15', releaseHouseIds: ['h1'], reasonFull: '正常退租', settlement: { settlementType: 'NORMAL_EXPIRY', stopRentDate: '2026-08-15', paidItems: [{ name: '履约保证金', amount: 100 }], receivableItems: [{ name: '租金', amount: 40 }], paidTotal: 100, receivableTotal: 40, refundAmount: 60 } }) }
const old = { id: 'b1', contract, period: '2026-07', dueDate: d('2026-07-01'), totalAmount: 100, amountReceived: 40, status: 'UNPAID', paidAt: null, createdAt: d('2026-07-10'), items: [{ name: '租金', amount: 100 }], offlineVerifyLogs: [{ id: 'l1', amount: 40, collectionDate: d('2026-07-20'), createdAt: d('2026-07-20') }], changeLogs: [] }
const current = { ...old, id: 'b2', period: '2026-08', dueDate: d('2026-08-10'), status: 'PAID', amountReceived: 100, paidAt: d('2026-08-05'), createdAt: d('2026-08-01'), offlineVerifyLogs: [] }
function db(bills: unknown[] = [old, current], extraContracts: unknown[] = []) {
  const calls: unknown[] = []
  const prisma = { store: { findMany: async () => [{ id: 's1' }, { id: 's2' }] }, house: { findMany: async (q: unknown) => { calls.push(q); return [house] } }, tenant: { findMany: async (q: unknown) => { calls.push(q); return [tenant] } }, contract: { findMany: async (q: unknown) => { calls.push(q); return [contract, ...extraContracts] } }, bill: { findMany: async (q: unknown) => { calls.push(q); return bills } } } as unknown as PrismaClient
  return { prisma, calls }
}
const filter = templateReportQuery.parse({ periodFrom: '2026-08', periodTo: '2026-08', asOf: '2026-08' })
test('validates real calendar months, array inputs and reversed ranges', () => {
  for (const input of [{ asOf: '2026-13' }, { periodFrom: '2026-09', periodTo: '2026-08' }, { storeId: ['s1'] }, { groupBy: 'other' }]) assert.equal(templateReportQuery.safeParse(input).success, false)
})
test('all seven report rows exactly match template leaf columns; exports reopen with header merges', async () => {
  for (const type of templateReportTypes) {
    const { prisma } = db([{ ...old, items: [{ name: '租金', amount: 80 }, { name: '物业费', amount: 20 }] }, current])
    const result = await buildTemplateReport(prisma, type, filter, id => id === 's1')
    assert.ok(result.rows.length > 0, type)
    for (const row of result.rows) assert.equal(row.values.length, catalog[type].columns.length, type)
    const buffer = await exportTemplateReport(type, result)
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]!]!
    assert.equal(XLSX.utils.decode_range(sheet['!ref']!).e.c + 1, catalog[type].columns.length, type)
    if (catalog[type].headerRows.length > 1) assert.ok(sheet['!merges']?.length, type)
    assert.ok(workbook.SheetNames.includes('口径说明'))
  }
})
test('rent income separates opening receivable, period income and actual dated receipts', async () => {
  const { prisma } = db()
  const { rows } = await buildTemplateReport(prisma, 'rent-income', filter, () => true)
  const v = rows[0]!.values
  assert.equal(v[11], 60); assert.equal(v[12], 100); assert.equal(v[13], 160)
  assert.equal(v[18], 100); assert.equal(v[22], 60); assert.equal(v[24], 100); assert.equal(v[25], 0)
  assert.equal(v[5], null, 'unknown rentable quantity must not become zero')
})
test('historical aging excludes receipts after cutoff and assigns close-month buckets', async () => {
  const { prisma } = db([{ ...old, offlineVerifyLogs: [{ ...old.offlineVerifyLogs[0], collectionDate: d('2026-09-02') }] }])
  const { rows } = await buildTemplateReport(prisma, 'rent-aging', filter, () => true)
  assert.equal(rows[0]!.values[11], 0); assert.equal(rows[0]!.values[12], 100)
  assert.equal(rows[0]!.values[20], 100, 'July bucket'); assert.equal(rows[0]!.values[13], 0)
})
test('mixed fee partial collections remain unknown, never proportional guesses', async () => {
  const { prisma } = db([{ ...old, items: [{ name: '租金', amount: 80 }, { name: '水费', amount: 20 }] }])
  const { rows } = await buildTemplateReport(prisma, 'rent-aging', filter, () => true)
  assert.equal(rows[0]!.values[10], 80); assert.equal(rows[0]!.values[11], null); assert.equal(rows[0]!.values[12], null)
})
test('historic bill changes suppress unsupported historical amounts', async () => {
  const { prisma } = db([{ ...old, changeLogs: [{ changedAt: d('2026-09-01') }] }])
  const { rows } = await buildTemplateReport(prisma, 'rent-aging', filter, () => true)
  assert.equal(rows[0]!.values[10], null); assert.equal(rows[0]!.values[12], null)
})
test('queries scope every data model to permitted stores and omit mixed-access merged contracts', async () => {
  const hidden = { ...contract, id: 'hidden', house: { ...house, apartment: { ...house.apartment, storeId: 's2' } } }
  const merged = { ...contract, id: 'mixed', order: { isMergedBundle: true, lines: [{ house }, { house: hidden.house }] } }
  const { prisma, calls } = db([old], [hidden, merged])
  const { rows } = await buildTemplateReport(prisma, 'contract-register', filter, id => id === 's1')
  assert.deepEqual(rows.map(r => r.id), ['c1'])
  assert.ok(calls.every(q => JSON.stringify(q).includes('"in":["s1"]')))
  assert.ok(calls.every(q => !Object.hasOwn(q as object, 'take')), 'no hard row truncation')
})
test('excess offline receipts are capped at bill total rather than inflated fee income', () => {
  const b = { ...old, amountReceived: 100, offlineVerifyLogs: [{ ...old.offlineVerifyLogs[0], amount: 130 }] }
  const events = receiptHistory(b as Parameters<typeof receiptHistory>[0])
  assert.equal(events?.[0]?.amount, 100)
})
