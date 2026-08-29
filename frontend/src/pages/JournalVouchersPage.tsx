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
  MenuItem,
  Stack,
  Divider,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Send as SubmitIcon,
  Check as ApproveIcon,
  Close as RejectIcon,
  Publish as PostIcon,
  Cancel as CancelIcon,
  Visibility as ViewIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from '../components/ResponsiveDialog';
import RefreshButton from '../components/RefreshButton';
import { formatCurrency, formatIndianNumber, formatDate } from '../utils/enumOptions';

interface JournalEntry {
  id: string;
  accountType: string;
  accountId: string | null;
  budgetHeadId: string | null;
  ownerAccountId: string | null;
  debit: number;
  credit: number;
  description: string | null;
  budgetHead: { id: string; particulars: string } | null;
  ownerAccount: { id: string; ownerName: string } | null;
}

interface JournalVoucher {
  id: string;
  jvNumber: string;
  date: string;
  description: string | null;
  type: string;
  status: string;
  totalDebit: number;
  totalCredit: number;
  postedAt: string | null;
  createdAt: string;
  createdByUser: { id: string; name: string };
  postedByUser: { id: string; name: string } | null;
  entries: JournalEntry[];
  approvalWorkflow: {
    id: string;
    status: string;
    steps: Array<{
      id: string;
      stepNumber: number;
      approverRole: string;
      status: string;
      comments: string | null;
      approverUser: { id: string; name: string; role: string } | null;
    }>;
  } | null;
}

interface BankAccount { id: string; accountName: string; }
interface CashAccount { id: string; name: string; }
interface BudgetHead { id: string; particulars: string; }
interface OwnerAccount { id: string; ownerName: string; }

const JV_TYPE_LABELS: Record<string, string> = {
  OWNER_EXPENSE: 'Owner Expense',
  OWNER_REPAYMENT: 'Owner Repayment',
  INTER_ACCOUNT: 'Inter-Account',
  ADJUSTMENT: 'Adjustment',
};

const JV_STATUS_COLORS: Record<string, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  DRAFT: 'default',
  PENDING_APPROVAL: 'info',
  APPROVED: 'warning',
  POSTED: 'success',
  REJECTED: 'error',
  CANCELLED: 'default',
};

const ACCOUNT_TYPES = [
  { value: 'BANK', label: 'Bank' },
  { value: 'CASH', label: 'Cash' },
  { value: 'OWNER', label: 'Owner' },
  { value: 'BUDGET_HEAD', label: 'Budget Head' },
];

interface EntryForm {
  accountType: string;
  accountId: string;
  budgetHeadId: string;
  ownerAccountId: string;
  debit: string;
  credit: string;
  description: string;
}

