import { useState } from 'react'
import { getTenantPhone, setTenantPhone } from '../api'

type ProfileForm = {
  name: string
  phone: string
  idCardNo: string
}

const PROFILE_KEY = 'meProfile'

function readProfile(): ProfileForm {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<ProfileForm>) : {}
    const savedPhone = getTenantPhone()
    return {
      name: parsed.name ?? '',
      phone: parsed.phone ?? savedPhone,
      idCardNo: parsed.idCardNo ?? '',
    }
  } catch {
    return {
      name: '',
      phone: getTenantPhone(),
      idCardNo: '',
    }
  }
}

export function ProfilePage() {
  const [profile, setProfile] = useState<ProfileForm>(() => readProfile())
  const [savedMsg, setSavedMsg] = useState('')

  function updateProfile<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }))
  }

  function saveProfile() {
    if (!profile.name.trim()) {
      setSavedMsg('请先填写姓名')
      return
    }
    if (!profile.phone.trim()) {
      setSavedMsg('请先填写手机号')
      return
    }

    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
    setTenantPhone(profile.phone.trim())
    setSavedMsg('资料已保存')
  }

  return (
    <div className="m-col">
      <div className="m-card">
        <div className="m-h1">个人信息维护</div>
        <div className="m-muted" style={{ marginTop: 4 }}>
          保存后会用于下单、签约、账单通知等流程
        </div>
        <div className="m-col" style={{ marginTop: 12, gap: 10 }}>
          <input
            className="m-input"
            placeholder="姓名（必填）"
            value={profile.name}
            onChange={(e) => updateProfile('name', e.target.value)}
          />
          <input
            className="m-input"
            placeholder="手机号（必填）"
            value={profile.phone}
            onChange={(e) => updateProfile('phone', e.target.value)}
          />
          <input
            className="m-input"
            placeholder="身份证号（建议填写）"
            value={profile.idCardNo}
            onChange={(e) => updateProfile('idCardNo', e.target.value)}
          />
        </div>
        <div className="m-row" style={{ marginTop: 12 }}>
          <button type="button" className="m-btn" onClick={saveProfile}>
            保存资料
          </button>
          {savedMsg ? <div className="m-muted">{savedMsg}</div> : null}
        </div>
      </div>
    </div>
  )
}
