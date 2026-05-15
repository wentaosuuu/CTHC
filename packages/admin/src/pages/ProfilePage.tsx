import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '../api'

type Me = {
  id: string
  name: string
  email: string
  roleCode: string
  storeIds: string[]
}

type StoreItem = { id: string; name: string }

export function ProfilePage() {
  const [me, setMe] = useState<Me | null>(null)
  const [stores, setStores] = useState<StoreItem[]>([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      setError('')
      const [rMe, rStores] = await Promise.all([
        apiGet<Me>('/api/admin/me'),
        apiGet<{ items: StoreItem[] }>('/api/admin/stores'),
      ])
      if (!alive) return
      if (!rMe.ok) return setError(rMe.error)
      if (!rStores.ok) return setError(rStores.error)
      setMe(rMe.data)
      setStores(rStores.data.items)
    })()
    return () => {
      alive = false
    }
  }, [])

  const storeNameMap = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores])
  const storeNames = useMemo(() => {
    if (!me) return []
    return me.storeIds.map((id) => storeNameMap.get(id) ?? id)
  }, [me, storeNameMap])

  async function changePassword() {
    setError('')
    setMsg('')
    if (!oldPassword.trim()) return setError('请输入旧密码')
    if (newPassword.length < 6) return setError('新密码至少 6 位')
    if (newPassword !== newPassword2) return setError('两次输入的新密码不一致')

    const r = await apiPost<{ ok: true }>('/api/admin/me/change-password', { oldPassword, newPassword })
    if (!r.ok) {
      if (r.error === 'OLD_PASSWORD_INCORRECT') return setError('旧密码不正确')
      return setError(r.error)
    }
    setMsg('密码已修改')
    setOldPassword('')
    setNewPassword('')
    setNewPassword2('')
  }

  return (
    <div className="a-col">
      {error ? <div className="a-card a-error">操作失败：{error}</div> : null}
      {msg ? <div className="a-card a-success">{msg}</div> : null}

      <div className="a-card">
        <div className="a-h2" style={{ margin: 0 }}>个人中心</div>
        <div className="a-muted" style={{ marginTop: 6, fontSize: 12 }}>查看个人信息并修改密码。</div>
      </div>

      <div className="a-card">
        {!me ? (
          <div className="a-muted">加载中…</div>
        ) : (
          <div className="a-kv">
            <div className="a-kv-row">
              <div className="a-kv-k">姓名</div>
              <div className="a-kv-v">{me.name}</div>
            </div>
            <div className="a-kv-row">
              <div className="a-kv-k">账号</div>
              <div className="a-kv-v">{me.email}</div>
            </div>
            <div className="a-kv-row">
              <div className="a-kv-k">角色</div>
              <div className="a-kv-v">{me.roleCode}</div>
            </div>
            <div className="a-kv-row">
              <div className="a-kv-k">门店权限</div>
              <div className="a-kv-v">{storeNames.length ? storeNames.join('，') : '—'}</div>
            </div>
          </div>
        )}
      </div>

      <div className="a-card">
        <div className="a-h2" style={{ margin: 0, fontSize: 14 }}>修改密码</div>
        <div style={{ height: 10 }} />
        <div className="a-kv">
          <div className="a-kv-row">
            <div className="a-kv-k">旧密码</div>
            <div className="a-kv-v">
              <input
                type="password"
                className="a-filter-input"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="请输入旧密码"
                style={{ width: 260 }}
              />
            </div>
          </div>
          <div className="a-kv-row">
            <div className="a-kv-k">新密码</div>
            <div className="a-kv-v">
              <input
                type="password"
                className="a-filter-input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 6 位"
                style={{ width: 260 }}
              />
            </div>
          </div>
          <div className="a-kv-row">
            <div className="a-kv-k">确认新密码</div>
            <div className="a-kv-v">
              <input
                type="password"
                className="a-filter-input"
                value={newPassword2}
                onChange={(e) => setNewPassword2(e.target.value)}
                placeholder="再次输入新密码"
                style={{ width: 260 }}
              />
            </div>
          </div>
        </div>
        <div className="a-row" style={{ marginTop: 12, gap: 10 }}>
          <button type="button" className="a-btn" onClick={changePassword}>
            保存新密码
          </button>
        </div>
      </div>
    </div>
  )
}

