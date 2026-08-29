import { useState, useEffect, useRef } from 'react';
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
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Download as DownloadIcon,
  ExpandMore as ExpandMoreIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { InvoiceVerificationStatus, UserRole, STORAGE } from '@hospital-erp/shared';
import { formatCurrency, formatDate, formatIndianNumber, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { downloadFile } from '../utils/file';
import AcknowledgementCheckbox from '../components/AcknowledgementCheckbox';
import ApprovalActionDialog from '../components/ApprovalActionDialog';
import OcrAutoFill, { type OcrInvoiceData } from '../components/OcrAutoFill';
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

interface ApprovalStep {
  id: string;
  stepNumber: number;
  approverRole: string;
  status: string;
  approverUserId?: string | null;
  approverUser?: { id: string; name: string; role: string } | null;
  comments?: string | null;
}

interface InvoiceRow {
  id: string;
  invoiceCode: string;
  invoiceNumber: string;
  vendorId: string;
  vendor: { id: string; name: string; vendorCode: string };
  poId: string | null;
  purchaseOrder: { id: string; poNumber: string; date: string; createdAt: string; quotation: { id: string; quotationNumber: string; date: string } | null; items: POItem[] } | null;
  date: string;
  createdAt: string;
  amount: number;
  taxAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
  advancePaid: number;
  advanceType: string | null;
  advanceOtherType: string | null;
  paymentStatus: string;
  stockStatus: string;
  deliveryDate: string | null;
  filePath: string | null;
  fileName: string | null;
  verificationStatus: string;
  createdBy: string;
  createdByUser: { id: string; name: string };
  approvalWorkflow?: {
    id: string;
    status: string;
    steps: ApprovalStep[];
  } | null;
}

const HEAD_ROLES = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ADMIN, UserRole.ADMIN_2];

const ADVANCE_TYPES = ['Cash', 'Credit Card', 'Debit Card', 'Bank Transfer', 'Cheque', 'Other'];

interface PaymentLedgerEntry {
  type: string;
  date: string;
  amount: number;
  mode: string | null;
  reference: string | null;
  status: string;
  requestNumber: string | null;
}

interface PaymentHistoryResponse {
  invoice: {
    id: string;
    invoiceCode: string;
    invoiceNumber: string;
    totalAmount: number;
    advancePaid: number;
    installmentsPaid: number;
    paidToDate: number;
    outstanding: number;
    paymentStatus: string;
  };
  ledger: PaymentLedgerEntry[];
}

