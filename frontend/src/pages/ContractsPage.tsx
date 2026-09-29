import EntityPage from '../components/EntityPage';
import { ContractType, ContractStatus } from '@hospital-erp/shared';
import { enumToOptions, formatCurrency, formatDate, STATUS_COLORS } from '../utils/enumOptions';

import { useTranslation } from 'react-i18next';
export default function ContractsPage() {
  const { t } = useTranslation('contracts');
  return (
    <EntityPage
      title={t('title')}
      endpoint="/contracts"
      entityName={t('entity')}
      entityType="CONTRACT"
      columns={[
        { key: 'vendor', label: t('vendor'), render: (r) => (r.vendor as any)?.name ?? '—' },
        { key: 'type', label: t('type') },
        { key: 'startDate', label: t('start'), render: (r) => formatDate(r.startDate) },
        { key: 'endDate', label: t('end'), render: (r) => formatDate(r.endDate) },
        { key: 'value', label: t('value'), render: (r) => formatCurrency(r.value) },
        { key: 'status', label: t('status') },
      ]}
      statusKey="status"
      statusColors={STATUS_COLORS}
      fields={[
        { name: 'vendorId', label: t('vendor'), type: 'select', required: true, optionsEndpoint: '/vendors' },
        { name: 'type', label: t('contractType'), type: 'select', required: true, options: enumToOptions(ContractType), defaultValue: ContractType.FIXED_PRICE, dropdownType: 'CONTRACT_TYPE' },
        { name: 'startDate', label: t('startDate'), type: 'date', required: true },
        { name: 'endDate', label: t('endDate'), type: 'date' },
        { name: 'value', label: t('contractValue'), type: 'number', required: true },
        { name: 'advancePercent', label: t('advance'), type: 'number', defaultValue: 0 },
        { name: 'retentionPercent', label: t('retention'), type: 'number', defaultValue: 0 },
        { name: 'status', label: t('status'), type: 'select', options: enumToOptions(ContractStatus), defaultValue: ContractStatus.DRAFT },
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
