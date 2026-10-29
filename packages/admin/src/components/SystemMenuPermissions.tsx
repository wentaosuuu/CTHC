import { useState } from 'react'
import { ADMIN_NAVIGATION } from '../adminNavigation'

const allIds = ADMIN_NAVIGATION.flatMap((entry) => 'children' in entry ? [entry.id, ...entry.children.map((child) => child.id)] : [entry.id])

export function SystemMenuPermissions({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [expanded, setExpanded] = useState(true)
  const [linked, setLinked] = useState(true)
  const selected = new Set(value)
  const allSelected = allIds.every((id) => selected.has(id))
  const toggle = (id: string, checked: boolean, children: readonly { id: string }[] = []) => {
    const next = new Set(value)
    if (checked) next.add(id); else next.delete(id)
    if (linked) {
      children.forEach((child) => { if (checked) next.add(child.id); else next.delete(child.id) })
      for (const entry of ADMIN_NAVIGATION) {
        if ('children' in entry && entry.children.some((child) => child.id === id)) {
          if (entry.children.every((child) => next.has(child.id))) next.add(entry.id)
          else next.delete(entry.id)
        }
      }
    }
    onChange([...next])
  }
  return <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}><legend>菜单权限</legend>
    <p className="a-muted">仅保存菜单勾选演示，不改变真实登录权限或侧栏。已排除红框配置菜单。</p>
    <div className="a-row" style={{ flexWrap: 'wrap', gap: 14, marginBottom: 10 }}>
      <label><input type="checkbox" checked={expanded} onChange={(event) => setExpanded(event.target.checked)} /> 展开/折叠</label>
      <label><input type="checkbox" checked={allSelected} onChange={(event) => onChange(event.target.checked ? [...allIds] : [])} /> 全选/全不选</label>
      <label><input type="checkbox" checked={linked} onChange={(event) => setLinked(event.target.checked)} /> 父子联动</label>
    </div><div style={{ maxHeight: 320, overflow: 'auto', display: 'grid', gap: 8 }}>
      {ADMIN_NAVIGATION.map((entry) => <div key={entry.id}><label><input type="checkbox" checked={selected.has(entry.id)}
        ref={(element) => { if (element) element.indeterminate = 'children' in entry && !selected.has(entry.id) && entry.children.some((child) => selected.has(child.id)) }}
        onChange={(event) => toggle(entry.id, event.target.checked, 'children' in entry ? entry.children : [])} /> {entry.label}</label>
        {'children' in entry && expanded ? <div style={{ paddingLeft: 22, display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
          {entry.children.map((child) => <label key={child.id}><input type="checkbox" checked={selected.has(child.id)}
            onChange={(event) => toggle(child.id, event.target.checked)} /> {child.label}</label>)}</div> : null}
      </div>)}
    </div></fieldset>
}
