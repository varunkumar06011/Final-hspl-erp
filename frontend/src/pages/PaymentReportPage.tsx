import { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  TextField,
  Button,
  Chip,
  Alert,
  CircularProgress,
  InputAdornment,
  MenuItem,
  TablePagination,
} from '@mui/material';
import {
  Search as SearchIcon,
  Download as DownloadIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { UserRole } from '@hospital-erp/shared';
import api from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { formatCurrency, formatDate, STATUS_COLORS } from '../utils/enumOptions';

interface PaymentRecord {
  id: string;
  paymentCode: string;
  requestNumber: string;
  type: string;
  amount: number;
  status: string;
  paymentMode: string | null;
  description: string | null;
  expenseDate: string | null;
  createdAt: string;
  vendor: { id: string; name: string; vendorCode: string } | null;
  invoice: { id: string; invoiceCode: string; invoiceNumber: string } | null;
  purchaseOrder: { id: string; poNumber: string } | null;
  budgetHead: { id: string; particulars: string } | null;
  createdByUser: { id: string; name: string };
  payments: {
    id: string;
    amount: number;
    mode: string;
    reference: string | null;
    date: string;
    bankAccount: { id: string; accountName: string } | null;
    cashAccount: { id: string; name: string } | null;
  }[];
  approvalWorkflow: {
    id: string;
    status: string;
    steps: { approverUser: { name: string } | null }[];
  } | null;
}

interface Summary {
  totalPaid: number;
  totalPending: number;
  totalApproved: number;
  totalAdvance: number;
  totalInvoice: number;
  totalExpense: number;
  count: number;
  pendingCount: number;
  byBudgetHead: { head: string; amount: number }[];
  byVendor: { vendor: string; amount: number }[];
}

const TYPE_LABELS: Record<string, string> = {
  INVOICE: 'Invoice',
  EXPENSE: 'Expense',
  ADVANCE: 'Advance',
};

const PAYMENT_MODE_LABELS: Record<string, string> = {
  BANK_TRANSFER: 'Bank Transfer',
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  UPI: 'UPI',
  RTGS: 'RTGS',
  NEFT: 'NEFT',
};

export default function PaymentReportPage() {
  const user = useAuthStore((s) => s.user);
  const allowedRoles = [UserRole.PROJECT_HEAD, UserRole.ADMIN, UserRole.ADMIN_2, UserRole.ACCOUNTANT];
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [budgetHeadId, setBudgetHeadId] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  const { data: vendorsData } = useQuery({
    queryKey: ['/vendors', 'for-report'],
    queryFn: async () => {
      const response = await api.get('/vendors', { params: { pageSize: 500 } });
      return response.data;
    },
  });

  const { data: budgetHeadsData } = useQuery({
    queryKey: ['/budget-heads', 'for-report'],
    queryFn: async () => {
      const response = await api.get('/budget-heads', { params: { pageSize: 500 } });
      return response.data;
    },
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['/payment-reports', page, pageSize, search, startDate, endDate, vendorId, budgetHeadId, type, status, paymentMode, minAmount, maxAmount],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (vendorId) params.vendorId = vendorId;
      if (budgetHeadId) params.budgetHeadId = budgetHeadId;
      if (type) params.type = type;
      if (status) params.status = status;
      if (paymentMode) params.paymentMode = paymentMode;
      if (minAmount) params.minAmount = minAmount;
      if (maxAmount) params.maxAmount = maxAmount;
      const response = await api.get('/payment-reports', { params });
      return response.data as { data: PaymentRecord[]; pagination: { total: number; totalPages: number }; summary: Summary };
    },
  });

  const rows = data?.data ?? [];
  const summary = data?.summary;
  const pagination = data?.pagination ?? { total: 0, totalPages: 0 };

  function handleExportCsv() {
    if (!rows.length) return;
    const headers = ['Payment No', 'Request Date', 'Payment Date', 'Type', 'Vendor', 'Description', 'Budget Head', 'Amount', 'Payment Mode', 'Status', 'PO', 'Invoice', 'Created By', 'Approved By'];
    const csvRows = rows.map((r) => {
      const paid = r.payments[0];
      return [
        r.paymentCode,
        r.expenseDate ? formatDate(r.expenseDate) : formatDate(r.createdAt),
        paid?.date ? formatDate(paid.date) : '',
        TYPE_LABELS[r.type] ?? r.type,
      r.vendor ? `${r.vendor.vendorCode} - ${r.vendor.name}` : '',
      r.description ?? '',
      r.budgetHead?.particulars ?? '',
      String(Number(r.amount)),
      r.payments[0] ? (PAYMENT_MODE_LABELS[r.payments[0].mode] ?? r.payments[0].mode) : '',
      r.status,
      r.purchaseOrder?.poNumber ?? '',
      r.invoice?.invoiceNumber ?? '',
      r.createdByUser?.name ?? '',
      r.approvalWorkflow?.steps.map((s) => s.approverUser?.name).filter(Boolean).join(', ') ?? '',
    ];
    });
    const csv = [headers, ...csvRows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payment-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  if (user && !allowedRoles.includes(user.role as UserRole)) {
    return (
      <Box>
        <Alert severity="warning">You do not have access to view the Payment Report.</Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>Payment Report</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" startIcon={<RefreshIcon />} onClick={() => refetch()}>Refresh</Button>
          <Button size="small" startIcon={<DownloadIcon />} onClick={handleExportCsv} disabled={!rows.length}>Export CSV</Button>
        </Box>
      </Box>

      {/* Summary cards */}
      {summary && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr 1fr' }, gap: 1, mb: 2 }}>
          <Card sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.7rem' }}>Total Paid</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'success.main' }}>{formatCurrency(summary.totalPaid)}</Typography>
          </Card>
          <Card sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.7rem' }}>Approved (Unpaid)</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'info.main' }}>{formatCurrency(summary.totalApproved)}</Typography>
          </Card>
          <Card sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.7rem' }}>Pending Approval</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'warning.main' }}>{formatCurrency(summary.totalPending)}</Typography>
            <Typography variant="caption" color="text.secondary">{summary.pendingCount} request(s)</Typography>
          </Card>
          <Card sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.7rem' }}>Advances</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{formatCurrency(summary.totalAdvance)}</Typography>
          </Card>
        </Box>
      )}

      {/* Filters */}
      <Card sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="Search payment no, vendor..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
            sx={{ width: { xs: '100%', sm: 250 } }}
          />
          <TextField size="small" type="date" label="From" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(0); }} sx={{ width: 150 }} InputLabelProps={{ shrink: true }} />
          <TextField size="small" type="date" label="To" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(0); }} sx={{ width: 150 }} InputLabelProps={{ shrink: true }} />
          <TextField select size="small" label="Vendor" value={vendorId} onChange={(e) => { setVendorId(e.target.value); setPage(0); }} sx={{ width: 180 }}>
            <MenuItem value="">All Vendors</MenuItem>
            {(vendorsData?.data ?? []).map((v: { id: string; name: string; vendorCode: string }) => (
              <MenuItem key={v.id} value={v.id}>{v.vendorCode} - {v.name}</MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label="Budget Head" value={budgetHeadId} onChange={(e) => { setBudgetHeadId(e.target.value); setPage(0); }} sx={{ width: 180 }}>
            <MenuItem value="">All Budget Heads</MenuItem>
            {(budgetHeadsData?.data ?? []).map((b: { id: string; particulars: string }) => (
              <MenuItem key={b.id} value={b.id}>{b.particulars}</MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label="Type" value={type} onChange={(e) => { setType(e.target.value); setPage(0); }} sx={{ width: 130 }}>
            <MenuItem value="">All Types</MenuItem>
            <MenuItem value="INVOICE">Invoice</MenuItem>
            <MenuItem value="EXPENSE">Expense</MenuItem>
            <MenuItem value="ADVANCE">Advance</MenuItem>
          </TextField>
          <TextField select size="small" label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} sx={{ width: 150 }}>
            <MenuItem value="">All Status</MenuItem>
            <MenuItem value="PENDING">Pending</MenuItem>
            <MenuItem value="APPROVED">Approved</MenuItem>
            <MenuItem value="PAID">Paid</MenuItem>
            <MenuItem value="REJECTED">Rejected</MenuItem>
          </TextField>
          <TextField select size="small" label="Mode" value={paymentMode} onChange={(e) => { setPaymentMode(e.target.value); setPage(0); }} sx={{ width: 150 }}>
            <MenuItem value="">All Modes</MenuItem>
            <MenuItem value="BANK_TRANSFER">Bank Transfer</MenuItem>
            <MenuItem value="CASH">Cash</MenuItem>
            <MenuItem value="CHEQUE">Cheque</MenuItem>
            <MenuItem value="UPI">UPI</MenuItem>
            <MenuItem value="RTGS">RTGS</MenuItem>
            <MenuItem value="NEFT">NEFT</MenuItem>
          </TextField>
          <TextField
            size="small"
            label="Min ₹"
            value={minAmount}
            onChange={(e) => { setMinAmount(e.target.value.replace(/[^0-9.]/g, '')); setPage(0); }}
            inputMode="decimal"
            sx={{ width: 100 }}
          />
          <TextField
            size="small"
            label="Max ₹"
            value={maxAmount}
            onChange={(e) => { setMaxAmount(e.target.value.replace(/[^0-9.]/g, '')); setPage(0); }}
            inputMode="decimal"
            sx={{ width: 100 }}
          />
        </Box>
      </Card>

      {/* Budget head + vendor breakdown */}
      {summary && (summary.byBudgetHead.length > 0 || summary.byVendor.length > 0) && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1, mb: 2 }}>
          {summary.byBudgetHead.length > 0 && (
            <Card sx={{ p: 1.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.7rem', color: 'text.secondary', display: 'block', mb: 0.5 }}>Paid by Budget Head</Typography>
              {summary.byBudgetHead.map((item) => (
                <Box key={item.head} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
                  <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{item.head}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>{formatCurrency(item.amount)}</Typography>
                </Box>
              ))}
            </Card>
          )}
          {summary.byVendor.length > 0 && (
            <Card sx={{ p: 1.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.7rem', color: 'text.secondary', display: 'block', mb: 0.5 }}>Paid by Vendor</Typography>
              {summary.byVendor.slice(0, 10).map((item) => (
                <Box key={item.vendor} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
                  <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{item.vendor}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>{formatCurrency(item.amount)}</Typography>
                </Box>
              ))}
            </Card>
          )}
        </Box>
      )}

      {/* Payment cards */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={32} /></Box>
      ) : isError ? (
        <Alert severity="error" sx={{ mb: 2 }}>Failed to load payment report.</Alert>
      ) : rows.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">No payments found with the selected filters.</Typography>
        </Card>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {rows.map((row) => {
            const paidPayment = row.payments[0];
            const approverNames = row.approvalWorkflow?.steps.map((s) => s.approverUser?.name).filter(Boolean).join(', ') ?? '';
            return (
              <Box
                key={row.id}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 1.25,
                  '&:hover': { borderColor: 'primary.main' },
                }}
              >
                {/* Status bar */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75, pb: 0.75, borderBottom: '1px solid', borderColor: 'action.hover' }}>
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                    <Chip label={row.status} size="small" color={STATUS_COLORS[row.status] ?? 'default'} />
                    <Chip label={TYPE_LABELS[row.type] ?? row.type} size="small" variant="outlined" />
                  </Box>
                  <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>
                    {formatCurrency(Number(row.amount))}
                  </Typography>
                </Box>

                {/* Label/value grid */}
                <Box sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '130px 1fr 130px 1fr' },
                  gap: { xs: 0.25, sm: '2px 12px' },
                  alignItems: 'baseline',
                }}>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>Payment No</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{row.paymentCode}</Typography>

                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>Request Date</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{row.expenseDate ? formatDate(row.expenseDate) : formatDate(row.createdAt)}</Typography>

                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>Payment Date</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{paidPayment?.date ? formatDate(paidPayment.date) : '—'}</Typography>

                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>Vendor</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{row.vendor ? `${row.vendor.vendorCode} - ${row.vendor.name}` : '—'}</Typography>

                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>Budget Head</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{row.budgetHead?.particulars ?? '—'}</Typography>

                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>Mode</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{paidPayment ? (PAYMENT_MODE_LABELS[paidPayment.mode] ?? paidPayment.mode) : '—'}</Typography>

                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>Account</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{paidPayment?.bankAccount?.accountName ?? paidPayment?.cashAccount?.name ?? '—'}</Typography>

                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>PO / Invoice</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{row.purchaseOrder?.poNumber ?? row.invoice?.invoiceNumber ?? '—'}</Typography>

                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>Created By</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{row.createdByUser?.name ?? '—'}</Typography>

                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>Approved By</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{approverNames || '—'}</Typography>
                </Box>

                {/* Description */}
                {row.description && (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', mt: 0.5 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem', flexShrink: 0, minWidth: 130 }}>Description</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{row.description}</Typography>
                  </Box>
                )}

                {/* Payment reference */}
                {paidPayment?.reference && (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', mt: 0.25 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem', flexShrink: 0, minWidth: 130 }}>Reference</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{paidPayment.reference}</Typography>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {/* Pagination */}
      <TablePagination
        component="div"
        count={pagination.total}
        page={page}
        onPageChange={(_e, p) => setPage(p)}
        rowsPerPage={pageSize}
        onRowsPerPageChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(0); }}
        rowsPerPageOptions={[20, 50, 100, 200]}
        sx={{ '& .MuiTablePagination-toolbar': { flexWrap: 'wrap' } }}
      />
    </Box>
  );
}
