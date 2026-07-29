import { CONTRACT_TEMPLATES, type ContractTemplateKind } from '../contractTemplate'

type Props = {
  value: ContractTemplateKind
  onChange: (next: ContractTemplateKind) => void
  className?: string
  disabled?: boolean
}

export function ContractTemplateSelect({
  value,
  onChange,
  className = 'a-filter-select',
  disabled,
}: Props) {
  return (
    <select
      className={className}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ContractTemplateKind)}
    >
      {CONTRACT_TEMPLATES.map((t) => (
        <option key={t.value} value={t.value}>
          {t.label}
        </option>
      ))}
    </select>
  )
}
