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
  FormHelperText,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import ApprovalStepsDisplay from '../components/ApprovalStepsDisplay';
import ApprovalCommentsInline from '../components/ApprovalCommentsInline';
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
  Edit as EditIcon,
  WhatsApp as WhatsAppIcon,
  Link as LinkIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PaymentStatus, PaymentMode, POPaymentType, isAdminRole } from '@hospital-erp/shared';
import { enumLabel, formatCurrency, formatIndianNumber, STATUS_COLORS, todayLocalDate } from '../utils/enumOptions';
import { dateLocale } from '../i18n';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { downloadFile } from '../utils/file';
import ApprovalActionDialog from '../components/ApprovalActionDialog';
import ResponsiveTable from '../components/ResponsiveTable';
import PaymentSheetsTab from '../components/PaymentSheetsTab';
import { useApprovalDeepLink } from '../utils/useApprovalDeepLink';
import { useDeepLinkRow } from '../hooks/useDeepLinkRow';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { shareOnWhatsApp, buildPaymentShareMessage } from '../utils/whatsappShare';
import CommentsButton from '../components/CommentsButton';

import { useTranslation, Trans } from 'react-i18next';
import FilePicker from '../components/FilePicker';
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
  chequeNumber: string | null;
  description: string | null;
  category: string | null;
  expenseDate: string | null;
  notes: string | null;
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
  payments: { id: string; amount: number; mode: string; reference: string | null; date: string; bankAccountId: string | null; cashAccountId: string | null; bankAccount: { id: string; accountName: string } | null; cashAccount: { id: string; name: string } | null; journalVoucherId: string | null; journalVoucher: { jvNumber: string } | null }[];
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
  budgetHead: { id: string; particulars: string } | null;
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

// A posted PAYMENT voucher that can be linked to a payment request
// (payment already recorded on the Vouchers page — no new posting needed).
interface LinkableVoucher {
  id: string;
  jvNumber: string;
  date: string;
  description: string | null;
  totalDebit: number;
  payments: { id: string }[];
}

interface PendingPO {
  id: string;
  poNumber: string;
  paymentType: string;
  grandTotal: number;
  totalDeductions: number;
  netPayable: number;
  advanceAmount: number | null;
  vendor: { id: string; name: string; vendorCode: string };
  budgetHead: { id: string; particulars: string } | null;
  advancePaidToDate: number;
  outstanding: number;
  activePaymentRequest: {
    id: string;
    status: string;
    amount: number;
    requestNumber: string;
  } | null;
}

