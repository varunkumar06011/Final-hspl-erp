import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Lock as LockIcon,
  LockOpen as LockOpenIcon,
  OpenInNew as OpenIcon,
} from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CONTRACT_PO_TYPES, POPaymentType } from '@hospital-erp/shared';
import api, { extractErrorMessage } from '../config/api';
import { enumLabel, formatCurrency, formatDate, STATUS_COLORS, unitLabel } from '../utils/enumOptions';
import AcknowledgementCheckbox from './AcknowledgementCheckbox';
import ResponsiveDialog from './ResponsiveDialog';
import VendorAutocomplete from './VendorAutocomplete';

const UNIT_VALUES = ['day', 'week', 'month', 'hrs', 'nos', 'job', 'visit', 'lumpsum', 'sqft', 'rft', 'kg', 'ton', 'ltr', 'set'];
const GST_CHOICES = [0, 5, 12, 18, 28];

const contractTypeLabel = (t: (k: string, o?: Record<string, unknown>) => string, value: string) =>
  t(`contractTypes.${value}`, { defaultValue: enumLabel(value) });

/** Digits with at most one decimal point — for money / quantity text fields. */
const decimalOnly = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');

const toDateInput = (v?: string | null) => (v ? String(v).slice(0, 10) : '');

interface Option {
  id: string;
  label: string;
}

function useBudgetHeadOptions(): Option[] {
  const { data } = useQuery({
    queryKey: ['/budget-heads', 'all'],
    queryFn: async () => (await api.get('/budget-heads', { params: { page: 1, pageSize: 100 } })).data,
  });
  return useMemo(() => (data?.data ?? []).map((b: { id: string; particulars: string }) => ({ id: b.id, label: b.particulars })), [data]);
}

function refreshPoData(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['/pos'] });
  queryClient.invalidateQueries({ queryKey: ['contract-summary'] });
  queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
}

// ─────────────────────────────────────────────────────────────────────────────
// New contract
// ─────────────────────────────────────────────────────────────────────────────