function PaymentHistoryAccordion({ invoiceId, invoiceCode, vendorName }: { invoiceId: string; invoiceCode: string; vendorName: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['/invoices', invoiceId, 'payments'],
    queryFn: async () => {
      const response = await api.get(`/invoices/${invoiceId}/payments`);
      return response.data as PaymentHistoryResponse;
    },
  });

  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography><strong>{invoiceCode}</strong> — {vendorName}
          {data && data.invoice.outstanding > 0 && (
            <> — Outstanding: <strong>{formatCurrency(data.invoice.outstanding)}</strong></>
          )}
          {data && data.invoice.outstanding <= 0 && (
            <Chip label="Fully Paid" size="small" color="success" sx={{ ml: 1 }} />
          )}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        {isLoading ? (
          <CircularProgress size={24} />
        ) : data ? (
          <Box>
            {/* Summary */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 1, mb: 2 }}>
              <Box><Typography variant="caption" color="text.secondary">Total</Typography><Typography variant="body2" fontWeight={600}>{formatCurrency(data.invoice.totalAmount)}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Advance</Typography><Typography variant="body2" fontWeight={600}>{formatCurrency(data.invoice.advancePaid)}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Installments</Typography><Typography variant="body2" fontWeight={600}>{formatCurrency(data.invoice.installmentsPaid)}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Paid to Date</Typography><Typography variant="body2" fontWeight={600}>{formatCurrency(data.invoice.paidToDate)}</Typography></Box>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color={data.invoice.outstanding > 0 ? 'error.main' : 'success.main'} fontWeight={600}>
                Outstanding: {formatCurrency(data.invoice.outstanding)}
              </Typography>
            </Box>

            {/* Ledger table (desktop) */}
            <Table size="small" sx={{ display: { xs: 'none', sm: 'table' } }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Mode</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Reference</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.ledger.length === 0 ? (
                  <TableRow><TableCell colSpan={6} align="center">No payments recorded yet</TableCell></TableRow>
                ) : data.ledger.map((entry, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{entry.type}</TableCell>
                    <TableCell>{new Date(entry.date).toLocaleDateString()}</TableCell>
                    <TableCell>{formatCurrency(entry.amount)}</TableCell>
                    <TableCell>{entry.mode ?? '—'}</TableCell>
                    <TableCell>{entry.reference ?? '—'}</TableCell>
                    <TableCell><Chip label={entry.status} size="small" color={entry.status === 'PAID' ? 'success' : entry.status === 'REJECTED' ? 'error' : 'default'} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Ledger cards (mobile) */}
            <Box sx={{ display: { xs: 'flex', sm: 'none' }, flexDirection: 'column', gap: 1 }}>
              {data.ledger.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>No payments recorded yet</Typography>
              ) : data.ledger.map((entry, idx) => (
                <Card key={idx} variant="outlined" sx={{ p: 1.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle2" fontWeight={700}>{entry.type}</Typography>
                    <Chip label={entry.status} size="small" color={entry.status === 'PAID' ? 'success' : entry.status === 'REJECTED' ? 'error' : 'default'} />
                  </Box>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
                    <Box><Typography variant="caption" color="text.secondary">Date</Typography><Typography variant="body2">{new Date(entry.date).toLocaleDateString()}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">Amount</Typography><Typography variant="body2" fontWeight={600}>{formatCurrency(entry.amount)}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">Mode</Typography><Typography variant="body2">{entry.mode ?? '—'}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">Reference</Typography><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{entry.reference ?? '—'}</Typography></Box>
                  </Box>
                </Card>
              ))}
            </Box>
          </Box>
        ) : (
          <Typography color="text.secondary">Failed to load payment history</Typography>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export default function InvoicesPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [approvalPopup, setApprovalPopup] = useState<InvoiceRow | null>(null);

  // Form state
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedPoId, setSelectedPoId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [taxAmount, setTaxAmount] = useState('');
  const [cgstAmount, setCgstAmount] = useState(0);
  const [sgstAmount, setSgstAmount] = useState(0);
  const [igstAmount, setIgstAmount] = useState(0);
  const [totalAmount, setTotalAmount] = useState('');
  const [hasAdvance, setHasAdvance] = useState(false);
  const [advancePaid, setAdvancePaid] = useState('');
  const [advanceType, setAdvanceType] = useState('');
  const [advanceOtherType, setAdvanceOtherType] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [approvalAction, setApprovalAction] = useState<{ row: InvoiceRow; action: 'approve' | 'reject' } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/invoices', page, pageSize, search, statusFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (statusFilter) params.verificationStatus = statusFilter;
      const response = await api.get('/invoices', { params });
      return response.data;
    },
  });

  // Check for newly approved invoices (popup for creator)
  const { data: approvedInvoices } = useQuery({
    queryKey: ['/invoices', 'approved-notifications'],
    queryFn: async () => {
      const response = await api.get('/invoices', { params: { pageSize: 100, verificationStatus: 'VERIFIED' } });
      return response.data;
    },
    refetchOnMount: true,
  });

  useEffect(() => {
    if (approvedInvoices?.data && user) {
      const myApproved = approvedInvoices.data.filter((inv: InvoiceRow) => inv.createdBy === user.id);
      if (myApproved.length > 0) {
        const dismissed = JSON.parse(sessionStorage.getItem('invoice-approval-dismissed') || '[]');
        const newApprovals = myApproved.filter((inv: InvoiceRow) => !dismissed.includes(inv.id));
        if (newApprovals.length > 0) {
          setApprovalPopup(newApprovals[0]);
        }
      }
    }
  }, [approvedInvoices, user]);

  function dismissApprovalPopup() {
    if (approvalPopup) {
      const dismissed = JSON.parse(sessionStorage.getItem('invoice-approval-dismissed') || '[]');
      dismissed.push(approvalPopup.id);
      sessionStorage.setItem('invoice-approval-dismissed', JSON.stringify(dismissed));
    }
    setApprovalPopup(null);
  }

  const { data: vendorsData } = useQuery({
    queryKey: ['/vendors', 'for-invoice'],
    queryFn: async () => {
      const response = await api.get('/vendors', { params: { pageSize: 100 } });
      return response.data;
    },
  });

  // Fetch eligible POs (approved, partially delivered, or delivered) for the selected vendor
  const { data: approvedPOs } = useQuery({
    queryKey: ['/pos', 'invoice-eligible', selectedVendorId],
    queryFn: async () => {
      if (!selectedVendorId) return [];
      const statuses = ['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED'];
      const responses = await Promise.all(
        statuses.map((status) =>
          api.get('/purchase-orders', { params: { vendorId: selectedVendorId, status, pageSize: 100 } }),
        ),
      );
      return responses.flatMap((r) => r.data?.data ?? []);
    },
    enabled: !!selectedVendorId,
  });

  // Fetch selected PO to show its items
  const { data: selectedPO } = useQuery({
    queryKey: ['/pos', selectedPoId],
    queryFn: async () => {
      if (!selectedPoId) return null;
      const response = await api.get(`/purchase-orders/${selectedPoId}`);
      return response.data;
    },
    enabled: !!selectedPoId,
  });

  // Auto-fill amount, tax, and total from selected PO
  useEffect(() => {
    if (selectedPO) {
      const poTotal = Number(selectedPO.totalAmount) || 0;
      const poGst = Number(selectedPO.gstAmount) || 0;
      setAmount(String(poTotal));
      setTaxAmount(poGst > 0 ? String(poGst) : '');
      setTotalAmount(String(poTotal + poGst));
      // CGST/SGST/IGST will be computed by backend on save; clear preview here
      setCgstAmount(0);
      setSgstAmount(0);
      setIgstAmount(0);
    } else {
      setAmount('');
      setTaxAmount('');
      setTotalAmount('');
      setCgstAmount(0);
      setSgstAmount(0);
      setIgstAmount(0);
    }
  }, [selectedPO]);

  // Auto-compute total when amount or tax changes (only if no PO selected)
  useEffect(() => {
    if (!selectedPoId) {
      const amt = Number(amount) || 0;
      const tax = Number(taxAmount) || 0;
      setTotalAmount(String(amt + tax));
    }
  }, [amount, taxAmount, selectedPoId]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append('vendorId', selectedVendorId);
      if (selectedPoId) formData.append('poId', selectedPoId);
      if (invoiceNumber) formData.append('invoiceNumber', invoiceNumber);
      formData.append('amount', amount);
      formData.append('taxAmount', taxAmount || '0');
      formData.append('totalAmount', totalAmount);
      if (hasAdvance && advancePaid) {
        formData.append('advancePaid', advancePaid);
        if (advanceType) formData.append('advanceType', advanceType);
        if (advanceType === 'Other' && advanceOtherType) formData.append('advanceOtherType', advanceOtherType);
      }
      if (deliveryDate) formData.append('deliveryDate', deliveryDate);
      formData.append('acknowledged', String(acknowledged));
      if (selectedFile) formData.append('file', selectedFile);
      const response = await api.post('/invoices', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const validateInvoiceForm = (): boolean => {
    const invoiceAmount = Number(amount);
    const tax = Number(taxAmount || 0);
    const total = Number(totalAmount);
    const advance = Number(advancePaid || 0);
    if (!selectedVendorId || !Number.isFinite(invoiceAmount) || invoiceAmount <= 0) {
      setError('Select a vendor and enter an invoice amount greater than zero');
      return false;
    }
    if (!Number.isFinite(tax) || tax < 0 || !Number.isFinite(total) || total <= 0) {
      setError('Tax and total amounts must be valid and non-negative');
      return false;
    }
    if (Math.abs(total - (invoiceAmount + tax)) > 0.01) {
      setError('Total amount must equal invoice amount plus tax amount');
      return false;
    }
    if (hasAdvance && (!Number.isFinite(advance) || advance < 0 || advance > total)) {
      setError('Advance payment must be between zero and the invoice total');
      return false;
    }
    if (advance > 0 && !advanceType) {
      setError('Select the advance payment type');
      return false;
    }
    if (advanceType === 'Other' && !advanceOtherType.trim()) {
      setError('Specify the advance payment type');
      return false;
    }
    // ── E13: Use shared STORAGE.MAX_FILE_SIZE_MB instead of hard-coded 100 MB ──
    if (selectedFile && (!['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'].includes(selectedFile.type) || selectedFile.size > STORAGE.MAX_FILE_SIZE_MB * 1024 * 1024)) {
      setError(`Invoice file must be a PDF or image (JPG, PNG, GIF, WebP, BMP, TIFF) smaller than ${STORAGE.MAX_FILE_SIZE_MB} MB`);
      return false;
    }
    return true;
  };

  const approveMutation = useMutation({
    mutationFn: async ({ invId, comments, acknowledged }: { invId: string; comments?: string; acknowledged: true }) => {
      const response = await api.post(`/invoices/${invId}/approve`, { comments, acknowledged });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setApprovalAction(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ invId, reason, acknowledged }: { invId: string; reason: string; acknowledged: true }) => {
      const response = await api.post(`/invoices/${invId}/reject`, { reason, acknowledged });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setApprovalAction(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const [deleteRow, setDeleteRow] = useState<InvoiceRow | null>(null);
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/invoices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setDeleteRow(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: InvoiceRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const vendors: { id: string; name: string; vendorCode: string }[] = vendorsData?.data ?? [];

  // Auto-open approval dialog when navigated from a push notification
  useApprovalDeepLink(rows, (row) => setApprovalAction({ row, action: 'approve' }));

  function resetForm() {
    setSelectedVendorId('');
    setSelectedPoId('');
    setInvoiceNumber('');
    setAmount('');
    setTaxAmount('');
    setTotalAmount('');
    setHasAdvance(false);
    setAdvancePaid('');
    setAdvanceType('');
    setAdvanceOtherType('');
    setDeliveryDate('');
    setAcknowledged(false);
    setSelectedFile(null);
    setError('');
  }

  function canApprove(row: InvoiceRow): boolean {
    if (!row.approvalWorkflow) return false;
    if (!user || !HEAD_ROLES.includes(user.role as UserRole)) return false;
    if (row.verificationStatus !== InvoiceVerificationStatus.PENDING) return false;
    const step = row.approvalWorkflow.steps.find(
      (s) => s.approverRole === user.role && s.status === 'PENDING'
    );
    if (!step) return false;
    const alreadyApproved = row.approvalWorkflow.steps.some(
      (s) => s.approverUserId === user.id && s.status === 'APPROVED'
    );
    return !alreadyApproved;
  }

  function handleDownload(id: string, fileName: string) {
    downloadFile('invoices', id, fileName).catch(() => setError('Failed to download file'));
  }

  function handleOcrExtract(data: OcrInvoiceData) {
    if (data.invoiceNumber) setInvoiceNumber(data.invoiceNumber);
    if (data.amount != null) setAmount(String(data.amount));
    if (data.taxAmount != null) setTaxAmount(String(data.taxAmount));
    if (data.totalAmount != null) setTotalAmount(String(data.totalAmount));
    if (data.deliveryDate) setDeliveryDate(data.deliveryDate);
    if (data.vendorId) setSelectedVendorId(data.vendorId);
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>Vendor Invoices</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { resetForm(); setCreateOpen(true); }}>Add Invoice</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      <Card>
        <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="Search invoices..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />
          <TextField select size="small" label="Verification" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} sx={{ width: 180 }}>
            <MenuItem value="">All</MenuItem>
            {Object.values(InvoiceVerificationStatus).map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
          </TextField>
        </Box>

        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ '@media (min-width: 900px)': { minWidth: 'max-content', '& .MuiTableCell-root': { whiteSpace: 'nowrap' } } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Invoice Code</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Invoice No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>PO</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Invoice Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Generated On</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>CGST</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>SGST</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>IGST</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Advance</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Payment</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Stock</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Verification</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>File</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={17} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={17} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No invoices found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell data-label="Invoice Code">{row.invoiceCode}</TableCell>
                    <TableCell data-label="Invoice No">{row.invoiceNumber}</TableCell>
                    <TableCell data-label="Vendor">{row.vendor?.vendorCode} - {row.vendor?.name ?? '—'}</TableCell>
                    <TableCell data-label="PO">{row.purchaseOrder?.poNumber ?? '—'}</TableCell>
                    <TableCell data-label="Invoice Date">
                      {row.purchaseOrder && new Date(row.date) < new Date(row.purchaseOrder.date) ? (
                        <Box>
                          <Typography color="error" fontWeight={600}>{formatDate(row.date)}</Typography>
                          <Typography variant="caption" color="error">Before PO ({formatDate(row.purchaseOrder.date)})</Typography>
                        </Box>
                      ) : row.purchaseOrder?.quotation && new Date(row.date) < new Date(row.purchaseOrder.quotation.date) ? (
                        <Box>
                          <Typography color="error" fontWeight={600}>{formatDate(row.date)}</Typography>
                          <Typography variant="caption" color="error">Before quotation ({formatDate(row.purchaseOrder.quotation.date)})</Typography>
                        </Box>
                      ) : formatDate(row.date)}
                    </TableCell>
                    <TableCell data-label="Generated On"><Typography variant="caption" color="text.secondary">{formatDate(row.createdAt)}</Typography></TableCell>
                    <TableCell data-label="Amount">{formatCurrency(row.amount)}</TableCell>
                    <TableCell data-label="CGST">{formatCurrency(row.cgstAmount)}</TableCell>
                    <TableCell data-label="SGST">{formatCurrency(row.sgstAmount)}</TableCell>
                    <TableCell data-label="IGST">{formatCurrency(row.igstAmount)}</TableCell>
                    <TableCell data-label="Total">{formatCurrency(row.totalAmount)}</TableCell>
                    <TableCell data-label="Advance">
                      {Number(row.advancePaid) > 0
                        ? `${formatCurrency(row.advancePaid)} (${row.advanceType === 'Other' ? row.advanceOtherType : row.advanceType})`
                        : '—'}
                    </TableCell>
                    <TableCell data-label="Payment">
                      <Chip
                        label={row.paymentStatus.replace(/_/g, ' ')}
                        size="small"
                        color={STATUS_COLORS[row.paymentStatus] ?? 'default'}
                      />
                    </TableCell>
                    <TableCell data-label="Stock">
                      <Chip
                        label={row.stockStatus.replace(/_/g, ' ')}
                        size="small"
                        color={STATUS_COLORS[row.stockStatus] ?? 'default'}
                      />
                    </TableCell>
                    <TableCell data-label="Verification"><Chip label={row.verificationStatus.replace(/_/g, ' ')} size="small" color={STATUS_COLORS[row.verificationStatus] ?? 'default'} /></TableCell>
                    <TableCell data-label="File">
                      {row.filePath ? (
                        <IconButton size="small" onClick={() => handleDownload(row.id, row.fileName ?? 'invoice')}><DownloadIcon fontSize="small" /></IconButton>
                      ) : '—'}
                    </TableCell>
                    <TableCell data-label="Actions">
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {canApprove(row) && (
                          <>
                            <IconButton size="small" color="success" onClick={() => setApprovalAction({ row, action: 'approve' })} title="Approve"><CheckIcon fontSize="small" /></IconButton>
                            <IconButton size="small" color="error" onClick={() => setApprovalAction({ row, action: 'reject' })} title="Reject"><CloseIcon fontSize="small" /></IconButton>
                          </>
                        )}
                        {row.verificationStatus !== InvoiceVerificationStatus.VERIFIED && (
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
                <Typography><strong>{row.invoiceCode}</strong> — {row.vendor?.name} — <Chip label={row.approvalWorkflow!.status} size="small" /></Typography>
              </AccordionSummary>
              <AccordionDetails>
                <ApprovalStepsDisplay steps={row.approvalWorkflow!.steps} />
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      )}

      {/* Payment History */}
      {rows.length > 0 && rows.some((r) => r.verificationStatus === InvoiceVerificationStatus.VERIFIED) && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>Payment History</Typography>
          {rows.filter((r) => r.verificationStatus === InvoiceVerificationStatus.VERIFIED).map((row) => (
            <PaymentHistoryAccordion key={row.id} invoiceId={row.id} invoiceCode={row.invoiceCode} vendorName={row.vendor?.name ?? '—'} />
          ))}
        </Box>
      )}

      {/* Create Invoice Dialog */}
      <ResponsiveDialog open={createOpen} onClose={() => { setCreateOpen(false); resetForm(); }} maxWidth="md" fullWidth>
        <DialogTitle>Create Vendor Invoice</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {/* Vendor Selection */}
            <TextField
              select
              label="Vendor"
              value={selectedVendorId}
              onChange={(e) => { setSelectedVendorId(e.target.value); setSelectedPoId(''); }}
              fullWidth
              size="small"
              required
            >
              {vendors.map((v) => (
                <MenuItem key={v.id} value={v.id}>{v.vendorCode} - {v.name}</MenuItem>
              ))}
            </TextField>

            {/* PO Selection (approved POs for this vendor) */}
            {selectedVendorId && (
              <TextField
                select
                label="Purchase Order (approved, optional)"
                value={selectedPoId}
                onChange={(e) => setSelectedPoId(e.target.value)}
                fullWidth
                size="small"
                helperText={approvedPOs?.length === 0 ? 'No approved POs for this vendor' : 'Select a PO to see its materials'}
              >
                <MenuItem value="">None</MenuItem>
                {approvedPOs?.map((po: { id: string; poNumber: string; grandTotal: number }) => (
                  <MenuItem key={po.id} value={po.id}>{po.poNumber} — {formatCurrency(po.grandTotal)}</MenuItem>
                ))}
              </TextField>
            )}

            {/* PO Materials (read-only) */}
            {selectedPO?.items && selectedPO.items.length > 0 && (
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>PO Materials</Typography>
                <ResponsiveTable>
                  <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
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
                        {selectedPO.items.map((item: POItem, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell data-label="S.no">{idx + 1}</TableCell>
                            <TableCell data-label="Material">{item.materialName}</TableCell>
                            <TableCell data-label="Qty">{item.quantity}</TableCell>
                            <TableCell data-label="Unit">{item.unit ?? '—'}</TableCell>
                            <TableCell data-label="Unit Price">{formatCurrency(item.unitPrice)}</TableCell>
                            <TableCell data-label="GST %">{Number(item.gstRate ?? 0)}%</TableCell>
                            <TableCell data-label="Amount">{formatCurrency(item.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </ResponsiveTable>
              </Box>
            )}

            {/* Invoice details */}
            <TextField
              label="Invoice Number (auto-generated, leave blank)"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              fullWidth
              size="small"
              helperText="If left blank, the system will auto-generate VGH-IN001"
            />
            <TextField
              label="Invoice Amount"
              type="text"
              value={formatIndianNumber(amount)}
              onChange={(e) => setAmount(e.target.value.replace(/,/g, ''))}
              inputMode="decimal"
              inputProps={{ min: 0.01, step: 0.01 }}
              fullWidth
              size="small"
              required
              helperText={selectedPoId ? 'Auto-filled from PO total' : 'Enter invoice amount'}
              InputProps={selectedPoId ? { readOnly: true } : undefined}
            />
            <TextField
              label="Tax Amount (GST)"
              type="text"
              value={formatIndianNumber(taxAmount)}
              onChange={(e) => setTaxAmount(e.target.value.replace(/,/g, ''))}
              inputMode="decimal"
              inputProps={{ min: 0, step: 0.01 }}
              fullWidth
              size="small"
              helperText={selectedPoId ? 'Auto-filled from PO (per-item GST rates)' : 'Enter GST amount — CGST/SGST/IGST split is auto-calculated on save'}
              InputProps={selectedPoId ? { readOnly: true } : undefined}
            />
            {/* CGST / SGST / IGST breakdown — auto-calculated by backend based on vendor vs hospital state */}
            {Number(taxAmount) > 0 && (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1 }}>
                <TextField
                  label="CGST"
                  value={formatIndianNumber(cgstAmount)}
                  size="small"
                  InputProps={{ readOnly: true }}
                  helperText="Auto-calculated"
                />
                <TextField
                  label="SGST"
                  value={formatIndianNumber(sgstAmount)}
                  size="small"
                  InputProps={{ readOnly: true }}
                  helperText="Auto-calculated"
                />
                <TextField
                  label="IGST"
                  value={formatIndianNumber(igstAmount)}
                  size="small"
                  InputProps={{ readOnly: true }}
                  helperText="Auto-calculated"
                />
              </Box>
            )}
            <TextField
              label="Total Amount (Amount + Tax)"
              type="text"
              value={formatIndianNumber(totalAmount)}
              inputMode="decimal"
              fullWidth
              size="small"
              required
              InputProps={{ readOnly: true }}
              helperText="Auto-calculated"
            />

            {/* Advance Paid */}
            <Box>
              <Button
                size="small"
                onClick={() => { setHasAdvance(!hasAdvance); if (hasAdvance) { setAdvancePaid(''); setAdvanceType(''); setAdvanceOtherType(''); } }}
                variant={hasAdvance ? 'contained' : 'outlined'}
                color={hasAdvance ? 'primary' : 'inherit'}
              >
                {hasAdvance ? '✓ Advance Paid' : 'Add Advance Payment'}
              </Button>
              {hasAdvance && (
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, mt: 1, flexWrap: 'wrap' }}>
                  <TextField
                    label="Advance Amount"
                    type="text"
                    value={formatIndianNumber(advancePaid)}
                    onChange={(e) => setAdvancePaid(e.target.value.replace(/,/g, ''))}
                    inputMode="decimal"
                    inputProps={{ min: 0, max: Number(totalAmount) || undefined, step: 0.01 }}
                    size="small"
                    sx={{ flex: 1, minWidth: 0 }}
                  />
                  <TextField
                    select
                    label="Payment Type"
                    value={advanceType}
                    onChange={(e) => setAdvanceType(e.target.value)}
                    size="small"
                    sx={{ flex: 1, minWidth: 0 }}
                  >
                    {ADVANCE_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                  </TextField>
                  {advanceType === 'Other' && (
                    <TextField
                      label="Specify Other Type"
                      value={advanceOtherType}
                      onChange={(e) => setAdvanceOtherType(e.target.value)}
                      size="small"
                      sx={{ flex: 1, minWidth: 0 }}
                    />
                  )}
                </Box>
              )}
            </Box>

            {/* Delivery Date */}
            <TextField
              label="Delivery Date (optional)"
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              size="small"
              sx={{ width: { xs: '100%', sm: 250 } }}
              InputLabelProps={{ shrink: true }}
            />

            {/* File Upload */}
            <Box>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) setSelectedFile(f); }} />
              <Button variant="outlined" onClick={() => fileRef.current?.click()} startIcon={<AddIcon />}>
                {selectedFile ? `✓ ${selectedFile.name}` : 'Upload Invoice File'}
              </Button>
              <OcrAutoFill
                file={selectedFile}
                documentType="INVOICE"
                onExtract={handleOcrExtract}
              />
            </Box>
            <AcknowledgementCheckbox
              checked={acknowledged}
              onChange={setAcknowledged}
              entityLabel="invoice"
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => { setError(''); if (validateInvoiceForm()) createMutation.mutate(); }}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? <CircularProgress size={20} /> : 'Create Invoice'}
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
            <strong>Your Invoice {approvalPopup?.invoiceCode} has been APPROVED!</strong>
          </Typography>
          <Typography variant="caption">
            Vendor: {approvalPopup?.vendor?.name} — Total: {approvalPopup ? formatCurrency(approvalPopup.totalAmount) : ''}
          </Typography>
          <Typography variant="caption" display="block">
            You can now mark payment as paid and mark stock as received.
          </Typography>
        </Alert>
      </Snackbar>

      <ApprovalActionDialog
        open={approvalAction !== null}
        action={approvalAction?.action ?? 'approve'}
        entityLabel="Invoice"
        pending={approveMutation.isPending || rejectMutation.isPending}
        error={error}
        onClearError={() => setError('')}
        onClose={() => setApprovalAction(null)}
        onConfirm={(payload) => {
          if (!approvalAction) return;
          if (approvalAction.action === 'approve') {
            approveMutation.mutate({ invId: approvalAction.row.id, comments: payload.comments, acknowledged: true });
          } else {
            rejectMutation.mutate({ invId: approvalAction.row.id, reason: payload.reason!, acknowledged: true });
          }
        }}
      />

      <ResponsiveDialog open={deleteRow !== null} onClose={() => setDeleteRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Invoice</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete invoice <strong>{deleteRow?.invoiceCode}</strong>?</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            This action cannot be undone. Only invoices that are not verified can be deleted.
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
