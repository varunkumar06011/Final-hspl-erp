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
  Select,
  Stack,
  Tooltip,
  Dialog,
  Divider,
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
  ContentCopy as DuplicateIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from '../components/ResponsiveDialog';
import RefreshButton from '../components/RefreshButton';
import { formatCurrency, formatIndianNumber, formatDate, amountToWords } from '../utils/enumOptions';
import { VoucherType, LedgerGroup } from '@hospital-erp/shared';
import LedgerAutocomplete, { type LedgerOption } from '../components/LedgerAutocomplete';

interface Ledger {
  id: string;
  name: string;
  group: string;
  currentBalance: number;
  isActive: boolean;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
}

interface VoucherEntry {
  ledgerName: string;
  ledgerGroup: string;
  debit: number;
  credit: number;
  description: string | null;
  budgetHead: { id: string; particulars: string } | null;
}

interface BillSettlement {
  id: string;
  amount: number;
  voucher: { id: string; jvNumber: string; voucherType: string; date: string; status: string };
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
  billSettlements?: BillSettlement[];
}

interface EntryForm {
  ledgerId: string;
  ledgerName: string;
  ledgerGroup: string;
  debit: string;
  credit: string;
  description: string;
  budgetHeadId: string;
}

interface BudgetHead {
  id: string;
  particulars: string;
}

interface PendingInvoice {
  id: string;
  invoiceCode: string;
  invoiceNumber: string;
  vendorId: string;
  vendorName: string;
  totalAmount: number;
  totalSettled: number;
  outstanding: number;
}

interface BillSettlementForm {
  invoiceId: string;
  amount: string;
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
  // Bill-wise settlement (for PAYMENT vouchers paying a vendor)
  const [billSettlements, setBillSettlements] = useState<BillSettlementForm[]>([]);
  // Cost center popup state (Tally-style: popup after amount entry)
  const [costCenterPopup, setCostCenterPopup] = useState<{ entryIndex: number } | null>(null);
  // Bill settlement popup state (Tally-style: popup when paying a vendor)
  const [billPopupOpen, setBillPopupOpen] = useState(false);

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

  // Fetch all ledgers for entry selection (include inactive — Tally shows all)
  const { data: ledgersData } = useQuery({
    queryKey: ['/ledgers', 'all-for-voucher'],
    queryFn: async () => {
      const response = await api.get('/ledgers', { params: { page: 1, pageSize: 500 } });
      return response.data;
    },
  });

