import { useMemo } from 'react'
import './pagination.css'

export type PaginationState = {
  page: number
  pageSize: number
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize
  const end = start + pageSize
  return { total, totalPages, page: safePage, pageSize, items: items.slice(start, end) }
}

export function Pagination(props: {
  total: number
  page: number
  pageSize: number
  onChange: (next: PaginationState) => void
  pageSizeOptions?: number[]
}) {
  const { total, page, pageSize, onChange } = props
  const options = props.pageSizeOptions ?? [10, 20, 50, 100]
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const display = useMemo(() => {
    const s = (page - 1) * pageSize + 1
    const e = Math.min(total, page * pageSize)
    if (total === 0) return '0 条'
    return `${s}-${e} / ${total} 条`
  }, [page, pageSize, total])

  return (
    <div className="a-pagination">
      <div className="a-pagination-left">
        <span className="a-pagination-muted">{display}</span>
      </div>

      <div className="a-pagination-right">
        <label className="a-pagination-muted">
          每页
          <select
            className="a-pagination-select"
            value={pageSize}
            onChange={(e) => onChange({ page: 1, pageSize: Number(e.target.value) })}
          >
            {options.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          条
        </label>

        <button
          className="a-pagination-btn"
          onClick={() => onChange({ page: 1, pageSize })}
          disabled={page <= 1}
        >
          首页
        </button>
        <button
          className="a-pagination-btn"
          onClick={() => onChange({ page: Math.max(1, page - 1), pageSize })}
          disabled={page <= 1}
        >
          上一页
        </button>

        <span className="a-pagination-muted">
          第{' '}
          <input
            className="a-pagination-input"
            value={String(page)}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              onChange({ page: Math.min(Math.max(1, n), totalPages), pageSize })
            }}
          />{' '}
          / {totalPages} 页
        </span>

        <button
          className="a-pagination-btn"
          onClick={() => onChange({ page: Math.min(totalPages, page + 1), pageSize })}
          disabled={page >= totalPages}
        >
          下一页
        </button>
        <button
          className="a-pagination-btn"
          onClick={() => onChange({ page: totalPages, pageSize })}
          disabled={page >= totalPages}
        >
          末页
        </button>
      </div>
    </div>
  )
}

