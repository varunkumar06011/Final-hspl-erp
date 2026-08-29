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
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Person as PersonIcon,
  Savings as ContributionIcon,
  Receipt as StatementIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from '../components/ResponsiveDialog';
import RefreshButton from '../components/RefreshButton';
import { formatCurrency, formatIndianNumber, formatDate } from '../utils/enumOptions';

interface OwnerAccount {
  id: string;
  ownerName: string;
  openingBalance: number;
  currentBalance: number;
  isActive: boolean;
  createdAt: string;
}

interface BankAccount {
  id: string;
  accountName: string;
  currentBalance: number;
}

interface StatementEntry {
  id: string;
  jvNumber: string;
  jvId: string;
  date: string;
  type: string;
  description: string;
  debit: number;
  credit: number;
  balanceAfter: number;
}

export default function OwnerAccountPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OwnerAccount | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Statement dialog
  const [statementAccountId, setStatementAccountId] = useState<string | null>(null);

  // Contribution dialog
  const [contribOpen, setContribOpen] = useState(false);
  const [contribAccountId, setContribAccountId] = useState<string>('');
  const [contribForm, setContribForm] = useState<Record<string, unknown>>({});

  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['/owner-accounts', page, pageSize, search],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      const response = await api.get('/owner-accounts', { params });
      return response.data;
    },
  });

  const { data: bankAccountsData } = useQuery({
    queryKey: ['/bank-accounts', 'all'],
    queryFn: async () => {
      const response = await api.get('/bank-accounts', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
  });

  const { data: statementData, isLoading: stmtLoading } = useQuery({
    queryKey: ['/owner-accounts', statementAccountId, 'statement'],
    queryFn: async () => {
      const response = await api.get(`/owner-accounts/${statementAccountId}/statement`);
      return response.data;
    },
    enabled: !!statementAccountId,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await api.post('/owner-accounts', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/owner-accounts'] });
      closeDialog();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) => {
      const response = await api.patch(`/owner-accounts/${id}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/owner-accounts'] });
      closeDialog();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/owner-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/owner-accounts'] });
      setDeleteConfirm(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const contribMutation = useMutation({
    mutationFn: async ({ accountId, payload }: { accountId: string; payload: Record<string, unknown> }) => {
      const response = await api.post(`/owner-accounts/${accountId}/contribution`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/owner-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/bank-accounts'] });
      setContribOpen(false);
      setContribForm({});
      setError('');
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const openCreate = () => {
    setForm({ ownerName: '', openingBalance: '' });
    setEditing(null);
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (row: OwnerAccount) => {
    setForm({ ownerName: row.ownerName, isActive: row.isActive });
    setEditing(row);
    setError('');
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm({});
    setError('');
  };

  const handleSubmit = () => {
    if (!form.ownerName || String(form.ownerName).trim() === '') {
      setError('Owner name is required');
      return;
    }
    setError('');
    const payload = editing
      ? { ownerName: form.ownerName, isActive: form.isActive }
      : { ownerName: form.ownerName, openingBalance: Number(form.openingBalance) || 0 };
    if (editing) {
      updateMutation.mutate({ id: editing.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const openContrib = (accountId: string) => {
    setContribAccountId(accountId);
    setContribForm({ bankAccountId: '', amount: '', date: '', description: '' });
    setError('');
    setContribOpen(true);
  };

  const handleContribSubmit = () => {
    if (!contribForm.bankAccountId) {
      setError('Select a bank account');
      return;
    }
    if (!contribForm.amount || Number(contribForm.amount) <= 0) {
      setError('Amount must be greater than 0');
      return;
    }
    setError('');
    const payload: Record<string, unknown> = {
      bankAccountId: contribForm.bankAccountId,
      amount: Number(contribForm.amount),
      description: contribForm.description || undefined,
    };
    if (contribForm.date) payload.date = contribForm.date;
    contribMutation.mutate({ accountId: contribAccountId, payload });
  };

  const rows: OwnerAccount[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const bankAccounts: BankAccount[] = bankAccountsData?.data ?? [];
  const statement: StatementEntry[] = statementData?.statement ?? [];

  return (
    <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          Owner Account
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <RefreshButton onClick={() => refetch()} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Owner</Button>
        </Box>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        <strong>Positive balance</strong> = company owes owner (owner put in more than taken out).
        <strong> Negative balance</strong> = owner owes company.
      </Alert>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Card sx={{ overflow: 'hidden' }}>
        <Box sx={{ p: 2 }}>
          <TextField
            size="small"
            placeholder="Search owner accounts..."
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
                <TableCell sx={{ fontWeight: 600 }}>Owner Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Opening</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Current Balance</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Meaning</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : isError ? (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <Alert severity="error" sx={{ mb: 1 }}>Failed to load data.</Alert>
                  <Button size="small" onClick={() => refetch()} startIcon={<RefreshIcon />}>Retry</Button>
                </TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">No owner accounts found. Create one to track owner funding.</Typography>
                </TableCell></TableRow>
              ) : (
                rows.map((row) => {
                  const balance = Number(row.currentBalance);
                  return (
                    <TableRow key={row.id} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{row.ownerName}</TableCell>
                      <TableCell align="right">{formatCurrency(row.openingBalance)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: balance > 0 ? 'error.main' : balance < 0 ? 'success.main' : 'text.primary' }}>
                        {formatCurrency(balance)}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={balance > 0 ? 'Company owes owner' : balance < 0 ? 'Owner owes company' : 'Settled'}
                          size="small"
                          color={balance > 0 ? 'warning' : balance < 0 ? 'info' : 'success'}
                        />
                      </TableCell>
                      <TableCell><Chip label={row.isActive ? 'Active' : 'Inactive'} size="small" color={row.isActive ? 'success' : 'default'} /></TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <IconButton size="small" title="Statement" onClick={() => setStatementAccountId(row.id)}><StatementIcon fontSize="small" /></IconButton>
                          <IconButton size="small" title="Add Contribution" onClick={() => openContrib(row.id)}><ContributionIcon fontSize="small" color="success" /></IconButton>
                          <IconButton size="small" title="Edit" onClick={() => openEdit(row)}><EditIcon fontSize="small" /></IconButton>
                          <IconButton size="small" title="Delete" onClick={() => setDeleteConfirm(row.id)}><DeleteIcon fontSize="small" /></IconButton>
                        </Stack>
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
          rowsPerPageOptions={[10, 20, 50, 100]}
        />
      </Card>

      {/* Create/Edit dialog */}
      <ResponsiveDialog open={dialogOpen} onClose={closeDialog} maxWidth="xs" fullWidth>
        <DialogTitle>{editing ? 'Edit Owner Account' : 'New Owner Account'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField label="Owner Name" value={form.ownerName ?? ''} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} required size="small" />
            {!editing && (
              <TextField
                label="Opening Balance"
                type="text"
                value={formatIndianNumber(form.openingBalance ?? '')}
                onChange={(e) => setForm({ ...form, openingBalance: e.target.value.replace(/,/g, '') })}
                size="small"
                InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
              />
            )}
            {editing && (
              <TextField select label="Status" value={form.isActive ?? true} onChange={(e) => setForm({ ...form, isActive: e.target.value === 'true' })} size="small">
                <MenuItem value="true">Active</MenuItem>
                <MenuItem value="false">Inactive</MenuItem>
              </TextField>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
            {createMutation.isPending || updateMutation.isPending ? <CircularProgress size={20} /> : editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Contribution dialog */}
      <ResponsiveDialog open={contribOpen} onClose={() => setContribOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Owner Contribution (Money into Company Bank)</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Alert severity="info" sx={{ mb: 2 }}>
            This deposits money into the selected bank account AND increases the owner's balance (company owes owner more).
          </Alert>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField select label="Bank Account" value={contribForm.bankAccountId ?? ''} onChange={(e) => setContribForm({ ...contribForm, bankAccountId: e.target.value })} size="small">
              {bankAccounts.map((acc) => <MenuItem key={acc.id} value={acc.id}>{acc.accountName} ({formatCurrency(acc.currentBalance)})</MenuItem>)}
            </TextField>
            <TextField
              label="Amount"
              type="text"
              value={formatIndianNumber(contribForm.amount ?? '')}
              onChange={(e) => setContribForm({ ...contribForm, amount: e.target.value.replace(/,/g, '') })}
              required
              size="small"
              InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
            />
            <TextField label="Date" type="date" value={contribForm.date ?? ''} onChange={(e) => setContribForm({ ...contribForm, date: e.target.value })} size="small" InputLabelProps={{ shrink: true }} />
            <TextField label="Description" value={contribForm.description ?? ''} onChange={(e) => setContribForm({ ...contribForm, description: e.target.value })} size="small" multiline rows={2} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setContribOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleContribSubmit} disabled={contribMutation.isPending}>
            {contribMutation.isPending ? <CircularProgress size={20} /> : 'Add Contribution'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Statement dialog */}
      <ResponsiveDialog open={!!statementAccountId} onClose={() => setStatementAccountId(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Stack direction="row" alignItems="center" gap={1}>
            <PersonIcon /><Typography variant="h6">Owner Account Statement</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent>
          {statementData?.account && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <strong>{statementData.account.ownerName}</strong> — Current Balance: {formatCurrency(statementData.account.currentBalance)} ({Number(statementData.account.currentBalance) > 0 ? 'Company owes owner' : 'Owner owes company'})
            </Alert>
          )}
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>JV Number</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Debit</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Credit</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Balance</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stmtLoading ? (
                  <TableRow><TableCell colSpan={7} align="center"><CircularProgress size={24} /></TableCell></TableRow>
                ) : statement.length === 0 ? (
                  <TableRow><TableCell colSpan={7} align="center"><Typography color="text.secondary">No transactions yet</Typography></TableCell></TableRow>
                ) : (
                  statement.map((entry) => (
                    <TableRow key={entry.id} hover>
                      <TableCell>{formatDate(entry.date)}</TableCell>
                      <TableCell>{entry.jvNumber}</TableCell>
                      <TableCell><Chip label={entry.type.replace(/_/g, ' ')} size="small" variant="outlined" /></TableCell>
                      <TableCell align="right" sx={{ color: 'error.main' }}>{entry.debit > 0 ? formatCurrency(entry.debit) : '—'}</TableCell>
                      <TableCell align="right" sx={{ color: 'success.main' }}>{entry.credit > 0 ? formatCurrency(entry.credit) : '—'}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(entry.balanceAfter)}</TableCell>
                      <TableCell>{entry.description}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatementAccountId(null)}>Close</Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Delete confirmation */}
      <ResponsiveDialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Owner Account?</DialogTitle>
        <DialogContent><Typography>This will soft-delete the account. JV history will be preserved.</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)} disabled={deleteMutation.isPending}>Delete</Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
