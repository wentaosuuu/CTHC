import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPatch, apiPost, apiUploadDepartmentQr } from '../api'
import { useDemoRecords } from '../demoStorage'
import { DEPARTMENT_SUPPLEMENT_KEY, isDepartmentSupplement, systemTime, type DepartmentSupplement } from '../systemDemoData'

type Dept = {
  id: string
  name: string
  code: string
  parentId: string | null
  remark: string
  contactPhone: string | null
  wecomQrUrl: string | null
  linkedStoreId: string | null
  linkedStoreName: string | null
  createdAt?: string
}

/** 树节点（带 children） */
type DeptNode = Dept & { children: DeptNode[] }

/** 带层级的行，用于表格渲染 */
type DeptRow = { dept: Dept; depth: number; hasChildren: boolean }

type StoreOpt = { id: string; name: string }

type Me = { roleCode: string; storeIds: string[] }

type ModalState = {
  type: 'add' | 'edit'
  dept?: Dept
  form: {
    name: string
    code: string
    parentId: string
    remark: string
    contactPhone: string
    wecomQrUrl: string
    linkedStoreId: string
    sortOrder: number
    leader: string
    email: string
    status: 'normal' | 'disabled'
    createdAt: string
  }
}

function buildTree(list: Dept[], parentId: string | null): DeptNode[] {
  return list
    .filter((d) => d.parentId === parentId)
    .map((d) => ({ ...d, children: buildTree(list, d.id) }))
}

function flattenWithDepth(
  nodes: DeptNode[],
  depth: number,
  expandedIds: Set<string>,
  result: DeptRow[] = [],
): DeptRow[] {
  for (const node of nodes) {
    const hasChildren = node.children.length > 0
    result.push({
      dept: {
        id: node.id,
        name: node.name,
        code: node.code,
        parentId: node.parentId,
        remark: node.remark,
        contactPhone: node.contactPhone,
        wecomQrUrl: node.wecomQrUrl,
        linkedStoreId: node.linkedStoreId,
        linkedStoreName: node.linkedStoreName,
        createdAt: node.createdAt,
      },
      depth,
      hasChildren,
    })
    if (hasChildren && expandedIds.has(node.id)) {
      flattenWithDepth(node.children, depth + 1, expandedIds, result)
    }
  }
  return result
}

