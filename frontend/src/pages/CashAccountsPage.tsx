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
  Payments as CashIcon,
  ArrowDownward as InIcon,
  ArrowUpward as OutIcon,
  SwapHoriz as TransferIcon,
  Receipt as StatementIcon,
  AccountBalance as BankIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from '../components/ResponsiveDialog';
import RefreshButton from '../components/RefreshButton';
import LedgerAutocomplete, { type LedgerOption } from '../components/LedgerAutocomplete';
import { formatCurrency, formatIndianNumber, formatDate, amountToWords, todayLocalDate } from '../utils/enumOptions';
import { LedgerGroup } from '@hospital-erp/shared';

interface CashAccount {
  id: string;
  name: string;
  openingBalance: number;
  currentBalance: number;
  isActive: boolean;
  createdAt: string;
}

interface CashTransaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  date: string;
  description: string | null;
  referenceType: string;
  status: string;
}

interface BankAccount {
  id: string;
  accountName: string;
  currentBalance: number;
}

const TXN_TYPE_LABELS: Record<string, string> = {
  IN: 'Cash In',
  OUT: 'Cash Out',
  TRANSFER_IN: 'Transfer In',
  TRANSFER_OUT: 'Transfer Out',
  REVERSAL_IN: 'Reversal In',
  REVERSAL_OUT: 'Reversal Out',
};

const REF_TYPE_LABELS: Record<string, string> = {
  PAYMENT: 'Payment',
  JOURNAL_VOUCHER: 'Journal Voucher',
  MANUAL_DEPOSIT: 'Receipt',
  MANUAL_WITHDRAWAL: 'Payment',
  TRANSFER: 'Transfer',
  REVERSAL: 'Reversal',
};

const TXN_TYPE_COLORS: Record<string, 'success' | 'error' | 'info' | 'warning' | 'default'> = {
  IN: 'success',
  OUT: 'error',
  TRANSFER_IN: 'success',
  TRANSFER_OUT: 'error',
  REVERSAL_IN: 'warning',
  REVERSAL_OUT: 'warning',
};

