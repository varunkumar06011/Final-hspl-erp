import EntityPage from '../components/EntityPage';
import { ContractType, ContractStatus } from '@hospital-erp/shared';
import { enumToOptions, formatCurrency, formatDate, STATUS_COLORS } from '../utils/enumOptions';

export default function ContractsPage() {
  return (
    <EntityPage
      title="Contracts & Work Orders"
      endpoint="/contracts"
      entityName="Contract"
      entityType="CONTRACT"
      columns={[
        { key: 'vendor', label: 'Vendor', render: (r) => (r.vendor as any)?.name ?? '—' },
        { key: 'type', label: 'Type' },
        { key: 'startDate', label: 'Start', render: (r) => formatDate(r.startDate) },
        { key: 'endDate', label: 'End', render: (r) => formatDate(r.endDate) },
        { key: 'value', label: 'Value', render: (r) => formatCurrency(r.value) },
        { key: 'status', label: 'Status' },
      ]}
      statusKey="status"
      statusColors={STATUS_COLORS}
      fields={[
        { name: 'vendorId', label: 'Vendor', type: 'select', required: true, optionsEndpoint: '/vendors' },
        { name: 'type', label: 'Contract Type', type: 'select', required: true, options: enumToOptions(ContractType), defaultValue: ContractType.FIXED_PRICE, dropdownType: 'CONTRACT_TYPE' },
        { name: 'startDate', label: 'Start Date', type: 'date', required: true },
        { name: 'endDate', label: 'End Date', type: 'date' },
        { name: 'value', label: 'Contract Value', type: 'number', required: true },
        { name: 'advancePercent', label: 'Advance %', type: 'number', defaultValue: 0 },
        { name: 'retentionPercent', label: 'Retention %', type: 'number', defaultValue: 0 },
        { name: 'status', label: 'Status', type: 'select', options: enumToOptions(ContractStatus), defaultValue: ContractStatus.DRAFT },
      ]}
      buildPayload={(form) => ({
        vendorId: form.vendorId,
        type: form.type,
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        value: Number(form.value ?? 0),
        advancePercent: Number(form.advancePercent ?? 0),
        retentionPercent: Number(form.retentionPercent ?? 0),
        status: form.status,
      })}
    />
  );
}
