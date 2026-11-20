import { Fragment, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api, { extractErrorMessage } from '../../config/api';
import { formatIndianNumber } from '../../utils/enumOptions';
import { dateLocale } from '../../i18n';

interface UsageRow {
  date?: string;
  itemId: string;
  name: string;
  unit: string;
  taken: number;
  used: number;
  returned: number;
  open: number;
}
interface UsageHistory {
  from: string;
  to: string;
  days: UsageRow[];
  totals: UsageRow[];
}

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const qty = (v: number) => formatIndianNumber(Math.round(v * 100) / 100);

/** How much of each material was used on each day, for a chosen date range. */
export default function SiteUsageHistory() {
  const { t } = useTranslation('inventory');
  const today = ymd(new Date());
  const [to, setTo] = useState(today);
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 6 * 86_400_000)));

  const { data, isLoading, error } = useQuery<UsageHistory>({
    queryKey: ['/inventory/site-slips', 'history', from, to],
    queryFn: async () => (await api.get('/inventory/site-slips/history', { params: { from, to } })).data,
    enabled: !!from && !!to && from <= to,
  });

  const dayLabel = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  // Group rows by day so each day shows as one block.
  const byDay: { date: string; rows: UsageRow[] }[] = [];
  for (const r of data?.days ?? []) {
    const last = byDay[byDay.length - 1];
    if (last && last.date === r.date) last.rows.push(r);
    else byDay.push({ date: r.date!, rows: [r] });
  }

  const head = (
    <TableRow>
      <TableCell sx={{ fontWeight: 600 }}>{t('item')}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 600 }}>{t('siteTaken')}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 600 }}>{t('siteUsed')}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 600 }}>{t('siteReturned')}</TableCell>
    </TableRow>
  );
  const line = (r: UsageRow, key: string) => (
    <TableRow key={key}>
      <TableCell sx={{ pl: 3 }}>{r.name}</TableCell>
      <TableCell align="right">{qty(r.taken)} {r.unit}</TableCell>
      <TableCell align="right" sx={{ color: r.taken === r.open ? 'text.disabled' : 'warning.main', fontWeight: 600 }}>
        {r.taken === r.open ? '—' : `${qty(r.used)} ${r.unit}`}
        {r.open > 0 && (
          <Typography component="span" variant="caption" color="info.main" sx={{ display: 'block', fontWeight: 400 }}>
            {t('historyInUse', { n: qty(r.open), unit: r.unit })}
          </Typography>
        )}
      </TableCell>
      <TableCell align="right" sx={{ color: r.taken === r.open ? 'text.disabled' : 'success.main', fontWeight: 600 }}>
        {r.taken === r.open ? '—' : `${qty(r.returned)} ${r.unit}`}
      </TableCell>
    </TableRow>
  );

  return (
    <Card sx={{ overflow: 'hidden' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ p: 2 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>{t('historyTitle')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('historyIntro')}</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <TextField id="site-history-from" type="date" size="small" label={t('historyFrom')} value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} inputProps={{ max: to }} />
          <TextField id="site-history-to" type="date" size="small" label={t('historyTo')} value={to} onChange={(e) => setTo(e.target.value || today)} InputLabelProps={{ shrink: true }} inputProps={{ max: today }} />
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mx: 2, mb: 2 }}>{extractErrorMessage(error)}</Alert>}
      {isLoading ? (
        <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress size={28} /></Box>
      ) : byDay.length === 0 ? (
        <Typography color="text.secondary" sx={{ px: 2, pb: 2 }}>{t('historyEmpty')}</Typography>
      ) : (
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>{head}</TableHead>
            <TableBody>
              {byDay.map((d) => (
                <Fragment key={d.date}>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell colSpan={4} sx={{ fontWeight: 600 }}>{dayLabel(d.date)}</TableCell>
                  </TableRow>
                  {d.rows.map((r) => line(r, `${d.date}-${r.itemId}`))}
                </Fragment>
              ))}
              <TableRow sx={{ bgcolor: 'action.selected' }}>
                <TableCell colSpan={4} sx={{ fontWeight: 700 }}>{t('historyTotal', { from: dayLabel(data!.from), to: dayLabel(data!.to) })}</TableCell>
              </TableRow>
              {(data?.totals ?? []).map((r) => line(r, `total-${r.itemId}`))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Card>
  );
}