export default function JournalVouchersPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [jvType, setJvType] = useState('OWNER_EXPENSE');
  const [jvDate, setJvDate] = useState('');
  const [jvDescription, setJvDescription] = useState('');
  const [entries, setEntries] = useState<EntryForm[]>([]);

  // Detail dialog
  const [detailJv, setDetailJv] = useState<JournalVoucher | null>(null);

  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['/journal-vouchers', page, pageSize, search, statusFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const response = await api.get('/journal-vouchers', { params });
      return response.data;
    },
  });

  // Fetch accounts for entry selection
  const { data: bankAccountsData } = useQuery({
    queryKey: ['/bank-accounts', 'all'],
    queryFn: async () => {
      const response = await api.get('/bank-accounts', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
  });
  const { data: cashAccountsData } = useQuery({
    queryKey: ['/cash-accounts', 'all'],
    queryFn: async () => {
      const response = await api.get('/cash-accounts', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
  });
  const { data: budgetHeadsData } = useQuery({
    queryKey: ['/budget-heads', 'all'],
    queryFn: async () => {
      const response = await api.get('/budget-heads', { params: { page: 1, pageSize: 200 } });
      return response.data;
    },
  });
  const { data: ownerAccountsData } = useQuery({
    queryKey: ['/owner-accounts', 'all'],
    queryFn: async () => {
      const response = await api.get('/owner-accounts', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await api.post('/journal-vouchers', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/journal-vouchers'] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const submitMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/journal-vouchers/${id}/submit`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/journal-vouchers'] });
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, comments }: { id: string; comments?: string }) => {
      const response = await api.post(`/journal-vouchers/${id}/approve`, { comments });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/journal-vouchers'] });
      setDetailJv(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const response = await api.post(`/journal-vouchers/${id}/reject`, { reason });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/journal-vouchers'] });
      setDetailJv(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const postMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/journal-vouchers/${id}/post`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/journal-vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['/bank-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/cash-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/owner-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/budget-heads'] });
      setDetailJv(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/journal-vouchers/${id}/cancel`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/journal-vouchers'] });
      setDetailJv(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const resetForm = () => {
    setJvType('OWNER_EXPENSE');
    setJvDate('');
    setJvDescription('');
    setEntries([
      { accountType: 'BANK', accountId: '', budgetHeadId: '', ownerAccountId: '', debit: '', credit: '', description: '' },
      { accountType: 'BUDGET_HEAD', accountId: '', budgetHeadId: '', ownerAccountId: '', debit: '', credit: '', description: '' },
    ]);
    setError('');
  };

  const openCreate = () => {
    resetForm();
    setCreateOpen(true);
  };

  const addEntry = () => {
    setEntries([...entries, { accountType: 'BANK', accountId: '', budgetHeadId: '', ownerAccountId: '', debit: '', credit: '', description: '' }]);
  };

  const removeEntry = (index: number) => {
    if (entries.length <= 2) return;
    setEntries(entries.filter((_, i) => i !== index));
  };

  const updateEntry = (index: number, field: keyof EntryForm, value: string) => {
    const updated = [...entries];
    updated[index] = { ...updated[index], [field]: value };
    // If debit is set, clear credit and vice versa
    if (field === 'debit' && value) updated[index].credit = '';
    if (field === 'credit' && value) updated[index].debit = '';
    setEntries(updated);
  };

  const totalDebit = entries.reduce((sum, e) => sum + (Number(e.debit) || 0), 0);
  const totalCredit = entries.reduce((sum, e) => sum + (Number(e.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const handleCreate = () => {
    if (!isBalanced) {
      setError(`Total debit (${formatIndianNumber(totalDebit)}) must equal total credit (${formatIndianNumber(totalCredit)}) and be > 0`);
      return;
    }
    // Validate account selections
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if ((e.accountType === 'BANK' || e.accountType === 'CASH') && !e.accountId) {
        setError(`Entry ${i + 1}: Select an account for ${e.accountType} type`);
        return;
      }
      if (e.accountType === 'BUDGET_HEAD' && !e.budgetHeadId) {
        setError(`Entry ${i + 1}: Select a budget head`);
        return;
      }
      if (e.accountType === 'OWNER' && !e.ownerAccountId) {
        setError(`Entry ${i + 1}: Select an owner account`);
        return;
      }
    }
    setError('');
    const payload = {
      type: jvType,
      date: jvDate || undefined,
      description: jvDescription || undefined,
      entries: entries.map((e) => ({
        accountType: e.accountType,
        accountId: e.accountType === 'BANK' || e.accountType === 'CASH' ? e.accountId : undefined,
        budgetHeadId: e.accountType === 'BUDGET_HEAD' ? e.budgetHeadId : undefined,
        ownerAccountId: e.accountType === 'OWNER' ? e.ownerAccountId : undefined,
        debit: Number(e.debit) || 0,
        credit: Number(e.credit) || 0,
        description: e.description || undefined,
      })),
    };
    createMutation.mutate(payload);
  };

  const rows: JournalVoucher[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const bankAccounts: BankAccount[] = bankAccountsData?.data ?? [];
  const cashAccounts: CashAccount[] = cashAccountsData?.data ?? [];
  const budgetHeads: BudgetHead[] = budgetHeadsData?.data ?? [];
  const ownerAccounts: OwnerAccount[] = ownerAccountsData?.data ?? [];

  const renderEntryAccountSelector = (entry: EntryForm, index: number) => {
    switch (entry.accountType) {
      case 'BANK':
        return (
          <TextField select size="small" label="Bank Account" value={entry.accountId} onChange={(e) => updateEntry(index, 'accountId', e.target.value)} sx={{ minWidth: 180 }}>
            {bankAccounts.map((a) => <MenuItem key={a.id} value={a.id}>{a.accountName}</MenuItem>)}
          </TextField>
        );
      case 'CASH':
        return (
          <TextField select size="small" label="Cash Account" value={entry.accountId} onChange={(e) => updateEntry(index, 'accountId', e.target.value)} sx={{ minWidth: 180 }}>
            {cashAccounts.map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
          </TextField>
        );
      case 'BUDGET_HEAD':
        return (
          <TextField select size="small" label="Budget Head" value={entry.budgetHeadId} onChange={(e) => updateEntry(index, 'budgetHeadId', e.target.value)} sx={{ minWidth: 180 }}>
            {budgetHeads.map((h) => <MenuItem key={h.id} value={h.id}>{h.particulars}</MenuItem>)}
          </TextField>
        );
      case 'OWNER':
        return (
          <TextField select size="small" label="Owner Account" value={entry.ownerAccountId} onChange={(e) => updateEntry(index, 'ownerAccountId', e.target.value)} sx={{ minWidth: 180 }}>
            {ownerAccounts.map((o) => <MenuItem key={o.id} value={o.id}>{o.ownerName}</MenuItem>)}
          </TextField>
        );
      default:
        return null;
    }
  };

  return (
    <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          Journal Vouchers
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <RefreshButton onClick={() => refetch()} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New JV</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Card sx={{ overflow: 'hidden' }}>
        <Box sx={{ p: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="Search by JV number..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
            sx={{ width: { xs: '100%', sm: 250 } }}
          />
          <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} sx={{ width: 180 }}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="DRAFT">Draft</MenuItem>
            <MenuItem value="PENDING_APPROVAL">Pending Approval</MenuItem>
            <MenuItem value="APPROVED">Approved</MenuItem>
            <MenuItem value="POSTED">Posted</MenuItem>
            <MenuItem value="REJECTED">Rejected</MenuItem>
            <MenuItem value="CANCELLED">Cancelled</MenuItem>
          </TextField>
        </Box>

        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ '@media (min-width: 900px)': { minWidth: 'max-content', '& .MuiTableCell-root': { whiteSpace: 'nowrap' } } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>JV Number</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Amount</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created By</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : isError ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <Alert severity="error" sx={{ mb: 1 }}>Failed to load data.</Alert>
                  <Button size="small" onClick={() => refetch()} startIcon={<RefreshIcon />}>Retry</Button>
                </TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">No journal vouchers found. Click "New JV" to create one.</Typography>
                </TableCell></TableRow>
              ) : (
                rows.map((jv) => (
                  <TableRow key={jv.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{jv.jvNumber}</TableCell>
                    <TableCell>{formatDate(jv.date)}</TableCell>
                    <TableCell><Chip label={JV_TYPE_LABELS[jv.type] ?? jv.type} size="small" variant="outlined" /></TableCell>
                    <TableCell align="right">{formatCurrency(jv.totalDebit)}</TableCell>
                    <TableCell><Chip label={jv.status.replace(/_/g, ' ')} size="small" color={JV_STATUS_COLORS[jv.status] ?? 'default'} /></TableCell>
                    <TableCell>{jv.createdByUser?.name ?? '—'}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="View Details"><IconButton size="small" onClick={() => setDetailJv(jv)}><ViewIcon fontSize="small" /></IconButton></Tooltip>
                        {jv.status === 'DRAFT' && (
                          <Tooltip title="Submit for Approval"><IconButton size="small" onClick={() => submitMutation.mutate(jv.id)}><SubmitIcon fontSize="small" color="info" /></IconButton></Tooltip>
                        )}
                        {jv.status === 'APPROVED' && (
                          <Tooltip title="Post JV"><IconButton size="small" onClick={() => postMutation.mutate(jv.id)}><PostIcon fontSize="small" color="success" /></IconButton></Tooltip>
                        )}
                        {['DRAFT', 'PENDING_APPROVAL', 'REJECTED'].includes(jv.status) && (
                          <Tooltip title="Cancel"><IconButton size="small" onClick={() => cancelMutation.mutate(jv.id)}><CancelIcon fontSize="small" /></IconButton></Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))
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
          rowsPerPageOptions={[10, 20, 50, 100]}
        />
      </Card>

      {/* Create JV dialog */}
      <ResponsiveDialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>New Journal Voucher</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', gap: 2, mb: 2, mt: 1, flexWrap: 'wrap' }}>
            <TextField select size="small" label="JV Type" value={jvType} onChange={(e) => setJvType(e.target.value)} sx={{ minWidth: 200 }}>
              {Object.entries(JV_TYPE_LABELS).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
            </TextField>
            <TextField size="small" type="date" label="Date" value={jvDate} onChange={(e) => setJvDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" label="Description" value={jvDescription} onChange={(e) => setJvDescription(e.target.value)} sx={{ minWidth: 300 }} />
          </Box>

          <Typography variant="subtitle2" sx={{ mb: 1 }}>Journal Entries (Debit must equal Credit)</Typography>
          <TableContainer component={Card} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Account Type</TableCell>
                  <TableCell>Account</TableCell>
                  <TableCell align="right">Debit</TableCell>
                  <TableCell align="right">Credit</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((entry, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <TextField select size="small" value={entry.accountType} onChange={(e) => updateEntry(index, 'accountType', e.target.value)} sx={{ minWidth: 130 }}>
                        {ACCOUNT_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                      </TextField>
                    </TableCell>
                    <TableCell>{renderEntryAccountSelector(entry, index)}</TableCell>
                    <TableCell align="right">
                      <TextField
                        size="small"
                        value={formatIndianNumber(entry.debit)}
                        onChange={(e) => updateEntry(index, 'debit', e.target.value.replace(/,/g, ''))}
                        sx={{ width: 120 }}
                        InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        size="small"
                        value={formatIndianNumber(entry.credit)}
                        onChange={(e) => updateEntry(index, 'credit', e.target.value.replace(/,/g, ''))}
                        sx={{ width: 120 }}
                        InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField size="small" value={entry.description} onChange={(e) => updateEntry(index, 'description', e.target.value)} sx={{ minWidth: 150 }} />
                    </TableCell>
                    <TableCell>
                      {entries.length > 2 && <IconButton size="small" onClick={() => removeEntry(index)}><DeleteIcon fontSize="small" /></IconButton>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
            <Button size="small" startIcon={<AddIcon />} onClick={addEntry}>Add Entry</Button>
            <Stack direction="row" spacing={2}>
              <Typography variant="body2">Total Debit: <Box component="strong" sx={{ color: isBalanced ? 'success.main' : 'error.main' }}>{formatCurrency(totalDebit)}</Box></Typography>
              <Typography variant="body2">Total Credit: <Box component="strong" sx={{ color: isBalanced ? 'success.main' : 'error.main' }}>{formatCurrency(totalCredit)}</Box></Typography>
              <Chip label={isBalanced ? 'Balanced' : 'Unbalanced'} size="small" color={isBalanced ? 'success' : 'error'} />
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={createMutation.isPending || !isBalanced}>
            {createMutation.isPending ? <CircularProgress size={20} /> : 'Create JV (Draft)'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* JV Detail dialog */}
      <ResponsiveDialog open={!!detailJv} onClose={() => setDetailJv(null)} maxWidth="md" fullWidth>
        {detailJv && (
          <>
            <DialogTitle>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="h6">{detailJv.jvNumber}</Typography>
                <Chip label={detailJv.status.replace(/_/g, ' ')} color={JV_STATUS_COLORS[detailJv.status] ?? 'default'} />
              </Stack>
            </DialogTitle>
            <DialogContent>
              {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
              <Stack spacing={2}>
                <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  <Typography variant="body2"><strong>Type:</strong> {JV_TYPE_LABELS[detailJv.type] ?? detailJv.type}</Typography>
                  <Typography variant="body2"><strong>Date:</strong> {formatDate(detailJv.date)}</Typography>
                  <Typography variant="body2"><strong>Created By:</strong> {detailJv.createdByUser?.name}</Typography>
                  {detailJv.postedAt && <Typography variant="body2"><strong>Posted At:</strong> {formatDate(detailJv.postedAt)}</Typography>}
                </Box>
                {detailJv.description && <Typography variant="body2"><strong>Description:</strong> {detailJv.description}</Typography>}

                <Divider />
                <Typography variant="subtitle2">Journal Entries</Typography>
                <TableContainer component={Card} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Account Type</TableCell>
                        <TableCell>Account</TableCell>
                        <TableCell align="right">Debit</TableCell>
                        <TableCell align="right">Credit</TableCell>
                        <TableCell>Description</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detailJv.entries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell><Chip label={entry.accountType} size="small" variant="outlined" /></TableCell>
                          <TableCell>
                            {entry.budgetHead?.particulars ?? entry.ownerAccount?.ownerName ?? '—'}
                          </TableCell>
                          <TableCell align="right" sx={{ color: 'error.main' }}>{Number(entry.debit) > 0 ? formatCurrency(entry.debit) : '—'}</TableCell>
                          <TableCell align="right" sx={{ color: 'success.main' }}>{Number(entry.credit) > 0 ? formatCurrency(entry.credit) : '—'}</TableCell>
                          <TableCell>{entry.description ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell colSpan={2} align="right" sx={{ fontWeight: 600 }}>Total</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(detailJv.totalDebit)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(detailJv.totalCredit)}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>

                {detailJv.approvalWorkflow && (
                  <>
                    <Divider />
                    <Typography variant="subtitle2">Approval Workflow</Typography>
                    <Stack spacing={1}>
                      {detailJv.approvalWorkflow.steps.map((step) => (
                        <Box key={step.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip
                            label={step.status}
                            size="small"
                            color={step.status === 'APPROVED' ? 'success' : step.status === 'REJECTED' ? 'error' : 'default'}
                          />
                          <Typography variant="body2">
                            Step {step.stepNumber}: {step.approverRole.replace(/_/g, ' ')}
                            {step.approverUser && ` — ${step.approverUser.name}`}
                            {step.comments && ` (${step.comments})`}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  </>
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDetailJv(null)}>Close</Button>
              {detailJv.status === 'PENDING_APPROVAL' && (
                <>
                  <Button
                    color="error"
                    variant="outlined"
                    startIcon={<RejectIcon />}
                    onClick={() => {
                      const reason = prompt('Reason for rejection:');
                      if (reason) rejectMutation.mutate({ id: detailJv.id, reason });
                    }}
                    disabled={rejectMutation.isPending}
                  >
                    Reject
                  </Button>
                  <Button
                    color="success"
                    variant="contained"
                    startIcon={<ApproveIcon />}
                    onClick={() => approveMutation.mutate({ id: detailJv.id })}
                    disabled={approveMutation.isPending}
                  >
                    Approve
                  </Button>
                </>
              )}
              {detailJv.status === 'APPROVED' && (
                <Button color="success" variant="contained" startIcon={<PostIcon />} onClick={() => postMutation.mutate(detailJv.id)} disabled={postMutation.isPending}>
                  {postMutation.isPending ? <CircularProgress size={20} /> : 'Post JV'}
                </Button>
              )}
            </DialogActions>
          </>
        )}
      </ResponsiveDialog>
    </Box>
  );
}
