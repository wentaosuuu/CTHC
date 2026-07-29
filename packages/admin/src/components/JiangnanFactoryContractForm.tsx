import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { ContractRemarkEditor } from './ContractRemarkEditor'
import { HouseMultiSelectModal } from './HouseMultiSelectModal'
import { TenantMultiSelectModal } from './TenantMultiSelectModal'
import {
  JIANGNAN_CLAUSE14_OPTIONS,
  JIANGNAN_CLAUSE24_PARTY_A,
  JIANGNAN_PAYEE,
  JIANGNAN_PAYMENT_METHODS,
  JIANGNAN_RENT_CYCLES,
  calcRentStartDate,
  createDefaultEscalationRow,
  fitOutFreeDaysText,
  formatHouseLocation,
  performanceBondAmount,
  rentDueDayHint,
  sumHouseArea,
  sumHouseRentMonthly,
  syncJiangnanDerivedFields,
  type JiangnanFactoryFormData,
  type JiangnanRentEscalationRow,
} from '../jiangnanFactoryContract'

type CfgAtt = { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }

type Props = {
  value: JiangnanFactoryFormData
  onChange: (next: JiangnanFactoryFormData) => void
  vacantHouseOnly?: boolean
  pendingFiles?: File[]
  onPendingFilesChange?: (files: File[]) => void
  attachments?: CfgAtt[]
  contractId?: string | null
  onDeleteAttachment?: (fileKey: string) => void | Promise<void>
  showAttachmentUpload?: boolean
}

function roInput(value: string, opts?: { style?: CSSProperties; placeholder?: string }) {
  return (
    <input
      className="a-filter-input a-input-readonly"
      value={value}
      readOnly
      placeholder={opts?.placeholder}
      style={opts?.style}
    />
  )
}

function kv(label: string, children: ReactNode, required?: boolean) {
  return (
    <div className="a-kv-row">
      <div className={`a-kv-k${required ? ' a-label-required' : ''}`}>{label}</div>
      <div className="a-kv-v">{children}</div>
    </div>
  )
}

