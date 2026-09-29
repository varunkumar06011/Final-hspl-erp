import { useTranslation } from 'react-i18next';
import { enumLabel, roleLabel } from '../utils/enumOptions';
import { Box, Chip, Divider, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';

interface ApprovalStep {
  id: string;
  stepNumber: number;
  approverRole: string;
  status: string;
  approverUser?: { name: string } | null;
  comments?: string | null;
}

function statusColor(status: string): 'success' | 'error' | 'default' {
  if (status === 'APPROVED') return 'success';
  if (status === 'REJECTED') return 'error';
  return 'default';
}

export default function ApprovalStepsDisplay({ steps }: { steps: ApprovalStep[] }) {
  const { t } = useTranslation();
  return (
    <>
      <Table size="small" sx={{ display: { xs: 'none', sm: 'table' } }}>
        <TableHead>
          <TableRow>
            <TableCell>{t('approval.step')}</TableCell>
            <TableCell>{t('approval.approverRole')}</TableCell>
            <TableCell>{t('approval.status')}</TableCell>
            <TableCell>{t('approval.approver')}</TableCell>
            <TableCell>{t('approval.comments')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {steps.map((step) => (
            <TableRow key={step.id}>
              <TableCell>{step.stepNumber}</TableCell>
              <TableCell>{roleLabel(step.approverRole)}</TableCell>
              <TableCell><Chip label={enumLabel(step.status)} size="small" color={statusColor(step.status)} /></TableCell>
              <TableCell>{step.approverUser?.name ?? '—'}</TableCell>
              <TableCell>{step.comments ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Box sx={{ display: { xs: 'flex', sm: 'none' }, flexDirection: 'column', gap: 1.5 }}>
        {steps.map((step) => (
          <Box key={step.id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
              <Typography variant="subtitle2" fontWeight={700}>{t('approval.step')} {step.stepNumber}</Typography>
              <Chip label={enumLabel(step.status)} size="small" color={statusColor(step.status)} />
            </Box>
            <Divider sx={{ mb: 1 }} />
            <Box sx={{ display: 'grid', gridTemplateColumns: '88px minmax(0, 1fr)', columnGap: 1, rowGap: 0.75 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('approval.role')}</Typography>
              <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{roleLabel(step.approverRole)}</Typography>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('approval.approver')}</Typography>
              <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{step.approverUser?.name ?? '—'}</Typography>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('approval.comments')}</Typography>
              <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{step.comments ?? '—'}</Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </>
  );
}
