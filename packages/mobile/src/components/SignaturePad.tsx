import { useEffect, useRef, useState } from 'react'

type Props = {
  value: string
  onChange: (dataUrl: string) => void
  height?: number
}

/** 简易手写电子签名板（输出 PNG data URL） */
export function SignaturePad({ value, onChange, height = 160 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [hasStroke, setHasStroke] = useState(Boolean(value))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    const width = canvas.clientWidth
    canvas.width = Math.floor(width * ratio)
    canvas.height = Math.floor(height * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    if (value) {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height)
        setHasStroke(true)
      }
      img.src = value
    }
  }, [height]) // eslint-disable-line react-hooks/exhaustive-deps -- remount sizing only

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function emit() {
    const canvas = canvasRef.current
    if (!canvas) return
    onChange(canvas.toDataURL('image/png'))
  }

  return (
    <div className="m-sign-pad">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height }}
        onPointerDown={(e) => {
          const canvas = canvasRef.current
          const ctx = canvas?.getContext('2d')
          if (!canvas || !ctx) return
          canvas.setPointerCapture(e.pointerId)
          drawing.current = true
          const p = pos(e)
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          setHasStroke(true)
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const ctx = canvasRef.current?.getContext('2d')
          if (!ctx) return
          const p = pos(e)
          ctx.lineTo(p.x, p.y)
          ctx.stroke()
        }}
        onPointerUp={() => {
          drawing.current = false
          emit()
        }}
        onPointerCancel={() => {
          drawing.current = false
        }}
      />
      <div className="m-sign-pad-actions">
        <span className="m-muted">{hasStroke ? '已采集签名' : '请在上方区域手写签名'}</span>
        <button
          type="button"
          className="m-btn ghost"
          onClick={() => {
            const canvas = canvasRef.current
            const ctx = canvas?.getContext('2d')
            if (!canvas || !ctx) return
            ctx.fillStyle = '#fff'
            ctx.fillRect(0, 0, canvas.clientWidth, height)
            setHasStroke(false)
            onChange('')
          }}
        >
          清除重签
        </button>
      </div>
    </div>
  )
}
