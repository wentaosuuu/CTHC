import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { ContractRemarkEditor } from './ContractRemarkEditor'
import { HouseMultiSelectModal } from './HouseMultiSelectModal'
import { RentEscalationBlock } from './RentEscalationBlock'
import { TenantMultiSelectModal } from './TenantMultiSelectModal'
import { formatHouseLocation } from '../contractFormShared'
import { JIANGNAN_RENT_CYCLES, rentDueDayHint } from '../jiangnanFactoryContract'
import {
  NON_RESIDENTIAL_HOUSE_USAGE,
  NON_RESIDENTIAL_OTHER_DEFAULT,
  nonResidentialPerformanceBondAmount,
  formatLeasePeriod,
  otherMattersFullText,
  syncNonResidentialDerivedFields,
  sumHouseArea,
  sumHouseRentMonthly,
  type NonResidentialFormData,
} from '../nonResidentialContract'

type CfgAtt = { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }

type Props = {
  value: NonResidentialFormData
  onChange: (next: NonResidentialFormData) => void
  vacantHouseOnly?: boolean
  leaseDatesEditable?: boolean
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

export function NonResidentialContractForm({
  value,
  onChange,
  vacantHouseOnly = true,
  leaseDatesEditable = true,
  pendingFiles = [],
  onPendingFilesChange,
  attachments = [],
  contractId,
  onDeleteAttachment,
  showAttachmentUpload = true,
}: Props) {
  const [tenantModal, setTenantModal] = useState(false)
  const [houseModal, setHouseModal] = useState(false)

  const patch = (p: Partial<NonResidentialFormData>) => onChange(syncNonResidentialDerivedFields(value, p))

  const locationText = useMemo(() => formatHouseLocation(value.houses), [value.houses])
  const totalArea = useMemo(() => sumHouseArea(value.houses), [value.houses])
  const monthlyRent = useMemo(() => sumHouseRentMonthly(value.houses), [value.houses])
  const yearlyRent = monthlyRent * 12
  const bondAmount = nonResidentialPerformanceBondAmount(value)
  const leasePeriodText = formatLeasePeriod(value.leaseStart, value.leaseEnd)
  const otherMattersPreview = otherMattersFullText(value)

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

      {leaseDatesEditable
        ? kv(
            '租约起止日',
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
          )
        : null}

      {kv(
        '房屋坐落',
        <>
          {!value.locationCustomAddress.trim() && locationText ? (
            <div className="a-muted" style={{ marginBottom: 8, lineHeight: 1.6 }}>
              {value.houses.map((h) => (
                <div key={h.id}>{h.address?.trim() || `${h.apartmentName} ${h.houseNo}`}</div>
              ))}
            </div>
          ) : null}
          <input
            className="a-filter-input"
            value={value.locationCustomAddress}
            onChange={(e) => patch({ locationCustomAddress: e.target.value })}
            placeholder="可选：业主自行填写后将替代上方罗列"
            style={{ minWidth: 280 }}
          />
        </>,
      )}

      {kv('建筑面积', roInput(totalArea > 0 ? `${totalArea} ㎡` : '', { style: { width: 160 } }))}
      {kv('房屋用途', roInput(NON_RESIDENTIAL_HOUSE_USAGE, { style: { width: 120 } }))}

      {kv(
        '租金类型',
        <input
          className="a-filter-input"
          value={value.rentType}
          onChange={(e) => patch({ rentType: e.target.value })}
          placeholder="选填"
          style={{ minWidth: 200 }}
        />,
      )}

      {kv(
        '计租面积',
        <input
          className="a-filter-input"
          value={value.rentableArea}
          onChange={(e) => patch({ rentableArea: e.target.value, utilityDepositTouched: false })}
          placeholder="默认与建筑面积相同"
          style={{ width: 160 }}
        />,
      )}

      {kv(
        '递增幅度',
        <RentEscalationBlock
          rows={value.rentEscalations}
          leaseEnd={value.leaseEnd}
          baseMonthlyRent={monthlyRent}
          rentStart={value.leaseStart}
          onChange={(rows) => patch({ rentEscalations: rows })}
        />,
        true,
      )}

      {kv('月租金', roInput(monthlyRent > 0 ? `${monthlyRent} 元/月` : '', { style: { width: 160 } }))}
      {kv('年租金', roInput(yearlyRent > 0 ? `${yearlyRent} 元/年` : '', { style: { width: 160 } }))}

      {kv(
        '银行账号',
        <input
          className="a-filter-input"
          value={value.bankAccount}
          onChange={(e) => patch({ bankAccount: e.target.value })}
          placeholder="选填"
          style={{ minWidth: 220 }}
        />,
      )}

      {kv('租赁期限', roInput(leasePeriodText, { style: { minWidth: 280 } }))}
      {kv('计租时间', roInput(value.leaseStart, { style: { width: 160 } }))}

      {kv(
        '履约保证金',
        <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="a-filter-select"
            value={value.performanceBondBase}
            onChange={(e) =>
              patch({ performanceBondBase: e.target.value as NonResidentialFormData['performanceBondBase'] })
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
            默认 30 元/㎡×计租面积，不足 500 取 500，超过 500 向上取整
          </span>
        </div>,
      )}

      {kv(
        '经营项目',
        <input
          className="a-filter-input"
          value={value.businessProject}
          onChange={(e) => patch({ businessProject: e.target.value })}
          placeholder="选填"
          style={{ minWidth: 220 }}
        />,
      )}

      {kv(
        '其他事项',
        <div style={{ maxWidth: 560 }}>
          <div
            className="a-muted"
            style={{
              marginBottom: 8,
              padding: '8px 10px',
              background: '#f8fafc',
              borderRadius: 6,
              lineHeight: 1.65,
              fontSize: 13,
              whiteSpace: 'pre-wrap',
            }}
          >
            {NON_RESIDENTIAL_OTHER_DEFAULT}
          </div>
          <textarea
            className="a-filter-input"
            value={value.otherMattersExtra}
            onChange={(e) => patch({ otherMattersExtra: e.target.value })}
            placeholder="可在此追加其他事项"
            rows={3}
            style={{ minWidth: 280, resize: 'vertical' }}
          />
          {value.otherMattersExtra.trim() ? (
            <div className="a-muted" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              预览：{otherMattersPreview}
            </div>
          ) : null}
        </div>,
      )}

      {kv(
        '缴费周期',
        <select
          className="a-filter-select"
          value={value.rentCycle}
          onChange={(e) => patch({ rentCycle: e.target.value as NonResidentialFormData['rentCycle'] })}
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
          当<strong>逾期金额</strong>超过<strong>月租金</strong>的{' '}
          <input
            className="a-filter-input"
            type="number"
            min={0.1}
            step={0.5}
            style={{ width: 72 }}
            value={value.terminationRentMultiple}
            onChange={(e) => patch({ terminationRentMultiple: e.target.value })}
          />{' '}
          倍时触发（规则配置存档；实际短信以业务接通为准）。
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
