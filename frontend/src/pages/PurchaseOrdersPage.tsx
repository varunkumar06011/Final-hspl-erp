import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
  SwapHoriz as SwapBudgetIcon,
  Payment as PaymentIcon,
  TableChart as TableChartIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { POStatus, UserRole, POPaymentType, GST_RATES, isAdminRole } from '@hospital-erp/shared';
import { formatCurrency, formatDate, formatIndianNumber, STATUS_COLORS, QTY_UNIT_OPTIONS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import AcknowledgementCheckbox from '../components/AcknowledgementCheckbox';
import ApprovalActionDialog from '../components/ApprovalActionDialog';
import ResponsiveTable from '../components/ResponsiveTable';
import TruncatedText from '../components/TruncatedText';
import LandscapeExcelTable from '../components/LandscapeExcelTable';
import PortraitRotateHint from '../components/PortraitRotateHint';
import { useMobileLandscape, useMobilePortrait } from '../hooks/useMobileLandscape';
import { useApprovalDeepLink } from '../utils/useApprovalDeepLink';
import { useDeepLinkRow } from '../hooks/useDeepLinkRow';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { shareOnWhatsApp, buildPOShareMessage } from '../utils/whatsappShare';

interface POItem {
  id?: string;
  materialName: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  amount: number;
  gstRate?: number;
}

interface Quotation {
  id: string;
  quotationNumber: string;
  totalAmount: number;
  gstAmount: number;
  grandTotal: number;
  items: POItem[];
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
  quotation: { id: string; quotationNumber: string; date: string; createdAt: string };
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
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { excelView: isMobileLandscape, isMobile, wantsTable, showRotateHint, toggleExcelView } = useMobileLandscape();
  const isMobilePortrait = useMobilePortrait();
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedQuotationId, setSelectedQuotationId] = useState('');
  const [paymentType, setPaymentType] = useState<string>(POPaymentType.AFTER_DELIVERY);
  const [advanceAmount, setAdvanceAmount] = useState<string>('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [selectedBudgetHeadId, setSelectedBudgetHeadId] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [deductions, setDeductions] = useState<{ amount: string; reason: string }[]>([]);
  const [poNotes, setPoNotes] = useState('');
  const [approvalAction, setApprovalAction] = useState<{ row: PORow; action: 'approve' | 'reject' } | null>(null);
  const [approvalPopup, setApprovalPopup] = useState<PORow | null>(null);
  const [trailRow, setTrailRow] = useState<PORow | null>(null);
  const [editRow, setEditRow] = useState<PORow | null>(null);
  const [editUnapprovedRow, setEditUnapprovedRow] = useState<PORow | null>(null);
  const [regenRow, setRegenRow] = useState<PORow | null>(null);
  const [notesEditRow, setNotesEditRow] = useState<PORow | null>(null);
  const [notesEditValue, setNotesEditValue] = useState('');
  const [paymentTypeRow, setPaymentTypeRow] = useState<PORow | null>(null);
  const [budgetHeadRow, setBudgetHeadRow] = useState<PORow | null>(null);
  const [newBudgetHeadId, setNewBudgetHeadId] = useState('');
  const [budgetHeadReason, setBudgetHeadReason] = useState('');
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
      const response = await api.patch(`/purchase-orders/${notesEditRow!.id}`, { notes: notesEditValue.trim() });
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
    setPaymentType(POPaymentType.AFTER_DELIVERY);
    setAdvanceAmount('');
    setPaymentTerms('');
    setDeliveryDate('');
    setSelectedBudgetHeadId('');
    setAcknowledged(false);
    setDeductions([]);
    setPoNotes('');
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
    if (!selectedBudgetHeadId) {
      setError('Budget head is required');
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
      .catch(() => setError('Failed to download PDF'));
  }

  function previewPDF(poId: string) {
    if (pdfLoading) return;
    setPdfLoading(true);
    const token = localStorage.getItem('firebaseToken');
    const url = `${api.defaults.baseURL}/purchase-orders/${poId}/pdf`;
    // Open blank window synchronously to avoid popup blockers, then set URL after fetch
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write('<html><head><title>PO PDF Loading...</title></head><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;"><div style="text-align:center;"><div style="border:4px solid #f3f3f3;border-top:4px solid #1976d2;border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite;margin:0 auto 16px;"></div><style>@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style><p>Loading PDF...</p></div></body></html>');
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
        setError('Failed to preview PDF');
      })
      .finally(() => setPdfLoading(false));
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>Purchase Orders</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          {isMobile && (
            <Button
              variant={isMobileLandscape ? 'contained' : 'outlined'}
              size="small"
              startIcon={<TableChartIcon />}
              onClick={toggleExcelView}
              title="Toggle Excel-style table view"
            >
              {isMobileLandscape ? 'Card View' : 'Table View'}
            </Button>
          )}
          <RefreshButton onClick={() => refetch()} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { resetForm(); setCreateOpen(true); }}>Create PO</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Rotate instruction — shown when user tapped Table View but is still in portrait */}
      {showRotateHint ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" sx={{ mb: 2 }}>↻ Rotate your phone horizontally to view the table</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            The Excel-style table requires a landscape orientation. Please rotate your phone to see all columns, zoom controls, and search.
          </Typography>
          <Button variant="outlined" onClick={toggleExcelView}>Back to Card View</Button>
        </Card>
      ) : (
      <>
      {isMobilePortrait && !wantsTable && <PortraitRotateHint />}

      <Card>
        {!isMobileLandscape && (
          <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              placeholder="Search POs..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
              sx={{ width: { xs: '100%', sm: 300 } }}
            />
            <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} sx={{ width: { xs: '100%', sm: 180 } }}>
              <MenuItem value="">All</MenuItem>
              {Object.values(POStatus).map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
            </TextField>
          </Box>
        )}

        {isMobileLandscape && (
          <Box sx={{ p: 1 }}>
            <LandscapeExcelTable
              search={search}
              onSearchChange={(v) => { setSearch(v); setPage(0); }}
              searchPlaceholder="Search POs..."
            >
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>SL. No.</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>PO No</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Quotation No</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>PO Date</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Vendor Name</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Item Description</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Payment Type</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">Total</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">GST</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">Grand Total</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">Net Payable</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">Paid</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">To Pay</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {isLoading ? (
                      <TableRow><TableCell colSpan={14} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
                    ) : rows.length === 0 ? (
                      <TableRow><TableCell colSpan={14} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No purchase orders found</Typography></TableCell></TableRow>
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
                          <TableCell>{row.quotation?.quotationNumber ?? '—'}</TableCell>
                          <TableCell>{formatDate(row.date)}</TableCell>
                          <TableCell>{row.vendor?.vendorCode} - {row.vendor?.name ?? '—'}</TableCell>
                          <TableCell className="truncate-cell" title={row.notes ?? ''}>{row.notes || '—'}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={row.paymentType === POPaymentType.ADVANCE
                                ? 'Advance'
                                : row.paymentType === POPaymentType.FULL_PAYMENT
                                  ? 'Full Payment'
                                  : 'After Delivery'}
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
                              <IconButton size="small" onClick={() => previewPDF(row.id)} title="Preview PDF" disabled={pdfLoading}>{pdfLoading ? <CircularProgress size={16} /> : <PdfIcon fontSize="small" />}</IconButton>
                              <IconButton size="small" onClick={() => downloadPDF(row.id, row.poNumber)} title="Download PDF"><DownloadIcon fontSize="small" /></IconButton>
                              {canApprove(row) && (
                                <>
                                  <IconButton size="small" color="success" onClick={() => setApprovalAction({ row, action: 'approve' })} title="Approve"><CheckIcon fontSize="small" /></IconButton>
                                  <IconButton size="small" color="error" onClick={() => setApprovalAction({ row, action: 'reject' })} title="Reject"><CloseIcon fontSize="small" /></IconButton>
                                </>
                              )}
                              {(row.status === POStatus.APPROVED || row.status === POStatus.DELIVERED || row.status === POStatus.PARTIALLY_DELIVERED) && (
                                <IconButton size="small" onClick={() => { setNotesEditRow(row); setNotesEditValue(row.notes ?? ''); }} title="Edit Item Description"><EditIcon fontSize="small" /></IconButton>
                              )}
                              {row.status === POStatus.APPROVED && (
                                <IconButton size="small" color="secondary" onClick={() => setPaymentTypeRow(row)} title="Change Payment Type"><PaymentIcon fontSize="small" /></IconButton>
                              )}
                              {(row.status === POStatus.PENDING_APPROVAL || row.status === POStatus.REJECTED || (row.status === POStatus.APPROVED && !!user && isAdminRole(user.role))) && (
                                <IconButton size="small" color="primary" onClick={() => setEditUnapprovedRow(row)} title="Edit PO"><EditIcon fontSize="small" /></IconButton>
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

        {!isMobileLandscape && (
        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>PO No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Quotation No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>PO Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Vendor Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Item Description</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Payment Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>GST</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Grand Total</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Deductions</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Net Payable</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Paid</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>To Pay Now</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Budget Head</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created By</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Approved By</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={18} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={18} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No purchase orders found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} hover ref={rowRef(row.id)} sx={{ ...(highlightId === row.id && { bgcolor: 'warning.light', '&:hover': { bgcolor: 'warning.light' } }) }}>
                    <TableCell data-label="PO No">
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                        <Typography>{row.poNumber}</Typography>
                        {row.parentPo && (
                          <Typography variant="caption" color="text.secondary">
                            from {row.parentPo.poNumber}
                          </Typography>
                        )}
                        {row.childPos && row.childPos.length > 0 && (
                          <Typography variant="caption" color="secondary.main">
                            regen → {row.childPos.map((c) => c.poNumber).join(', ')}
                          </Typography>
                        )}
                        {row.editReason && (
                          <Typography variant="caption" color="warning.main" title={row.editReason}>
                            edited
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell data-label="Quotation No">{row.quotation?.quotationNumber ?? '—'}</TableCell>
                    <TableCell data-label="PO Date">
                      {row.quotation && new Date(row.date) < new Date(row.quotation.date) ? (
                        <Box>
                          <Typography color="error" fontWeight={600}>{formatDate(row.date)}</Typography>
                          <Typography variant="caption" color="error">Before quotation ({formatDate(row.quotation.date)})</Typography>
                        </Box>
                      ) : formatDate(row.date)}
                    </TableCell>
                    <TableCell data-label="Vendor Name">{row.vendor?.vendorCode} - {row.vendor?.name ?? '—'}</TableCell>
                    <TableCell data-label="Item Description" sx={{ maxWidth: 220 }}>
                      <TruncatedText text={row.notes ?? ''} wordLimit={3} variant="caption" />
                    </TableCell>
                    <TableCell data-label="Payment Type">
                      <Chip
                        size="small"
                        label={row.paymentType === POPaymentType.ADVANCE
                          ? 'Advance'
                          : row.paymentType === POPaymentType.FULL_PAYMENT
                            ? 'Full Payment'
                            : 'After Delivery'}
                        color={row.paymentType === POPaymentType.ADVANCE
                          ? 'warning'
                          : row.paymentType === POPaymentType.FULL_PAYMENT
                            ? 'success'
                            : 'info'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell data-label="Total">{formatCurrency(row.totalAmount)}</TableCell>
                    <TableCell data-label="GST">{formatCurrency(row.gstAmount)}</TableCell>
                    <TableCell data-label="Grand Total">{formatCurrency(row.grandTotal)}</TableCell>
                    <TableCell data-label="Deductions">
                      {row.deductions && row.deductions.length > 0 ? (
                        <Box>
                          <Typography color="error" fontWeight={600}>-{formatCurrency(Number(row.totalDeductions ?? 0))}</Typography>
                          {row.deductions.map((d, i) => (
                            <Typography key={i} variant="caption" color="text.secondary" display="block">
                              {d.reason}: {formatCurrency(d.amount)}
                            </Typography>
                          ))}
                        </Box>
                      ) : (
                        <Typography variant="caption" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell data-label="Net Payable">
                      <Typography fontWeight={600}>
                        {formatCurrency(
                          row.totalDeductions && Number(row.totalDeductions) > 0
                            ? Number(row.netPayable ?? row.grandTotal)
                            : row.advanceAmount && Number(row.advanceAmount) > 0
                              ? Number(row.advanceAmount)
                              : Number(row.grandTotal)
                        )}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {row.totalDeductions && Number(row.totalDeductions) > 0
                          ? '(Net Payable)'
                          : row.advanceAmount && Number(row.advanceAmount) > 0
                            ? `(Advance: ${formatCurrency(Number(row.advanceAmount))})`
                            : '(Grand Total)'}
                      </Typography>
                    </TableCell>
                    <TableCell data-label="Paid">
                      <Typography color="success.main" fontWeight={600}>
                        {formatCurrency(Number(row.paidToDate ?? 0))}
                      </Typography>
                    </TableCell>
                    <TableCell data-label="To Pay Now">
                      <Typography fontWeight={700} color={Number(row.amountToPayNow ?? 0) > 0 ? 'error.main' : 'text.secondary'}>
                        {formatCurrency(Number(row.amountToPayNow ?? 0))}
                      </Typography>
                    </TableCell>
                    <TableCell data-label="Budget Head">
                      {row.budgetHead ? (
                        <Chip label={row.budgetHead.particulars} size="small" variant="outlined" color="primary" />
                      ) : (
                        <Typography variant="caption" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell data-label="Created By">{row.createdByUser?.name ?? '—'}</TableCell>
                    <TableCell data-label="Approved By">
                      {row.approvalWorkflow?.steps?.some((s) => s.status === 'APPROVED' && s.approverUser)
                        ? row.approvalWorkflow!.steps
                            .filter((s) => s.status === 'APPROVED' && s.approverUser)
                            .map((s) => s.approverUser!.name)
                            .join(', ')
                        : '—'}
                    </TableCell>
                    <TableCell data-label="Status"><Chip label={row.status.replace(/_/g, ' ')} size="small" color={row.status === POStatus.DELETED ? 'error' : (STATUS_COLORS[row.status] ?? 'default')} sx={row.status === POStatus.DELETED ? { bgcolor: '#d32f2f', color: '#fff', textDecoration: 'line-through' } : undefined} /></TableCell>
                    <TableCell data-label="Actions">
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <IconButton size="small" onClick={() => previewPDF(row.id)} title="Preview PDF" disabled={pdfLoading}>{pdfLoading ? <CircularProgress size={16} /> : <PdfIcon fontSize="small" />}</IconButton>
                        <IconButton size="small" onClick={() => downloadPDF(row.id, row.poNumber)} title="Download PDF"><DownloadIcon fontSize="small" /></IconButton>
                        <IconButton size="small" sx={{ color: '#25D366' }} onClick={() => shareOnWhatsApp(buildPOShareMessage({ poNumber: row.poNumber, vendorName: row.vendor?.name, grandTotal: Number(row.grandTotal), status: row.status, date: row.date, totalDeductions: Number(row.totalDeductions ?? 0), netPayable: Number(row.netPayable ?? row.grandTotal), deductions: row.deductions ?? undefined, notes: row.notes ?? undefined }))} title="Share on WhatsApp"><WhatsAppIcon fontSize="small" /></IconButton>
                        {row.status !== POStatus.DELETED && (
                          <>
                            {canApprove(row) && (
                              <>
                                <IconButton size="small" color="success" onClick={() => setApprovalAction({ row, action: 'approve' })} title="Approve"><CheckIcon fontSize="small" /></IconButton>
                                <IconButton size="small" color="error" onClick={() => setApprovalAction({ row, action: 'reject' })} title="Reject"><CloseIcon fontSize="small" /></IconButton>
                              </>
                            )}
                            {(row.status === POStatus.APPROVED || row.status === POStatus.PARTIALLY_DELIVERED) && (
                              <IconButton size="small" color="primary" onClick={() => navigate('/gate-passes')} title="Create Gate Pass"><GatePassIcon fontSize="small" /></IconButton>
                            )}
                            {(row.status === POStatus.APPROVED || row.status === POStatus.PARTIALLY_DELIVERED || row.status === POStatus.DELIVERED) && (
                              <IconButton size="small" onClick={() => setTrailRow(row)} title="Delivery Trail"><TimelineIcon fontSize="small" /></IconButton>
                            )}
                            {row.status === POStatus.PARTIALLY_DELIVERED && !row.parentPoId && (
                              <IconButton size="small" color="warning" onClick={() => setEditRow(row)} title="Edit PO to Match Delivered"><EditIcon fontSize="small" /></IconButton>
                            )}
                            {(row.status === POStatus.PENDING_APPROVAL || row.status === POStatus.REJECTED || (row.status === POStatus.APPROVED && !!user && isAdminRole(user.role))) && (
                              <IconButton size="small" color="primary" onClick={() => setEditUnapprovedRow(row)} title="Edit PO"><EditIcon fontSize="small" /></IconButton>
                            )}
                            {(row.status === POStatus.APPROVED || row.status === POStatus.DELIVERED || row.status === POStatus.PARTIALLY_DELIVERED) && (
                              <IconButton size="small" onClick={() => { setNotesEditRow(row); setNotesEditValue(row.notes ?? ''); }} title="Edit Item Description"><EditIcon fontSize="small" /></IconButton>
                            )}
                            {(row.status === POStatus.APPROVED || row.status === POStatus.DELIVERED || row.status === POStatus.PARTIALLY_DELIVERED) && row.budgetHeadId && user && isAdminRole(user.role) && (
                              <IconButton size="small" color="info" onClick={() => { setBudgetHeadRow(row); setNewBudgetHeadId(''); setBudgetHeadReason(''); }} title="Change Budget Head"><SwapBudgetIcon fontSize="small" /></IconButton>
                            )}
                            {row.status === POStatus.APPROVED && (
                              <IconButton size="small" color="secondary" onClick={() => setPaymentTypeRow(row)} title="Change Payment Type"><PaymentIcon fontSize="small" /></IconButton>
                            )}
                            {row.status === POStatus.DELIVERED && !row.parentPoId && Array.isArray(row.regenerationData) && (row.regenerationData as unknown[]).length > 0 && (!row.childPos || row.childPos.length === 0) ? (
                              <IconButton size="small" color="secondary" onClick={() => setRegenRow(row)} title="Generate Regenerated PO"><AutoRenewIcon fontSize="small" /></IconButton>
                            ) : null}
                            {row.status !== POStatus.APPROVED && row.status !== POStatus.PARTIALLY_DELIVERED && row.status !== POStatus.DELIVERED && (
                              <IconButton size="small" color="error" onClick={() => setDeleteRow(row)} title="Delete"><DeleteIcon fontSize="small" /></IconButton>
                            )}
                          </>
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

      {/* Approval details */}
      {rows.length > 0 && rows.some((r) => r.approvalWorkflow) && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>Approval Status</Typography>
          {rows.filter((r) => r.approvalWorkflow).map((row) => (
            <Accordion key={row.id}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography><strong>{row.poNumber}</strong> — {row.vendor?.name} — Status: <Chip label={row.approvalWorkflow!.status} size="small" color={STATUS_COLORS[row.approvalWorkflow!.status] ?? 'default'} /></Typography>
              </AccordionSummary>
              <AccordionDetails>
                <ApprovalStepsDisplay steps={row.approvalWorkflow!.steps} />
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      )}

      {/* Create PO Dialog */}
      <ResponsiveDialog open={createOpen} onClose={() => { setCreateOpen(false); resetForm(); }} maxWidth="md" fullWidth sx={{ '& .MuiDialog-paper': { margin: { xs: 1 } } }}>
        <DialogTitle>Create Purchase Order</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1, flexWrap: 'wrap' }}>
            {/* Vendor Selection */}
            <TextField
              select
              label="Vendor"
              value={selectedVendorId}
              onChange={(e) => { setSelectedVendorId(e.target.value); setSelectedQuotationId(''); }}
              fullWidth
              size="small"
              required
            >
              {vendors.map((v) => (
                <MenuItem key={v.id} value={v.id}>{v.vendorCode} - {v.name}</MenuItem>
              ))}
            </TextField>

            {/* Quotation Selection (only approved quotations for this vendor) */}
            {selectedVendorId && (
              <TextField
                select
                label="Quotation (approved only)"
                value={selectedQuotationId}
                onChange={(e) => {
                  const quotationId = e.target.value;
                  setSelectedQuotationId(quotationId);
                }}
                fullWidth
                size="small"
                required
                helperText={approvedQuotations?.length === 0 ? 'No approved quotations for this vendor' : undefined}
              >
                {approvedQuotations?.map((q) => (
                  <MenuItem key={q.id} value={q.id}>{q.quotationNumber} — {formatCurrency(q.grandTotal)}</MenuItem>
                ))}
              </TextField>
            )}

            {/* Payment Type Selection */}
            <TextField
              select
              label="Payment Type"
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
              helperText="Controls when payment happens and whether a gate pass needs an invoice"
            >
              <MenuItem value={POPaymentType.ADVANCE}>Against Advance — pay before delivery</MenuItem>
              <MenuItem value={POPaymentType.AFTER_DELIVERY}>After Delivery — pay after goods arrive + invoice</MenuItem>
              <MenuItem value={POPaymentType.FULL_PAYMENT}>Against Full Payment — full payment done, goods follow</MenuItem>
            </TextField>

            {/* Advance Amount — only for ADVANCE / FULL_PAYMENT */}
            {(paymentType === POPaymentType.ADVANCE || paymentType === POPaymentType.FULL_PAYMENT) && (
              <TextField
                label={paymentType === POPaymentType.ADVANCE ? 'Advance Amount' : 'Full Payment Amount'}
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
                helperText={grandTotal > 0 ? `Maximum: ${formatCurrency(grandTotal)}` : 'Select a quotation first'}
              />
            )}

            <TextField
              label="Payment Terms"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              fullWidth
              size="small"
              helperText="E.g. After Delivery & Inspection"
            />

            <TextField
              label="Delivery Due Date"
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
              label="Budget Head *"
              value={selectedBudgetHeadId}
              onChange={(e) => setSelectedBudgetHeadId(e.target.value)}
              fullWidth
              size="small"
              required
              helperText="Tag this PO to a budget head for commitment tracking"
            >
              <MenuItem value="">— Select Budget Head —</MenuItem>
              {budgetHeads.map((h) => <MenuItem key={h.id} value={h.id}>{h.particulars}</MenuItem>)}
            </TextField>

            {/* Item Description / Notes */}
            <TextField
              label="Item Description"
              value={poNotes}
              onChange={(e) => setPoNotes(e.target.value)}
              fullWidth
              size="small"
              multiline
              minRows={2}
              maxRows={4}
              placeholder="Optional item description for this PO (shown highlighted in PDF)"
            />

            {/* Deductions Section */}
            {selectedQuotation && (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="body2" fontWeight={600}>Deductions (optional)</Typography>
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => setDeductions([...deductions, { amount: '', reason: '' }])}
                  >
                    Add Deduction
                  </Button>
                </Box>
                {deductions.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    No deductions. Add TDS, retention, advance adjustment, or other deductions to reduce the net payable.
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {deductions.map((d, idx) => (
                      <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
                        <TextField
                          label="Amount"
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
                          label="Reason"
                          value={d.reason}
                          onChange={(e) => {
                            const updated = [...deductions];
                            updated[idx] = { ...d, reason: e.target.value };
                            setDeductions(updated);
                          }}
                          size="small"
                          fullWidth
                          placeholder="E.g. TDS, retention, advance adjustment"
                        />
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setDeductions(deductions.filter((_, i) => i !== idx))}
                          title="Remove"
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
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>Items (from quotation)</Typography>
                <TableContainer component={Card} variant="outlined" sx={{ display: { xs: 'none', sm: 'block' } }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>S.no</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Qty</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Unit Price</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>GST</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Amount (Inc. GST)</TableCell>
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
                          <Typography variant="caption" color="text.secondary">Quantity</Typography>
                          <Typography variant="body2" fontWeight={600}>{item.quantity}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">Unit</Typography>
                          <Typography variant="body2" fontWeight={600}>{item.unit ?? '—'}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">Unit Price</Typography>
                          <Typography variant="body2" fontWeight={600}>{formatCurrency(item.unitPrice)}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">GST</Typography>
                          <Typography variant="body2" fontWeight={600}>{Number(item.gstRate ?? 0)}% ({formatCurrency(Number(item.amount) * Number(item.gstRate ?? 0) / 100)})</Typography>
                        </Box>
                      </Box>
                    </Card>
                  ))}
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: { xs: 'stretch', sm: 'flex-end' }, gap: 1, mt: 1 }}>
                  <Typography variant="body2" sx={{ textAlign: { xs: 'left', sm: 'right' } }}>Total: <strong>{formatCurrency(quotationTotal)}</strong></Typography>
                  <Typography variant="body2" sx={{ textAlign: { xs: 'left', sm: 'right' } }}>GST (auto-calculated): <strong>{formatCurrency(gstAmount)}</strong></Typography>
                  <Typography variant="body2" sx={{ textAlign: { xs: 'left', sm: 'right' } }}>Grand Total: <strong>{formatCurrency(grandTotal)}</strong></Typography>
                  {totalDeductions > 0 && (
                    <>
                      <Typography variant="body2" color="error" sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
                        Less Deductions: <strong>-{formatCurrency(totalDeductions)}</strong>
                      </Typography>
                      <Typography variant="body2" sx={{ textAlign: { xs: 'left', sm: 'right' }, fontWeight: 700, fontSize: '1rem' }}>
                        Net Payable: {formatCurrency(netPayable)}
                      </Typography>
                    </>
                  )}
                </Box>
              </Box>
            )}
            <AcknowledgementCheckbox
              checked={acknowledged}
              onChange={setAcknowledged}
              entityLabel="purchase order"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreatePO}
            disabled={(!selectedVendorId || !selectedQuotationId || !selectedBudgetHeadId || !acknowledged || ((paymentType === POPaymentType.ADVANCE || paymentType === POPaymentType.FULL_PAYMENT) && (!advanceAmount || Number(advanceAmount) <= 0))) || createMutation.isPending || createSubmissionLocked.current}
          >
            {createMutation.isPending ? <CircularProgress size={20} /> : 'Create PO'}
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
            <strong>Your Purchase Order {approvalPopup?.poNumber} has been APPROVED!</strong>
          </Typography>
          <Typography variant="caption">
            Vendor: {approvalPopup?.vendor?.name} — Grand Total: {approvalPopup ? formatCurrency(approvalPopup.grandTotal) : ''}
          </Typography>
          <Typography variant="caption" display="block">
            You can now create a Gate Pass for this PO.
          </Typography>
        </Alert>
      </Snackbar>

      <ApprovalActionDialog
        open={approvalAction !== null}
        action={approvalAction?.action ?? 'approve'}
        entityLabel="Purchase Order"
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
        <DialogTitle>Delete Purchase Order</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete purchase order <strong>{deleteRow?.poNumber}</strong>?</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            This action cannot be undone. Only purchase orders that are not approved, partially delivered, or delivered can be deleted.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRow(null)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={deleteMutation.isPending} onClick={() => deleteRow && deleteMutation.mutate(deleteRow.id)}>
            {deleteMutation.isPending ? <CircularProgress size={20} /> : 'Delete'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Change Payment Type (approved POs — sends back for re-approval) */}
      <ChangePaymentTypeDialog row={paymentTypeRow} onClose={() => setPaymentTypeRow(null)} onSuccess={() => { refetch(); setPaymentTypeRow(null); }} />

      {/* Deactivate Confirmation Dialog (Admin only — works on any PO status) */}
      <ResponsiveDialog open={deactivateRow !== null} onClose={() => setDeactivateRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Deactivate Purchase Order</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to deactivate purchase order <strong>{deactivateRow?.poNumber}</strong>?</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            This will mark the PO as DELETED. It will no longer appear in the active PO list or Action Required.
            The record remains in the database for audit purposes.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeactivateRow(null)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={deactivateMutation.isPending} onClick={() => deactivateRow && deactivateMutation.mutate(deactivateRow.id)}>
            {deactivateMutation.isPending ? <CircularProgress size={20} /> : 'Deactivate'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Edit Item Description only (for approved/delivered POs) */}
      <ResponsiveDialog open={notesEditRow !== null} onClose={() => { setNotesEditRow(null); setNotesEditValue(''); }} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Item Description — {notesEditRow?.poNumber}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <TextField
            label="Item Description"
            value={notesEditValue}
            onChange={(e) => setNotesEditValue(e.target.value)}
            fullWidth
            multiline
            minRows={3}
            maxRows={6}
            placeholder="Item description for this PO"
            sx={{ mt: 1 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Only the Item Description can be edited after approval. Financial details cannot be modified.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setNotesEditRow(null); setNotesEditValue(''); }}>Cancel</Button>
          {user && isAdminRole(user.role) && notesEditRow && (
            <Button
              color="error"
              variant="outlined"
              disabled={deactivateMutation.isPending}
              onClick={() => setDeactivateRow(notesEditRow)}
            >
              Deactivate PO
            </Button>
          )}
          <Button
            variant="contained"
            disabled={updateNotesMutation.isPending}
            onClick={() => updateNotesMutation.mutate()}
          >
            {updateNotesMutation.isPending ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Change Budget Head (admin-only, for approved/delivered POs) */}
      <ResponsiveDialog open={budgetHeadRow !== null} onClose={() => { setBudgetHeadRow(null); setNewBudgetHeadId(''); setBudgetHeadReason(''); }} maxWidth="sm" fullWidth>
        <DialogTitle>Change Budget Head — {budgetHeadRow?.poNumber}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Alert severity="info" sx={{ mb: 1 }}>
              This will move <strong>{formatCurrency(Number(budgetHeadRow?.grandTotal ?? 0))}</strong> from the current budget head
              {' "'}<strong>{budgetHeadRow?.budgetHead?.particulars ?? '—'}</strong>{'" '} to the new one.
              The old head gets its money back; the new head is charged.
            </Alert>
            <TextField
              select
              label="New Budget Head"
              value={newBudgetHeadId}
              onChange={(e) => setNewBudgetHeadId(e.target.value)}
              fullWidth
              size="small"
              required
              helperText={newBudgetHeadId === budgetHeadRow?.budgetHeadId ? 'Select a different budget head' : undefined}
              error={newBudgetHeadId === budgetHeadRow?.budgetHeadId}
            >
              {budgetHeads
                .filter((bh) => bh.id !== budgetHeadRow?.budgetHeadId)
                .map((bh) => (
                  <MenuItem key={bh.id} value={bh.id}>{bh.particulars}</MenuItem>
                ))}
            </TextField>
            <TextField
              label="Reason (optional)"
              value={budgetHeadReason}
              onChange={(e) => setBudgetHeadReason(e.target.value)}
              fullWidth
              size="small"
              multiline
              minRows={2}
              maxRows={4}
              placeholder="Why is the budget head being changed?"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setBudgetHeadRow(null); setNewBudgetHeadId(''); setBudgetHeadReason(''); }}>Cancel</Button>
          <Button
            variant="contained"
            color="info"
            disabled={!newBudgetHeadId || newBudgetHeadId === budgetHeadRow?.budgetHeadId || changeBudgetHeadMutation.isPending}
            onClick={() => changeBudgetHeadMutation.mutate()}
          >
            {changeBudgetHeadMutation.isPending ? <CircularProgress size={20} /> : 'Change Budget Head'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
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
      <DialogTitle>Delivery Trail — {poNumber}</DialogTitle>
      <DialogContent>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : data ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
            {/* Item Summary */}
            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Item Summary</Typography>
              <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Ordered</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Accepted</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Remaining</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
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
                Delivery Instances ({data.deliveries.length})
              </Typography>
              {data.deliveries.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No deliveries yet.</Typography>
              ) : (
                data.deliveries.map((delivery, idx) => (
                  <Accordion key={delivery.gatePassId} defaultExpanded={idx === data.deliveries.length - 1}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Chip size="small" label={delivery.passNumber} color="primary" />
                        <Chip size="small" label={delivery.gatePassStatus.replace(/_/g, ' ')} color={STATUS_COLORS[delivery.gatePassStatus] ?? 'default'} />
                        <Typography variant="caption" color="text.secondary">{formatDate(delivery.gatePassDate)}</Typography>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      {/* Gate Pass Items */}
                      <Typography variant="caption" fontWeight={600} color="text.secondary">GATE PASS ITEMS (delivered to gate)</Typography>
                      <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto', mb: 2 }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Delivered Qty</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
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
                              GOODS RECEIPT — {gr.receiptNumber} ({gr.receiptStatus.replace(/_/g, ' ')})
                            </Typography>
                            <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>Delivered</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>Accepted</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>Rejected</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>Reason</TableCell>
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
                                Inspected: {formatDate(gr.inspectedAt)}
                                {gr.postedAt && ` • Posted: ${formatDate(gr.postedAt)}`}
                              </Typography>
                            )}
                          </Box>
                        ))
                      ) : (
                        <Alert severity="info" sx={{ mt: 1 }}>
                          No Goods Receipt created yet for this gate pass. The material has arrived at the gate but has not been inspected or posted to inventory.
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
                Assets Generated ({data.assets?.length ?? 0})
              </Typography>
              {data.assets && data.assets.length > 0 ? (
                <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Asset ID</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Item</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Serial</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Location</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>GRN</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Cost</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.assets.map((a) => (
                        <TableRow key={a.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/scan/${a.assetId}`)}>
                          <TableCell><strong>{a.assetId}</strong></TableCell>
                          <TableCell>{a.itemName}</TableCell>
                          <TableCell>{a.serialNumber ?? '—'}</TableCell>
                          <TableCell><Chip size="small" label={a.status.replace(/_/g, ' ')} color={(STATUS_COLORS[a.status] ?? 'default') as never} /></TableCell>
                          <TableCell>{a.location}</TableCell>
                          <TableCell>{a.receiptNumber ?? '—'}</TableCell>
                          <TableCell>{a.totalCost != null ? `₹${a.totalCost.toLocaleString('en-IN')}` : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" color="text.secondary">No individual asset records generated from this PO.</Typography>
              )}
            </Box>
          </Box>
        ) : (
          <Typography color="text.secondary">No data available.</Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

// ─── Edit PO Dialog ─────────────────────────────────
interface EditItem {
  materialName: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  gstRate: string;
  accepted: number;
  selected: boolean;
}

function EditPODialog({ row, onClose, onSuccess }: { row: PORow | null; onClose: () => void; onSuccess: () => void }) {
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
      if (selectedItems.length === 0) throw new Error('At least one item must be selected');
      if (!editReason.trim()) throw new Error('Edit reason is required');
      await api.post(`/purchase-orders/${row!.id}/edit`, {
        items: selectedItems.map((i) => ({
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
      <DialogTitle>Edit PO — {row?.poNumber}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        <Alert severity="warning" sx={{ mb: 2 }}>
          This PO was partially delivered. Edit quantities to match what was actually received.
          The PO will go for re-approval. After re-approval, a "Generate Regenerated PO" button will appear for the remaining items.
        </Alert>
        <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto', mb: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Accepted</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Qty</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Unit Price</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>GST %</TableCell>
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
                  <TableCell>{item.materialName}</TableCell>
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
                      helperText={item.selected && Number(item.quantity) < item.accepted ? `Min: ${item.accepted}` : ''}
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
                        <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
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
          <Chip label={`Total: ₹${totalAmount.toLocaleString('en-IN')}`} />
          <Chip label={`GST: ₹${gstAmount.toLocaleString('en-IN')}`} />
          <Chip label={`Grand Total: ₹${grandTotal.toLocaleString('en-IN')}`} color="primary" />
          {remainingItems.length > 0 && (
            <Chip label={`${remainingItems.length} item(s) will be available for regeneration`} color="secondary" variant="outlined" />
          )}
        </Box>

        <TextField
          label="Edit Reason (required)"
          value={editReason}
          onChange={(e) => setEditReason(e.target.value)}
          fullWidth
          size="small"
          multiline
          rows={2}
          placeholder="e.g. Vendor delivered 70 out of 100, closing PO at delivered quantity"
        />
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="warning"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? <CircularProgress size={20} /> : 'Edit & Send for Re-approval'}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

// ─── Change Payment Type Dialog ───────────────────────────
// Approved POs only. Saving sends the PO back for re-approval; once approved
// again it is treated as the new type (advance payments / invoice flow).
function ChangePaymentTypeDialog({ row, onClose, onSuccess }: { row: PORow | null; onClose: () => void; onSuccess: () => void }) {
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
      <DialogTitle>Change Payment Type — {row?.poNumber}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        <Alert severity="info" sx={{ mb: 2 }}>
          Changing the payment type sends the PO back for re-approval.
          Once approved again, it is treated as the new type.
        </Alert>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Current Payment Type"
            value={row?.paymentType ? row.paymentType.replace(/_/g, ' ') : ''}
            size="small"
            fullWidth
            InputProps={{ readOnly: true }}
          />
          <TextField
            select
            label="New Payment Type"
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            size="small"
            fullWidth
            required
          >
            <MenuItem value="">— Select —</MenuItem>
            {[POPaymentType.ADVANCE, POPaymentType.AFTER_DELIVERY, POPaymentType.FULL_PAYMENT]
              .filter((t) => t !== row?.paymentType)
              .map((t) => <MenuItem key={t} value={t}>{t.replace(/_/g, ' ')}</MenuItem>)}
          </TextField>
          {needsAdvance && (
            <TextField
              label={newType === POPaymentType.ADVANCE ? 'Advance Amount' : 'Full Payment Amount'}
              type="text"
              value={formatIndianNumber(advAmount)}
              onChange={(e) => setAdvAmount(e.target.value.replace(/,/g, ''))}
              inputMode="decimal"
              size="small"
              fullWidth
              required
              helperText={`PO grand total: ${formatCurrency(Number(row?.grandTotal ?? 0))}`}
            />
          )}
          <TextField
            label="Reason (required)"
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
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
          {mutation.isPending ? <CircularProgress size={20} /> : 'Save & Send for Re-approval'}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

// ─── Edit Unapproved PO Dialog ────────────────────────────
function EditUnapprovedPODialog({ row, onClose, onSuccess }: { row: PORow | null; onClose: () => void; onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<EditItem[]>([]);
  const [paymentTerms, setPaymentTerms] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [budgetHeadId, setBudgetHeadId] = useState('');
  const [notes, setNotes] = useState('');
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
    setError('');
  }, [row]);

  const mutation = useMutation({
    mutationFn: async () => {
      await api.post(`/purchase-orders/${row!.id}/edit-unapproved`, {
        paymentTerms: paymentTerms || undefined,
        deliveryDate: deliveryDate || undefined,
        budgetHeadId,
        notes,
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
      <DialogTitle>Edit PO — {row?.poNumber}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        <Alert severity={row?.status === POStatus.APPROVED ? 'warning' : 'info'} sx={{ mb: 2 }}>
          {row?.status === POStatus.APPROVED
            ? 'This PO is already approved. Saving changes returns it to Pending Re-Approval — it must be approved again before it counts as approved. Payment type is fixed at creation.'
            : 'This PO has not been approved yet. You can edit items, payment terms, delivery date, and budget head. Payment type is fixed at creation and cannot be changed. The PO will remain pending approval after saving.'}
        </Alert>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              label="Payment Type"
              value={row?.paymentType ? row.paymentType.replace(/_/g, ' ') : ''}
              fullWidth
              size="small"
              InputProps={{ readOnly: true }}
              helperText="Cannot be changed after creation"
            />
            {row?.advanceAmount !== null && row?.advanceAmount !== undefined && Number(row.advanceAmount) > 0 && (
              <TextField
                label="Agreed Advance"
                value={formatCurrency(Number(row.advanceAmount))}
                size="small"
                InputProps={{ readOnly: true }}
                sx={{ width: { xs: '100%', sm: 200 } }}
              />
            )}
          </Box>

          <TextField
            label="Payment Terms"
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={2}
          />

          <TextField
            label="Delivery Date"
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
            fullWidth
            size="small"
            InputLabelProps={{ shrink: true }}
          />

          <TextField
            select
            label="Budget Head *"
            value={budgetHeadId}
            onChange={(e) => setBudgetHeadId(e.target.value)}
            fullWidth
            size="small"
            required
          >
            <MenuItem value="">— Select Budget Head —</MenuItem>
            {budgetHeads.map((h) => <MenuItem key={h.id} value={h.id}>{h.particulars}</MenuItem>)}
          </TextField>

          <TextField
            label="Item Description"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={2}
            placeholder="Item description for this PO (shown in the table and PDF)"
          />
        </Box>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>Items</Typography>
        <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto', mb: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Material</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell>Unit</TableCell>
                <TableCell align="right">Unit Price</TableCell>
                <TableCell align="right">GST %</TableCell>
                <TableCell align="right">Amount</TableCell>
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
                        <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
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
          <Typography variant="body2">Total: <strong>{formatCurrency(totalAmount)}</strong></Typography>
          <Typography variant="body2">GST: <strong>{formatCurrency(gstAmount)}</strong></Typography>
          <Typography variant="body2">Grand Total: <strong>{formatCurrency(grandTotal)}</strong></Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !budgetHeadId || items.length === 0}
        >
          {mutation.isPending ? <CircularProgress size={20} /> : 'Save Changes'}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

// ─── Regenerate PO Dialog ─────────────────────────────────
function RegeneratePODialog({ row, onClose, onSuccess }: { row: PORow | null; onClose: () => void; onSuccess: () => void }) {
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
      <DialogTitle>Generate Regenerated PO — {row?.poNumber}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        <Alert severity="info" sx={{ mb: 2 }}>
          This will create a new PO with the remaining items from the original PO.
          The new PO will need its own approval.
        </Alert>
        <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto', mb: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Qty</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Unit Price</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>GST %</TableCell>
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
          <Chip label={`Total: ₹${totalAmount.toLocaleString('en-IN')}`} />
          <Chip label={`GST: ₹${gstAmount.toLocaleString('en-IN')}`} />
          <Chip label={`Grand Total: ₹${grandTotal.toLocaleString('en-IN')}`} color="primary" />
        </Box>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? <CircularProgress size={20} /> : 'Generate Regenerated PO'}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