export function SystemDepartmentsPage() {
  const { records: supplements, commit: commitSupplements, storageIssue } = useDemoRecords<DepartmentSupplement>(DEPARTMENT_SUPPLEMENT_KEY, [], isDepartmentSupplement)
  const [departments, setDepartments] = useState<Dept[]>([])
  const [stores, setStores] = useState<StoreOpt[]>([])
  const [me, setMe] = useState<Me | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [message, setMessage] = useState('')
  const [filterName, setFilterName] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filters, setFilters] = useState({ name: '', status: '' })
  const [sortInputs, setSortInputs] = useState<Record<string, string>>({})

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<ModalState | null>(null)
  const qrInputRef = useRef<HTMLInputElement | null>(null)
  /** 新增部门：保存后再上传；编辑部门：也可先本地预览再点保存（或选图后立即上传） */
  const [pendingQrFile, setPendingQrFile] = useState<File | null>(null)
  const [qrPreviewUrl, setQrPreviewUrl] = useState<string | null>(null)
  const [qrUploading, setQrUploading] = useState(false)

  const isSys = me?.roleCode === 'SYSTEM_ADMIN'

  const loadAll = useCallback(async () => {
    const [dRes, sRes, mRes] = await Promise.all([
      apiGet<{ items: Dept[] }>('/api/admin/departments'),
      apiGet<{ items: StoreOpt[] }>('/api/admin/stores'),
      apiGet<Me>('/api/admin/me'),
    ])
    setLoadErr('')
    if (!dRes.ok || !sRes.ok || !mRes.ok) {
      const err = !dRes.ok ? dRes.error : !sRes.ok ? sRes.error : !mRes.ok ? mRes.error : '加载失败'
      setLoadErr(err)
      return
    }
    setDepartments(dRes.data.items)
    setStores(sRes.data.items)
    setMe(mRes.data)

    const parentsWithChildren = new Set<string>()
    for (const d of dRes.data.items) {
      if (d.parentId) parentsWithChildren.add(d.parentId)
    }
    setExpandedIds(new Set(parentsWithChildren))
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const tree = useMemo(() => {
    let visible = [...departments]
    if (filters.name.trim() || filters.status) {
      const ids = new Set(visible.filter((dept) => dept.name.includes(filters.name.trim()) &&
        (!filters.status || (supplements.find((extra) => extra.id === dept.id)?.status ?? 'normal') === filters.status)).map((dept) => dept.id))
      for (const id of [...ids]) {
        let parent = departments.find((dept) => dept.id === id)?.parentId
        const seen = new Set([id])
        while (parent && !seen.has(parent)) { seen.add(parent); ids.add(parent); parent = departments.find((dept) => dept.id === parent)?.parentId }
      }
      visible = visible.filter((dept) => ids.has(dept.id))
    }
    visible.sort((a, b) => (supplements.find((extra) => extra.id === a.id)?.sortOrder ?? 0) - (supplements.find((extra) => extra.id === b.id)?.sortOrder ?? 0))
    return buildTree(visible, null)
  }, [departments, filters, supplements])
  const rows = useMemo(
    () => flattenWithDepth(tree, 0, filters.name || filters.status ? new Set(departments.map((dept) => dept.id)) : expandedIds),
    [tree, expandedIds, filters, departments],
  )

  function supplement(id: string): DepartmentSupplement {
    return supplements.find((extra) => extra.id === id) ?? { id, sortOrder: 0, leader: '', email: '', status: 'normal', createdAt: '' }
  }

  function saveSort() {
    const changed = Object.entries(sortInputs)
    if (changed.some(([, value]) => !value.trim() || !Number.isInteger(Number(value)))) { setMessage('请填写有效的显示排序整数后再保存排序。'); return }
    const next = new Map(supplements.map((extra) => [extra.id, extra]))
    changed.forEach(([id, value]) => next.set(id, { ...supplement(id), sortOrder: Number(value) }))
    if (commitSupplements([...next.values()])) { setSortInputs({}); setMessage('排序已保存到当前浏览器，未改动后端排序。') }
  }

  const canEditDept = (d: Dept) => {
    if (isSys) return true
    return Boolean(d.linkedStoreId && me?.storeIds.includes(d.linkedStoreId))
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearQrPreview = () => {
    if (qrPreviewUrl) URL.revokeObjectURL(qrPreviewUrl)
    setQrPreviewUrl(null)
    setPendingQrFile(null)
  }

  const openAdd = () => {
    if (!isSys) return
    clearQrPreview()
    setFormError(''); setMessage('')
    setModal({
      type: 'add',
      form: {
        name: '',
        code: '',
        parentId: '',
        remark: '',
        contactPhone: '',
        wecomQrUrl: '',
        linkedStoreId: '',
        sortOrder: 0, leader: '', email: '', status: 'normal', createdAt: '',
      },
    })
  }

  const openEdit = (dept: Dept) => {
    if (!canEditDept(dept)) return
    clearQrPreview()
    setFormError(''); setMessage('')
    setModal({
      type: 'edit',
      dept,
      form: {
        name: dept.name,
        code: dept.code,
        parentId: dept.parentId ?? '',
        remark: dept.remark ?? '',
        contactPhone: dept.contactPhone ?? '',
        wecomQrUrl: dept.wecomQrUrl ?? '',
        linkedStoreId: dept.linkedStoreId ?? '',
        sortOrder: supplement(dept.id).sortOrder,
        leader: supplement(dept.id).leader,
        email: supplement(dept.id).email,
        status: supplement(dept.id).status,
        createdAt: supplement(dept.id).createdAt || dept.createdAt || '',
      },
    })
  }

  const closeModal = () => {
    clearQrPreview()
    setModal(null)
    setFormError('')
  }

  const setForm = (patch: Partial<ModalState['form']>) => {
    if (!modal) return
    setModal({ ...modal, form: { ...modal.form, ...patch } })
  }

  const saveDept = async () => {
    if (!modal) return
    if (!modal.form.name.trim()) { setFormError('请填写部门名称'); return }
    if (modal.type === 'add' && !modal.form.parentId) { setFormError('请选择上级部门'); return }
    if (!Number.isInteger(modal.form.sortOrder)) { setFormError('请填写有效的显示排序整数'); return }
    setSaving(true)
    setFormError('')
    try {
      const f = modal.form
      let savedId = modal.dept?.id ?? ''
      if (modal.type === 'add') {
        if (!isSys) return
        const r = await apiPost<{ item: Dept }>('/api/admin/departments', {
          name: f.name.trim(),
          code: f.code.trim() || `DEMO-DEPT-${crypto.randomUUID().slice(0, 8)}`,
          parentId: f.parentId ? f.parentId : null,
          remark: f.remark.trim(),
          contactPhone: f.contactPhone.trim() || null,
          wecomQrUrl: null,
          linkedStoreId: f.linkedStoreId || null,
        })
        if (!r.ok) {
          window.alert(`保存失败：${r.error}`)
          return
        }
        savedId = r.data.item.id
        if (pendingQrFile) {
          const up = await apiUploadDepartmentQr(r.data.item.id, pendingQrFile)
          if (!up.ok) {
            window.alert(`部门已创建，但二维码上传失败：${up.error}`)
          }
        }
      } else if (modal.dept) {
        const body: Record<string, unknown> = {
          remark: f.remark.trim(),
          contactPhone: f.contactPhone.trim() || null,
          wecomQrUrl: f.wecomQrUrl.trim() || null,
        }
        if (isSys) {
          body.name = f.name.trim()
          body.code = f.code.trim() || modal.dept.code
          body.parentId = f.parentId ? f.parentId : null
          body.linkedStoreId = f.linkedStoreId || null
        }
        const r = await apiPatch<{ item: Dept }>(`/api/admin/departments/${modal.dept.id}`, body)
        if (!r.ok) {
          window.alert(`保存失败：${r.error}`)
          return
        }
      }
      const savedExtra: DepartmentSupplement = { id: savedId, sortOrder: f.sortOrder, leader: f.leader.trim(), email: f.email.trim(), status: f.status,
        createdAt: modal.type === 'add' ? new Date().toISOString() : f.createdAt }
      const extrasSaved = commitSupplements([...supplements.filter((extra) => extra.id !== savedId), savedExtra])
      await loadAll()
      closeModal()
      setMessage(extrasSaved ? '部门基础资料已保存；排序、负责人、邮箱与状态仅保存在当前浏览器。' : '部门基础资料已保存，补充演示字段未能保存，请检查本机存储。')
    } catch {
      setFormError('部门保存失败，请检查本地服务后重试。')
    } finally {
      setSaving(false)
    }
  }

  const onPickQrFile = () => qrInputRef.current?.click()

  const onClearQr = () => {
    clearQrPreview()
    setForm({ wecomQrUrl: '' })
  }

  const onQrFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !modal) return

    if (modal.type === 'add') {
      clearQrPreview()
      setPendingQrFile(file)
      setQrPreviewUrl(URL.createObjectURL(file))
      return
    }

    if (!modal.dept) return
    setQrUploading(true)
    const r = await apiUploadDepartmentQr(modal.dept.id, file)
    setQrUploading(false)
    if (!r.ok) {
      window.alert(`上传失败：${r.error}`)
      return
    }
    clearQrPreview()
    setForm({ wecomQrUrl: r.data.wecomQrUrl })
    await loadAll()
  }

  const qrDisplayUrl = qrPreviewUrl || modal?.form.wecomQrUrl || ''

  const parentOptions = useMemo(() => {
    return departments.map((d) => ({ value: d.id, label: d.name }))
  }, [departments])

  if (loadErr) {
    return (
      <div className="a-col">
        <div className="a-card m-error">加载失败：{loadErr}</div>
      </div>
    )
  }

  return (
    <div className="a-col">
      <div className="a-card">
        <div className="a-h1">部门管理</div>
        <div className="a-muted">
          维护「总部 / 区域 / 门店」架构。<strong>门店级</strong>
          部门可配置「预约看房」用的<strong>门店电话</strong>与<strong>企业微信二维码</strong>；请在下方关联业务
         「门店」，以便 H5 房源详情与后台数据一致。
        </div>
        <p className="a-muted">显示排序、负责人、邮箱、正常/停用状态为本机演示补充资料，不改变真实授权；未取得的历史创建时间显示“—”。请使用虚构联系方式进行评审。</p>
      </div>
      {storageIssue ? <div className="a-card a-error" role="alert">{storageIssue}</div> : null}
      {message ? <div className="a-card a-muted" role="status">{message}</div> : null}
      <form className="a-card a-filterbar" style={{ flexWrap: 'wrap', gap: 10 }} onSubmit={(event) => { event.preventDefault(); setFilters({ name: filterName, status: filterStatus }) }}>
        <label>部门名称 <input className="a-filter-input" placeholder="请输入部门名称" value={filterName} onChange={(event) => setFilterName(event.target.value)} /></label>
        <label>状态 <select className="a-filter-select" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}><option value="">全部状态</option><option value="normal">正常</option><option value="disabled">停用</option></select></label>
        <button type="submit" className="a-btn">搜索</button><button type="button" className="a-btn ghost" onClick={() => { setFilterName(''); setFilterStatus(''); setFilters({ name: '', status: '' }) }}>重置</button>
        {filters.name || filters.status ? <span className="a-muted">匹配结果保留上级节点，便于查看层级。</span> : null}
      </form>

      <div className="a-card">
        <div className="a-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <span className="a-muted">共 {departments.length} 个部门</span>
          <div className="a-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="a-btn ghost" disabled={!Object.keys(sortInputs).length} onClick={saveSort}>保存排序</button>
            <button
              type="button"
              className="a-btn ghost"
              onClick={() => setExpandedIds(new Set(departments.filter((d) => departments.some((x) => x.parentId === d.id)).map((d) => d.id)))}
            >
              全部展开
            </button>
            <button type="button" className="a-btn ghost" onClick={() => setExpandedIds(new Set())}>
              全部折叠
            </button>
            {isSys ? (
              <button type="button" className="a-btn" onClick={openAdd}>
                新增部门
              </button>
            ) : null}
          </div>
        </div>
        <div className="a-table-wrap">
          <table className="a-table a-table-tree a-table-sticky-op">
            <thead>
              <tr>
                <th style={{ width: 240 }}>部门名称</th>
                <th style={{ width: 120 }}>排序</th>
                <th style={{ width: 72 }}>二维码</th>
                <th>状态</th>
                <th>创建时间</th>
                <th className="a-op-col">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ dept, depth, hasChildren }) => (
                <tr key={dept.id}>
                  <td>
                    <span className="a-tree-cell" style={{ paddingLeft: depth * 20 + 8 }}>
                      <span
                        className="a-tree-toggle"
                        role="button"
                        tabIndex={0}
                        onClick={() => hasChildren && toggleExpand(dept.id)}
                        onKeyDown={(e) => hasChildren && (e.key === 'Enter' || e.key === ' ') && toggleExpand(dept.id)}
                        aria-label={expandedIds.has(dept.id) ? '折叠' : '展开'}
                      >
                        {hasChildren ? (
                          <span className="a-tree-chevron" data-expanded={expandedIds.has(dept.id)}>
                            ▼
                          </span>
                        ) : (
                          <span className="a-tree-placeholder" />
                        )}
                      </span>
                      <span className="a-tree-label">{dept.name}</span>
                    </span>
                  </td>
                  <td><input type="number" step={1} className="a-filter-input" style={{ width: 90, minWidth: 0 }} aria-label={`${dept.name}显示排序`}
                    value={sortInputs[dept.id] ?? String(supplement(dept.id).sortOrder)} onChange={(event) => setSortInputs((previous) => ({ ...previous, [dept.id]: event.target.value }))} /></td>
                  <td>
                    {dept.wecomQrUrl ? (
                      <img
                        src={dept.wecomQrUrl}
                        alt=""
                        style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 6, background: '#f1f5f9' }}
                      />
                    ) : (
                      <span className="a-muted">-</span>
                    )}
                  </td>
                  <td><span className={supplement(dept.id).status === 'normal' ? 'a-badge status-approved' : 'a-badge'}>{supplement(dept.id).status === 'normal' ? '正常' : '停用'}</span></td>
                  <td className="a-muted">{systemTime(supplement(dept.id).createdAt || dept.createdAt || '')}</td>
                  <td className="a-op-cell">
                    <div className="a-op-actions">
                      {canEditDept(dept) ? (
                        <button type="button" className="a-btn ghost" onClick={() => openEdit(dept)}>
                          修改
                        </button>
                      ) : (
                        <span className="a-muted">-</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={6} className="a-muted" style={{ textAlign: 'center', padding: 32 }}>暂无符合条件的部门</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div
          className="a-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div className="a-modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
            <div className="a-modal-header">
              <div className="a-modal-title">{modal.type === 'add' ? '新增部门' : '修改部门信息'}</div>
              <button type="button" className="a-modal-close" onClick={closeModal}>
                关闭
              </button>
            </div>
            <div className="a-modal-body" style={{ display: 'block' }}>
              {formError ? <div className="a-error" role="alert" style={{ marginBottom: 12 }}>{formError}</div> : null}
              <p className="a-muted">排序、负责人、邮箱与状态仅作当前浏览器内的补充演示；二维码与原有基础信息继续使用原 DEMO 维护方式。</p>
              <input ref={qrInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={onQrFileChange} />
              <div className="a-kv">
                {isSys ? (
                  <>
                    <div className="a-kv-row">
                      <div className="a-kv-k">部门名称 *</div>
                      <div className="a-kv-v">
                        <input
                          type="text"
                          className="a-filter-input"
                          value={modal.form.name}
                          aria-label="部门名称"
                          aria-required="true"
                          onChange={(e) => setForm({ name: e.target.value })}
                          placeholder="如：总部、南宁区域"
                          style={{ width: '100%' }}
                        />
                      </div>
                    </div>
                    <div className="a-kv-row">
                      <div className="a-kv-k">编码</div>
                      <div className="a-kv-v">
                        <input
                          type="text"
                          className="a-filter-input"
                          value={modal.form.code}
                          onChange={(e) => setForm({ code: e.target.value })}
                          placeholder="唯一编码"
                          style={{ width: '100%' }}
                        />
                      </div>
                    </div>
                    <div className="a-kv-row">
                      <div className="a-kv-k">上级部门{modal.type === 'add' ? ' *' : ''}</div>
                      <div className="a-kv-v">
                        <select
                          className="a-filter-select"
                          value={modal.form.parentId}
                          aria-label="上级部门"
                          aria-required={modal.type === 'add'}
                          onChange={(e) => setForm({ parentId: e.target.value })}
                          style={{ minWidth: 200 }}
                        >
                          <option value="">{modal.type === 'add' ? '选择上级部门' : '无（作为顶级部门）'}</option>
                          {parentOptions.map((opt) => (
                            <option key={opt.value} value={opt.value} disabled={modal.dept?.id === opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                ) : modal.type === 'edit' ? (
                  <div className="a-kv-row">
                    <div className="a-kv-k">部门</div>
                    <div className="a-kv-v">
                      <span className="a-muted">
                        {modal.dept?.name}（{modal.dept?.code}）
                      </span>
                    </div>
                  </div>
                ) : null}

                <div className="a-kv-row"><label className="a-kv-k" htmlFor="dept-sort-order">显示排序 *</label><div className="a-kv-v">
                  <input id="dept-sort-order" className="a-filter-input" type="number" step={1} aria-required="true"
                    value={Number.isNaN(modal.form.sortOrder) ? '' : modal.form.sortOrder} onChange={(event) => setForm({ sortOrder: event.target.value === '' ? NaN : Number(event.target.value) })} />
                </div></div>
                <div className="a-kv-row"><label className="a-kv-k" htmlFor="dept-leader">负责人</label><div className="a-kv-v">
                  <input id="dept-leader" className="a-filter-input" value={modal.form.leader} maxLength={100} onChange={(event) => setForm({ leader: event.target.value })} />
                </div></div>
                <div className="a-kv-row"><label className="a-kv-k" htmlFor="dept-email">邮箱</label><div className="a-kv-v">
                  <input id="dept-email" className="a-filter-input" value={modal.form.email} maxLength={100} onChange={(event) => setForm({ email: event.target.value })} />
                </div></div>
                <div className="a-kv-row"><div className="a-kv-k">部门状态</div><div className="a-kv-v a-row" role="group" aria-label="部门状态">
                  {(['normal', 'disabled'] as const).map((status) => <label key={status}><input type="radio" name="dept-demo-status" checked={modal.form.status === status} onChange={() => setForm({ status })} /> {status === 'normal' ? '正常' : '停用'}</label>)}
                </div></div>
                <div className="a-kv-row">
                  <div className="a-kv-k">联系电话</div>
                  <div className="a-kv-v">
                    <input
                      type="text"
                      className="a-filter-input"
                      value={modal.form.contactPhone}
                      aria-label="联系电话"
                      onChange={(e) => setForm({ contactPhone: e.target.value })}
                      placeholder="客户拨打的预约电话"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">企业微信二维码</div>
                  <div className="a-kv-v">
                    <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="a-btn ghost"
                        onClick={onPickQrFile}
                        disabled={qrUploading}
                      >
                        {qrUploading ? '上传中…' : '选择图片上传'}
                      </button>
                      {qrDisplayUrl ? (
                        <button type="button" className="a-btn ghost" onClick={onClearQr} disabled={qrUploading}>
                          清除
                        </button>
                      ) : null}
                    </div>
                    <div className="a-muted" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.5 }}>
                      支持 PNG、JPG、WebP。
                      {modal.type === 'add'
                        ? ' 新增时先选图，保存部门后将自动上传。'
                        : ' 修改时选择图片后立即上传并更新。'}
                    </div>
                    {qrDisplayUrl ? (
                      <div style={{ marginTop: 10 }}>
                        <img
                          src={qrDisplayUrl}
                          alt="二维码预览"
                          style={{ width: 120, height: 120, objectFit: 'contain', borderRadius: 8, background: '#f1f5f9' }}
                        />
                      </div>
                    ) : (
                      <div
                        className="a-muted"
                        style={{
                          marginTop: 10,
                          padding: '20px 16px',
                          border: '1px dashed #cbd5e1',
                          borderRadius: 8,
                          textAlign: 'center',
                          fontSize: 12,
                        }}
                      >
                        尚未上传二维码
                      </div>
                    )}
                  </div>
                </div>

                {isSys ? (
                  <div className="a-kv-row">
                    <div className="a-kv-k">关联门店</div>
                    <div className="a-kv-v">
                      <select
                        className="a-filter-select"
                        value={modal.form.linkedStoreId}
                        onChange={(e) => setForm({ linkedStoreId: e.target.value })}
                        style={{ minWidth: 260 }}
                      >
                        <option value="">不关联</option>
                        {stores.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : null}

                <div className="a-kv-row">
                  <div className="a-kv-k">备注</div>
                  <div className="a-kv-v">
                    <input
                      type="text"
                      className="a-filter-input"
                      value={modal.form.remark}
                      onChange={(e) => setForm({ remark: e.target.value })}
                      placeholder="选填"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              </div>
              <div className="a-row" style={{ marginTop: 14, gap: 10 }}>
                <button type="button" className="a-btn" onClick={() => void saveDept()} disabled={saving}>
                  {saving ? '保存中…' : modal.type === 'add' ? '确定新增' : '保存'}
                </button>
                <button type="button" className="a-btn ghost" onClick={closeModal}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
