import EntityPage from '../components/EntityPage';
import { PhaseStatus } from '@hospital-erp/shared';
import { enumToOptions, formatCurrency, formatDate, STATUS_COLORS } from '../utils/enumOptions';

export default function PhasesPage() {
  return (
    <EntityPage
      title="Construction Phases"
      endpoint="/phases"
      entityName="Phase"
      entityType="PHASE"
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'status', label: 'Status' },
        { key: 'plannedStart', label: 'Planned Start', render: (r) => formatDate(r.plannedStart) },
        { key: 'plannedEnd', label: 'Planned End', render: (r) => formatDate(r.plannedEnd) },
        { key: 'budgetAmount', label: 'Budget', render: (r) => formatCurrency(r.budgetAmount) },
        { key: 'progressPercent', label: 'Progress', render: (r) => `${r.progressPercent ?? 0}%` },
      ]}
      statusKey="status"
      statusColors={STATUS_COLORS}
      fields={[
        { name: 'name', label: 'Phase Name', type: 'text', required: true },
        { name: 'status', label: 'Status', type: 'select', options: enumToOptions(PhaseStatus), defaultValue: PhaseStatus.NOT_STARTED, dropdownType: 'PHASE_STATUS' },
        { name: 'plannedStart', label: 'Planned Start', type: 'date' },
        { name: 'plannedEnd', label: 'Planned End', type: 'date' },
        { name: 'budgetAmount', label: 'Budget Amount', type: 'number', defaultValue: 0 },
        { name: 'progressPercent', label: 'Progress %', type: 'number', defaultValue: 0 },
      ]}
    />
  );
}
