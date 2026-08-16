import EntityPage from '../components/EntityPage';
import { IssueCategory, IssueSeverity, IssueStatus } from '@hospital-erp/shared';
import { enumToOptions, STATUS_COLORS } from '../utils/enumOptions';

export default function IssuesPage() {
  return (
    <EntityPage
      title="Issues Tracker"
      endpoint="/issues"
      entityName="Issue"
      entityType="ISSUE"
      columns={[
        { key: 'title', label: 'Title' },
        { key: 'category', label: 'Category' },
        { key: 'severity', label: 'Severity' },
        { key: 'status', label: 'Status' },
        { key: 'phase', label: 'Phase', render: (r) => (r.phase as any)?.name ?? '—' },
      ]}
      statusKey="status"
      statusColors={STATUS_COLORS}
      fields={[
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'category', label: 'Category', type: 'select', required: true, options: enumToOptions(IssueCategory), defaultValue: IssueCategory.OTHER, dropdownType: 'ISSUE_CATEGORY' },
        { name: 'severity', label: 'Severity', type: 'select', options: enumToOptions(IssueSeverity), defaultValue: IssueSeverity.MEDIUM },
        { name: 'status', label: 'Status', type: 'select', options: enumToOptions(IssueStatus), defaultValue: IssueStatus.OPEN },
        { name: 'phaseId', label: 'Phase (optional)', type: 'select', optionsEndpoint: '/phases' },
        { name: 'activityId', label: 'Activity (optional)', type: 'select', optionsEndpoint: '/activities' },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'resolution', label: 'Resolution', type: 'textarea' },
      ]}
      buildPayload={(form) => ({
        title: form.title,
        category: form.category,
        severity: form.severity,
        status: form.status,
        phaseId: form.phaseId || undefined,
        activityId: form.activityId || undefined,
        description: form.description || undefined,
        resolution: form.resolution || undefined,
      })}
    />
  );
}
