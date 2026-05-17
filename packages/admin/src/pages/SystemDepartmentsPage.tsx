import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPatch, apiPost, apiUploadDepartmentQr } from '../api'

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
  const [departments, setDepartments] = useState<Dept[]>([])
  const [stores, setStores] = useState<StoreOpt[]>([])
  const [me, setMe] = useState<Me | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [saving, setSaving] = useState(false)

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<ModalState | null>(null)
  const qrInputRef = useRef<HTMLInputElement | null>(null)

  const isSys = me?.roleCode === 'SYSTEM_ADMIN'

  const loadAll = useCallback(async () => {
    setLoadErr('')
    const [dRes, sRes, mRes] = await Promise.all([
      apiGet<{ items: Dept[] }>('/api/admin/departments'),
      apiGet<{ items: StoreOpt[] }>('/api/admin/stores'),
      apiGet<Me>('/api/admin/me'),
    ])
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

  const tree = useMemo(() => buildTree(departments, null), [departments])
  const rows = useMemo(
    () => flattenWithDepth(tree, 0, expandedIds),
    [tree, expandedIds],
  )

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

  const openAdd = () => {
    if (!isSys) return
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
      },
    })
  }

  const openEdit = (dept: Dept) => {
    if (!canEditDept(dept)) return
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
      },
    })
  }

  const closeModal = () => setModal(null)

  const setForm = (patch: Partial<ModalState['form']>) => {
    if (!modal) return
    setModal({ ...modal, form: { ...modal.form, ...patch } })
  }

  const saveDept = async () => {
    if (!modal) return
    setSaving(true)
    try {
      const f = modal.form
      if (modal.type === 'add') {
        if (!isSys) return
        const r = await apiPost<{ item: Dept }>('/api/admin/departments', {
          name: f.name.trim(),
          code: f.code.trim(),
          parentId: f.parentId ? f.parentId : null,
          remark: f.remark.trim(),
          contactPhone: f.contactPhone.trim() || null,
          wecomQrUrl: f.wecomQrUrl.trim() || null,
          linkedStoreId: f.linkedStoreId || null,
        })
        if (!r.ok) {
          window.alert(`保存失败：${r.error}`)
          return
        }
      } else if (modal.dept) {
        const body: Record<string, unknown> = {
          remark: f.remark.trim(),
          contactPhone: f.contactPhone.trim() || null,
          wecomQrUrl: f.wecomQrUrl.trim() || null,
        }
        if (isSys) {
          body.name = f.name.trim()
          body.code = f.code.trim()
          body.parentId = f.parentId ? f.parentId : null
          body.linkedStoreId = f.linkedStoreId || null
        }
        const r = await apiPatch<{ item: Dept }>(`/api/admin/departments/${modal.dept.id}`, body)
        if (!r.ok) {
          window.alert(`保存失败：${r.error}`)
          return
        }
      }
      await loadAll()
      closeModal()
    } finally {
      setSaving(false)
    }
  }

  const onPickQrFile = () => qrInputRef.current?.click()

  const onQrFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !modal?.dept) return
    const r = await apiUploadDepartmentQr(modal.dept.id, file)
    if (!r.ok) {
      window.alert(`上传失败：${r.error}`)
      return
    }
    setForm({ wecomQrUrl: r.data.wecomQrUrl })
    await loadAll()
  }

  const parentOptions = useMemo(() => {
    return departments.map((d) => ({ value: d.id, label: d.name }))
  }, [departments])

  const getParentName = (parentId: string | null) => {
    if (!parentId) return '-'
    return departments.find((d) => d.id === parentId)?.name ?? parentId
  }

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
      </div>

      <div className="a-card">
        <div className="a-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <span className="a-muted">共 {departments.length} 个部门</span>
          <div className="a-row" style={{ gap: 8, flexWrap: 'wrap' }}>
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
                <th style={{ width: 88 }}>编码</th>
                <th style={{ width: 100 }}>上级部门</th>
                <th style={{ width: 120 }}>预约电话</th>
                <th style={{ width: 72 }}>二维码</th>
                <th>备注</th>
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
                  <td>{dept.code}</td>
                  <td className="a-muted">{getParentName(dept.parentId)}</td>
                  <td className="a-muted">{dept.contactPhone?.trim() || '-'}</td>
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
                  <td className="a-muted">{dept.remark || '-'}</td>
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
              <input ref={qrInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={onQrFileChange} />
              <div className="a-kv">
                {isSys ? (
                  <>
                    <div className="a-kv-row">
                      <div className="a-kv-k">部门名称</div>
                      <div className="a-kv-v">
                        <input
                          type="text"
                          className="a-filter-input"
                          value={modal.form.name}
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
                      <div className="a-kv-k">上级部门</div>
                      <div className="a-kv-v">
                        <select
                          className="a-filter-select"
                          value={modal.form.parentId}
                          onChange={(e) => setForm({ parentId: e.target.value })}
                          style={{ minWidth: 200 }}
                        >
                          <option value="">无（作为顶级部门）</option>
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

                <div className="a-kv-row">
                  <div className="a-kv-k">门店电话</div>
                  <div className="a-kv-v">
                    <input
                      type="text"
                      className="a-filter-input"
                      value={modal.form.contactPhone}
                      onChange={(e) => setForm({ contactPhone: e.target.value })}
                      placeholder="客户拨打的预约电话"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                <div className="a-kv-row">
                  <div className="a-kv-k">二维码</div>
                  <div className="a-kv-v">
                    <div className="a-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input
                        type="text"
                        className="a-filter-input"
                        value={modal.form.wecomQrUrl}
                        onChange={(e) => setForm({ wecomQrUrl: e.target.value })}
                        placeholder="图片 URL，或上传自动生成 /api/public/... 链接"
                        style={{ flex: 1, minWidth: 200 }}
                      />
                      {modal.type === 'edit' ? (
                        <button type="button" className="a-btn ghost" onClick={onPickQrFile}>
                          上传图片
                        </button>
                      ) : null}
                    </div>
                    {modal.form.wecomQrUrl ? (
                      <div style={{ marginTop: 8 }}>
                        <img
                          src={modal.form.wecomQrUrl}
                          alt="预览"
                          style={{ width: 120, height: 120, objectFit: 'contain', borderRadius: 8, background: '#f1f5f9' }}
                        />
                      </div>
                    ) : null}
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
