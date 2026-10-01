import CommentsButton from '../components/CommentsButton';
import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TextField,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Chip,
  Alert,
  CircularProgress,
  InputAdornment,
  LinearProgress,
  Stack,
  MenuItem,
  Tooltip,
} from '@mui/material';
import { InfoOutlined as InfoIcon } from '@mui/icons-material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Upload as UploadIcon,
  History as HistoryIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Visibility as VisibilityIcon,
  TableChart as TableChartIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from '../components/ResponsiveDialog';
import ResponsiveTable from '../components/ResponsiveTable';
import RefreshButton from '../components/RefreshButton';
import LandscapeExcelTable from '../components/LandscapeExcelTable';
import PortraitRotateHint from '../components/PortraitRotateHint';
import { formatCurrency, formatIndianNumber, formatDate } from '../utils/enumOptions';
import { useDeepLinkRow } from '../hooks/useDeepLinkRow';
import { useMobileLandscape, useMobilePortrait } from '../hooks/useMobileLandscape';

import { useTranslation } from 'react-i18next';
export default function BudgetHeadsPage() {
  const { t: tr } = useTranslation('budget');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [importText, setImportText] = useState('');
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false);
  const [revisionTarget, setRevisionTarget] = useState<Record<string, unknown> | null>(null);
  const [revisionForm, setRevisionForm] = useState<Record<string, unknown>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyHeadId, setHistoryHeadId] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<Record<string, unknown> | null>(null);
  const [reviewComments, setReviewComments] = useState('');
  const [usageHeadId, setUsageHeadId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { excelView: isMobileLandscape, isMobile, wantsTable, showRotateHint, toggleExcelView } = useMobileLandscape();
  const isMobilePortrait = useMobilePortrait();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['/budget-heads', page, pageSize, search],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      const response = await api.get('/budget-heads', { params });
      return response.data;
    },
  });

  const { data: summary } = useQuery({
    queryKey: ['/budget-heads/summary'],
    queryFn: async () => {
      const response = await api.get('/budget-heads/summary');
      return response.data;
    },
  });

  // ── Budget Head usage breakdown (opened on row click) ──
  // Fetches the budget head's allocated/utilized/remaining summary plus the
  // full list of related expenditures (POs, payments, JVs) up to now.
  const { data: usageData, isLoading: usageLoading } = useQuery({
    queryKey: ['/budget-heads', usageHeadId, 'breakdown'],
    queryFn: async () => {
      if (!usageHeadId) return null;
      const response = await api.get(`/budget-heads/${usageHeadId}/breakdown`);
      return response.data;
    },
    enabled: !!usageHeadId,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await api.post('/budget-heads', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/budget-heads'] });
      queryClient.invalidateQueries({ queryKey: ['/budget-heads/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/finance-reports/budget-vs-actual'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard', 'admin-summary'] });
      closeDialog();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) => {
      const response = await api.patch(`/budget-heads/${id}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/budget-heads'] });
      queryClient.invalidateQueries({ queryKey: ['/budget-heads/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/finance-reports/budget-vs-actual'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard', 'admin-summary'] });
      closeDialog();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/budget-heads/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/budget-heads'] });
      queryClient.invalidateQueries({ queryKey: ['/budget-heads/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/finance-reports/budget-vs-actual'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard', 'admin-summary'] });
      setDeleteConfirm(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const importMutation = useMutation({
    mutationFn: async (items: Array<{ sl_no: number; particulars: string; amount: number }>) => {
      const response = await api.post('/budget-heads/import', { items });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/budget-heads'] });
      queryClient.invalidateQueries({ queryKey: ['/budget-heads', 'all'] });
      queryClient.invalidateQueries({ queryKey: ['/budget-heads/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/finance-reports/budget-vs-actual'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard', 'admin-summary'] });
      setImportOpen(false);
      setImportText('');
      setError('');
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  // ── Budget revisions ──
  const { data: pendingRevisions } = useQuery({
    queryKey: ['/budget-revisions', 'pending'],
    queryFn: async () => {
      const response = await api.get('/budget-revisions', { params: { status: 'PENDING' } });
      return response.data;
    },
  });

  const { data: revisionHistory, isLoading: historyLoading } = useQuery({
    queryKey: ['/budget-revisions', historyHeadId, 'history'],
    queryFn: async () => {
      if (!historyHeadId) return { data: [] };
      const response = await api.get(`/budget-revisions/${historyHeadId}/history`);
      return response.data;
    },
    enabled: !!historyHeadId,
  });

  const requestRevisionMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await api.post('/budget-revisions/request', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/budget-revisions'] });
      setRevisionDialogOpen(false);
      setRevisionTarget(null);
      setRevisionForm({});
      setError('');
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const reviewRevisionMutation = useMutation({
    mutationFn: async ({ id, approved, comments }: { id: string; approved: boolean; comments?: string }) => {
      const response = await api.post(`/budget-revisions/${id}/review`, { approved, comments });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/budget-revisions'] });
      queryClient.invalidateQueries({ queryKey: ['/budget-heads'] });
      queryClient.invalidateQueries({ queryKey: ['/budget-heads/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/finance-reports/budget-vs-actual'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard', 'admin-summary'] });
      setReviewTarget(null);
      setReviewComments('');
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const openCreate = () => {
    setForm({ slNo: '', particulars: '', allocatedAmount: '' });
    setEditing(null);
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (row: Record<string, unknown>) => {
    setForm({
      slNo: row.slNo ?? '',
      particulars: row.particulars ?? '',
      allocatedAmount: row.allocatedAmount ?? '',
    });
    setEditing(row);
    setError('');
    setDialogOpen(true);
  };
  void openEdit; // retained for potential direct-edit mode; currently using revision workflow
  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm({});
    setError('');
  };

  const openRevisionDialog = (row: Record<string, unknown>) => {
    setRevisionTarget(row);
    setRevisionForm({
      newSlNo: row.slNo ?? '',
      newParticulars: row.particulars ?? '',
      newAllocated: row.allocatedAmount ?? '',
      newStatus: row.status ?? 'ACTIVE',
      reason: '',
    });
    setError('');
    setRevisionDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!form.particulars || String(form.particulars).trim() === '') {
      setError(tr('errPart'));
      return;
    }
    if (!form.allocatedAmount || Number(form.allocatedAmount) <= 0) {
      setError(tr('errAlloc'));
      return;
    }
    setError('');
    const payload: Record<string, unknown> = {
      particulars: String(form.particulars).trim(),
      allocatedAmount: Number(form.allocatedAmount),
    };
    if (editing) {
      // Only include slNo when editing (revision workflow uses it)
      if (form.slNo) payload.slNo = Number(form.slNo);
      updateMutation.mutate({ id: editing.id as string, payload });
    } else {
      // New budget head: slNo is auto-assigned by the backend
      createMutation.mutate(payload);
    }
  };

  const handleImport = () => {
    try {
      const parsed = JSON.parse(importText);
      if (!parsed.budget_items || !Array.isArray(parsed.budget_items)) {
        setError('JSON must have a "budget_items" array');
        return;
      }
      const items = parsed.budget_items.map((item: { sl_no: number; particulars: string; amount: number }) => ({
        sl_no: item.sl_no,
        particulars: item.particulars,
        amount: item.amount,
      }));
      importMutation.mutate(items);
    } catch {
      setError(tr('errJson'));
    }
  };

  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 25, total: 0, totalPages: 0 };
  const submitting = createMutation.isPending || updateMutation.isPending;

  // Deep-link from global search: ?id=<budgetHeadId> — filter and highlight
  const { highlightId, rowRef } = useDeepLinkRow<{ id: string; particulars: string }>('/budget-heads', rows, 'particulars', (v) => { setSearch(v); setPage(0); });

  // Shared table body — rendered either as the desktop/portrait card table
  // (ResponsiveTable) or inside the mobile-landscape Excel-style wrapper.
  const tableNode = (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ '@media (min-width: 900px)': { minWidth: 'max-content', '& .MuiTableCell-root': { whiteSpace: 'nowrap' } } }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>{tr('slNo')}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{tr('particulars')}</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="right">{tr('allocated')}</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="right">{tr('committed')}</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="right">{tr('utilized')}</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="right">{tr('available')}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{tr('utilization')}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{tr('status')}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('actions')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={9} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
          ) : isError ? (
            <TableRow><TableCell colSpan={9} align="center" sx={{ py: 4 }}>
              <Alert severity="error" sx={{ mb: 1 }}>{tr('errLoad')}</Alert>
              <Button size="small" onClick={() => refetch()} startIcon={<RefreshIcon />}>{tr('retry')}</Button>
            </TableCell></TableRow>
          ) : rows.length === 0 ? (
            <TableRow><TableCell colSpan={9} align="center" sx={{ py: 4 }}>
              <Typography color="text.secondary">{tr('none')}</Typography>
            </TableCell></TableRow>
          ) : (
            rows.map((row: Record<string, unknown>) => {
              const allocated = Number(row.allocatedAmount ?? 0);
              const committed = Number(row.committedAmount ?? 0);
              const actual = Number(row.actualAmount ?? 0);
              const available = allocated - committed - actual;
              const utilization = allocated > 0 ? (actual / allocated) * 100 : 0;
              return (
                <TableRow
                  key={row.id as string}
                  hover
                  ref={rowRef(row.id as string)}
                  sx={{ ...(highlightId === row.id && { bgcolor: 'warning.light', '&:hover': { bgcolor: 'warning.light' } }), cursor: 'pointer' }}
                  onClick={() => setUsageHeadId(row.id as string)}
                >
                  <TableCell data-label={tr('slNo')}>{String(row.slNo)}</TableCell>
                  <TableCell data-label={tr('particulars')}>{String(row.particulars ?? '—')}</TableCell>
                  <TableCell data-label={tr('allocated')} align="right">{formatCurrency(row.allocatedAmount)}</TableCell>
                  <TableCell data-label={tr('committed')} align="right">{formatCurrency(row.committedAmount)}</TableCell>
                  <TableCell data-label={tr('utilized')} align="right">{formatCurrency(row.actualAmount)}</TableCell>
                  <TableCell data-label={tr('available')} align="right" sx={{ fontWeight: 600, color: available < 0 ? 'error.main' : 'success.main' }}>
                    {formatCurrency(available)}
                  </TableCell>
                  <TableCell data-label={tr('utilization')} sx={{ minWidth: 100 }}>
                    <Stack spacing={0.5}>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(utilization, 100)}
                        color={utilization > 90 ? 'error' : utilization > 70 ? 'warning' : 'success'}
                        sx={{ height: 6, borderRadius: 3 }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {utilization.toFixed(1)}%
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell data-label={tr('status')}>
                    <Chip label={String(row.status ?? 'ACTIVE')} size="small" color={row.status === 'CLOSED' ? 'default' : 'success'} />
                  </TableCell>
                  <TableCell data-label={tr('actions')} align="right" onClick={(e) => e.stopPropagation()}>
                    <CommentsButton entityType="BUDGET_HEAD" entityId={row.id as string} entityLabel={String(row.particulars ?? '')} url="/budget-heads" />
                    <IconButton size="small" onClick={() => setUsageHeadId(row.id as string)} title={tr('usageDetails')}><VisibilityIcon fontSize="small" /></IconButton>
                    <IconButton size="small" onClick={() => openRevisionDialog(row)} title={tr('requestEdit')}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" onClick={() => { setHistoryHeadId(row.id as string); setHistoryOpen(true); }} title={tr('revisionHistory')}><HistoryIcon fontSize="small" /></IconButton>
                    <IconButton size="small" onClick={() => setDeleteConfirm(row.id as string)}><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );

  return (
    <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          {tr('title')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {isMobile && (
            <Button
              variant={isMobileLandscape ? 'contained' : 'outlined'}
              size="small"
              startIcon={<TableChartIcon />}
              onClick={toggleExcelView}
              title={tr('toggleTable')}
            >
              {isMobileLandscape ? tr('cardView') : tr('tableView')}
            </Button>
          )}
          <RefreshButton onClick={() => refetch()} />
          {pendingRevisions?.data?.length > 0 && (
            <Button
              variant="outlined"
              color="warning"
              startIcon={<HistoryIcon />}
              onClick={() => setPendingOpen(true)}
            >
              Pending Revisions ({pendingRevisions.data.length})
            </Button>
          )}
          <Button variant="outlined" startIcon={<UploadIcon />} onClick={() => setImportOpen(true)}>
            {tr('import')}
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            {tr('newBudgetHead')}
          </Button>
        </Box>
      </Box>

      {/* Summary cards — hidden in mobile landscape to maximize table space */}
      {summary && !isMobileLandscape && (() => {
        const actual = Number(summary.totalActual ?? 0);
        const paid = Number(summary.totalPaid ?? 0);
        const actualDiffersFromPaid = Math.abs(actual - paid) > 0.01;
        return (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: actualDiffersFromPaid ? '1fr 1fr 1fr 1fr 1fr' : '1fr 1fr 1fr 1fr' }, gap: 1, mb: 2 }}>
          {[
            {
              label: tr('allocated'),
              value: summary.totalAllocated,
              color: 'primary.main',
              hint: tr('hintAllocated'),
              short: tr('shortAllocated'),
            },
            {
              label: tr('committed'),
              value: summary.totalCommitted,
              color: 'info.main',
              hint: tr('hintCommitted'),
              short: tr('shortCommitted'),
            },
            ...(actualDiffersFromPaid ? [{
              label: tr('actual'),
              value: actual,
              color: 'warning.main',
              hint: tr('hintActual'),
              short: tr('shortActual'),
            }] : []),
            {
              label: 'Paid',
              value: paid,
              color: 'success.main',
              hint: actualDiffersFromPaid
                ? tr('hintPaid1')
                : tr('hintPaid2'),
              short: tr('shortPaid'),
            },
            {
              label: tr('available'),
              value: summary.totalUncommittedAvailable ?? summary.totalAvailable,
              color: 'secondary.main',
              hint: tr('hintAvail'),
              short: tr('shortAvail'),
            },
          ].map((card) => (
            <Card key={card.label} sx={{ p: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="caption" color="text.secondary">{card.label}</Typography>
                <Tooltip title={card.hint} arrow placement="bottom-start">
                  <InfoIcon sx={{ fontSize: 14, color: 'text.disabled', cursor: 'help' }} />
                </Tooltip>
              </Box>
              <Typography variant="h6" sx={{ color: card.color, fontSize: { xs: '0.9rem', sm: '1.1rem' } }}>
                {formatCurrency(card.value)}
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ display: 'block', fontSize: '0.7rem', lineHeight: 1.2, mt: 0.25 }}>
                {card.short}
              </Typography>
            </Card>
          ))}
        </Box>
        );
      })()}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {isMobilePortrait && !wantsTable && <PortraitRotateHint />}

      {/* Rotate instruction — shown when user tapped Table View but is still in portrait */}
      {showRotateHint ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" sx={{ mb: 2 }}>↻ Rotate your phone horizontally to view the table</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {tr('rotateBody')}
          </Typography>
          <Button variant="outlined" onClick={toggleExcelView}>{tr('backToCardView')}</Button>
        </Card>
      ) : (
      <Card sx={{ overflow: 'hidden' }}>
        {isMobileLandscape ? (
          <Box sx={{ p: 1 }}>
            <LandscapeExcelTable
              search={search}
              onSearchChange={(v) => { setSearch(v); setPage(0); }}
              searchPlaceholder={tr('search')}
            >
              {tableNode}
            </LandscapeExcelTable>
          </Box>
        ) : (
          <>
            <Box sx={{ p: 2 }}>
              <TextField
                size="small"
                placeholder={tr('search')}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
                sx={{ width: { xs: '100%', sm: 300 } }}
              />
            </Box>

            <ResponsiveTable>
              {tableNode}
            </ResponsiveTable>
          </>
        )}

        <TablePagination
          component="div"
          count={pagination.total}
          page={page}
          onPageChange={(_e, newPage) => setPage(newPage)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </Card>
      )}

      {/* Create/Edit dialog */}
      <ResponsiveDialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? tr('editHead') : 'New Budget Head'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {!editing && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                {tr('slAuto')}
              </Alert>
            )}
            {editing && (
              <TextField
                label={tr('slNo')}
                type="number"
                value={formatIndianNumber(form.slNo ?? '')}
                onChange={(e) => setForm({ ...form, slNo: e.target.value.replace(/,/g, '') })}
                required
                size="small"
              />
            )}
            <TextField
              label={tr('particulars')}
              value={form.particulars ?? ''}
              onChange={(e) => setForm({ ...form, particulars: e.target.value })}
              required
              size="small"
            />
            <TextField
              label={tr('allocatedAmount')}
              type="text"
              value={formatIndianNumber(form.allocatedAmount ?? '')}
              onChange={(e) => setForm({ ...form, allocatedAmount: e.target.value.replace(/,/g, '') })}
              required
              size="small"
              InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>{tr('cancel')}</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <CircularProgress size={20} /> : editing ? tr('update') : tr('create')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Import dialog */}
      <ResponsiveDialog open={importOpen} onClose={() => setImportOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{tr('importBudgetFromJson')}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {tr('importHint')} <code>{'{ "budget_items": [{ "sl_no": 1, "particulars": "...", "amount": 1000000 }] }'}</code>
          </Typography>
          <TextField
            multiline
            rows={12}
            fullWidth
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={tr('pasteJson')}
            size="small"
            sx={{ fontFamily: 'monospace' }}
          />
          <Alert severity="info" sx={{ mt: 1 }}>
            {tr('importNote')}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportOpen(false)}>{tr('cancel')}</Button>
          <Button variant="contained" onClick={handleImport} disabled={importMutation.isPending} startIcon={<UploadIcon />}>
            {importMutation.isPending ? <CircularProgress size={20} /> : 'Import'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Delete confirmation */}
      <ResponsiveDialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{tr('deleteBudgetHead')}</DialogTitle>
        <DialogContent>
          <Typography>{tr('deleteNote')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>{tr('cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)} disabled={deleteMutation.isPending}>
            {tr('delete')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* ── Request Revision Dialog ── */}
      <ResponsiveDialog open={revisionDialogOpen} onClose={() => setRevisionDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('requestBudgetHeadEdit')}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {revisionTarget && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {tr('requestingEditFor')} <strong>{String(revisionTarget.particulars)}</strong> (Sl. No. {String(revisionTarget.slNo)})
              <br />Current allocated: {formatCurrency(revisionTarget.allocatedAmount)}
              <br />{tr('reqNote')}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label={tr('newSlNo')}
              type="number"
              value={formatIndianNumber(revisionForm.newSlNo ?? '')}
              onChange={(e) => setRevisionForm({ ...revisionForm, newSlNo: e.target.value.replace(/,/g, '') })}
              size="small"
              helperText={tr('leave')}
            />
            <TextField
              label={tr('newParticulars')}
              value={revisionForm.newParticulars ?? ''}
              onChange={(e) => setRevisionForm({ ...revisionForm, newParticulars: e.target.value })}
              size="small"
            />
            <TextField
              label={tr('newAllocatedAmount')}
              type="text"
              value={formatIndianNumber(revisionForm.newAllocated ?? '')}
              onChange={(e) => setRevisionForm({ ...revisionForm, newAllocated: e.target.value.replace(/,/g, '') })}
              size="small"
              InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
            />
            <TextField
              select
              label={tr('newStatus')}
              value={String(revisionForm.newStatus ?? 'ACTIVE')}
              onChange={(e) => setRevisionForm({ ...revisionForm, newStatus: e.target.value })}
              size="small"
            >
              <MenuItem value="ACTIVE">{tr('st_active')}</MenuItem>
              <MenuItem value="CLOSED">{tr('st_closed')}</MenuItem>
            </TextField>
            <TextField
              label={tr('reasonLabel')}
              value={revisionForm.reason ?? ''}
              onChange={(e) => setRevisionForm({ ...revisionForm, reason: e.target.value })}
              size="small"
              multiline
              rows={2}
              required
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevisionDialogOpen(false)}>{tr('cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (!revisionTarget) return;
              if (!revisionForm.reason || String(revisionForm.reason).trim().length < 5) {
                setError(tr('errReason'));
                return;
              }
              const payload: Record<string, unknown> = {
                budgetHeadId: revisionTarget.id,
                reason: String(revisionForm.reason).trim(),
              };
              if (revisionForm.newSlNo !== '' && Number(revisionForm.newSlNo) !== Number(revisionTarget.slNo)) payload.newSlNo = Number(revisionForm.newSlNo);
              if (revisionForm.newParticulars && String(revisionForm.newParticulars) !== String(revisionTarget.particulars)) payload.newParticulars = String(revisionForm.newParticulars);
              if (revisionForm.newAllocated !== '' && Number(revisionForm.newAllocated) !== Number(revisionTarget.allocatedAmount)) payload.newAllocated = Number(revisionForm.newAllocated);
              if (revisionForm.newStatus && String(revisionForm.newStatus) !== String(revisionTarget.status)) payload.newStatus = String(revisionForm.newStatus);
              requestRevisionMutation.mutate(payload);
            }}
            disabled={requestRevisionMutation.isPending}
          >
            {requestRevisionMutation.isPending ? <CircularProgress size={20} /> : tr('submitReq')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* ── Revision History Dialog ── */}
      <ResponsiveDialog open={historyOpen} onClose={() => { setHistoryOpen(false); setHistoryHeadId(null); }} maxWidth="md" fullWidth>
        <DialogTitle>{tr('revisionHistory')}</DialogTitle>
        <DialogContent>
          {historyLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
          ) : (revisionHistory?.data ?? []).length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>{tr('noRevs')}</Typography>
          ) : (
            <ResponsiveTable>
            <TableContainer component={Card} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('date')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('requestedBy')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('changes')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('reason')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('status')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('reviewedBy')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(revisionHistory?.data ?? []).map((rev: Record<string, unknown>) => {
                    const changes: string[] = [];
                    if (rev.newSlNo !== null && rev.newSlNo !== undefined) changes.push(tr('chSl', { o: String(rev.oldSlNo), n: String(rev.newSlNo) }));
                    if (rev.newParticulars) changes.push(tr('chName', { o: String(rev.oldParticulars), n: String(rev.newParticulars) }));
                    if (rev.newAllocated !== null && rev.newAllocated !== undefined) changes.push(tr('chAlloc', { o: formatCurrency(Number(rev.oldAllocated)), n: formatCurrency(Number(rev.newAllocated)) }));
                    if (rev.newStatus) changes.push(tr('chStatus', { o: enumLabel(String(rev.oldStatus)), n: enumLabel(String(rev.newStatus)) }));
                    return (
                      <TableRow key={rev.id as string} hover>
                        <TableCell data-label={tr('date')}>{new Date(String(rev.requestedAt)).toLocaleDateString('en-IN')}</TableCell>
                        <TableCell data-label={tr('requestedBy')}>{String((rev.requestedByUser as Record<string, unknown>)?.name ?? '—')}</TableCell>
                        <TableCell data-label={tr('changes')} sx={{ fontSize: '0.75rem' }}>{changes.join(', ') || '—'}</TableCell>
                        <TableCell data-label={tr('reason')} sx={{ fontSize: '0.75rem' }}>{String(rev.reason ?? '—')}</TableCell>
                        <TableCell data-label={tr('status')}>
                          <Chip
                            label={String(rev.status)}
                            size="small"
                            color={rev.status === 'APPLIED' ? 'success' : rev.status === 'REJECTED' ? 'error' : rev.status === 'PENDING' ? 'warning' : 'default'}
                          />
                        </TableCell>
                        <TableCell data-label={tr('reviewedBy')}>{String((rev.reviewedByUser as Record<string, unknown>)?.name ?? '—')}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            </ResponsiveTable>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setHistoryOpen(false); setHistoryHeadId(null); }}>{tr('close')}</Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* ── Pending Revisions Review Dialog ── */}
      <ResponsiveDialog open={pendingOpen} onClose={() => setPendingOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Pending Budget Revisions ({pendingRevisions?.data?.length ?? 0})</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {(pendingRevisions?.data ?? []).length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>{tr('noPending')}</Typography>
          ) : (
            <ResponsiveTable>
            <TableContainer component={Card} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('budgetHead')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('requestedBy')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('changes')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('reason')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(pendingRevisions?.data ?? []).map((rev: Record<string, unknown>) => {
                    const changes: string[] = [];
                    if (rev.newSlNo !== null && rev.newSlNo !== undefined) changes.push(tr('chSl', { o: String(rev.oldSlNo), n: String(rev.newSlNo) }));
                    if (rev.newParticulars) changes.push(tr('chName2', { n: String(rev.newParticulars) }));
                    if (rev.newAllocated !== null && rev.newAllocated !== undefined) changes.push(tr('chAlloc2', { n: formatCurrency(Number(rev.newAllocated)) }));
                    if (rev.newStatus) changes.push(tr('chStatus2', { n: enumLabel(String(rev.newStatus)) }));
                    return (
                      <TableRow key={rev.id as string} hover>
                        <TableCell data-label={tr('budgetHead')}>{String((rev.budgetHead as Record<string, unknown>)?.particulars ?? '—')}</TableCell>
                        <TableCell data-label={tr('requestedBy')}>{String((rev.requestedByUser as Record<string, unknown>)?.name ?? '—')}</TableCell>
                        <TableCell data-label={tr('changes')} sx={{ fontSize: '0.75rem' }}>{changes.join(', ')}</TableCell>
                        <TableCell data-label={tr('reason')} sx={{ fontSize: '0.75rem' }}>{String(rev.reason ?? '—')}</TableCell>
                        <TableCell data-label={tr('actions')}>
                          {reviewTarget?.id === rev.id ? (
                            <Stack direction="row" spacing={1}>
                              <IconButton size="small" color="success" title={tr('approve')}
                                onClick={() => reviewRevisionMutation.mutate({ id: rev.id as string, approved: true, comments: reviewComments || undefined })}
                                disabled={reviewRevisionMutation.isPending}
                              ><CheckIcon fontSize="small" /></IconButton>
                              <IconButton size="small" color="error" title={tr('reject')}
                                onClick={() => reviewRevisionMutation.mutate({ id: rev.id as string, approved: false, comments: reviewComments || undefined })}
                                disabled={reviewRevisionMutation.isPending}
                              ><CloseIcon fontSize="small" /></IconButton>
                            </Stack>
                          ) : (
                            <Button size="small" variant="outlined" onClick={() => { setReviewTarget(rev); setReviewComments(''); }}>{tr('review')}</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            </ResponsiveTable>
          )}
          {reviewTarget && (
            <TextField
              label={tr('reviewCommentsOptional')}
              value={reviewComments}
              onChange={(e) => setReviewComments(e.target.value)}
              size="small"
              fullWidth
              multiline
              rows={2}
              sx={{ mt: 2 }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setPendingOpen(false); setReviewTarget(null); }}>{tr('close')}</Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* ── Usage Details Dialog (opens on row click) ── */}
      <ResponsiveDialog open={!!usageHeadId} onClose={() => setUsageHeadId(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          Budget Head Usage
          {usageData?.budgetHead && (
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 400, mt: 0.3 }}>
              {String(usageData.budgetHead.particulars)} (Sl. No. {String(rows.find((r: Record<string, unknown>) => r.id === usageHeadId)?.slNo ?? '')})
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          {usageLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
          ) : !usageData ? (
            <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>{tr('noData')}</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Summary cards — one consolidated tr('utilized') amount, matching the dashboard's single expenditure figure */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr 1fr' }, gap: 1 }}>
                {[
                  { label: tr('allocated'), value: Number(usageData.budgetHead.allocatedAmount), color: 'primary.main' },
                  { label: tr('committed'), value: Number(usageData.budgetHead.committedAmount), color: 'info.main' },
                  { label: tr('utilized'), value: Number(usageData.budgetHead.actualAmount), color: 'warning.main' },
                  { label: tr('remaining'), value: Number(usageData.budgetHead.available), color: Number(usageData.budgetHead.available) < 0 ? 'error.main' : 'success.main' },
                ].map((card) => (
                  <Card key={card.label} sx={{ p: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">{card.label}</Typography>
                    <Typography variant="h6" sx={{ color: card.color, fontSize: { xs: '0.85rem', sm: '1rem' } }}>
                      {formatCurrency(card.value)}
                    </Typography>
                  </Card>
                ))}
              </Box>

              {/* Utilization bar */}
              {Number(usageData.budgetHead.allocatedAmount) > 0 && (
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">{tr('utilization')}</Typography>
                    <Typography variant="caption" color="text.secondary" fontWeight={700}>
                      {((Number(usageData.budgetHead.actualAmount) / Number(usageData.budgetHead.allocatedAmount)) * 100).toFixed(1)}%
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min((Number(usageData.budgetHead.actualAmount) / Number(usageData.budgetHead.allocatedAmount)) * 100, 100)}
                    color={Number(usageData.budgetHead.actualAmount) / Number(usageData.budgetHead.allocatedAmount) > 0.9 ? 'error' : Number(usageData.budgetHead.actualAmount) / Number(usageData.budgetHead.allocatedAmount) > 0.7 ? 'warning' : 'success'}
                    sx={{ height: 8, borderRadius: 4 }}
                  />
                </Box>
              )}

              {/* Related expenditures table */}
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Related Expenditures ({usageData.transactions.length})</Typography>
                {usageData.transactions.length === 0 ? (
                  <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    {tr('noTxn')}
                  </Typography>
                ) : (
                  <ResponsiveTable>
                    <TableContainer component={Card} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600 }}>{tr('date')}</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>{tr('type')}</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>{tr('reference')}</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>{tr('description')}</TableCell>
                            <TableCell sx={{ fontWeight: 600 }} align="right">{tr('committed')}</TableCell>
                            <TableCell sx={{ fontWeight: 600 }} align="right">{tr('actual')}</TableCell>
                            <TableCell sx={{ fontWeight: 600 }} align="right">{tr('paid')}</TableCell>
                            <TableCell sx={{ fontWeight: 600 }} align="right">{tr('received')}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {usageData.transactions.map((txn: Record<string, unknown>, idx: number) => (
                            <TableRow key={idx} hover>
                              <TableCell data-label={tr('date')}>{formatDate(String(txn.date))}</TableCell>
                              <TableCell data-label={tr('type')}>{String(txn.type)}</TableCell>
                              <TableCell data-label={tr('reference')}>{String(txn.reference)}</TableCell>
                              <TableCell data-label={tr('description')} sx={{ fontSize: '0.75rem' }}>
                                {/* Wrap, never sideways-scroll: 2 lines on desktop, 3 on phone. */}
                                <Box
                                  component="span"
                                  sx={{
                                    display: '-webkit-box',
                                    WebkitBoxOrient: 'vertical',
                                    WebkitLineClamp: { xs: 3, sm: 2 },
                                    overflow: 'hidden',
                                    wordBreak: 'break-word',
                                    whiteSpace: 'normal',
                                    maxWidth: { sm: 240 },
                                  }}
                                >
                                  {String(txn.description)}
                                </Box>
                              </TableCell>
                              <TableCell data-label={tr('committed')} align="right">{Number(txn.committed) !== 0 ? formatCurrency(Number(txn.committed)) : '—'}</TableCell>
                              <TableCell data-label={tr('actual')} align="right">{Number(txn.actual) !== 0 ? formatCurrency(Number(txn.actual)) : '—'}</TableCell>
                              <TableCell data-label={tr('paid')} align="right">{Number(txn.paid) !== 0 ? formatCurrency(Number(txn.paid)) : '—'}</TableCell>
                              <TableCell data-label={tr('received')} align="right">{Number(txn.allocated) !== 0 ? formatCurrency(Number(txn.allocated)) : '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </ResponsiveTable>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUsageHeadId(null)}>{tr('close')}</Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
