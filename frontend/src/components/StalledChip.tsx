import { Chip } from '@mui/material';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import { useTranslation } from 'react-i18next';
import { StalledType, useStalledItem } from '../hooks/useStalled';
import { formatDuration } from './ApprovalTiming';

/**
 * Marks a record that is approved but has not moved to the next step of the
 * procurement chain for a while, e.g. "Waiting for PO · 3d 4h".
 */
export default function StalledChip({ type, id }: { type: StalledType; id: string | undefined }) {
  const { t } = useTranslation();
  const item = useStalledItem(type, id);
  if (!item) return null;
  const waited = formatDuration(Date.now() - new Date(item.since).getTime(), t);
  return (
    <Chip
      icon={<HourglassTopIcon />}
      size="small"
      color="warning"
      label={`${t(`stalled.${item.waitingFor}`)} · ${waited}`}
      title={t('stalled.tooltip', { d: waited })}
    />
  );
}