export default function CashAccountsPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CashAccount | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Statement dialog
  const [statementAccountId, setStatementAccountId] = useState<string | null>(null);
  const [stmtPage, setStmtPage] = useState(0);
  const [stmtPageSize, setStmtPageSize] = useState(25);

  // Cash IN/OUT dialog
  const [txnDialogOpen, setTxnDialogOpen] = useState(false);
  const [txnType, setTxnType] = useState<'IN' | 'OUT'>('IN');
  const [txnAccountId, setTxnAccountId] = useState<string>('');
  const [txnForm, setTxnForm] = useState<Record<string, unknown>>({});

  // Cash-to-cash transfer dialog
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState<Record<string, unknown>>({});

  // Bank↔Cash transfer dialog
  const [bankCashOpen, setBankCashOpen] = useState(false);
  const [bankCashDirection, setBankCashDirection] = useState<'BANK_TO_CASH' | 'CASH_TO_BANK'>('BANK_TO_CASH');
  const [bankCashForm, setBankCashForm] = useState<Record<string, unknown>>({});

  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['/cash-accounts', page, pageSize, search],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      const response = await api.get('/cash-accounts', { params });
      return response.data;
    },
  });

  // Fetch bank accounts for bank↔cash transfers
  const { data: bankAccountsData } = useQuery({
    queryKey: ['/bank-accounts', 'all'],
    queryFn: async () => {
      const response = await api.get('/bank-accounts', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
  });

  // Fetch ledgers for the contra ledger picker (cash in/out)
  const { data: ledgersData } = useQuery({
    queryKey: ['/ledgers', 'all-for-cash'],
    queryFn: async () => {
      const response = await api.get('/ledgers', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
  });
  const ledgers: LedgerOption[] = (ledgersData?.data ?? []).map((l: any) => ({
    id: l.id,
    name: l.name,
    group: l.group,
    currentBalance: Number(l.currentBalance),
    isActive: l.isActive,
  }));

  const { data: statementData, isLoading: stmtLoading } = useQuery({
    queryKey: ['/cash-accounts', statementAccountId, 'statement', stmtPage, stmtPageSize],
    queryFn: async () => {
      const response = await api.get(`/cash-accounts/${statementAccountId}/statement`, {
        params: { page: stmtPage + 1, pageSize: stmtPageSize },
      });
      return response.data;
    },
    enabled: !!statementAccountId,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await api.post('/cash-accounts', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/cash-accounts'] });
      closeDialog();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) => {
      const response = await api.patch(`/cash-accounts/${id}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/cash-accounts'] });
      closeDialog();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/cash-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/cash-accounts'] });
      setDeleteConfirm(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const txnMutation = useMutation({
    mutationFn: async ({ accountId, type, payload }: { accountId: string; type: 'IN' | 'OUT'; payload: Record<string, unknown> }) => {
      const endpoint = type === 'IN' ? 'in' : 'out';
      const response = await api.post(`/cash-accounts/${accountId}/${endpoint}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/cash-accounts'] });
      if (statementAccountId) {
        queryClient.invalidateQueries({ queryKey: ['/cash-accounts', statementAccountId, 'statement'] });
      }
      setTxnDialogOpen(false);
      setTxnForm({});
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const transferMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await api.post('/cash-accounts/transfer', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/cash-accounts'] });
      setTransferOpen(false);
      setTransferForm({});
      setError('');
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const bankCashMutation = useMutation({
    mutationFn: async ({ direction, payload }: { direction: 'BANK_TO_CASH' | 'CASH_TO_BANK'; payload: Record<string, unknown> }) => {
      const endpoint = direction === 'BANK_TO_CASH' ? 'bank-to-cash' : 'cash-to-bank';
      const response = await api.post(`/cash-accounts/${endpoint}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/cash-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/bank-accounts'] });
      setBankCashOpen(false);
      setBankCashForm({});
      setError('');
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const openCreate = () => {
    setForm({ name: '', openingBalance: '' });
    setEditing(null);
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (row: CashAccount) => {
    setForm({ name: row.name, isActive: row.isActive });
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
    if (!form.name || String(form.name).trim() === '') {
      setError('Account name is required');
      return;
    }
    setError('');
    const payload = editing
      ? { name: form.name, isActive: form.isActive }
      : { name: form.name, openingBalance: Number(form.openingBalance) || 0 };
    if (editing) {
      updateMutation.mutate({ id: editing.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const openTxnDialog = (accountId: string, type: 'IN' | 'OUT') => {
    setTxnAccountId(accountId);
    setTxnType(type);
    setTxnForm({ amount: '', contraLedgerId: '', date: '', description: '' });
    setError('');
    setTxnDialogOpen(true);
  };

  const handleTxnSubmit = () => {
    if (!txnForm.amount || Number(txnForm.amount) <= 0) {
      setError('Amount must be greater than 0');
      return;
    }
    if (!txnForm.contraLedgerId) {
      setError(txnType === 'IN' ? 'Select the ledger the money is coming from' : 'Select the ledger the money is going to');
      return;
    }
    setError('');
    const payload: Record<string, unknown> = {
      amount: Number(txnForm.amount),
      contraLedgerId: txnForm.contraLedgerId,
      description: txnForm.description || undefined,
    };
    if (txnForm.date) payload.date = txnForm.date;
    txnMutation.mutate({ accountId: txnAccountId, type: txnType, payload });
  };

  const openTransfer = () => {
    setTransferForm({ fromAccountId: '', toAccountId: '', amount: '', date: '', description: '' });
    setError('');
    setTransferOpen(true);
  };

  const handleTransferSubmit = () => {
    if (!transferForm.fromAccountId || !transferForm.toAccountId) {
      setError('Select both accounts');
      return;
    }
    if (transferForm.fromAccountId === transferForm.toAccountId) {
      setError('Cannot transfer to the same account');
      return;
    }
    if (!transferForm.amount || Number(transferForm.amount) <= 0) {
      setError('Amount must be greater than 0');
      return;
    }
    setError('');
    const payload: Record<string, unknown> = {
      fromAccountId: transferForm.fromAccountId,
      toAccountId: transferForm.toAccountId,
      amount: Number(transferForm.amount),
      description: transferForm.description || undefined,
    };
    if (transferForm.date) payload.date = transferForm.date;
    transferMutation.mutate(payload);
  };

  const openBankCash = (direction: 'BANK_TO_CASH' | 'CASH_TO_BANK') => {
    setBankCashDirection(direction);
    setBankCashForm({ bankAccountId: '', cashAccountId: '', amount: '', date: '', description: '' });
    setError('');
    setBankCashOpen(true);
  };

  const handleBankCashSubmit = () => {
    if (!bankCashForm.bankAccountId || !bankCashForm.cashAccountId) {
      setError('Select both bank and cash accounts');
      return;
    }
    if (!bankCashForm.amount || Number(bankCashForm.amount) <= 0) {
      setError('Amount must be greater than 0');
      return;
    }
    setError('');
    const payload: Record<string, unknown> = {
      bankAccountId: bankCashForm.bankAccountId,
      cashAccountId: bankCashForm.cashAccountId,
      amount: Number(bankCashForm.amount),
      description: bankCashForm.description || undefined,
    };
    if (bankCashForm.date) payload.date = bankCashForm.date;
    bankCashMutation.mutate({ direction: bankCashDirection, payload });
  };

  const rows: CashAccount[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const stmtRows: CashTransaction[] = statementData?.data ?? [];
  const stmtPagination = statementData?.pagination ?? { page: 1, pageSize: 25, total: 0, totalPages: 0 };
  const bankAccounts: BankAccount[] = bankAccountsData?.data ?? [];

  return (
    <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          Cash Accounts
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <RefreshButton onClick={() => refetch()} />
          <Button variant="outlined" startIcon={<BankIcon />} onClick={() => openBankCash('BANK_TO_CASH')}>Bank → Cash</Button>
          <Button variant="outlined" startIcon={<CashIcon />} onClick={() => openBankCash('CASH_TO_BANK')}>Cash → Bank</Button>
          <Button variant="outlined" startIcon={<TransferIcon />} onClick={openTransfer}>Transfer</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Account</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Card sx={{ overflow: 'hidden' }}>
        <Box sx={{ p: 2 }}>
          <TextField
            size="small"
            placeholder="Search cash accounts..."
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
                <TableCell sx={{ fontWeight: 600 }}>Account Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Opening</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Current Balance</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : isError ? (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                  <Alert severity="error" sx={{ mb: 1 }}>Failed to load data.</Alert>
                  <Button size="small" onClick={() => refetch()} startIcon={<RefreshIcon />}>Retry</Button>
                </TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">No cash accounts found. Create "Main Cash" and "Site Cash" to get started.</Typography>
                </TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{row.name}</TableCell>
                    <TableCell align="right">{formatCurrency(row.openingBalance)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, color: 'success.main' }}>{formatCurrency(row.currentBalance)}</TableCell>
                    <TableCell><Chip label={row.isActive ? 'Active' : 'Inactive'} size="small" color={row.isActive ? 'success' : 'default'} /></TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <IconButton size="small" title="Statement" onClick={() => { setStatementAccountId(row.id); setStmtPage(0); }}><StatementIcon fontSize="small" /></IconButton>
                        <IconButton size="small" title="Cash In" onClick={() => openTxnDialog(row.id, 'IN')}><InIcon fontSize="small" color="success" /></IconButton>
                        <IconButton size="small" title="Cash Out" onClick={() => openTxnDialog(row.id, 'OUT')}><OutIcon fontSize="small" color="error" /></IconButton>
                        <IconButton size="small" title="Edit" onClick={() => openEdit(row)}><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" title="Delete" onClick={() => setDeleteConfirm(row.id)}><DeleteIcon fontSize="small" /></IconButton>
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

      {/* Create/Edit dialog */}
      <ResponsiveDialog open={dialogOpen} onClose={closeDialog} maxWidth="xs" fullWidth>
        <DialogTitle>{editing ? 'Edit Cash Account' : 'New Cash Account'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField label="Account Name" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} required size="small" placeholder="e.g. Main Cash, Site Cash" />
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

      {/* Cash IN/OUT dialog */}
      <ResponsiveDialog open={txnDialogOpen} onClose={() => setTxnDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{txnType === 'IN' ? 'Cash In (Receipt)' : 'Cash Out (Payment)'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {/* Contra ledger — the other side of the double entry */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {txnType === 'IN' ? 'Received From (Ledger)' : 'Paid To (Ledger)'}
              </Typography>
              <LedgerAutocomplete
                value={String(txnForm.contraLedgerId ?? '')}
                onChange={(id) => setTxnForm({ ...txnForm, contraLedgerId: id })}
                ledgers={ledgers}
                preferredGroups={txnType === 'IN'
                  ? [LedgerGroup.SUNDRY_DEBTORS, LedgerGroup.INDIRECT_INCOME, LedgerGroup.DIRECT_INCOME, LedgerGroup.SALES, LedgerGroup.CAPITAL_ACCOUNT, LedgerGroup.BANK]
                  : [LedgerGroup.SUNDRY_CREDITORS, LedgerGroup.DIRECT_EXPENSE, LedgerGroup.INDIRECT_EXPENSE, LedgerGroup.PURCHASE, LedgerGroup.BANK]
                }
                placeholder={txnType === 'IN' ? 'Type ledger name (source of money)...' : 'Type ledger name (where money goes)...'}
                onError={(msg) => setError(msg)}
              />
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Amount</Typography>
              <TextField
                fullWidth
                type="text"
                value={formatIndianNumber(txnForm.amount ?? '')}
                onChange={(e) => setTxnForm({ ...txnForm, amount: e.target.value.replace(/,/g, '') })}
                required
                size="small"
                inputProps={{ style: { textAlign: 'right' }, inputMode: 'decimal' }}
                InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
                placeholder="0.00"
              />
              {Number(txnForm.amount) > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontStyle: 'italic' }}>
                  {amountToWords(txnForm.amount)}
                </Typography>
              )}
            </Box>

            <TextField label="Date" type="date" value={txnForm.date ?? ''} onChange={(e) => setTxnForm({ ...txnForm, date: e.target.value })} size="small" InputLabelProps={{ shrink: true }} inputProps={{ max: todayLocalDate() }} />
            <TextField label="Description" value={txnForm.description ?? ''} onChange={(e) => setTxnForm({ ...txnForm, description: e.target.value })} size="small" multiline rows={2} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTxnDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleTxnSubmit} disabled={txnMutation.isPending}>
            {txnMutation.isPending ? <CircularProgress size={20} /> : txnType === 'IN' ? 'Add Cash' : 'Remove Cash'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Cash-to-cash transfer dialog */}
      <ResponsiveDialog open={transferOpen} onClose={() => setTransferOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Transfer Between Cash Accounts</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField select label="From Account" value={transferForm.fromAccountId ?? ''} onChange={(e) => setTransferForm({ ...transferForm, fromAccountId: e.target.value })} size="small">
              {rows.map((acc) => <MenuItem key={acc.id} value={acc.id}>{acc.name} ({formatCurrency(acc.currentBalance)})</MenuItem>)}
            </TextField>
            <TextField select label="To Account" value={transferForm.toAccountId ?? ''} onChange={(e) => setTransferForm({ ...transferForm, toAccountId: e.target.value })} size="small">
              {rows.map((acc) => <MenuItem key={acc.id} value={acc.id}>{acc.name} ({formatCurrency(acc.currentBalance)})</MenuItem>)}
            </TextField>
            <TextField
              label="Amount"
              type="text"
              value={formatIndianNumber(transferForm.amount ?? '')}
              onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value.replace(/,/g, '') })}
              required
              size="small"
              InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
            />
            <TextField label="Date" type="date" value={transferForm.date ?? ''} onChange={(e) => setTransferForm({ ...transferForm, date: e.target.value })} size="small" InputLabelProps={{ shrink: true }} inputProps={{ max: todayLocalDate() }} />
            <TextField label="Description" value={transferForm.description ?? ''} onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })} size="small" multiline rows={2} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTransferOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleTransferSubmit} disabled={transferMutation.isPending}>
            {transferMutation.isPending ? <CircularProgress size={20} /> : 'Transfer'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Bank↔Cash transfer dialog */}
      <ResponsiveDialog open={bankCashOpen} onClose={() => setBankCashOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{bankCashDirection === 'BANK_TO_CASH' ? 'Bank → Cash (Withdraw)' : 'Cash → Bank (Deposit)'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField select label="Bank Account" value={bankCashForm.bankAccountId ?? ''} onChange={(e) => setBankCashForm({ ...bankCashForm, bankAccountId: e.target.value })} size="small">
              {bankAccounts.map((acc) => <MenuItem key={acc.id} value={acc.id}>{acc.accountName} ({formatCurrency(acc.currentBalance)})</MenuItem>)}
            </TextField>
            <TextField select label="Cash Account" value={bankCashForm.cashAccountId ?? ''} onChange={(e) => setBankCashForm({ ...bankCashForm, cashAccountId: e.target.value })} size="small">
              {rows.map((acc) => <MenuItem key={acc.id} value={acc.id}>{acc.name} ({formatCurrency(acc.currentBalance)})</MenuItem>)}
            </TextField>
            <TextField
              label="Amount"
              type="text"
              value={formatIndianNumber(bankCashForm.amount ?? '')}
              onChange={(e) => setBankCashForm({ ...bankCashForm, amount: e.target.value.replace(/,/g, '') })}
              required
              size="small"
              InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
            />
            <TextField label="Date" type="date" value={bankCashForm.date ?? ''} onChange={(e) => setBankCashForm({ ...bankCashForm, date: e.target.value })} size="small" InputLabelProps={{ shrink: true }} inputProps={{ max: todayLocalDate() }} />
            <TextField label="Description" value={bankCashForm.description ?? ''} onChange={(e) => setBankCashForm({ ...bankCashForm, description: e.target.value })} size="small" multiline rows={2} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBankCashOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleBankCashSubmit} disabled={bankCashMutation.isPending}>
            {bankCashMutation.isPending ? <CircularProgress size={20} /> : bankCashDirection === 'BANK_TO_CASH' ? 'Withdraw to Cash' : 'Deposit to Bank'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Statement dialog */}
      <ResponsiveDialog open={!!statementAccountId} onClose={() => setStatementAccountId(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Stack direction="row" alignItems="center" gap={1}>
            <CashIcon /><Typography variant="h6">Cash Statement</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent>
          {statementData?.account && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <strong>{statementData.account.name}</strong> — Current Balance: {formatCurrency(statementData.account.currentBalance)} | Opening: {formatCurrency(statementData.account.openingBalance)}
            </Alert>
          )}
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Amount</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Balance After</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Ref</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stmtLoading ? (
                  <TableRow><TableCell colSpan={6} align="center"><CircularProgress size={24} /></TableCell></TableRow>
                ) : stmtRows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} align="center"><Typography color="text.secondary">No transactions</Typography></TableCell></TableRow>
                ) : (
                  stmtRows.map((txn) => (
                    <TableRow key={txn.id} hover>
                      <TableCell>{formatDate(txn.date)}</TableCell>
                      <TableCell><Chip label={TXN_TYPE_LABELS[txn.type] ?? txn.type} size="small" color={TXN_TYPE_COLORS[txn.type] ?? 'default'} /></TableCell>
                      <TableCell align="right" sx={{ color: ['IN', 'TRANSFER_IN', 'REVERSAL_IN'].includes(txn.type) ? 'success.main' : 'error.main', fontWeight: 600 }}>
                        {['IN', 'TRANSFER_IN', 'REVERSAL_IN'].includes(txn.type) ? '+' : '−'}{formatCurrency(txn.amount)}
                      </TableCell>
                      <TableCell align="right">{formatCurrency(txn.balanceAfter)}</TableCell>
                      <TableCell>{txn.description || '—'}</TableCell>
                      <TableCell><Chip label={REF_TYPE_LABELS[txn.referenceType] ?? txn.referenceType} size="small" variant="outlined" /></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={stmtPagination.total}
            page={stmtPage}
            onPageChange={(_e, newPage) => setStmtPage(newPage)}
            rowsPerPage={stmtPageSize}
            onRowsPerPageChange={(e) => { setStmtPageSize(Number(e.target.value)); setStmtPage(0); }}
            rowsPerPageOptions={[10, 25, 50]}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatementAccountId(null)}>Close</Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Delete confirmation */}
      <ResponsiveDialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Cash Account?</DialogTitle>
        <DialogContent><Typography>This will soft-delete the account. Transactions will be preserved.</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)} disabled={deleteMutation.isPending}>Delete</Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
