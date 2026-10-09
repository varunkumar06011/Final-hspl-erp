import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  CircularProgress,
  InputAdornment,
  Pagination,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Search as SearchIcon,
  AccountTree as CombinedIcon,
  Close as ClearIcon,
  Check as CheckIcon,
} from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Permission, hasPermission } from '@hospital-erp/shared';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import ApprovalActionDialog from '../components/ApprovalActionDialog';
import { useToast } from '../components/ToastProvider';
import RefreshButton from '../components/RefreshButton';
import StageStepper, { type Step } from '../components/combined/StageStepper';
import CombinedRecordDialog from '../components/combined/CombinedRecordDialog';
import NewRequestDialog from '../components/combined/NewRequestDialog';
import { enumLabel, formatCurrency, formatDate } from '../utils/enumOptions';

interface Row {
  key: string;
  type: 'mpr' | 'quotation' | 'po';
  id: string;
  title: string;
  isSiteBills: boolean;
  requestType: string | null;
  date: string | null;
  lastActivity: string | null;
  vendors: string[];
  materials: string[];
  materialCount: number;
  amount: number;
  numbers: {
    mpr: { id: string; number: string; status: string } | null;
    quotations: { id: string; number: string; status: string }[];
    pos: { id: string; number: string; status: string }[];
    goodsReceipts: number;
    invoices: number;
    bills: number;
  };
  steps: Step[];
  current: string;
  next: string;
  action: { kind: 'mpr' | 'po'; id: string; label: string } | null;
}

interface ListResponse {
  data: Row[];
  counts: Record<string, number>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

const STAGES = ['all', 'REQUEST', 'QUOTATION', 'PO', 'DELIVERY', 'INVOICE', 'PAYMENT', 'DONE', 'CLOSED'] as const;

/**
 * Combined Records: every purchase as one record, MPR → quotations → PO → delivery →
 * invoice → payment. Searching any number of the chain (PO60, Q12, MPR7), a vendor or
 * a material brings up the whole record; opening it shows and runs every step.
 */
export default function CombinedRecordsPage() {
  const { t } = useTranslation('combined');
  const { user } = useAuthStore();
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get('q') ?? '');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [stage, setStage] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [newOpen, setNewOpen] = useState(false);
  const [decision, setDecision] = useState<{ kind: 'mpr' | 'po'; id: string; label: string; action: 'approve' | 'reject' } | null>(null);
  const [decisionError, setDecisionError] = useState('');
  const queryClient = useQueryClient();
  const toast = useToast();
  const openType = params.get('type');
  const openId = params.get('id');

