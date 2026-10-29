import { DemoDirectoryPage, type DemoDirectoryField } from '../components/DemoDirectoryPage'
import { BROKERS_STORAGE_KEY, INITIAL_DEMO_BROKERS } from '../brokerDemoData'

const fields: readonly DemoDirectoryField[] = [
  { key: 'name', label: '经纪人姓名', required: true, filter: true },
  { key: 'idNumber', label: '身份证号', required: true, filter: true },
  { key: 'agency', label: '中介机构', required: true, filter: true },
  { key: 'remark', label: '备注', multiline: true },
]

export function BrokersPage() {
  return <DemoDirectoryPage title="经纪人" recordLabel="经纪人" fields={fields} initial={INITIAL_DEMO_BROKERS}
    storageKey={BROKERS_STORAGE_KEY} numberPrefix="JJ-DEMO"
    description="维护经纪人及所属中介机构，支持查询、增改删、状态切换与批量操作。" />
}