  // Fetch budget heads for cost center allocation
  const { data: budgetHeadsData } = useQuery({
    queryKey: ['/budget-heads', 'all-active'],
    queryFn: async () => {
      const response = await api.get('/budget-heads', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
  });

  // Fetch pending vendor invoices for bill-wise settlement (only for PAYMENT vouchers)
  const { data: pendingInvoicesData } = useQuery({
    queryKey: ['/invoices', 'pending-for-settlement'],
    queryFn: async () => {
      const response = await api.get('/invoices', { params: { page: 1, pageSize: 100, verificationStatus: 'VERIFIED' } });
      return response.data;
    },
    enabled: selectedVoucherType === VoucherType.PAYMENT && createOpen,
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
      { ledgerId: '', ledgerName: '', ledgerGroup: '', debit: '', credit: '', description: '', budgetHeadId: '' },
      { ledgerId: '', ledgerName: '', ledgerGroup: '', debit: '', credit: '', description: '', budgetHeadId: '' },
    ]);
    setBillSettlements([]);
    setCostCenterPopup(null);
    setBillPopupOpen(false);
    setError('');
  };

  const openCreate = (type: VoucherType) => {
    setSelectedVoucherType(type);
    resetForm();
    setCreateOpen(true);
  };

  // Duplicate a voucher — opens create dialog pre-filled with the voucher's data
  const duplicateVoucher = (voucher: Voucher) => {
    setSelectedVoucherType(voucher.voucherType as VoucherType);
    setVoucherDate(new Date().toISOString().split('T')[0]); // today, not the original date
    setVoucherDescription(voucher.description ?? '');
    setEntries(
      voucher.entries.map((e) => ({
        ledgerId: '', // can't reuse ledger IDs from detail — user must re-select
        ledgerName: e.ledgerName,
        ledgerGroup: e.ledgerGroup,
        debit: String(e.debit),
        credit: String(e.credit),
        description: e.description ?? '',
        budgetHeadId: '',
      })),
    );
    setBillSettlements([]);
    setError('');
    setDetailVoucher(null);
    setCreateOpen(true);
  };

  const addEntry = () => {
    setEntries([...entries, { ledgerId: '', ledgerName: '', ledgerGroup: '', debit: '', credit: '', description: '', budgetHeadId: '' }]);
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

  // Handle ledger selection from Autocomplete
  const selectLedger = (index: number, ledgerId: string, ledger: LedgerOption | null) => {
    const updated = [...entries];
    updated[index] = {
      ...updated[index],
      ledgerId,
      ledgerName: ledger?.name ?? '',
      ledgerGroup: ledger?.group ?? '',
    };
    setEntries(updated);
  };

  // ── Tally-style smart defaults ──
  // For Payment: row 0 = Dr (party/expense), row 1 = Cr (Cash/Bank auto)
  // For Receipt: row 0 = Cr (party/income), row 1 = Dr (Cash/Bank auto)
  // For Contra: both rows = Bank/Cash only
  // For Journal: free entry
  const isSimpleVoucher = selectedVoucherType === VoucherType.PAYMENT
    || selectedVoucherType === VoucherType.RECEIPT
    || selectedVoucherType === VoucherType.CONTRA;

  // Which side does the user enter amount on? (row 0)
  const userEntrySide: 'debit' | 'credit' = selectedVoucherType === VoucherType.PAYMENT ? 'debit' : 'credit';
  // Which side is auto-filled? (row 1)
  const autoSide: 'debit' | 'credit' = userEntrySide === 'debit' ? 'credit' : 'debit';

  // For Contra, both sides are Bank/Cash
  const contraGroups = [LedgerGroup.BANK, LedgerGroup.CASH];
  // For Payment/Receipt, the auto side is Bank/Cash
  const cashBankGroups = [LedgerGroup.BANK, LedgerGroup.CASH];

  // Auto-balance: when user enters amount on row 0, auto-fill row 1
  const handleAmountChange = (index: number, field: 'debit' | 'credit', value: string) => {
    const updated = [...entries];
    updated[index] = { ...updated[index], [field]: value.replace(/,/g, '') };
    // Clear the other side on this row
    const otherSide = field === 'debit' ? 'credit' : 'debit';
    updated[index][otherSide] = '';

    // For simple vouchers (Payment/Receipt/Contra) with exactly 2 rows:
    // auto-fill the opposite side on the other row
    if (isSimpleVoucher && entries.length === 2) {
      const otherIndex = index === 0 ? 1 : 0;
      const numValue = Number(value.replace(/,/g, '')) || 0;
      if (field === userEntrySide) {
        // User entered amount on their side → auto-fill the auto side on the other row
        updated[otherIndex][userEntrySide] = '';
        updated[otherIndex][autoSide] = String(numValue);
      } else if (field === autoSide && index === 1) {
        // User manually changed the auto side → back-fill the user side on row 0
        updated[0][userEntrySide] = String(numValue);
        updated[0][autoSide] = '';
      }
    }
    setEntries(updated);
  };

  const ledgerIsExpense = (group: string) => {
    return group === LedgerGroup.DIRECT_EXPENSE || group === LedgerGroup.INDIRECT_EXPENSE || group === LedgerGroup.PURCHASE;
  };

  const totalDebit = entries.reduce((sum, e) => sum + (Number(e.debit) || 0), 0);
  const totalCredit = entries.reduce((sum, e) => sum + (Number(e.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;
  const balanceDiff = totalDebit - totalCredit;

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
    // Validate bill settlements
    const validSettlements = billSettlements.filter((s) => s.invoiceId && Number(s.amount) > 0);
    const settlementTotal = validSettlements.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    if (settlementTotal > totalCredit + 0.01) {
      setError(`Bill settlement total (${formatIndianNumber(settlementTotal)}) cannot exceed total credit (${formatIndianNumber(totalCredit)})`);
      return;
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
        budgetHeadId: e.budgetHeadId || undefined,
      })),
      billSettlements: validSettlements.length > 0
        ? validSettlements.map((s) => ({ invoiceId: s.invoiceId, amount: Number(s.amount) }))
        : undefined,
    };
    createMutation.mutate(payload);
  };

  // Map backend response (ledgerEntries with nested ledger) to frontend Voucher format (entries with flat fields)
  const mapVoucher = (v: any): Voucher => ({
    id: v.id,
    jvNumber: v.jvNumber,
    voucherType: v.voucherType,
    date: v.date,
    description: v.description,
    totalDebit: Number(v.totalDebit),
    totalCredit: Number(v.totalCredit),
    status: v.status,
    createdBy: v.createdByUser?.name ?? v.createdBy ?? '—',
    entries: (v.ledgerEntries ?? []).map((le: any) => ({
      ledgerName: le.ledger?.name ?? '',
      ledgerGroup: le.ledger?.group ?? '',
      debit: Number(le.debit),
      credit: Number(le.credit),
      description: le.description,
      budgetHead: le.budgetHead ? { id: le.budgetHead.id, particulars: le.budgetHead.particulars } : null,
    })),
    billSettlements: (v.billSettlements ?? []).map((bs: any) => ({
      id: bs.id,
      amount: Number(bs.amount),
      voucher: bs.journalVoucher ?? { id: '', jvNumber: '', voucherType: '', date: '', status: '' },
    })),
  });

  const rows: Voucher[] = (data?.data ?? []).map(mapVoucher);
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const ledgers: Ledger[] = ledgersData?.data ?? [];
  const budgetHeads: BudgetHead[] = budgetHeadsData?.data ?? [];
  const pendingInvoices: PendingInvoice[] = (pendingInvoicesData?.data ?? []).map((inv: any) => ({
    id: inv.id,
    invoiceCode: inv.invoiceCode,
    invoiceNumber: inv.invoiceNumber,
    vendorId: inv.vendorId,
    vendorName: inv.vendor?.name ?? '',
    totalAmount: Number(inv.totalAmount),
    totalSettled: 0,
    outstanding: Number(inv.totalAmount),
  }));

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
                        <Tooltip title="Duplicate"><IconButton size="small" onClick={() => duplicateVoucher(v)}><DuplicateIcon fontSize="small" /></IconButton></Tooltip>
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

      {/* ── Create voucher dialog — Tally-style ── */}
      <ResponsiveDialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {VOUCHER_TYPES.find((vt) => vt.value === selectedVoucherType)?.label ?? 'Voucher'}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {VOUCHER_TYPES.find((vt) => vt.value === selectedVoucherType)?.desc}
          </Typography>
        </DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          {/* Date — Tally shows date at top */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2, mt: 1 }}>
            <TextField
              size="small"
              type="date"
              label="Date"
              value={voucherDate}
              onChange={(e) => setVoucherDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 180 }}
            />
          </Box>

          {/* ── Entry table — Tally-style ── */}
          <TableContainer component={Card} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 600, width: '40%' }}>Particulars</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, width: '15%' }}>Debit (Dr)</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, width: '15%' }}>Credit (Cr)</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: '20%' }}>Cost Center</TableCell>
                  <TableCell sx={{ width: '10%' }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((entry, index) => {
                  // For simple vouchers (Payment/Receipt/Contra), determine if this is the "auto" row
                  const isAutoRow = isSimpleVoucher && index === 1;
                  // For Contra, both rows restricted to Bank/Cash
                  const allowedGroups = selectedVoucherType === VoucherType.CONTRA ? contraGroups : undefined;
                  // For the auto row in Payment/Receipt, restrict to Bank/Cash
                  const autoRowGroups = isAutoRow ? cashBankGroups : undefined;
                  // For the user row in Payment, show party/expense ledgers first
                  const preferredGroups = selectedVoucherType === VoucherType.PAYMENT
                    ? [LedgerGroup.SUNDRY_CREDITORS, LedgerGroup.DIRECT_EXPENSE, LedgerGroup.INDIRECT_EXPENSE]
                    : selectedVoucherType === VoucherType.RECEIPT
                    ? [LedgerGroup.SUNDRY_DEBTORS, LedgerGroup.INDIRECT_INCOME, LedgerGroup.DIRECT_INCOME, LedgerGroup.SALES]
                    : undefined;

                  return (
                    <TableRow key={index} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                      <TableCell>
                        <LedgerAutocomplete
                          value={entry.ledgerId}
                          onChange={(ledgerId, ledger) => selectLedger(index, ledgerId, ledger)}
                          ledgers={ledgers as LedgerOption[]}
                          allowedGroups={autoRowGroups ?? allowedGroups}
                          preferredGroups={preferredGroups}
                          autoFocus={index === 0}
                          placeholder={isAutoRow ? 'Cash / Bank account...' : 'Type ledger name...'}
                          onError={(msg) => setError(msg)}
                        />
                        {/* Show ledger group as a small chip below the autocomplete */}
                        {entry.ledgerGroup && (
                          <Chip
                            label={entry.ledgerGroup.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                            size="small"
                            variant="outlined"
                            sx={{ mt: 0.5, fontSize: '0.65rem', height: 18 }}
                          />
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          size="small"
                          value={formatIndianNumber(entry.debit)}
                          onChange={(e) => handleAmountChange(index, 'debit', e.target.value)}
                          sx={{ width: 130 }}
                          inputProps={{ style: { textAlign: 'right' }, inputMode: 'decimal' }}
                          placeholder={isAutoRow && selectedVoucherType === VoucherType.RECEIPT ? 'auto' : ''}
                          disabled={isAutoRow && selectedVoucherType === VoucherType.PAYMENT}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          size="small"
                          value={formatIndianNumber(entry.credit)}
                          onChange={(e) => handleAmountChange(index, 'credit', e.target.value)}
                          sx={{ width: 130 }}
                          inputProps={{ style: { textAlign: 'right' }, inputMode: 'decimal' }}
                          placeholder={isAutoRow && selectedVoucherType === VoucherType.PAYMENT ? 'auto' : ''}
                          disabled={isAutoRow && selectedVoucherType === VoucherType.RECEIPT}
                        />
                      </TableCell>
                      <TableCell>
                        {/* Cost center: show as chip if set, or a small "Set" button for expense ledgers */}
                        {entry.budgetHeadId ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Chip
                              label={budgetHeads.find((b) => b.id === entry.budgetHeadId)?.particulars ?? 'CC'}
                              size="small"
                              color="primary"
                              variant="outlined"
                              onDelete={() => updateEntry(index, 'budgetHeadId', '')}
                            />
                          </Box>
                        ) : ledgerIsExpense(entry.ledgerGroup) && budgetHeads.length > 0 ? (
                          <Button
                            size="small"
                            onClick={() => setCostCenterPopup({ entryIndex: index })}
                            sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                          >
                            Set Cost Center
                          </Button>
                        ) : (
                          <Typography variant="caption" color="text.disabled">—</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {entries.length > 2 && (
                          <IconButton size="small" onClick={() => removeEntry(index)}><CancelIcon fontSize="small" /></IconButton>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              {/* Footer with totals — Tally-style */}
              <TableHead>
                <TableRow sx={{ borderTop: 2, borderColor: 'divider' }}>
                  <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: isBalanced ? 'success.main' : 'error.main' }}>{formatCurrency(totalDebit)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: isBalanced ? 'success.main' : 'error.main' }}>{formatCurrency(totalCredit)}</TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
                {balanceDiff !== 0 && (
                  <TableRow>
                    <TableCell colSpan={2} align="right" sx={{ color: 'error.main', fontSize: '0.8rem' }}>
                      {balanceDiff > 0 ? 'Excess Debit:' : 'Excess Credit:'}
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'error.main', fontWeight: 600, fontSize: '0.8rem' }}>
                      {formatCurrency(Math.abs(balanceDiff))}
                    </TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                )}
              </TableHead>
            </Table>
          </TableContainer>

          {/* Amount in words — Tally-style */}
          {totalDebit > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontStyle: 'italic' }}>
              {amountToWords(totalDebit)}
            </Typography>
          )}

          {/* Add row — only for Journal / multi-line vouchers */}
          {(!isSimpleVoucher || entries.length > 2) && (
            <Button startIcon={<AddIcon />} onClick={addEntry} sx={{ mt: 1 }}>Add Row</Button>
          )}

          {/* Narration — single field at bottom (Tally-style) */}
          <TextField
            fullWidth
            size="small"
            label="Narration"
            value={voucherDescription}
            onChange={(e) => setVoucherDescription(e.target.value)}
            sx={{ mt: 2 }}
            placeholder="Enter narration for this voucher..."
          />

          {/* Bill-wise settlement button — only for Payment vouchers with vendor on Dr side */}
          {selectedVoucherType === VoucherType.PAYMENT && pendingInvoices.length > 0 && (
            <Box sx={{ mt: 2 }}>
              {billSettlements.length > 0 ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="body2" fontWeight={500}>Bill-wise Settlements:</Typography>
                  {billSettlements.map((bs, idx) => {
                    const inv = pendingInvoices.find((i) => i.id === bs.invoiceId);
                    return inv ? (
                      <Chip
                        key={idx}
                        label={`${inv.invoiceCode}: ₹${formatIndianNumber(Number(bs.amount) || 0)}`}
                        size="small"
                        onDelete={() => setBillSettlements(billSettlements.filter((_, i) => i !== idx))}
                      />
                    ) : null;
                  })}
                  <Button size="small" onClick={() => setBillPopupOpen(true)}>Edit</Button>
                </Box>
              ) : (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setBillPopupOpen(true)}
                >
                  Link to Vendor Invoices (Bill-wise)
                </Button>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={createMutation.isPending || !isBalanced}>
            {createMutation.isPending ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* ── Cost center popup (Tally-style: appears when allocating expense) ── */}
      <Dialog
        open={costCenterPopup !== null}
        onClose={() => setCostCenterPopup(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Allocate to Cost Center</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select a budget head for this expense entry.
          </Typography>
          <Select
            fullWidth
            value={costCenterPopup ? entries[costCenterPopup.entryIndex]?.budgetHeadId ?? '' : ''}
            onChange={(e) => {
              if (costCenterPopup) {
                updateEntry(costCenterPopup.entryIndex, 'budgetHeadId', e.target.value);
              }
            }}
            displayEmpty
          >
            <MenuItem value=""><em>No cost center</em></MenuItem>
            {budgetHeads.map((bh) => (
              <MenuItem key={bh.id} value={bh.id}>{bh.particulars}</MenuItem>
            ))}
          </Select>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCostCenterPopup(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => setCostCenterPopup(null)}
          >
            Done
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Bill-wise settlement popup (Tally-style: appears when paying a vendor) ── */}
      <Dialog
        open={billPopupOpen}
        onClose={() => setBillPopupOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Bill-wise Settlement</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select which vendor invoices this payment settles. The total should match the payment amount.
          </Typography>
          {pendingInvoices.map((inv) => {
            const existing = billSettlements.find((bs) => bs.invoiceId === inv.id);
            return (
              <Box key={inv.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2">{inv.invoiceCode} — {inv.vendorName}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Outstanding: ₹{formatIndianNumber(inv.outstanding)}
                  </Typography>
                </Box>
                <TextField
                  size="small"
                  value={existing ? formatIndianNumber(existing.amount) : ''}
                  onChange={(e) => {
                    const amount = e.target.value.replace(/,/g, '');
                    const updated = billSettlements.filter((bs) => bs.invoiceId !== inv.id);
                    if (amount && Number(amount) > 0) {
                      updated.push({ invoiceId: inv.id, amount });
                    }
                    setBillSettlements(updated);
                  }}
                  sx={{ width: 130 }}
                  inputProps={{ style: { textAlign: 'right' }, inputMode: 'decimal' }}
                  placeholder="0"
                />
              </Box>
            );
          })}
          <Divider sx={{ my: 1 }} />
          <Typography variant="body2" fontWeight={600}>
            Settlement Total: ₹{formatIndianNumber(billSettlements.reduce((s, bs) => s + (Number(bs.amount) || 0), 0))}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBillPopupOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

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
                      <TableCell>Cost Center</TableCell>
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
                        <TableCell>{entry.budgetHead ? <Chip label={entry.budgetHead.particulars} size="small" color="primary" variant="outlined" /> : '—'}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={2} align="right" sx={{ fontWeight: 600 }}>Total</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(detailVoucher.totalDebit)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(detailVoucher.totalCredit)}</TableCell>
                      <TableCell />
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>

              {/* Amount in words — Tally-style */}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontStyle: 'italic' }}>
                {amountToWords(detailVoucher.totalDebit)}
              </Typography>

              {/* Bill settlements section */}
              {detailVoucher.billSettlements && detailVoucher.billSettlements.length > 0 && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="subtitle2" gutterBottom>Bill-wise Settlements</Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Voucher</TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell align="right">Amount Settled</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detailVoucher.billSettlements.map((bs) => (
                        <TableRow key={bs.id}>
                          <TableCell>{bs.voucher.jvNumber}</TableCell>
                          <TableCell>{new Date(bs.voucher.date).toLocaleDateString()}</TableCell>
                          <TableCell align="right">{formatCurrency(bs.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
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
              <Button startIcon={<DuplicateIcon />} onClick={() => duplicateVoucher(detailVoucher)}>
                Duplicate
              </Button>
              <Button onClick={() => setDetailVoucher(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </ResponsiveDialog>
    </Box>
  );
}
