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
  AccountBalance as BankIcon,
  ArrowDownward as DepositIcon,
  ArrowUpward as WithdrawIcon,
  SwapHoriz as TransferIcon,
  Receipt as StatementIcon,
  Print as PrintIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from '../components/ResponsiveDialog';
import RefreshButton from '../components/RefreshButton';
import LedgerAutocomplete, { type LedgerOption } from '../components/LedgerAutocomplete';
import { formatCurrency, formatIndianNumber, formatDate, amountToWords } from '../utils/enumOptions';
import { LedgerGroup } from '@hospital-erp/shared';

interface BankAccount {
  id: string;
  accountName: string;
  bankName: string | null;
  accountNumber: string | null;
  ifscCode: string | null;
  openingBalance: number;
  currentBalance: number;
  isActive: boolean;
  createdAt: string;
}

interface BankTransaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  date: string;
  description: string | null;
  referenceType: string;
  status: string;
}

const TXN_TYPE_LABELS: Record<string, string> = {
  DEPOSIT: 'Deposit',
  WITHDRAWAL: 'Withdrawal',
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
  DEPOSIT: 'success',
  WITHDRAWAL: 'error',
  TRANSFER_IN: 'success',
  TRANSFER_OUT: 'error',
  REVERSAL_IN: 'warning',
  REVERSAL_OUT: 'warning',
};

