import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { ContractRemarkEditor } from './ContractRemarkEditor'
import { HouseMultiSelectModal } from './HouseMultiSelectModal'
import { RentEscalationBlock } from './RentEscalationBlock'
import { TenantMultiSelectModal } from './TenantMultiSelectModal'
import { formatHouseLocation } from '../contractFormShared'
import { JIANGNAN_PAYMENT_METHODS, JIANGNAN_RENT_CYCLES, rentDueDayHint } from '../jiangnanFactoryContract'
import {
  RESIDENTIAL_CLAUSE13_OPTIONS,
  RESIDENTIAL_RENT_TYPE,
  residentialHousingBondAmount,
  syncResidentialDerivedFields,
  sumHouseArea,
  sumHouseRentMonthly,
  type ResidentialAssetFormData,
} from '../residentialAssetContract'

type CfgAtt = { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }

type Props = {
  value: ResidentialAssetFormData
  onChange: (next: ResidentialAssetFormData) => void
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

export function ResidentialAssetContractForm({
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

  const patch = (p: Partial<ResidentialAssetFormData>) => onChange(syncResidentialDerivedFields(value, p))

  const locationText = useMemo(() => formatHouseLocation(value.houses), [value.houses])
  const totalArea = useMemo(() => sumHouseArea(value.houses), [value.houses])
  const monthlyRent = useMemo(() => sumHouseRentMonthly(value.houses), [value.houses])
  const yearlyRent = monthlyRent * 12
  const bondAmount = residentialHousingBondAmount(value)
  const clause13Hint =
    value.clause13 === 'PREPAID_METER'
      ? '固定 500 元'
      : '10 元/㎡×计租面积，不足 500 取 500，超过 500 向上取整'

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
      {kv('房屋面积', roInput(totalArea > 0 ? `${totalArea} ㎡` : '', { style: { width: 160 } }))}
      {kv('租金类型', roInput(RESIDENTIAL_RENT_TYPE, { style: { width: 100 } }))}

      {kv(
        '计租面积',
        <input
          className="a-filter-input"
          value={value.rentableArea}
          onChange={(e) => patch({ rentableArea: e.target.value, utilityDepositTouched: false })}
          placeholder="默认与房屋面积相同"
          style={{ width: 160 }}
        />,
      )}

      {kv(
        '递增',
        <RentEscalationBlock
          rows={value.rentEscalations}
          leaseEnd={value.leaseEnd}
          baseMonthlyRent={monthlyRent}
          rentStart={value.leaseStart}
          onChange={(rows) => patch({ rentEscalations: rows })}
        />,
        true,
      )}

      {kv('月租金（元/月）', roInput(monthlyRent > 0 ? String(monthlyRent) : '', { style: { width: 160 } }))}
      {kv('年租金（元/年）', roInput(yearlyRent > 0 ? String(yearlyRent) : '', { style: { width: 160 } }))}

      {kv(
        '支付方式',
        <select
          className="a-filter-select"
          value={value.paymentMethod}
          onChange={(e) => patch({ paymentMethod: e.target.value as ResidentialAssetFormData['paymentMethod'] })}
        >
          {JIANGNAN_PAYMENT_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>,
      )}

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
        '垃圾待清理费',
        <input
          className="a-filter-input"
          type="number"
          min={0}
          step={1}
          value={value.garbageCleanupFee}
          onChange={(e) => patch({ garbageCleanupFee: e.target.value })}
          placeholder="选填"
          style={{ width: 140 }}
        />,
      )}

      {kv(
        '住房保证金',
        <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="a-filter-select"
            value={value.performanceBondBase}
            onChange={(e) =>
              patch({ performanceBondBase: e.target.value as ResidentialAssetFormData['performanceBondBase'] })
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
        '合同条款第十三条',
        <select
          className="a-filter-select"
          value={value.clause13}
          onChange={(e) => patch({ clause13: e.target.value as ResidentialAssetFormData['clause13'] })}
          style={{ maxWidth: 560 }}
        >
          {RESIDENTIAL_CLAUSE13_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>,
      )}

      {kv(
        '水电押金',
        <div>
          <input
            className="a-filter-input"
            type="number"
            min={0}
            step={1}
            style={{ width: 120 }}
            value={value.utilityDeposit}
            onChange={(e) => patch({ utilityDeposit: e.target.value, utilityDepositTouched: true })}
          />
          <span className="a-muted" style={{ marginLeft: 8, fontSize: 12 }}>
            默认 {clause13Hint}，可手动修改
          </span>
        </div>,
      )}

      {kv(
        '物业费押金',
        <input
          className="a-filter-input"
          type="number"
          min={0}
          step={1}
          value={value.propertyMgmtDeposit}
          onChange={(e) => patch({ propertyMgmtDeposit: e.target.value })}
          placeholder="选填"
          style={{ width: 140 }}
        />,
      )}

      {kv(
        '缴费周期',
        <select
          className="a-filter-select"
          value={value.rentCycle}
          onChange={(e) => patch({ rentCycle: e.target.value as ResidentialAssetFormData['rentCycle'] })}
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

      {showAttachmentUpload
        ? kv(
            '附件上传',
            <>
              <input
                type="file"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  onPendingFilesChange?.([...pendingFiles, ...files])
                  e.target.value = ''
                }}
              />
              {pendingFiles.length ? (
                <div className="a-muted" style={{ marginTop: 6 }}>
                  待上传：{pendingFiles.map((f) => f.name).join('、')}
                </div>
              ) : null}
              {attachments.length ? (
                <div style={{ marginTop: 8 }}>
                  {attachments.map((a) => (
                    <div key={a.id} className="a-row" style={{ gap: 8, marginBottom: 4 }}>
                      <a href={a.previewUrl} target="_blank" rel="noreferrer">
                        {a.name}
                      </a>
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
                    </div>
                  ))}
                </div>
              ) : null}
            </>,
          )
        : null}

      {kv(
        '备注',
        <ContractRemarkEditor value={value.remarkHtml} onChange={(html) => patch({ remarkHtml: html })} />,
      )}

      <TenantMultiSelectModal
        open={tenantModal}
        onClose={() => setTenantModal(false)}
        selectedIds={value.tenantIds}
        onConfirm={(tenants) =>
          patch({
            tenants,
            tenantIds: tenants.map((t) => t.id),
          })
        }
      />
      <HouseMultiSelectModal
        open={houseModal}
        onClose={() => setHouseModal(false)}
        selectedIds={value.houseIds}
        vacantOnly={vacantHouseOnly}
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
