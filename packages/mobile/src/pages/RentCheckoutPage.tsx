import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { addMyOrder, apiPost, setTenantPhone } from '../api'
import {
  BOWAN_ASSET_TYPE,
  cartHasMixedLanes,
  cartLaneLabel,
  filterCartByLane,
  getCart,
  patchCartLines,
  removeManyFromCart,
  type CartCheckoutLane,
  type CartLine,
} from '../cartStorage'
import { IdDocumentFields, useIdDocumentForm } from '../components/IdDocumentFields'

export function RentCheckoutPage() {
  const [searchParams] = useSearchParams()
  const checkoutLane = (searchParams.get('lane') === 'bowan' || searchParams.get('lane') === 'other'
    ? searchParams.get('lane')
    : null) as CartCheckoutLane | null
  const [cartLines, setCartLines] = useState<CartLine[]>([])
  const [cartHint, setCartHint] = useState('')
  const [loadErr, setLoadErr] = useState('')
  const [contractMode, setContractMode] = useState<'ONE_PER_ASSET' | 'MERGED'>('MERGED')
  const [leaseMonths, setLeaseMonths] = useState(12)
  const [moveInDate, setMoveInDate] = useState(() => new Date().toISOString().slice(0, 10))
  const idDoc = useIdDocumentForm({ phone: '13800000000', wechat: 'wx_demo' })
  const { values: docValues, validate: validateDocForm } = idDoc
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [successWecom, setSuccessWecom] = useState<{ storeName: string; qrUrl: string | null } | null>(null)
  const [showFaceModal, setShowFaceModal] = useState(false)
  const [faceSubmitting, setFaceSubmitting] = useState(false)
  const disabled = useMemo(() => cartLines.length === 0, [cartLines.length])

  useEffect(() => {
    const all = getCart()
    if (!all.length) {
      setCartLines([])
      setCartHint('')
      return
    }
    if (checkoutLane) {
      const filtered = filterCartByLane(all, checkoutLane)
      if (!filtered.length) {
        setCartLines([])
        setCartHint(`购物车中没有「${cartLaneLabel(checkoutLane)}」类房源，请返回购物车。`)
        return
      }
      setCartHint('')
      const loaded = filtered
      setCartLines(loaded)
      if (loaded.length) {
        setLeaseMonths(loaded[0].leaseMonths)
        setMoveInDate(loaded[0].moveInDate)
      }
      return
    }
    if (cartHasMixedLanes(all)) {
      setCartLines([])
      setCartHint('购物车含泊湾与其他类资产，请返回购物车分别结算。')
      return
    }
    setCartHint('')
    setCartLines(all)
    if (all.length) {
      setLeaseMonths(all[0].leaseMonths)
      setMoveInDate(all[0].moveInDate)
    }
  }, [checkoutLane])

  const allBowan = cartLines.length > 0 && cartLines.every((l) => l.assetType === BOWAN_ASSET_TYPE)
  const isMerged = contractMode === 'MERGED'

  function applyUnifiedLease(patch: { leaseMonths?: number; moveInDate?: string }) {
    const lm = patch.leaseMonths ?? leaseMonths
    const md = patch.moveInDate ?? moveInDate
    if (patch.leaseMonths != null) setLeaseMonths(lm)
    if (patch.moveInDate != null) setMoveInDate(md)
    const next = cartLines.map((l) => ({ ...l, leaseMonths: lm, moveInDate: md }))
    setCartLines(next)
    patchCartLines(
      cartLines.map((l) => l.houseId),
      { leaseMonths: lm, moveInDate: md },
    )
  }

  function updateLineLease(houseId: string, patch: Partial<Pick<CartLine, 'leaseMonths' | 'moveInDate'>>) {
    const next = cartLines.map((l) => (l.houseId === houseId ? { ...l, ...patch } : l))
    setCartLines(next)
    patchCartLines([houseId], patch)
  }

  function onContractModeChange(mode: 'ONE_PER_ASSET' | 'MERGED') {
    if (mode === contractMode) return
    setContractMode(mode)
    if (mode === 'MERGED' && cartLines.length) {
      const lm = cartLines[0].leaseMonths
      const md = cartLines[0].moveInDate
      setLeaseMonths(lm)
      setMoveInDate(md)
      applyUnifiedLease({ leaseMonths: lm, moveInDate: md })
    }
  }
  const totalRentMonthly = useMemo(
    () => cartLines.reduce((s, l) => s + l.rentMonthly, 0),
    [cartLines],
  )

    async function submitOrderToBackend() {
    if (!cartLines.length) return
    setError('')
    if (contractMode === 'MERGED') {
      if (!leaseMonths || leaseMonths < 1) {
        setError('请填写统一租期（至少 1 个月）')
        return
      }
      if (!moveInDate.trim()) {
        setError('请填写起租日')
        return
      }
    } else {
      const bad = cartLines.find((l) => !l.leaseMonths || l.leaseMonths < 1 || !l.moveInDate.trim())
      if (bad) {
        setError(`请为「${bad.title}」填写租期与起租日`)
        return
      }
    }
    setOkMsg('')
    setSuccessWecom(null)
    const createdAt = new Date().toISOString()
    const { docType, name, idNumber, phone, wechat, emergencyContactName, emergencyContactPhone, idLongTerm, idValidUntil, extraDocValidUntil } = docValues
    const idNorm =
      docType === 'IDCARD' || docType === 'USCC' ? idNumber.trim().toUpperCase() : idNumber.trim()

    const linesPayload =
      contractMode === 'MERGED'
        ? cartLines.map((l) => ({
            houseId: l.houseId,
            leaseMonths,
            moveInDate,
          }))
        : cartLines.map((l) => ({
            houseId: l.houseId,
            leaseMonths: l.leaseMonths,
            moveInDate: l.moveInDate,
          }))

    const base: Record<string, unknown> = {
      contractMode,
      lines: linesPayload,
      name: name.trim(),
      idNumber: idNorm,
      phone: phone.trim(),
      wechat,
      ...(emergencyContactName.trim() ? { emergencyContactName: emergencyContactName.trim() } : {}),
      ...(emergencyContactPhone.trim() ? { emergencyContactPhone: emergencyContactPhone.trim() } : {}),
      idDocType: docType,
    }
    if (docType === 'IDCARD') {
      base.idCardLongTerm = idLongTerm
      if (!idLongTerm) base.idCardValidUntil = idValidUntil
    } else if (docType === 'PASSPORT' || docType === 'HKM_TW_PERMIT') {
      if (extraDocValidUntil.trim()) base.docValidUntil = extraDocValidUntil.trim()
    }

    const r = await apiPost<{
      contractMode: string
      orders: { id: string; status: string; house: { storeName?: string; apartmentName?: string; houseNo?: string } }[]
      tenantPhone: string
      tips: string
      storeWecomQrUrl?: string | null
    }>('/api/orders/checkout', base)
    if (!r.ok) return setError(r.error)
    setTenantPhone(r.data.tenantPhone)
    const linesSnap = [...cartLines]
    for (let i = 0; i < r.data.orders.length; i += 1) {
      const o = r.data.orders[i]
      const line = contractMode === 'MERGED' ? linesSnap[0] : linesSnap[i]
      addMyOrder({
        id: o.id,
        createdAt,
        statusText: '已提交，等待管理员审核',
        houseTitle:
          contractMode === 'MERGED' && linesSnap.length > 1
            ? `合并意向（${linesSnap.length} 套）`
            : `${o.house?.apartmentName ?? line?.title ?? ''} · ${o.house?.houseNo ?? ''}`.replace(/^\s*·\s*$/, '').trim() || line?.title || '订单',
        houseSubtitle: o.house?.storeName ?? line?.subtitle ?? '',
        rentMonthly:
          contractMode === 'MERGED'
            ? linesSnap.reduce((s, x) => s + x.rentMonthly, 0)
            : line?.rentMonthly,
      })
    }
    removeManyFromCart(cartLines.map((l) => l.houseId))
    setCartLines([])
    const storeName = r.data.orders[0]?.house?.storeName ?? '门店'
    setSuccessWecom({
      storeName,
      qrUrl: r.data.storeWecomQrUrl ?? null,
    })
    const ids = r.data.orders.map((o) => o.id).join('、')
    setOkMsg(`${r.data.tips ?? '提交成功'} 订单号：${ids}`)
  }

  function onTapDirectOrder() {
    setError('')
    idDoc.setOcrError('')
    const formErr = validateDocForm()
    if (formErr) {
      setError(formErr)
      return
    }
    setShowFaceModal(true)
  }

  async function onFaceVerifySuccess() {
    setFaceSubmitting(true)
    setShowFaceModal(false)
    await submitOrderToBackend()
    setFaceSubmitting(false)
  }

  const orderPlaced = Boolean(okMsg)

  const documentBlock = !orderPlaced ? <IdDocumentFields {...idDoc.fieldsProps} /> : null

  if (loadErr) {
    return (
      <div className="m-col">
        <div className="m-card m-error">无法加载：{loadErr}</div>
        <Link className="m-btn ghost" to="/cart" style={{ textAlign: 'center' }}>
          返回购物车
        </Link>
      </div>
    )
  }

  if (!cartLines.length) {
    return (
      <div className="m-col">
        <div className="m-card m-muted">{cartHint || '购物车为空，请先选择房源。'}</div>
        <Link className="m-btn" to="/cart">
          去购物车
        </Link>
      </div>
    )
  }

  return (
    <div className="m-col">
      {!orderPlaced ? (
        <>
          <div className="m-card m-checkout-intro">
            <div className="m-checkout-summary-title">
              结算 · {checkoutLane ? cartLaneLabel(checkoutLane) : '当前类别'} · {cartLines.length} 套
            </div>
            <p className="m-muted" style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.5 }}>
              请先选择合同形式，再填写租期与起租日。
            </p>
          </div>

          <div className="m-card m-checkout-mode">
            <div className="m-checkout-sec-title">合同形式</div>
            <label className="m-verify-agree m-checkout-radio">
              <input
                type="radio"
                name="cm"
                checked={isMerged}
                onChange={() => onContractModeChange('MERGED')}
              />
              <span>
                <strong>多对一</strong>：多套合并为一份合同，账单按该合同出账；费用明细可按套展开查看。
              </span>
            </label>
            <label className="m-verify-agree m-checkout-radio">
              <input
                type="radio"
                name="cm"
                checked={contractMode === 'ONE_PER_ASSET'}
                onChange={() => onContractModeChange('ONE_PER_ASSET')}
              />
              <span>
                <strong>一对一</strong>：每套单独生成订单，后续各签一份合同。
              </span>
            </label>
            {isMerged ? (
              <div className="m-checkout-mode-hint">
                合并为一份合同，<strong>全部资产共用同一租期与起租日</strong>，请在下方统一填写。
              </div>
            ) : (
              <div className="m-checkout-mode-hint">
                每套单独签约，请在下方资产清单中<strong>分别填写</strong>各套租期与起租日。
              </div>
            )}
          </div>

          {isMerged ? (
            <div className="m-card m-checkout-lease-card">
              <div className="m-checkout-sec-title">统一租期与起租日</div>
              <div className="m-checkout-lease-grid">
                <div className="m-checkout-lease-field m-checkout-lease-field--months">
                  <label className="m-checkout-lease-label">租期（月）</label>
                  <input
                    className="m-input"
                    type="number"
                    min={1}
                    max={36}
                    value={leaseMonths}
                    onChange={(e) => applyUnifiedLease({ leaseMonths: Number(e.target.value) })}
                  />
                </div>
                <div className="m-checkout-lease-field">
                  <label className="m-checkout-lease-label">起租日</label>
                  <input
                    className="m-input"
                    type="date"
                    value={moveInDate}
                    onChange={(e) => applyUnifiedLease({ moveInDate: e.target.value })}
                  />
                </div>
              </div>
              <p className="m-checkout-lease-foot">将应用于本单全部 {cartLines.length} 套资产。</p>
            </div>
          ) : null}

          {isMerged && cartLines.length > 1 ? (
            <div className="m-checkout-merge-strip">
              本单共 {cartLines.length} 套 · 将生成 1 份合同 · 租期 {leaseMonths} 月 · 起租 {moveInDate}
            </div>
          ) : null}

          <div className="m-card m-checkout-summary">
            <div className="m-checkout-summary-head">
              <span className="m-checkout-summary-title">资产清单</span>
              <Link to="/cart" className="m-checkout-edit-link">
                调整
              </Link>
            </div>
            <div className="m-checkout-line-list">
              {cartLines.map((l) => (
                <div key={l.houseId} className="m-checkout-line m-checkout-line--stacked">
                  <div className="m-checkout-line-main">
                    <div className="m-checkout-line-body">
                      <div className="m-checkout-line-title">{l.title}</div>
                      <div className="m-checkout-line-sub">{l.subtitle}</div>
                      <div className="m-checkout-line-tag">{l.assetType}</div>
                      {isMerged ? (
                        <div className="m-checkout-line-lease-read">
                          租期 {leaseMonths} 月 · 起租 {moveInDate}
                        </div>
                      ) : null}
                    </div>
                    <div className="m-checkout-line-rent">
                      <span className="m-checkout-line-rent-num">¥{l.rentMonthly}</span>
                      <span className="m-checkout-line-rent-suf">/月</span>
                    </div>
                  </div>
                  {!isMerged ? (
                    <div className="m-checkout-line-lease">
                      <div className="m-checkout-line-lease-field">
                        <span className="m-checkout-line-lease-label">租期</span>
                        <input
                          className="m-cart-line-input m-cart-line-input--months"
                          type="number"
                          min={1}
                          max={36}
                          inputMode="numeric"
                          value={l.leaseMonths}
                          onChange={(e) => updateLineLease(l.houseId, { leaseMonths: Number(e.target.value) })}
                          aria-label={`${l.title} 租期`}
                        />
                      </div>
                      <div className="m-checkout-line-lease-field">
                        <span className="m-checkout-line-lease-label">起租</span>
                        <input
                          className="m-cart-line-input m-cart-line-input--date"
                          type="date"
                          value={l.moveInDate}
                          onChange={(e) => updateLineLease(l.houseId, { moveInDate: e.target.value })}
                          aria-label={`${l.title} 起租日`}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="m-checkout-summary-foot">
              <span>月租合计（不含物业、水电等）</span>
              <strong className="m-checkout-summary-total">¥{totalRentMonthly}</strong>
            </div>
          </div>

          {!allBowan ? (
            <div className="m-card m-checkout-note">
              <div className="m-checkout-note-title">多资产意向</div>
              <p className="m-checkout-note-body">
                含非泊湾公寓类房源时，仅提交意向由店长审核；租期与起租日按上方所选合同形式填写即可。
              </p>
            </div>
          ) : null}

          {allBowan ? (
            <>
              <div className="m-card m-order-intro">
                <div className="m-order-intro-title">请录入承租与实名信息</div>
                <div className="m-muted">填写后点击「提交订单」，将先完成扫脸实名认证再提交至后台。</div>
              </div>
              {documentBlock}
            </>
          ) : (
            <>
              <div className="m-card m-order-intro">
                <div className="m-order-intro-title">请上传证件并核对联系方式</div>
                <div className="m-muted">信息将随意向一并提交门店审核。</div>
              </div>
              {documentBlock}
            </>
          )}
        </>
      ) : null}

      {!orderPlaced && error ? <div className="m-card m-error">提交失败：{error}</div> : null}

      {orderPlaced && okMsg ? (
        <div className="m-card m-order-success m-order-success-only">
          <div className="m-order-success-badge">下单成功</div>
          <div className="m-success">{okMsg}</div>
          {successWecom ? (
            <div className="m-wecom-block">
              <div className="m-wecom-title">联系店长（企业微信）</div>
              <p className="m-wecom-tip m-wecom-tip-em">
                请优先完成这一步：长按下图保存二维码，用<strong>微信扫一扫</strong>添加店长企业微信，方便跟进<strong>审核与签约</strong>。
              </p>
              <p className="m-wecom-tip">
                订单已提交至 <strong>{successWecom.storeName}</strong>。
              </p>
              {successWecom.qrUrl ? (
                <div className="m-wecom-qr-wrap">
                  <img
                    className="m-wecom-qr"
                    src={successWecom.qrUrl}
                    alt={`${successWecom.storeName}店长企业微信二维码`}
                  />
                </div>
              ) : (
                <p className="m-muted m-wecom-fallback">
                  该门店暂未上传企微二维码，请通过订单页预留的手机号等待店长与您联系。
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {!orderPlaced && allBowan ? (
        <div className="m-row" style={{ gap: 10 }}>
          <button
            type="button"
            className="m-btn"
            disabled={disabled || faceSubmitting}
            onClick={onTapDirectOrder}
            style={{ flex: 1 }}
          >
            {faceSubmitting ? '提交中…' : '提交订单'}
          </button>
        </div>
      ) : null}

      {!orderPlaced && !allBowan ? (
        <div className="m-row" style={{ gap: 10 }}>
          <Link className="m-btn ghost" to="/cart" style={{ flex: 1, textAlign: 'center' }}>
            返回购物车
          </Link>
          <button
            type="button"
            className="m-btn"
            style={{ flex: 1 }}
            disabled={disabled || faceSubmitting}
            onClick={onTapDirectOrder}
          >
            {faceSubmitting ? '提交中…' : '提交订单'}
          </button>
        </div>
      ) : null}

      {showFaceModal && !orderPlaced && (
        <div
          className="m-modal-backdrop"
          onClick={() => setShowFaceModal(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowFaceModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="face-modal-title"
        >
          <div className="m-modal-box m-face-modal" onClick={(e) => e.stopPropagation()}>
            <div className="m-modal-title" id="face-modal-title">扫脸实名认证</div>
            <div className="m-modal-desc">
              提交订单前需完成实名认证。此处将调起扫脸认证接口（如：对接公安/第三方活体检测），
              真实场景中会打开摄像头进行人脸识别，通过后即可提交购物车订单至店长审核。
            </div>
            <div className="m-face-demo-tip">
              <strong>说明：</strong>不实际调用认证接口，点击下方按钮即视为「认证成功」，
              随后将把订单信息提交至管理后台。
            </div>
            <div className="m-modal-actions">
              <button type="button" className="m-modal-close" onClick={() => setShowFaceModal(false)}>
                取消
              </button>
              <button type="button" className="m-btn" onClick={onFaceVerifySuccess}>
                模拟认证成功并提交
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
