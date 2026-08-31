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
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Visibility as ViewIcon,
  Cancel as CancelIcon,
  ArrowDownward as ReceiptIcon,
  ArrowUpward as PaymentIcon,
  SwapHoriz as ContraIcon,
  ReceiptLong as JournalIcon,
  Undo as CreditNoteIcon,
  Description as DebitNoteIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from '../components/ResponsiveDialog';
import RefreshButton from '../components/RefreshButton';
import { formatCurrency, formatIndianNumber, formatDate } from '../utils/enumOptions';
import { VoucherType } from '@hospital-erp/shared';

interface Ledger {
  id: string;
  name: string;
  group: string;
  currentBalance: number;
}

interface VoucherEntry {
  ledgerName: string;
  ledgerGroup: string;
  debit: number;
  credit: number;
  description: string | null;
}

interface Voucher {
  id: string;
  jvNumber: string;
  voucherType: string;
  date: string;
  description: string | null;
  totalDebit: number;
  totalCredit: number;
  status: string;
  createdBy: string;
  entries: VoucherEntry[];
}

interface EntryForm {
  ledgerId: string;
  debit: string;
  credit: string;
  description: string;
}

const VOUCHER_TYPES = [
  { value: VoucherType.RECEIPT, label: 'Receipt (F6)', icon: <ReceiptIcon />, color: 'success' as const, desc: 'Money received — debit bank/cash, credit party/income' },
  { value: VoucherType.PAYMENT, label: 'Payment (F5)', icon: <PaymentIcon />, color: 'error' as const, desc: 'Money paid — debit expense/party, credit bank/cash' },
  { value: VoucherType.CONTRA, label: 'Contra (F4)', icon: <ContraIcon />, color: 'info' as const, desc: 'Bank↔Cash transfer — no P&L impact' },
  { value: VoucherType.JOURNAL, label: 'Journal (F7)', icon: <JournalIcon />, color: 'default' as const, desc: 'Generic adjustment entry' },
  { value: VoucherType.CREDIT_NOTE, label: 'Credit Note', icon: <CreditNoteIcon />, color: 'warning' as const, desc: 'Sales return / vendor refund' },
  { value: VoucherType.DEBIT_NOTE, label: 'Debit Note', icon: <DebitNoteIcon />, color: 'warning' as const, desc: 'Purchase return / expense debit' },
];

const VOUCHER_TYPE_COLORS: Record<string, 'success' | 'error' | 'info' | 'warning' | 'default' | 'primary'> = {
  RECEIPT: 'success',
  PAYMENT: 'error',
  CONTRA: 'info',
  JOURNAL: 'default',
  PURCHASE: 'primary',
  CREDIT_NOTE: 'warning',
  DEBIT_NOTE: 'warning',
};

