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
  MenuItem,
  Stack,
  FormHelperText,
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
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { enumLabel } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from '../components/ResponsiveDialog';
import ResponsiveTable from '../components/ResponsiveTable';
import RefreshButton from '../components/RefreshButton';
import LedgerAutocomplete, { type LedgerOption } from '../components/LedgerAutocomplete';
import { formatCurrency, formatIndianNumber, formatDate, amountToWords, todayLocalDate } from '../utils/enumOptions';
import { LedgerGroup } from '@hospital-erp/shared';
import { useDeepLinkRow } from '../hooks/useDeepLinkRow';

import { useTranslation, Trans } from 'react-i18next';
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
  referenceId: string | null;
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
  const { t: tr } = useTranslation('bankcash');
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

  // Fetch voucher numbers for the transactions in the current statement page
  const stmtVoucherIds = (statementData?.data ?? []).map((t: BankTransaction) => t.referenceId).filter(Boolean);
  const { data: stmtVouchersData } = useQuery({
    queryKey: ['/vouchers', 'by-ids', stmtVoucherIds.join(',')],
    queryFn: async () => {
      if (stmtVoucherIds.length === 0) return { data: [] };
      const response = await api.get('/vouchers', { params: { page: 1, pageSize: 100, ids: stmtVoucherIds.join(',') } });
      return response.data;
    },
    enabled: stmtVoucherIds.length > 0,
  });
  const voucherNumberMap = new Map<string, string>(
    (stmtVouchersData?.data ?? []).map((v: any) => [v.id, v.jvNumber])
  );

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
      setError(tr('errName'));
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
      setError(tr('errAmount'));
      return;
    }
    if (!txnForm.contraLedgerId) {
      setError(txnType === 'DEPOSIT' ? tr('errFrom') : tr('errTo'));
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
      setError(tr('errBoth'));
      return;
    }
    if (transferForm.fromAccountId === transferForm.toAccountId) {
      setError(tr('errSame'));
      return;
    }
    if (!transferForm.amount || Number(transferForm.amount) <= 0) {
      setError(tr('errAmount'));
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

  // Deep-link from global search: ?id=<bankAccountId> — filter and highlight
  const { highlightId, rowRef } = useDeepLinkRow<BankAccount>('/bank-accounts', rows, 'accountName', (v) => { setSearch(v); setPage(0); });
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
          ${filtersDesc ? `<strong>{tr('filters')}</strong> ${filtersDesc}` : ''}
        </div>
        <table>
          <thead>
            <tr><th>{tr('date')}</th><th>{tr('type')}</th><th>{tr('description')}</th><th>{tr('ref')}</th><th align="right">{tr('amount')}</th><th align="right">Balance</th></tr>
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

  // ── Export to PDF ──
  const handleExportPDF = () => {
    if (!statementData?.account) return;
    const acc = statementData.account;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // Header
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`Bank Statement - ${acc.accountName}`, 14, 15);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`${acc.bankName ?? ''} ${acc.accountNumber ? `| A/c: ${acc.accountNumber}` : ''}`, 14, 22);
    doc.text(`Opening Balance: Rs. ${Number(acc.openingBalance).toLocaleString('en-IN')}  |  Current Balance: Rs. ${Number(acc.currentBalance).toLocaleString('en-IN')}`, 14, 28);

    // Filters line
    const filtersDesc = [
      stmtStartDate && `From: ${stmtStartDate}`,
      stmtEndDate && `To: ${stmtEndDate}`,
      stmtLedgerFilter && `Ledger: ${ledgers.find((l) => l.id === stmtLedgerFilter)?.name ?? ''}`,
      stmtTypeFilter && `Type: ${TXN_TYPE_LABELS[stmtTypeFilter] ?? stmtTypeFilter}`,
    ].filter(Boolean).join(' | ');
    if (filtersDesc) {
      doc.setFont('helvetica', 'italic');
      doc.text(`Filters: ${filtersDesc}`, 14, 34);
      doc.setFont('helvetica', 'normal');
    }

    // Table
    const tableData = stmtRows.map((t: BankTransaction) => {
      const isIn = ['DEPOSIT', 'TRANSFER_IN', 'REVERSAL_IN'].includes(t.type);
      return [
        formatDate(t.date),
        TXN_TYPE_LABELS[t.type] ?? t.type,
        t.description ?? '—',
        REF_TYPE_LABELS[t.referenceType] ?? t.referenceType,
        `${isIn ? '+' : '-'}Rs. ${Number(t.amount).toLocaleString('en-IN')}`,
        `Rs. ${Number(t.balanceAfter).toLocaleString('en-IN')}`,
      ];
    });

    autoTable(doc, {
      head: [['Date', 'Type', 'Description', 'Ref', 'Amount', 'Balance After']],
      body: tableData,
      startY: filtersDesc ? 38 : 32,
      theme: 'striped',
      headStyles: { fillColor: [66, 66, 66], fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 25 },
        2: { cellWidth: 60 },
        3: { cellWidth: 25 },
        4: { cellWidth: 30, halign: 'right' },
        5: { cellWidth: 30, halign: 'right' },
      },
    });

    // Footer
    const finalY = (doc as any).lastAutoTable?.finalY ?? 50;
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Generated on ${new Date().toLocaleString('en-IN')}`, 14, finalY + 8);

    doc.save(`bank-statement-${acc.accountName}-${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          {tr('bankTitle')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <RefreshButton onClick={() => refetch()} />
          <Button variant="outlined" startIcon={<TransferIcon />} onClick={openTransfer}>{tr('transfer')}</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{tr('newAccount')}</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Card sx={{ overflow: 'hidden' }}>
        <Box sx={{ p: 2 }}>
          <TextField
            size="small"
            placeholder={tr('searchBank')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />
        </Box>

        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ '@media (min-width: 900px)': { minWidth: 'max-content', '& .MuiTableCell-root': { whiteSpace: 'nowrap' } } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{tr('bankName')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('accountName')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('accountNo')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('ifsc')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">{tr('opening')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">{tr('currentBalance')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('status')}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : isError ? (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                  <Alert severity="error" sx={{ mb: 1 }}>{tr('errLoad')}</Alert>
                  <Button size="small" onClick={() => refetch()} startIcon={<RefreshIcon />}>{tr('retry')}</Button>
                </TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">{tr('noBank')}</Typography>
                </TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} hover ref={rowRef(row.id)} sx={{ ...(highlightId === row.id && { bgcolor: 'warning.light', '&:hover': { bgcolor: 'warning.light' } }) }}>
                    <TableCell data-label={tr('bankName')} sx={{ fontWeight: 600 }}>{row.bankName || row.accountName}</TableCell>
                    <TableCell data-label={tr('accountName')}>{row.accountName}</TableCell>
                    <TableCell data-label={tr('accountNo')}>{row.accountNumber || '—'}</TableCell>
                    <TableCell data-label={tr('ifsc')}>{row.ifscCode || '—'}</TableCell>
                    <TableCell data-label={tr('opening')} align="right">{formatCurrency(row.openingBalance)}</TableCell>
                    <TableCell data-label={tr('currentBalance')} align="right" sx={{ fontWeight: 600, color: 'success.main' }}>{formatCurrency(row.currentBalance)}</TableCell>
                    <TableCell data-label={tr('status')}><Chip label={row.isActive ? tr('active') : tr('inactive')} size="small" color={row.isActive ? 'success' : 'default'} /></TableCell>
                    <TableCell data-label={tr('actions')} align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <CommentsButton entityType="BANK_ACCOUNT" entityId={row.id} entityLabel={row.bankName || row.accountName} url="/bank-accounts" />
                        <IconButton size="small" title={tr('statement')} onClick={() => { setStatementAccountId(row.id); setStmtPage(0); }}><StatementIcon fontSize="small" /></IconButton>
                        <IconButton size="small" title={tr('deposit')} onClick={() => openTxnDialog(row.id, 'DEPOSIT')}><DepositIcon fontSize="small" color="success" /></IconButton>
                        <IconButton size="small" title={tr('withdraw')} onClick={() => openTxnDialog(row.id, 'WITHDRAWAL')}><WithdrawIcon fontSize="small" color="error" /></IconButton>
                        <IconButton size="small" title={tr('edit')} onClick={() => openEdit(row)}><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" title={tr('delete')} onClick={() => setDeleteConfirm(row.id)}><DeleteIcon fontSize="small" /></IconButton>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        </ResponsiveTable>

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
        <DialogTitle>{editing ? tr('editBank') : tr('newBank')}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField label={tr('accountName')} value={form.accountName ?? ''} onChange={(e) => setForm({ ...form, accountName: e.target.value })} required size="small" />
            <TextField label={tr('bankName')} value={form.bankName ?? ''} onChange={(e) => setForm({ ...form, bankName: e.target.value })} size="small" />
            <TextField label={tr('accountNumber')} value={form.accountNumber ?? ''} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} size="small" />
            <TextField label={tr('ifscCode')} value={form.ifscCode ?? ''} onChange={(e) => setForm({ ...form, ifscCode: e.target.value })} size="small" />
            {!editing && (
              <TextField
                label={tr('openingBalance')}
                type="text"
                value={formatIndianNumber(form.openingBalance ?? '')}
                onChange={(e) => setForm({ ...form, openingBalance: e.target.value.replace(/,/g, '') })}
                size="small"
                InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
              />
            )}
            {editing && (
              <TextField select label={tr('status')} value={form.isActive ?? true} onChange={(e) => setForm({ ...form, isActive: e.target.value === 'true' })} size="small">
                <MenuItem value="true">{tr('active')}</MenuItem>
                <MenuItem value="false">{tr('inactive')}</MenuItem>
              </TextField>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>{tr('cancel')}</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
            {createMutation.isPending || updateMutation.isPending ? <CircularProgress size={20} /> : editing ? tr('update') : tr('create')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Deposit/Withdraw dialog — Tally-style with contra ledger picker */}
      <ResponsiveDialog open={txnDialogOpen} onClose={() => setTxnDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{txnType === 'DEPOSIT' ? tr('depositTitle') : tr('withdrawTitle')}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {/* Contra ledger — the other side of the double entry */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {txnType === 'DEPOSIT' ? tr('recvFrom') : tr('paidTo')}
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
                placeholder={txnType === 'DEPOSIT' ? tr('phSource') : tr('phDest')}
                onError={(msg) => setError(msg)}
              />
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{tr('amount')}</Typography>
              <TextField
                fullWidth
                type="text"
                value={formatIndianNumber(txnForm.amount ?? '')}
                onChange={(e) => setTxnForm({ ...txnForm, amount: e.target.value.replace(/,/g, '') })}
                required
                size="small"
                inputProps={{ style: { textAlign: 'right' }, inputMode: 'decimal' }}
                InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
                placeholder={tr('000')}
              />
              {Number(txnForm.amount) > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontStyle: 'italic' }}>
                  {amountToWords(txnForm.amount)}
                </Typography>
              )}
            </Box>

            <TextField label={tr('date')} type="date" value={txnForm.date ?? ''} onChange={(e) => setTxnForm({ ...txnForm, date: e.target.value })} size="small" InputLabelProps={{ shrink: true }} inputProps={{ max: todayLocalDate() }} />
            <Box>
              <TextField label={tr('description')} value={txnForm.description ?? ''} onChange={(e) => setTxnForm({ ...txnForm, description: e.target.value })} size="small" multiline rows={2} fullWidth />
              <FormHelperText><Trans t={tr} i18nKey="formatHelp" components={{ b: <strong /> }} /></FormHelperText>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTxnDialogOpen(false)}>{tr('cancel')}</Button>
          <Button variant="contained" onClick={handleTxnSubmit} disabled={txnMutation.isPending}>
            {txnMutation.isPending ? <CircularProgress size={20} /> : txnType === 'DEPOSIT' ? 'Deposit' : 'Withdraw'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Transfer dialog */}
      <ResponsiveDialog open={transferOpen} onClose={() => setTransferOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('xferBankTitle')}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField select label={tr('fromAccount')} value={transferForm.fromAccountId ?? ''} onChange={(e) => setTransferForm({ ...transferForm, fromAccountId: e.target.value })} size="small">
              {rows.map((acc) => <MenuItem key={acc.id} value={acc.id}>{acc.bankName || acc.accountName} ({formatCurrency(acc.currentBalance)})</MenuItem>)}
            </TextField>
            <TextField select label={tr('toAccount')} value={transferForm.toAccountId ?? ''} onChange={(e) => setTransferForm({ ...transferForm, toAccountId: e.target.value })} size="small">
              {rows.map((acc) => <MenuItem key={acc.id} value={acc.id}>{acc.bankName || acc.accountName} ({formatCurrency(acc.currentBalance)})</MenuItem>)}
            </TextField>
            <TextField
              label={tr('amount')}
              type="text"
              value={formatIndianNumber(transferForm.amount ?? '')}
              onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value.replace(/,/g, '') })}
              required
              size="small"
              InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
            />
            <TextField label={tr('date')} type="date" value={transferForm.date ?? ''} onChange={(e) => setTransferForm({ ...transferForm, date: e.target.value })} size="small" InputLabelProps={{ shrink: true }} inputProps={{ max: todayLocalDate() }} />
            <Box>
              <TextField label={tr('description')} value={transferForm.description ?? ''} onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })} size="small" multiline rows={2} fullWidth />
              <FormHelperText><Trans t={tr} i18nKey="formatHelp" components={{ b: <strong /> }} /></FormHelperText>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTransferOpen(false)}>{tr('cancel')}</Button>
          <Button variant="contained" onClick={handleTransferSubmit} disabled={transferMutation.isPending}>
            {transferMutation.isPending ? <CircularProgress size={20} /> : 'Transfer'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Statement dialog */}
      <ResponsiveDialog open={!!statementAccountId} onClose={() => setStatementAccountId(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" gap={1}>
            <Stack direction="row" alignItems="center" gap={1}>
              <BankIcon /><Typography variant="h6">{tr('bankStatement')}</Typography>
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button size="small" startIcon={<PrintIcon />} onClick={() => handlePrintStatement(false)}>
                {hasFilters ? tr('print') : tr('printPage')}
              </Button>
              <Button size="small" startIcon={<DownloadIcon />} onClick={handleExportPDF}>
                {tr('pdf')}
              </Button>
              <Button size="small" startIcon={<DownloadIcon />} onClick={handleExportCSV}>
                {tr('csv')}
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
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2, alignItems: 'center' }}>
            <TextField
              size="small"
              type="date"
              label={tr('fromDate')}
              value={stmtStartDate}
              onChange={(e) => { setStmtStartDate(e.target.value); setStmtPage(0); }}
              InputLabelProps={{ shrink: true }}
              sx={{ width: { xs: '100%', sm: 150 }, flex: { xs: '1 1 100%', sm: '0 0 auto' } }}
            />
            <TextField
              size="small"
              type="date"
              label={tr('toDate')}
              value={stmtEndDate}
              onChange={(e) => { setStmtEndDate(e.target.value); setStmtPage(0); }}
              InputLabelProps={{ shrink: true }}
              sx={{ width: { xs: '100%', sm: 150 }, flex: { xs: '1 1 100%', sm: '0 0 auto' } }}
            />
            <TextField
              size="small"
              select
              label={tr('type')}
              value={stmtTypeFilter}
              onChange={(e) => { setStmtTypeFilter(e.target.value); setStmtPage(0); }}
              sx={{ width: { xs: '100%', sm: 140 }, flex: { xs: '1 1 100%', sm: '0 0 auto' } }}
            >
              <MenuItem value="">{tr('allTypes')}</MenuItem>
              {Object.keys(TXN_TYPE_LABELS).map((val) => <MenuItem key={val} value={val}>{enumLabel(val)}</MenuItem>)}
            </TextField>
            <TextField
              size="small"
              select
              label={tr('ledger')}
              value={stmtLedgerFilter}
              onChange={(e) => { setStmtLedgerFilter(e.target.value); setStmtPage(0); }}
              sx={{ width: { xs: '100%', sm: 180 }, flex: { xs: '1 1 100%', sm: '0 0 auto' } }}
            >
              <MenuItem value="">{tr('allLedgers')}</MenuItem>
              {ledgers.map((l) => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
            </TextField>
            {hasFilters && (
              <Button size="small" onClick={() => { setStmtStartDate(''); setStmtEndDate(''); setStmtLedgerFilter(''); setStmtTypeFilter(''); setStmtPage(0); }}>
                {tr('clearFilters')}
              </Button>
            )}
          </Box>

          <ResponsiveTable>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('date')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('type')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">{tr('amount')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">{tr('balanceAfter')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('description')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('voucherNo')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('ref')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stmtLoading ? (
                  <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={24} /></TableCell></TableRow>
                ) : stmtRows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} align="center"><Typography color="text.secondary">{tr('noTransactions')}</Typography></TableCell></TableRow>
                ) : (
                  stmtRows.map((txn) => (
                    <TableRow key={txn.id} hover>
                      <TableCell data-label={tr('date')}>{formatDate(txn.date)}</TableCell>
                      <TableCell data-label={tr('type')}><Chip label={enumLabel(txn.type)} size="small" color={TXN_TYPE_COLORS[txn.type] ?? 'default'} /></TableCell>
                      <TableCell data-label={tr('amount')} align="right" sx={{ color: ['DEPOSIT', 'TRANSFER_IN', 'REVERSAL_IN'].includes(txn.type) ? 'success.main' : 'error.main', fontWeight: 600 }}>
                        {['DEPOSIT', 'TRANSFER_IN', 'REVERSAL_IN'].includes(txn.type) ? '+' : '−'}{formatCurrency(txn.amount)}
                      </TableCell>
                      <TableCell data-label={tr('balanceAfter')} align="right">{formatCurrency(txn.balanceAfter)}</TableCell>
                      <TableCell data-label={tr('description')}>
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
                              {tr('save')}
                            </Button>
                            <Button size="small" onClick={() => setEditingTxnId(null)}>{tr('cancel')}</Button>
                          </Stack>
                        ) : (txn.description || '—')}
                      </TableCell>
                      <TableCell data-label={tr('voucherNo')} sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
                        {txn.referenceId ? (voucherNumberMap.get(txn.referenceId) ?? '—') : '—'}
                      </TableCell>
                      <TableCell data-label={tr('ref')}><Chip label={tr(`ref_${txn.referenceType}`, { defaultValue: REF_TYPE_LABELS[txn.referenceType] ?? txn.referenceType })} size="small" variant="outlined" /></TableCell>
                      <TableCell data-label={tr('edit')}>
                        {editingTxnId !== txn.id && (
                          <IconButton size="small" onClick={() => { setEditingTxnId(txn.id); setEditTxnDesc(txn.description ?? ''); }} title={tr('editDescription')}>
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
          </ResponsiveTable>
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
          <Button onClick={() => setStatementAccountId(null)}>{tr('close')}</Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Delete confirmation */}
      <ResponsiveDialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{tr('delBankQ')}</DialogTitle>
        <DialogContent><Typography>{tr('deleteNote')}</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>{tr('cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)} disabled={deleteMutation.isPending}>{tr('delete')}</Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