// Admin roles (ADMIN, ADMIN_2, ADMIN_3, ...) are checked dynamically via isAdminRole().

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
  const { t: tr } = useTranslation('payments');
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [invoicePayOpen, setInvoicePayOpen] = useState<PendingInvoice | null>(null);
  const [invoicePayForm, setInvoicePayForm] = useState<Record<string, unknown>>({});
  const [advancePayOpen, setAdvancePayOpen] = useState<PendingPO | null>(null);
  const [advancePayForm, setAdvancePayForm] = useState<Record<string, unknown>>({});
  const [advanceFile, setAdvanceFile] = useState<File | null>(null);
  const advanceFileRef = useRef<HTMLInputElement>(null);
  const [advanceAcknowledged, setAdvanceAcknowledged] = useState(false);
  const [approvalAction, setApprovalAction] = useState<{ row: PaymentRequestRow; action: 'approve' | 'reject' } | null>(null);
  const [editRow, setEditRow] = useState<PaymentRequestRow | null>(null);
  const [editForm, setEditForm] = useState<Record<string, unknown>>({});
  const [linkVoucherRow, setLinkVoucherRow] = useState<PaymentRequestRow | null>(null);
  const [selectedVoucherId, setSelectedVoucherId] = useState('');
  // One voucher settling several approved requests (e.g. 4 POs, one transfer)
  const [multiLinkOpen, setMultiLinkOpen] = useState(false);
  const [multiVoucherId, setMultiVoucherId] = useState('');
  const [multiRequestIds, setMultiRequestIds] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const navigate = useNavigate();

  // Expense form state
  const [expenseForm, setExpenseForm] = useState<Record<string, unknown>>({});
  const [expenseFile, setExpenseFile] = useState<File | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/payments', page, pageSize, search, statusFilter, typeFilter, minAmount, maxAmount, dateFilter, paymentDate],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.type = typeFilter;
      if (minAmount) params.minAmount = minAmount;
      if (maxAmount) params.maxAmount = maxAmount;
      if (dateFilter) params.dateFilter = dateFilter;
      if (paymentDate) params.paymentDate = paymentDate;
      const response = await api.get('/payments', { params });
      return response.data;
    },
    refetchOnWindowFocus: 'always',
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
      const response = await api.get('/budget-heads', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
  });
  const budgetHeads: { id: string; particulars: string }[] = budgetHeadsData?.data ?? [];

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
      if (advancePayForm.chequeNumber) formData.append('chequeNumber', String(advancePayForm.chequeNumber));
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
      const payee = String(expenseForm.payee ?? '').trim();
      const item = String(expenseForm.item ?? '').trim();
      const ref = String(expenseForm.ref ?? '').trim();
      const description = ref ? `${payee} · ${item} · ${ref}` : `${payee} · ${item}`;
      formData.append('description', description);
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
    onMutate: async ({ prId }) => {
      // Optimistic update — advance the approval workflow status instantly.
      await queryClient.cancelQueries({ queryKey: ['/payments'] });
      const prevQueries = queryClient.getQueriesData<{ data: PaymentRequestRow[] }>({ queryKey: ['/payments'] });
      queryClient.setQueriesData<{ data: PaymentRequestRow[] }>({ queryKey: ['/payments'] }, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((pr) =>
            pr.id === prId
              ? {
                  ...pr,
                  approvalWorkflow: pr.approvalWorkflow
                    ? { ...pr.approvalWorkflow, status: 'APPROVAL_1' }
                    : pr.approvalWorkflow,
                }
              : pr,
          ),
        };
      });
      return { prevQueries };
    },
    onError: (err: unknown, _vars, context) => {
      context?.prevQueries.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      setError(extractErrorMessage(err));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
    },
    onSuccess: () => {
      setApprovalAction(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ prId, reason, acknowledged }: { prId: string; reason: string; acknowledged: true }) => {
      const response = await api.post(`/payments/${prId}/reject`, { reason, acknowledged });
      return response.data;
    },
    onMutate: async ({ prId }) => {
      await queryClient.cancelQueries({ queryKey: ['/payments'] });
      const prevQueries = queryClient.getQueriesData<{ data: PaymentRequestRow[] }>({ queryKey: ['/payments'] });
      queryClient.setQueriesData<{ data: PaymentRequestRow[] }>({ queryKey: ['/payments'] }, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((pr) =>
            pr.id === prId
              ? {
                  ...pr,
                  approvalWorkflow: pr.approvalWorkflow
                    ? { ...pr.approvalWorkflow, status: 'REJECTED' }
                    : pr.approvalWorkflow,
                }
              : pr,
          ),
        };
      });
      return { prevQueries };
    },
    onError: (err: unknown, _vars, context) => {
      context?.prevQueries.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      setError(extractErrorMessage(err));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
    },
    onSuccess: () => {
      setApprovalAction(null);
    },
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

  // Edit details of a payment recorded on a previous date — saves directly,
  // no re-approval. Financial fields are locked once posted to a voucher.
  const editMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) => {
      const response = await api.patch(`/payments/${id}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setEditRow(null);
      setSuccessMsg('Payment details updated.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  function openEdit(row: PaymentRequestRow) {
    setEditForm({
      expenseDate: row.expenseDate ? row.expenseDate.slice(0, 10) : '',
      description: row.description ?? '',
      notes: row.notes ?? '',
      category: row.category ?? '',
      amount: row.amount,
      paymentMode: row.paymentMode ?? PaymentMode.CASH,
      chequeNumber: row.chequeNumber ?? '',
      budgetHeadId: row.budgetHeadId ?? '',
    });
    setEditRow(row);
  }

  // Posted PAYMENT vouchers matching this request's amount, for the
  // "Link Voucher" dialog (payment already recorded outside the request flow).
  const { data: linkVouchersData, isLoading: linkVouchersLoading } = useQuery({
    queryKey: ['/vouchers', 'linkable', linkVoucherRow?.id],
    enabled: !!linkVoucherRow,
    queryFn: async () => {
      const response = await api.get('/vouchers', {
        params: {
          voucherType: 'PAYMENT',
          status: 'POSTED',
          minAmount: linkVoucherRow!.amount,
          maxAmount: linkVoucherRow!.amount,
          pageSize: 100,
        },
      });
      return response.data;
    },
  });
  const linkableVouchers: LinkableVoucher[] = (linkVouchersData?.data ?? []).filter(
    (v: LinkableVoucher) => (v.payments?.length ?? 0) === 0,
  );

  const linkVoucherMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/payments/${linkVoucherRow!.id}/link-voucher`, { journalVoucherId: selectedVoucherId });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setLinkVoucherRow(null);
      setSelectedVoucherId('');
      setSuccessMsg('Marked as paid — linked to the existing voucher.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  function closeMultiLink() {
    setMultiLinkOpen(false);
    setMultiVoucherId('');
    setMultiRequestIds([]);
  }

  const { data: multiVouchersData, isLoading: multiVouchersLoading } = useQuery({
    queryKey: ['/vouchers', 'linkable-multi'],
    enabled: multiLinkOpen,
    queryFn: async () => {
      const response = await api.get('/vouchers', { params: { voucherType: 'PAYMENT', status: 'POSTED', pageSize: 100 } });
      return response.data;
    },
  });
  const multiVouchers: LinkableVoucher[] = (multiVouchersData?.data ?? []).filter(
    (v: LinkableVoucher) => (v.payments?.length ?? 0) === 0,
  );

  const { data: multiRequestsData, isLoading: multiRequestsLoading } = useQuery({
    queryKey: ['/payments', 'approved-unlinked'],
    enabled: multiLinkOpen,
    queryFn: async () => {
      const response = await api.get('/payments', { params: { status: PaymentStatus.APPROVED, pageSize: 200 } });
      return response.data;
    },
  });
  const multiRequests: PaymentRequestRow[] = ((multiRequestsData?.data ?? []) as PaymentRequestRow[])
    .filter((r) => r.payments.length === 0)
    .sort((a, b) => (a.vendor?.name ?? '').localeCompare(b.vendor?.name ?? ''));

  const multiVoucher = multiVouchers.find((v) => v.id === multiVoucherId);
  const multiSelectedTotal = multiRequests
    .filter((r) => multiRequestIds.includes(r.id))
    .reduce((s, r) => s + Number(r.amount), 0);
  const multiMatches = !!multiVoucher && multiRequestIds.length >= 2 && Math.abs(Number(multiVoucher.totalDebit) - multiSelectedTotal) < 0.01;

  const linkMultiMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/payments/link-voucher-multi', {
        journalVoucherId: multiVoucherId,
        paymentRequestIds: multiRequestIds,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      closeMultiLink();
      setSuccessMsg(tr('multiLinkDone'));
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: PaymentRequestRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const pendingInvoicesData: PendingInvoice[] = pendingInvoices?.data ?? [];
  const pendingPOsData: PendingPO[] = pendingPOs?.data ?? [];

  // Auto-open approval dialog when navigated from a push notification
  useApprovalDeepLink(rows, (row) => setApprovalAction({ row, action: 'approve' }));
  // Deep-link from global search: ?id=<prId> — filter to that payment and highlight it
  const { highlightId, rowRef } = useDeepLinkRow<PaymentRequestRow>('/payments', rows, 'paymentCode', (v) => { setSearch(v); setPage(0); });
  useUrlFilters({ search: (v) => { setSearch(v); setPage(0); }, status: (v) => { setStatusFilter(v); setPage(0); }, type: (v) => { setTypeFilter(v); setPage(0); }, minAmount: setMinAmount, maxAmount: setMaxAmount, dateFilter: setDateFilter });

  function canApprove(row: PaymentRequestRow): boolean {
    if (!row.approvalWorkflow) return false;
    if (!user || (!isAdminRole(user.role))) return false;
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
    downloadFile('payments', id, fileName).catch(() => setError(tr('errDownload')));
  }

  function validateExpenseForm(): boolean {
    const payee = String(expenseForm.payee ?? '').trim();
    const item = String(expenseForm.item ?? '').trim();
    if (!payee || !item) {
      setError(tr('errPayee'));
      return false;
    }
    if (!String(expenseForm.category ?? '').trim()) {
      setError(tr('errCat'));
      return false;
    }
    if (!expenseForm.budgetHeadId || String(expenseForm.budgetHeadId).trim() === '') {
      setError(tr('errBudget'));
      return false;
    }
    if (!Number.isFinite(Number(expenseForm.amount)) || Number(expenseForm.amount) <= 0) {
      setError(tr('errAmt'));
      return false;
    }
    if (expenseFile && (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(expenseFile.type) || expenseFile.size > 50 * 1024 * 1024)) {
      setError(tr('errReceipt'));
      return false;
    }
    return true;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>{tr('title')}</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <RefreshButton onClick={() => refetch()} />
          <Button variant="outlined" startIcon={<ReceiptIcon />} onClick={() => setTab(0)}>{tr('pendingInvoices')}</Button>
          <Button variant="outlined" startIcon={<LinkIcon />} onClick={() => { setError(''); setMultiLinkOpen(true); }}>{tr('linkOneToMany')}</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setExpenseForm({}); setExpenseFile(null); setExpenseOpen(true); }}>{tr('addDailyExpense')}</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
        <Tab label={tr('tabPending', { n: pendingInvoicesData.length })} />
        <Tab label={tr('tabAdvance', { n: pendingPOsData.length })} />
        <Tab label={tr('allPaymentRequests')} />
        <Tab label={tr('paymentSheets')} />
      </Tabs>

      {/* Tab 0: Pending Invoices */}
      {tab === 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>{tr('verifiedInvoicesAwaitingPayment')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {tr('theseInvoicesHaveBeen')}
            </Typography>
            {pendingInvoicesData.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>{tr('noInvoices')}</Typography>
            ) : (
              <ResponsiveTable>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('invoiceCode')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('invoiceNo')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('vendor')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('total')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('advance')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('installments')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('paidToDate')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('outstanding')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('afterCurrentRequest')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('createdBy')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('actions')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pendingInvoicesData.map((inv) => (
                      <TableRow key={inv.id} hover>
                        <TableCell data-label={tr('invoiceCode')}>{inv.invoiceCode}</TableCell>
                        <TableCell data-label={tr('invoiceNo')}>{inv.invoiceNumber}</TableCell>
                        <TableCell data-label={tr('vendor')}>{inv.vendor?.vendorCode} - {inv.vendor?.name}</TableCell>
                        <TableCell data-label={tr('total')}>{formatCurrency(inv.totalAmount)}</TableCell>
                        <TableCell data-label={tr('advance')}>{inv.advancePaid > 0 ? formatCurrency(inv.advancePaid) : '—'}</TableCell>
                        <TableCell data-label={tr('installments')}>{inv.installmentsPaid > 0 ? formatCurrency(inv.installmentsPaid) : '—'}</TableCell>
                        <TableCell data-label={tr('paidToDate')}>{formatCurrency(inv.paidToDate)}</TableCell>
                        <TableCell data-label={tr('outstanding')}><strong>{formatCurrency(inv.outstanding)}</strong></TableCell>
                        <TableCell data-label={tr('afterCurrentRequest')}>
                          {inv.activePaymentRequest
                            ? formatCurrency(Math.max(0, inv.outstanding - inv.activePaymentRequest.amount))
                            : '—'}
                        </TableCell>
                        <TableCell data-label={tr('createdBy')}>{inv.createdBy}</TableCell>
                        <TableCell data-label={tr('actions')}>
                          {inv.activePaymentRequest ? (
                            <Chip
                              size="small"
                              color="warning"
                              label={tr('reqStatus', { status: enumLabel(inv.activePaymentRequest.status) })}
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
                                budgetHeadId: inv.budgetHead?.id ?? '',
                              });
                            }}
                          >
                            {tr('createPayment')}
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
            <Typography variant="h6" gutterBottom>{tr('posAwaitingAdvancePayment')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {tr('thesePurchaseOrdersWere')}
            </Typography>
            {pendingPOsData.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>{tr('noPOs')}</Typography>
            ) : (
              <ResponsiveTable>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('poNo')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('vendor')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('paymentType')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('grandTotal')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('advancePaid')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('outstanding')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('actions')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pendingPOsData.map((po) => (
                      <TableRow key={po.id} hover>
                        <TableCell data-label={tr('poNo')}>{po.poNumber}</TableCell>
                        <TableCell data-label={tr('vendor')}>{po.vendor?.vendorCode} - {po.vendor?.name}</TableCell>
                        <TableCell data-label={tr('paymentType')}>
                          <Chip
                            size="small"
                            label={po.paymentType === POPaymentType.ADVANCE ? tr('advance') : tr('fullPayment')}
                            color={po.paymentType === POPaymentType.ADVANCE ? 'warning' : 'success'}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell data-label={tr('grandTotal')}>{formatCurrency(po.grandTotal)}</TableCell>
                        <TableCell data-label={tr('advancePaid')}>{po.advancePaidToDate > 0 ? formatCurrency(po.advancePaidToDate) : '—'}</TableCell>
                        <TableCell data-label={tr('outstanding')}><strong>{formatCurrency(po.outstanding)}</strong></TableCell>
                        <TableCell data-label={tr('actions')}>
                          {po.activePaymentRequest ? (
                            <Chip
                              size="small"
                              color="warning"
                              label={tr('reqStatus', { status: enumLabel(po.activePaymentRequest.status) })}
                            />
                          ) : po.outstanding <= 0 ? (
                            <Chip
                              size="small"
                              color="success"
                              label={tr('paid')}
                            />
                          ) : (
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<PaymentsIcon />}
                              onClick={() => {
                                setAdvancePayOpen(po);
                                setAdvancePayForm({
                                  // Prefill with the agreed advance amount captured at PO creation (if any),
                                  // otherwise fall back to the full outstanding balance. Still editable up to outstanding.
                                  amount: po.advanceAmount !== null && po.advanceAmount > 0 ? Math.min(po.advanceAmount, po.outstanding) : po.outstanding,
                                  requestNumber: `ADV-${po.poNumber}`,
                                  paymentMode: PaymentMode.BANK_TRANSFER,
                                  budgetHeadId: po.budgetHead?.id ?? '',
                                });
                                setAdvanceFile(null);
                              }}
                            >
                              {tr('recordPayment')}
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
              placeholder={tr('search')}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
              sx={{ width: { xs: '100%', sm: 250 } }}
            />
            <TextField select size="small" label={tr('type')} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }} sx={{ width: 150 }}>
              <MenuItem value="">{tr('all')}</MenuItem>
              <MenuItem value="INVOICE">{tr('invoice')}</MenuItem>
              <MenuItem value="EXPENSE">{tr('expense')}</MenuItem>
              <MenuItem value="ADVANCE">{tr('advance')}</MenuItem>
            </TextField>
            <TextField select size="small" label={tr('status')} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} sx={{ width: 150 }}>
              <MenuItem value="">{tr('all')}</MenuItem>
              {Object.values(PaymentStatus).map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <TextField
              size="small"
              label={tr('paymentDate')}
              type="date"
              value={paymentDate}
              onChange={(e) => { setPaymentDate(e.target.value); setPage(0); }}
              InputLabelProps={{ shrink: true }}
              inputProps={{ max: todayLocalDate() }}
              sx={{ width: { xs: '100%', sm: 170 } }}
            />
          </Box>

          <ResponsiveTable>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('code')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('type')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('descriptionInvoice')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('vendor')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('amount')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('budgetHead')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('approvals')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('approvalComments')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('status')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('file')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={11} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={11} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{tr('noPaymentRequestsFound')}</Typography></TableCell></TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id} hover ref={rowRef(row.id)} sx={{ ...(highlightId === row.id && { bgcolor: 'warning.light', '&:hover': { bgcolor: 'warning.light' } }) }}>
                      <TableCell data-label={tr('code')}>{row.paymentCode}</TableCell>
                      <TableCell data-label={tr('type')}><Chip label={enumLabel(row.type)} size="small" color={row.type === 'EXPENSE' ? 'secondary' : row.type === 'ADVANCE' ? 'warning' : 'primary'} variant="outlined" /></TableCell>
                      <TableCell data-label={tr('descriptionInvoicePo')}>
                        {row.type === 'EXPENSE'
                          ? `${row.description ?? '—'}${row.category ? ` (${row.category})` : ''}`
                          : row.type === 'ADVANCE'
                            ? tr('poN', { n: row.purchaseOrder?.poNumber ?? '—' })
                            : row.invoice?.invoiceCode ?? '—'}
                      </TableCell>
                      <TableCell data-label={tr('vendor')}>{row.vendor ? `${row.vendor.vendorCode} - ${row.vendor.name}` : '—'}</TableCell>
                      <TableCell data-label={tr('amount')}>{formatCurrency(row.amount)}</TableCell>
                      <TableCell data-label={tr('budgetHead')}>
                        {row.budgetHead
                          ? <Chip label={row.budgetHead.particulars} size="small" variant="outlined" color="primary" />
                          : <Typography variant="caption" color="text.secondary">—</Typography>}
                      </TableCell>
                      <TableCell data-label={tr('approvals')}>
                        {row.approvalWorkflow
                          ? `${getApprovalCount(row)}/2`
                          : '—'}
                      </TableCell>
                      <TableCell data-label={tr('approvalComments')} sx={{ maxWidth: 260 }}>
                        {row.approvalWorkflow?.steps
                          ? <ApprovalCommentsInline steps={row.approvalWorkflow.steps} />
                          : <Typography variant="caption" color="text.secondary">—</Typography>}
                      </TableCell>
                      <TableCell data-label={tr('status')}>
                        <Stack spacing={0.5} alignItems="flex-start">
                          <Chip label={enumLabel(row.status)} size="small" color={STATUS_COLORS[row.status] ?? 'default'} />
                          {row.status === PaymentStatus.PAID && row.payments[0] && (
                            <Typography variant="caption" color="text.secondary">
                              {row.payments[0].bankAccount ? tr('via', { v: row.payments[0].bankAccount.accountName }) : row.payments[0].cashAccount ? tr('via', { v: row.payments[0].cashAccount.name }) : tr('via', { v: enumLabel(row.payments[0].mode) })}
                            </Typography>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell data-label={tr('file')}>
                        {row.filePath
                          ? <IconButton size="small" onClick={() => handleDownload(row.id, row.fileName ?? 'file')}><DownloadIcon fontSize="small" /></IconButton>
                          : '—'}
                      </TableCell>
                      <TableCell data-label={tr('actions')}>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <CommentsButton entityType="PAYMENT_REQUEST" entityId={row.id} entityLabel={row.requestNumber} url="/payments" />
                          <IconButton size="small" sx={{ color: '#25D366' }} onClick={() => shareOnWhatsApp(buildPaymentShareMessage({ paymentCode: row.paymentCode, requestNumber: row.requestNumber, vendorName: row.vendor?.name, amount: Number(row.amount), status: row.status, type: row.type, description: row.description ?? undefined }))} title={tr('shareOnWhatsapp')}><WhatsAppIcon fontSize="small" /></IconButton>
                          <IconButton size="small" color="primary" onClick={() => openEdit(row)} title={tr('editPaymentDetails')}><EditIcon fontSize="small" /></IconButton>
                          {canApprove(row) && (
                            <>
                              <IconButton size="small" color="success" onClick={() => setApprovalAction({ row, action: 'approve' })} title={tr('approve')}><CheckIcon fontSize="small" /></IconButton>
                              <IconButton size="small" color="error" onClick={() => setApprovalAction({ row, action: 'reject' })} title={tr('reject')}><CloseIcon fontSize="small" /></IconButton>
                            </>
                          )}
                          {row.status === PaymentStatus.APPROVED && row.payments.length === 0 && (
                            <>
                              <Button size="small" variant="outlined" startIcon={<PaymentsIcon />}
                                onClick={() => navigate(`/vouchers?paymentRequest=${row.id}`)}>
                                {tr('postToLedgers')}
                              </Button>
                              <Button size="small" variant="outlined" startIcon={<LinkIcon />}
                                onClick={() => { setLinkVoucherRow(row); setSelectedVoucherId(''); }}>
                                {tr('linkVoucher')}
                              </Button>
                            </>
                          )}
                          {row.payments.length > 0 && (
                            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                              <Chip label={tr('paid')} size="small" color="success" />
                              {row.payments.map((p) =>
                                p.journalVoucher?.jvNumber ? (
                                  <Chip
                                    key={p.id}
                                    label={p.journalVoucher.jvNumber}
                                    size="small"
                                    variant="outlined"
                                    color="primary"
                                    sx={{ fontSize: '0.7rem' }}
                                    title={tr('postedToLedger')}
                                  />
                                ) : null,
                              )}
                            </Box>
                          )}
                          {row.status !== PaymentStatus.APPROVED && row.status !== PaymentStatus.PAID && (
                            <IconButton size="small" color="error" onClick={() => setDeleteRow(row)} title={tr('delete')}><DeleteIcon fontSize="small" /></IconButton>
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
          <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>{tr('approvalStatus')}</Typography>
          {rows.filter((r) => r.approvalWorkflow).map((row) => (
            <Accordion key={row.id}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography><strong>{row.paymentCode}</strong> — {row.type === 'EXPENSE' ? row.description : row.type === 'ADVANCE' ? tr('poN', { n: row.purchaseOrder?.poNumber }) : row.invoice?.invoiceCode} — {tr('approvedN', { n: getApprovalCount(row) })} — <Chip label={enumLabel(row.status)} size="small" color={STATUS_COLORS[row.status] ?? 'default'} /></Typography>
              </AccordionSummary>
              <AccordionDetails>
                <ApprovalStepsDisplay steps={row.approvalWorkflow!.steps} />
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      )}

      {/* Tab 3: Payment Sheets — daily printable register of payments made against a PO */}
      {tab === 3 && <PaymentSheetsTab />}

      {/* Create Invoice Payment Dialog */}
      <ResponsiveDialog open={!!invoicePayOpen} onClose={() => setInvoicePayOpen(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('createTitle', { code: invoicePayOpen?.invoiceCode })}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography variant="body2">{tr('vendor2')} <strong>{invoicePayOpen?.vendor?.name}</strong></Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
              <Typography variant="body2">{tr('invoiceTotal')} <strong>{invoicePayOpen ? formatCurrency(invoicePayOpen.totalAmount) : ''}</strong></Typography>
              {invoicePayOpen && invoicePayOpen.advancePaid > 0 && (
                <Typography variant="body2">{tr('advancePaid2')} <strong>{formatCurrency(invoicePayOpen.advancePaid)}</strong></Typography>
              )}
              {invoicePayOpen && invoicePayOpen.installmentsPaid > 0 && (
                <Typography variant="body2">{tr('installmentsPaid')} <strong>{formatCurrency(invoicePayOpen.installmentsPaid)}</strong></Typography>
              )}
              <Typography variant="body2">{tr('paidToDate2')} <strong>{invoicePayOpen ? formatCurrency(invoicePayOpen.paidToDate) : ''}</strong></Typography>
            </Box>
            <Typography variant="body2" color="primary.main">{tr('outstandingBalance')} <strong>{invoicePayOpen ? formatCurrency(invoicePayOpen.outstanding) : ''}</strong></Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => setInvoicePayForm({ ...invoicePayForm, amount: invoicePayOpen?.outstanding ?? 0 })}
              >
                {tr('payFullOutstanding')}
              </Button>
              <Button
                size="small"
                variant="text"
                onClick={() => setInvoicePayForm({ ...invoicePayForm, amount: 0 })}
              >
                {tr('customInstallment')}
              </Button>
            </Box>
            <TextField
              label={tr('requestNumber')}
              value={String(invoicePayForm.requestNumber ?? '')}
              onChange={(e) => setInvoicePayForm({ ...invoicePayForm, requestNumber: e.target.value })}
              fullWidth
              size="small"
              required
            />
            <TextField
              label={tr('paymentAmount')}
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
                  {tr('outstandingAfterThisPayment')}
                </Typography>
                <Typography variant="h6" color="primary.main" fontWeight={600}>
                  {formatCurrency(Math.max(0, invoicePayOpen.outstanding - (Number(invoicePayForm.amount) || 0)))}
                </Typography>
              </Box>
            )}
            <TextField
              select
              label={tr('paymentMode')}
              value={String(invoicePayForm.paymentMode ?? PaymentMode.BANK_TRANSFER)}
              onChange={(e) => setInvoicePayForm({ ...invoicePayForm, paymentMode: e.target.value })}
              fullWidth
              size="small"
            >
              {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{enumLabel(m)}</MenuItem>)}
            </TextField>
            {String(invoicePayForm.paymentMode ?? '') === PaymentMode.CHEQUE && (
              <TextField
                label={tr('chequeNumber')}
                value={String(invoicePayForm.chequeNumber ?? '')}
                onChange={(e) => setInvoicePayForm({ ...invoicePayForm, chequeNumber: e.target.value })}
                fullWidth
                size="small"
                required
              />
            )}
            <TextField
              select
              label={tr('budgetHeadOptional')}
              value={String(invoicePayForm.budgetHeadId ?? '')}
              onChange={(e) => setInvoicePayForm({ ...invoicePayForm, budgetHeadId: e.target.value })}
              fullWidth
              size="small"
            >
              <MenuItem value="">— None —</MenuItem>
              {budgetHeads.map((h) => <MenuItem key={h.id} value={h.id}>{h.particulars}</MenuItem>)}
            </TextField>
            <TextField
              label={tr('notes')}
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
          <Button onClick={() => setInvoicePayOpen(null)}>{tr('cancel')}</Button>
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
                chequeNumber: invoicePayForm.chequeNumber || undefined,
                notes: invoicePayForm.notes || undefined,
                budgetHeadId: invoicePayForm.budgetHeadId || undefined,
              });
            }}
            disabled={createInvoicePaymentMutation.isPending || !invoicePayForm.amount || Number(invoicePayForm.amount) <= 0 || (invoicePayForm.paymentMode === PaymentMode.CHEQUE && !String(invoicePayForm.chequeNumber ?? '').trim())}
          >
            {createInvoicePaymentMutation.isPending ? <CircularProgress size={20} /> : tr('createRequest')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Create Advance Payment Dialog */}
      <ResponsiveDialog open={!!advancePayOpen} onClose={() => { setAdvancePayOpen(null); setAdvanceFile(null); setAdvanceAcknowledged(false); if (advanceFileRef.current) advanceFileRef.current.value = ''; }} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('recordTitle', { code: advancePayOpen?.poNumber })}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography variant="body2">{tr('vendor2')} <strong>{advancePayOpen?.vendor?.name}</strong></Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
              <Typography variant="body2">{tr('poGrandTotal')} <strong>{advancePayOpen ? formatCurrency(advancePayOpen.grandTotal) : ''}</strong></Typography>
              <Typography variant="body2">{tr('paymentType2')} <strong>{advancePayOpen?.paymentType === POPaymentType.ADVANCE ? tr('againstAdvance') : tr('againstFull')}</strong></Typography>
              {advancePayOpen && advancePayOpen.totalDeductions > 0 && (
                <Typography variant="body2">{tr('deductions')} <strong>{formatCurrency(advancePayOpen.totalDeductions)}</strong></Typography>
              )}
              <Typography variant="body2">{tr('netPayable')} <strong>{advancePayOpen ? formatCurrency(advancePayOpen.netPayable) : ''}</strong></Typography>
              {advancePayOpen && advancePayOpen.advanceAmount !== null && advancePayOpen.advanceAmount > 0 && (
                <Typography variant="body2">{tr('agreedAdvance')} <strong>{formatCurrency(advancePayOpen.advanceAmount)}</strong></Typography>
              )}
              {advancePayOpen && advancePayOpen.advancePaidToDate > 0 && (
                <Typography variant="body2">{tr('advancePaid2')} <strong>{formatCurrency(advancePayOpen.advancePaidToDate)}</strong></Typography>
              )}
            </Box>
            <Typography variant="body2" color="primary.main">{tr('outstandingBalance')} <strong>{advancePayOpen ? formatCurrency(advancePayOpen.outstanding) : ''}</strong></Typography>
            <TextField
              label={tr('requestNumber')}
              value={String(advancePayForm.requestNumber ?? '')}
              onChange={(e) => setAdvancePayForm({ ...advancePayForm, requestNumber: e.target.value })}
              fullWidth
              size="small"
              required
            />
            <TextField
              label={tr('advanceAmount')}
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
            {advancePayOpen && advancePayOpen.advanceAmount !== null && advancePayOpen.advanceAmount > 0 && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setAdvancePayForm({ ...advancePayForm, amount: Math.min(advancePayOpen.advanceAmount!, advancePayOpen.outstanding) })}
                >
                  Use Agreed Advance ({formatCurrency(Math.min(advancePayOpen.advanceAmount, advancePayOpen.outstanding))})
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setAdvancePayForm({ ...advancePayForm, amount: advancePayOpen.outstanding })}
                >
                  {tr('payFullOutstanding')}
                </Button>
              </Box>
            )}
            <TextField
              select
              label={tr('paymentMode')}
              value={String(advancePayForm.paymentMode ?? PaymentMode.BANK_TRANSFER)}
              onChange={(e) => setAdvancePayForm({ ...advancePayForm, paymentMode: e.target.value })}
              fullWidth
              size="small"
            >
              {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{enumLabel(m)}</MenuItem>)}
            </TextField>
            {String(advancePayForm.paymentMode ?? '') === PaymentMode.CHEQUE && (
              <TextField
                label={tr('chequeNumber')}
                value={String(advancePayForm.chequeNumber ?? '')}
                onChange={(e) => setAdvancePayForm({ ...advancePayForm, chequeNumber: e.target.value })}
                fullWidth
                size="small"
                required
              />
            )}
            <TextField
              select
              label={tr('budgetHeadOptional')}
              value={String(advancePayForm.budgetHeadId ?? '')}
              onChange={(e) => setAdvancePayForm({ ...advancePayForm, budgetHeadId: e.target.value })}
              fullWidth
              size="small"
            >
              <MenuItem value="">— None —</MenuItem>
              {budgetHeads.map((h) => <MenuItem key={h.id} value={h.id}>{h.particulars}</MenuItem>)}
            </TextField>
            <TextField
              label={tr('notes')}
              value={String(advancePayForm.notes ?? '')}
              onChange={(e) => setAdvancePayForm({ ...advancePayForm, notes: e.target.value })}
              fullWidth
              size="small"
              multiline
              rows={2}
            />
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>{tr('proofOfPaymentBank')}</Typography>
              <FilePicker
                file={advanceFile}
                onChange={setAdvanceFile}
                accept="application/pdf,image/jpeg,image/png,image/webp"
                startIcon={<AddIcon />}
                label={tr('uploadReceipt')}
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
          <Button onClick={() => { setAdvancePayOpen(null); setAdvanceFile(null); setAdvanceAcknowledged(false); if (advanceFileRef.current) advanceFileRef.current.value = ''; }}>{tr('cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => {
              setError('');
              createAdvancePaymentMutation.mutate();
            }}
            disabled={createAdvancePaymentMutation.isPending || !advancePayForm.amount || Number(advancePayForm.amount) <= 0 || !advanceAcknowledged || (advancePayForm.paymentMode === PaymentMode.CHEQUE && !String(advancePayForm.chequeNumber ?? '').trim())}
          >
            {createAdvancePaymentMutation.isPending ? <CircularProgress size={20} /> : tr('recordPayment')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Create Daily Expense Dialog */}
      <ResponsiveDialog open={expenseOpen} onClose={() => setExpenseOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('addDailyExpense')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Box>
              <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1 }}>
                <TextField
                  label={tr('payee')}
                  placeholder={tr('eGSriAmbica')}
                  value={String(expenseForm.payee ?? '')}
                  onChange={(e) => setExpenseForm({ ...expenseForm, payee: e.target.value })}
                  fullWidth
                  size="small"
                  required
                  inputProps={{ maxLength: 40 }}
                />
                <TextField
                  label={tr('item')}
                  placeholder={tr('eGGreenMats')}
                  value={String(expenseForm.item ?? '')}
                  onChange={(e) => setExpenseForm({ ...expenseForm, item: e.target.value })}
                  fullWidth
                  size="small"
                  required
                  inputProps={{ maxLength: 40 }}
                />
                <TextField
                  label={tr('refOptional')}
                  placeholder={tr('eGBill39')}
                  value={String(expenseForm.ref ?? '')}
                  onChange={(e) => setExpenseForm({ ...expenseForm, ref: e.target.value })}
                  size="small"
                  sx={{ minWidth: { sm: 160 } }}
                  inputProps={{ maxLength: 20 }}
                />
              </Box>
              <FormHelperText sx={{ mt: 0.25 }}>
                <Trans t={tr} i18nKey="stdFormat" components={{ b: <strong /> }} />
              </FormHelperText>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, flexWrap: 'wrap' }}>
              <TextField
                label={tr('amount')}
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
                label={tr('category')}
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
                label={tr('date')}
                type="date"
                value={String(expenseForm.expenseDate ?? '')}
                onChange={(e) => setExpenseForm({ ...expenseForm, expenseDate: e.target.value })}
                size="small"
                sx={{ flex: 1, minWidth: 0 }}
                InputLabelProps={{ shrink: true }}
                inputProps={{ max: todayLocalDate() }}
              />
              <TextField
                select
                label={tr('paymentMode')}
                value={String(expenseForm.paymentMode ?? PaymentMode.CASH)}
                onChange={(e) => setExpenseForm({ ...expenseForm, paymentMode: e.target.value })}
                size="small"
                sx={{ flex: 1, minWidth: 0 }}
              >
                {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{enumLabel(m)}</MenuItem>)}
              </TextField>
              <TextField
                select
                label={tr('budgetHead')}
                value={String(expenseForm.budgetHeadId ?? '')}
                onChange={(e) => setExpenseForm({ ...expenseForm, budgetHeadId: e.target.value })}
                size="small"
                sx={{ flex: 1, minWidth: 0 }}
                required
              >
                {budgetHeads.map((h) => <MenuItem key={h.id} value={h.id}>{h.particulars}</MenuItem>)}
              </TextField>
            </Box>
            <Box>
              <FilePicker
                file={expenseFile}
                accept="image/*,application/pdf"
                startIcon={<AddIcon />}
                label={tr('uploadReceipt')}
                selectedLabel={expenseFile ? `✓ ${expenseFile.name}` : undefined}
                onChange={(file) => {
                  if (!file) { setExpenseFile(null); return; }
                  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 50 * 1024 * 1024) {
                    setError(tr('errReceipt'));
                    return;
                  }
                  setError('');
                  setExpenseFile(file);
                }}
              />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setExpenseOpen(false)}>{tr('cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => { setError(''); if (validateExpenseForm()) createExpenseMutation.mutate(); }}
            disabled={createExpenseMutation.isPending}
          >
            {createExpenseMutation.isPending ? <CircularProgress size={20} /> : tr('createExpense')}
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

      {/* Link Existing Voucher Dialog — payment already posted to ledgers */}
      <ResponsiveDialog open={!!linkVoucherRow} onClose={() => { setLinkVoucherRow(null); setSelectedVoucherId(''); }} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('linkTitle', { code: linkVoucherRow?.paymentCode })}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              <Trans t={tr} i18nKey="linkNote" values={{ v: formatCurrency(Number(linkVoucherRow?.amount ?? 0)) }} components={{ b: <strong /> }} />
            </Typography>
            {linkVouchersLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={28} /></Box>
            ) : (
              <TextField
                select
                label={tr('postedPaymentVoucher')}
                value={selectedVoucherId}
                onChange={(e) => setSelectedVoucherId(e.target.value)}
                fullWidth
                size="small"
                required
                helperText={linkableVouchers.length === 0 ? tr('noVouchers') : tr('vouchersFound', { n: linkableVouchers.length })}
              >
                {linkableVouchers.map((v) => (
                  <MenuItem key={v.id} value={v.id}>
                    {v.jvNumber} — {new Date(v.date).toLocaleDateString(dateLocale())}{v.description ? ` — ${v.description}` : ''}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => { setLinkVoucherRow(null); setSelectedVoucherId(''); }}>{tr('cancel')}</Button>
          <Button
            variant="contained"
            disabled={!selectedVoucherId || linkVoucherMutation.isPending}
            onClick={() => { setError(''); linkVoucherMutation.mutate(); }}
          >
            {linkVoucherMutation.isPending ? <CircularProgress size={20} /> : tr('markPaid')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Link ONE posted voucher to SEVERAL approved requests (e.g. 4 POs, one transfer) */}
      <ResponsiveDialog open={multiLinkOpen} onClose={closeMultiLink} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('multiLinkTitle')}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography variant="body2" color="text.secondary">{tr('multiLinkNote')}</Typography>
            {multiVouchersLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={28} /></Box>
            ) : (
              <TextField
                select
                label={tr('postedPaymentVoucher')}
                value={multiVoucherId}
                onChange={(e) => setMultiVoucherId(e.target.value)}
                fullWidth
                size="small"
                required
                helperText={multiVouchers.length === 0 ? tr('noUnlinkedVouchers') : undefined}
              >
                {multiVouchers.map((v) => (
                  <MenuItem key={v.id} value={v.id}>
                    {v.jvNumber} — {formatCurrency(Number(v.totalDebit))} — {new Date(v.date).toLocaleDateString(dateLocale())}{v.description ? ` — ${v.description}` : ''}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <Typography variant="subtitle2">{tr('multiPickRequests')}</Typography>
            {multiRequestsLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={28} /></Box>
            ) : multiRequests.length === 0 ? (
              <Typography variant="body2" color="text.secondary">{tr('multiNoRequests')}</Typography>
            ) : (
              <Box sx={{ maxHeight: 280, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1, px: 1 }}>
                {multiRequests.map((r) => (
                  <FormControlLabel
                    key={r.id}
                    sx={{ display: 'flex', mr: 0 }}
                    control={
                      <Checkbox
                        size="small"
                        checked={multiRequestIds.includes(r.id)}
                        onChange={(e) => setMultiRequestIds((prev) => (e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id)))}
                      />
                    }
                    label={`${r.vendor?.name ?? '—'} — ${r.purchaseOrder?.poNumber ?? r.requestNumber} — ${formatCurrency(Number(r.amount))}`}
                  />
                ))}
              </Box>
            )}
            <Alert severity={multiMatches ? 'success' : 'info'}>
              {tr('multiTotals', { selected: formatCurrency(multiSelectedTotal), voucher: multiVoucher ? formatCurrency(Number(multiVoucher.totalDebit)) : '—' })}
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={closeMultiLink}>{tr('cancel')}</Button>
          <Button
            variant="contained"
            disabled={!multiMatches || linkMultiMutation.isPending}
            onClick={() => { setError(''); linkMultiMutation.mutate(); }}
          >
            {linkMultiMutation.isPending ? <CircularProgress size={20} /> : tr('markAllPaid')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Edit payment details — direct save, no re-approval. Financial fields
          lock once the request has been posted to a voucher. */}
      <ResponsiveDialog open={editRow !== null} onClose={() => setEditRow(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('editTitle', { code: editRow?.paymentCode })}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {editRow && (editRow.payments.length > 0 || editRow.status === PaymentStatus.PAID) && (
              <FormHelperText sx={{ m: 0 }}>
                {tr('thisPaymentIsAlready')}
              </FormHelperText>
            )}
            <TextField
              label={tr('paymentDate')}
              type="date"
              value={String(editForm.expenseDate ?? '')}
              onChange={(e) => setEditForm({ ...editForm, expenseDate: e.target.value })}
              size="small"
              InputLabelProps={{ shrink: true }}
              inputProps={{ max: todayLocalDate() }}
            />
            <TextField
              label={tr('description')}
              value={String(editForm.description ?? '')}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              size="small"
              fullWidth
              inputProps={{ maxLength: 200 }}
            />
            <TextField
              label={tr('notesOptional')}
              value={String(editForm.notes ?? '')}
              onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              size="small"
              fullWidth
              multiline
              minRows={2}
              inputProps={{ maxLength: 500 }}
            />
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, flexWrap: 'wrap' }}>
              <TextField
                label={tr('amount')}
                type="text"
                value={formatIndianNumber(String(editForm.amount ?? ''))}
                onChange={(e) => setEditForm({ ...editForm, amount: e.target.value === '' ? '' : Number(e.target.value.replace(/,/g, '')) })}
                inputMode="decimal"
                size="small"
                sx={{ flex: 1, minWidth: 0 }}
                required
              />
              <TextField
                select
                label={tr('paymentMode')}
                value={String(editForm.paymentMode ?? '')}
                onChange={(e) => setEditForm({ ...editForm, paymentMode: e.target.value })}
                size="small"
                sx={{ flex: 1, minWidth: 0 }}
              >
                {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{enumLabel(m)}</MenuItem>)}
              </TextField>
            </Box>
            {String(editForm.paymentMode ?? '') === PaymentMode.CHEQUE && (
              <TextField
                label={tr('chequeNumber')}
                value={String(editForm.chequeNumber ?? '')}
                onChange={(e) => setEditForm({ ...editForm, chequeNumber: e.target.value })}
                size="small"
                required
              />
            )}
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, flexWrap: 'wrap' }}>
              <TextField
                select
                label={tr('category')}
                value={String(editForm.category ?? '')}
                onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                size="small"
                sx={{ flex: 1, minWidth: 0 }}
              >
                <MenuItem value="">—</MenuItem>
                {EXPENSE_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
              </TextField>
              <TextField
                select
                label={tr('budgetHead')}
                value={String(editForm.budgetHeadId ?? '')}
                onChange={(e) => setEditForm({ ...editForm, budgetHeadId: e.target.value })}
                size="small"
                sx={{ flex: 1, minWidth: 0 }}
              >
                <MenuItem value="">—</MenuItem>
                {budgetHeads.map((h) => <MenuItem key={h.id} value={h.id}>{h.particulars}</MenuItem>)}
              </TextField>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setEditRow(null)}>{tr('cancel')}</Button>
          <Button
            variant="contained"
            disabled={editMutation.isPending}
            onClick={() => {
              if (!editRow) return;
              setError('');
              const amt = Number(editForm.amount);
              if (!Number.isFinite(amt) || amt <= 0) { setError(tr('errValidAmt')); return; }
              const payload: Record<string, unknown> = {
                expenseDate: editForm.expenseDate || null,
                description: editForm.description ?? null,
                notes: editForm.notes ?? null,
                amount: amt,
                paymentMode: editForm.paymentMode || null,
                chequeNumber: editForm.chequeNumber || null,
                category: editForm.category || null,
                budgetHeadId: editForm.budgetHeadId || null,
              };
              editMutation.mutate({ id: editRow.id, payload });
            }}
          >
            {editMutation.isPending ? <CircularProgress size={20} /> : tr('saveChanges')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      <ResponsiveDialog open={deleteRow !== null} onClose={() => setDeleteRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{tr('deletePaymentRequest')}</DialogTitle>
        <DialogContent>
          <Typography><Trans t={tr} i18nKey="deleteQ" values={{ code: deleteRow?.paymentCode }} components={{ b: <strong /> }} /></Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {tr('thisActionCannotBe')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRow(null)}>{tr('cancel')}</Button>
          <Button color="error" variant="contained" disabled={deleteMutation.isPending} onClick={() => deleteRow && deleteMutation.mutate(deleteRow.id)}>
            {deleteMutation.isPending ? <CircularProgress size={20} /> : 'Delete'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
