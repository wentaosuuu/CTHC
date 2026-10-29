import { useEffect, useId, useRef } from 'react'
import { contractTemplateZh, type ContractTemplateKind } from '../contractTemplate'
import { contractDraftFields, plainContractRemark, type ContractDraftForm } from '../contractDraftPreview'

type Props = {
  template: ContractTemplateKind
  form: ContractDraftForm
  attachmentNames: string[]
  onClose: () => void
}

export function ContractDraftPreview({ template, form, attachmentNames, onClose }: Props) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      if (event.key === 'Tab') {
        const buttons = panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
        if (!buttons?.length) return
        const first = buttons[0]!
        const last = buttons[buttons.length - 1]!
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus() }
  }, [onClose])
  const fields = contractDraftFields(template, form)
  const annex5Items = 'annex5Items' in form ? form.annex5Items : []
  return <div className="a-modal-backdrop" style={{ zIndex: 2000 }} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={panelRef} className="a-modal" style={{ maxWidth: 1100 }} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div className="a-modal-header"><div className="a-modal-title" id={titleId}>{contractTemplateZh(template)} · 草稿预览</div><button type="button" className="a-modal-close" onClick={onClose}>关闭预览</button></div>
      <div className="a-modal-body" style={{ display: 'block', maxHeight: '78vh', overflowY: 'auto' }}>
        <p className="a-muted" style={{ marginTop: 0 }}>以下按当前填写内容展示合同要素、条款选择和附件，空项标为“待填写”。关闭预览后可继续修改；预览不会保存、发送或生效。</p>
        <h2 className="a-h2" style={{ textAlign: 'center' }}>{contractTemplateZh(template)}</h2>
        <h3>一、承租人及租赁资产</h3>
        <div className="a-kv"><div className="a-kv-row"><div className="a-kv-k">承租人</div><div className="a-kv-v">{form.tenants.length ? form.tenants.map((tenant) => `${tenant.name}（${tenant.phone}）`).join('；') : '待选择'}</div></div></div>
        <div className="a-table-wrap"><table className="a-table"><thead><tr><th>资产</th><th>门店</th><th>坐落</th><th>面积（㎡）</th><th>签约月租（元）</th></tr></thead><tbody>{form.houses.length ? form.houses.map((house) => <tr key={house.id}><td>{house.apartmentName} {house.houseNo}</td><td>{house.storeName || '—'}</td><td>{house.address || '—'}</td><td>{house.area || '—'}</td><td>{house.rentMonthly}</td></tr>) : <tr><td colSpan={5} className="a-muted">待选择租赁资产</td></tr>}</tbody></table></div>
        <h3>二、租赁期限、费用及条款约定</h3>
        <div className="a-kv">{fields.map((field) => <div className="a-kv-row" key={field.label}><div className="a-kv-k">{field.label}</div><div className="a-kv-v" style={{ whiteSpace: 'pre-wrap' }}>{field.value}</div></div>)}</div>
        <h3>三、计租段及递增幅度</h3>
        <div className="a-table-wrap"><table className="a-table"><thead><tr><th>段次</th><th>起始日</th><th>截止日</th><th>递增方式</th><th>递增值</th><th>月租（元）</th></tr></thead><tbody>{form.rentEscalations.length ? form.rentEscalations.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.periodStart || '待填写'}</td><td>{row.periodEnd || '待填写'}</td><td>{({ NONE: '无递增', PERCENT: '百分比', FIXED: '固定金额' })[row.incrementType]}</td><td>{row.incrementType === 'NONE' ? '—' : row.incrementValue || '待填写'}</td><td>{row.monthlyRent}</td></tr>) : <tr><td colSpan={6} className="a-muted">暂无计租段</td></tr>}</tbody></table></div>
        {'annex5Items' in form ? <><h3>四、附件五：交接清单</h3><div className="a-table-wrap"><table className="a-table"><thead><tr><th>分类</th><th>项目</th><th>规格</th><th>单位</th><th>数量</th><th>参考单价</th><th>小计</th><th>入住状态</th><th>备注</th></tr></thead><tbody>{annex5Items.length ? annex5Items.map((item) => <tr key={item.id}><td>{item.category || '—'}</td><td>{item.name || '待填写'}</td><td>{item.specification || '—'}</td><td>{item.unit || '—'}</td><td>{item.quantity}</td><td>{item.referencePrice}</td><td>{(Number(item.quantity || 0) * Number(item.referencePrice || 0)).toFixed(2)}</td><td>{item.moveInStatus}</td><td>{item.moveInRemark || '—'}</td></tr>) : <tr><td colSpan={9} className="a-muted">暂无交接项目</td></tr>}</tbody></table></div></> : null}
        <h3>{'annex5Items' in form ? '五' : '四'}、补充约定及附件</h3>
        <div className="a-card" style={{ whiteSpace: 'pre-wrap' }}>{plainContractRemark(form.remarkHtml) || '暂无补充约定'}</div>
        <p>上传附件：{attachmentNames.length ? attachmentNames.join('；') : '暂无附件'}</p>
      </div>
      <div className="a-modal-footer"><button type="button" className="a-btn" onClick={onClose}>返回继续填写</button></div>
    </div>
  </div>
}