export function JiangnanFactoryContractForm({
  value,
  onChange,
  vacantHouseOnly = true,
  pendingFiles = [],
  onPendingFilesChange,
  attachments = [],
  contractId,
  onDeleteAttachment,
  showAttachmentUpload = true,
}: Props) {
  const [tenantModal, setTenantModal] = useState(false)
  const [houseModal, setHouseModal] = useState(false)

  const patch = (p: Partial<JiangnanFactoryFormData>) => onChange(syncJiangnanDerivedFields(value, p))

  const locationText = useMemo(() => formatHouseLocation(value.houses), [value.houses])
  const totalArea = useMemo(() => sumHouseArea(value.houses), [value.houses])
  const monthlyRent = useMemo(() => sumHouseRentMonthly(value.houses), [value.houses])
  const quarterlyRent = monthlyRent * 3
  const rentStart = calcRentStartDate(value.leaseStart, value.fitOutFreeDays)
  const bondAmount = performanceBondAmount(value)
  const primaryTenant = value.tenants[0]

  function updateEscalation(id: string, rowPatch: Partial<JiangnanRentEscalationRow>) {
    patch({
      rentEscalations: value.rentEscalations.map((r) => (r.id === id ? { ...r, ...rowPatch } : r)),
    })
  }

  function addEscalationRow() {
    const base = monthlyRent
    const last = value.rentEscalations[value.rentEscalations.length - 1]
    const start = last?.periodEnd ? addOneDay(last.periodEnd) : rentStart
    const row: JiangnanRentEscalationRow = {
      ...createDefaultEscalationRow(start, base),
      incrementType: 'PERCENT',
      incrementValue: '5',
    }
    patch({ rentEscalations: [...value.rentEscalations, row] })
  }

  function removeEscalation(id: string) {
    if (value.rentEscalations.length <= 1) return
    patch({ rentEscalations: value.rentEscalations.filter((r) => r.id !== id) })
  }

  return (
    <>
      {kv(
        '租客',
        <>
          <button type="button" className="a-btn ghost" onClick={() => setTenantModal(true)}>
            {value.tenants.length ? `已选 ${value.tenants.length} 位` : '选择租客'}
          </button>
          {value.tenants.length ? (
            <div className="a-muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
              {value.tenants.map((t) => (
                <div key={t.id}>
                  {t.name} · {t.phone}
                </div>
              ))}
            </div>
          ) : null}
        </>,
        true,
      )}

      {kv(
        '资产',
        <>
          <button type="button" className="a-btn ghost" onClick={() => setHouseModal(true)}>
            {value.houses.length ? `已选 ${value.houses.length} 项` : '选择资产'}
          </button>
          {value.houses.length ? (
            <div className="a-muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
              {value.houses.map((h) => (
                <div key={h.id}>
                  {h.apartmentName} {h.houseNo}（{h.storeName}）
                </div>
              ))}
            </div>
          ) : null}
        </>,
        true,
      )}

      {kv('房屋坐落', roInput(locationText, { style: { minWidth: 280 } }))}
      {kv('建筑面积', roInput(totalArea > 0 ? `${totalArea} ㎡` : '', { style: { width: 160 } }))}
      {kv(
        '房屋用途',
        <input
          className="a-filter-input"
          value={value.houseUsage}
          onChange={(e) => patch({ houseUsage: e.target.value })}
          placeholder="请填写房屋用途"
          style={{ minWidth: 220 }}
        />,
      )}
      {kv('租金类型', roInput('房屋', { style: { width: 100 } }))}
      {kv(
        '计租面积',
        <input
          className="a-filter-input"
          type="number"
          min={0}
          step="0.01"
          value={value.rentableArea}
          onChange={(e) => patch({ rentableArea: e.target.value })}
          placeholder={totalArea > 0 ? String(totalArea) : '㎡'}
          style={{ width: 160 }}
        />,
      )}
      {kv(
        '含税月租金（元/月）',
        roInput(monthlyRent > 0 ? String(monthlyRent) : '', { style: { width: 160 } }),
      )}
      {kv(
        '含税季租金（元/季度）',
        roInput(monthlyRent > 0 ? String(quarterlyRent) : '', { style: { width: 160 } }),
      )}
      {kv(
        '支付方式',
        <select
          className="a-filter-select"
          value={value.paymentMethod}
          onChange={(e) => patch({ paymentMethod: e.target.value as JiangnanFactoryFormData['paymentMethod'] })}
        >
          {JIANGNAN_PAYMENT_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>,
      )}
      {kv('收款全称', roInput(JIANGNAN_PAYEE.fullName, { style: { minWidth: 280 } }))}
      {kv('开户银行', roInput(JIANGNAN_PAYEE.bank, { style: { minWidth: 220 } }))}
      {kv('银行账号', roInput(JIANGNAN_PAYEE.account, { style: { minWidth: 220 } }))}

      {kv(
        '租赁期限',
        <div className="a-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            className="a-filter-input"
            type="date"
            value={value.leaseStart}
            onChange={(e) => patch({ leaseStart: e.target.value })}
          />
          <span className="a-muted">至</span>
          <input
            className="a-filter-input"
            type="date"
            value={value.leaseEnd}
            onChange={(e) => patch({ leaseEnd: e.target.value })}
          />
        </div>,
        true,
      )}

      {kv(
        '装修免租期（日）',
        <input
          className="a-filter-input"
          type="number"
          min={0}
          step={1}
          value={value.fitOutFreeDays}
          onChange={(e) => patch({ fitOutFreeDays: e.target.value.replace(/\D/g, '') })}
          style={{ width: 120 }}
        />,
      )}

      {kv('计租时间', roInput(rentStart, { style: { width: 160 } }))}

      {kv(
        '经营项目',
        <input
          className="a-filter-input"
          value={value.businessProject}
          onChange={(e) => patch({ businessProject: e.target.value })}
          style={{ minWidth: 220 }}
        />,
      )}

      {kv(
        '其他事项',
        <div className="a-muted" style={{ lineHeight: 1.7, maxWidth: 560 }}>
          {fitOutFreeDaysText(value)}
        </div>,
      )}

      {kv(
        '合同条款第十四条',
        <select
          className="a-filter-select"
          value={value.clause14}
          onChange={(e) => patch({ clause14: e.target.value as JiangnanFactoryFormData['clause14'] })}
          style={{ maxWidth: 560 }}
        >
          {JIANGNAN_CLAUSE14_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>,
      )}

      {kv(
        '合同条款第二十四条',
        <div
          className="a-clause24-block"
          style={{
            maxWidth: 620,
            fontSize: 13,
            lineHeight: 1.75,
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '12px 14px',
            background: '#fafbfc',
          }}
        >
          <div className="a-muted" style={{ marginBottom: 10 }}>
            通知与送达：甲、乙双方确认下列地址、收件人、电话、邮政编码为有效送达方式；变更须书面通知对方。
          </div>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>甲方</div>
          <div className="a-clause24-line">
            <span className="a-clause24-k">确认后的送达地址</span>
            {roInput(JIANGNAN_CLAUSE24_PARTY_A.deliveryAddress, { style: { flex: 1, minWidth: 0 } })}
          </div>
          <div className="a-clause24-line">
            <span className="a-clause24-k">邮政编码</span>
            {roInput(JIANGNAN_CLAUSE24_PARTY_A.postalCode, { style: { width: 120 } })}
          </div>
          <div className="a-clause24-line">
            <span className="a-clause24-k">收件人</span>
            {roInput(JIANGNAN_CLAUSE24_PARTY_A.recipient, { style: { flex: 1, minWidth: 0 } })}
          </div>
          <div className="a-clause24-line">
            <span className="a-clause24-k">手机号码</span>
            {roInput(JIANGNAN_CLAUSE24_PARTY_A.phone, { style: { width: 160 } })}
          </div>
          <div style={{ fontWeight: 800, margin: '12px 0 6px' }}>乙方</div>
          <div className="a-clause24-line">
            <span className="a-clause24-k">确认后的送达地址</span>
            {roInput(value.partyBAddress.trim() || '—', { style: { flex: 1, minWidth: 0 } })}
          </div>
          <div className="a-clause24-line">
            <span className="a-clause24-k">邮政编码</span>
            <input
              className="a-filter-input"
              value={value.postalCode}
              onChange={(e) => patch({ postalCode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              placeholder="选填，6 位"
              inputMode="numeric"
              style={{ width: 120 }}
            />
          </div>
          <div className="a-clause24-line">
            <span className="a-clause24-k">收件人</span>
            {roInput(primaryTenant?.name?.trim() || '—', { style: { flex: 1, minWidth: 0 } })}
          </div>
          <div className="a-clause24-line">
            <span className="a-clause24-k">手机号码</span>
            {roInput(primaryTenant?.phone?.trim() || '—', { style: { width: 160 } })}
          </div>
          <div className="a-muted" style={{ marginTop: 8, fontSize: 12 }}>
            乙方送达地址请在下方「签字部分 · 乙方」填写；其余由系统读取，仅「邮政编码」需店长补充。
          </div>
        </div>,
      )}

      <div style={{ margin: '16px 0 8px', fontWeight: 900 }}>签字部分 · 乙方</div>
      {kv('授权代表（签字）', <span className="a-muted">（留空，线下签署）</span>)}
      {kv(
        '地址',
        <input
          className="a-filter-input"
          value={value.partyBAddress}
          onChange={(e) => patch({ partyBAddress: e.target.value })}
          placeholder="默认填写租户身份证地址（可手动修改）"
          style={{ minWidth: 280 }}
        />,
      )}
      {kv(
        '开户银行',
        <input
          className="a-filter-input"
          value={value.partyBBank}
          onChange={(e) => patch({ partyBBank: e.target.value })}
          placeholder="选填"
        />,
      )}
      {kv(
        '开户名称',
        <input
          className="a-filter-input"
          value={value.partyBBankAccountName}
          onChange={(e) => patch({ partyBBankAccountName: e.target.value })}
          placeholder="选填"
        />,
      )}
      {kv(
        '银行账号',
        <input
          className="a-filter-input"
          value={value.partyBBankAccountNo}
          onChange={(e) => patch({ partyBBankAccountNo: e.target.value })}
          placeholder="选填"
        />,
      )}
      {kv(
        '联系电话',
        roInput(primaryTenant?.phone ?? '', { style: { width: 160 }, placeholder: '选择租客后自动带出' }),
      )}
      {kv(
        '签订日期',
        <input
          className="a-filter-input"
          type="date"
          value={value.agreementSignDate}
          onChange={(e) => patch({ agreementSignDate: e.target.value })}
          style={{ width: 160 }}
        />,
      )}

      <div style={{ margin: '16px 0 8px', fontWeight: 900 }}>附件 · 租赁确认书</div>
      {kv(
        '资产地址',
        <>
          {!value.confirmationCustomAddress.trim() && locationText ? (
            <div className="a-muted" style={{ marginBottom: 8, lineHeight: 1.6 }}>
              {value.houses.map((h) => (
                <div key={h.id}>{h.address?.trim() || `${h.apartmentName} ${h.houseNo}`}</div>
              ))}
            </div>
          ) : null}
          <input
            className="a-filter-input"
            value={value.confirmationCustomAddress}
            onChange={(e) => patch({ confirmationCustomAddress: e.target.value })}
            placeholder="可选：业主自行填写地址后将替代上方罗列"
            style={{ minWidth: 280 }}
          />
        </>,
      )}

      {kv(
        '租金递增设置',
        <div style={{ maxWidth: 620 }}>
          {value.rentEscalations.map((row) => (
            <div
              key={row.id}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 10,
                marginBottom: 10,
                fontSize: 13,
                lineHeight: 1.65,
              }}
            >
              <div style={{ marginBottom: 6 }}>
                （{row.yearIndex}）该物业的第 {row.yearIndex} 年（
                <input
                  className="a-filter-input"
                  type="date"
                  value={row.periodStart}
                  onChange={(e) => updateEscalation(row.id, { periodStart: e.target.value })}
                  style={{ width: 138, margin: '0 4px' }}
                />
                起至 {row.periodEnd || '—'} 止）每月租金为人民币{' '}
                <strong>{row.monthlyRent > 0 ? row.monthlyRent : '—'}</strong> 元/月。
              </div>
              {row.yearIndex > 1 ? (
                <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span>递增方式</span>
                  <select
                    className="a-filter-select"
                    value={row.incrementType === 'NONE' ? 'PERCENT' : row.incrementType}
                    onChange={(e) =>
                      updateEscalation(row.id, {
                        incrementType: e.target.value as JiangnanRentEscalationRow['incrementType'],
                      })
                    }
                  >
                    <option value="PERCENT">百分比</option>
                    <option value="FIXED">固定值（元）</option>
                  </select>
                  <input
                    className="a-filter-input"
                    style={{ width: 80 }}
                    value={row.incrementValue}
                    onChange={(e) => updateEscalation(row.id, { incrementValue: e.target.value })}
                    placeholder={row.incrementType === 'FIXED' ? '元' : '%'}
                  />
                </div>
              ) : null}
              {value.rentEscalations.length > 1 ? (
                <button
                  type="button"
                  className="a-btn ghost"
                  style={{ marginTop: 8, padding: '2px 8px', fontSize: 12 }}
                  onClick={() => removeEscalation(row.id)}
                >
                  删除本段
                </button>
              ) : null}
            </div>
          ))}
          <button type="button" className="a-btn ghost" onClick={addEscalationRow}>
            + 添加递增段
          </button>
        </div>,
        true,
      )}

      {kv(
        '履约担保金',
        <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="a-filter-select"
            value={value.performanceBondBase}
            onChange={(e) =>
              patch({ performanceBondBase: e.target.value as JiangnanFactoryFormData['performanceBondBase'] })
            }
          >
            <option value="FIRST_PERIOD">按第一期租金</option>
            <option value="LAST_PERIOD">按最后一期租金</option>
          </select>
          <span>的</span>
          <input
            className="a-filter-input"
            type="number"
            min={0.1}
            step={0.5}
            style={{ width: 72 }}
            value={value.performanceBondMultiple}
            onChange={(e) => patch({ performanceBondMultiple: e.target.value })}
          />
          <span>倍</span>
          <span className="a-muted">≈ ¥{bondAmount}</span>
        </div>,
      )}

      {kv(
        '缴费周期',
        <select
          className="a-filter-select"
          value={value.rentCycle}
          onChange={(e) => patch({ rentCycle: e.target.value as JiangnanFactoryFormData['rentCycle'] })}
        >
          {JIANGNAN_RENT_CYCLES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>,
      )}

      {kv(
        '交租日',
        value.rentCycle === 'MONTHLY' ? (
          <div>
            <input
              className="a-filter-input"
              type="number"
              min={1}
              max={31}
              style={{ width: 100 }}
              value={value.rentDueDay}
              onChange={(e) => patch({ rentDueDay: e.target.value.replace(/\D/g, '').slice(0, 2) })}
            />
            <div className="a-muted" style={{ marginTop: 4, fontSize: 12 }}>
              {rentDueDayHint(value.rentCycle, value.rentDueDay)}
            </div>
          </div>
        ) : (
          <span className="a-muted a-input-readonly-text">{rentDueDayHint(value.rentCycle, value.rentDueDay)}</span>
        ),
      )}

      {kv(
        '最晚交租宽限期（天）',
        <input
          className="a-filter-input"
          inputMode="numeric"
          value={value.latestRentGraceDays}
          onChange={(e) => patch({ latestRentGraceDays: e.target.value.replace(/\D/g, '') })}
          placeholder="例如 5"
          style={{ width: 120 }}
        />,
      )}

      {kv(
        '解除合同短信发送时间',
        <div style={{ maxWidth: 560, fontSize: 13, lineHeight: 1.65 }}>
          当<strong>逾期天数</strong>超过<strong>最晚缴费日</strong>（含宽限期后的应付口径）后满{' '}
          <input
            className="a-filter-input"
            inputMode="numeric"
            style={{ width: 86 }}
            value={value.terminationDaysPastDue}
            onChange={(e) => patch({ terminationDaysPastDue: e.target.value.replace(/\D/g, '') })}
          />{' '}
          天时触发（规则配置存档；实际短信以业务接通为准）。
        </div>,
      )}

      {showAttachmentUpload
        ? kv(
            '附件上传',
            <>
              <input
                type="file"
                multiple
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? [])
                  if (list.length && onPendingFilesChange) onPendingFilesChange([...pendingFiles, ...list])
                  e.currentTarget.value = ''
                }}
              />
              {pendingFiles.length > 0 ? (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                  {pendingFiles.map((f, idx) => (
                    <li key={`${f.name}-${idx}`}>
                      {f.name}{' '}
                      <button
                        type="button"
                        className="a-btn ghost"
                        style={{ padding: '2px 8px', fontSize: 12 }}
                        onClick={() =>
                          onPendingFilesChange?.(pendingFiles.filter((_, i) => i !== idx))
                        }
                      >
                        移除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {contractId && attachments.length > 0 ? (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                  {attachments.map((a) => (
                    <li key={a.id}>
                      {a.name}{' '}
                      {onDeleteAttachment ? (
                        <button
                          type="button"
                          className="a-btn ghost"
                          style={{ padding: '2px 8px', fontSize: 12 }}
                          onClick={() => void onDeleteAttachment(a.file)}
                        >
                          删除
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>,
          )
        : null}

      {kv(
        '备注',
        <ContractRemarkEditor value={value.remarkHtml} onChange={(v) => patch({ remarkHtml: v })} />,
      )}

      <TenantMultiSelectModal
        open={tenantModal}
        selectedIds={value.tenantIds}
        onClose={() => setTenantModal(false)}
        onConfirm={(tenants) =>
          patch({
            tenants,
            tenantIds: tenants.map((t) => t.id),
          })
        }
      />
      <HouseMultiSelectModal
        open={houseModal}
        selectedIds={value.houseIds}
        vacantOnly={vacantHouseOnly}
        onClose={() => setHouseModal(false)}
        onConfirm={(houses) =>
          patch({
            houses,
            houseIds: houses.map((h) => h.id),
          })
        }
      />
    </>
  )
}

function addOneDay(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd
  const [y, mo, d] = ymd.split('-').map(Number)
  const dt = new Date(y, mo - 1, d)
  dt.setDate(dt.getDate() + 1)
  const ny = dt.getFullYear()
  const nm = String(dt.getMonth() + 1).padStart(2, '0')
  const nd = String(dt.getDate()).padStart(2, '0')
  return `${ny}-${nm}-${nd}`
}
