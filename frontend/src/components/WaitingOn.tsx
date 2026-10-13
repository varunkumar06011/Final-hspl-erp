import { Chip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { roleLabel } from '../utils/enumOptions';

interface WaitStep {
  approverRole: string;
  status: string;
  decidedAt?: string | null;
}

/**
 * "Waiting on Project Head · 2d" — who a record is stuck with and for how long.
 * Shows nothing once nobody is left to decide. The clock restarts at each decision.
 */
export default function WaitingOn({
  workflow,
  since,
}: {
  workflow?: { steps?: WaitStep[] } | null;
  /** When the record was raised; used until a first decision is made. */
  since?: string | null;
}) {
  const { t } = useTranslation('mywork');
  const steps = workflow?.steps ?? [];
  const pending = steps.filter((s) => s.status === 'PENDING');
  if (pending.length === 0) return null;

  const decided = steps
    .filter((s) => s.status !== 'PENDING' && s.decidedAt)
    .map((s) => new Date(s.decidedAt as string).getTime());
  const from = decided.length > 0 ? Math.max(...decided) : new Date(since ?? '').getTime();
  const days = Number.isNaN(from) ? 0 : Math.max(0, Math.floor((Date.now() - from) / 86_400_000));
  const who = [...new Set(pending.map((s) => roleLabel(s.approverRole)))].join(' / ');

  return (
    <Chip
      size="small"
      variant="outlined"
      color={days >= 3 ? 'warning' : 'default'}
      label={t('waitingOnShort', { who, when: days > 0 ? t('daysShort', { n: days }) : t('today') })}
    />
  );
}
