import { useEffect, useRef, type ReactNode } from 'react'

export function DemoDialog({ title, onClose, children, wide = false }: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const previousFocus = document.activeElement
    const dialog = dialogRef.current
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
    ) ?? []).filter((element) => element.offsetParent !== null)
    focusables()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const elements = focusables()
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])
  return <div className="a-modal-backdrop" style={{ zIndex: 100 }}>
    <div className="a-modal" style={{ width: wide ? 1180 : 720 }} role="dialog" aria-modal="true" aria-label={title} ref={dialogRef}>
      <div className="a-modal-header"><div className="a-modal-title">{title}</div>
        <button type="button" className="a-modal-close" onClick={onClose}>关闭</button></div>
      <div className="a-modal-body" style={{ display: 'block' }}>{children}</div>
    </div>
  </div>
}
