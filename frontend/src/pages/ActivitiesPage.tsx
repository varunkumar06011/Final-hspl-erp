import EntityPage from '../components/EntityPage';
import { ActivityStatus } from '@hospital-erp/shared';
import { enumToOptions, formatCurrency, formatDate, STATUS_COLORS } from '../utils/enumOptions';

export default function ActivitiesPage() {
  return (
    <EntityPage
      title="Activities"
      endpoint="/activities"
      entityName="Activity"
      entityType="ACTIVITY"
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'phase', label: 'Phase', render: (r) => (r.phase as any)?.name ?? '—' },
        { key: 'status', label: 'Status' },
        { key: 'plannedStart', label: 'Planned Start', render: (r) => formatDate(r.plannedStart) },
        { key: 'plannedEnd', label: 'Planned End', render: (r) => formatDate(r.plannedEnd) },
        { key: 'budgetAmount', label: 'Budget', render: (r) => formatCurrency(r.budgetAmount) },
        { key: 'progressPercent', label: 'Progress', render: (r) => `${r.progressPercent ?? 0}%` },
      ]}
      statusKey="status"
      statusColors={STATUS_COLORS}
      fields={[
        { name: 'phaseId', label: 'Phase', type: 'select', required: true, optionsEndpoint: '/phases' },
        { name: 'name', label: 'Activity Name', type: 'text', required: true },
        { name: 'status', label: 'Status', type: 'select', options: enumToOptions(ActivityStatus), defaultValue: ActivityStatus.NOT_STARTED, dropdownType: 'ACTIVITY_STATUS' },
        { name: 'plannedStart', label: 'Planned Start', type: 'date' },
        { name: 'plannedEnd', label: 'Planned End', type: 'date' },
        { name: 'assignedVendorId', label: 'Assigned Vendor', type: 'select', optionsEndpoint: '/vendors' },
        { name: 'budgetAmount', label: 'Budget Amount', type: 'number', defaultValue: 0 },
        { name: 'progressPercent', label: 'Progress %', type: 'number', defaultValue: 0 },
      ]}
      buildPayload={(form) => ({
        phaseId: form.phaseId,
        name: form.name,
        status: form.status,
        plannedStart: form.plannedStart || undefined,
        plannedEnd: form.plannedEnd || undefined,
        assignedVendorId: form.assignedVendorId || undefined,
        budgetAmount: Number(form.budgetAmount ?? 0),
        progressPercent: Number(form.progressPercent ?? 0),
      })}
    />
  );
}
