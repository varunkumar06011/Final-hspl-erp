import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@mui/material/styles';
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
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Snackbar,
} from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import ApprovalStepsDisplay from '../components/ApprovalStepsDisplay';
import RefreshButton from '../components/RefreshButton';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Download as DownloadIcon,
  PictureAsPdf as PdfIcon,
  WhatsApp as WhatsAppIcon,
  ExpandMore as ExpandMoreIcon,
  LocalShipping as GatePassIcon,
  Timeline as TimelineIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Autorenew as AutoRenewIcon,
  Replay as ResubmitIcon,
  SwapHoriz as SwapBudgetIcon,
  Payment as PaymentIcon,
  TableChart as TableChartIcon,
  MenuBook as PostLedgerIcon,
} from '@mui/icons-material';
import LedgerAutocomplete, { LedgerOption } from '../components/LedgerAutocomplete';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { POStatus, UserRole, POPaymentType, GST_RATES, ApprovalStatus, isAdminRole } from '@hospital-erp/shared';
import { formatCurrency, formatDate, formatIndianNumber, STATUS_COLORS, QTY_UNIT_OPTIONS, enumLabel, unitLabel } from '../utils/enumOptions';
import { useTranslation, Trans } from 'react-i18next';
import { num, toIncGst, round2 } from '../utils/taxCalc';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import AcknowledgementCheckbox from '../components/AcknowledgementCheckbox';
import ApprovalActionDialog from '../components/ApprovalActionDialog';
import CreatableSelect from '../components/CreatableSelect';
import LandscapeExcelTable from '../components/LandscapeExcelTable';
import { useMobileLandscape } from '../hooks/useMobileLandscape';
import { useApprovalDeepLink } from '../utils/useApprovalDeepLink';
import { useDeepLinkRow } from '../hooks/useDeepLinkRow';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { shareOnWhatsApp, buildPOShareMessage } from '../utils/whatsappShare';
import CommentsButton from '../components/CommentsButton';

interface POItemLedgerPost {
  id: string;
  ledgerId: string;
  taxableAmount: number;
  gstAmount: number;
  ledger?: { id: string; name: string } | null;
  journalVoucher?: { jvNumber: string } | null;
}

interface POItem {
  id?: string;
  materialName: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  amount: number;
  gstRate?: number;
  ledgerPosts?: POItemLedgerPost[];
}

interface Quotation {
  id: string;
  quotationNumber: string;
  totalAmount: number;
  gstAmount: number;
  grandTotal: number;
  items: POItem[];
}

interface QuotationSummary {
  id: string;
  quotationNumber: string;
  date: string;
  createdAt: string;
  items?: { materialName: string; quantity: number; unit?: string | null; unitPrice: number }[];
  mpr?: { id: string; mprNumber: string; items: { materialName: string; quantity: number; unit?: string | null; estimatedRate: number }[] } | null;
}

interface ApprovalStep {
  id: string;
  stepNumber: number;
  approverRole: string;
  status: string;
  approverUserId?: string | null;
  approverUser?: { id: string; name: string; role: string } | null;
  comments?: string | null;
  decidedAt?: string | null;
}

interface PORow {
  id: string;
  poNumber: string;
  vendorId: string;
  vendor: { id: string; name: string; vendorCode: string; phone?: string; address?: string };
  quotationId: string;
  quotation: QuotationSummary;
  mpr?: { id: string; mprNumber: string } | null;
  date: string;
  createdAt: string;
  status: string;
  paymentType: string;
  advanceAmount?: number | null;
  paymentTerms?: string | null;
  deliveryDate?: string | null;
  totalAmount: number;
  gstAmount: number;
  grandTotal: number;
  deductions?: { amount: number; reason: string }[] | null;
  totalDeductions?: number;
  netPayable?: number;
  paidToDate?: number;
  amountToPayNow?: number;
  // true once the vendor payable (Cr Vendor) has been booked to the ledger for this PO
  payableBooked?: boolean;
  notes?: string | null;
  createdBy: string;
  createdByUser: { id: string; name: string };
  items: POItem[];
  parentPoId?: string | null;
  parentPo?: { id: string; poNumber: string } | null;
  childPos?: { id: string; poNumber: string; regenerationNumber: number; status: string }[];
  regenerationNumber?: number;
  editReason?: string | null;
  editedAt?: string | null;
  editedByUser?: { id: string; name: string } | null;
  regenerationData?: unknown;
  budgetHeadId?: string | null;
  budgetHead?: { id: string; particulars: string } | null;
  referredBy?: string | null;
  approvalWorkflow?: {
    id: string;
    status: string;
    currentStep: number;
    steps: ApprovalStep[];
  } | null;
}

const HEAD_ROLES = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ACCOUNTS_HEAD];
// Admin roles (ADMIN, ADMIN_2, ADMIN_3, ...) are checked dynamically via isAdminRole().

