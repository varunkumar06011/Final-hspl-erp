import { useState, useRef } from 'react';
import {
  Box,
  Typography,
  Stack,
  Button,
  Card,
  CardContent,
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
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tabs,
  Tab,
} from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import ApprovalStepsDisplay from '../components/ApprovalStepsDisplay';
import AcknowledgementCheckbox from '../components/AcknowledgementCheckbox';
import RefreshButton from '../components/RefreshButton';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Payments as PaymentsIcon,
  ExpandMore as ExpandMoreIcon,
  Download as DownloadIcon,
  Receipt as ReceiptIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PaymentStatus, PaymentMode, UserRole, POPaymentType } from '@hospital-erp/shared';
import { formatCurrency, formatIndianNumber, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { downloadFile } from '../utils/file';
import ApprovalActionDialog from '../components/ApprovalActionDialog';
import ResponsiveTable from '../components/ResponsiveTable';
import { useApprovalDeepLink } from '../utils/useApprovalDeepLink';

interface ApprovalStep {
  id: string;
  stepNumber: number;
  approverRole: string;
  status: string;
  approverUserId?: string | null;
  approverUser?: { id: string; name: string; role: string } | null;
  comments?: string | null;
}

interface PaymentRequestRow {
  id: string;
  paymentCode: string;
  requestNumber: string;
  type: string;
  amount: number;
  status: string;
  paymentMode: string | null;
  description: string | null;
  category: string | null;
  expenseDate: string | null;
  filePath: string | null;
  fileName: string | null;
  vendorId: string | null;
  vendor: { id: string; name: string; vendorCode: string } | null;
  invoiceId: string | null;
  invoice: { id: string; invoiceCode: string; invoiceNumber: string; totalAmount: number } | null;
  poId: string | null;
  purchaseOrder: { id: string; poNumber: string; grandTotal: number; paymentType: string } | null;
  createdBy: string;
  createdByUser: { id: string; name: string };
  payments: { id: string; amount: number; mode: string; reference: string | null; date: string; bankAccountId: string | null; cashAccountId: string | null; bankAccount: { id: string; accountName: string } | null; cashAccount: { id: string; name: string } | null }[];
  budgetHeadId: string | null;
  budgetHead: { id: string; particulars: string } | null;
  approvalWorkflow: {
    id: string;
    status: string;
    steps: ApprovalStep[];
  } | null;
}

interface PendingInvoice {
  id: string;
  invoiceCode: string;
  invoiceNumber: string;
  vendorId: string;
  vendor: { id: string; name: string; vendorCode: string };
  totalAmount: number;
  advancePaid: number;
  installmentsPaid: number;
  paidToDate: number;
  outstanding: number;
  activePaymentRequest: {
    id: string;
    status: string;
    amount: number;
    requestNumber: string;
  } | null;
  createdBy: string;
  createdAt: string;
}

interface PendingPO {
  id: string;
  poNumber: string;
  paymentType: string;
  grandTotal: number;
  vendor: { id: string; name: string; vendorCode: string };
  advancePaidToDate: number;
  outstanding: number;
  activePaymentRequest: {
    id: string;
    status: string;
    amount: number;
    requestNumber: string;
  } | null;
}

const HEAD_ROLES = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ADMIN, UserRole.ADMIN_2];

const EXPENSE_CATEGORIES = [
  'Transportation',
  'Fuel',
  'Materials',
  'Labour',
  'Food',
  'Equipment Rental',
  'Repairs & Maintenance',
  'Office Supplies',
  'Utilities',
  'Miscellaneous',
];

const PAYMENT_MODES = Object.values(PaymentMode);