export function NewContractDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('po');
  const queryClient = useQueryClient();
  const budgetHeads = useBudgetHeadOptions();
  const [vendorId, setVendorId] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');
  const [estimated, setEstimated] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [budgetHeadId, setBudgetHeadId] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setVendorId(''); setTitle(''); setType(''); setEstimated(''); setStart(''); setEnd('');
    setBudgetHeadId(''); setPaymentTerms(''); setNotes(''); setAcknowledged(false); setError('');
  };
  const close = () => { reset(); onClose(); };

  const mutation = useMutation({
    mutationFn: async () =>
      (await api.post('/purchase-orders/contracts', {
        vendorId,
        contractTitle: title.trim(),
        contractType: type || undefined,
        estimatedValue: estimated ? Number(estimated) : undefined,
        contractStart: start || undefined,
        contractEnd: end || undefined,
        budgetHeadId: budgetHeadId || undefined,
        paymentTerms: paymentTerms.trim() || undefined,
        notes: notes.trim() || undefined,
        acknowledged,
      })).data,
    onSuccess: () => { refreshPoData(queryClient); close(); },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  return (
    <ResponsiveDialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>{t('contractCreateTitle')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Alert severity="info">{t('contractCreateHelp')}</Alert>
          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
          <VendorAutocomplete label={t('vendor')} value={vendorId} onChange={(id) => setVendorId(id)} required />
          <TextField label={t('contractTitleLabel')} value={title} onChange={(e) => setTitle(e.target.value)} required fullWidth inputProps={{ maxLength: 200 }} />
          <TextField select label={t('contractTypeField')} value={type} onChange={(e) => setType(e.target.value)} fullWidth>
            <MenuItem value="">{t('none')}</MenuItem>
            {CONTRACT_PO_TYPES.map((c) => <MenuItem key={c} value={c}>{contractTypeLabel(t, c)}</MenuItem>)}
          </TextField>
          <TextField
            label={t('estimatedValue')}
            value={estimated}
            onChange={(e) => setEstimated(decimalOnly(e.target.value))}
            inputProps={{ inputMode: 'decimal' }}
            helperText={t('estimatedHelp')}
            fullWidth
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField type="date" label={t('contractStart')} value={start} onChange={(e) => setStart(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField type="date" label={t('contractEnd')} value={end} onChange={(e) => setEnd(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Box>
          <TextField select label={t('budgetHead')} value={budgetHeadId} onChange={(e) => setBudgetHeadId(e.target.value)} helperText={t('contractBudgetHelp')} fullWidth>
            <MenuItem value="">{t('none')}</MenuItem>
            {budgetHeads.map((b) => <MenuItem key={b.id} value={b.id}>{b.label}</MenuItem>)}
          </TextField>
          <TextField label={t('paymentTerms')} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} fullWidth inputProps={{ maxLength: 500 }} />
          <TextField label={t('description')} value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} fullWidth inputProps={{ maxLength: 1000 }} />
          <AcknowledgementCheckbox checked={acknowledged} onChange={setAcknowledged} entityLabel={t('entityContract')} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('cancel')}</Button>
        <Button variant="contained" disabled={!vendorId || !title.trim() || !acknowledged || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? <CircularProgress size={20} /> : t('createContractBtn')}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-PO
// ─────────────────────────────────────────────────────────────────────────────

interface Line { materialName: string; quantity: string; unit: string; unitPrice: string; gstRate: string }
const emptyLine = (): Line => ({ materialName: '', quantity: '', unit: 'day', unitPrice: '', gstRate: '0' });

interface ContractRef {
  id: string;
  poNumber: string;
  budgetHeadId?: string | null;
  paymentTerms?: string | null;
}

function CreateSubPoDialog({ contract, onClose }: { contract: ContractRef | null; onClose: () => void }) {
  const { t } = useTranslation('po');
  const queryClient = useQueryClient();
  const budgetHeads = useBudgetHeadOptions();
  const [period, setPeriod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [paymentType, setPaymentType] = useState<string>(POPaymentType.AFTER_DELIVERY);
  const [advance, setAdvance] = useState('');
  const [budgetHeadId, setBudgetHeadId] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [deductions, setDeductions] = useState<{ amount: string; reason: string }[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (contract) {
      setPeriod(''); setFrom(''); setTo(''); setLines([emptyLine()]); setPaymentType(POPaymentType.AFTER_DELIVERY);
      setAdvance(''); setBudgetHeadId(contract.budgetHeadId ?? ''); setPaymentTerms(contract.paymentTerms ?? '');
      setNotes(''); setDeductions([]); setAcknowledged(false); setError('');
    }
  }, [contract]);

  const totals = useMemo(() => {
    const sub = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);
    const gst = lines.reduce((s, l) => s + (Number(l.quantity || 0) * Number(l.unitPrice || 0) * Number(l.gstRate || 0)) / 100, 0);
    const ded = deductions.reduce((s, d) => s + Number(d.amount || 0), 0);
    return { sub, gst, grand: sub + gst, ded, net: sub + gst - ded };
  }, [lines, deductions]);

  const needsAdvance = paymentType === POPaymentType.ADVANCE || paymentType === POPaymentType.FULL_PAYMENT;
  const linesValid = lines.length > 0 && lines.every((l) => l.materialName.trim() && Number(l.quantity) > 0 && l.unit && l.unitPrice !== '');
  const canSubmit =
    !!contract && period.trim() && linesValid && !!budgetHeadId && acknowledged && totals.ded <= totals.grand &&
    (!needsAdvance || (Number(advance) > 0 && Number(advance) <= totals.grand));

  const mutation = useMutation({
    mutationFn: async () =>
      (await api.post(`/purchase-orders/${contract!.id}/sub-pos`, {
        periodLabel: period.trim(),
        periodFrom: from || undefined,
        periodTo: to || undefined,
        paymentType,
        advanceAmount: needsAdvance ? Number(advance) : undefined,
        paymentTerms: paymentTerms.trim() || undefined,
        budgetHeadId: budgetHeadId || undefined,
        notes: notes.trim() || undefined,
        items: lines.map((l) => ({
          materialName: l.materialName.trim(),
          quantity: Number(l.quantity),
          unit: l.unit,
          unitPrice: Number(l.unitPrice),
          gstRate: Number(l.gstRate || 0),
        })),
        deductions: deductions
          .filter((d) => Number(d.amount) > 0 && d.reason.trim())
          .map((d) => ({ amount: Number(d.amount), reason: d.reason.trim() })),
        acknowledged,
      })).data,
    onSuccess: () => { refreshPoData(queryClient); onClose(); },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <ResponsiveDialog open={!!contract} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('subPoCreateTitle', { n: contract?.poNumber })}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Alert severity="info">{t('subPoCreateHelp')}</Alert>
          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

          <TextField label={t('periodLabel')} value={period} onChange={(e) => setPeriod(e.target.value)} placeholder={t('periodPlaceholder')} required fullWidth inputProps={{ maxLength: 100 }} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField type="date" label={t('periodFrom')} value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField type="date" label={t('periodTo')} value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Box>

          <Typography variant="subtitle2" fontWeight={700}>{t('subPoLines')}</Typography>
          {lines.map((l, i) => (
            <Box key={i} sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: '2fr 0.8fr 1fr 1fr 0.7fr auto' }, gap: 1, alignItems: 'center' }}>
              <TextField
                label={t('lineDescription')}
                value={l.materialName}
                onChange={(e) => setLine(i, { materialName: e.target.value })}
                size="small"
                sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}
              />
              <TextField label={t('quantity')} value={l.quantity} onChange={(e) => setLine(i, { quantity: decimalOnly(e.target.value) })} size="small" inputProps={{ inputMode: 'decimal' }} />
              <TextField select label={t('unit')} value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} size="small">
                {UNIT_VALUES.map((u) => <MenuItem key={u} value={u}>{unitLabel(u)}</MenuItem>)}
              </TextField>
              <TextField label={t('unitPrice')} value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: decimalOnly(e.target.value) })} size="small" inputProps={{ inputMode: 'decimal' }} />
              <TextField select label={t('gst')} value={l.gstRate} onChange={(e) => setLine(i, { gstRate: e.target.value })} size="small">
                {GST_CHOICES.map((g) => <MenuItem key={g} value={String(g)}>{g}%</MenuItem>)}
              </TextField>
              <IconButton size="small" color="error" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
          <Box><Button size="small" startIcon={<AddIcon />} onClick={() => setLines((ls) => [...ls, emptyLine()])}>{t('addLine')}</Button></Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField select label={t('paymentType')} value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
              {Object.values(POPaymentType).map((p) => <MenuItem key={p} value={p}>{enumLabel(p)}</MenuItem>)}
            </TextField>
            {needsAdvance && (
              <TextField label={t('advanceAmountLabel')} value={advance} onChange={(e) => setAdvance(decimalOnly(e.target.value))} inputProps={{ inputMode: 'decimal' }} />
            )}
            <TextField select label={t('budgetHead')} value={budgetHeadId} onChange={(e) => setBudgetHeadId(e.target.value)} required>
              {budgetHeads.map((b) => <MenuItem key={b.id} value={b.id}>{b.label}</MenuItem>)}
            </TextField>
            <TextField label={t('paymentTerms')} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} inputProps={{ maxLength: 500 }} />
          </Box>

          <Typography variant="subtitle2" fontWeight={700}>{t('deductionsTitle')}</Typography>
          {deductions.map((d, i) => (
            <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 1, alignItems: 'center' }}>
              <TextField label={t('amount')} value={d.amount} size="small" inputProps={{ inputMode: 'decimal' }}
                onChange={(e) => setDeductions((ds) => ds.map((x, idx) => (idx === i ? { ...x, amount: decimalOnly(e.target.value) } : x)))} />
              <TextField label={t('deductionReason')} value={d.reason} size="small"
                onChange={(e) => setDeductions((ds) => ds.map((x, idx) => (idx === i ? { ...x, reason: e.target.value } : x)))} />
              <IconButton size="small" color="error" onClick={() => setDeductions((ds) => ds.filter((_, idx) => idx !== i))}><DeleteIcon fontSize="small" /></IconButton>
            </Box>
          ))}
          <Box><Button size="small" startIcon={<AddIcon />} onClick={() => setDeductions((ds) => [...ds, { amount: '', reason: '' }])}>{t('addDeduction')}</Button></Box>

          <TextField label={t('description')} value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} fullWidth inputProps={{ maxLength: 1000 }} />

          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: { xs: 'stretch', sm: 'flex-end' }, gap: 0.5 }}>
            <Typography variant="body2">{t('totalLine')} <strong>{formatCurrency(totals.sub)}</strong></Typography>
            <Typography variant="body2">{t('gstAuto')} <strong>{formatCurrency(totals.gst)}</strong></Typography>
            <Typography variant="body2">{t('grandTotalLine')} <strong>{formatCurrency(totals.grand)}</strong></Typography>
            {totals.ded > 0 && (
              <>
                <Typography variant="body2" color="error">{t('lessDeductions')} <strong>-{formatCurrency(totals.ded)}</strong></Typography>
                <Typography variant="body2" fontWeight={700}>{t('netPayableLine', { v: formatCurrency(totals.net) })}</Typography>
              </>
            )}
          </Box>
          <AcknowledgementCheckbox checked={acknowledged} onChange={setAcknowledged} entityLabel={t('entitySubPo')} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="contained" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? <CircularProgress size={20} /> : t('createSubPoBtn')}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit contract terms
