import { useState } from 'react'

/** 每个功能使用独立且带版本号的键，只持久化虚构的本地演示记录。 */
export function useDemoRecords<T>(key: string, initial: T[], isRecord: (value: unknown) => value is T) {
  const [state, setState] = useState<{ records: T[]; issue: string }>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return { records: initial, issue: '' }
      const stored: unknown = JSON.parse(raw)
      if (typeof stored !== 'object' || !stored || !('version' in stored) || stored.version !== 1 ||
          !('records' in stored) || !Array.isArray(stored.records) || !stored.records.every(isRecord)) {
        return { records: initial, issue: '本地演示记录格式不兼容，当前展示初始演示数据。' }
      }
      return { records: stored.records, issue: '' }
    } catch {
      return { records: initial, issue: '无法读取本地演示记录，当前展示初始演示数据。' }
    }
  })
  const commit = (records: T[]): boolean => {
    try {
      localStorage.setItem(key, JSON.stringify({ version: 1, records }))
      setState({ records, issue: '' })
      return true
    } catch {
      setState((previous) => ({ ...previous, issue: '本地存储不可用，修改尚未保存。请检查浏览器存储设置后重试。' }))
      return false
    }
  }
  return { records: state.records, storageIssue: state.issue, commit }
}