export default function PurchaseOrdersPage() {
  const theme = useTheme();
  const { t } = useTranslation('po');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { excelView: isMobileLandscape, isMobile, showRotateHint, toggleExcelView } = useMobileLandscape();
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedQuotationId, setSelectedQuotationId] = useState('');
  const [selectedMprId, setSelectedMprId] = useState('');
  const [paymentType, setPaymentType] = useState<string>(POPaymentType.AFTER_DELIVERY);
  const [advanceAmount, setAdvanceAmount] = useState<string>('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [selectedBudgetHeadId, setSelectedBudgetHeadId] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [deductions, setDeductions] = useState<{ amount: string; reason: string }[]>([]);
  const [poNotes, setPoNotes] = useState('');
  const [referredBy, setReferredBy] = useState('');
  const [approvalAction, setApprovalAction] = useState<{ row: PORow; action: 'approve' | 'reject' } | null>(null);
  const [approvalPopup, setApprovalPopup] = useState<PORow | null>(null);
  const [trailRow, setTrailRow] = useState<PORow | null>(null);
  const [editRow, setEditRow] = useState<PORow | null>(null);
  const [editUnapprovedRow, setEditUnapprovedRow] = useState<PORow | null>(null);
  const [regenRow, setRegenRow] = useState<PORow | null>(null);
  const [notesEditRow, setNotesEditRow] = useState<PORow | null>(null);
  const [notesEditValue, setNotesEditValue] = useState('');
  const [referredByEditValue, setReferredByEditValue] = useState('');
  const [paymentTypeRow, setPaymentTypeRow] = useState<PORow | null>(null);
  const [budgetHeadRow, setBudgetHeadRow] = useState<PORow | null>(null);
  const [newBudgetHeadId, setNewBudgetHeadId] = useState('');
  const [budgetHeadReason, setBudgetHeadReason] = useState('');
  const [postLedgerRow, setPostLedgerRow] = useState<PORow | null>(null);
  const [expandedPoId, setExpandedPoId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const createSubmissionLocked = useRef(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/pos', page, pageSize, search, statusFilter, minAmount, maxAmount, dateFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (minAmount) params.minAmount = minAmount;
      if (maxAmount) params.maxAmount = maxAmount;
      if (dateFilter) params.dateFilter = dateFilter;
      const response = await api.get('/purchase-orders', { params });
      return response.data;
    },
    // Refetch when the app regains focus so approvals made on another
    // device/section are reflected immediately in this list.
    refetchOnWindowFocus: 'always',
  });

  // Check for newly approved POs on page load (popup for creator)
  const { data: approvedPOs } = useQuery({
    queryKey: ['/pos', 'approved-notifications'],
    queryFn: async () => {
      const response = await api.get('/purchase-orders', { params: { pageSize: 100, status: 'APPROVED' } });
      return response.data;
    },
    refetchOnMount: true,
  });

  useEffect(() => {
    if (approvedPOs?.data && user) {
      const myApprovedPOs = approvedPOs.data.filter((po: PORow) => po.createdBy === user.id);
      if (myApprovedPOs.length > 0) {
        const dismissedKey = `po-approval-dismissed`;
        const dismissed = JSON.parse(sessionStorage.getItem(dismissedKey) || '[]');
        const newApprovals = myApprovedPOs.filter((po: PORow) => !dismissed.includes(po.id));
        if (newApprovals.length > 0) {
          setApprovalPopup(newApprovals[0]);
        }
      }
    }
  }, [approvedPOs, user]);

  function dismissApprovalPopup() {
    if (approvalPopup) {
      const dismissedKey = `po-approval-dismissed`;
      const dismissed = JSON.parse(sessionStorage.getItem(dismissedKey) || '[]');
      dismissed.push(approvalPopup.id);
      sessionStorage.setItem(dismissedKey, JSON.stringify(dismissed));
    }
    setApprovalPopup(null);
  }

  const { data: vendorsData } = useQuery({
    queryKey: ['/vendors', 'for-po'],
    queryFn: async () => {
      const response = await api.get('/vendors', { params: { pageSize: 100 } });
      return response.data;
    },
  });

  // Fetch approved quotations for the selected vendor
  const { data: approvedQuotations } = useQuery<Quotation[]>({
    queryKey: ['/quotations', 'approved', selectedVendorId],
    queryFn: async () => {
      if (!selectedVendorId) return [];
      const response = await api.get('/quotations', { params: { vendorId: selectedVendorId, status: 'APPROVED', pageSize: 100 } });
      return response.data?.data ?? [];
    },
    enabled: !!selectedVendorId,
  });

  const isNonVendor = (vendorsData?.data ?? []).find((v: { id: string }) => v.id === selectedVendorId)?.vendorType === 'NON_VENDOR';

  // Non-vendor suppliers have no quotation — list their approved material
  // requests that don't have a live PO yet.
  const { data: approvedMprs } = useQuery<{ id: string; mprNumber: string; purchaseOrders?: { id: string }[] }[]>({
    queryKey: ['/material-purchase-requests', 'approved', selectedVendorId],
    queryFn: async () => {
      const response = await api.get('/material-purchase-requests', { params: { vendorId: selectedVendorId, status: 'APPROVED', limit: 100 } });
      return (response.data?.data ?? []).filter((m: { purchaseOrders?: unknown[] }) => !m.purchaseOrders?.length);
    },
    enabled: !!selectedVendorId && isNonVendor,
  });

  const { data: budgetHeadsData } = useQuery({
    queryKey: ['/budget-heads', 'all'],
    queryFn: async () => {
      const response = await api.get('/budget-heads', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
    refetchOnMount: 'always',
  });
  const budgetHeads: { id: string; particulars: string }[] = budgetHeadsData?.data ?? [];

  // Fetch the selected quotation to get its items
  const { data: selectedQuotation } = useQuery<Quotation | null>({
    queryKey: ['/quotations', selectedQuotationId],
    queryFn: async () => {
      if (!selectedQuotationId) return null;
      const response = await api.get(`/quotations/${selectedQuotationId}`);
      return response.data;
    },
    enabled: !!selectedQuotationId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (isNonVendor) {
        // No quotation: PO is raised from the approved MPR at amount 0; prices are filled in via Edit.
        const response = await api.post('/purchase-orders', {
          vendorId: selectedVendorId,
          mprId: selectedMprId,
          paymentType: POPaymentType.AFTER_DELIVERY,
          acknowledged,
        });
        return response.data;
      }
      const response = await api.post('/purchase-orders', {
        vendorId: selectedVendorId,
        quotationId: selectedQuotationId,
        paymentType,
        advanceAmount: (paymentType === POPaymentType.ADVANCE || paymentType === POPaymentType.FULL_PAYMENT) ? Number(advanceAmount) : undefined,
        paymentTerms,
        deliveryDate,
        acknowledged,
        budgetHeadId: selectedBudgetHeadId,
        notes: poNotes.trim() || undefined,
        referredBy: referredBy.trim() || undefined,
        deductions: deductions
          .filter((d) => d.amount && Number(d.amount) > 0 && d.reason.trim())
          .map((d) => ({ amount: Number(d.amount), reason: d.reason.trim() })),
      });
      return response.data;
    },
    onSuccess: () => {
      createSubmissionLocked.current = false;
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: unknown) => {
      createSubmissionLocked.current = false;
      setError(extractErrorMessage(err));
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ poId, comments, acknowledged }: { poId: string; comments?: string; acknowledged: true }) => {
      const response = await api.post(`/purchase-orders/${poId}/approve`, { comments, acknowledged });
      return response.data;
    },
    onMutate: async ({ poId }) => {
      // Optimistic update — flip the approval step to APPROVED instantly.
      await queryClient.cancelQueries({ queryKey: ['/pos'] });
      const prevQueries = queryClient.getQueriesData<{ data: PORow[] }>({ queryKey: ['/pos'] });
      queryClient.setQueriesData<{ data: PORow[] }>({ queryKey: ['/pos'] }, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((po) =>
            po.id === poId
              ? {
                  ...po,
                  approvalWorkflow: po.approvalWorkflow
                    ? { ...po.approvalWorkflow, status: 'APPROVAL_1' }
                    : po.approvalWorkflow,
                }
              : po,
          ),
        };
      });
      return { prevQueries };
    },
    onError: (err: unknown, _vars, context) => {
      // Roll back on error.
      context?.prevQueries.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      setError(extractErrorMessage(err));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
    },
    onSuccess: () => {
      setApprovalAction(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ poId, reason, acknowledged }: { poId: string; reason: string; acknowledged: true }) => {
      const response = await api.post(`/purchase-orders/${poId}/reject`, { reason, acknowledged });
      return response.data;
    },
    onMutate: async ({ poId }) => {
      await queryClient.cancelQueries({ queryKey: ['/pos'] });
      const prevQueries = queryClient.getQueriesData<{ data: PORow[] }>({ queryKey: ['/pos'] });
      queryClient.setQueriesData<{ data: PORow[] }>({ queryKey: ['/pos'] }, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((po) =>
            po.id === poId
              ? {
                  ...po,
                  approvalWorkflow: po.approvalWorkflow
                    ? { ...po.approvalWorkflow, status: 'REJECTED' }
                    : po.approvalWorkflow,
                }
              : po,
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
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
    },
    onSuccess: () => {
      setApprovalAction(null);
    },
  });

  const resubmitMutation = useMutation({
    mutationFn: async (poId: string) => {
      const response = await api.post(`/purchase-orders/${poId}/resubmit`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const [deleteRow, setDeleteRow] = useState<PORow | null>(null);
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/purchase-orders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setDeleteRow(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const [deactivateRow, setDeactivateRow] = useState<PORow | null>(null);
  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/purchase-orders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setDeactivateRow(null);
      setNotesEditRow(null);
      setNotesEditValue('');
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const updateNotesMutation = useMutation({
    mutationFn: async () => {
      const response = await api.patch(`/purchase-orders/${notesEditRow!.id}`, { notes: notesEditValue.trim(), referredBy: referredByEditValue.trim() });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      setNotesEditRow(null);
      setNotesEditValue('');
      setError('');
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const changeBudgetHeadMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/purchase-orders/${budgetHeadRow!.id}/change-budget-head`, {
        budgetHeadId: newBudgetHeadId,
        reason: budgetHeadReason.trim() || undefined,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      queryClient.invalidateQueries({ queryKey: ['/budget-heads'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setBudgetHeadRow(null);
      setNewBudgetHeadId('');
      setBudgetHeadReason('');
      setError('');
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: PORow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const vendors: { id: string; name: string; vendorCode: string }[] = vendorsData?.data ?? [];

  // Auto-open approval dialog when navigated from a push notification
  useApprovalDeepLink(rows, (row) => setApprovalAction({ row, action: 'approve' }));
  // Deep-link from global search: ?id=<poId> — filter to that PO and highlight it
  const { highlightId, rowRef } = useDeepLinkRow<PORow>('/purchase-orders', rows, 'poNumber', (v) => { setSearch(v); setPage(0); });
  useEffect(() => {
    if (highlightId) setExpandedPoId(highlightId);
  }, [highlightId]);
  // Read NL query filters from URL on mount
  useUrlFilters({ search: (v) => { setSearch(v); setPage(0); }, status: (v) => { setStatusFilter(v); setPage(0); }, minAmount: setMinAmount, maxAmount: setMaxAmount, dateFilter: setDateFilter });

  const quotationTotal = useMemo(() => {
    if (!selectedQuotation?.items) return 0;
    return selectedQuotation.items.reduce((sum, i) => sum + Number(i.amount), 0);
  }, [selectedQuotation]);

  const gstAmount = useMemo(() => {
    if (!selectedQuotation?.items) return 0;
    return selectedQuotation.items.reduce((sum, i) => sum + Number(i.amount) * Number(i.gstRate ?? 0) / 100, 0);
  }, [selectedQuotation]);

  const grandTotal = quotationTotal + gstAmount;

  const totalDeductions = useMemo(() => {
    return deductions.reduce((sum, d) => sum + (d.amount ? Number(d.amount) : 0), 0);
  }, [deductions]);

  const netPayable = grandTotal - totalDeductions;

  function resetForm() {
    setSelectedVendorId('');
    setSelectedQuotationId('');
    setSelectedMprId('');
    setPaymentType(POPaymentType.AFTER_DELIVERY);
    setAdvanceAmount('');
    setPaymentTerms('');
    setDeliveryDate('');
    setSelectedBudgetHeadId('');
    setAcknowledged(false);
    setDeductions([]);
    setPoNotes('');
    setReferredBy('');
    setError('');
  }

  function canApprove(row: PORow): boolean {
    if (!row.approvalWorkflow) return false;
    if (!user || (!HEAD_ROLES.includes(user.role as UserRole) && !isAdminRole(user.role))) return false;
    if (row.status !== POStatus.PENDING_APPROVAL) return false;
    // Check if this user's role has a pending step and hasn't already approved
    const step = row.approvalWorkflow.steps.find(
      (s) => s.approverRole === user.role && s.status === 'PENDING'
    );
    if (!step) return false;
    const alreadyApproved = row.approvalWorkflow.steps.some(
      (s) => s.approverUserId === user.id && s.status === 'APPROVED'
    );
    return !alreadyApproved;
  }

  const [pdfLoading, setPdfLoading] = useState(false);

  function handleCreatePO() {
    if (createSubmissionLocked.current || createMutation.isPending) return;
    if (!isNonVendor && !selectedBudgetHeadId) {
      setError(t('errBudgetHead'));
      return;
    }
    createSubmissionLocked.current = true;
    setError('');
    createMutation.mutate();
  }

  function downloadPDF(poId: string, poNumber: string) {
    const token = localStorage.getItem('firebaseToken');
    const url = `${api.defaults.baseURL}/purchase-orders/${poId}/pdf`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${poNumber}.pdf`;
        a.click();
        window.URL.revokeObjectURL(url);
      })
      .catch(() => setError(t('errPdf')));
  }

  function previewPDF(poId: string) {
    if (pdfLoading) return;
    setPdfLoading(true);
    const token = localStorage.getItem('firebaseToken');
    const url = `${api.defaults.baseURL}/purchase-orders/${poId}/pdf`;
    // Open blank window synchronously to avoid popup blockers, then set URL after fetch
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(`<html><head><title>${t('pdfLoadingTitle')}</title></head><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;"><div style="text-align:center;"><div style="border:4px solid #f3f3f3;border-top:4px solid #1976d2;border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite;margin:0 auto 16px;"></div><style>@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style><p>${t('pdfLoadingText')}</p></div></body></html>`);
    }
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const objUrl = window.URL.createObjectURL(blob);
        if (newWindow && !newWindow.closed) {
          newWindow.location.href = objUrl;
        } else {
          // Popup was blocked — fall back to opening in same tab
          window.open(objUrl, '_blank');
        }
      })
      .catch(() => {
        if (newWindow && !newWindow.closed) newWindow.close();
        setError(t('errPreview'));
      })
      .finally(() => setPdfLoading(false));
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>{t('title')}</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          {isMobile && (
            <Button
              variant={isMobileLandscape ? 'contained' : 'outlined'}
              size="small"
              startIcon={<TableChartIcon />}
              onClick={toggleExcelView}
              title={t('toggleTable')}
            >
              {isMobileLandscape ? t('cardView') : t('tableView')}
            </Button>
          )}
          <RefreshButton onClick={() => refetch()} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { resetForm(); setCreateOpen(true); }}>{t('createPo')}</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Rotate instruction — shown when user tapped Table View but is still in portrait */}
      {showRotateHint ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" sx={{ mb: 2 }}>{t('rotateTitle')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('rotateBody')}
          </Typography>
          <Button variant="outlined" onClick={toggleExcelView}>{t('backToCard')}</Button>
        </Card>
      ) : (
      <>
      <Card>
        {!isMobileLandscape && (
          <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
              sx={{ width: { xs: '100%', sm: 300 } }}
            />
            <TextField select size="small" label={t('status')} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} sx={{ width: { xs: '100%', sm: 180 } }}>
              <MenuItem value="">{t('all')}</MenuItem>
              {Object.values(POStatus).map((s) => <MenuItem key={s} value={s}>{enumLabel(s)}</MenuItem>)}
            </TextField>
            <TextField
              size="small"
              label={t('amount')}
              placeholder={t('exactGrandTotal')}
              value={minAmount}
              onChange={(e) => {
                const v = e.target.value;
                setMinAmount(v);
                setMaxAmount(v);
                setPage(0);
              }}
              inputMode="decimal"
              InputProps={{
                startAdornment: <InputAdornment position="start">₹</InputAdornment>,
                endAdornment: minAmount ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => { setMinAmount(''); setMaxAmount(''); setPage(0); }} edge="end"><CloseIcon fontSize="small" /></IconButton>
                  </InputAdornment>
                ) : undefined,
              }}
              sx={{ width: { xs: '100%', sm: 170 } }}
            />
          </Box>
        )}

        {isMobileLandscape && (
          <Box sx={{ p: 1 }}>
            <LandscapeExcelTable
              search={search}
              onSearchChange={(v) => { setSearch(v); setPage(0); }}
              searchPlaceholder={t('searchPlaceholder')}
            >
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>{t('slNo')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('poNo')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('quotationNo')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('poDate')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('vendorName')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('itemDescription')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('paymentType')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">{t('total')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">{t('gst')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">{t('grandTotal')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">{t('netPayable')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">{t('paid')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">{t('toPay')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">{t('actions')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {isLoading ? (
                      <TableRow><TableCell colSpan={14} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
                    ) : rows.length === 0 ? (
                      <TableRow><TableCell colSpan={14} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{t('noPOs')}</Typography></TableCell></TableRow>
                    ) : (
                      rows.map((row, idx) => (
                        <TableRow
                          key={row.id}
                          hover
                          ref={rowRef(row.id)}
                          sx={{ ...(highlightId === row.id && { bgcolor: 'warning.light', '&:hover': { bgcolor: 'warning.light' } }) }}
                        >
                          <TableCell>{page * pageSize + idx + 1}</TableCell>
                          <TableCell>{row.poNumber}</TableCell>
                          <TableCell>{row.quotation?.quotationNumber ?? row.mpr?.mprNumber ?? '—'}</TableCell>
                          <TableCell>{formatDate(row.date)}</TableCell>
                          <TableCell>{row.vendor?.vendorCode} - {row.vendor?.name ?? '—'}</TableCell>
                          <TableCell className="truncate-cell" title={row.notes ?? ''}>{row.notes || '—'}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={enumLabel(row.paymentType)}
                              color={row.paymentType === POPaymentType.ADVANCE
                                ? 'warning'
                                : row.paymentType === POPaymentType.FULL_PAYMENT
                                  ? 'success'
                                  : 'info'}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell align="right">{formatCurrency(row.totalAmount)}</TableCell>
                          <TableCell align="right">{formatCurrency(row.gstAmount)}</TableCell>
                          <TableCell align="right">{formatCurrency(row.grandTotal)}</TableCell>
                          <TableCell align="right">
                            <Typography fontWeight={600}>
                              {formatCurrency(
                                row.totalDeductions && Number(row.totalDeductions) > 0
                                  ? Number(row.netPayable ?? row.grandTotal)
                                  : row.advanceAmount && Number(row.advanceAmount) > 0
                                    ? Number(row.advanceAmount)
                                    : Number(row.grandTotal)
                              )}
                            </Typography>
                          </TableCell>
                          <TableCell align="right" sx={{ color: 'success.main', fontWeight: 600 }}>{formatCurrency(Number(row.paidToDate ?? 0))}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700, color: Number(row.amountToPayNow ?? 0) > 0 ? 'error.main' : 'text.secondary' }}>{formatCurrency(Number(row.amountToPayNow ?? 0))}</TableCell>
                          <TableCell align="right">
                            <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                              <CommentsButton entityType="PURCHASE_ORDER" entityId={row.id} entityLabel={row.poNumber} url="/pos" />
                              <IconButton size="small" onClick={() => previewPDF(row.id)} title={t('previewPdf')} disabled={pdfLoading}>{pdfLoading ? <CircularProgress size={16} /> : <PdfIcon fontSize="small" />}</IconButton>
                              <IconButton size="small" onClick={() => downloadPDF(row.id, row.poNumber)} title={t('downloadPdf')}><DownloadIcon fontSize="small" /></IconButton>
                              {canApprove(row) && (
                                <>
                                  <IconButton size="small" color="success" onClick={() => setApprovalAction({ row, action: 'approve' })} title={t('approve')}><CheckIcon fontSize="small" /></IconButton>
                                  <IconButton size="small" color="error" onClick={() => setApprovalAction({ row, action: 'reject' })} title={t('reject')}><CloseIcon fontSize="small" /></IconButton>
                                </>
                              )}
                              {(row.status === POStatus.APPROVED || row.status === POStatus.DELIVERED || row.status === POStatus.PARTIALLY_DELIVERED) && (
                                <IconButton size="small" onClick={() => { setNotesEditRow(row); setNotesEditValue(row.notes ?? ''); setReferredByEditValue(row.referredBy ?? ''); }} title={t('editPoDetails')}><EditIcon fontSize="small" /></IconButton>
                              )}
                              {(row.status === POStatus.APPROVED || row.status === POStatus.DELIVERED || row.status === POStatus.PARTIALLY_DELIVERED) && user && (isAdminRole(user.role) || user.role === UserRole.ACCOUNTANT) && (
                                <IconButton size="small" color="secondary" onClick={() => setPostLedgerRow(row)} title={t('postToLedger')}><PostLedgerIcon fontSize="small" /></IconButton>
                              )}
                              {row.status === POStatus.APPROVED && (
                                <IconButton size="small" color="secondary" onClick={() => setPaymentTypeRow(row)} title={t('changePaymentType')}><PaymentIcon fontSize="small" /></IconButton>
                              )}
                              {row.status === POStatus.REJECTED && (
                                <IconButton size="small" color="warning" disabled={resubmitMutation.isPending} onClick={() => resubmitMutation.mutate(row.id)} title={t('resubmitForApproval')}><ResubmitIcon fontSize="small" /></IconButton>
                              )}
                              {(row.status === POStatus.PENDING_APPROVAL || row.status === POStatus.REJECTED || (row.status === POStatus.APPROVED && !!user && isAdminRole(user.role))) && (
                                <IconButton size="small" color="primary" onClick={() => setEditUnapprovedRow(row)} title={t('editPo')}><EditIcon fontSize="small" /></IconButton>
                              )}
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </LandscapeExcelTable>
          </Box>
        )}

        {/* PO cards — compact expandable cards matching the Quotations layout */}
        {!isMobileLandscape && (
          isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={32} /></Box>
          ) : rows.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}><Typography color="text.secondary">{t('noPOs')}</Typography></Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, px: 1, pb: 1 }}>
              {rows.map((row) => {
                // Effective status: if the approval workflow is APPROVED/REJECTED
                // but the PO status hasn't caught up yet (stale data), use the
                // workflow status for display — same rule as the Quotations page.
                const wfStatus = row.approvalWorkflow?.status;
                const effectiveStatus =
                  row.status === POStatus.DELETED ? POStatus.DELETED :
                  wfStatus === ApprovalStatus.APPROVED && row.status === POStatus.PENDING_APPROVAL ? POStatus.APPROVED :
                  wfStatus === ApprovalStatus.REJECTED && row.status === POStatus.PENDING_APPROVAL ? POStatus.REJECTED :
                  row.status;

                const hasDeductions = !!row.deductions && row.deductions.length > 0 && Number(row.totalDeductions ?? 0) > 0;
                const netPayable = hasDeductions
                  ? Number(row.netPayable ?? row.grandTotal)
                  : row.advanceAmount && Number(row.advanceAmount) > 0
                    ? Number(row.advanceAmount)
                    : Number(row.grandTotal);
                const netPayableCaption = hasDeductions
                  ? t('netPayable')
                  : row.advanceAmount && Number(row.advanceAmount) > 0
                    ? t('advanceLine', { v: formatCurrency(Number(row.advanceAmount)) })
                    : t('grandTotal');
                const approverNames = row.approvalWorkflow?.steps?.some((s) => s.status === 'APPROVED' && s.approverUser)
                  ? row.approvalWorkflow!.steps.filter((s) => s.status === 'APPROVED' && s.approverUser).map((s) => s.approverUser!.name).join(', ')
                  : '—';

                return (
                  <Accordion
                    key={row.id}
                    ref={rowRef(row.id)}
                    expanded={expandedPoId === row.id}
                    onChange={(_event, expanded) => setExpandedPoId(expanded ? row.id : null)}
                    sx={{
                      mb: 1,
                      bgcolor: highlightId === row.id ? (theme.palette.mode === 'dark' ? 'rgba(255, 202, 40, 0.14)' : 'warning.light') : 'background.paper',
                      color: 'text.primary',
                      border: '1px solid',
                      borderColor: highlightId === row.id ? 'primary.main' : 'divider',
                      borderRadius: 1,
                      overflow: 'hidden',
                      '&:before': { display: 'none' },
                      '&:hover': { borderColor: 'primary.main' },
                    }}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                      sx={{ minHeight: 52, '&.Mui-expanded': { minHeight: 52 }, '& .MuiAccordionSummary-content': { my: 1, '&.Mui-expanded': { my: 1 } } }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
                        <Typography component="span" sx={{ fontSize: { xs: '0.82rem', sm: '0.9rem' } }}>
                          <strong>{row.poNumber}</strong> — {row.vendor?.name ?? '—'} — {formatCurrency(row.grandTotal)} — {t('statusColon')}
                        </Typography>
                        <Chip
                          label={enumLabel(effectiveStatus)}
                          size="small"
                          color={effectiveStatus === POStatus.DELETED ? 'error' : (STATUS_COLORS[effectiveStatus] ?? 'default')}
                          sx={effectiveStatus === POStatus.DELETED ? { bgcolor: '#d32f2f', color: '#fff', textDecoration: 'line-through' } : undefined}
                        />
                        {row.editReason && (
                          <Typography variant="caption" color="warning.main" title={row.editReason}>{t('edited')}</Typography>
                        )}
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary', p: 1.25 }}>
                      <Box sx={{ minWidth: 0 }}>
                        {/* Status bar */}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75, pb: 0.75, borderBottom: '1px solid', borderColor: 'action.hover', gap: 1, flexWrap: 'wrap' }}>
                          <Chip
                            label={enumLabel(effectiveStatus)}
                            size="small"
                            color={effectiveStatus === POStatus.DELETED ? 'error' : (STATUS_COLORS[effectiveStatus] ?? 'default')}
                            sx={effectiveStatus === POStatus.DELETED ? { bgcolor: '#d32f2f', color: '#fff', textDecoration: 'line-through' } : undefined}
                          />
                          <Chip
                            size="small"
                            label={enumLabel(row.paymentType)}
                            color={row.paymentType === POPaymentType.ADVANCE ? 'warning' : row.paymentType === POPaymentType.FULL_PAYMENT ? 'success' : 'info'}
                            variant="outlined"
                          />
                        </Box>

                        {/* Two-column label/value grid */}
                        <Box sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', sm: '140px 1fr 140px 1fr' },
                          gap: { xs: 0.25, sm: '2px 12px' },
                          alignItems: 'baseline',
                        }}>
                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('poNo')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0 }}>
                            {row.poNumber}
                            {row.parentPo && (
                              <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t('fromPo', { n: row.parentPo.poNumber })}</Typography>
                            )}
                            {row.childPos && row.childPos.length > 0 && (
                              <Typography component="span" variant="caption" color="secondary.main" sx={{ display: 'block' }}>{t('regenLine', { list: row.childPos.map((c) => c.poNumber).join(', ') })}</Typography>
                            )}
                          </Typography>

                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('vendor')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0 }}>{row.vendor?.vendorCode} - {row.vendor?.name ?? '—'}</Typography>

                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('quotationNo')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0 }}>{row.quotation?.quotationNumber ?? row.mpr?.mprNumber ?? '—'}</Typography>

                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('poDate')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0 }}>
                            {row.quotation && new Date(row.date) < new Date(row.quotation.date) ? (
                              <>
                                <Box component="span" sx={{ color: 'error.main', fontWeight: 600 }}>{formatDate(row.date)}</Box>
                                <Typography component="span" variant="caption" color="error" sx={{ display: 'block' }}>{t('beforeQuotation', { d: formatDate(row.quotation.date) })}</Typography>
                              </>
                            ) : formatDate(row.date)}
                          </Typography>

                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('paymentType')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0 }}>
                            {enumLabel(row.paymentType)}
                          </Typography>

                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('budgetHead')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0 }}>{row.budgetHead?.particulars ?? '—'}</Typography>

                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('total')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0 }}>{formatCurrency(row.totalAmount)}</Typography>

                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('gst')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0 }}>{formatCurrency(row.gstAmount)}</Typography>

                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('grandTotal')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0 }}>{formatCurrency(row.grandTotal)}</Typography>

                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('netPayable')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0 }}>
                            {formatCurrency(netPayable)}
                            <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>({netPayableCaption})</Typography>
                          </Typography>

                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('paid')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0, color: 'success.main' }}>{formatCurrency(Number(row.paidToDate ?? 0))}</Typography>

                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('toPayNow')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', minWidth: 0, color: Number(row.amountToPayNow ?? 0) > 0 ? 'error.main' : 'text.secondary' }}>{formatCurrency(Number(row.amountToPayNow ?? 0))}</Typography>

                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('createdBy')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0 }}>{row.createdByUser?.name ?? '—'}</Typography>

                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('approvedBy')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0 }}>{approverNames}</Typography>

                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('referredBy')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0 }}>{row.referredBy ?? '—'}</Typography>

                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>{t('description')}</Typography>
                          <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0, overflowWrap: 'break-word' }}>{row.notes || '—'}</Typography>
                        </Box>

                        {/* Deductions */}
                        {hasDeductions && (
                          <Box sx={{ mt: 0.75 }}>
                            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem', display: 'block', mb: 0.25 }}>{t('deductions')}</Typography>
                            <Typography color="error" fontWeight={600} variant="body2">-{formatCurrency(Number(row.totalDeductions ?? 0))}</Typography>
                            {row.deductions!.map((d, i) => (
                              <Typography key={i} variant="caption" color="text.secondary" display="block">
                                {d.reason}: {formatCurrency(d.amount)}
                              </Typography>
                            ))}
                          </Box>
                        )}

                        {/* Items — full width compact table, with Quoted (and, if this
                            quotation was itself raised against an MPR, Requested) columns
                            so a short-delivery / price-change against the quotation is visible. */}
                        {row.items && row.items.length > 0 && (
                          <Box sx={{ mt: 0.5 }}>
                            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem', display: 'block', mb: 0.5 }}>
                              {row.quotation?.mpr ? t('itemsFromQuotationMpr', { q: row.quotation.quotationNumber, m: row.quotation.mpr.mprNumber }) : row.quotation ? t('itemsFromQuotationOnly', { q: row.quotation.quotationNumber }) : t('items')}
                            </Typography>
                            <Box sx={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', mx: -0.5, px: 0.5 }}>
                            <Box component="table" sx={{ width: '100%', minWidth: 430, borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                              <Box component="thead">
                                <Box component="tr" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                                  <Box component="th" sx={{ textAlign: 'left', py: 0.25, px: 0.5, fontWeight: 600, fontSize: '0.7rem', color: 'text.secondary', textTransform: 'uppercase' }}>{t('material')}</Box>
                                  {row.quotation?.mpr && (
                                    <Box component="th" sx={{ textAlign: 'right', py: 0.25, px: 0.5, fontWeight: 600, fontSize: '0.7rem', color: 'text.secondary', textTransform: 'uppercase' }}>{t('requested')}</Box>
                                  )}
                                  {row.quotation?.items && (
                                    <>
                                      <Box component="th" sx={{ textAlign: 'right', py: 0.25, px: 0.5, fontWeight: 600, fontSize: '0.7rem', color: 'text.secondary', textTransform: 'uppercase' }}>{t('quotedQty')}</Box>
                                      <Box component="th" sx={{ textAlign: 'right', py: 0.25, px: 0.5, fontWeight: 600, fontSize: '0.7rem', color: 'text.secondary', textTransform: 'uppercase' }}>{t('quotedPrice')}</Box>
                                    </>
                                  )}
                                  <Box component="th" sx={{ textAlign: 'right', py: 0.25, px: 0.5, fontWeight: 600, fontSize: '0.7rem', color: 'text.secondary', textTransform: 'uppercase' }}>{t('orderedQty')}</Box>
                                  <Box component="th" sx={{ textAlign: 'right', py: 0.25, px: 0.5, fontWeight: 600, fontSize: '0.7rem', color: 'text.secondary', textTransform: 'uppercase' }}>{t('unitPrice')}</Box>
                                  <Box component="th" sx={{ textAlign: 'right', py: 0.25, px: 0.5, fontWeight: 600, fontSize: '0.7rem', color: 'text.secondary', textTransform: 'uppercase' }}>{t('gst')}</Box>
                                  <Box component="th" sx={{ textAlign: 'right', py: 0.25, px: 0.5, fontWeight: 600, fontSize: '0.7rem', color: 'text.secondary', textTransform: 'uppercase' }}>{t('amountInc')}</Box>
                                </Box>
                              </Box>
                              <Box component="tbody">
                                {row.items.map((item, i) => {
                                  const norm = (s: string) => s.trim().toLowerCase();
                                  const requested = row.quotation?.mpr?.items.find((mi) => norm(mi.materialName) === norm(item.materialName));
                                  const quoted = row.quotation?.items?.find((qi) => norm(qi.materialName) === norm(item.materialName));
                                  const qtyVsQuoted = quoted ? Number(item.quantity) - Number(quoted.quantity) : 0;
                                  const priceVsQuoted = quoted ? Number(item.unitPrice) - Number(quoted.unitPrice) : 0;
                                  return (
                                  <Box key={i} component="tr" sx={{ borderBottom: '1px solid', borderColor: 'action.hover', '&:last-child': { borderBottom: 'none' } }}>
                                    <Box component="td" sx={{ py: 0.25, px: 0.5, fontWeight: 600, fontSize: '0.8rem' }}>{item.materialName}</Box>
                                    {row.quotation?.mpr && (
                                      <Box component="td" sx={{ py: 0.25, px: 0.5, textAlign: 'right', fontSize: '0.8rem', whiteSpace: 'nowrap', color: 'text.secondary' }}>
                                        {requested ? `${requested.quantity}${requested.unit ? ` ${requested.unit}` : ''}` : '—'}
                                      </Box>
                                    )}
                                    {row.quotation?.items && (
                                      <>
                                        <Box component="td" sx={{ py: 0.25, px: 0.5, textAlign: 'right', fontSize: '0.8rem', whiteSpace: 'nowrap', color: !quoted ? 'text.disabled' : qtyVsQuoted !== 0 ? 'warning.main' : 'text.secondary' }}>
                                          {quoted ? `${quoted.quantity}${quoted.unit ? ` ${quoted.unit}` : ''}` : '—'}
                                        </Box>
                                        <Box component="td" sx={{ py: 0.25, px: 0.5, textAlign: 'right', fontSize: '0.8rem', whiteSpace: 'nowrap', color: !quoted ? 'text.disabled' : priceVsQuoted !== 0 ? 'warning.main' : 'text.secondary' }}>
                                          {quoted ? formatCurrency(Number(quoted.unitPrice)) : '—'}
                                        </Box>
                                      </>
                                    )}
                                    <Box component="td" sx={{ py: 0.25, px: 0.5, textAlign: 'right', fontSize: '0.8rem', whiteSpace: 'nowrap', fontWeight: qtyVsQuoted !== 0 ? 700 : 400, color: qtyVsQuoted !== 0 ? 'warning.main' : undefined }}>
                                      {item.quantity}{item.unit ? ` ${item.unit}` : ''}{qtyVsQuoted !== 0 ? ` (${qtyVsQuoted > 0 ? '+' : ''}${round2(qtyVsQuoted)})` : ''}
                                    </Box>
                                    <Box component="td" sx={{ py: 0.25, px: 0.5, textAlign: 'right', fontSize: '0.8rem', whiteSpace: 'nowrap', fontWeight: priceVsQuoted !== 0 ? 700 : 400, color: priceVsQuoted !== 0 ? 'warning.main' : undefined }}>
                                      {formatCurrency(Number(item.unitPrice))}{priceVsQuoted !== 0 ? ` (${priceVsQuoted > 0 ? '+' : ''}${formatCurrency(priceVsQuoted)})` : ''}
                                    </Box>
                                    <Box component="td" sx={{ py: 0.25, px: 0.5, textAlign: 'right', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{num(item.gstRate)}% ({formatCurrency(Number(item.amount) * num(item.gstRate) / 100)})</Box>
                                    <Box component="td" sx={{ py: 0.25, px: 0.5, textAlign: 'right', fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{formatCurrency(toIncGst(item.amount, item.gstRate))}</Box>
                                  </Box>
                                  );
                                })}
                              </Box>
                            </Box>
                            </Box>
                          </Box>
                        )}

                        {/* Actions — bottom row */}
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                          <Button size="small" variant="outlined" startIcon={pdfLoading ? <CircularProgress size={16} /> : <PdfIcon />} onClick={() => previewPDF(row.id)} disabled={pdfLoading}>{t('open')}</Button>
                          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => downloadPDF(row.id, row.poNumber)}>{t('pdf')}</Button>
                          <Button size="small" variant="outlined" startIcon={<WhatsAppIcon />} onClick={() => shareOnWhatsApp(buildPOShareMessage({ poNumber: row.poNumber, vendorName: row.vendor?.name, grandTotal: Number(row.grandTotal), status: row.status, date: row.date, totalDeductions: Number(row.totalDeductions ?? 0), netPayable: Number(row.netPayable ?? row.grandTotal), deductions: row.deductions ?? undefined, notes: row.notes ?? undefined }))}>{t('share')}</Button>
                          {row.status !== POStatus.DELETED && (
                            <>
                              {canApprove(row) && (
                                <>
                                  <Button size="small" color="success" startIcon={<CheckIcon />} onClick={() => setApprovalAction({ row, action: 'approve' })}>{t('approve')}</Button>
                                  <Button size="small" color="error" startIcon={<CloseIcon />} onClick={() => setApprovalAction({ row, action: 'reject' })}>{t('reject')}</Button>
                                </>
                              )}
                              {(row.status === POStatus.APPROVED || row.status === POStatus.PARTIALLY_DELIVERED) && (
                                <Button size="small" color="primary" startIcon={<GatePassIcon />} onClick={() => navigate('/gate-passes')}>{t('gatePass')}</Button>
                              )}
                              {(row.status === POStatus.APPROVED || row.status === POStatus.PARTIALLY_DELIVERED || row.status === POStatus.DELIVERED) && (
                                <Button size="small" startIcon={<TimelineIcon />} onClick={() => setTrailRow(row)}>{t('trail')}</Button>
                              )}
                              {row.status === POStatus.PARTIALLY_DELIVERED && !row.parentPoId && (
                                <Button size="small" color="warning" startIcon={<EditIcon />} onClick={() => setEditRow(row)}>{t('matchDelivered')}</Button>
                              )}
                              {row.status === POStatus.REJECTED && (
                                <Button size="small" color="warning" startIcon={<ResubmitIcon />} disabled={resubmitMutation.isPending} onClick={() => resubmitMutation.mutate(row.id)}>{t('resubmitForApproval')}</Button>
                              )}
                              {(row.status === POStatus.PENDING_APPROVAL || row.status === POStatus.REJECTED || (row.status === POStatus.APPROVED && !!user && isAdminRole(user.role))) && (
                                <Button size="small" color="primary" startIcon={<EditIcon />} onClick={() => setEditUnapprovedRow(row)}>{t('editPo')}</Button>
                              )}
                              {(row.status === POStatus.APPROVED || row.status === POStatus.DELIVERED || row.status === POStatus.PARTIALLY_DELIVERED) && (
                                <Button size="small" startIcon={<EditIcon />} onClick={() => { setNotesEditRow(row); setNotesEditValue(row.notes ?? ''); setReferredByEditValue(row.referredBy ?? ''); }}>{t('editDetails')}</Button>
                              )}
                              {(row.status === POStatus.APPROVED || row.status === POStatus.DELIVERED || row.status === POStatus.PARTIALLY_DELIVERED) && user && (isAdminRole(user.role) || user.role === UserRole.ACCOUNTANT) && (
                                <Button size="small" color="secondary" startIcon={<PostLedgerIcon />} onClick={() => setPostLedgerRow(row)}>{t('postLedger')}</Button>
                              )}
                              {(row.status === POStatus.APPROVED || row.status === POStatus.DELIVERED || row.status === POStatus.PARTIALLY_DELIVERED) && row.budgetHeadId && user && isAdminRole(user.role) && (
                                <Button size="small" color="info" startIcon={<SwapBudgetIcon />} onClick={() => { setBudgetHeadRow(row); setNewBudgetHeadId(''); setBudgetHeadReason(''); }}>{t('budgetHead')}</Button>
                              )}
                              {row.status === POStatus.APPROVED && (
                                <Button size="small" color="secondary" startIcon={<PaymentIcon />} onClick={() => setPaymentTypeRow(row)}>{t('paymentType')}</Button>
                              )}
                              {row.status === POStatus.DELIVERED && !row.parentPoId && Array.isArray(row.regenerationData) && (row.regenerationData as unknown[]).length > 0 && (!row.childPos || row.childPos.length === 0) && (
                                <Button size="small" color="secondary" startIcon={<AutoRenewIcon />} onClick={() => setRegenRow(row)}>{t('regenPo')}</Button>
                              )}
                              {row.status !== POStatus.APPROVED && row.status !== POStatus.PARTIALLY_DELIVERED && row.status !== POStatus.DELIVERED && (
                                <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => setDeleteRow(row)}>{t('delete')}</Button>
                              )}
                            </>
                          )}
                        </Box>

                        {row.approvalWorkflow && (
                          <Box sx={{ mt: 1.5 }}>
                            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{t('approvalStatus')}</Typography>
                            <ApprovalStepsDisplay steps={row.approvalWorkflow.steps} />
                          </Box>
                        )}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                );
              })}
            </Box>
          )
        )}

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
      </>
      )}

      {/* Create PO Dialog */}
      <ResponsiveDialog open={createOpen} onClose={() => { setCreateOpen(false); resetForm(); }} maxWidth="md" fullWidth sx={{ '& .MuiDialog-paper': { margin: { xs: 1 } } }}>
        <DialogTitle>{t('createTitle')}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1, flexWrap: 'wrap' }}>
            {/* Vendor Selection */}
            <TextField
              select
              label={t('vendor')}
              value={selectedVendorId}
              onChange={(e) => { setSelectedVendorId(e.target.value); setSelectedQuotationId(''); setSelectedMprId(''); }}
              fullWidth
              size="small"
              required
            >
              {vendors.map((v) => (
                <MenuItem key={v.id} value={v.id}>{v.vendorCode} - {v.name}</MenuItem>
              ))}
            </TextField>

            {/* Non-vendor: no quotation — pick the approved material request instead */}
            {selectedVendorId && isNonVendor && (
              <>
                <Alert severity="info">{t('nonVendorPoInfo')}</Alert>
                <TextField
                  select
                  label={t('approvedMpr')}
                  value={selectedMprId}
                  onChange={(e) => setSelectedMprId(e.target.value)}
                  fullWidth
                  size="small"
                  required
                  helperText={approvedMprs?.length === 0 ? t('noApprovedMprs') : undefined}
                >
                  {approvedMprs?.map((m) => (
                    <MenuItem key={m.id} value={m.id}>{m.mprNumber}</MenuItem>
                  ))}
                </TextField>
              </>
            )}

            {/* Quotation Selection (only approved quotations for this vendor) */}
            {selectedVendorId && !isNonVendor && (
              <TextField
                select
                label={t('quotationApproved')}
                value={selectedQuotationId}
                onChange={(e) => {
                  const quotationId = e.target.value;
                  setSelectedQuotationId(quotationId);
                }}
                fullWidth
                size="small"
                required
                helperText={approvedQuotations?.length === 0 ? t('noApprovedQuotations') : undefined}
              >
                {approvedQuotations?.map((q) => (
                  <MenuItem key={q.id} value={q.id}>{q.quotationNumber} — {formatCurrency(q.grandTotal)}</MenuItem>
                ))}
              </TextField>
            )}

            {!isNonVendor && (<>
            {/* Payment Type Selection */}
            <TextField
              select
              label={t('paymentType')}
              value={paymentType}
              onChange={(e) => {
                const next = e.target.value;
                setPaymentType(next);
                // Auto-fill advance amount for FULL_PAYMENT (defaults to grand total); clear for AFTER_DELIVERY
                if (next === POPaymentType.FULL_PAYMENT) {
                  setAdvanceAmount(String(grandTotal || 0));
                } else if (next === POPaymentType.AFTER_DELIVERY) {
                  setAdvanceAmount('');
                }
              }}
              fullWidth
              size="small"
              required
              helperText={t('paymentTypeHelp')}
            >
              <MenuItem value={POPaymentType.ADVANCE}>{t('ptAdvanceOpt')}</MenuItem>
              <MenuItem value={POPaymentType.AFTER_DELIVERY}>{t('ptAfterOpt')}</MenuItem>
              <MenuItem value={POPaymentType.FULL_PAYMENT}>{t('ptFullOpt')}</MenuItem>
            </TextField>

            {/* Advance Amount — only for ADVANCE / FULL_PAYMENT */}
            {(paymentType === POPaymentType.ADVANCE || paymentType === POPaymentType.FULL_PAYMENT) && (
              <TextField
                label={paymentType === POPaymentType.ADVANCE ? t('advanceAmount') : t('fullPaymentAmount')}
                type="text"
                value={formatIndianNumber(advanceAmount)}
                onChange={(e) => {
                  const value = e.target.value.replace(/,/g, '');
                  const parsedAmount = Number(value);
                  setAdvanceAmount(
                    value === ''
                      ? ''
                      : !Number.isFinite(parsedAmount)
                        ? ''
                        : String(Math.min(parsedAmount, grandTotal))
                  );
                }}
                inputMode="decimal"
                inputProps={{ min: 0, max: grandTotal }}
                fullWidth
                size="small"
                required
                helperText={grandTotal > 0 ? t('maxLine', { v: formatCurrency(grandTotal) }) : t('selectQuotationFirst')}
              />
            )}

            <TextField
              label={t('paymentTerms')}
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              fullWidth
              size="small"
              helperText={t('paymentTermsHelp')}
            />

            <TextField
              label={t('deliveryDue')}
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
            />

            {/* Budget Head Selection */}
            <TextField
              select
              label={t('budgetHeadLabel')}
              value={selectedBudgetHeadId}
              onChange={(e) => setSelectedBudgetHeadId(e.target.value)}
              fullWidth
              size="small"
              required
              helperText={t('budgetHeadHelp')}
            >
              <MenuItem value="">{t('selectBudgetHead')}</MenuItem>
              {budgetHeads.map((h) => <MenuItem key={h.id} value={h.id}>{h.particulars}</MenuItem>)}
            </TextField>

            {/* Item Description / Notes */}
            <TextField
              label={t('itemDescLabel')}
              value={poNotes}
              onChange={(e) => setPoNotes(e.target.value)}
              fullWidth
              size="small"
              multiline
              minRows={2}
              maxRows={4}
              placeholder={t('itemDescPlaceholder')}
            />

            {/* Referred By — existing user names + creatable custom names */}
            <ReferredBySelect value={referredBy} onChange={setReferredBy} />

            {/* Deductions Section */}
            {selectedQuotation && (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="body2" fontWeight={600}>{t('deductionsOptional')}</Typography>
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => setDeductions([...deductions, { amount: '', reason: '' }])}
                  >
                    {t('addDeduction')}
                  </Button>
                </Box>
                {deductions.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    {t('noDeductions')}
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {deductions.map((d, idx) => (
                      <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
                        <TextField
                          label={t('amount')}
                          type="text"
                          value={formatIndianNumber(d.amount)}
                          onChange={(e) => {
                            const value = e.target.value.replace(/,/g, '');
                            const parsed = Number(value);
                            const updated = [...deductions];
                            updated[idx] = { ...d, amount: value === '' ? '' : !Number.isFinite(parsed) ? '' : String(Math.min(parsed, grandTotal)) };
                            setDeductions(updated);
                          }}
                          inputMode="decimal"
                          size="small"
                          sx={{ width: { xs: '100%', sm: 150 }, flexShrink: 0 }}
                        />
                        <TextField
                          label={t('reason')}
                          value={d.reason}
                          onChange={(e) => {
                            const updated = [...deductions];
                            updated[idx] = { ...d, reason: e.target.value };
                            setDeductions(updated);
                          }}
                          size="small"
                          fullWidth
                          placeholder={t('reasonPlaceholder')}
                        />
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setDeductions(deductions.filter((_, i) => i !== idx))}
                          title={t('remove')}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            )}

            {/* Items from quotation (read-only) */}
            {selectedQuotation?.items && selectedQuotation.items.length > 0 && (
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>{t('itemsFromQuotation')}</Typography>
                <TableContainer component={Card} variant="outlined" sx={{ display: { xs: 'none', sm: 'block' } }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>{t('sno')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('material')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('qty')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('unit')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('unitPrice')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('gst')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('amountInc')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedQuotation.items.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{idx + 1}</TableCell>
                          <TableCell>{item.materialName}</TableCell>
                          <TableCell>{item.quantity}</TableCell>
                          <TableCell>{item.unit ?? '—'}</TableCell>
                          <TableCell>{formatCurrency(item.unitPrice)}</TableCell>
                          <TableCell>{Number(item.gstRate ?? 0)}% ({formatCurrency(Number(item.amount) * Number(item.gstRate ?? 0) / 100)})</TableCell>
                          <TableCell>{formatCurrency(Number(item.amount) * (1 + Number(item.gstRate ?? 0) / 100))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Box sx={{ display: { xs: 'flex', sm: 'none' }, flexDirection: 'column', gap: 1 }}>
                  {selectedQuotation.items.map((item, idx) => (
                    <Card key={idx} variant="outlined" sx={{ p: 1.5 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                        <Typography variant="subtitle2" fontWeight={700} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                          {idx + 1}. {item.materialName}
                        </Typography>
                        <Typography variant="subtitle2" fontWeight={700} sx={{ flexShrink: 0 }}>
                          {formatCurrency(Number(item.amount) * (1 + Number(item.gstRate ?? 0) / 100))}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, minmax(0, 1fr))' }, gap: 1 }}>
                        <Box>
                          <Typography variant="caption" color="text.secondary">{t('quantity')}</Typography>
                          <Typography variant="body2" fontWeight={600}>{item.quantity}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">{t('unit')}</Typography>
                          <Typography variant="body2" fontWeight={600}>{item.unit ?? '—'}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">{t('unitPrice')}</Typography>
                          <Typography variant="body2" fontWeight={600}>{formatCurrency(item.unitPrice)}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">{t('gst')}</Typography>
                          <Typography variant="body2" fontWeight={600}>{Number(item.gstRate ?? 0)}% ({formatCurrency(Number(item.amount) * Number(item.gstRate ?? 0) / 100)})</Typography>
                        </Box>
                      </Box>
                    </Card>
                  ))}
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: { xs: 'stretch', sm: 'flex-end' }, gap: 1, mt: 1 }}>
                  <Typography variant="body2" sx={{ textAlign: { xs: 'left', sm: 'right' } }}>{t('totalLine')} <strong>{formatCurrency(quotationTotal)}</strong></Typography>
                  <Typography variant="body2" sx={{ textAlign: { xs: 'left', sm: 'right' } }}>{t('gstAuto')} <strong>{formatCurrency(gstAmount)}</strong></Typography>
                  <Typography variant="body2" sx={{ textAlign: { xs: 'left', sm: 'right' } }}>{t('grandTotalLine')} <strong>{formatCurrency(grandTotal)}</strong></Typography>
                  {totalDeductions > 0 && (
                    <>
                      <Typography variant="body2" color="error" sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
                        {t('lessDeductions')} <strong>-{formatCurrency(totalDeductions)}</strong>
                      </Typography>
                      <Typography variant="body2" sx={{ textAlign: { xs: 'left', sm: 'right' }, fontWeight: 700, fontSize: '1rem' }}>
                        {t('netPayableLine', { v: formatCurrency(netPayable) })}
                      </Typography>
                    </>
                  )}
                </Box>
              </Box>
            )}
            </>)}
            <AcknowledgementCheckbox
              checked={acknowledged}
              onChange={setAcknowledged}
              entityLabel={t('entityPO')}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCreateOpen(false); resetForm(); }}>{t('cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleCreatePO}
            disabled={(!selectedVendorId || (isNonVendor ? !selectedMprId : (!selectedQuotationId || !selectedBudgetHeadId)) || !acknowledged || (!isNonVendor && (paymentType === POPaymentType.ADVANCE || paymentType === POPaymentType.FULL_PAYMENT) && (!advanceAmount || Number(advanceAmount) <= 0))) || createMutation.isPending || createSubmissionLocked.current}
          >
            {createMutation.isPending ? <CircularProgress size={20} /> : t('createPoBtn')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Approval Popup for Creator */}
      <Snackbar
        open={!!approvalPopup}
        autoHideDuration={10000}
        onClose={dismissApprovalPopup}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={dismissApprovalPopup} severity="success" sx={{ width: '100%' }}>
          <Typography variant="body2">
            <strong>{t('approvedPopupTitle', { n: approvalPopup?.poNumber })}</strong>
          </Typography>
          <Typography variant="caption">
            {t('approvedPopupLine', { vendor: approvalPopup?.vendor?.name, total: approvalPopup ? formatCurrency(approvalPopup.grandTotal) : '' })}
          </Typography>
          <Typography variant="caption" display="block">
            {t('approvedPopupNote')}
          </Typography>
        </Alert>
      </Snackbar>

      <ApprovalActionDialog
        open={approvalAction !== null}
        action={approvalAction?.action ?? 'approve'}
        entityLabel={t('entityPOCap')}
        pending={approveMutation.isPending || rejectMutation.isPending}
        error={error}
        onClearError={() => setError('')}
        onClose={() => setApprovalAction(null)}
        onConfirm={(payload) => {
          if (!approvalAction) return;
          if (approvalAction.action === 'approve') {
            approveMutation.mutate({ poId: approvalAction.row.id, comments: payload.comments, acknowledged: true });
          } else {
            rejectMutation.mutate({ poId: approvalAction.row.id, reason: payload.reason!, acknowledged: true });
          }
        }}
      />

      {/* Delivery Trail Dialog */}
      <DeliveryTrailDialog poId={trailRow?.id ?? null} poNumber={trailRow?.poNumber ?? ''} onClose={() => setTrailRow(null)} />

      {/* Edit PO Dialog */}
      <EditPODialog row={editRow} onClose={() => setEditRow(null)} onSuccess={() => { refetch(); setEditRow(null); }} />

      {/* Edit Unapproved PO Dialog */}
      <EditUnapprovedPODialog row={editUnapprovedRow} onClose={() => setEditUnapprovedRow(null)} onSuccess={() => { refetch(); setEditUnapprovedRow(null); }} />

      {/* Regenerate PO Dialog */}
      <RegeneratePODialog row={regenRow} onClose={() => setRegenRow(null)} onSuccess={() => { refetch(); setRegenRow(null); }} />

      {/* Delete Confirmation Dialog */}
      <ResponsiveDialog open={deleteRow !== null} onClose={() => setDeleteRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('deleteTitle')}</DialogTitle>
        <DialogContent>
          <Typography><Trans t={t} i18nKey="deleteConfirm" values={{ n: deleteRow?.poNumber }} components={{ b: <strong /> }} /></Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {t('deleteNote')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRow(null)}>{t('cancel')}</Button>
          <Button color="error" variant="contained" disabled={deleteMutation.isPending} onClick={() => deleteRow && deleteMutation.mutate(deleteRow.id)}>
            {deleteMutation.isPending ? <CircularProgress size={20} /> : t('delete')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Change Payment Type (approved POs — sends back for re-approval) */}
      <ChangePaymentTypeDialog row={paymentTypeRow} onClose={() => setPaymentTypeRow(null)} onSuccess={() => { refetch(); setPaymentTypeRow(null); }} />

      {/* Deactivate Confirmation Dialog (Admin only — works on any PO status) */}
      <ResponsiveDialog open={deactivateRow !== null} onClose={() => setDeactivateRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('deactivateTitle')}</DialogTitle>
        <DialogContent>
          <Typography><Trans t={t} i18nKey="deactivateConfirm" values={{ n: deactivateRow?.poNumber }} components={{ b: <strong /> }} /></Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {t('deactivateNote')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeactivateRow(null)}>{t('cancel')}</Button>
          <Button color="error" variant="contained" disabled={deactivateMutation.isPending} onClick={() => deactivateRow && deactivateMutation.mutate(deactivateRow.id)}>
            {deactivateMutation.isPending ? <CircularProgress size={20} /> : t('deactivate')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Edit Item Description + Referred By (for approved/delivered POs) */}
      <ResponsiveDialog open={notesEditRow !== null} onClose={() => { setNotesEditRow(null); setNotesEditValue(''); setReferredByEditValue(''); }} maxWidth="sm" fullWidth>
        <DialogTitle>{t('editDetailsTitle', { n: notesEditRow?.poNumber })}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <TextField
            label={t('itemDescLabel')}
            value={notesEditValue}
            onChange={(e) => setNotesEditValue(e.target.value)}
            fullWidth
            multiline
            minRows={3}
            maxRows={6}
            placeholder={t('itemDescPlaceholder2')}
            sx={{ mt: 1 }}
          />
          <Box sx={{ mt: 2 }}>
            <ReferredBySelect value={referredByEditValue} onChange={setReferredByEditValue} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {t('editAfterApprovalNote')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setNotesEditRow(null); setNotesEditValue(''); setReferredByEditValue(''); }}>{t('cancel')}</Button>
          {user && isAdminRole(user.role) && notesEditRow && (
            <Button
              color="error"
              variant="outlined"
              disabled={deactivateMutation.isPending}
              onClick={() => setDeactivateRow(notesEditRow)}
            >
              {t('deactivatePo')}
            </Button>
          )}
          <Button
            variant="contained"
            disabled={updateNotesMutation.isPending}
            onClick={() => updateNotesMutation.mutate()}
          >
            {updateNotesMutation.isPending ? <CircularProgress size={20} /> : t('save')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Change Budget Head (admin-only, for approved/delivered POs) */}
      <ResponsiveDialog open={budgetHeadRow !== null} onClose={() => { setBudgetHeadRow(null); setNewBudgetHeadId(''); setBudgetHeadReason(''); }} maxWidth="sm" fullWidth>
        <DialogTitle>{t('changeBudgetTitle', { n: budgetHeadRow?.poNumber })}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Alert severity="info" sx={{ mb: 1 }}>
              <Trans t={t} i18nKey="moveInfo" values={{ amount: formatCurrency(Number(budgetHeadRow?.grandTotal ?? 0)), from: budgetHeadRow?.budgetHead?.particulars ?? '—' }} components={{ b: <strong /> }} />
            </Alert>
            <TextField
              select
              label={t('newBudgetHead')}
              value={newBudgetHeadId}
              onChange={(e) => setNewBudgetHeadId(e.target.value)}
              fullWidth
              size="small"
              required
              helperText={newBudgetHeadId === budgetHeadRow?.budgetHeadId ? t('selectDifferent') : undefined}
              error={newBudgetHeadId === budgetHeadRow?.budgetHeadId}
            >
              {budgetHeads
                .filter((bh) => bh.id !== budgetHeadRow?.budgetHeadId)
                .map((bh) => (
                  <MenuItem key={bh.id} value={bh.id}>{bh.particulars}</MenuItem>
                ))}
            </TextField>
            <TextField
              label={t('reasonOptional')}
              value={budgetHeadReason}
              onChange={(e) => setBudgetHeadReason(e.target.value)}
              fullWidth
              size="small"
              multiline
              minRows={2}
              maxRows={4}
              placeholder={t('reasonBudgetPlaceholder')}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setBudgetHeadRow(null); setNewBudgetHeadId(''); setBudgetHeadReason(''); }}>{t('cancel')}</Button>
          <Button
            variant="contained"
            color="info"
            disabled={!newBudgetHeadId || newBudgetHeadId === budgetHeadRow?.budgetHeadId || changeBudgetHeadMutation.isPending}
            onClick={() => changeBudgetHeadMutation.mutate()}
          >
            {changeBudgetHeadMutation.isPending ? <CircularProgress size={20} /> : t('changeBudgetBtn')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Post to Ledger — post individual PO items to chosen ledgers */}
      <PostToLedgerDialog row={postLedgerRow} onClose={() => setPostLedgerRow(null)} />
    </Box>
  );
}

