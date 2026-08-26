import { Box, Chip, Divider, Typography } from '@mui/material';
import { STATUS_COLORS } from '../utils/enumOptions';

const LEGEND_GROUPS: { color: 'default' | 'info' | 'success' | 'warning' | 'error' | 'secondary'; label: string; statuses: string[] }[] = [
  {
    color: 'success',
    label: 'Completed or approved',
    statuses: ['ACTIVE', 'APPROVED', 'COMPLETED', 'CONVERTED_TO_PO', 'DELIVERED', 'PASSED', 'PAID', 'POSTED', 'RESOLVED', 'VERIFIED'],
  },
  {
    color: 'info',
    label: 'In progress or partially complete',
    statuses: ['AFTER', 'DURING', 'IN_PROGRESS', 'INWARD', 'PARTIALLY_DELIVERED', 'PARTIALLY_PAID', 'READY_TO_POST', 'SCHEDULED', 'SUBMITTED', 'UNDER_REVIEW', 'VISITOR'],
  },
  {
    color: 'warning',
    label: 'Pending or needs attention',
    statuses: ['CORRECTIVE_ACTION', 'DEFECTS_FOUND', 'ON_HOLD', 'PENDING', 'PENDING_APPROVAL', 'PENDING_INSPECTION', 'RE_INSPECTION', 'SUPERSEDED'],
  },
  {
    color: 'error',
    label: 'Rejected, failed, delayed, or critical',
    statuses: ['BLACKLISTED', 'CANCELLED', 'CRITICAL', 'DELAYED', 'FAILED', 'HIGH', 'OPEN', 'REJECTED', 'TERMINATED'],
  },
  {
    color: 'default',
    label: 'Draft, inactive, not started, closed, or not yet billed',
    statuses: ['ARCHIVED', 'BEFORE', 'CLOSED', 'DRAFT', 'INACTIVE', 'LOW', 'MATERIAL', 'NOT_STARTED', 'UNBILLED'],
  },
  {
    color: 'secondary',
    label: 'Outgoing movement',
    statuses: ['OUTWARD'],
  },
];

export default function StatusLegend() {
  return (
    <Box sx={{ px: 2, py: 2 }}>
      <Typography variant="caption" fontWeight={700} color="text.secondary">
        COLOR LEGEND
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
        These colors match the status badges used across the application.
      </Typography>
      {LEGEND_GROUPS.map((group) => (
        <Box key={group.color} sx={{ mb: 1.5 }}>
          <Chip label={group.color === 'default' ? 'Default' : group.color[0].toUpperCase() + group.color.slice(1)} color={group.color} size="small" sx={{ mb: 0.5 }} />
          <Typography variant="caption" display="block" color="text.secondary">
            {group.label}
          </Typography>
          <Typography variant="caption" display="block" sx={{ lineHeight: 1.35 }}>
            {group.statuses
              .filter((status) => STATUS_COLORS[status] === group.color)
              .map((status) => status.replace(/_/g, ' '))
              .join(' • ')}
          </Typography>
        </Box>
      ))}
      <Divider sx={{ my: 1 }} />
      <Typography variant="caption" color="text.secondary">
        Gatepass types: Material uses Default; Visitor uses Info.
      </Typography>
    </Box>
  );
}
