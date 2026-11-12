import { useMemo, useState } from 'react';
import {
  Box, Button, Card, CardActionArea, Chip, InputAdornment, LinearProgress, MenuItem, TextField, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Payments as PaymentsIcon,
  Search as SearchIcon,
  FilterAltOff as ClearIcon,
  AccountBalance as BankIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { MPRPaymentMethod, POPaymentType } from '@hospital-erp/shared';
import { enumLabel, formatCurrency } from '../utils/enumOptions';

export interface AdvancePO {
  id: string;
  poNumber: string;
  paymentType: string;
  grandTotal: number;
  netPayable: number;
  advanceAmount: number | null;
  vendor: { id: string; name: string; vendorCode: string; bankName?: string | null; bankAccountNumber?: string | null; ifscCode?: string | null };
  date?: string;
  requestedPaymentMethod?: string | null;
  advancePaidToDate: number;
  outstanding: number;
  activePaymentRequest: { id: string; status: string; amount: number; requestNumber: string } | null;
}

/**
 * Where an advance / full-payment PO stands. One status per PO so it can be colour-coded
 * and filtered: PENDING (nothing requested yet), REQUESTED (waiting for approval),
 * APPROVED (approved, ready to pay), PARTIAL (part paid, balance left), PAID.
 */
export type AdvanceStatus = 'PENDING' | 'REQUESTED' | 'APPROVED' | 'PARTIAL' | 'PAID';
type Tone = 'error' | 'warning' | 'info' | 'secondary' | 'success';

const STATUS_ORDER: AdvanceStatus[] = ['PENDING', 'REQUESTED', 'APPROVED', 'PARTIAL', 'PAID'];
const TONE: Record<AdvanceStatus, Tone> = {
  PENDING: 'error',
  REQUESTED: 'warning',
  APPROVED: 'info',
  PARTIAL: 'secondary',
  PAID: 'success',
};

export function advanceStatus(po: AdvancePO): AdvanceStatus {
  if (po.outstanding <= 0) return 'PAID';
  if (po.activePaymentRequest) return po.activePaymentRequest.status === 'APPROVED' ? 'APPROVED' : 'REQUESTED';
  if (po.advancePaidToDate > 0) return 'PARTIAL';
  return 'PENDING';
}

const tint = (tone: Tone, a: number) => (theme: import('@mui/material').Theme) => alpha(theme.palette[tone].main, a);

export default function AdvancePaymentsPanel<T extends AdvancePO>({ pos, onRecord }: { pos: T[]; onRecord: (po: T) => void }) {
  const { t } = useTranslation('payments');
  const { t: tm } = useTranslation('mpr');
  const [status, setStatus] = useState<AdvanceStatus | ''>('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [payBy, setPayBy] = useState('');
  const [vendorId, setVendorId] = useState('');

  const withStatus = useMemo(() => pos.map((po) => ({ po, status: advanceStatus(po) })), [pos]);

  // Summary tiles ignore the status filter so they always show the whole picture of the other filters.
  const matchesOthers = (po: AdvancePO) => {
    const q = search.trim().toLowerCase();
    if (q && !`${po.poNumber} ${po.vendor?.name ?? ''} ${po.vendor?.vendorCode ?? ''}`.toLowerCase().includes(q)) return false;
    if (type && po.paymentType !== type) return false;
    if (payBy && (po.requestedPaymentMethod ?? '') !== payBy) return false;
    if (vendorId && po.vendor?.id !== vendorId) return false;
    return true;
  };

  const tiles = useMemo(() => {
    const out = {} as Record<AdvanceStatus, { count: number; amount: number }>;
    for (const s of STATUS_ORDER) out[s] = { count: 0, amount: 0 };
    for (const { po, status: s } of withStatus) {
      if (!matchesOthers(po)) continue;
      out[s].count += 1;
      out[s].amount += s === 'PAID' ? po.advancePaidToDate : po.outstanding;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withStatus, search, type, payBy, vendorId]);

  const rows = useMemo(
    () =>
      withStatus
        .filter(({ po, status: s }) => matchesOthers(po) && (!status || s === status))
        // Things that need attention first: not requested, awaiting approval, ready to pay, part paid, paid.
        .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (b.po.date ?? '').localeCompare(a.po.date ?? '')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [withStatus, status, search, type, payBy, vendorId],
  );

  const vendors = useMemo(() => {
    const m = new Map<string, string>();
    pos.forEach((p) => p.vendor && m.set(p.vendor.id, p.vendor.name));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [pos]);

  const filtered = !!(status || search || type || payBy || vendorId);
  const clear = () => { setStatus(''); setSearch(''); setType(''); setPayBy(''); setVendorId(''); };
  const statusLabel = (s: AdvanceStatus) => t(`advStatus${s}`);
  const payByLabel = (m?: string | null) =>
    m === MPRPaymentMethod.BANK_TRANSFER ? tm('payBank') : m === MPRPaymentMethod.CASH ? tm('payCash') : m === MPRPaymentMethod.CHEQUE ? tm('payCheque') : '';

  return (
    <Box>
      {/* Status tiles: colour = state, click to filter */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' }, gap: 1, mb: 2 }}>
        {STATUS_ORDER.map((s) => {
          const tone = TONE[s];
          const active = status === s;
          return (
            <Card
              key={s}
              variant="outlined"
              sx={(theme) => ({
                borderColor: active ? `${tone}.main` : 'divider',
                borderLeft: `4px solid ${theme.palette[tone].main}`,
                bgcolor: active ? alpha(theme.palette[tone].main, 0.12) : alpha(theme.palette[tone].main, 0.04),
                boxShadow: active ? `0 0 0 1px ${theme.palette[tone].main}` : 'none',
              })}
            >
              <CardActionArea onClick={() => setStatus(active ? '' : s)} sx={{ p: 1.25 }} aria-pressed={active}>
                <Typography variant="caption" sx={{ color: `${tone}.main`, fontWeight: 700, display: 'block', lineHeight: 1.2 }}>
                  {statusLabel(s)}
                </Typography>
                <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.3 }}>{tiles[s].count}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {s === 'PAID' ? t('advPaidAmount', { a: formatCurrency(tiles[s].amount) }) : t('advToPayAmount', { a: formatCurrency(tiles[s].amount) })}
                </Typography>
              </CardActionArea>
            </Card>
          );
        })}
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2, alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder={t('advSearch')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: { xs: '100%', sm: 240 }, flex: { sm: '1 1 240px' } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />
        <TextField select size="small" label={t('advFilterType')} value={type} onChange={(e) => setType(e.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value="">{t('advAll')}</MenuItem>
          <MenuItem value={POPaymentType.ADVANCE}>{t('advance')}</MenuItem>
          <MenuItem value={POPaymentType.FULL_PAYMENT}>{t('fullPayment')}</MenuItem>
        </TextField>
        <TextField select size="small" label={t('advFilterPayBy')} value={payBy} onChange={(e) => setPayBy(e.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value="">{t('advAll')}</MenuItem>
          <MenuItem value={MPRPaymentMethod.BANK_TRANSFER}>{tm('payBank')}</MenuItem>
          <MenuItem value={MPRPaymentMethod.CASH}>{tm('payCash')}</MenuItem>
          <MenuItem value={MPRPaymentMethod.CHEQUE}>{tm('payCheque')}</MenuItem>
        </TextField>
        <TextField select size="small" label={t('vendor')} value={vendorId} onChange={(e) => setVendorId(e.target.value)} sx={{ minWidth: 170 }}>
          <MenuItem value="">{t('advAll')}</MenuItem>
          {vendors.map(([id, name]) => <MenuItem key={id} value={id}>{name}</MenuItem>)}
        </TextField>
        {filtered && (
          <Button size="small" startIcon={<ClearIcon />} onClick={clear}>{t('advClear')}</Button>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ ml: { sm: 'auto' } }}>
          {t('advShowing', { n: rows.length, total: pos.length })}
        </Typography>
      </Box>

      {/* One card per PO */}
      {rows.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          {pos.length === 0 ? t('noPOs') : t('advNoMatch')}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {rows.map(({ po, status: s }) => {
            const tone = TONE[s];
            const paidPct = po.netPayable > 0 ? Math.min(100, Math.round((po.advancePaidToDate / po.netPayable) * 100)) : 0;
            const by = payByLabel(po.requestedPaymentMethod);
            const hasBank = !!(po.vendor?.bankAccountNumber && po.vendor?.ifscCode);
            return (
              <Card
                key={po.id}
                variant="outlined"
                sx={(theme) => ({
                  borderLeft: `5px solid ${theme.palette[tone].main}`,
                  bgcolor: s === 'PAID' ? alpha(theme.palette.success.main, 0.04) : 'background.paper',
                  p: { xs: 1.25, sm: 1.5 },
                  display: 'grid',
                  gap: 1.25,
                  gridTemplateColumns: { xs: '1fr', md: 'minmax(220px, 1.3fr) minmax(280px, 2fr) auto' },
                  alignItems: 'center',
                })}
              >
                {/* Who / what */}
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                    <Typography sx={{ fontWeight: 700 }}>{po.poNumber}</Typography>
                    <Chip size="small" color={tone} label={statusLabel(s)} sx={{ fontWeight: 600 }} />
                  </Box>
                  <Typography variant="body2" noWrap title={po.vendor?.name}>{po.vendor?.vendorCode} - {po.vendor?.name}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={po.paymentType === POPaymentType.ADVANCE ? 'warning' : 'success'}
                      label={po.paymentType === POPaymentType.ADVANCE ? t('advance') : t('fullPayment')}
                    />
                    {by && <Chip size="small" variant="outlined" icon={<BankIcon />} label={t('advPayBy', { m: by })} />}
                    {po.requestedPaymentMethod === MPRPaymentMethod.BANK_TRANSFER && !hasBank && (
                      <Chip size="small" color="warning" variant="outlined" label={t('advNoBankDetails')} />
                    )}
                  </Box>
                  {po.requestedPaymentMethod === MPRPaymentMethod.BANK_TRANSFER && hasBank && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                      {t('advBankLine', { acct: po.vendor.bankAccountNumber, ifsc: po.vendor.ifscCode })}
                    </Typography>
                  )}
                </Box>

                {/* Money */}
                <Box>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
                    <Box>
                      <Typography variant="caption" color="text.secondary">{t('grandTotal')}</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatCurrency(po.grandTotal)}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">{t('advancePaid')}</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: po.advancePaidToDate > 0 ? 'success.main' : 'text.secondary' }}>
                        {po.advancePaidToDate > 0 ? formatCurrency(po.advancePaidToDate) : '—'}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">{t('outstanding')}</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 800, color: po.outstanding > 0 ? `${tone}.main` : 'success.main' }}>
                        {formatCurrency(po.outstanding)}
                      </Typography>
                    </Box>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={paidPct}
                    color={s === 'PAID' ? 'success' : 'primary'}
                    sx={(theme) => ({ mt: 0.75, height: 6, borderRadius: 3, bgcolor: tint(tone, 0.15)(theme) })}
                  />
                  <Typography variant="caption" color="text.secondary">{t('advPercentPaid', { p: paidPct })}</Typography>
                </Box>

                {/* Action */}
                <Box sx={{ display: 'flex', justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
                  {po.activePaymentRequest ? (
                    <Chip size="small" color={tone} variant="outlined" label={t('reqStatus', { status: enumLabel(po.activePaymentRequest.status) })} />
                  ) : po.outstanding <= 0 ? (
                    <Chip size="small" color="success" label={t('paid')} />
                  ) : (
                    <Button size="small" variant="contained" color={tone === 'secondary' ? 'primary' : tone} startIcon={<PaymentsIcon />} onClick={() => onRecord(po)}>
                      {t('recordPayment')}
                    </Button>
                  )}
                </Box>
              </Card>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