// ─── Post to Ledger Dialog ─────────────────────────────────
// Two-step flow per the request: pick a PO item → search & pick a ledger →
// the item's amount is posted immediately (Dr ledger / Cr vendor). The dialog
// refetches the PO so posted items show their voucher + ledger chips live.
function PostToLedgerDialog({ row, onClose }: { row: PORow | null; onClose: () => void }) {
  const { t } = useTranslation('po');
  const queryClient = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<POItem | null>(null);
  const [selectedLedgerId, setSelectedLedgerId] = useState('');
  const [selectedLedger, setSelectedLedger] = useState<LedgerOption | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Live PO data — refreshed after each posting so posted chips appear.
  const { data: freshPo } = useQuery<PORow>({
    queryKey: ['/pos', row?.id, 'ledger-posts'],
    queryFn: async () => {
      const response = await api.get(`/purchase-orders/${row!.id}`);
      return response.data;
    },
    enabled: !!row,
  });
  const po = freshPo ?? row;

  const { data: ledgersData } = useQuery({
    queryKey: ['/ledgers', 'all-active'],
    queryFn: async () => {
      const response = await api.get('/ledgers', { params: { pageSize: 500, isActive: 'true' } });
      return response.data;
    },
    enabled: !!row,
  });
  // Only nominal (standalone) ledgers can receive item postings — posting to
  // a bank/cash/owner/other-vendor ledger would create phantom entries. The
  // PO's own vendor ledger IS allowed: selecting it marks the amount as
  // utilised inside the vendor account (debit goes to the Purchase pool).
  const ledgers: LedgerOption[] = (ledgersData?.data ?? []).filter(
    (l: LedgerOption & { linkedEntityId?: string | null }) =>
      !l.linkedEntityType ||
      l.linkedEntityType === 'NONE' ||
      (l.linkedEntityType === 'VENDOR' && l.linkedEntityId === po?.vendor?.id),
  );

  const postMutation = useMutation({
    mutationFn: async ({ itemId, ledgerId }: { itemId: string; ledgerId: string }) => {
      const response = await api.post(`/purchase-orders/${po!.id}/items/${itemId}/post-ledger`, { ledgerId });
      return response.data;
    },
    onSuccess: (data) => {
      setSuccessMsg(data.message ?? t('itemPosted'));
      setDialogError('');
      setSelectedItem(null);
      setSelectedLedgerId('');
      setSelectedLedger(null);
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      queryClient.invalidateQueries({ queryKey: ['/ledgers'] });
      queryClient.invalidateQueries({ queryKey: ['/vouchers'] });
    },
    onError: (err: unknown) => setDialogError(extractErrorMessage(err)),
  });

  function postedInfo(item: POItem) {
    const posted = (item.ledgerPosts ?? []).reduce((s, p) => s + Number(p.taxableAmount), 0);
    const remaining = Math.round((Number(item.amount) - posted) * 100) / 100;
    return { posted, remaining, fully: remaining <= 0 };
  }

  function resetAndClose() {
    setSelectedItem(null);
    setSelectedLedgerId('');
    setSelectedLedger(null);
    setDialogError('');
    setSuccessMsg('');
    onClose();
  }

  return (
    <ResponsiveDialog open={row !== null} onClose={resetAndClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('postLedgerTitle', { n: po?.poNumber })}</DialogTitle>
      <DialogContent>
        {dialogError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDialogError('')}>{dialogError}</Alert>}
        {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

        {!selectedItem ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {t('selectItemPost')}
            </Typography>
            {(po?.items ?? []).map((item, idx) => {
              const info = postedInfo(item);
              return (
                <Card
                  key={item.id ?? idx}
                  variant="outlined"
                  sx={{ mb: 1, cursor: info.fully ? 'default' : 'pointer', opacity: info.fully ? 0.75 : 1, '&:hover': info.fully ? undefined : { borderColor: 'primary.main' } }}
                  onClick={() => {
                    if (!info.fully) {
                      setSelectedItem(item);
                      setSelectedLedgerId('');
                      setSelectedLedger(null);
                      setDialogError('');
                      setSuccessMsg('');
                    }
                  }}
                >
                  <Box sx={{ p: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                      <Typography fontWeight={600}>{item.materialName}</Typography>
                      <Typography fontWeight={600} noWrap>{formatCurrency(item.amount)}</Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      {Number(item.quantity)} {item.unit ?? ''} × {formatCurrency(item.unitPrice)}
                      {Number(item.gstRate ?? 0) > 0 ? t('gstPlus', { r: item.gstRate }) : ''}
                    </Typography>
                    {(item.ledgerPosts ?? []).length > 0 && (
                      <Box sx={{ mt: 0.5, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {item.ledgerPosts!.map((p) => (
                          <Chip
                            key={p.id}
                            size="small"
                            color="success"
                            variant="outlined"
                            label={`${p.ledger?.name ?? t('ledgerFallback')} · ${formatCurrency(Number(p.taxableAmount) + Number(p.gstAmount))} · ${p.journalVoucher?.jvNumber ?? ''}`}
                          />
                        ))}
                      </Box>
                    )}
                    {info.fully ? (
                      <Chip size="small" color="success" label={t('fullyPosted')} sx={{ mt: 0.5 }} />
                    ) : info.posted > 0 ? (
                      <Typography variant="caption" color="warning.dark" sx={{ display: 'block', mt: 0.5 }}>
                        {t('remainingToPost', { v: formatCurrency(info.remaining) })}
                      </Typography>
                    ) : null}
                  </Box>
                </Card>
              );
            })}
          </>
        ) : (
          <>
            <Card variant="outlined" sx={{ p: 1.5, mb: 2, bgcolor: 'action.hover' }}>
              <Typography fontWeight={600}>{selectedItem.materialName}</Typography>
              <Typography variant="caption" color="text.secondary">
                {t('amountToPost', { v: formatCurrency(postedInfo(selectedItem).remaining) })}
                {!po?.payableBooked && Number(selectedItem.gstRate ?? 0) > 0 ? t('gstInputNote', { r: selectedItem.gstRate }) : ''}
              </Typography>
            </Card>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('searchLedger')}
            </Typography>
            <LedgerAutocomplete
              label={t('ledgerLabel')}
              value={selectedLedgerId}
              onChange={(id, ledger) => { setSelectedLedgerId(id); setSelectedLedger(ledger); }}
              ledgers={ledgers}
              autoFocus
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              {po?.payableBooked
                ? t('postingLineReclass', { dr: selectedLedger?.name ?? t('selectedLedgerFallback') })
                : t('postingLine', { dr: selectedLedger?.name ?? t('selectedLedgerFallback'), cr: po?.vendor?.name ?? t('vendorFallback') })}
            </Typography>
          </>
        )}
      </DialogContent>
      <DialogActions>
        {selectedItem && (
          <Button onClick={() => { setSelectedItem(null); setSelectedLedgerId(''); setSelectedLedger(null); }}>{t('back')}</Button>
        )}
        <Button onClick={resetAndClose}>{t('close')}</Button>
        {selectedItem && (
          <Button
            variant="contained"
            disabled={!selectedLedgerId || !selectedItem.id || postMutation.isPending}
            onClick={() => postMutation.mutate({ itemId: selectedItem.id!, ledgerId: selectedLedgerId })}
          >
            {postMutation.isPending
              ? <CircularProgress size={20} />
              : t('postBtn', { v: formatCurrency(postedInfo(selectedItem).remaining), ledger: selectedLedger?.name ?? t('ledgerFallback') })}
          </Button>
        )}
      </DialogActions>
    </ResponsiveDialog>
  );
}

// ─── Delivery Trail Dialog ─────────────────────────────────
interface DeliveryTrailData {
  poNumber: string;
  poStatus: string;
  itemSummary: {
    materialName: string;
    unit: string | null;
    orderedQuantity: number;
    acceptedQuantity: number;
    remainingQuantity: number;
  }[];
  deliveries: {
    gatePassId: string;
    passNumber: string;
    gatePassStatus: string;
    gatePassDate: string;
    approvedDate: string | null;
    items: { materialName: string; deliveredQty: number; unit: string | null }[];
    goodsReceipts: {
      receiptNumber: string;
      receiptStatus: string;
      inspectedAt: string | null;
      postedAt: string | null;
      items: {
        materialName: string;
        deliveredQty: number;
        acceptedQty: number;
        rejectedQty: number;
        rejectionReason: string | null;
      }[];
    }[];
  }[];
  assets: {
    id: string;
    assetId: string;
    status: string;
    location: string;
    serialNumber: string | null;
    totalCost: number | null;
    receiptNumber: string | null;
    itemName: string;
  }[];
}

function DeliveryTrailDialog({ poId, poNumber, onClose }: { poId: string | null; poNumber: string; onClose: () => void }) {
  const { t } = useTranslation('po');
  const navigate = useNavigate();
  const { data, isLoading } = useQuery<DeliveryTrailData>({
    queryKey: ['/pos', poId, 'delivery-trail'],
    queryFn: async () => {
      if (!poId) return null as unknown as DeliveryTrailData;
      const response = await api.get(`/purchase-orders/${poId}/delivery-trail`);
      return response.data;
    },
    enabled: !!poId,
  });

  return (
    <ResponsiveDialog open={!!poId} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('deliveryTrailTitle', { n: poNumber })}</DialogTitle>
      <DialogContent>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : data ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
            {/* Item Summary */}
            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{t('itemSummary')}</Typography>
              <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>{t('material')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('ordered')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('accepted')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('remaining')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('unit')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.itemSummary.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{item.materialName}</TableCell>
                        <TableCell>{formatIndianNumber(item.orderedQuantity)}</TableCell>
                        <TableCell sx={{ color: item.acceptedQuantity > 0 ? 'success.main' : 'text.secondary' }}>{formatIndianNumber(item.acceptedQuantity)}</TableCell>
                        <TableCell sx={{ color: item.remainingQuantity > 0 ? 'warning.main' : 'success.main' }}>{formatIndianNumber(item.remainingQuantity)}</TableCell>
                        <TableCell>{item.unit ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>

            {/* Delivery Instances */}
            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                {t('deliveryInstances', { n: data.deliveries.length })}
              </Typography>
              {data.deliveries.length === 0 ? (
                <Typography variant="body2" color="text.secondary">{t('noDeliveries')}</Typography>
              ) : (
                data.deliveries.map((delivery, idx) => (
                  <Accordion key={delivery.gatePassId} defaultExpanded={idx === data.deliveries.length - 1}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Chip size="small" label={delivery.passNumber} color="primary" />
                        <Chip size="small" label={enumLabel(delivery.gatePassStatus)} color={STATUS_COLORS[delivery.gatePassStatus] ?? 'default'} />
                        <Typography variant="caption" color="text.secondary">{formatDate(delivery.gatePassDate)}</Typography>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      {/* Gate Pass Items */}
                      <Typography variant="caption" fontWeight={600} color="text.secondary">{t('gatePassItems')}</Typography>
                      <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto', mb: 2 }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 600 }}>{t('material')}</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>{t('deliveredQty')}</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>{t('unit')}</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {delivery.items.map((item, i) => (
                              <TableRow key={i}>
                                <TableCell>{item.materialName}</TableCell>
                                <TableCell>{formatIndianNumber(item.deliveredQty)}</TableCell>
                                <TableCell>{item.unit ?? '—'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>

                      {/* Goods Receipts / Inspection Results */}
                      {delivery.goodsReceipts.length > 0 ? (
                        delivery.goodsReceipts.map((gr, grIdx) => (
                          <Box key={grIdx} sx={{ mt: grIdx > 0 ? 2 : 0 }}>
                            <Typography variant="caption" fontWeight={600} color="text.secondary">
                              {t('goodsReceiptLine', { n: gr.receiptNumber, s: enumLabel(gr.receiptStatus) })}
                            </Typography>
                            <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600 }}>{t('material')}</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>{t('delivered')}</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>{t('accepted')}</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>{t('rejected')}</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>{t('reason')}</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {gr.items.map((item, i) => (
                                    <TableRow key={i}>
                                      <TableCell>{item.materialName}</TableCell>
                                      <TableCell>{formatIndianNumber(item.deliveredQty)}</TableCell>
                                      <TableCell sx={{ color: 'success.main' }}>{formatIndianNumber(item.acceptedQty)}</TableCell>
                                      <TableCell sx={{ color: item.rejectedQty > 0 ? 'error.main' : 'text.secondary' }}>{formatIndianNumber(item.rejectedQty)}</TableCell>
                                      <TableCell>{item.rejectionReason ?? '—'}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableContainer>
                            {gr.inspectedAt && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                {t('inspectedLine', { d: formatDate(gr.inspectedAt) })}
                                {gr.postedAt && t('postedLine', { d: formatDate(gr.postedAt) })}
                              </Typography>
                            )}
                          </Box>
                        ))
                      ) : (
                        <Alert severity="info" sx={{ mt: 1 }}>
                          {t('noGrn')}
                        </Alert>
                      )}
                    </AccordionDetails>
                  </Accordion>
                ))
              )}
            </Box>

            {/* Assets Generated */}
            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                {t('assetsGenerated', { n: data.assets?.length ?? 0 })}
              </Typography>
              {data.assets && data.assets.length > 0 ? (
                <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>{t('assetId')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('item')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('serial')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('status')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('location')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('grn')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('cost')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.assets.map((a) => (
                        <TableRow key={a.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/scan/${a.assetId}`)}>
                          <TableCell><strong>{a.assetId}</strong></TableCell>
                          <TableCell>{a.itemName}</TableCell>
                          <TableCell>{a.serialNumber ?? '—'}</TableCell>
                          <TableCell><Chip size="small" label={enumLabel(a.status)} color={(STATUS_COLORS[a.status] ?? 'default') as never} /></TableCell>
                          <TableCell>{a.location}</TableCell>
                          <TableCell>{a.receiptNumber ?? '—'}</TableCell>
                          <TableCell>{a.totalCost != null ? `₹${a.totalCost.toLocaleString('en-IN')}` : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" color="text.secondary">{t('noAssets')}</Typography>
              )}
            </Box>
          </Box>
        ) : (
          <Typography color="text.secondary">{t('noData')}</Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('close')}</Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

// ─── Edit PO Dialog ─────────────────────────────────
interface EditItem {
  id?: string;
  materialName: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  gstRate: string;
  accepted: number;
  selected: boolean;
}

function EditPODialog({ row, onClose, onSuccess }: { row: PORow | null; onClose: () => void; onSuccess: () => void }) {
  const { t } = useTranslation('po');
  const queryClient = useQueryClient();
  const [items, setItems] = useState<EditItem[]>([]);
  const [editReason, setEditReason] = useState('');
  const [error, setError] = useState('');
  const [deliveryData, setDeliveryData] = useState<{ itemSummary: { materialName: string; acceptedQuantity: number; orderedQuantity: number; remainingQuantity: number }[] } | null>(null);

  // Fetch delivery trail data to show accepted quantities
  useEffect(() => {
    if (!row) return;
    api.get(`/purchase-orders/${row.id}/delivery-trail`)
      .then((res) => setDeliveryData(res.data))
      .catch(() => setDeliveryData(null));
  }, [row]);

  // Initialize items from PO row
  useEffect(() => {
    if (!row) return;
    const acceptedMap = new Map<string, number>();
    if (deliveryData?.itemSummary) {
      for (const item of deliveryData.itemSummary) {
        acceptedMap.set(item.materialName.toLowerCase(), item.acceptedQuantity);
      }
    }
    setItems(row.items.map((item) => ({
      id: item.id,
      materialName: item.materialName,
      quantity: String(item.quantity),
      unit: item.unit ?? 'nos',
      unitPrice: String(item.unitPrice),
      gstRate: String(item.gstRate ?? 0),
      accepted: acceptedMap.get(item.materialName.toLowerCase()) ?? 0,
      selected: true,
    })));
    setEditReason('');
    setError('');
  }, [row, deliveryData]);

  const mutation = useMutation({
    mutationFn: async () => {
      const selectedItems = items.filter((i) => i.selected);
      if (selectedItems.length === 0) throw new Error(t('errSelectItem'));
      if (!editReason.trim()) throw new Error(t('errEditReason'));
      await api.post(`/purchase-orders/${row!.id}/edit`, {
        items: selectedItems.map((i) => ({
          poItemId: i.id,
          materialName: i.materialName,
          quantity: Number(i.quantity),
          unit: i.unit,
          unitPrice: Number(i.unitPrice),
          gstRate: Number(i.gstRate),
        })),
        editReason: editReason.trim(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      onSuccess();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const selectedItems = items.filter((i) => i.selected);
  const totalAmount = selectedItems.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  const gstAmount = selectedItems.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0) * (Number(i.gstRate) || 0) / 100, 0);
  const grandTotal = totalAmount + gstAmount;
  const remainingItems = items.filter((i) => (Number(i.quantity) || 0) - i.accepted > 0);

  return (
    <ResponsiveDialog open={!!row} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('editPoTitle', { n: row?.poNumber })}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('partialWarn')}
        </Alert>
        <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto', mb: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell sx={{ fontWeight: 600 }}>{t('material')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('accepted')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('qty')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('unit')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('unitPrice')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('gstPct')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item, idx) => (
                <TableRow key={idx} sx={{ opacity: item.selected ? 1 : 0.5 }}>
                  <TableCell padding="checkbox">
                    <input type="checkbox" checked={item.selected} onChange={(e) => {
                      const next = [...items];
                      next[idx] = { ...item, selected: e.target.checked };
                      setItems(next);
                    }} />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      value={item.materialName}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...item, materialName: e.target.value };
                        setItems(next);
                      }}
                      sx={{ minWidth: 140 }}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip label={item.accepted} size="small" color="success" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      type="number"
                      value={item.quantity}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...item, quantity: e.target.value };
                        setItems(next);
                      }}
                      sx={{ width: 80 }}
                      error={item.selected && Number(item.quantity) < item.accepted}
                      helperText={item.selected && Number(item.quantity) < item.accepted ? t('minLine', { n: item.accepted }) : ''}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      size="small"
                      value={item.unit}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...item, unit: e.target.value };
                        setItems(next);
                      }}
                      sx={{ width: 120 }}
                    >
                      {QTY_UNIT_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>{unitLabel(opt.value)}</MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      type="number"
                      value={item.unitPrice}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...item, unitPrice: e.target.value };
                        setItems(next);
                      }}
                      sx={{ width: 100 }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      select
                      value={item.gstRate}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...item, gstRate: e.target.value };
                        setItems(next);
                      }}
                      sx={{ width: 80 }}
                    >
                      {GST_RATES.map((r) => <MenuItem key={r} value={r}>{r}%</MenuItem>)}
                    </TextField>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Summary */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Chip label={t('chipTotal', { v: totalAmount.toLocaleString('en-IN') })} />
          <Chip label={t('chipGst', { v: gstAmount.toLocaleString('en-IN') })} />
          <Chip label={t('chipGrand', { v: grandTotal.toLocaleString('en-IN') })} color="primary" />
          {remainingItems.length > 0 && (
            <Chip label={t('chipRegen', { n: remainingItems.length })} color="secondary" variant="outlined" />
          )}
        </Box>

        <TextField
          label={t('editReasonLabel')}
          value={editReason}
          onChange={(e) => setEditReason(e.target.value)}
          fullWidth
          size="small"
          multiline
          rows={2}
          placeholder={t('editReasonPlaceholder')}
        />
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button
          variant="contained"
          color="warning"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? <CircularProgress size={20} /> : t('editSend')}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

// ─── Change Payment Type Dialog ───────────────────────────
// Approved POs only. Saving sends the PO back for re-approval; once approved
// again it is treated as the new type (advance payments / invoice flow).
function ChangePaymentTypeDialog({ row, onClose, onSuccess }: { row: PORow | null; onClose: () => void; onSuccess: () => void }) {
  const { t } = useTranslation('po');
  const queryClient = useQueryClient();
  const [newType, setNewType] = useState('');
  const [advAmount, setAdvAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setNewType('');
    setAdvAmount('');
    setReason('');
    setError('');
  }, [row]);

  const mutation = useMutation({
    mutationFn: async () => {
      await api.post(`/purchase-orders/${row!.id}/change-payment-type`, {
        paymentType: newType,
        advanceAmount: (newType === POPaymentType.ADVANCE || newType === POPaymentType.FULL_PAYMENT) ? Number(advAmount) : undefined,
        reason: reason.trim(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      onSuccess();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const needsAdvance = newType === POPaymentType.ADVANCE || newType === POPaymentType.FULL_PAYMENT;
  const canSubmit = !!newType && reason.trim().length > 0 && (!needsAdvance || Number(advAmount) > 0);

  return (
    <ResponsiveDialog open={!!row} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('changePtTitle', { n: row?.poNumber })}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('changePtInfo')}
        </Alert>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label={t('currentPt')}
            value={row?.paymentType ? enumLabel(row.paymentType) : ''}
            size="small"
            fullWidth
            InputProps={{ readOnly: true }}
          />
          <TextField
            select
            label={t('newPt')}
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            size="small"
            fullWidth
            required
          >
            <MenuItem value="">{t('select')}</MenuItem>
            {[POPaymentType.ADVANCE, POPaymentType.AFTER_DELIVERY, POPaymentType.FULL_PAYMENT]
              .filter((pt) => pt !== row?.paymentType)
              .map((pt) => <MenuItem key={pt} value={pt}>{enumLabel(pt)}</MenuItem>)}
          </TextField>
          {needsAdvance && (
            <TextField
              label={newType === POPaymentType.ADVANCE ? t('advanceAmount') : t('fullPaymentAmount')}
              type="text"
              value={formatIndianNumber(advAmount)}
              onChange={(e) => setAdvAmount(e.target.value.replace(/,/g, ''))}
              inputMode="decimal"
              size="small"
              fullWidth
              required
              helperText={t('poGrandTotalHelp', { v: formatCurrency(Number(row?.grandTotal ?? 0)) })}
            />
          )}
          <TextField
            label={t('reasonRequired')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            size="small"
            fullWidth
            multiline
            rows={2}
            required
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="contained" onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
          {mutation.isPending ? <CircularProgress size={20} /> : t('saveSend')}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

// ─── Edit Unapproved PO Dialog ────────────────────────────
function EditUnapprovedPODialog({ row, onClose, onSuccess }: { row: PORow | null; onClose: () => void; onSuccess: () => void }) {
  const { t } = useTranslation('po');
  const queryClient = useQueryClient();
  const [items, setItems] = useState<EditItem[]>([]);
  const [paymentTerms, setPaymentTerms] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [budgetHeadId, setBudgetHeadId] = useState('');
  const [notes, setNotes] = useState('');
  const [referredBy, setReferredBy] = useState('');
  const [paymentType, setPaymentType] = useState<string>(POPaymentType.AFTER_DELIVERY);
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [error, setError] = useState('');

  const { data: budgetHeadsData } = useQuery({
    queryKey: ['/budget-heads', 'all'],
    queryFn: async () => {
      const response = await api.get('/budget-heads', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
  });
  const budgetHeads: { id: string; particulars: string }[] = budgetHeadsData?.data ?? [];

  useEffect(() => {
    if (!row) return;
    setItems(row.items.map((item) => ({
      materialName: item.materialName,
      quantity: String(item.quantity),
      unit: item.unit ?? 'nos',
      unitPrice: String(item.unitPrice),
      gstRate: String(item.gstRate ?? 0),
      accepted: 0,
      selected: true,
    })));
    setPaymentTerms(row.paymentTerms ?? '');
    setDeliveryDate(row.deliveryDate ? new Date(row.deliveryDate).toISOString().split('T')[0] : '');
    setBudgetHeadId(row.budgetHeadId ?? '');
    setNotes(row.notes ?? '');
    setReferredBy(row.referredBy ?? '');
    setPaymentType(row.paymentType);
    setAdvanceAmount(row.advanceAmount ? String(Number(row.advanceAmount)) : '');
    setError('');
  }, [row]);

  const mutation = useMutation({
    mutationFn: async () => {
      await api.post(`/purchase-orders/${row!.id}/edit-unapproved`, {
        paymentType,
        advanceAmount: (paymentType === POPaymentType.ADVANCE || paymentType === POPaymentType.FULL_PAYMENT) ? Number(advanceAmount) : undefined,
        paymentTerms: paymentTerms || undefined,
        deliveryDate: deliveryDate || undefined,
        budgetHeadId,
        notes,
        referredBy: referredBy.trim() || undefined,
        items: items.map((i) => ({
          materialName: i.materialName,
          quantity: Number(i.quantity),
          unit: i.unit,
          unitPrice: Number(i.unitPrice),
          gstRate: Number(i.gstRate),
        })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      onSuccess();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const totalAmount = items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  const gstAmount = items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0) * (Number(i.gstRate) || 0) / 100, 0);
  const grandTotal = totalAmount + gstAmount;

  return (
    <ResponsiveDialog open={!!row} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('editPoTitle', { n: row?.poNumber })}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        <Alert severity={row?.status === POStatus.APPROVED ? 'warning' : 'info'} sx={{ mb: 2 }}>
          {row?.status === POStatus.APPROVED ? t('alertApproved') : t('alertNotApproved')}
        </Alert>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              select
              label={t('paymentType')}
              value={paymentType}
              onChange={(e) => {
                const next = e.target.value;
                setPaymentType(next);
                if (next === POPaymentType.FULL_PAYMENT) setAdvanceAmount(String(grandTotal || 0));
                else if (next === POPaymentType.AFTER_DELIVERY) setAdvanceAmount('');
              }}
              fullWidth
              size="small"
              required
            >
              <MenuItem value={POPaymentType.ADVANCE}>{t('ptAdvanceOpt')}</MenuItem>
              <MenuItem value={POPaymentType.AFTER_DELIVERY}>{t('ptAfterOpt')}</MenuItem>
              <MenuItem value={POPaymentType.FULL_PAYMENT}>{t('ptFullOpt')}</MenuItem>
            </TextField>
            {(paymentType === POPaymentType.ADVANCE || paymentType === POPaymentType.FULL_PAYMENT) && (
              <TextField
                label={paymentType === POPaymentType.ADVANCE ? t('advanceAmount') : t('fullPaymentAmount')}
                type="number"
                value={advanceAmount}
                onChange={(e) => setAdvanceAmount(e.target.value)}
                size="small"
                required
                sx={{ width: { xs: '100%', sm: 200 } }}
              />
            )}
          </Box>

          <TextField
            label={t('paymentTerms')}
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={2}
          />

          <TextField
            label={t('deliveryDate')}
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
            fullWidth
            size="small"
            InputLabelProps={{ shrink: true }}
          />

          <TextField
            select
            label={t('budgetHeadLabel')}
            value={budgetHeadId}
            onChange={(e) => setBudgetHeadId(e.target.value)}
            fullWidth
            size="small"
            required
          >
            <MenuItem value="">{t('selectBudgetHead')}</MenuItem>
            {budgetHeads.map((h) => <MenuItem key={h.id} value={h.id}>{h.particulars}</MenuItem>)}
          </TextField>

          <TextField
            label={t('itemDescription')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={2}
            placeholder={t('itemDescPlaceholder3')}
          />

          <ReferredBySelect value={referredBy} onChange={setReferredBy} />
        </Box>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('items')}</Typography>
        <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto', mb: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('material')}</TableCell>
                <TableCell align="right">{t('qty')}</TableCell>
                <TableCell>{t('unit')}</TableCell>
                <TableCell align="right">{t('unitPrice')}</TableCell>
                <TableCell align="right">{t('gstPct')}</TableCell>
                <TableCell align="right">{t('amount')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <TextField
                      size="small"
                      value={item.materialName}
                      onChange={(e) => {
                        const updated = [...items];
                        updated[index] = { ...updated[index], materialName: e.target.value };
                        setItems(updated);
                      }}
                      sx={{ minWidth: 150 }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <TextField
                      size="small"
                      value={item.quantity}
                      onChange={(e) => {
                        const updated = [...items];
                        updated[index] = { ...updated[index], quantity: e.target.value };
                        setItems(updated);
                      }}
                      sx={{ width: 90 }}
                      inputProps={{ style: { textAlign: 'right' }, inputMode: 'decimal' }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      size="small"
                      value={item.unit}
                      onChange={(e) => {
                        const updated = [...items];
                        updated[index] = { ...updated[index], unit: e.target.value };
                        setItems(updated);
                      }}
                      sx={{ width: 120 }}
                    >
                      {QTY_UNIT_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>{unitLabel(opt.value)}</MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell align="right">
                    <TextField
                      size="small"
                      value={item.unitPrice}
                      onChange={(e) => {
                        const updated = [...items];
                        updated[index] = { ...updated[index], unitPrice: e.target.value };
                        setItems(updated);
                      }}
                      sx={{ width: 110 }}
                      InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
                      inputProps={{ style: { textAlign: 'right' }, inputMode: 'decimal' }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <TextField
                      select
                      size="small"
                      value={item.gstRate}
                      onChange={(e) => {
                        const updated = [...items];
                        updated[index] = { ...updated[index], gstRate: e.target.value };
                        setItems(updated);
                      }}
                      sx={{ width: 90 }}
                    >
                      {GST_RATES.map((r) => <MenuItem key={r} value={r}>{r}%</MenuItem>)}
                    </TextField>
                  </TableCell>
                  <TableCell align="right">
                    {formatCurrency((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 3 }}>
          <Typography variant="body2">{t('totalLine')} <strong>{formatCurrency(totalAmount)}</strong></Typography>
          <Typography variant="body2">{t('gstLine')} <strong>{formatCurrency(gstAmount)}</strong></Typography>
          <Typography variant="body2">{t('grandTotalLine')} <strong>{formatCurrency(grandTotal)}</strong></Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button
          variant="contained"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !budgetHeadId || items.length === 0}
        >
          {mutation.isPending ? <CircularProgress size={20} /> : t('saveChanges')}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

// ─── Regenerate PO Dialog ─────────────────────────────────
function RegeneratePODialog({ row, onClose, onSuccess }: { row: PORow | null; onClose: () => void; onSuccess: () => void }) {
  const { t } = useTranslation('po');
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const remainingItems = (row?.regenerationData as { materialName: string; quantity: number; unit: string; unitPrice: number; gstRate: number }[] | null) ?? [];

  const mutation = useMutation({
    mutationFn: async () => {
      await api.post(`/purchase-orders/${row!.id}/regenerate`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      onSuccess();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const totalAmount = remainingItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const gstAmount = remainingItems.reduce((sum, i) => sum + (i.quantity * i.unitPrice) * i.gstRate / 100, 0);
  const grandTotal = totalAmount + gstAmount;

  return (
    <ResponsiveDialog open={!!row} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('regenTitle', { n: row?.poNumber })}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('regenInfo')}
        </Alert>
        <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto', mb: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{t('material')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('qty')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('unit')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('unitPrice')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('gstPct')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {remainingItems.map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell>{item.materialName}</TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>{item.unit}</TableCell>
                  <TableCell>₹{item.unitPrice.toLocaleString('en-IN')}</TableCell>
                  <TableCell>{item.gstRate}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Chip label={t('chipTotal', { v: totalAmount.toLocaleString('en-IN') })} />
          <Chip label={t('chipGst', { v: gstAmount.toLocaleString('en-IN') })} />
          <Chip label={t('chipGrand', { v: grandTotal.toLocaleString('en-IN') })} color="primary" />
        </Box>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? <CircularProgress size={20} /> : t('generateRegen')}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

/** "Referred By" picker for POs — suggests active user names plus any names
 * previously created via the PO_REFERRED_BY dropdown options, and lets the
 * user create a new custom name inline (persisted for next time). */
function ReferredBySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation('po');
  const { data } = useQuery<{ data: string[] }>({
    queryKey: ['/auth/users/names'],
    queryFn: async () => (await api.get('/auth/users/names')).data,
    staleTime: 60_000,
  });
  const staticOptions = (data?.data ?? []).map((n) => ({ value: n, label: n }));
  return (
    <CreatableSelect
      label={t('referredBy')}
      value={value}
      onChange={onChange}
      dropdownType="PO_REFERRED_BY"
      staticOptions={staticOptions}
      placeholder={t('refPlaceholder')}
      createButtonLabel={t('newName')}
    />
  );
}
