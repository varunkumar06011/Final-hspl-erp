import { Box, Typography, Tooltip, Chip } from '@mui/material';

interface ApprovalStep {
  id: string;
  stepNumber: number;
  approverRole: string;
  status: string;
  approverUser?: { name: string } | null;
  comments?: string | null;
}

/**
 * Compact inline display of approval comments for use inside table cells.
 * Shows each approver's comment with their name, so accountants can see
 * approval feedback right next to the bill/PO/payment row without expanding
 * the accordion at the bottom of the page.
 */
export default function ApprovalCommentsInline({ steps }: { steps: ApprovalStep[] }) {
  const decided = steps.filter(
    (s) => (s.status === 'APPROVED' || s.status === 'REJECTED') && s.comments && s.comments.trim().length > 0,
  );

  if (decided.length === 0) {
    return <Typography variant="caption" color="text.secondary">—</Typography>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
      {decided.map((step) => (
        <Tooltip
          key={step.id}
          title={`${step.approverUser?.name ?? '—'} (${step.approverRole.replace(/_/g, ' ')}): ${step.comments}`}
          arrow
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, minWidth: 0 }}>
            <Chip
              size="small"
              label={step.status === 'APPROVED' ? '✓' : '✗'}
              color={step.status === 'APPROVED' ? 'success' : 'error'}
              sx={{ height: 18, fontSize: '0.7rem', flexShrink: 0, '& .MuiChip-label': { px: 0.5 } }}
            />
            <Typography
              variant="caption"
              sx={{ minWidth: 0, overflowWrap: 'anywhere', lineHeight: 1.2 }}
            >
              <strong>{step.approverUser?.name ?? '—'}:</strong> {step.comments}
            </Typography>
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}
