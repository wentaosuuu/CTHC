import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiPost } from '../api'
import { setAdminToken } from '../auth'

export function LoginPage() {
  const nav = useNavigate()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')

  async function login() {
    setError('')
    // 对你来说，后台账号就是 admin / admin
    if (username !== 'admin' || password !== 'admin') {
      setError('账号或密码错误，只支持 admin / admin')
      return
    }

    // 内部实际还是用种子数据里的管理员账号去获取 JWT
    const r = await apiPost<{ token: string; admin: { name: string; roleCode: string } }>(
      '/api/admin/login',
      { email: 'admin@example.com', password: 'admin123' },
      { headers: {} },
    )
    if (!r.ok) return setError(r.error || '登录失败')
    setAdminToken(r.data.token)
    nav('/', { replace: true })
  }

  return (
    <div className="a-login-page">
      <div className="a-login-center">
        <div className="a-login-card compact">
          <div className="a-login-brand-row">
            <div className="a-login-logo" />
            <div>
              <div className="a-login-title">公寓租赁管理后台</div>
              <div className="a-login-subtitle">演示环境 · 统一后台</div>
            </div>
          </div>

          <div className="a-login-hint">
            管理员账号：<strong>admin</strong> / <strong>admin</strong>
          </div>

          <div className="a-login-field">
            <div className="a-login-label">账号</div>
            <input
              className="a-login-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入账号"
              autoComplete="username"
            />
          </div>

          <div className="a-login-field">
            <div className="a-login-label">密码</div>
            <div className="a-login-password">
              <input
                className="a-login-input a-login-password-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') login()
                }}
              />
              <button
                type="button"
                className="a-login-eye"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                    <path d="M4 4l16 16" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error ? <div className="a-login-error">登录失败：{error}</div> : null}

          <div className="a-login-actions">
            <button className="a-login-btn" onClick={login}>
              登录
            </button>
          </div>
        </div>
      </div>

      <div className="a-login-bottom">
        © {new Date().getFullYear()} Apartment Leasing · Demo / 本地开发环境
      </div>
    </div>
  )
}