export default function PaymentsPage() {
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [payOpen, setPayOpen] = useState<string | null>(null);
  const [payForm, setPayForm] = useState<Record<string, unknown>>({});
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [invoicePayOpen, setInvoicePayOpen] = useState<PendingInvoice | null>(null);
  const [invoicePayForm, setInvoicePayForm] = useState<Record<string, unknown>>({});
  const [advancePayOpen, setAdvancePayOpen] = useState<PendingPO | null>(null);
  const [advancePayForm, setAdvancePayForm] = useState<Record<string, unknown>>({});
  const [advanceFile, setAdvanceFile] = useState<File | null>(null);
  const advanceFileRef = useRef<HTMLInputElement>(null);
  const [advanceAcknowledged, setAdvanceAcknowledged] = useState(false);
  const [approvalAction, setApprovalAction] = useState<{ row: PaymentRequestRow; action: 'approve' | 'reject' } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  // Expense form state
  const [expenseForm, setExpenseForm] = useState<Record<string, unknown>>({});
  const [expenseFile, setExpenseFile] = useState<File | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/payments', page, pageSize, search, statusFilter, typeFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.type = typeFilter;
      const response = await api.get('/payments', { params });
      return response.data;
    },
  });

  const { data: pendingInvoices } = useQuery({
    queryKey: ['/payments', 'pending-invoices'],
    queryFn: async () => {
      const response = await api.get('/payments/pending-invoices');
      return response.data;
    },
  });

  const { data: pendingPOs } = useQuery({
    queryKey: ['/payments', 'pending-pos'],
    queryFn: async () => {
      const response = await api.get('/payments/pending-pos');
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
  const budgetHeads: { id: string; particulars: string }[] = budgetHeadsData?.data ?? [];

  const { data: bankAccountsData } = useQuery({
    queryKey: ['/bank-accounts', 'all'],
    queryFn: async () => {
      const response = await api.get('/bank-accounts', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
  });
  const bankAccounts: { id: string; accountName: string; currentBalance: number }[] = bankAccountsData?.data ?? [];

  const { data: cashAccountsData } = useQuery({
    queryKey: ['/cash-accounts', 'all'],
    queryFn: async () => {
      const response = await api.get('/cash-accounts', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
  });
  const cashAccounts: { id: string; name: string; currentBalance: number }[] = cashAccountsData?.data ?? [];

  const createInvoicePaymentMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await api.post('/payments/invoice-payment', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setInvoicePayOpen(null);
      setInvoicePayForm({});
      setSuccessMsg('Payment request created for invoice.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const createAdvancePaymentMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append('poId', String(advancePayOpen?.id ?? ''));
      formData.append('vendorId', String(advancePayOpen?.vendor.id ?? ''));
      formData.append('requestNumber', String(advancePayForm.requestNumber ?? ''));
      formData.append('amount', String(advancePayForm.amount ?? ''));
      if (advancePayForm.paymentMode) formData.append('paymentMode', String(advancePayForm.paymentMode));
      if (advancePayForm.notes) formData.append('notes', String(advancePayForm.notes));
      if (advancePayForm.budgetHeadId) formData.append('budgetHeadId', String(advancePayForm.budgetHeadId));
      // ── E07: Only append acknowledged when the user actually checks the box ──
      if (advanceAcknowledged) formData.append('acknowledged', 'true');
      if (advanceFile) formData.append('file', advanceFile);
      const response = await api.post('/payments/po-advance', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setAdvancePayOpen(null);
      setAdvancePayForm({});
      setAdvanceFile(null);
      setAdvanceAcknowledged(false);
      if (advanceFileRef.current) advanceFileRef.current.value = '';
      setSuccessMsg('Advance payment request created and sent for approval.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const createExpenseMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append('description', String(expenseForm.description ?? ''));
      formData.append('amount', String(expenseForm.amount ?? ''));
      formData.append('category', String(expenseForm.category ?? ''));
      if (expenseForm.expenseDate) formData.append('expenseDate', String(expenseForm.expenseDate));
      if (expenseForm.paymentMode) formData.append('paymentMode', String(expenseForm.paymentMode));
      if (expenseForm.budgetHeadId) formData.append('budgetHeadId', String(expenseForm.budgetHeadId));
      if (expenseFile) formData.append('file', expenseFile);
      const response = await api.post('/payments/expense', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setExpenseOpen(false);
      setExpenseForm({});
      setExpenseFile(null);
      setSuccessMsg('Daily expense created and sent for approval.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const approveMutation = useMutation({
    mutationFn: async ({ prId, comments, acknowledged }: { prId: string; comments?: string; acknowledged: true }) => {
      const response = await api.post(`/payments/${prId}/approve`, { comments, acknowledged });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setApprovalAction(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ prId, reason, acknowledged }: { prId: string; reason: string; acknowledged: true }) => {
      const response = await api.post(`/payments/${prId}/reject`, { reason, acknowledged });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setApprovalAction(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const [deleteRow, setDeleteRow] = useState<PaymentRequestRow | null>(null);
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/payments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setDeleteRow(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const payMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) => {
      const response = await api.post(`/payments/${id}/pay`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setPayOpen(null);
      setPayForm({});
      setSuccessMsg('Payment recorded successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: PaymentRequestRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const pendingInvoicesData: PendingInvoice[] = pendingInvoices?.data ?? [];
  const pendingPOsData: PendingPO[] = pendingPOs?.data ?? [];
  const currentPaymentRequest = rows.find((row) => row.id === payOpen);

  // Auto-open approval dialog when navigated from a push notification
  useApprovalDeepLink(rows, (row) => setApprovalAction({ row, action: 'approve' }));

  function canApprove(row: PaymentRequestRow): boolean {
    if (!row.approvalWorkflow) return false;
    if (!user || !HEAD_ROLES.includes(user.role as UserRole)) return false;
    if (row.status !== PaymentStatus.PENDING) return false;
    const step = row.approvalWorkflow.steps.find(
      (s) => s.approverRole === user.role && s.status === 'PENDING'
    );
    if (!step) return false;
    const alreadyApproved = row.approvalWorkflow.steps.some(
      (s) => s.approverUserId === user.id && s.status === 'APPROVED'
    );
    return !alreadyApproved;
  }

  function getApprovalCount(row: PaymentRequestRow): number {
    if (!row.approvalWorkflow) return 0;
    return row.approvalWorkflow.steps.filter((s) => s.status === 'APPROVED').length;
  }

  function handleDownload(id: string, fileName: string) {
    downloadFile('payments', id, fileName).catch(() => setError('Failed to download file'));
  }

  function validateExpenseForm(): boolean {
    if (!String(expenseForm.description ?? '').trim() || !String(expenseForm.category ?? '').trim()) {
      setError('Description and category are required');
      return false;
    }
    if (!Number.isFinite(Number(expenseForm.amount)) || Number(expenseForm.amount) <= 0) {
      setError('Expense amount must be greater than zero');
      return false;
    }
    if (expenseFile && (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(expenseFile.type) || expenseFile.size > 50 * 1024 * 1024)) {
      setError('Receipt must be a PDF or image smaller than 50 MB');
      return false;
    }
    return true;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>Payments</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <RefreshButton onClick={() => refetch()} />
          <Button variant="outlined" startIcon={<ReceiptIcon />} onClick={() => setTab(0)}>Pending Invoices</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setExpenseForm({}); setExpenseFile(null); setExpenseOpen(true); }}>Add Daily Expense</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
        <Tab label={`Pending Invoices (${pendingInvoicesData.length})`} />
        <Tab label={`Advance Payments (${pendingPOsData.length})`} />
        <Tab label="All Payment Requests" />
      </Tabs>

      {/* Tab 0: Pending Invoices */}
      {tab === 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>Verified Invoices Awaiting Payment</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              These invoices have been approved and are ready for payment. Pay in full or in installments.
            </Typography>
            {pendingInvoicesData.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No invoices awaiting payment. All verified invoices are fully paid or have active payment requests.</Typography>
            ) : (
              <ResponsiveTable>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Invoice Code</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Invoice No</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Advance</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Installments</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Paid to Date</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Outstanding</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>After Current Request</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Created By</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pendingInvoicesData.map((inv) => (
                      <TableRow key={inv.id} hover>
                        <TableCell data-label="Invoice Code">{inv.invoiceCode}</TableCell>
                        <TableCell data-label="Invoice No">{inv.invoiceNumber}</TableCell>
                        <TableCell data-label="Vendor">{inv.vendor?.vendorCode} - {inv.vendor?.name}</TableCell>
                        <TableCell data-label="Total">{formatCurrency(inv.totalAmount)}</TableCell>
                        <TableCell data-label="Advance">{inv.advancePaid > 0 ? formatCurrency(inv.advancePaid) : '—'}</TableCell>
                        <TableCell data-label="Installments">{inv.installmentsPaid > 0 ? formatCurrency(inv.installmentsPaid) : '—'}</TableCell>
                        <TableCell data-label="Paid to Date">{formatCurrency(inv.paidToDate)}</TableCell>
                        <TableCell data-label="Outstanding"><strong>{formatCurrency(inv.outstanding)}</strong></TableCell>
                        <TableCell data-label="After Current Request">
                          {inv.activePaymentRequest
                            ? formatCurrency(Math.max(0, inv.outstanding - inv.activePaymentRequest.amount))
                            : '—'}
                        </TableCell>
                        <TableCell data-label="Created By">{inv.createdBy}</TableCell>
                        <TableCell data-label="Actions">
                          {inv.activePaymentRequest ? (
                            <Chip
                              size="small"
                              color="warning"
                              label={`Request ${inv.activePaymentRequest.status}`}
                            />
                          ) : (
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<PaymentsIcon />}
                              onClick={() => {
                                setInvoicePayOpen(inv);
                                setInvoicePayForm({
                                amount: inv.outstanding,
                                requestNumber: `PAY-${inv.invoiceCode}`,
                                paymentMode: PaymentMode.BANK_TRANSFER,
                              });
                            }}
                          >
                            Create Payment
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              </ResponsiveTable>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab 1: Advance Payments (POs with ADVANCE or FULL_PAYMENT type) */}
      {tab === 1 && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>POs Awaiting Advance Payment</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              These purchase orders were created with an advance or full payment type. Record the advance payment with proof for approval.
            </Typography>
            {pendingPOsData.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No POs awaiting advance payment. All advance-type POs are fully paid or have active payment requests.</Typography>
            ) : (
              <ResponsiveTable>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>PO No</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Payment Type</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Grand Total</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Advance Paid</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Outstanding</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pendingPOsData.map((po) => (
                      <TableRow key={po.id} hover>
                        <TableCell data-label="PO No">{po.poNumber}</TableCell>
                        <TableCell data-label="Vendor">{po.vendor?.vendorCode} - {po.vendor?.name}</TableCell>
                        <TableCell data-label="Payment Type">
                          <Chip
                            size="small"
                            label={po.paymentType === POPaymentType.ADVANCE ? 'Advance' : 'Full Payment'}
                            color={po.paymentType === POPaymentType.ADVANCE ? 'warning' : 'success'}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell data-label="Grand Total">{formatCurrency(po.grandTotal)}</TableCell>
                        <TableCell data-label="Advance Paid">{po.advancePaidToDate > 0 ? formatCurrency(po.advancePaidToDate) : '—'}</TableCell>
                        <TableCell data-label="Outstanding"><strong>{formatCurrency(po.outstanding)}</strong></TableCell>
                        <TableCell data-label="Actions">
                          {po.activePaymentRequest ? (
                            <Chip
                              size="small"
                              color="warning"
                              label={`Request ${po.activePaymentRequest.status}`}
                            />
                          ) : (
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<PaymentsIcon />}
                              onClick={() => {
                                setAdvancePayOpen(po);
                                setAdvancePayForm({
                                  amount: po.outstanding,
                                  requestNumber: `ADV-${po.poNumber}`,
                                  paymentMode: PaymentMode.BANK_TRANSFER,
                                });
                                setAdvanceFile(null);
                              }}
                            >
                              Create Advance Payment
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              </ResponsiveTable>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab 2: All Payment Requests */}
      {tab === 2 && (
        <Card>
          <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              placeholder="Search..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
              sx={{ width: { xs: '100%', sm: 250 } }}
            />
            <TextField select size="small" label="Type" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }} sx={{ width: 150 }}>
              <MenuItem value="">All</MenuItem>
              <MenuItem value="INVOICE">Invoice</MenuItem>
              <MenuItem value="EXPENSE">Expense</MenuItem>
              <MenuItem value="ADVANCE">Advance</MenuItem>
            </TextField>
            <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} sx={{ width: 150 }}>
              <MenuItem value="">All</MenuItem>
              {Object.values(PaymentStatus).map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          </Box>

          <ResponsiveTable>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Code</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Description / Invoice</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Budget Head</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Approvals</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>File</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={10} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={10} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No payment requests found</Typography></TableCell></TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell data-label="Code">{row.paymentCode}</TableCell>
                      <TableCell data-label="Type"><Chip label={row.type} size="small" color={row.type === 'EXPENSE' ? 'secondary' : row.type === 'ADVANCE' ? 'warning' : 'primary'} variant="outlined" /></TableCell>
                      <TableCell data-label="Description / Invoice / PO">
                        {row.type === 'EXPENSE'
                          ? `${row.description ?? '—'}${row.category ? ` (${row.category})` : ''}`
                          : row.type === 'ADVANCE'
                            ? `PO: ${row.purchaseOrder?.poNumber ?? '—'}`
                            : row.invoice?.invoiceCode ?? '—'}
                      </TableCell>
                      <TableCell data-label="Vendor">{row.vendor ? `${row.vendor.vendorCode} - ${row.vendor.name}` : '—'}</TableCell>
                      <TableCell data-label="Amount">{formatCurrency(row.amount)}</TableCell>
                      <TableCell data-label="Budget Head">
                        {row.budgetHead
                          ? <Chip label={row.budgetHead.particulars} size="small" variant="outlined" color="primary" />
                          : <Typography variant="caption" color="text.secondary">—</Typography>}
                      </TableCell>
                      <TableCell data-label="Approvals">
                        {row.approvalWorkflow
                          ? `${getApprovalCount(row)}/2`
                          : '—'}
                      </TableCell>
                      <TableCell data-label="Status">
                        <Stack spacing={0.5} alignItems="flex-start">
                          <Chip label={row.status} size="small" color={STATUS_COLORS[row.status] ?? 'default'} />
                          {row.status === PaymentStatus.PAID && row.payments[0] && (
                            <Typography variant="caption" color="text.secondary">
                              {row.payments[0].bankAccount ? `via ${row.payments[0].bankAccount.accountName}` : row.payments[0].cashAccount ? `via ${row.payments[0].cashAccount.name}` : `via ${row.payments[0].mode}`}
                            </Typography>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell data-label="File">
                        {row.filePath
                          ? <IconButton size="small" onClick={() => handleDownload(row.id, row.fileName ?? 'file')}><DownloadIcon fontSize="small" /></IconButton>
                          : '—'}
                      </TableCell>
                      <TableCell data-label="Actions">
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {canApprove(row) && (
                            <>
                              <IconButton size="small" color="success" onClick={() => setApprovalAction({ row, action: 'approve' })} title="Approve"><CheckIcon fontSize="small" /></IconButton>
                              <IconButton size="small" color="error" onClick={() => setApprovalAction({ row, action: 'reject' })} title="Reject"><CloseIcon fontSize="small" /></IconButton>
                            </>
                          )}
                          {row.status === PaymentStatus.APPROVED && row.payments.length === 0 && (
                            <Button size="small" variant="outlined" startIcon={<PaymentsIcon />}
                              onClick={() => { setPayOpen(row.id); setPayForm({ amount: row.amount, mode: PaymentMode.BANK_TRANSFER }); }}>
                              Pay
                            </Button>
                          )}
                          {row.payments.length > 0 && (
                            <Chip label="Paid" size="small" color="success" />
                          )}
                          {row.status !== PaymentStatus.APPROVED && row.status !== PaymentStatus.PAID && (
                            <IconButton size="small" color="error" onClick={() => setDeleteRow(row)} title="Delete"><DeleteIcon fontSize="small" /></IconButton>
                          )}
                        </Box>
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
            onPageChange={(_e, p) => setPage(p)}
            rowsPerPage={pageSize}
            onRowsPerPageChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 20, 50]}
            sx={{ '& .MuiTablePagination-toolbar': { flexWrap: 'wrap' } }}
          />
        </Card>
      )}

      {/* Approval details accordion */}
      {tab === 2 && rows.length > 0 && rows.some((r) => r.approvalWorkflow) && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>Approval Status</Typography>
          {rows.filter((r) => r.approvalWorkflow).map((row) => (
            <Accordion key={row.id}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography><strong>{row.paymentCode}</strong> — {row.type === 'EXPENSE' ? row.description : row.type === 'ADVANCE' ? `PO: ${row.purchaseOrder?.poNumber}` : row.invoice?.invoiceCode} — {getApprovalCount(row)}/2 approved — <Chip label={row.status} size="small" color={STATUS_COLORS[row.status] ?? 'default'} /></Typography>
              </AccordionSummary>
              <AccordionDetails>
                <ApprovalStepsDisplay steps={row.approvalWorkflow!.steps} />
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      )}

      {/* Create Invoice Payment Dialog */}
      <ResponsiveDialog open={!!invoicePayOpen} onClose={() => setInvoicePayOpen(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Payment Request for {invoicePayOpen?.invoiceCode}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography variant="body2">Vendor: <strong>{invoicePayOpen?.vendor?.name}</strong></Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
              <Typography variant="body2">Invoice Total: <strong>{invoicePayOpen ? formatCurrency(invoicePayOpen.totalAmount) : ''}</strong></Typography>
              {invoicePayOpen && invoicePayOpen.advancePaid > 0 && (
                <Typography variant="body2">Advance Paid: <strong>{formatCurrency(invoicePayOpen.advancePaid)}</strong></Typography>
              )}
              {invoicePayOpen && invoicePayOpen.installmentsPaid > 0 && (
                <Typography variant="body2">Installments Paid: <strong>{formatCurrency(invoicePayOpen.installmentsPaid)}</strong></Typography>
              )}
              <Typography variant="body2">Paid to Date: <strong>{invoicePayOpen ? formatCurrency(invoicePayOpen.paidToDate) : ''}</strong></Typography>
            </Box>
            <Typography variant="body2" color="primary.main">Outstanding Balance: <strong>{invoicePayOpen ? formatCurrency(invoicePayOpen.outstanding) : ''}</strong></Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => setInvoicePayForm({ ...invoicePayForm, amount: invoicePayOpen?.outstanding ?? 0 })}
              >
                Pay Full Outstanding
              </Button>
              <Button
                size="small"
                variant="text"
                onClick={() => setInvoicePayForm({ ...invoicePayForm, amount: 0 })}
              >
                Custom Installment
              </Button>
            </Box>
            <TextField
              label="Request Number"
              value={String(invoicePayForm.requestNumber ?? '')}
              onChange={(e) => setInvoicePayForm({ ...invoicePayForm, requestNumber: e.target.value })}
              fullWidth
              size="small"
              required
            />
            <TextField
              label="Payment Amount"
              type="text"
              value={formatIndianNumber(invoicePayForm.amount ?? '')}
              onChange={(e) => {
                const value = e.target.value.replace(/,/g, '');
                const parsedAmount = Number(value);
                setInvoicePayForm({
                  ...invoicePayForm,
                  amount: value === ''
                    ? ''
                    : !Number.isFinite(parsedAmount)
                      ? ''
                      : invoicePayOpen
                        ? Math.min(parsedAmount, invoicePayOpen.outstanding)
                        : parsedAmount,
                });
              }}
              inputMode="decimal"
              inputProps={{ min: 0, max: invoicePayOpen?.outstanding }}
              fullWidth
              size="small"
              required
              helperText={invoicePayOpen ? `Maximum: ${formatCurrency(invoicePayOpen.outstanding)}` : ''}
            />
            {invoicePayOpen && (
              <Box
                sx={{
                  p: 1.5,
                  borderRadius: 1,
                  bgcolor: 'action.hover',
                  border: 1,
                  borderColor: 'divider',
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Outstanding After This Payment
                </Typography>
                <Typography variant="h6" color="primary.main" fontWeight={600}>
                  {formatCurrency(Math.max(0, invoicePayOpen.outstanding - (Number(invoicePayForm.amount) || 0)))}
                </Typography>
              </Box>
            )}
            <TextField
              select
              label="Payment Mode"
              value={String(invoicePayForm.paymentMode ?? PaymentMode.BANK_TRANSFER)}
              onChange={(e) => setInvoicePayForm({ ...invoicePayForm, paymentMode: e.target.value })}
              fullWidth
              size="small"
            >
              {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{m.replace(/_/g, ' ')}</MenuItem>)}
            </TextField>
            <TextField
              select
              label="Budget Head (optional)"
              value={String(invoicePayForm.budgetHeadId ?? '')}
              onChange={(e) => setInvoicePayForm({ ...invoicePayForm, budgetHeadId: e.target.value })}
              fullWidth
              size="small"
            >
              <MenuItem value="">— None —</MenuItem>
              {budgetHeads.map((h) => <MenuItem key={h.id} value={h.id}>{h.particulars}</MenuItem>)}
            </TextField>
            <TextField
              label="Notes"
              value={String(invoicePayForm.notes ?? '')}
              onChange={(e) => setInvoicePayForm({ ...invoicePayForm, notes: e.target.value })}
              fullWidth
              size="small"
              multiline
              rows={2}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setInvoicePayOpen(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (!invoicePayOpen) return;
              setError('');
              createInvoicePaymentMutation.mutate({
                invoiceId: invoicePayOpen.id,
                vendorId: invoicePayOpen.vendorId,
                requestNumber: invoicePayForm.requestNumber,
                amount: Number(invoicePayForm.amount),
                paymentMode: invoicePayForm.paymentMode || undefined,
                notes: invoicePayForm.notes || undefined,
                budgetHeadId: invoicePayForm.budgetHeadId || undefined,
              });
            }}
            disabled={createInvoicePaymentMutation.isPending || !invoicePayForm.amount || Number(invoicePayForm.amount) <= 0}
          >
            {createInvoicePaymentMutation.isPending ? <CircularProgress size={20} /> : 'Create Payment Request'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Create Advance Payment Dialog */}
      <ResponsiveDialog open={!!advancePayOpen} onClose={() => { setAdvancePayOpen(null); setAdvanceFile(null); setAdvanceAcknowledged(false); if (advanceFileRef.current) advanceFileRef.current.value = ''; }} maxWidth="sm" fullWidth>
        <DialogTitle>Create Advance Payment for {advancePayOpen?.poNumber}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography variant="body2">Vendor: <strong>{advancePayOpen?.vendor?.name}</strong></Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
              <Typography variant="body2">PO Grand Total: <strong>{advancePayOpen ? formatCurrency(advancePayOpen.grandTotal) : ''}</strong></Typography>
              <Typography variant="body2">Payment Type: <strong>{advancePayOpen?.paymentType === POPaymentType.ADVANCE ? 'Against Advance' : 'Against Full Payment'}</strong></Typography>
              {advancePayOpen && advancePayOpen.advancePaidToDate > 0 && (
                <Typography variant="body2">Advance Paid: <strong>{formatCurrency(advancePayOpen.advancePaidToDate)}</strong></Typography>
              )}
            </Box>
            <Typography variant="body2" color="primary.main">Outstanding Balance: <strong>{advancePayOpen ? formatCurrency(advancePayOpen.outstanding) : ''}</strong></Typography>
            <TextField
              label="Request Number"
              value={String(advancePayForm.requestNumber ?? '')}
              onChange={(e) => setAdvancePayForm({ ...advancePayForm, requestNumber: e.target.value })}
              fullWidth
              size="small"
              required
            />
            <TextField
              label="Advance Amount"
              type="text"
              value={formatIndianNumber(advancePayForm.amount ?? '')}
              onChange={(e) => {
                const value = e.target.value.replace(/,/g, '');
                const parsedAmount = Number(value);
                setAdvancePayForm({
                  ...advancePayForm,
                  amount: value === ''
                    ? ''
                    : !Number.isFinite(parsedAmount)
                      ? ''
                      : advancePayOpen
                        ? Math.min(parsedAmount, advancePayOpen.outstanding)
                        : parsedAmount,
                });
              }}
              inputMode="decimal"
              inputProps={{ min: 0, max: advancePayOpen?.outstanding }}
              fullWidth
              size="small"
              required
              helperText={advancePayOpen ? `Maximum: ${formatCurrency(advancePayOpen.outstanding)}` : ''}
            />
            <TextField
              select
              label="Payment Mode"
              value={String(advancePayForm.paymentMode ?? PaymentMode.BANK_TRANSFER)}
              onChange={(e) => setAdvancePayForm({ ...advancePayForm, paymentMode: e.target.value })}
              fullWidth
              size="small"
            >
              {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{m.replace(/_/g, ' ')}</MenuItem>)}
            </TextField>
            <TextField
              select
              label="Budget Head (optional)"
              value={String(advancePayForm.budgetHeadId ?? '')}
              onChange={(e) => setAdvancePayForm({ ...advancePayForm, budgetHeadId: e.target.value })}
              fullWidth
              size="small"
            >
              <MenuItem value="">— None —</MenuItem>
              {budgetHeads.map((h) => <MenuItem key={h.id} value={h.id}>{h.particulars}</MenuItem>)}
            </TextField>
            <TextField
              label="Notes"
              value={String(advancePayForm.notes ?? '')}
              onChange={(e) => setAdvancePayForm({ ...advancePayForm, notes: e.target.value })}
              fullWidth
              size="small"
              multiline
              rows={2}
            />
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>Proof of Advance Payment (bank transfer receipt, cheque, etc.)</Typography>
              <input
                ref={advanceFileRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setAdvanceFile(file);
                }}
                style={{ width: '100%' }}
              />
              {advanceFile && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  {advanceFile.name} ({(advanceFile.size / 1024).toFixed(0)} KB)
                </Typography>
              )}
            </Box>
            <AcknowledgementCheckbox
              checked={advanceAcknowledged}
              onChange={setAdvanceAcknowledged}
              entityLabel="advance payment request"
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => { setAdvancePayOpen(null); setAdvanceFile(null); setAdvanceAcknowledged(false); if (advanceFileRef.current) advanceFileRef.current.value = ''; }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setError('');
              createAdvancePaymentMutation.mutate();
            }}
            disabled={createAdvancePaymentMutation.isPending || !advancePayForm.amount || Number(advancePayForm.amount) <= 0 || !advanceAcknowledged}
          >
            {createAdvancePaymentMutation.isPending ? <CircularProgress size={20} /> : 'Create Advance Payment Request'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Create Daily Expense Dialog */}
      <ResponsiveDialog open={expenseOpen} onClose={() => setExpenseOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Daily Expense</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Description"
              value={String(expenseForm.description ?? '')}
              onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
              fullWidth
              size="small"
              required
            />
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, flexWrap: 'wrap' }}>
              <TextField
                label="Amount"
                type="text"
                value={formatIndianNumber(expenseForm.amount ?? '')}
                onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value === '' ? '' : Number(e.target.value.replace(/,/g, '')) })}
                inputMode="decimal"
                inputProps={{ min: 0.01, step: 0.01 }}
                size="small"
                sx={{ flex: 1, minWidth: 0 }}
                required
              />
              <TextField
                select
                label="Category"
                value={String(expenseForm.category ?? '')}
                onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                size="small"
                sx={{ flex: 1, minWidth: 0 }}
                required
              >
                {EXPENSE_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
              </TextField>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, flexWrap: 'wrap' }}>
              <TextField
                label="Date"
                type="date"
                value={String(expenseForm.expenseDate ?? '')}
                onChange={(e) => setExpenseForm({ ...expenseForm, expenseDate: e.target.value })}
                size="small"
                sx={{ flex: 1, minWidth: 0 }}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                select
                label="Payment Mode"
                value={String(expenseForm.paymentMode ?? PaymentMode.CASH)}
                onChange={(e) => setExpenseForm({ ...expenseForm, paymentMode: e.target.value })}
                size="small"
                sx={{ flex: 1, minWidth: 0 }}
              >
                {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{m.replace(/_/g, ' ')}</MenuItem>)}
              </TextField>
              <TextField
                select
                label="Budget Head (optional)"
                value={String(expenseForm.budgetHeadId ?? '')}
                onChange={(e) => setExpenseForm({ ...expenseForm, budgetHeadId: e.target.value })}
                size="small"
                sx={{ flex: 1, minWidth: 0 }}
              >
                <MenuItem value="">— None —</MenuItem>
                {budgetHeads.map((h) => <MenuItem key={h.id} value={h.id}>{h.particulars}</MenuItem>)}
              </TextField>
            </Box>
            <Box>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 50 * 1024 * 1024) {
                  setError('Receipt must be a PDF or image smaller than 50 MB');
                  return;
                }
                setError('');
                setExpenseFile(file);
              }} />
              <Button variant="outlined" onClick={() => fileRef.current?.click()} startIcon={<AddIcon />}>
                {expenseFile ? `✓ ${expenseFile.name}` : 'Upload Receipt Photo'}
              </Button>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setExpenseOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => { setError(''); if (validateExpenseForm()) createExpenseMutation.mutate(); }}
            disabled={createExpenseMutation.isPending}
          >
            {createExpenseMutation.isPending ? <CircularProgress size={20} /> : 'Create Expense'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Record Payment Dialog */}
      <ResponsiveDialog open={!!payOpen} onClose={() => setPayOpen(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Record Payment</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Amount"
              type="text"
              value={formatIndianNumber(payForm.amount ?? '')}
              onChange={(e) => {
                const value = e.target.value.replace(/,/g, '');
                const parsedAmount = Number(value);
                setPayForm({
                  ...payForm,
                  amount: value === '' ? '' : Number.isFinite(parsedAmount) ? Math.min(parsedAmount, currentPaymentRequest?.amount ?? parsedAmount) : '',
                });
              }}
              inputMode="decimal"
              inputProps={{ min: 0.01, max: currentPaymentRequest?.amount, step: 0.01 }}
              fullWidth
              size="small"
              required
            />
            <TextField
              select
              label="Payment Mode"
              value={String(payForm.mode ?? PaymentMode.BANK_TRANSFER)}
              onChange={(e) => setPayForm({ ...payForm, mode: e.target.value })}
              fullWidth
              size="small"
              required
            >
              {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{m.replace(/_/g, ' ')}</MenuItem>)}
            </TextField>
            <TextField
              select
              label="Pay from Bank Account (optional)"
              value={String(payForm.bankAccountId ?? '')}
              onChange={(e) => setPayForm({ ...payForm, bankAccountId: e.target.value, cashAccountId: '' })}
              fullWidth
              size="small"
              helperText="Selecting an account will create a bank transaction and update balance"
            >
              <MenuItem value="">— None —</MenuItem>
              {bankAccounts.map((a) => <MenuItem key={a.id} value={a.id}>{a.accountName} ({formatCurrency(a.currentBalance)})</MenuItem>)}
            </TextField>
            <TextField
              select
              label="Pay from Cash Account (optional)"
              value={String(payForm.cashAccountId ?? '')}
              onChange={(e) => setPayForm({ ...payForm, cashAccountId: e.target.value, bankAccountId: '' })}
              fullWidth
              size="small"
              helperText="Selecting an account will create a cash transaction and update balance"
            >
              <MenuItem value="">— None —</MenuItem>
              {cashAccounts.map((a) => <MenuItem key={a.id} value={a.id}>{a.name} ({formatCurrency(a.currentBalance)})</MenuItem>)}
            </TextField>
            <TextField
              label="Reference (cheque no, UPI ID, etc.)"
              value={String(payForm.reference ?? '')}
              onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
              fullWidth
              size="small"
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setPayOpen(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (!payOpen) return;
              setError('');
              payMutation.mutate({
                id: payOpen,
                payload: {
                  amount: Number(payForm.amount),
                  mode: payForm.mode,
                  reference: payForm.reference || undefined,
                  bankAccountId: payForm.bankAccountId || undefined,
                  cashAccountId: payForm.cashAccountId || undefined,
                },
              });
            }}
            disabled={payMutation.isPending}
          >
            {payMutation.isPending ? <CircularProgress size={20} /> : 'Record Payment'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      <ApprovalActionDialog
        open={approvalAction !== null}
        action={approvalAction?.action ?? 'approve'}
        entityLabel="Payment Request"
        pending={approveMutation.isPending || rejectMutation.isPending}
        error={error}
        onClearError={() => setError('')}
        onClose={() => setApprovalAction(null)}
        onConfirm={(payload) => {
          if (!approvalAction) return;
          if (approvalAction.action === 'approve') {
            approveMutation.mutate({ prId: approvalAction.row.id, comments: payload.comments, acknowledged: true });
          } else {
            rejectMutation.mutate({ prId: approvalAction.row.id, reason: payload.reason!, acknowledged: true });
          }
        }}
      />

      <ResponsiveDialog open={deleteRow !== null} onClose={() => setDeleteRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Payment Request</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete payment request <strong>{deleteRow?.paymentCode}</strong>?</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            This action cannot be undone. Only payment requests that are not approved or paid can be deleted.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRow(null)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={deleteMutation.isPending} onClick={() => deleteRow && deleteMutation.mutate(deleteRow.id)}>
            {deleteMutation.isPending ? <CircularProgress size={20} /> : 'Delete'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
