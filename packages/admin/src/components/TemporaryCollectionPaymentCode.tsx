import { useEffect, useState } from 'react'
import { temporaryCollectionQrPayload } from '../temporaryCollectionData'

/** 二维码在浏览器内编码，不请求第三方服务，也不包含收款资料。 */
export function TemporaryCollectionPaymentCode({ id }: { id: string }) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ id: string; attempt: number; image: string; error: string } | null>(null)
  useEffect(() => {
    let active = true
    void import('qrcode').then(async ({ default: QRCode }) => {
      const image = await QRCode.toDataURL(temporaryCollectionQrPayload(id), {
        width: 248, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' },
      })
      if (active) setResult({ id, attempt, image, error: '' })
    }).catch(() => {
      if (active) setResult({ id, attempt, image: '', error: '本地演示二维码生成失败，请重试。' })
    })
    return () => { active = false }
  }, [id, attempt])
  const current = result?.id === id && result.attempt === attempt ? result : null
  return <div style={{ margin: '20px auto', textAlign: 'center' }}>
    {current?.image ? <img src={current.image} alt="本地演示付款二维码，不用于真实支付" width={248} height={248} style={{ border: '1px solid #e2e8f0', borderRadius: 12 }} />
      : current?.error ? <div role="alert"><p style={{ color: '#b91c1c' }}>{current.error}</p><button type="button" className="a-btn ghost" onClick={() => setAttempt(previous => previous + 1)}>重试生成</button></div>
        : <p className="a-muted" role="status">正在本地生成演示二维码…</p>}
    <p className="a-muted" style={{ fontSize: 12 }}>二维码仅含随机演示编号；扫码不会发起真实付款。</p>
  </div>
}
