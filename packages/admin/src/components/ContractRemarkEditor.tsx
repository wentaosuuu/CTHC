import { useCallback, useEffect, useRef } from 'react'

/** 轻量富文本（不依赖 react-quill，兼容 React 19） */
export function ContractRemarkEditor({
  value,
  onChange,
  placeholder = '可输入合同备注、补充条款说明等…',
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const lastValue = useRef(value)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (value !== lastValue.current && value !== el.innerHTML) {
      el.innerHTML = value || ''
      lastValue.current = value
    }
  }, [value])

  const sync = useCallback(() => {
    const el = ref.current
    if (!el) return
    const html = el.innerHTML === '<br>' ? '' : el.innerHTML
    lastValue.current = html
    onChange(html)
  }, [onChange])

  const cmd = (command: string, arg?: string) => {
    document.execCommand(command, false, arg)
    ref.current?.focus()
    sync()
  }

  return (
    <div className="contract-remark-editor">
      <div className="contract-remark-toolbar">
        <button type="button" className="contract-remark-tb" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('bold')}>
          <strong>B</strong>
        </button>
        <button type="button" className="contract-remark-tb" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('italic')}>
          <em>I</em>
        </button>
        <button type="button" className="contract-remark-tb" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('underline')}>
          <u>U</u>
        </button>
        <span className="contract-remark-sep" />
        <button type="button" className="contract-remark-tb" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('insertUnorderedList')}>
          列表
        </button>
        <button type="button" className="contract-remark-tb" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('insertOrderedList')}>
          编号
        </button>
        <button
          type="button"
          className="contract-remark-tb"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const url = window.prompt('链接地址（https://…）')
            if (url) cmd('createLink', url)
          }}
        >
          链接
        </button>
      </div>
      <div
        ref={ref}
        className="contract-remark-body"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={sync}
        onBlur={sync}
      />
    </div>
  )
}

export function stripHtmlToPreview(html: string, maxLen = 48): string {
  if (!html) return '—'
  const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length <= maxLen ? t || '—' : `${t.slice(0, maxLen)}…`
}

export type AttachmentItem = { id: string; name: string; file: string }