  // Search as you type, after a short pause.
  useEffect(() => {
    const h = setTimeout(() => { setQuery(input.trim()); setPage(1); }, 300);
    return () => clearTimeout(h);
  }, [input]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['/combined-records', 'list', query, stage, page],
    queryFn: async () => (await api.get('/combined-records', { params: { q: query || undefined, stage, page, pageSize: 25 } })).data as ListResponse,
    placeholderData: (prev) => prev,
  });

  const openRecord = (type: string, id: string) => {
    const next = new URLSearchParams(params);
    next.set('type', type);
    next.set('id', id);
    setParams(next);
  };
  const closeRecord = () => {
    const next = new URLSearchParams(params);
    next.delete('type');
    next.delete('id');
    setParams(next, { replace: true });
  };

  const rows = data?.data ?? [];
  const canCreate = !!user && hasPermission(user.role, Permission.CREATE_MPR, user.extraPermissions);

  // Approve / reject straight from the list: same endpoints as the record view.
  const decide = useMutation({
    mutationFn: async (d: NonNullable<typeof decision> & { comments?: string; reason?: string }) => {
      const base = d.kind === 'mpr' ? '/material-purchase-requests' : '/purchase-orders';
      const body = d.action === 'approve' ? { comments: d.comments, acknowledged: true } : { reason: d.reason, acknowledged: true };
      return (await api.post(`${base}/${d.id}/${d.action}`, body)).data;
    },
    onSuccess: (_res, d) => {
      setDecision(null);
      setDecisionError('');
      queryClient.invalidateQueries({ queryKey: ['/combined-records'] });
      queryClient.invalidateQueries({ queryKey: ['mprs'] });
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      toast.success(d.action === 'approve' ? t('approvedToast') : t('rejectedToast'));
    },
    onError: (err) => setDecisionError(extractErrorMessage(err)),
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>{t('title')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('subtitle')}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <RefreshButton onClick={() => refetch()} />
          {canCreate && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewOpen(true)}>{t('newRequest')}</Button>}
        </Box>
      </Box>

      <Card sx={{ p: 1.5, mb: 2 }}>
        <TextField
          fullWidth
          autoFocus
          placeholder={t('searchPlaceholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          InputProps={{
            startAdornment: <InputAdornment position="start">{isFetching && query ? <CircularProgress size={18} /> : <SearchIcon />}</InputAdornment>,
            endAdornment: input ? <InputAdornment position="end"><ClearIcon sx={{ cursor: 'pointer' }} fontSize="small" onClick={() => setInput('')} /></InputAdornment> : undefined,
          }}
        />
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1.25 }}>
          {STAGES.map((s) => (
            <Chip
              key={s}
              clickable
              color={stage === s ? 'primary' : 'default'}
              variant={stage === s ? 'filled' : 'outlined'}
              label={`${t(`filter.${s}`)}${data?.counts?.[s] !== undefined ? ` (${data.counts[s]})` : s === 'all' ? '' : ' (0)'}`}
              onClick={() => { setStage(s); setPage(1); }}
            />
          ))}
        </Box>
      </Card>

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : rows.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <CombinedIcon color="disabled" sx={{ fontSize: 48 }} />
          <Typography color="text.secondary" sx={{ mt: 1 }}>{query ? t('noMatch', { q: query }) : t('none')}</Typography>
        </Paper>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {rows.map((r) => (
            <Card key={r.key} variant="outlined" sx={{ borderLeft: 4, borderLeftColor: r.next === 'completed' ? 'success.main' : r.current === 'CLOSED' ? 'error.main' : 'warning.main' }}>
              <CardActionArea onClick={() => openRecord(r.type, r.id)} sx={{ p: 1.5 }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography fontWeight={700}>{r.title}</Typography>
                  {r.isSiteBills && <Chip size="small" color="secondary" label={t('siteBillsChip', { count: r.numbers.bills })} />}
                  {r.requestType === 'SERVICE' && <Chip size="small" variant="outlined" label={t('typeService')} />}
                  <Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0, flexShrink: 1 }}>{r.vendors.join(', ') || '—'}</Typography>
                  <Box sx={{ flex: 1 }} />
                  <Typography fontWeight={700}>{formatCurrency(r.amount)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                  {r.numbers.mpr && r.title !== r.numbers.mpr.number && <NumberChip label={r.numbers.mpr.number} status={r.numbers.mpr.status} />}
                  {r.numbers.quotations.filter((q) => q.number !== r.title).map((q) => <NumberChip key={q.id} label={q.number} status={q.status} quotation />)}
                  {r.numbers.pos.filter((p) => p.number !== r.title).map((p) => <NumberChip key={p.id} label={p.number} status={p.status} />)}
                  {r.numbers.goodsReceipts > 0 && <Chip size="small" variant="outlined" label={t('grnCount', { count: r.numbers.goodsReceipts })} />}
                  {r.numbers.invoices > 0 && <Chip size="small" variant="outlined" label={t('invoiceCount', { count: r.numbers.invoices })} />}
                </Box>
                {r.materials.length > 0 && (
                  <Typography variant="caption" color="text.secondary" display="block" noWrap sx={{ mt: 0.5 }}>
                    {r.materials.join(', ')}{r.materialCount > r.materials.length ? ` +${r.materialCount - r.materials.length}` : ''}
                  </Typography>
                )}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1, flexWrap: 'wrap' }}>
                  <Box sx={{ flex: '1 1 220px', maxWidth: 360 }}><StageStepper steps={r.steps} compact /></Box>
                  <Chip size="small" color={r.next === 'completed' ? 'success' : r.current === 'CLOSED' ? 'error' : 'warning'} label={t(`next.${r.next}`)} />
                  <Typography variant="caption" color="text.secondary">{formatDate(r.lastActivity ?? r.date)}</Typography>
                </Box>
              </CardActionArea>
              {r.action && (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', px: 1.5, pb: 1.25 }}>
                  <Typography variant="body2" sx={{ mr: 'auto' }}>
                    {t(r.action.kind === 'mpr' ? 'decideRequest' : 'decidePo', { n: r.action.label })}
                  </Typography>
                  <Button size="small" variant="contained" color="success" startIcon={<CheckIcon />} onClick={() => setDecision({ ...r.action!, action: 'approve' })}>{t('approve')}</Button>
                  <Button size="small" color="error" startIcon={<ClearIcon fontSize="small" />} onClick={() => setDecision({ ...r.action!, action: 'reject' })}>{t('reject')}</Button>
                </Box>
              )}
            </Card>
          ))}
          {(data?.pagination.totalPages ?? 1) > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
              <Pagination count={data!.pagination.totalPages} page={page} onChange={(_e, p) => setPage(p)} />
            </Box>
          )}
        </Box>
      )}
      {!user || hasPermission(user.role, Permission.VIEW_FINANCIALS, user.extraPermissions) ? null : (
        <Alert severity="info" sx={{ mt: 2 }}>{t('noFinancialAccess')}</Alert>
      )}

      <ApprovalActionDialog
        open={!!decision}
        action={decision?.action ?? 'approve'}
        entityLabel={decision?.label ?? ''}
        pending={decide.isPending}
        error={decisionError}
        onClearError={() => setDecisionError('')}
        onClose={() => { setDecision(null); setDecisionError(''); }}
        onConfirm={(payload) => decision && decide.mutate({ ...decision, comments: payload.comments, reason: payload.reason })}
      />

      {openType && openId && <CombinedRecordDialog key={`${openType}:${openId}`} type={openType} id={openId} onClose={closeRecord} />}
      <NewRequestDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={(id) => { setNewOpen(false); openRecord('mpr', id); }} />
    </Box>
  );
}

function NumberChip({ label, status, quotation = false }: { label: string; status: string; quotation?: boolean }) {
  const { t } = useTranslation('combined');
  // Quotations are finalized, not approved: show that wording.
  const text = quotation
    ? ['SUBMITTED', 'UNDER_REVIEW', 'PENDING'].includes(status) ? t('qWaiting')
      : ['APPROVED', 'CONVERTED_TO_PO'].includes(status) ? t('qFinalized')
        : status === 'REJECTED' ? t('qNotSelected') : enumLabel(status)
    : enumLabel(status);
  return <Chip size="small" variant="outlined" label={`${label} · ${text}`} />;
}