// ─────────────────────────────────────────────────────────────────────────────

interface ContractSummary {
  contract: {
    id: string;
    poNumber: string;
    status: string;
    contractTitle: string | null;
    contractType: string | null;
    estimatedValue: number | null;
    contractStart: string | null;
    contractEnd: string | null;
    contractClosedAt: string | null;
    vendor: { id: string; name: string; vendorCode: string };
  };
  totals: {
    subPoCount: number;
    approvedValue: number;
    pendingValue: number;
    paid: number;
    outstanding: number;
    estimatedValue: number | null;
    remainingVsEstimate: number | null;
    exceedsEstimate: boolean;
  };
  subPos: {
    id: string;
    poNumber: string;
    status: string;
    periodLabel: string | null;
    periodFrom: string | null;
    periodTo: string | null;
    grandTotal: number;
    netPayable: number;
    paid: number;
    outstanding: number;
  }[];
}

function EditContractDialog({ summary, budgetHeadId: currentHead, paymentTerms: currentTerms, notes: currentNotes, onClose }: {
  summary: ContractSummary | null;
  budgetHeadId?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('po');
  const queryClient = useQueryClient();
  const budgetHeads = useBudgetHeadOptions();
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');
  const [estimated, setEstimated] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [budgetHeadId, setBudgetHeadId] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (summary) {
      const c = summary.contract;
      setTitle(c.contractTitle ?? ''); setType(c.contractType ?? '');
      setEstimated(c.estimatedValue === null ? '' : String(c.estimatedValue));
      setStart(toDateInput(c.contractStart)); setEnd(toDateInput(c.contractEnd));
      setBudgetHeadId(currentHead ?? ''); setPaymentTerms(currentTerms ?? ''); setNotes(currentNotes ?? ''); setError('');
    }
  }, [summary, currentHead, currentTerms, currentNotes]);

  const mutation = useMutation({
    mutationFn: async () =>
      (await api.patch(`/purchase-orders/${summary!.contract.id}/contract-terms`, {
        contractTitle: title.trim(),
        contractType: type || null,
        estimatedValue: estimated === '' ? null : Number(estimated),
        contractStart: start || null,
        contractEnd: end || null,
        budgetHeadId: budgetHeadId || null,
        paymentTerms: paymentTerms.trim() || null,
        notes: notes.trim() || null,
      })).data,
    onSuccess: () => { refreshPoData(queryClient); onClose(); },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  return (
    <ResponsiveDialog open={!!summary} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('contractEditTitle', { n: summary?.contract.poNumber })}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
          <TextField label={t('contractTitleLabel')} value={title} onChange={(e) => setTitle(e.target.value)} required fullWidth inputProps={{ maxLength: 200 }} />
          <TextField select label={t('contractTypeField')} value={type} onChange={(e) => setType(e.target.value)} fullWidth>
            <MenuItem value="">{t('none')}</MenuItem>
            {CONTRACT_PO_TYPES.map((c) => <MenuItem key={c} value={c}>{contractTypeLabel(t, c)}</MenuItem>)}
          </TextField>
          <TextField label={t('estimatedValue')} value={estimated} onChange={(e) => setEstimated(decimalOnly(e.target.value))} inputProps={{ inputMode: 'decimal' }} helperText={t('estimatedHelp')} fullWidth />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField type="date" label={t('contractStart')} value={start} onChange={(e) => setStart(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField type="date" label={t('contractEnd')} value={end} onChange={(e) => setEnd(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Box>
          <TextField select label={t('budgetHead')} value={budgetHeadId} onChange={(e) => setBudgetHeadId(e.target.value)} helperText={t('contractBudgetHelp')} fullWidth>
            <MenuItem value="">{t('none')}</MenuItem>
            {budgetHeads.map((b) => <MenuItem key={b.id} value={b.id}>{b.label}</MenuItem>)}
          </TextField>
          <TextField label={t('paymentTerms')} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} fullWidth inputProps={{ maxLength: 500 }} />
          <TextField label={t('description')} value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} fullWidth inputProps={{ maxLength: 1000 }} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="contained" disabled={!title.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? <CircularProgress size={20} /> : t('save')}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel shown inside an expanded contract PO
// ─────────────────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
      <Typography variant="body2" fontWeight={700} sx={{ color, overflowWrap: 'anywhere' }}>{value}</Typography>
    </Box>
  );
}

export function ContractPanel({ contract, canManage, onOpenSubPo }: {
  contract: ContractRef & { notes?: string | null };
  /** May raise sub-POs / edit terms (CREATE_PO) */
  canManage: boolean;
  /** Jump to a sub-PO in the list */
  onOpenSubPo: (poNumber: string) => void;
}) {
  const { t } = useTranslation('po');
  const queryClient = useQueryClient();
  const [subOpen, setSubOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery<ContractSummary>({
    queryKey: ['contract-summary', contract.id],
    queryFn: async () => (await api.get(`/purchase-orders/${contract.id}/contract-summary`)).data,
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const closeMutation = useMutation({
    mutationFn: async (closed: boolean) => (await api.patch(`/purchase-orders/${contract.id}/contract-terms`, { closed })).data,
    onSuccess: () => refreshPoData(queryClient),
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  if (isLoading || !data) return <CircularProgress size={20} />;

  const { contract: c, totals, subPos } = data;
  const closed = !!c.contractClosedAt;
  const approved = c.status === 'APPROVED';

  return (
    <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={700}>{c.contractTitle ?? t('contractBadge')}</Typography>
        {c.contractType && <Chip size="small" variant="outlined" label={contractTypeLabel(t, c.contractType)} />}
        {closed && <Chip size="small" color="default" icon={<LockIcon />} label={t('contractClosed')} />}
      </Box>
      {(c.contractStart || c.contractEnd) && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {t('contractPeriodLine', { from: c.contractStart ? formatDate(c.contractStart) : '—', to: c.contractEnd ? formatDate(c.contractEnd) : '—' })}
        </Typography>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(6, 1fr)' }, gap: 1.5, mb: 1 }}>
        <Stat label={t('estimatedValueShort')} value={totals.estimatedValue === null ? t('notSet') : formatCurrency(totals.estimatedValue)} />
        <Stat label={t('raisedApproved')} value={formatCurrency(totals.approvedValue)} />
        <Stat label={t('raisedPending')} value={formatCurrency(totals.pendingValue)} color="warning.main" />
        <Stat label={t('paid')} value={formatCurrency(totals.paid)} color="success.main" />
        <Stat label={t('toPay')} value={formatCurrency(totals.outstanding)} color={totals.outstanding > 0 ? 'error.main' : undefined} />
        {totals.remainingVsEstimate !== null && (
          <Stat
            label={totals.exceedsEstimate ? t('overEstimate') : t('remainingEstimate')}
            value={formatCurrency(Math.abs(totals.remainingVsEstimate))}
            color={totals.exceedsEstimate ? 'error.main' : 'info.main'}
          />
        )}
      </Box>
      {totals.exceedsEstimate && <Alert severity="warning" sx={{ mb: 1 }}>{t('overEstimateNote')}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}

      {canManage && approved && (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
          {!closed && (
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setSubOpen(true)}>{t('createSubPo')}</Button>
          )}
          <Button size="small" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>{t('editContractTerms')}</Button>
          <Button
            size="small"
            color={closed ? 'primary' : 'warning'}
            startIcon={closed ? <LockOpenIcon /> : <LockIcon />}
            disabled={closeMutation.isPending}
            onClick={() => closeMutation.mutate(!closed)}
          >
            {closed ? t('reopenContract') : t('closeContract')}
          </Button>
        </Box>
      )}
      {canManage && !approved && (
        <Box sx={{ mb: 1 }}>
          <Button size="small" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>{t('editContractTerms')}</Button>
        </Box>
      )}

      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem', display: 'block', mb: 0.5 }}>
        {t('subPosHeading', { n: totals.subPoCount })}
      </Typography>
      {subPos.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{approved ? t('noSubPos') : t('contractNotApprovedYet')}</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {subPos.map((s) => (
            <Box
              key={s.id}
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr auto', sm: '1.1fr 1.2fr 0.9fr 0.9fr 0.9fr auto' }, gap: 1, alignItems: 'center', p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
            >
              <Typography variant="body2" fontWeight={700}>{s.poNumber}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, order: { xs: 3, sm: 0 } }}>
                {s.periodLabel ?? '—'}
                {s.periodFrom && ` (${formatDate(s.periodFrom)}${s.periodTo ? ` – ${formatDate(s.periodTo)}` : ''})`}
              </Typography>
              <Chip size="small" label={enumLabel(s.status)} color={STATUS_COLORS[s.status] ?? 'default'} sx={{ justifySelf: 'start' }} />
              <Typography variant="body2">{formatCurrency(s.grandTotal)}</Typography>
              <Typography variant="body2" sx={{ color: s.outstanding > 0 ? 'error.main' : 'success.main' }}>
                {t('paidOf', { paid: formatCurrency(s.paid) })}
              </Typography>
              <IconButton size="small" title={t('viewSubPo')} onClick={() => onOpenSubPo(s.poNumber)}><OpenIcon fontSize="small" /></IconButton>
            </Box>
          ))}
        </Box>
      )}

      <CreateSubPoDialog contract={subOpen ? { id: contract.id, poNumber: contract.poNumber, budgetHeadId: contract.budgetHeadId, paymentTerms: contract.paymentTerms } : null} onClose={() => setSubOpen(false)} />
      <EditContractDialog
        summary={editOpen ? data : null}
        budgetHeadId={contract.budgetHeadId}
        paymentTerms={contract.paymentTerms}
        notes={contract.notes}
        onClose={() => setEditOpen(false)}
      />
    </Box>
  );
}
