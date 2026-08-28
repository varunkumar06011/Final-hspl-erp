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
} from '@mui/material';
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
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from '../components/ResponsiveDialog';
import { formatCurrency, formatIndianNumber } from '../utils/enumOptions';

export default function BudgetHeadsPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
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
  const queryClient = useQueryClient();

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

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await api.post('/budget-heads', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/budget-heads'] });
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
      setError('Particulars is required');
      return;
    }
    if (!form.allocatedAmount || Number(form.allocatedAmount) <= 0) {
      setError('Allocated amount must be greater than 0');
      return;
    }
    if (!form.slNo || Number(form.slNo) < 1) {
      setError('Sl. No. must be at least 1');
      return;
    }
    setError('');
    const payload = {
      slNo: Number(form.slNo),
      particulars: String(form.particulars).trim(),
      allocatedAmount: Number(form.allocatedAmount),
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id as string, payload });
    } else {
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
      setError('Invalid JSON format');
    }
  };

  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 25, total: 0, totalPages: 0 };
  const submitting = createMutation.isPending || updateMutation.isPending;

  return (
    <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          Budget Heads
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <IconButton onClick={() => refetch()} size="small">
            <RefreshIcon />
          </IconButton>
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
            Import
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            New Budget Head
          </Button>
        </Box>
      </Box>

      {/* Summary cards */}
      {summary && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr 1fr 1fr' }, gap: 1, mb: 2 }}>
          {[
            { label: 'Allocated', value: summary.totalAllocated, color: 'primary.main' },
            { label: 'Committed', value: summary.totalCommitted, color: 'info.main' },
            { label: 'Actual', value: summary.totalActual, color: 'warning.main' },
            { label: 'Paid', value: summary.totalPaid, color: 'success.main' },
            { label: 'Available', value: summary.totalAvailable, color: 'secondary.main' },
          ].map((card) => (
            <Card key={card.label} sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">{card.label}</Typography>
              <Typography variant="h6" sx={{ color: card.color, fontSize: { xs: '0.9rem', sm: '1.1rem' } }}>
                {formatCurrency(card.value)}
              </Typography>
            </Card>
          ))}
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <Card sx={{ overflow: 'hidden' }}>
        <Box sx={{ p: 2 }}>
          <TextField
            size="small"
            placeholder="Search budget heads..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />
        </Box>

        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ '@media (min-width: 900px)': { minWidth: 'max-content', '& .MuiTableCell-root': { whiteSpace: 'nowrap' } } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Sl. No.</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Particulars</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Allocated</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Committed</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Actual</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Paid</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Available</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Utilization</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : isError ? (
                <TableRow><TableCell colSpan={10} align="center" sx={{ py: 4 }}>
                  <Alert severity="error" sx={{ mb: 1 }}>Failed to load data.</Alert>
                  <Button size="small" onClick={() => refetch()} startIcon={<RefreshIcon />}>Retry</Button>
                </TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={10} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">No budget heads found. Click "Import" to load from your draft budget JSON.</Typography>
                </TableCell></TableRow>
              ) : (
                rows.map((row: Record<string, unknown>) => {
                  const allocated = Number(row.allocatedAmount ?? 0);
                  const actual = Number(row.actualAmount ?? 0);
                  const available = allocated - actual;
                  const utilization = allocated > 0 ? (actual / allocated) * 100 : 0;
                  return (
                    <TableRow key={row.id as string} hover>
                      <TableCell>{String(row.slNo)}</TableCell>
                      <TableCell>{String(row.particulars ?? '—')}</TableCell>
                      <TableCell align="right">{formatCurrency(row.allocatedAmount)}</TableCell>
                      <TableCell align="right">{formatCurrency(row.committedAmount)}</TableCell>
                      <TableCell align="right">{formatCurrency(row.actualAmount)}</TableCell>
                      <TableCell align="right">{formatCurrency(row.paidAmount)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: available < 0 ? 'error.main' : 'success.main' }}>
                        {formatCurrency(available)}
                      </TableCell>
                      <TableCell sx={{ minWidth: 100 }}>
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
                      <TableCell>
                        <Chip label={String(row.status ?? 'ACTIVE')} size="small" color={row.status === 'CLOSED' ? 'default' : 'success'} />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => openRevisionDialog(row)} title="Request Edit"><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" onClick={() => { setHistoryHeadId(row.id as string); setHistoryOpen(true); }} title="Revision History"><HistoryIcon fontSize="small" /></IconButton>
                        <IconButton size="small" onClick={() => setDeleteConfirm(row.id as string)}><DeleteIcon fontSize="small" /></IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

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

      {/* Create/Edit dialog */}
      <ResponsiveDialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Budget Head' : 'New Budget Head'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Sl. No."
              type="number"
              value={formatIndianNumber(form.slNo ?? '')}
              onChange={(e) => setForm({ ...form, slNo: e.target.value.replace(/,/g, '') })}
              required
              size="small"
            />
            <TextField
              label="Particulars"
              value={form.particulars ?? ''}
              onChange={(e) => setForm({ ...form, particulars: e.target.value })}
              required
              size="small"
            />
            <TextField
              label="Allocated Amount"
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
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <CircularProgress size={20} /> : editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Import dialog */}
      <ResponsiveDialog open={importOpen} onClose={() => setImportOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Import Budget from JSON</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Paste your draft budget JSON here. Expected format: <code>{'{ "budget_items": [{ "sl_no": 1, "particulars": "...", "amount": 1000000 }] }'}</code>
          </Typography>
          <TextField
            multiline
            rows={12}
            fullWidth
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='Paste JSON here...'
            size="small"
            sx={{ fontFamily: 'monospace' }}
          />
          <Alert severity="warning" sx={{ mt: 1 }}>
            This will replace all existing budget heads for this project.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleImport} disabled={importMutation.isPending} startIcon={<UploadIcon />}>
            {importMutation.isPending ? <CircularProgress size={20} /> : 'Import'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Delete confirmation */}
      <ResponsiveDialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Budget Head?</DialogTitle>
        <DialogContent>
          <Typography>This will soft-delete the budget head. This action can be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)} disabled={deleteMutation.isPending}>
            Delete
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* ── Request Revision Dialog ── */}
      <ResponsiveDialog open={revisionDialogOpen} onClose={() => setRevisionDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Request Budget Head Edit</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {revisionTarget && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Requesting edit for: <strong>{String(revisionTarget.particulars)}</strong> (Sl. No. {String(revisionTarget.slNo)})
              <br />Current allocated: {formatCurrency(revisionTarget.allocatedAmount)}
              <br />This request will be sent to Admin for approval before changes are applied.
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="New Sl. No."
              type="number"
              value={formatIndianNumber(revisionForm.newSlNo ?? '')}
              onChange={(e) => setRevisionForm({ ...revisionForm, newSlNo: e.target.value.replace(/,/g, '') })}
              size="small"
              helperText="Leave unchanged if not modifying"
            />
            <TextField
              label="New Particulars"
              value={revisionForm.newParticulars ?? ''}
              onChange={(e) => setRevisionForm({ ...revisionForm, newParticulars: e.target.value })}
              size="small"
            />
            <TextField
              label="New Allocated Amount"
              type="text"
              value={formatIndianNumber(revisionForm.newAllocated ?? '')}
              onChange={(e) => setRevisionForm({ ...revisionForm, newAllocated: e.target.value.replace(/,/g, '') })}
              size="small"
              InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
            />
            <TextField
              select
              label="New Status"
              value={String(revisionForm.newStatus ?? 'ACTIVE')}
              onChange={(e) => setRevisionForm({ ...revisionForm, newStatus: e.target.value })}
              size="small"
            >
              <MenuItem value="ACTIVE">ACTIVE</MenuItem>
              <MenuItem value="CLOSED">CLOSED</MenuItem>
            </TextField>
            <TextField
              label="Reason for Edit (required, min 5 chars)"
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
          <Button onClick={() => setRevisionDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (!revisionTarget) return;
              if (!revisionForm.reason || String(revisionForm.reason).trim().length < 5) {
                setError('Reason must be at least 5 characters');
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
            {requestRevisionMutation.isPending ? <CircularProgress size={20} /> : 'Submit Request'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* ── Revision History Dialog ── */}
      <ResponsiveDialog open={historyOpen} onClose={() => { setHistoryOpen(false); setHistoryHeadId(null); }} maxWidth="md" fullWidth>
        <DialogTitle>Revision History</DialogTitle>
        <DialogContent>
          {historyLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
          ) : (revisionHistory?.data ?? []).length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>No revisions recorded for this budget head.</Typography>
          ) : (
            <TableContainer component={Card} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Requested By</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Changes</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Reason</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Reviewed By</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(revisionHistory?.data ?? []).map((rev: Record<string, unknown>) => {
                    const changes: string[] = [];
                    if (rev.newSlNo !== null && rev.newSlNo !== undefined) changes.push(`Sl: ${String(rev.oldSlNo)} → ${String(rev.newSlNo)}`);
                    if (rev.newParticulars) changes.push(`Name: "${String(rev.oldParticulars)}" → "${String(rev.newParticulars)}"`);
                    if (rev.newAllocated !== null && rev.newAllocated !== undefined) changes.push(`Allocated: ${formatCurrency(Number(rev.oldAllocated))} → ${formatCurrency(Number(rev.newAllocated))}`);
                    if (rev.newStatus) changes.push(`Status: ${String(rev.oldStatus)} → ${String(rev.newStatus)}`);
                    return (
                      <TableRow key={rev.id as string} hover>
                        <TableCell>{new Date(String(rev.requestedAt)).toLocaleDateString('en-IN')}</TableCell>
                        <TableCell>{String((rev.requestedByUser as Record<string, unknown>)?.name ?? '—')}</TableCell>
                        <TableCell sx={{ fontSize: '0.75rem' }}>{changes.join(', ') || '—'}</TableCell>
                        <TableCell sx={{ fontSize: '0.75rem' }}>{String(rev.reason ?? '—')}</TableCell>
                        <TableCell>
                          <Chip
                            label={String(rev.status)}
                            size="small"
                            color={rev.status === 'APPLIED' ? 'success' : rev.status === 'REJECTED' ? 'error' : rev.status === 'PENDING' ? 'warning' : 'default'}
                          />
                        </TableCell>
                        <TableCell>{String((rev.reviewedByUser as Record<string, unknown>)?.name ?? '—')}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setHistoryOpen(false); setHistoryHeadId(null); }}>Close</Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* ── Pending Revisions Review Dialog ── */}
      <ResponsiveDialog open={pendingOpen} onClose={() => setPendingOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Pending Budget Revisions ({pendingRevisions?.data?.length ?? 0})</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {(pendingRevisions?.data ?? []).length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>No pending revisions.</Typography>
          ) : (
            <TableContainer component={Card} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Budget Head</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Requested By</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Changes</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Reason</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(pendingRevisions?.data ?? []).map((rev: Record<string, unknown>) => {
                    const changes: string[] = [];
                    if (rev.newSlNo !== null && rev.newSlNo !== undefined) changes.push(`Sl: ${String(rev.oldSlNo)} → ${String(rev.newSlNo)}`);
                    if (rev.newParticulars) changes.push(`Name → "${String(rev.newParticulars)}"`);
                    if (rev.newAllocated !== null && rev.newAllocated !== undefined) changes.push(`Allocated → ${formatCurrency(Number(rev.newAllocated))}`);
                    if (rev.newStatus) changes.push(`Status → ${String(rev.newStatus)}`);
                    return (
                      <TableRow key={rev.id as string} hover>
                        <TableCell>{String((rev.budgetHead as Record<string, unknown>)?.particulars ?? '—')}</TableCell>
                        <TableCell>{String((rev.requestedByUser as Record<string, unknown>)?.name ?? '—')}</TableCell>
                        <TableCell sx={{ fontSize: '0.75rem' }}>{changes.join(', ')}</TableCell>
                        <TableCell sx={{ fontSize: '0.75rem' }}>{String(rev.reason ?? '—')}</TableCell>
                        <TableCell>
                          {reviewTarget?.id === rev.id ? (
                            <Stack direction="row" spacing={1}>
                              <IconButton size="small" color="success" title="Approve"
                                onClick={() => reviewRevisionMutation.mutate({ id: rev.id as string, approved: true, comments: reviewComments || undefined })}
                                disabled={reviewRevisionMutation.isPending}
                              ><CheckIcon fontSize="small" /></IconButton>
                              <IconButton size="small" color="error" title="Reject"
                                onClick={() => reviewRevisionMutation.mutate({ id: rev.id as string, approved: false, comments: reviewComments || undefined })}
                                disabled={reviewRevisionMutation.isPending}
                              ><CloseIcon fontSize="small" /></IconButton>
                            </Stack>
                          ) : (
                            <Button size="small" variant="outlined" onClick={() => { setReviewTarget(rev); setReviewComments(''); }}>Review</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {reviewTarget && (
            <TextField
              label="Review Comments (optional)"
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
          <Button onClick={() => { setPendingOpen(false); setReviewTarget(null); }}>Close</Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
