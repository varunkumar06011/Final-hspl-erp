import EntityPage from '../components/EntityPage';
import { InspectionStatus } from '@hospital-erp/shared';
import { enumToOptions, formatDate, STATUS_COLORS } from '../utils/enumOptions';

export default function InspectionsPage() {
  return (
    <EntityPage
      title="Quality & Inspection"
      endpoint="/inspections"
      entityName="Inspection"
      entityType="INSPECTION"
      columns={[
        { key: 'phase', label: 'Phase', render: (r) => (r.phase as any)?.name ?? '—' },
        { key: 'scheduledDate', label: 'Scheduled', render: (r) => formatDate(r.scheduledDate) },
        { key: 'status', label: 'Status' },
        { key: 'completedDate', label: 'Completed', render: (r) => formatDate(r.completedDate) },
      ]}
      statusKey="status"
      statusColors={STATUS_COLORS}
      fields={[
        { name: 'phaseId', label: 'Phase (optional)', type: 'select', optionsEndpoint: '/phases' },
        { name: 'activityId', label: 'Activity (optional)', type: 'select', optionsEndpoint: '/activities' },
        { name: 'scheduledDate', label: 'Scheduled Date', type: 'date' },
        { name: 'status', label: 'Status', type: 'select', options: enumToOptions(InspectionStatus), defaultValue: InspectionStatus.SCHEDULED, dropdownType: 'INSPECTION_STATUS' },
        { name: 'correctiveAction', label: 'Corrective Action', type: 'textarea' },
      ]}
      buildPayload={(form) => ({
        phaseId: form.phaseId || undefined,
        activityId: form.activityId || undefined,
        scheduledDate: form.scheduledDate || undefined,
        status: form.status,
        correctiveAction: form.correctiveAction || undefined,
      })}
    />
  );
}
