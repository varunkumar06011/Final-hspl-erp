import { useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
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
import {
  Add as AddIcon,
  DeleteOutline as RemoveIcon,
  WbSunny as MorningIcon,
  NightsStay as EveningIcon,
  CheckCircle as DoneIcon,
  HourglassTop as PendingIcon,
} from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { InventoryItemType, UserRole, isAdminRole } from '@hospital-erp/shared';
import ResponsiveDialog from '../ResponsiveDialog';
import api, { extractErrorMessage } from '../../config/api';
import { useAuthStore } from '../../stores/authStore';
import { formatIndianNumber } from '../../utils/enumOptions';
import SiteUsageHistory from './SiteUsageHistory';

interface StockItem {
  id: string;
  name: string;
  unit: string;
  currentStock: string | number;
}
interface SlipLine {
  id: string;
  inventoryItemId: string;
  takenQty: string | number;
  usedQty: string | number | null;
  returnedQty: string | number | null;
  inventoryItem: { id: string; name: string; unit: string };
}
interface Slip {
  id: string;
  slipNumber: string;
  slipDate: string;
  status: 'OPEN' | 'CLOSED';
  work: string | null;
  takenBy: { id: string; name: string };
  lines: SlipLine[];
}
interface Totals {
  itemId: string;
  name: string;
  unit: string;
  taken: number;
  used: number;
  returned: number;
  open: number;
}
interface SlipDay {
  date: string;
  slips: Slip[];
  totals: Totals[];
  openCount: number;
  overdueOpen: number;
}

const todayOnSite = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const num = (v: unknown) => Number(v ?? 0);
const qty = (v: unknown) => formatIndianNumber(Math.round(num(v) * 100) / 100);
const parseQty = (s: string) => (s.trim() === '' ? '' : s.replace(/[^0-9.]/g, ''));

type TakeRow = { item: StockItem | null; quantity: string };
type CloseRow = { lineId: string; name: string; unit: string; taken: number; used: string; returned: string };

/**
 * Site material: a person on site records what they took from the store in the
 * morning (stock goes down), and in the evening how much was used and how much
 * came back (returned goes back into stock).
 */
export default function SiteMaterialTab() {
  const { t } = useTranslation('inventory');
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const today = todayOnSite();
  const [date, setDate] = useState(today);
  const [notice, setNotice] = useState('');

  const [takeOpen, setTakeOpen] = useState(false);
  const [work, setWork] = useState('');
  const [takeRows, setTakeRows] = useState<TakeRow[]>([{ item: null, quantity: '' }]);
  const [takeError, setTakeError] = useState('');

  const [closing, setClosing] = useState<Slip | null>(null);
  const [closeRows, setCloseRows] = useState<CloseRow[]>([]);
  const [closeError, setCloseError] = useState('');

  const { data, isLoading } = useQuery<SlipDay>({
    queryKey: ['/inventory/site-slips', date],
    queryFn: async () => (await api.get('/inventory/site-slips', { params: { date } })).data,
  });

  const { data: stockItems = [] } = useQuery<StockItem[]>({
    queryKey: ['/inventory/items', 'site-slip-picker'],
    queryFn: async () =>
      (await api.get('/inventory/items', { params: { pageSize: 500, itemType: InventoryItemType.CONSUMABLE } })).data?.data ?? [],
    enabled: takeOpen,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['/inventory/site-slips'] });
    qc.invalidateQueries({ queryKey: ['/inventory/items'] });
    qc.invalidateQueries({ queryKey: ['/inventory/transactions'] });
    qc.invalidateQueries({ queryKey: ['/inventory/summary'] });
  };

  const takeMutation = useMutation({
    mutationFn: async (body: { work: string; lines: { itemId: string; quantity: number }[] }) =>
      (await api.post('/inventory/site-slips/take', body)).data as Slip,
    onSuccess: (slip) => {
      setTakeOpen(false);
      setDate(today);
      setNotice(t('siteTakeDone', { n: slip.slipNumber }));
      refresh();
    },
    onError: (err) => setTakeError(extractErrorMessage(err)),
  });

  const closeMutation = useMutation({
    mutationFn: async ({ id, lines }: { id: string; lines: { lineId: string; usedQty: number; returnedQty: number }[] }) =>
      (await api.post(`/inventory/site-slips/${id}/close`, { lines })).data as Slip,
    onSuccess: (slip) => {
      setClosing(null);
      setNotice(t('siteCloseDone', { n: slip.slipNumber }));
      refresh();
    },
    onError: (err) => setCloseError(extractErrorMessage(err)),
  });

  const canClose = (slip: Slip) =>
    !!user &&
    (user.id === slip.takenBy.id ||
      isAdminRole(user.role) ||
      user.role === UserRole.PROJECT_HEAD ||
      user.role === UserRole.HEAD_OF_CONSTRUCTION);

  const openTake = () => {
    setWork('');
    setTakeRows([{ item: null, quantity: '' }]);
    setTakeError('');
    setTakeOpen(true);
  };

  const submitTake = () => {
    const lines = takeRows.filter((r) => r.item || r.quantity);
    if (lines.length === 0) return setTakeError(t('siteErrNoLines'));
    for (const r of lines) {
      if (!r.item) return setTakeError(t('siteErrPick'));
      const q = Number(r.quantity);
      if (!(q > 0)) return setTakeError(t('siteErrQty'));
      if (q > num(r.item.currentStock)) return setTakeError(t('siteErrStock', { name: r.item.name, n: qty(r.item.currentStock), unit: r.item.unit }));
    }
    setTakeError('');
    takeMutation.mutate({ work, lines: lines.map((r) => ({ itemId: r.item!.id, quantity: Number(r.quantity) })) });
  };

  const openClose = (slip: Slip) => {
    setCloseRows(
      slip.lines.map((l) => ({
        lineId: l.id,
        name: l.inventoryItem.name,
        unit: l.inventoryItem.unit,
        taken: num(l.takenQty),
        used: '',
        returned: '',
      })),
    );
    setCloseError('');
    setClosing(slip);
  };

  // Typing one of used / returned fills the other so the two always add up to taken.
  const setCloseValue = (i: number, field: 'used' | 'returned', value: string) => {
    setCloseRows((rows) =>
      rows.map((r, idx) => {
        if (idx !== i) return r;
        const v = parseQty(value);
        const other = v === '' ? '' : String(Math.max(0, Math.round((r.taken - Number(v)) * 100) / 100));
        return field === 'used' ? { ...r, used: v, returned: other } : { ...r, returned: v, used: other };
      }),
    );
  };

  const submitClose = () => {
    if (!closing) return;
    for (const r of closeRows) {
      if (r.used === '' || r.returned === '') return setCloseError(t('siteErrFill', { name: r.name }));
      if (Math.abs(Number(r.used) + Number(r.returned) - r.taken) > 0.01) {
        return setCloseError(t('siteErrSum', { name: r.name, n: qty(r.taken), unit: r.unit }));
      }
    }
    setCloseError('');
    closeMutation.mutate({
      id: closing.id,
      lines: closeRows.map((r) => ({ lineId: r.lineId, usedQty: Number(r.used), returnedQty: Number(r.returned) })),
    });
  };

  const chosenIds = useMemo(() => new Set(takeRows.map((r) => r.item?.id).filter(Boolean)), [takeRows]);
  const slips = data?.slips ?? [];
  const totals = data?.totals ?? [];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}

      <Card sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Box>
            <Typography variant="h6" fontWeight={600}>{t('siteTitle')}</Typography>
            <Typography variant="body2" color="text.secondary">{t('siteIntro')}</Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <TextField
              id="site-slip-date"
              type="date"
              size="small"
              label={t('siteDate')}
              value={date}
              onChange={(e) => setDate(e.target.value || today)}
              InputLabelProps={{ shrink: true }}
              inputProps={{ max: today }}
            />
            <Button variant="contained" startIcon={<MorningIcon />} onClick={openTake}>{t('siteTake')}</Button>
          </Stack>
        </Stack>
      </Card>

      {!!data?.overdueOpen && (
        <Alert severity="warning">{t('siteOverdue', { count: data.overdueOpen })}</Alert>
      )}

      {/* Day totals */}
      <Card sx={{ overflow: 'hidden' }}>
        <Box sx={{ px: 2, pt: 2 }}>
          <Typography variant="subtitle1" fontWeight={600}>{date === today ? t('siteTodayTotals') : t('siteDayTotals', { d: date })}</Typography>
        </Box>
        {isLoading ? (
          <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress size={28} /></Box>
        ) : totals.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 2 }}>{t('siteNothing')}</Typography>
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{t('item')}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{t('siteTaken')}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{t('siteUsed')}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{t('siteReturned')}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{t('siteAwaiting')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {totals.map((r) => (
                  <TableRow key={r.itemId}>
                    <TableCell sx={{ fontWeight: 500 }}>{r.name}</TableCell>
                    <TableCell align="right">{qty(r.taken)} {r.unit}</TableCell>
                    {/* Nothing updated yet for this material: show a dash, not a misleading 0. */}
                    <TableCell align="right" sx={{ color: r.taken === r.open ? 'text.disabled' : 'warning.main', fontWeight: 600 }}>{r.taken === r.open ? '—' : `${qty(r.used)} ${r.unit}`}</TableCell>
                    <TableCell align="right" sx={{ color: r.taken === r.open ? 'text.disabled' : 'success.main', fontWeight: 600 }}>{r.taken === r.open ? '—' : `${qty(r.returned)} ${r.unit}`}</TableCell>
                    <TableCell align="right" sx={{ color: r.open > 0 ? 'info.main' : 'text.disabled', fontWeight: r.open > 0 ? 600 : 400 }}>{r.open > 0 ? `${qty(r.open)} ${r.unit}` : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      {/* Slips of the day */}
      {slips.map((slip) => (
        <Card key={slip.id} sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                <Typography fontWeight={600}>{slip.takenBy.name}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{slip.slipNumber}</Typography>
                {slip.status === 'OPEN' ? (
                  <Chip size="small" color="warning" icon={<PendingIcon />} label={t('siteStatusOpen')} />
                ) : (
                  <Chip size="small" color="success" icon={<DoneIcon />} label={t('siteStatusClosed')} />
                )}
              </Stack>
              {slip.work && <Typography variant="body2" color="text.secondary">{slip.work}</Typography>}
            </Box>
            {slip.status === 'OPEN' && canClose(slip) && (
              <Button variant="contained" color="secondary" startIcon={<EveningIcon />} onClick={() => openClose(slip)}>
                {t('siteEvening')}
              </Button>
            )}
          </Stack>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{t('item')}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{t('siteTaken')}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{t('siteUsed')}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{t('siteReturned')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {slip.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.inventoryItem.name}</TableCell>
                    <TableCell align="right">{qty(l.takenQty)} {l.inventoryItem.unit}</TableCell>
                    <TableCell align="right">{l.usedQty == null ? '—' : `${qty(l.usedQty)} ${l.inventoryItem.unit}`}</TableCell>
                    <TableCell align="right">{l.returnedQty == null ? '—' : `${qty(l.returnedQty)} ${l.inventoryItem.unit}`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      ))}

      <SiteUsageHistory />

      {/* Morning: take material */}
      <ResponsiveDialog open={takeOpen} onClose={() => setTakeOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('siteTakeTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info" sx={{ py: 0.25 }}>{t('siteTakeHelp')}</Alert>
            {takeError && <Alert severity="error">{takeError}</Alert>}
            <TextField id="site-take-work" label={t('siteWork')} placeholder={t('siteWorkHint')} value={work} onChange={(e) => setWork(e.target.value)} size="small" fullWidth />
            {takeRows.map((row, i) => (
              <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                <Autocomplete
                  sx={{ flex: 1, minWidth: 0 }}
                  size="small"
                  options={stockItems.filter((s) => num(s.currentStock) > 0 && (!chosenIds.has(s.id) || s.id === row.item?.id))}
                  value={row.item}
                  onChange={(_e, v) => setTakeRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, item: v } : r)))}
                  getOptionLabel={(o) => o.name}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  renderOption={(props, o) => (
                    <li {...props} key={o.id}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 1 }}>
                        <span>{o.name}</span>
                        <Typography variant="body2" color="text.secondary">{qty(o.currentStock)} {o.unit}</Typography>
                      </Box>
                    </li>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label={t('item')}
                      helperText={row.item ? t('siteInStore', { n: qty(row.item.currentStock), unit: row.item.unit }) : ' '}
                    />
                  )}
                />
                <TextField
                  id={`site-take-qty-${i}`}
                  size="small"
                  label={row.item ? `${t('quantity')} (${row.item.unit})` : t('quantity')}
                  value={row.quantity}
                  onChange={(e) => setTakeRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, quantity: parseQty(e.target.value) } : r)))}
                  inputMode="decimal"
                  sx={{ width: 120 }}
                />
                <IconButton
                  aria-label={t('siteRemoveLine')}
                  onClick={() => setTakeRows((rows) => (rows.length === 1 ? [{ item: null, quantity: '' }] : rows.filter((_, idx) => idx !== i)))}
                  sx={{ mt: 0.5 }}
                >
                  <RemoveIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
            <Box>
              <Button size="small" startIcon={<AddIcon />} onClick={() => setTakeRows((rows) => [...rows, { item: null, quantity: '' }])}>
                {t('siteAddLine')}
              </Button>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setTakeOpen(false)}>{t('cancel')}</Button>
          <Button variant="contained" onClick={submitTake} disabled={takeMutation.isPending}>
            {takeMutation.isPending ? <CircularProgress size={20} /> : t('siteTakeSave')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Evening: used / returned */}
      <ResponsiveDialog open={!!closing} onClose={() => setClosing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('siteEveningTitle', { n: closing?.slipNumber ?? '' })}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info" sx={{ py: 0.25 }}>{t('siteEveningHelp')}</Alert>
            {closeError && <Alert severity="error">{closeError}</Alert>}
            {closeRows.map((r, i) => (
              <Box key={r.lineId} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 1, gap: 1 }}>
                  <Typography fontWeight={600} sx={{ minWidth: 0 }}>{r.name}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                    {t('siteTaken')}: {qty(r.taken)} {r.unit}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1}>
                  <TextField
                    id={`site-used-${i}`}
                    size="small"
                    label={`${t('siteUsed')} (${r.unit})`}
                    value={r.used}
                    onChange={(e) => setCloseValue(i, 'used', e.target.value)}
                    inputMode="decimal"
                    fullWidth
                  />
                  <TextField
                    id={`site-returned-${i}`}
                    size="small"
                    label={`${t('siteReturned')} (${r.unit})`}
                    value={r.returned}
                    onChange={(e) => setCloseValue(i, 'returned', e.target.value)}
                    inputMode="decimal"
                    fullWidth
                  />
                </Stack>
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setClosing(null)}>{t('cancel')}</Button>
          <Button variant="contained" onClick={submitClose} disabled={closeMutation.isPending}>
            {closeMutation.isPending ? <CircularProgress size={20} /> : t('siteEveningSave')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