export default function BankAccountsPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Statement dialog state
  const [statementAccountId, setStatementAccountId] = useState<string | null>(null);
  const [stmtPage, setStmtPage] = useState(0);
  const [stmtPageSize, setStmtPageSize] = useState(25);
  const [stmtStartDate, setStmtStartDate] = useState('');
  const [stmtEndDate, setStmtEndDate] = useState('');
  const [stmtLedgerFilter, setStmtLedgerFilter] = useState('');
  const [stmtTypeFilter, setStmtTypeFilter] = useState('');
  const [editingTxnId, setEditingTxnId] = useState<string | null>(null);
  const [editTxnDesc, setEditTxnDesc] = useState('');

  // Transaction dialog state (deposit/withdraw)
  const [txnDialogOpen, setTxnDialogOpen] = useState(false);
  const [txnType, setTxnType] = useState<'DEPOSIT' | 'WITHDRAWAL'>('DEPOSIT');
  const [txnAccountId, setTxnAccountId] = useState<string>('');
  const [txnForm, setTxnForm] = useState<Record<string, unknown>>({}); // amount, contraLedgerId, date, description

  // Transfer dialog state
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState<Record<string, unknown>>({});

  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['/bank-accounts', page, pageSize, search],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      const response = await api.get('/bank-accounts', { params });
      return response.data;
    },
  });

  // Fetch ledgers for the contra ledger picker (deposit/withdraw)
  const { data: ledgersData } = useQuery({
    queryKey: ['/ledgers', 'all-for-bank'],
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
    linkedEntityType: l.linkedEntityType,
  }));

  const { data: statementData, isLoading: stmtLoading } = useQuery({
    queryKey: ['/bank-accounts', statementAccountId, 'statement', stmtPage, stmtPageSize, stmtStartDate, stmtEndDate, stmtLedgerFilter, stmtTypeFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: stmtPage + 1, pageSize: stmtPageSize };
      if (stmtStartDate) params.startDate = stmtStartDate;
      if (stmtEndDate) params.endDate = stmtEndDate;
      if (stmtLedgerFilter) params.ledgerId = stmtLedgerFilter;
      if (stmtTypeFilter) params.type = stmtTypeFilter;
      const response = await api.get(`/bank-accounts/${statementAccountId}/statement`, { params });
      return response.data;
    },
    enabled: !!statementAccountId,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await api.post('/bank-accounts', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/bank-accounts'] });
      closeDialog();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) => {
      const response = await api.patch(`/bank-accounts/${id}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/bank-accounts'] });
      closeDialog();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/bank-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/bank-accounts'] });
      setDeleteConfirm(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const txnMutation = useMutation({
    mutationFn: async ({ accountId, type, payload }: { accountId: string; type: 'DEPOSIT' | 'WITHDRAWAL'; payload: Record<string, unknown> }) => {
      const endpoint = type === 'DEPOSIT' ? 'deposit' : 'withdraw';
      const response = await api.post(`/bank-accounts/${accountId}/${endpoint}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/bank-accounts'] });
      if (statementAccountId) {
        queryClient.invalidateQueries({ queryKey: ['/bank-accounts', statementAccountId, 'statement'] });
      }
      setTxnDialogOpen(false);
      setTxnForm({});
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const transferMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await api.post('/bank-accounts/transfer', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/bank-accounts'] });
      setTransferOpen(false);
      setTransferForm({});
      setError('');
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const openCreate = () => {
    setForm({ accountName: '', bankName: '', accountNumber: '', ifscCode: '', openingBalance: '' });
    setEditing(null);
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (row: BankAccount) => {
    setForm({
      accountName: row.accountName,
      bankName: row.bankName ?? '',
      accountNumber: row.accountNumber ?? '',
      ifscCode: row.ifscCode ?? '',
      isActive: row.isActive,
    });
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
    if (!form.accountName || String(form.accountName).trim() === '') {
      setError('Account name is required');
      return;
    }
    setError('');
    const payload = editing
      ? {
          accountName: form.accountName,
          bankName: form.bankName || undefined,
          accountNumber: form.accountNumber || undefined,
          ifscCode: form.ifscCode || undefined,
          isActive: form.isActive,
        }
      : {
          accountName: form.accountName,
          bankName: form.bankName || undefined,
          accountNumber: form.accountNumber || undefined,
          ifscCode: form.ifscCode || undefined,
          openingBalance: Number(form.openingBalance) || 0,
        };
    if (editing) {
      updateMutation.mutate({ id: editing.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const openTxnDialog = (accountId: string, type: 'DEPOSIT' | 'WITHDRAWAL') => {
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
      setError(txnType === 'DEPOSIT' ? 'Select the ledger the money is coming from' : 'Select the ledger the money is going to');
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

  const rows: BankAccount[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const stmtRows: BankTransaction[] = statementData?.data ?? [];
  const stmtPagination = statementData?.pagination ?? { page: 1, pageSize: 25, total: 0, totalPages: 0 };

  // Edit transaction mutation
  const editTxnMutation = useMutation({
    mutationFn: async ({ txnId, payload }: { txnId: string; payload: Record<string, unknown> }) => {
      const response = await api.patch(`/bank-accounts/${statementAccountId}/transactions/${txnId}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/bank-accounts', statementAccountId, 'statement'] });
      setEditingTxnId(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  // ── Print statement (opens Windows print dialog) ──
  const handlePrintStatement = (printAll: boolean) => {
    if (!statementData?.account) return;
    const acc = statementData.account;
    const rowsToPrint = printAll ? stmtRows : stmtRows; // current page either way; "all" would need a separate fetch
    const filtersDesc = [
      stmtStartDate && `From: ${stmtStartDate}`,
      stmtEndDate && `To: ${stmtEndDate}`,
      stmtLedgerFilter && `Ledger: ${ledgers.find((l) => l.id === stmtLedgerFilter)?.name ?? ''}`,
      stmtTypeFilter && `Type: ${TXN_TYPE_LABELS[stmtTypeFilter] ?? stmtTypeFilter}`,
    ].filter(Boolean).join(' | ');

    const html = `
      <html>
      <head>
        <title>Bank Statement - ${acc.accountName}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h2 { margin: 0 0 5px 0; }
          .info { color: #666; margin-bottom: 15px; font-size: 13px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { background: #f5f5f5; padding: 8px; text-align: left; border-bottom: 2px solid #ddd; }
          td { padding: 6px 8px; border-bottom: 1px solid #eee; }
      .amt-in { color: #2e7d32; text-align: right; }
      .amt-out { color: #c62828; text-align: right; }
      .bal { text-align: right; }
        </style>
      </head>
      <body>
        <h2>${acc.accountName}</h2>
        <div class="info">
          ${acc.bankName ?? ''} ${acc.accountNumber ? `| A/c: ${acc.accountNumber}` : ''}<br/>
          Opening Balance: Rs. ${acc.openingBalance.toLocaleString('en-IN')} | Current Balance: Rs. ${acc.currentBalance.toLocaleString('en-IN')}<br/>
          ${filtersDesc ? `<strong>Filters:</strong> ${filtersDesc}` : ''}
        </div>
        <table>
          <thead>
            <tr><th>Date</th><th>Type</th><th>Description</th><th>Ref</th><th align="right">Amount</th><th align="right">Balance</th></tr>
          </thead>
          <tbody>
            ${rowsToPrint.map((t: BankTransaction) => {
      const isIn = ['DEPOSIT', 'TRANSFER_IN', 'REVERSAL_IN'].includes(t.type);
      return `<tr>
                <td>${formatDate(t.date)}</td>
                <td>${TXN_TYPE_LABELS[t.type] ?? t.type}</td>
                <td>${t.description ?? '—'}</td>
                <td>${REF_TYPE_LABELS[t.referenceType] ?? t.referenceType}</td>
                <td class="${isIn ? 'amt-in' : 'amt-out'}">${isIn ? '+' : '−'}Rs. ${Number(t.amount).toLocaleString('en-IN')}</td>
                <td class="bal">Rs. ${Number(t.balanceAfter).toLocaleString('en-IN')}</td>
              </tr>`;
    }).join('')}
          </tbody>
        </table>
        <p style="margin-top:15px;font-size:11px;color:#999;">Generated on ${new Date().toLocaleString('en-IN')}</p>
      </body>
      </html>
    `;
    const printWin = window.open('', '_blank', 'width=900,height=600');
    if (printWin) {
      printWin.document.write(html);
      printWin.document.close();
      printWin.focus();
      setTimeout(() => printWin.print(), 300);
    }
  };

  // ── Export to CSV (Excel-compatible) ──
  const handleExportCSV = () => {
    if (!statementData?.account) return;
    const acc = statementData.account;
    const headers = ['Date', 'Type', 'Description', 'Ref Type', 'Amount', 'Balance After'];
    const csvRows = [
      [`Bank Statement - ${acc.accountName}`],
      [`Opening Balance: ${acc.openingBalance}`, `Current Balance: ${acc.currentBalance}`],
      stmtStartDate || stmtEndDate || stmtLedgerFilter || stmtTypeFilter
        ? [`Filters: ${[
            stmtStartDate && `From: ${stmtStartDate}`,
            stmtEndDate && `To: ${stmtEndDate}`,
            stmtLedgerFilter && `Ledger: ${ledgers.find((l) => l.id === stmtLedgerFilter)?.name ?? ''}`,
            stmtTypeFilter && `Type: ${TXN_TYPE_LABELS[stmtTypeFilter] ?? stmtTypeFilter}`,
          ].filter(Boolean).join(', ')}`]
        : [],
      [],
      headers,
      ...stmtRows.map((t: BankTransaction) => [
        formatDate(t.date),
        TXN_TYPE_LABELS[t.type] ?? t.type,
        (t.description ?? '').replace(/,/g, ';'),
        REF_TYPE_LABELS[t.referenceType] ?? t.referenceType,
        Number(t.amount).toFixed(2),
        Number(t.balanceAfter).toFixed(2),
      ]),
    ];
    const csv = csvRows.map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bank-statement-${acc.accountName}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasFilters = !!(stmtStartDate || stmtEndDate || stmtLedgerFilter || stmtTypeFilter);

  return (
    <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          Bank Accounts
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <RefreshButton onClick={() => refetch()} />
          <Button variant="outlined" startIcon={<TransferIcon />} onClick={openTransfer}>Transfer</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Account</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Card sx={{ overflow: 'hidden' }}>
        <Box sx={{ p: 2 }}>
          <TextField
            size="small"
            placeholder="Search bank accounts..."
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
                <TableCell sx={{ fontWeight: 600 }}>Bank</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Account No.</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>IFSC</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Opening</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Current Balance</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : isError ? (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                  <Alert severity="error" sx={{ mb: 1 }}>Failed to load data.</Alert>
                  <Button size="small" onClick={() => refetch()} startIcon={<RefreshIcon />}>Retry</Button>
                </TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">No bank accounts found.</Typography>
                </TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{row.accountName}</TableCell>
                    <TableCell>{row.bankName || '—'}</TableCell>
                    <TableCell>{row.accountNumber || '—'}</TableCell>
                    <TableCell>{row.ifscCode || '—'}</TableCell>
                    <TableCell align="right">{formatCurrency(row.openingBalance)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, color: 'success.main' }}>{formatCurrency(row.currentBalance)}</TableCell>
                    <TableCell><Chip label={row.isActive ? 'Active' : 'Inactive'} size="small" color={row.isActive ? 'success' : 'default'} /></TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <IconButton size="small" title="Statement" onClick={() => { setStatementAccountId(row.id); setStmtPage(0); }}><StatementIcon fontSize="small" /></IconButton>
                        <IconButton size="small" title="Deposit" onClick={() => openTxnDialog(row.id, 'DEPOSIT')}><DepositIcon fontSize="small" color="success" /></IconButton>
                        <IconButton size="small" title="Withdraw" onClick={() => openTxnDialog(row.id, 'WITHDRAWAL')}><WithdrawIcon fontSize="small" color="error" /></IconButton>
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
      <ResponsiveDialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Bank Account' : 'New Bank Account'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField label="Account Name" value={form.accountName ?? ''} onChange={(e) => setForm({ ...form, accountName: e.target.value })} required size="small" />
            <TextField label="Bank Name" value={form.bankName ?? ''} onChange={(e) => setForm({ ...form, bankName: e.target.value })} size="small" />
            <TextField label="Account Number" value={form.accountNumber ?? ''} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} size="small" />
            <TextField label="IFSC Code" value={form.ifscCode ?? ''} onChange={(e) => setForm({ ...form, ifscCode: e.target.value })} size="small" />
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

      {/* Deposit/Withdraw dialog — Tally-style with contra ledger picker */}
      <ResponsiveDialog open={txnDialogOpen} onClose={() => setTxnDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{txnType === 'DEPOSIT' ? 'Deposit to Bank' : 'Withdraw from Bank'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {/* Contra ledger — the other side of the double entry */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {txnType === 'DEPOSIT' ? 'Received From (Ledger)' : 'Paid To (Ledger)'}
              </Typography>
              <LedgerAutocomplete
                value={String(txnForm.contraLedgerId ?? '')}
                onChange={(id) => setTxnForm({ ...txnForm, contraLedgerId: id })}
                ledgers={ledgers}
                // For deposit: exclude bank/cash (those are the "to" side); show income/party first
                // For withdraw: exclude bank/cash (those are the "from" side); show expense/party first
                preferredGroups={txnType === 'DEPOSIT'
                  ? [LedgerGroup.SUNDRY_DEBTORS, LedgerGroup.INDIRECT_INCOME, LedgerGroup.DIRECT_INCOME, LedgerGroup.SALES, LedgerGroup.CAPITAL_ACCOUNT]
                  : [LedgerGroup.SUNDRY_CREDITORS, LedgerGroup.DIRECT_EXPENSE, LedgerGroup.INDIRECT_EXPENSE, LedgerGroup.PURCHASE]
                }
                placeholder={txnType === 'DEPOSIT' ? 'Type ledger name (source of money)...' : 'Type ledger name (where money goes)...'}
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

            <TextField label="Date" type="date" value={txnForm.date ?? ''} onChange={(e) => setTxnForm({ ...txnForm, date: e.target.value })} size="small" InputLabelProps={{ shrink: true }} />
            <TextField label="Description" value={txnForm.description ?? ''} onChange={(e) => setTxnForm({ ...txnForm, description: e.target.value })} size="small" multiline rows={2} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTxnDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleTxnSubmit} disabled={txnMutation.isPending}>
            {txnMutation.isPending ? <CircularProgress size={20} /> : txnType === 'DEPOSIT' ? 'Deposit' : 'Withdraw'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Transfer dialog */}
      <ResponsiveDialog open={transferOpen} onClose={() => setTransferOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Transfer Between Bank Accounts</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField select label="From Account" value={transferForm.fromAccountId ?? ''} onChange={(e) => setTransferForm({ ...transferForm, fromAccountId: e.target.value })} size="small">
              {rows.map((acc) => <MenuItem key={acc.id} value={acc.id}>{acc.accountName} ({formatCurrency(acc.currentBalance)})</MenuItem>)}
            </TextField>
            <TextField select label="To Account" value={transferForm.toAccountId ?? ''} onChange={(e) => setTransferForm({ ...transferForm, toAccountId: e.target.value })} size="small">
              {rows.map((acc) => <MenuItem key={acc.id} value={acc.id}>{acc.accountName} ({formatCurrency(acc.currentBalance)})</MenuItem>)}
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
            <TextField label="Date" type="date" value={transferForm.date ?? ''} onChange={(e) => setTransferForm({ ...transferForm, date: e.target.value })} size="small" InputLabelProps={{ shrink: true }} />
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

      {/* Statement dialog */}
      <ResponsiveDialog open={!!statementAccountId} onClose={() => setStatementAccountId(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Stack direction="row" alignItems="center" gap={1}>
              <BankIcon /><Typography variant="h6">Bank Statement</Typography>
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button size="small" startIcon={<PrintIcon />} onClick={() => handlePrintStatement(false)}>
                {hasFilters ? 'Print' : 'Print Page'}
              </Button>
              <Button size="small" startIcon={<DownloadIcon />} onClick={handleExportCSV}>
                Export CSV
              </Button>
            </Stack>
          </Stack>
        </DialogTitle>
        <DialogContent>
          {statementData?.account && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <strong>{statementData.account.accountName}</strong> — Current Balance: {formatCurrency(statementData.account.currentBalance)} | Opening: {formatCurrency(statementData.account.openingBalance)}
            </Alert>
          )}

          {/* Filters */}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            <TextField
              size="small"
              type="date"
              label="From Date"
              value={stmtStartDate}
              onChange={(e) => { setStmtStartDate(e.target.value); setStmtPage(0); }}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 150 }}
            />
            <TextField
              size="small"
              type="date"
              label="To Date"
              value={stmtEndDate}
              onChange={(e) => { setStmtEndDate(e.target.value); setStmtPage(0); }}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 150 }}
            />
            <TextField
              size="small"
              select
              label="Type"
              value={stmtTypeFilter}
              onChange={(e) => { setStmtTypeFilter(e.target.value); setStmtPage(0); }}
              sx={{ width: 140 }}
            >
              <MenuItem value="">All Types</MenuItem>
              {Object.entries(TXN_TYPE_LABELS).map(([val, label]) => <MenuItem key={val} value={val}>{label}</MenuItem>)}
            </TextField>
            <TextField
              size="small"
              select
              label="Ledger"
              value={stmtLedgerFilter}
              onChange={(e) => { setStmtLedgerFilter(e.target.value); setStmtPage(0); }}
              sx={{ width: 180 }}
            >
              <MenuItem value="">All Ledgers</MenuItem>
              {ledgers.map((l) => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
            </TextField>
            {hasFilters && (
              <Button size="small" onClick={() => { setStmtStartDate(''); setStmtEndDate(''); setStmtLedgerFilter(''); setStmtTypeFilter(''); setStmtPage(0); }}>
                Clear Filters
              </Button>
            )}
          </Box>

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
                  <TableCell sx={{ fontWeight: 600 }}></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stmtLoading ? (
                  <TableRow><TableCell colSpan={7} align="center"><CircularProgress size={24} /></TableCell></TableRow>
                ) : stmtRows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} align="center"><Typography color="text.secondary">No transactions</Typography></TableCell></TableRow>
                ) : (
                  stmtRows.map((txn) => (
                    <TableRow key={txn.id} hover>
                      <TableCell>{formatDate(txn.date)}</TableCell>
                      <TableCell><Chip label={TXN_TYPE_LABELS[txn.type] ?? txn.type} size="small" color={TXN_TYPE_COLORS[txn.type] ?? 'default'} /></TableCell>
                      <TableCell align="right" sx={{ color: ['DEPOSIT', 'TRANSFER_IN', 'REVERSAL_IN'].includes(txn.type) ? 'success.main' : 'error.main', fontWeight: 600 }}>
                        {['DEPOSIT', 'TRANSFER_IN', 'REVERSAL_IN'].includes(txn.type) ? '+' : '−'}{formatCurrency(txn.amount)}
                      </TableCell>
                      <TableCell align="right">{formatCurrency(txn.balanceAfter)}</TableCell>
                      <TableCell>
                        {editingTxnId === txn.id ? (
                          <Stack direction="row" spacing={1} alignItems="center">
                            <TextField
                              size="small"
                              value={editTxnDesc}
                              onChange={(e) => setEditTxnDesc(e.target.value)}
                              sx={{ minWidth: 200 }}
                              autoFocus
                            />
                            <Button size="small" variant="contained" onClick={() => editTxnMutation.mutate({ txnId: txn.id, payload: { description: editTxnDesc } })}>
                              Save
                            </Button>
                            <Button size="small" onClick={() => setEditingTxnId(null)}>Cancel</Button>
                          </Stack>
                        ) : (txn.description || '—')}
                      </TableCell>
                      <TableCell><Chip label={REF_TYPE_LABELS[txn.referenceType] ?? txn.referenceType} size="small" variant="outlined" /></TableCell>
                      <TableCell>
                        {editingTxnId !== txn.id && (
                          <IconButton size="small" onClick={() => { setEditingTxnId(txn.id); setEditTxnDesc(txn.description ?? ''); }} title="Edit description">
                            <EditIcon fontSize="small" />
                          </IconButton>
                        )}
                      </TableCell>
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
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatementAccountId(null)}>Close</Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Delete confirmation */}
      <ResponsiveDialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Bank Account?</DialogTitle>
        <DialogContent><Typography>This will soft-delete the account. Transactions will be preserved.</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)} disabled={deleteMutation.isPending}>Delete</Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