export default function VouchersPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedVoucherType, setSelectedVoucherType] = useState<VoucherType>(VoucherType.RECEIPT);
  const [voucherDate, setVoucherDate] = useState('');
  const [voucherDescription, setVoucherDescription] = useState('');
  const [entries, setEntries] = useState<EntryForm[]>([]);

  // Detail dialog
  const [detailVoucher, setDetailVoucher] = useState<Voucher | null>(null);

  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['/vouchers', page, pageSize, search, typeFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (typeFilter) params.voucherType = typeFilter;
      const response = await api.get('/vouchers', { params });
      return response.data;
    },
  });

  // Fetch all ledgers for entry selection
  const { data: ledgersData } = useQuery({
    queryKey: ['/ledgers', 'all-active'],
    queryFn: async () => {
      const response = await api.get('/ledgers', { params: { page: 1, pageSize: 500, isActive: true } });
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await api.post('/vouchers', payload);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['/ledgers'] });
      queryClient.invalidateQueries({ queryKey: ['/bank-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/cash-accounts'] });
      setCreateOpen(false);
      setSuccessMsg(`Voucher ${data.jvNumber} posted successfully`);
      setTimeout(() => setSuccessMsg(''), 4000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/vouchers/${id}/cancel`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['/ledgers'] });
      queryClient.invalidateQueries({ queryKey: ['/bank-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/cash-accounts'] });
      setDetailVoucher(null);
      setSuccessMsg('Voucher cancelled and reversed');
      setTimeout(() => setSuccessMsg(''), 4000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const resetForm = () => {
    setVoucherDate('');
    setVoucherDescription('');
    setEntries([
      { ledgerId: '', debit: '', credit: '', description: '' },
      { ledgerId: '', debit: '', credit: '', description: '' },
    ]);
    setError('');
  };

  const openCreate = (type: VoucherType) => {
    setSelectedVoucherType(type);
    resetForm();
    setCreateOpen(true);
  };

  const addEntry = () => {
    setEntries([...entries, { ledgerId: '', debit: '', credit: '', description: '' }]);
  };

  const removeEntry = (index: number) => {
    if (entries.length <= 2) return;
    setEntries(entries.filter((_, i) => i !== index));
  };

  const updateEntry = (index: number, field: keyof EntryForm, value: string) => {
    const updated = [...entries];
    updated[index] = { ...updated[index], [field]: value };
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
    for (let i = 0; i < entries.length; i++) {
      if (!entries[i].ledgerId) {
        setError(`Entry ${i + 1}: Select a ledger`);
        return;
      }
    }
    setError('');
    const payload = {
      voucherType: selectedVoucherType,
      date: voucherDate || undefined,
      description: voucherDescription || undefined,
      entries: entries.map((e) => ({
        ledgerId: e.ledgerId,
        debit: Number(e.debit) || 0,
        credit: Number(e.credit) || 0,
        description: e.description || undefined,
      })),
    };
    createMutation.mutate(payload);
  };

  const rows: Voucher[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const ledgers: Ledger[] = ledgersData?.data ?? [];

  // Group ledgers by group for the dropdown
  const groupedLedgers: Record<string, Ledger[]> = {};
  for (const l of ledgers) {
    if (!groupedLedgers[l.group]) groupedLedgers[l.group] = [];
    groupedLedgers[l.group].push(l);
  }

  return (
    <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          Vouchers
        </Typography>
        <RefreshButton onClick={() => refetch()} />
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      {/* Voucher type cards — Tally-style quick entry buttons */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Create New Voucher</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {VOUCHER_TYPES.map((vt) => (
            <Button
              key={vt.value}
              variant="outlined"
              startIcon={vt.icon}
              onClick={() => openCreate(vt.value)}
              sx={{ borderColor: `${vt.color}.main`, color: `${vt.color}.main` }}
            >
              {vt.label}
            </Button>
          ))}
        </Box>
      </Box>

      {/* Filters */}
      <Card sx={{ overflow: 'hidden', mb: 2 }}>
        <Box sx={{ p: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="Search voucher number..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
            sx={{ width: { xs: '100%', sm: 250 } }}
          />
          <TextField select size="small" label="Type" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }} sx={{ width: 180 }}>
            <MenuItem value="">All Types</MenuItem>
            {VOUCHER_TYPES.map((vt) => <MenuItem key={vt.value} value={vt.value}>{vt.label}</MenuItem>)}
            <MenuItem value="PURCHASE">Purchase (F8)</MenuItem>
          </TextField>
        </Box>
      </Card>

      {/* Voucher list */}
      <Card sx={{ overflow: 'hidden' }}>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ '@media (min-width: 900px)': { minWidth: 'max-content', '& .MuiTableCell-root': { whiteSpace: 'nowrap' } } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Voucher No.</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Amount</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created By</TableCell>
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
                  <Typography color="text.secondary">No vouchers found. Use the buttons above to create a Receipt, Payment, Contra, or Journal voucher.</Typography>
                </TableCell></TableRow>
              ) : (
                rows.map((v) => (
                  <TableRow key={v.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{v.jvNumber}</TableCell>
                    <TableCell>{formatDate(v.date)}</TableCell>
                    <TableCell><Chip label={v.voucherType.replace(/_/g, ' ')} size="small" color={VOUCHER_TYPE_COLORS[v.voucherType] ?? 'default'} /></TableCell>
                    <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.description ?? '—'}</TableCell>
                    <TableCell align="right">{formatCurrency(v.totalDebit)}</TableCell>
                    <TableCell><Chip label={v.status} size="small" color={v.status === 'POSTED' ? 'success' : v.status === 'CANCELLED' ? 'error' : 'default'} /></TableCell>
                    <TableCell>{v.createdBy ?? '—'}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="View Details"><IconButton size="small" onClick={() => setDetailVoucher(v)}><ViewIcon fontSize="small" /></IconButton></Tooltip>
                        {v.status === 'POSTED' && (
                          <Tooltip title="Cancel & Reverse">
                            <IconButton size="small" onClick={() => {
                              if (confirm(`Cancel voucher ${v.jvNumber}? This will reverse all ledger entries.`)) {
                                cancelMutation.mutate(v.id);
                              }
                            }}>
                              <CancelIcon fontSize="small" color="error" />
                            </IconButton>
                          </Tooltip>
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

      {/* Create voucher dialog */}
      <ResponsiveDialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>
          New {VOUCHER_TYPES.find((vt) => vt.value === selectedVoucherType)?.label ?? 'Voucher'}
        </DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {VOUCHER_TYPES.find((vt) => vt.value === selectedVoucherType)?.desc}
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, mb: 2, mt: 1, flexWrap: 'wrap' }}>
            <TextField size="small" type="date" label="Date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" label="Description / Narration" value={voucherDescription} onChange={(e) => setVoucherDescription(e.target.value)} sx={{ minWidth: 300 }} />
          </Box>

          <Typography variant="subtitle2" sx={{ mb: 1 }}>Entries (Debit must equal Credit)</Typography>
          <TableContainer component={Card} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Ledger</TableCell>
                  <TableCell align="right">Debit</TableCell>
                  <TableCell align="right">Credit</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((entry, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <TextField select size="small" value={entry.ledgerId} onChange={(e) => updateEntry(index, 'ledgerId', e.target.value)} sx={{ minWidth: 250 }}>
                        {Object.entries(groupedLedgers).map(([group, groupLedgers]) => [
                          <MenuItem key={group} disabled sx={{ fontWeight: 600, opacity: 0.7 }}>
                            {group.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                          </MenuItem>,
                          ...groupLedgers.map((l) => (
                            <MenuItem key={l.id} value={l.id} sx={{ pl: 3 }}>{l.name}</MenuItem>
                          )),
                        ]).flat()}
                      </TextField>
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        size="small"
                        value={formatIndianNumber(entry.debit)}
                        onChange={(e) => updateEntry(index, 'debit', e.target.value.replace(/,/g, ''))}
                        sx={{ width: 120 }}
                        inputProps={{ style: { textAlign: 'right' } }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        size="small"
                        value={formatIndianNumber(entry.credit)}
                        onChange={(e) => updateEntry(index, 'credit', e.target.value.replace(/,/g, ''))}
                        sx={{ width: 120 }}
                        inputProps={{ style: { textAlign: 'right' } }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField size="small" value={entry.description} onChange={(e) => updateEntry(index, 'description', e.target.value)} sx={{ minWidth: 200 }} />
                    </TableCell>
                    <TableCell>
                      {entries.length > 2 && (
                        <IconButton size="small" onClick={() => removeEntry(index)}><CancelIcon fontSize="small" /></IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Button startIcon={<AddIcon />} onClick={addEntry} sx={{ mt: 1 }}>Add Row</Button>

          <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
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
            {createMutation.isPending ? <CircularProgress size={20} /> : 'Post Voucher'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Detail dialog */}
      <ResponsiveDialog open={!!detailVoucher} onClose={() => setDetailVoucher(null)} maxWidth="md" fullWidth>
        {detailVoucher && (
          <>
            <DialogTitle>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Box>{detailVoucher.jvNumber}</Box>
                <Chip label={detailVoucher.voucherType.replace(/_/g, ' ')} size="small" color={VOUCHER_TYPE_COLORS[detailVoucher.voucherType] ?? 'default'} />
              </Stack>
            </DialogTitle>
            <DialogContent>
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2"><strong>Date:</strong> {formatDate(detailVoucher.date)}</Typography>
                <Typography variant="body2"><strong>Description:</strong> {detailVoucher.description ?? '—'}</Typography>
                <Typography variant="body2"><strong>Created By:</strong> {detailVoucher.createdBy}</Typography>
                <Typography variant="body2"><strong>Status:</strong> <Chip label={detailVoucher.status} size="small" color={detailVoucher.status === 'POSTED' ? 'success' : 'error'} /></Typography>
              </Box>
              <TableContainer component={Card} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Ledger</TableCell>
                      <TableCell>Group</TableCell>
                      <TableCell align="right">Debit</TableCell>
                      <TableCell align="right">Credit</TableCell>
                      <TableCell>Description</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detailVoucher.entries.map((entry, i) => (
                      <TableRow key={i}>
                        <TableCell sx={{ fontWeight: 500 }}>{entry.ledgerName}</TableCell>
                        <TableCell><Chip label={entry.ledgerGroup.replace(/_/g, ' ')} size="small" variant="outlined" /></TableCell>
                        <TableCell align="right" sx={{ color: 'error.main' }}>{entry.debit > 0 ? formatCurrency(entry.debit) : '—'}</TableCell>
                        <TableCell align="right" sx={{ color: 'success.main' }}>{entry.credit > 0 ? formatCurrency(entry.credit) : '—'}</TableCell>
                        <TableCell>{entry.description ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={2} align="right" sx={{ fontWeight: 600 }}>Total</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(detailVoucher.totalDebit)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(detailVoucher.totalCredit)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </DialogContent>
            <DialogActions>
              {detailVoucher.status === 'POSTED' && (
                <Button
                  color="error"
                  startIcon={<CancelIcon />}
                  onClick={() => {
                    if (confirm(`Cancel voucher ${detailVoucher.jvNumber}? This will reverse all ledger entries.`)) {
                      cancelMutation.mutate(detailVoucher.id);
                    }
                  }}
                >
                  Cancel & Reverse
                </Button>
              )}
              <Button onClick={() => setDetailVoucher(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </ResponsiveDialog>
    </Box>
  );
}
