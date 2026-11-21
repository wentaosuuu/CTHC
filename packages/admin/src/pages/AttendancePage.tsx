import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api'
import { Pagination, paginate } from '../components/Pagination'
import './workbenchInsight.css'

type AttendanceItem = {
  adminId: string
  name: string
  email: string
  roleLabel: string
  stores: string[]
  loginCount: number
  signedDays: number
  operationCount: number
  durationMs: number
  lastLoginAt: string | null
  lastLogoutAt: string | null
}

type CalendarDay = { date: string; signed: boolean; status: 'signed' | 'absent' | 'future' }

type DetailPayload = {
  month: string
  day: string | null
  admin: { id: string; name: string; email: string; roleLabel: string; stores: string[] }
  summary: { loginCount: number; signedDays: number; durationMs: number; operationCount: number }
  calendar: CalendarDay[]
  sessions: Array<{
    id: string
    loginAt: string
    logoutAt: string | null
    durationMs: number
    ip: string | null
  }>
  operations: Array<{
    id: string
    actionLabel: string
    detail: string
    occurredAt: string
  }>
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function formatDuration(ms: number) {
  const totalMin = Math.max(0, Math.round(ms / 60_000))
  if (totalMin <= 0) return '进行中'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h <= 0) return `${m} 分钟`
  return `${h} 小时 ${m} 分钟`
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 登录会话窄栏用：更短时间展示，避免横向滚动 */
function formatDateTimeCompact(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDurationCompact(ms: number) {
  const totalMin = Math.max(0, Math.round(ms / 60_000))
  if (totalMin <= 0) return '进行中'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h <= 0) return `${m}分`
  return `${h}时${m}分`
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  const safe = /^[=+@-]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const blob = new Blob(
    ['\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')],
    { type: 'text/csv;charset=utf-8' },
  )
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

type OpFilters = {
  userName: string
  nickName: string
  phone: string
  action: string
  from: string
  to: string
}

const emptyOpFilters: OpFilters = {
  userName: '',
  nickName: '',
  phone: '',
  action: '',
  from: '',
  to: '',
}

function opDay(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type ListFilters = {
  userName: string
  nickName: string
  phone: string
  roleLabel: string
  storeId: string
}

const emptyListFilters: ListFilters = {
  userName: '',
  nickName: '',
  phone: '',
  roleLabel: '',
  storeId: '',
}

export function AttendancePage() {
  const [month, setMonth] = useState(currentMonth)
  const [monthInput, setMonthInput] = useState(currentMonth)
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([])
  const [items, setItems] = useState<AttendanceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailPayload | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [opInputs, setOpInputs] = useState<OpFilters>(emptyOpFilters)
  const [opFilters, setOpFilters] = useState<OpFilters>(emptyOpFilters)
  const [opPagination, setOpPagination] = useState({ page: 1, pageSize: 10 })
  const [sessionPagination, setSessionPagination] = useState({ page: 1, pageSize: 5 })
  const [listInputs, setListInputs] = useState<ListFilters>(emptyListFilters)
  const [listFilters, setListFilters] = useState<ListFilters>(emptyListFilters)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    const q = new URLSearchParams({ month })
    apiGet<{ stores: Array<{ id: string; name: string }>; items: AttendanceItem[] }>(
      `/api/admin/workbench/attendance?${q}`,
    ).then((r) => {
      if (!alive) return
      if (!r.ok) {
        setError(r.error)
        setItems([])
        setSelectedId(null)
        setDetail(null)
        setLoading(false)
        return
      }
      setStores(r.data.stores)
      setItems(r.data.items)
      setSelectedDay(null)
      setOpInputs(emptyOpFilters)
      setOpFilters(emptyOpFilters)
      setLoading(false)
      setPagination((p) => ({ ...p, page: 1 }))
    })
    return () => { alive = false }
  }, [month])

  const roleOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.roleLabel))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [items],
  )

  const filteredItems = useMemo(() => {
    const userName = listFilters.userName.trim().toLowerCase()
    const nickName = listFilters.nickName.trim().toLowerCase()
    const phone = listFilters.phone.trim()
    const roleLabel = listFilters.roleLabel.trim()
    const storeName = stores.find((s) => s.id === listFilters.storeId)?.name ?? ''
    return items.filter((item) => {
      if (userName && !item.email.toLowerCase().includes(userName)) return false
      if (nickName && !item.name.toLowerCase().includes(nickName)) return false
      if (phone) {
        const digits = phone.replace(/\D/g, '')
        const emailDigits = item.email.replace(/\D/g, '')
        if (!item.email.toLowerCase().includes(phone.toLowerCase()) && !(digits && emailDigits.includes(digits))) {
          return false
        }
      }
      if (roleLabel && item.roleLabel !== roleLabel) return false
      if (listFilters.storeId && storeName && !item.stores.includes(storeName)) return false
      return true
    })
  }, [items, listFilters, stores])

  useEffect(() => {
    if (!filteredItems.length) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !filteredItems.some((item) => item.adminId === selectedId)) {
      setSelectedId(filteredItems[0].adminId)
      setSelectedDay(null)
      setOpInputs(emptyOpFilters)
      setOpFilters(emptyOpFilters)
      setOpPagination((p) => ({ ...p, page: 1 }))
      setSessionPagination((p) => ({ ...p, page: 1 }))
    }
  }, [filteredItems, selectedId])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let alive = true
    setDetailLoading(true)
    const q = new URLSearchParams({ month })
    if (selectedDay) q.set('day', selectedDay)
    apiGet<DetailPayload>(`/api/admin/workbench/attendance/${selectedId}?${q}`).then((r) => {
      if (!alive) return
      setDetailLoading(false)
      if (!r.ok) {
        setDetail(null)
        return
      }
      setDetail(r.data)
    })
    return () => { alive = false }
  }, [selectedId, month, selectedDay])

  const paged = useMemo(
    () => paginate(filteredItems, pagination.page, pagination.pageSize),
    [filteredItems, pagination],
  )

  function applyListFilters(event?: { preventDefault(): void }) {
    event?.preventDefault()
    setMonth(monthInput)
    setListFilters({ ...listInputs })
    setPagination((p) => ({ ...p, page: 1 }))
  }

  function resetListFilters() {
    const now = currentMonth()
    setMonthInput(now)
    setMonth(now)
    setListInputs(emptyListFilters)
    setListFilters(emptyListFilters)
    setPagination((p) => ({ ...p, page: 1 }))
  }

  function exportAttendanceList() {
    const rows: unknown[][] = [[
      '用户昵称', '用户名称', '角色', '部门', '签到天数', '登录次数', '登录时长', '操作次数', '最近登录', '最近退出', '统计月份',
    ]]
    for (const row of filteredItems) {
      rows.push([
        row.name,
        row.email,
        row.roleLabel,
        row.stores.join('、') || '—',
        row.signedDays,
        row.loginCount,
        formatDuration(row.durationMs),
        row.operationCount,
        formatDateTime(row.lastLoginAt),
        formatDateTime(row.lastLogoutAt),
        month,
      ])
    }
    downloadCsv(`考勤记录表-${month}.csv`, rows)
  }

  function exportOperationLogs() {
    if (!detail) return
    const rows: unknown[][] = [[
      '用户名称', '用户昵称', '角色', '部门', '操作时间', '操作类型', '操作详情', '统计月份',
    ]]
    for (const op of filteredOperations) {
      rows.push([
        detail.admin.email,
        detail.admin.name,
        detail.admin.roleLabel,
        detail.admin.stores.join('、') || '—',
        formatDateTime(op.occurredAt),
        op.actionLabel,
        op.detail || '—',
        month,
      ])
    }
    downloadCsv(`操作日志-${detail.admin.name}-${month}.csv`, rows)
  }

  const calendarStartPad = useMemo(() => {
    if (!detail?.calendar.length) return 0
    const first = new Date(`${detail.calendar[0].date}T12:00:00`)
    // 周一为一周起点
    return (first.getDay() + 6) % 7
  }, [detail])

  const actionOptions = useMemo(() => {
    if (!detail) return [] as string[]
    return Array.from(new Set(detail.operations.map((op) => op.actionLabel))).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [detail])

  const filteredOperations = useMemo(() => {
    if (!detail) return []
    const userName = opFilters.userName.trim().toLowerCase()
    const nickName = opFilters.nickName.trim().toLowerCase()
    const phone = opFilters.phone.trim()
    const adminLogin = detail.admin.email.toLowerCase()
    const adminNick = detail.admin.name.toLowerCase()
    // 演示库暂无独立手机字段，用邮箱数字段做兼容匹配，保留与真实用户管理一致的筛选项
    const adminPhone = detail.admin.email.replace(/\D/g, '')

    return detail.operations.filter((op) => {
      if (userName && !adminLogin.includes(userName)) return false
      if (nickName && !adminNick.includes(nickName)) return false
      if (phone && !adminPhone.includes(phone.replace(/\D/g, '')) && !adminLogin.includes(phone.toLowerCase())) return false
      if (opFilters.action && op.actionLabel !== opFilters.action) return false
      const day = opDay(op.occurredAt)
      if (opFilters.from && day < opFilters.from) return false
      if (opFilters.to && day > opFilters.to) return false
      return true
    })
  }, [detail, opFilters])

  const pagedOperations = useMemo(
    () => paginate(filteredOperations, opPagination.page, opPagination.pageSize),
    [filteredOperations, opPagination],
  )

  const pagedSessions = useMemo(
    () => paginate(detail?.sessions ?? [], sessionPagination.page, sessionPagination.pageSize),
    [detail?.sessions, sessionPagination],
  )

  function applyOpFilters(event?: { preventDefault(): void }) {
    event?.preventDefault()
    setOpFilters({ ...opInputs })
    setOpPagination((p) => ({ ...p, page: 1 }))
  }

  function resetOpFilters() {
    setOpInputs(emptyOpFilters)
    setOpFilters(emptyOpFilters)
    setSelectedDay(null)
    setOpPagination((p) => ({ ...p, page: 1 }))
    setSessionPagination((p) => ({ ...p, page: 1 }))
  }

  return (
    <div className="a-workbench-insight">
      <div className="a-muted">工作台</div>
      <div className="a-h1">考勤记录表</div>
      <p className="a-muted a-workbench-insight-lead">
        查看各部门使用人员是否上线、登录次数/时长，以及具体操作。列表看整体；点进个人后左侧看操作日志，右侧看登录日历。
      </p>

      <form className="a-card a-workbench-insight-toolbar a-workbench-list-filterbar" onSubmit={applyListFilters}>
        <label className="a-workbench-insight-field">
          <span>月份</span>
          <input type="month" value={monthInput} onChange={(e) => setMonthInput(e.target.value)} />
        </label>
        <label className="a-workbench-insight-field">
          <span>用户名称</span>
          <input
            value={listInputs.userName}
            placeholder="请输入用户名称"
            onChange={(e) => setListInputs({ ...listInputs, userName: e.target.value })}
          />
        </label>
        <label className="a-workbench-insight-field">
          <span>用户昵称</span>
          <input
            value={listInputs.nickName}
            placeholder="请输入用户昵称"
            onChange={(e) => setListInputs({ ...listInputs, nickName: e.target.value })}
          />
        </label>
        <label className="a-workbench-insight-field">
          <span>手机号码</span>
          <input
            type="tel"
            value={listInputs.phone}
            placeholder="请输入手机号码"
            onChange={(e) => setListInputs({ ...listInputs, phone: e.target.value })}
          />
        </label>
        <label className="a-workbench-insight-field">
          <span>角色</span>
          <select
            value={listInputs.roleLabel}
            onChange={(e) => setListInputs({ ...listInputs, roleLabel: e.target.value })}
          >
            <option value="">全部角色</option>
            {roleOptions.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
        </label>
        <label className="a-workbench-insight-field">
          <span>部门</span>
          <select
            value={listInputs.storeId}
            onChange={(e) => setListInputs({ ...listInputs, storeId: e.target.value })}
          >
            <option value="">全部部门</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <div className="a-workbench-op-filter-actions">
          <button type="submit" className="a-btn">搜索</button>
          <button type="button" className="a-btn ghost" onClick={resetListFilters}>重置</button>
          <button type="button" className="a-btn ghost" onClick={exportAttendanceList} disabled={!filteredItems.length}>
            导出
          </button>
        </div>
      </form>

      {error ? <div className="a-card a-workbench-insight-error">{error}</div> : null}

      <div className="a-card">
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>用户名称</th>
                <th>角色</th>
                <th>部门</th>
                <th>签到天数</th>
                <th>登录次数</th>
                <th>登录时长</th>
                <th>操作次数</th>
                <th>最近登录</th>
                <th>最近退出</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="a-muted">加载中…</td></tr>
              ) : paged.items.length === 0 ? (
                <tr><td colSpan={10} className="a-muted">本月暂无考勤数据</td></tr>
              ) : paged.items.map((row) => (
                <tr
                  key={row.adminId}
                  className={selectedId === row.adminId ? 'is-selected' : undefined}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    if (selectedId === row.adminId) return
                    setSelectedId(row.adminId)
                    setSelectedDay(null)
                    setOpInputs(emptyOpFilters)
                    setOpFilters(emptyOpFilters)
                    setOpPagination((p) => ({ ...p, page: 1 }))
                    setSessionPagination((p) => ({ ...p, page: 1 }))
                  }}
                >
                  <td>
                    <div className="a-workbench-insight-name">{row.email}</div>
                    <div className="a-muted a-workbench-insight-sub">{row.name}</div>
                  </td>
                  <td>{row.roleLabel}</td>
                  <td>{row.stores.length ? row.stores.join('、') : '—'}</td>
                  <td>{row.signedDays}</td>
                  <td>{row.loginCount}</td>
                  <td>{formatDuration(row.durationMs)}</td>
                  <td>{row.operationCount}</td>
                  <td>{formatDateTime(row.lastLoginAt)}</td>
                  <td>{formatDateTime(row.lastLogoutAt)}</td>
                  <td>
                    <span className="a-muted">{selectedId === row.adminId ? '当前查看' : '点击查看'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={filteredItems.length}
          onChange={setPagination}
        />
      </div>

      {selectedId ? (
        <div className="a-card a-workbench-insight-detail">
          <div className="a-workbench-insight-detail-head">
            <div>
              <div className="a-workbench-insight-detail-title">
                {detail?.admin.name ?? '…'} · 个人考勤
              </div>
              <div className="a-muted">
                {detail ? `${detail.admin.roleLabel} · ${(detail.admin.stores.join('、') || '未绑定部门')}` : '加载中…'}
              </div>
            </div>
          </div>

          {detailLoading && !detail ? <p className="a-muted">详情加载中…</p> : null}
          {detail ? (
            <>
              <div className="a-workbench-detail-split">
                <section className="a-workbench-detail-pane a-workbench-detail-pane--ops">
                  <div className="a-workbench-detail-pane-head">
                    <strong>操作日志</strong>
                    <span className="a-muted">
                      {selectedDay ? `日历已选 ${selectedDay}` : `共 ${filteredOperations.length} 条`}
                    </span>
                  </div>

                  <form className="a-workbench-op-filterbar" onSubmit={applyOpFilters}>
                    <label>
                      用户名称
                      <input
                        className="a-filter-input"
                        value={opInputs.userName}
                        placeholder="请输入用户名称"
                        onChange={(e) => setOpInputs({ ...opInputs, userName: e.target.value })}
                      />
                    </label>
                    <label>
                      用户昵称
                      <input
                        className="a-filter-input"
                        value={opInputs.nickName}
                        placeholder="请输入用户昵称"
                        onChange={(e) => setOpInputs({ ...opInputs, nickName: e.target.value })}
                      />
                    </label>
                    <label>
                      手机号码
                      <input
                        className="a-filter-input"
                        type="tel"
                        value={opInputs.phone}
                        placeholder="请输入手机号码"
                        onChange={(e) => setOpInputs({ ...opInputs, phone: e.target.value })}
                      />
                    </label>
                    <label>
                      操作类型
                      <select
                        className="a-filter-select"
                        value={opInputs.action}
                        onChange={(e) => setOpInputs({ ...opInputs, action: e.target.value })}
                      >
                        <option value="">全部类型</option>
                        {actionOptions.map((action) => (
                          <option key={action} value={action}>{action}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      操作时间起
                      <input
                        className="a-filter-input"
                        type="date"
                        value={opInputs.from}
                        onChange={(e) => setOpInputs({ ...opInputs, from: e.target.value })}
                      />
                    </label>
                    <label>
                      操作时间止
                      <input
                        className="a-filter-input"
                        type="date"
                        value={opInputs.to}
                        onChange={(e) => setOpInputs({ ...opInputs, to: e.target.value })}
                      />
                    </label>
                    <div className="a-workbench-op-filter-actions">
                      <button type="submit" className="a-btn">搜索</button>
                      <button type="button" className="a-btn ghost" onClick={resetOpFilters}>重置</button>
                      <button
                        type="button"
                        className="a-btn ghost"
                        onClick={exportOperationLogs}
                        disabled={!filteredOperations.length}
                      >
                        导出
                      </button>
                    </div>
                  </form>

                  <div className="a-table-wrap a-workbench-ops-table">
                    <table className="a-table">
                      <thead>
                        <tr>
                          <th>用户名称</th>
                          <th>用户昵称</th>
                          <th>操作时间</th>
                          <th>操作类型</th>
                          <th>操作详情</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedOperations.items.length === 0 ? (
                          <tr><td colSpan={5} className="a-muted">暂无符合条件的操作日志</td></tr>
                        ) : pagedOperations.items.map((op) => (
                          <tr key={op.id}>
                            <td>{detail.admin.email}</td>
                            <td>{detail.admin.name}</td>
                            <td>{formatDateTime(op.occurredAt)}</td>
                            <td>{op.actionLabel}</td>
                            <td className="a-muted">{op.detail || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    page={opPagination.page}
                    pageSize={opPagination.pageSize}
                    total={filteredOperations.length}
                    onChange={setOpPagination}
                  />
                </section>

                <section className="a-workbench-detail-pane a-workbench-detail-pane--cal">
                  <div className="a-workbench-cal">
                    <div className="a-workbench-cal-head">
                      <strong>{month} 登录日历</strong>
                      <span className="a-muted">点击日期可筛选左侧操作</span>
                    </div>
                    <div className="a-workbench-cal-weekdays">
                      {['一', '二', '三', '四', '五', '六', '日'].map((d) => <span key={d}>{d}</span>)}
                    </div>
                    <div className="a-workbench-cal-grid">
                      {Array.from({ length: calendarStartPad }).map((_, i) => (
                        <span key={`pad-${i}`} className="a-workbench-cal-cell is-empty" />
                      ))}
                      {detail.calendar.map((day) => (
                        <button
                          key={day.date}
                          type="button"
                          className={`a-workbench-cal-cell is-${day.status}${selectedDay === day.date ? ' is-active' : ''}`}
                          disabled={day.status === 'future'}
                          onClick={() => {
                            const next = day.date === selectedDay ? null : day.date
                            setSelectedDay(next)
                            setOpPagination((p) => ({ ...p, page: 1 }))
                            setSessionPagination((p) => ({ ...p, page: 1 }))
                            if (next) {
                              setOpInputs((prev) => ({ ...prev, from: next, to: next }))
                              setOpFilters((prev) => ({ ...prev, from: next, to: next }))
                            }
                          }}
                          title={day.status === 'signed' ? '已签到' : day.status === 'absent' ? '未签到' : '未到'}
                        >
                          <em>{Number(day.date.slice(-2))}</em>
                          <span>
                            {day.status === 'signed' ? '✓' : day.status === 'absent' ? '未签到' : '—'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="a-workbench-detail-pane-head a-workbench-detail-pane-head--spaced">
                    <strong>当日登录会话</strong>
                    <span className="a-muted">{selectedDay ? selectedDay : '本月全部'}</span>
                  </div>
                  <div className="a-table-wrap a-workbench-sessions-table">
                    <table className="a-table">
                      <thead>
                        <tr>
                          <th>登录</th>
                          <th>退出</th>
                          <th>时长</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedSessions.items.length === 0 ? (
                          <tr><td colSpan={3} className="a-muted">暂无登录会话</td></tr>
                        ) : pagedSessions.items.map((s) => (
                          <tr key={s.id}>
                            <td>{formatDateTimeCompact(s.loginAt)}</td>
                            <td>{formatDateTimeCompact(s.logoutAt)}</td>
                            <td>{formatDurationCompact(s.durationMs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    page={sessionPagination.page}
                    pageSize={sessionPagination.pageSize}
                    total={detail.sessions.length}
                    onChange={setSessionPagination}
                    pageSizeOptions={[5, 10, 20]}
                  />
                </section>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
