import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

type VerifyStatus = 'UNVERIFIED' | 'VERIFYING' | 'VERIFIED' | 'REJECTED'

type VerifyResult = {
  status: VerifyStatus
  realName: string
  idCardNo: string
  submittedAt: string
  finishedAt?: string
  rejectReason?: string
}

const VERIFY_KEY = 'realNameVerifyResult'
const PROFILE_KEY = 'meProfile'

function maskIdCard(idCardNo: string) {
  if (idCardNo.length < 8) return idCardNo
  return `${idCardNo.slice(0, 4)}**********${idCardNo.slice(-4)}`
}

function isValidName(name: string) {
  return name.trim().length >= 2
}

function isValidIdCard(id: string) {
  return /^[0-9]{17}[0-9Xx]$/.test(id.trim())
}

function readStoredResult(): VerifyResult | null {
  try {
    const raw = localStorage.getItem(VERIFY_KEY)
    if (!raw) return null
    return JSON.parse(raw) as VerifyResult
  } catch {
    return null
  }
}

function readProfileDefault() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    const parsed = raw ? (JSON.parse(raw) as { name?: string; idCardNo?: string }) : {}
    return { name: parsed.name ?? '', idCardNo: parsed.idCardNo ?? '' }
  } catch {
    return { name: '', idCardNo: '' }
  }
}

export function RealNameVerifyPage() {
  const defaults = useMemo(() => readProfileDefault(), [])
  const [agreed, setAgreed] = useState(false)
  const [name, setName] = useState(defaults.name)
  const [idCardNo, setIdCardNo] = useState(defaults.idCardNo)
  const [frontFileName, setFrontFileName] = useState('')
  const [backFileName, setBackFileName] = useState('')
  const [faceFileName, setFaceFileName] = useState('')
  const [result, setResult] = useState<VerifyResult | null>(() => readStoredResult())
  const [msg, setMsg] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function saveResult(next: VerifyResult) {
    localStorage.setItem(VERIFY_KEY, JSON.stringify(next))
    setResult(next)
  }

  async function submitVerify() {
    setMsg('')
    if (!agreed) {
      setMsg('请先勾选同意实名认证授权')
      return
    }
    if (!isValidName(name)) {
      setMsg('姓名至少 2 个字')
      return
    }
    if (!isValidIdCard(idCardNo)) {
      setMsg('身份证号格式不正确，请输入 18 位')
      return
    }
    if (!frontFileName || !backFileName || !faceFileName) {
      setMsg('请上传身份证正面、反面和本人手持证件照')
      return
    }

    const submittingResult: VerifyResult = {
      status: 'VERIFYING',
      realName: name.trim(),
      idCardNo: idCardNo.trim().toUpperCase(),
      submittedAt: new Date().toISOString(),
    }
    saveResult(submittingResult)
    setSubmitting(true)

    // Demo 流程：模拟 OCR + 人脸比对 + 风控审核
    await new Promise((resolve) => {
      window.setTimeout(resolve, 1200)
    })

    const success = !idCardNo.endsWith('0000')
    if (success) {
      const passed: VerifyResult = {
        ...submittingResult,
        status: 'VERIFIED',
        finishedAt: new Date().toISOString(),
      }
      saveResult(passed)
      setMsg('实名认证通过，后续签约与支付可直接复用实名信息')
    } else {
      const rejected: VerifyResult = {
        ...submittingResult,
        status: 'REJECTED',
        finishedAt: new Date().toISOString(),
        rejectReason: '证件信息识别失败，请重新拍摄后提交',
      }
      saveResult(rejected)
      setMsg(rejected.rejectReason ?? '认证失败，请稍后重试')
    }
    setSubmitting(false)
  }

  return (
    <div className="m-col">
      <div className="m-card">
        <div className="m-h1">实名认证流程</div>
        <div className="m-muted" style={{ marginTop: 6 }}>
          共 3 步：填写信息 → 上传材料 → 提交审核（约 1 分钟内完成）
        </div>
      </div>

      <div className="m-card">
        <div style={{ fontWeight: 900 }}>当前状态</div>
        <div style={{ marginTop: 8, fontWeight: 700 }}>
          {result?.status === 'VERIFIED'
            ? '已实名'
            : result?.status === 'VERIFYING'
              ? '认证审核中'
              : result?.status === 'REJECTED'
                ? '认证未通过'
                : '未认证'}
        </div>
        {result ? (
          <div className="m-muted" style={{ marginTop: 6 }}>
            姓名：{result.realName}；身份证：{maskIdCard(result.idCardNo)}
          </div>
        ) : null}
        {result?.rejectReason ? <div className="m-error" style={{ marginTop: 8 }}>{result.rejectReason}</div> : null}
      </div>

      <div className="m-card">
        <div style={{ fontWeight: 900 }}>1）填写实名信息</div>
        <div className="m-col" style={{ marginTop: 12, gap: 10 }}>
          <input className="m-input" placeholder="真实姓名" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className="m-input"
            placeholder="身份证号（18位）"
            value={idCardNo}
            onChange={(e) => setIdCardNo(e.target.value)}
          />
        </div>
      </div>

      <div className="m-card">
        <div style={{ fontWeight: 900 }}>2）上传认证材料</div>
        <div className="m-muted" style={{ marginTop: 4 }}>
          仅校验是否已选择文件，不会上传到后端
        </div>
        <div className="m-col" style={{ marginTop: 12, gap: 8 }}>
          <label className="m-upload-field">
            <span>身份证正面</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFrontFileName(e.target.files?.[0]?.name ?? '')}
            />
          </label>
          <label className="m-upload-field">
            <span>身份证反面</span>
            <input type="file" accept="image/*" onChange={(e) => setBackFileName(e.target.files?.[0]?.name ?? '')} />
          </label>
          <label className="m-upload-field">
            <span>本人手持证件照</span>
            <input type="file" accept="image/*" onChange={(e) => setFaceFileName(e.target.files?.[0]?.name ?? '')} />
          </label>
        </div>
      </div>

      <div className="m-card">
        <div style={{ fontWeight: 900 }}>3）提交审核</div>
        <label className="m-verify-agree">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>我已阅读并同意实名认证授权，用于签约、付款和安全校验</span>
        </label>
        <div className="m-row" style={{ marginTop: 12 }}>
          <button type="button" className="m-btn" onClick={submitVerify} disabled={submitting}>
            {submitting ? '审核中...' : '提交实名认证'}
          </button>
          <Link className="m-btn ghost" to="/me">
            返回我的
          </Link>
        </div>
        {msg ? <div className="m-muted" style={{ marginTop: 8 }}>{msg}</div> : null}
      </div>
    </div>
  )
}
