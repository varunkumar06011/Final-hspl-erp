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
  ExpandMore as ExpandMoreIcon,
  LocalShipping as GatePassIcon,
  Timeline as TimelineIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Autorenew as AutoRenewIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { POStatus, UserRole, POPaymentType, GST_RATES } from '@hospital-erp/shared';
import { formatCurrency, formatDate, formatIndianNumber, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import AcknowledgementCheckbox from '../components/AcknowledgementCheckbox';
import ApprovalActionDialog from '../components/ApprovalActionDialog';
import ResponsiveTable from '../components/ResponsiveTable';
import { useApprovalDeepLink } from '../utils/useApprovalDeepLink';

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
  totalAmount: number;
  gstAmount: number;
  grandTotal: number;
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

const HEAD_ROLES = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ACCOUNTS_HEAD, UserRole.ADMIN, UserRole.ADMIN_2];

export default function PurchaseOrdersPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedQuotationId, setSelectedQuotationId] = useState('');
  const [paymentType, setPaymentType] = useState<string>(POPaymentType.AFTER_DELIVERY);
  const [paymentTerms, setPaymentTerms] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [selectedBudgetHeadId, setSelectedBudgetHeadId] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [approvalAction, setApprovalAction] = useState<{ row: PORow; action: 'approve' | 'reject' } | null>(null);
  const [approvalPopup, setApprovalPopup] = useState<PORow | null>(null);
  const [trailRow, setTrailRow] = useState<PORow | null>(null);
  const [editRow, setEditRow] = useState<PORow | null>(null);
  const [regenRow, setRegenRow] = useState<PORow | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const createSubmissionLocked = useRef(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/pos', page, pageSize, search, statusFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const response = await api.get('/purchase-orders', { params });
      return response.data;
    },
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
        paymentTerms,
        deliveryDate,
        acknowledged,
        budgetHeadId: selectedBudgetHeadId || undefined,
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setApprovalAction(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ poId, reason, acknowledged }: { poId: string; reason: string; acknowledged: true }) => {
      const response = await api.post(`/purchase-orders/${poId}/reject`, { reason, acknowledged });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setApprovalAction(null);
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

  const rows: PORow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const vendors: { id: string; name: string; vendorCode: string }[] = vendorsData?.data ?? [];

  // Auto-open approval dialog when navigated from a push notification
  useApprovalDeepLink(rows, (row) => setApprovalAction({ row, action: 'approve' }));

  const quotationTotal = useMemo(() => {
    if (!selectedQuotation?.items) return 0;
    return selectedQuotation.items.reduce((sum, i) => sum + Number(i.amount), 0);
  }, [selectedQuotation]);

  const gstAmount = useMemo(() => {
    if (!selectedQuotation?.items) return 0;
    return selectedQuotation.items.reduce((sum, i) => sum + Number(i.amount) * Number(i.gstRate ?? 0) / 100, 0);
  }, [selectedQuotation]);

  const grandTotal = quotationTotal + gstAmount;

  function resetForm() {
    setSelectedVendorId('');
    setSelectedQuotationId('');
    setPaymentType(POPaymentType.AFTER_DELIVERY);
    setPaymentTerms('');
    setDeliveryDate('');
    setSelectedBudgetHeadId('');
    setAcknowledged(false);
    setError('');
  }

  function canApprove(row: PORow): boolean {
    if (!row.approvalWorkflow) return false;
    if (!user || !HEAD_ROLES.includes(user.role as UserRole)) return false;
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

  function handleCreatePO() {
    if (createSubmissionLocked.current || createMutation.isPending) return;
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
    const token = localStorage.getItem('firebaseToken');
    const url = `${api.defaults.baseURL}/purchase-orders/${poId}/pdf`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        window.open(url, '_blank');
      })
      .catch(() => setError('Failed to preview PDF'));
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>Purchase Orders</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <RefreshButton onClick={() => refetch()} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { resetForm(); setCreateOpen(true); }}>Create PO</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Card>
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

        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>PO No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Quotation</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>PO Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Generated On</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Payment Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>GST</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Grand Total</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Budget Head</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created By</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={12} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={12} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No purchase orders found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} hover>
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
                    <TableCell data-label="Vendor">{row.vendor?.vendorCode} - {row.vendor?.name ?? '—'}</TableCell>
                    <TableCell data-label="Quotation">{row.quotation?.quotationNumber ?? '—'}</TableCell>
                    <TableCell data-label="PO Date">
                      {row.quotation && new Date(row.date) < new Date(row.quotation.date) ? (
                        <Box>
                          <Typography color="error" fontWeight={600}>{formatDate(row.date)}</Typography>
                          <Typography variant="caption" color="error">Before quotation ({formatDate(row.quotation.date)})</Typography>
                        </Box>
                      ) : formatDate(row.date)}
                    </TableCell>
                    <TableCell data-label="Generated On"><Typography variant="caption" color="text.secondary">{formatDate(row.createdAt)}</Typography></TableCell>
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
                    <TableCell data-label="Budget Head">
                      {row.budgetHead ? (
                        <Chip label={row.budgetHead.particulars} size="small" variant="outlined" color="primary" />
                      ) : (
                        <Typography variant="caption" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell data-label="Created By">{row.createdByUser?.name ?? '—'}</TableCell>
                    <TableCell data-label="Status"><Chip label={row.status.replace(/_/g, ' ')} size="small" color={STATUS_COLORS[row.status] ?? 'default'} /></TableCell>
                    <TableCell data-label="Actions">
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <IconButton size="small" onClick={() => previewPDF(row.id)} title="Preview PDF"><PdfIcon fontSize="small" /></IconButton>
                        <IconButton size="small" onClick={() => downloadPDF(row.id, row.poNumber)} title="Download PDF"><DownloadIcon fontSize="small" /></IconButton>
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
                        {row.status === POStatus.DELIVERED && !row.parentPoId && Array.isArray(row.regenerationData) && (row.regenerationData as unknown[]).length > 0 && (!row.childPos || row.childPos.length === 0) ? (
                          <IconButton size="small" color="secondary" onClick={() => setRegenRow(row)} title="Generate Regenerated PO"><AutoRenewIcon fontSize="small" /></IconButton>
                        ) : null}
                        {row.status !== POStatus.APPROVED && row.status !== POStatus.PARTIALLY_DELIVERED && row.status !== POStatus.DELIVERED && (
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
              onChange={(e) => setPaymentType(e.target.value)}
              fullWidth
              size="small"
              required
              helperText="Controls when payment happens and whether a gate pass needs an invoice"
            >
              <MenuItem value={POPaymentType.ADVANCE}>Against Advance — pay before delivery</MenuItem>
              <MenuItem value={POPaymentType.AFTER_DELIVERY}>After Delivery — pay after goods arrive + invoice</MenuItem>
              <MenuItem value={POPaymentType.FULL_PAYMENT}>Against Full Payment — full payment done, goods follow</MenuItem>
            </TextField>

            <TextField
              label="Payment Terms"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              fullWidth
              size="small"
              helperText="E.g. Net 30 Days (After Delivery & Inspection)"
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
              label="Budget Head (optional)"
              value={selectedBudgetHeadId}
              onChange={(e) => setSelectedBudgetHeadId(e.target.value)}
              fullWidth
              size="small"
              helperText="Tag this PO to a budget head for commitment tracking"
            >
              <MenuItem value="">— None —</MenuItem>
              {budgetHeads.map((h) => <MenuItem key={h.id} value={h.id}>{h.particulars}</MenuItem>)}
            </TextField>

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
                        <TableCell sx={{ fontWeight: 600 }}>GST %</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
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
                          <TableCell>{Number(item.gstRate ?? 0)}%</TableCell>
                          <TableCell>{formatCurrency(item.amount)}</TableCell>
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
                          {formatCurrency(item.amount)}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1 }}>
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
                          <Typography variant="caption" color="text.secondary">GST %</Typography>
                          <Typography variant="body2" fontWeight={600}>{Number(item.gstRate ?? 0)}%</Typography>
                        </Box>
                      </Box>
                    </Card>
                  ))}
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: { xs: 'stretch', sm: 'flex-end' }, gap: 1, mt: 1 }}>
                  <Typography variant="body2" sx={{ textAlign: { xs: 'left', sm: 'right' } }}>Total: <strong>{formatCurrency(quotationTotal)}</strong></Typography>
                  <Typography variant="body2" sx={{ textAlign: { xs: 'left', sm: 'right' } }}>GST (auto-calculated): <strong>{formatCurrency(gstAmount)}</strong></Typography>
                  <Typography variant="body2" sx={{ textAlign: { xs: 'left', sm: 'right' } }}>Grand Total: <strong>{formatCurrency(grandTotal)}</strong></Typography>
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
            disabled={(!selectedVendorId || !selectedQuotationId || !acknowledged) || createMutation.isPending || createSubmissionLocked.current}
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
                      size="small"
                      value={item.unit}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...item, unit: e.target.value };
                        setItems(next);
                      }}
                      sx={{ width: 70 }}
                    />
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
