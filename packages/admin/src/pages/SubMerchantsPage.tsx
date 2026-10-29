import { DemoDirectoryPage, type DemoDirectoryField } from '../components/DemoDirectoryPage'
import { INITIAL_DEMO_SUB_MERCHANTS, SUB_MERCHANTS_STORAGE_KEY } from '../subMerchantDemoData'

const fields: readonly DemoDirectoryField[] = [
  { key: 'name', label: '子商户名称', required: true, filter: true },
  { key: 'wechatMerchantNo', label: '微信子商户号', required: true, unique: true },
  { key: 'appId', label: '子商户AppID' },
  { key: 'remark', label: '备注', multiline: true },
]

export function SubMerchantsPage() {
  return <DemoDirectoryPage title="子商户列表" recordLabel="子商户" fields={fields} initial={INITIAL_DEMO_SUB_MERCHANTS}
    storageKey={SUB_MERCHANTS_STORAGE_KEY} numberPrefix="SH-DEMO" enabledLabel="正常" showCreatedAt
    description="维护微信子商户配置。微信子商户号不可重复，AppID 可选填；停用子商户不可用于支付。本页仅演示配置与状态，不连接支付服务。" />
}
