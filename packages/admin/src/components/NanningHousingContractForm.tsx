import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { ContractRemarkEditor } from './ContractRemarkEditor'
import { HouseMultiSelectModal } from './HouseMultiSelectModal'
import { RentEscalationBlock } from './RentEscalationBlock'
import { TenantMultiSelectModal } from './TenantMultiSelectModal'
import { rentDueDayHint } from '../jiangnanFactoryContract'
import {
  BOWAN_ANNEX5_TEMPLATES,
  BOWAN_DECORATION_OPTIONS,
  bowanElevatorText,
  bowanHouseTypeText,
  bowanMonthlyRentNumber,
  bowanOccupationFeeAmount,
  bowanOwnershipText,
  bowanPerformanceBondAmount,
  formatHouseLocation,
  JIANGNAN_RENT_CYCLES,
  syncNanningHousingDerivedFields,
  sumHouseArea,
  toBowanHousePick,
  type Annex5Item,
  type NanningHousingFormData,
} from '../nanningHousingContract'

type CfgAtt = { id: string; name: string; file: string; previewUrl: string; downloadUrl: string }

type Props = {
  value: NanningHousingFormData
  onChange: (next: NanningHousingFormData) => void
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

export function NanningHousingContractForm({
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

  const patch = (p: Partial<NanningHousingFormData>) => onChange(syncNanningHousingDerivedFields(value, p))

  const locationText = useMemo(() => formatHouseLocation(value.houses), [value.houses])
  const totalArea = useMemo(() => sumHouseArea(value.houses), [value.houses])
  const monthlyRent = bowanMonthlyRentNumber(value)
  const bondAmount = bowanPerformanceBondAmount(value)
  const occupationFee = bowanOccupationFeeAmount(value)
  const houseTypeText = useMemo(() => bowanHouseTypeText(value.houses), [value.houses])
  const ownershipText = useMemo(() => bowanOwnershipText(value.houses), [value.houses])
  const elevatorText = useMemo(() => bowanElevatorText(value.houses), [value.houses])
  const annex5ReferenceTotal = useMemo(
    () => value.annex5Items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.referencePrice) || 0), 0),
    [value.annex5Items],
  )

  const patchAnnex5Item = (id: string, itemPatch: Partial<Annex5Item>) => {
    patch({ annex5Items: value.annex5Items.map((row) => (row.id === id ? { ...row, ...itemPatch } : row)) })
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
                  {t.idNumber ? ` · ${t.idNumber}` : ''}
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

      {kv(
        '是否推送账单给租户',
        <>
          <select
            className="a-filter-select"
            value={value.billPushToTenant}
            onChange={(e) => patch({ billPushToTenant: e.target.value as 'yes' | 'no' })}
          >
            <option value="yes">是</option>
            <option value="no">否</option>
          </select>
          <div className="a-muted" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.55 }}>
            选「是」时，系统按租客身份证号匹配移动端已实名用户并推送账单；若尚未实名，账单保留在系统中直至实名后自动推送。多位租客时按所选租客分别匹配。
          </div>
        </>,
      )}

      {kv('房屋坐落', roInput(locationText, { style: { minWidth: 280 }, placeholder: '选择资产后自动带出' }))}
      {kv(
        '计租面积',
        <input
          className="a-filter-input"
          value={value.rentableArea}
          onChange={(e) => patch({ rentableArea: e.target.value })}
          placeholder={totalArea > 0 ? `默认 ${totalArea}` : '㎡'}
          style={{ width: 160 }}
        />,
      )}
      {kv('房屋户型', roInput(houseTypeText, { style: { minWidth: 200 }, placeholder: '选择资产后自动带出' }))}
      {kv(
        '房屋权属',
        <div style={{ fontSize: 13, lineHeight: 1.65 }}>
          房屋所有权人为{' '}
          <strong style={{ borderBottom: '1px solid #94a3b8', padding: '0 4px' }}>
            {ownershipText || '________'}
          </strong>
          <span className="a-muted" style={{ marginLeft: 8, fontSize: 12 }}>
            （直接读取资产信息）
          </span>
        </div>,
      )}
      {kv(
        '装修情况',
        <select
          className="a-filter-select"
          value={value.decoration}
          onChange={(e) => patch({ decoration: e.target.value as NanningHousingFormData['decoration'] })}
        >
          {BOWAN_DECORATION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>,
      )}
      {kv('有无电梯', roInput(elevatorText, { style: { width: 120 }, placeholder: '有 / 无' }))}

      {kv(
        '租赁期',
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
        '租金（元/月）',
        <input
          className="a-filter-input"
          type="number"
          min={0}
          step={1}
          value={value.monthlyRent}
          onChange={(e) => patch({ monthlyRent: e.target.value, monthlyRentTouched: true })}
          placeholder="可手动修改"
          style={{ width: 160 }}
        />,
        true,
      )}

      {kv(
        '物业管理费（元/月）',
        <input
          className="a-filter-input"
          type="number"
          min={0}
          step={1}
          value={value.propertyMgmtFee}
          onChange={(e) => patch({ propertyMgmtFee: e.target.value })}
          placeholder="选填"
          style={{ width: 140 }}
        />,
      )}
      {kv(
        '垃圾处理费（元/月）',
        <input
          className="a-filter-input"
          type="number"
          min={0}
          step={1}
          value={value.garbageFee}
          onChange={(e) => patch({ garbageFee: e.target.value })}
          placeholder="选填"
          style={{ width: 140 }}
        />,
      )}

      {kv(
        '首期款计租时间',
        <div>
          <div className="a-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input
              className="a-filter-input"
              type="date"
              value={value.firstPeriodStart}
              onChange={(e) => patch({ firstPeriodStart: e.target.value })}
            />
            <span className="a-muted">至</span>
            <input
              className="a-filter-input"
              type="date"
              value={value.firstPeriodEnd}
              onChange={(e) => patch({ firstPeriodEnd: e.target.value })}
            />
          </div>
          <div className="a-muted" style={{ marginTop: 4, fontSize: 12 }}>
            默认当月剩余时段，可手动修改
          </div>
        </div>,
        true,
      )}

      {kv(
        '缴费周期',
        <select
          className="a-filter-select"
          value={value.rentCycle}
          onChange={(e) => patch({ rentCycle: e.target.value as NanningHousingFormData['rentCycle'] })}
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
        '滞纳金计算公式',
        <div style={{ maxWidth: 640, fontSize: 13, lineHeight: 1.75 }}>
          承租人逾期缴纳租金的，每逾期一天，按所欠付租金的【
          <input
            className="a-filter-input"
            style={{ width: 72, margin: '0 4px' }}
            value={value.lateFeeDailyPercent}
            onChange={(e) => patch({ lateFeeDailyPercent: e.target.value })}
            placeholder="0.1"
          />
          %】向出租人计付违约金；逾期超过【
          <input
            className="a-filter-input"
            inputMode="numeric"
            style={{ width: 72, margin: '0 4px' }}
            value={value.lateFeeTerminateDays}
            onChange={(e) => patch({ lateFeeTerminateDays: e.target.value.replace(/\D/g, '') })}
            placeholder="日"
          />
          】日仍未按约定足额付清租金的，出租人有权提前解除本合同，收回房屋。
        </div>,
        true,
      )}

      {kv(
        '租金递增',
        <RentEscalationBlock
          rows={value.rentEscalations}
          leaseEnd={value.leaseEnd}
          baseMonthlyRent={monthlyRent}
          rentStart={value.leaseStart}
          onChange={(rows) => patch({ rentEscalations: rows })}
        />,
        true,
      )}

      {kv(
        '履约保证金（元）',
        <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="a-filter-select"
            value={value.performanceBondBase}
            onChange={(e) =>
              patch({ performanceBondBase: e.target.value as NanningHousingFormData['performanceBondBase'] })
            }
          >
            <option value="FIRST_PERIOD">首期租金</option>
            <option value="LAST_PERIOD">末期租金</option>
          </select>
          <span>×</span>
          <input
            className="a-filter-input"
            style={{ width: 72 }}
            value={value.performanceBondMultiple}
            onChange={(e) => patch({ performanceBondMultiple: e.target.value })}
          />
          <span className="a-muted">倍 ≈ ¥{bondAmount}</span>
        </div>,
      )}

      {kv(
        '水电押金（元）',
        <input
          className="a-filter-input"
          type="number"
          min={0}
          step={1}
          value={value.utilityDeposit}
          onChange={(e) => patch({ utilityDeposit: e.target.value })}
          placeholder="选填"
          style={{ width: 140 }}
        />,
      )}
      {kv(
        '保洁押金（元）',
        <input
          className="a-filter-input"
          type="number"
          min={0}
          step={1}
          value={value.cleaningDeposit}
          onChange={(e) => patch({ cleaningDeposit: e.target.value })}
          placeholder="选填"
          style={{ width: 140 }}
        />,
      )}
      {kv(
        '综合押金（元）',
        <input
          className="a-filter-input"
          type="number"
          min={0}
          step={1}
          value={value.comprehensiveDeposit}
          onChange={(e) => patch({ comprehensiveDeposit: e.target.value })}
          placeholder="可手动修改"
          style={{ width: 140 }}
        />,
      )}

      {kv(
        '房屋占用费',
        <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>租金 ×</span>
          <input
            className="a-filter-input"
            style={{ width: 72 }}
            value={value.occupationFeeMultiple}
            onChange={(e) => patch({ occupationFeeMultiple: e.target.value })}
          />
          <span className="a-muted">倍 ≈ ¥{occupationFee}</span>
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
          当逾期天数超过最晚缴费日后满{' '}
          <input
            className="a-filter-input"
            inputMode="numeric"
            style={{ width: 86 }}
            value={value.terminationDaysPastDue}
            onChange={(e) => patch({ terminationDaysPastDue: e.target.value.replace(/\D/g, '') })}
          />{' '}
          天时触发。
        </div>,
      )}

      <div style={{ margin: '16px 0 8px', fontWeight: 900 }}>附件二 · 住宅承租户安全管理协议</div>
      {kv(
        '资产地址',
        <>
          {!value.annex2CustomAddress.trim() && locationText ? (
            <div className="a-muted" style={{ marginBottom: 8, lineHeight: 1.6 }}>
              {value.houses.map((h) => (
                <div key={h.id}>{h.address?.trim() || `${h.apartmentName} ${h.houseNo}`}</div>
              ))}
            </div>
          ) : null}
          <input
            className="a-filter-input"
            value={value.annex2CustomAddress}
            onChange={(e) => patch({ annex2CustomAddress: e.target.value })}
            placeholder="可选：自行填写后将替代上方罗列"
            style={{ minWidth: 280 }}
          />
        </>,
      )}

      <div style={{ margin: '16px 0 8px', fontWeight: 900 }}>
        附件五 · 房屋、设备、设施交接清单及损坏赔偿价格表
      </div>
      {kv(
        '交接清单',
        <div className="annex5-inline-editor">
          <div className="annex5-config-head">
            <div>
              <div className="annex5-config-title">泊湾公寓房屋交接清单</div>
              <div className="a-muted" style={{ marginTop: 4 }}>
                已配置 <strong>{value.annex5Items.length}</strong> 项 · 参考价值合计 <strong>¥{annex5ReferenceTotal.toFixed(2)}</strong>
              </div>
            </div>
            <span className="annex5-status-badge">待入住签字</span>
          </div>
          <div className="annex5-config-actions">
            <select
              className="a-filter-select"
              value={value.annex5Template}
              onChange={(e) => patch({ annex5Template: e.target.value as NanningHousingFormData['annex5Template'] })}
              aria-label="清单模板"
            >
              {BOWAN_ANNEX5_TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="a-btn secondary"
              onClick={() => patch({ annex5Items: [
                ...value.annex5Items,
                { id: `a5-${Date.now()}`, category: '其他', name: '', specification: '', unit: '个', quantity: '1', referencePrice: '0', moveInStatus: '完好', moveInRemark: '' },
              ] })}
            >
              + 添加项目
            </button>
          </div>
          <div className="annex5-reference-table-wrap">
            <table className="annex5-reference-table">
              <thead>
                <tr>
                  <th rowSpan={2}>序号</th>
                  <th rowSpan={2}>清点及核验项目</th>
                  <th rowSpan={2}>单位</th>
                  <th rowSpan={2}>数量</th>
                  <th rowSpan={2}>单价（元）</th>
                  <th colSpan={2}>状态确认</th>
                  <th rowSpan={2}>赔偿金</th>
                  <th rowSpan={2}>备注</th>
                </tr>
                <tr><th>入住</th><th>退租</th></tr>
              </thead>
              <tbody>
                {value.annex5Items.map((item, index) => (
                  <tr key={item.id}>
                    <td>{index + 1}</td>
                    <td><textarea rows={2} value={item.name} placeholder="请填写清点项目" onChange={(e) => patchAnnex5Item(item.id, { name: e.target.value })} /></td>
                    <td><input value={item.unit} onChange={(e) => patchAnnex5Item(item.id, { unit: e.target.value })} /></td>
                    <td><input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => patchAnnex5Item(item.id, { quantity: e.target.value })} /></td>
                    <td><input type="number" min="0" step="0.01" value={item.referencePrice} onChange={(e) => patchAnnex5Item(item.id, { referencePrice: e.target.value })} /></td>
                    <td className="annex5-check-cell"><input type="checkbox" checked={item.moveInStatus === '完好'} onChange={(e) => patchAnnex5Item(item.id, { moveInStatus: e.target.checked ? '完好' : '已损坏' })} aria-label={`第${index + 1}项入住状态`} /></td>
                    <td className="annex5-check-cell"><input type="checkbox" disabled aria-label={`第${index + 1}项退租状态`} /></td>
                    <td className="annex5-disabled-cell">/</td>
                    <td>
                      <textarea rows={2} value={item.moveInRemark} placeholder={item.moveInStatus === '完好' ? '选填' : '入住异常说明'} onChange={(e) => patchAnnex5Item(item.id, { moveInRemark: e.target.value })} />
                      <button type="button" className="annex5-row-delete" onClick={() => patch({ annex5Items: value.annex5Items.filter((row) => row.id !== item.id) })}>删除本项</button>
                    </td>
                  </tr>
                ))}
                <tr className="annex5-total-row"><td></td><td>合计</td><td></td><td>{value.annex5Items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)}</td><td></td><td></td><td></td><td>/</td><td></td></tr>
                <tr className="annex5-hygiene-row">
                  <td colSpan={2}>退租卫生核验</td>
                  <td colSpan={7}>
                    <label><input type="checkbox" disabled /> 卫生达标，符合重新出租标准</label>
                    <label><input type="checkbox" disabled /> 卫生未达标，清洁程度不满足出租要求</label>
                    <span>退租验收时由店长填写</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="annex5-inline-footer">
            <div className="annex5-flow-hint"><span>① 配置清单</span><span>→</span><span>② 店长入住签字</span><span>→</span><span>③ 租客入住签字</span></div>
            <div className="a-muted" style={{ fontSize: 12 }}>合同生效后保存入住快照；退租核验将对照该版本，不覆盖入住记录。</div>
          </div>
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
            houses: houses.map((h) => toBowanHousePick(h)),
            houseIds: houses.map((h) => h.id),
            monthlyRentTouched: false,
          })
        }
      />
    </>
  )
}
