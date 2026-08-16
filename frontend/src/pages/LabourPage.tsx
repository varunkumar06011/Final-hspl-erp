import EntityPage from '../components/EntityPage';
import { LabourCategory } from '@hospital-erp/shared';
import { enumToOptions, formatCurrency, formatDate } from '../utils/enumOptions';

export default function LabourPage() {
  return (
    <EntityPage
      title="Labour & Workforce"
      endpoint="/labour"
      entityName="Labour Attendance"
      entityType="LABOUR_ATTENDANCE"
      columns={[
        { key: 'date', label: 'Date', render: (r) => formatDate(r.date) },
        { key: 'category', label: 'Category' },
        { key: 'headcount', label: 'Headcount' },
        { key: 'cost', label: 'Cost', render: (r) => formatCurrency(r.cost) },
        { key: 'phase', label: 'Phase', render: (r) => (r.phase as any)?.name ?? '—' },
      ]}
      fields={[
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'category', label: 'Category', type: 'select', required: true, options: enumToOptions(LabourCategory), defaultValue: LabourCategory.UNSKILLED, dropdownType: 'LABOUR_CATEGORY' },
        { name: 'headcount', label: 'Headcount', type: 'number', required: true, defaultValue: 1 },
        { name: 'cost', label: 'Cost', type: 'number', required: true, defaultValue: 0 },
        { name: 'phaseId', label: 'Phase (optional)', type: 'select', optionsEndpoint: '/phases' },
        { name: 'activityId', label: 'Activity (optional)', type: 'select', optionsEndpoint: '/activities' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
      buildPayload={(form) => ({
        date: form.date,
        category: form.category,
        headcount: Number(form.headcount ?? 1),
        cost: Number(form.cost ?? 0),
        phaseId: form.phaseId || undefined,
        activityId: form.activityId || undefined,
        notes: form.notes || undefined,
      })}
    />
  );
}
