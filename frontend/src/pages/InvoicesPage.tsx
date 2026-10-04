import { useState, useEffect } from 'react';
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
import ApprovalCommentsInline from '../components/ApprovalCommentsInline';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  Delete as DeleteIcon,
  Publish as PostToBooksIcon,
  AccountTree as CrossLinkIcon,
  PictureAsPdf as PdfIcon,
  WhatsApp as WhatsAppIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { InvoiceVerificationStatus, UserRole, STORAGE, isAdminRole } from '@hospital-erp/shared';
import { formatCurrency, formatDate, formatIndianNumber, STATUS_COLORS, enumLabel } from '../utils/enumOptions';
import { useTranslation, Trans } from 'react-i18next';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { generateInvoicePDF } from '../utils/invoicePdf';
import { shareOnWhatsApp, buildInvoiceShareMessage } from '../utils/whatsappShare';
import AcknowledgementCheckbox from '../components/AcknowledgementCheckbox';
import ApprovalActionDialog from '../components/ApprovalActionDialog';
import OcrAutoFill, { type OcrInvoiceData } from '../components/OcrAutoFill';
import ResponsiveTable from '../components/ResponsiveTable';
import RefreshButton from '../components/RefreshButton';
import { useApprovalDeepLink } from '../utils/useApprovalDeepLink';
import { useDeepLinkRow } from '../hooks/useDeepLinkRow';
import { useUrlFilters } from '../hooks/useUrlFilters';
import CommentsButton from '../components/CommentsButton';
import { LinkedFilesButton } from '../components/LinkedFiles';
import FilePicker from '../components/FilePicker';

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
  isPostedToBooks?: boolean;
  postedVoucherNumber?: string | null;
  approvalWorkflow?: {
    id: string;
    status: string;
    steps: ApprovalStep[];
  } | null;
}

const HEAD_ROLES = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION];
// Admin roles (ADMIN, ADMIN_2, ADMIN_3, ...) are checked dynamically via isAdminRole().

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
  const { t } = useTranslation('invoices');
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
            <> — {t('outstandingLabel')}<strong>{formatCurrency(data.invoice.outstanding)}</strong></>
          )}
          {data && data.invoice.outstanding <= 0 && (
            <Chip label={t('fullyPaid')} size="small" color="success" sx={{ ml: 1 }} />
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
              <Box><Typography variant="caption" color="text.secondary">{t('sumTotal')}</Typography><Typography variant="body2" fontWeight={600}>{formatCurrency(data.invoice.totalAmount)}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">{t('sumAdvance')}</Typography><Typography variant="body2" fontWeight={600}>{formatCurrency(data.invoice.advancePaid)}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">{t('sumInstallments')}</Typography><Typography variant="body2" fontWeight={600}>{formatCurrency(data.invoice.installmentsPaid)}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">{t('sumPaidToDate')}</Typography><Typography variant="body2" fontWeight={600}>{formatCurrency(data.invoice.paidToDate)}</Typography></Box>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color={data.invoice.outstanding > 0 ? 'error.main' : 'success.main'} fontWeight={600}>
                {t('outstandingLine', { v: formatCurrency(data.invoice.outstanding) })}
              </Typography>
            </Box>

            {/* Ledger table (desktop) */}
            <Table size="small" sx={{ display: { xs: 'none', sm: 'table' } }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{t('ledgerType')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('ledgerDate')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('ledgerAmount')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('ledgerMode')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('ledgerReference')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('ledgerStatus')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.ledger.length === 0 ? (
                  <TableRow><TableCell colSpan={6} align="center">{t('noPayments')}</TableCell></TableRow>
                ) : data.ledger.map((entry, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{entry.type}</TableCell>
                    <TableCell>{new Date(entry.date).toLocaleDateString()}</TableCell>
                    <TableCell>{formatCurrency(entry.amount)}</TableCell>
                    <TableCell>{entry.mode ? enumLabel(entry.mode) : '—'}</TableCell>
                    <TableCell>{entry.reference ?? '—'}</TableCell>
                    <TableCell><Chip label={enumLabel(entry.status)} size="small" color={entry.status === 'PAID' ? 'success' : entry.status === 'REJECTED' ? 'error' : 'default'} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Ledger cards (mobile) */}
            <Box sx={{ display: { xs: 'flex', sm: 'none' }, flexDirection: 'column', gap: 1 }}>
              {data.ledger.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>{t('noPayments')}</Typography>
              ) : data.ledger.map((entry, idx) => (
                <Card key={idx} variant="outlined" sx={{ p: 1.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                    <Typography variant="subtitle2" fontWeight={700}>{entry.type}</Typography>
                    <Chip label={enumLabel(entry.status)} size="small" color={entry.status === 'PAID' ? 'success' : entry.status === 'REJECTED' ? 'error' : 'default'} />
                  </Box>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
                    <Box><Typography variant="caption" color="text.secondary">{t('ledgerDate')}</Typography><Typography variant="body2">{new Date(entry.date).toLocaleDateString()}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">{t('ledgerAmount')}</Typography><Typography variant="body2" fontWeight={600}>{formatCurrency(entry.amount)}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">{t('ledgerMode')}</Typography><Typography variant="body2">{entry.mode ? enumLabel(entry.mode) : '—'}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">{t('ledgerReference')}</Typography><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{entry.reference ?? '—'}</Typography></Box>
                  </Box>
                </Card>
              ))}
            </Box>
          </Box>
        ) : (
          <Typography color="text.secondary">{t('failedHistory')}</Typography>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export default function InvoicesPage() {
  const { t } = useTranslation('invoices');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [dateFilter, setDateFilter] = useState('');
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

  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/invoices', page, pageSize, search, statusFilter, minAmount, maxAmount, dateFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (statusFilter) params.verificationStatus = statusFilter;
      if (minAmount) params.minAmount = minAmount;
      if (maxAmount) params.maxAmount = maxAmount;
      if (dateFilter) params.dateFilter = dateFilter;
      const response = await api.get('/invoices', { params });
      return response.data;
    },
    refetchOnWindowFocus: 'always',
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
      setError(t('errVendorAmount'));
      return false;
    }
    if (!Number.isFinite(tax) || tax < 0 || !Number.isFinite(total) || total <= 0) {
      setError(t('errTaxTotal'));
      return false;
    }
    if (Math.abs(total - (invoiceAmount + tax)) > 0.01) {
      setError(t('errTotalMismatch'));
      return false;
    }
    if (hasAdvance && (!Number.isFinite(advance) || advance < 0 || advance > total)) {
      setError(t('errAdvanceRange'));
      return false;
    }
    if (advance > 0 && !advanceType) {
      setError(t('errAdvanceType'));
      return false;
    }
    if (advanceType === 'Other' && !advanceOtherType.trim()) {
      setError(t('errAdvanceSpecify'));
      return false;
    }
    // ── E13: Use shared STORAGE.MAX_FILE_SIZE_MB instead of hard-coded 100 MB ──
    if (selectedFile && (!['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'].includes(selectedFile.type) || selectedFile.size > STORAGE.MAX_FILE_SIZE_MB * 1024 * 1024)) {
      setError(t('errFile', { mb: STORAGE.MAX_FILE_SIZE_MB }));
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
  const [crossLinkRow, setCrossLinkRow] = useState<InvoiceRow | null>(null);
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

  // Post a verified invoice to the accounting ledgers (creates a PURCHASE voucher)
  const postToBooksMutation = useMutation({
    mutationFn: async (invId: string) => {
      const response = await api.post(`/invoices/${invId}/post-to-books`);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['/ledgers'] });
      setSuccessMsg(t('postedAs', { n: data.jvNumber }));
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  // Cross-module link data for an invoice (PO → quotation → payments → ledger → settlements)
  const { data: crossLinkData, isLoading: crossLinkLoading } = useQuery({
    queryKey: ['/invoices', crossLinkRow?.id, 'cross-link'],
    queryFn: async () => {
      const response = await api.get(`/invoices/${crossLinkRow!.id}/cross-link`);
      return response.data;
    },
    enabled: !!crossLinkRow,
  });

  const rows: InvoiceRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const vendors: { id: string; name: string; vendorCode: string }[] = vendorsData?.data ?? [];

  // Auto-open approval dialog when navigated from a push notification
  useApprovalDeepLink(rows, (row) => setApprovalAction({ row, action: 'approve' }));
  // Deep-link from global search: ?id=<invoiceId> — filter to that invoice and highlight it
  const { highlightId, rowRef } = useDeepLinkRow<InvoiceRow>('/invoices', rows, 'invoiceCode', (v) => { setSearch(v); setPage(0); });
  useUrlFilters({ search: (v) => { setSearch(v); setPage(0); }, status: (v) => { setStatusFilter(v); setPage(0); }, minAmount: setMinAmount, maxAmount: setMaxAmount, dateFilter: setDateFilter });

  function downloadInvoicePdf(row: InvoiceRow) {
    const items = row.purchaseOrder?.items ?? [];
    generateInvoicePDF({
      invoiceCode: row.invoiceCode ?? row.invoiceNumber,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.date ?? row.createdAt,
      vendorName: row.vendor?.name ?? '—',
      vendorCode: row.vendor?.vendorCode,
      subtotal: Number(row.amount ?? 0),
      cgst: Number(row.cgstAmount ?? 0),
      sgst: Number(row.sgstAmount ?? 0),
      igst: Number(row.igstAmount ?? 0),
      totalGst: Number(row.taxAmount ?? 0),
      grandTotal: Number(row.totalAmount ?? 0),
      items: items.map((it) => ({
        description: it.materialName,
        quantity: Number(it.quantity ?? 0),
        unit: it.unit,
        rate: Number(it.unitPrice ?? 0),
        amount: Number(it.amount ?? 0),
        gstRate: Number(it.gstRate ?? 0),
      })),
    });
  }

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
    if (!user || (!HEAD_ROLES.includes(user.role as UserRole) && !isAdminRole(user.role))) return false;
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
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>{t('title')}</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <RefreshButton onClick={() => refetch()} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { resetForm(); setCreateOpen(true); }}>{t('addInvoice')}</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      <Card>
        <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />
          <TextField select size="small" label={t('verification')} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} sx={{ width: 180 }}>
            <MenuItem value="">{t('all')}</MenuItem>
            {Object.values(InvoiceVerificationStatus).map((s) => <MenuItem key={s} value={s}>{enumLabel(s)}</MenuItem>)}
          </TextField>
        </Box>

        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ '@media (min-width: 900px)': { minWidth: 'max-content', '& .MuiTableCell-root': { whiteSpace: 'nowrap' } } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{t('colInvoiceCode')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colInvoiceNo')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colVendor')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colPO')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colInvoiceDate')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colGeneratedOn')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colAmount')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colCgst')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colSgst')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colIgst')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colTotal')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colAdvance')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colPayment')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colStock')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('verification')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colApprovalComments')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colFile')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('colActions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={18} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={18} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{t('noInvoices')}</Typography></TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} hover ref={rowRef(row.id)} sx={{ ...(highlightId === row.id && { bgcolor: 'warning.light', '&:hover': { bgcolor: 'warning.light' } }) }}>
                    <TableCell data-label={t('colInvoiceCode')}>{row.invoiceCode}</TableCell>
                    <TableCell data-label={t('colInvoiceNo')}>{row.invoiceNumber}</TableCell>
                    <TableCell data-label={t('colVendor')}>{row.vendor?.vendorCode} - {row.vendor?.name ?? '—'}</TableCell>
                    <TableCell data-label={t('colPO')}>{row.purchaseOrder?.poNumber ?? '—'}</TableCell>
                    <TableCell data-label={t('colInvoiceDate')}>
                      {row.purchaseOrder && new Date(row.date) < new Date(row.purchaseOrder.date) ? (
                        <Box>
                          <Typography color="error" fontWeight={600}>{formatDate(row.date)}</Typography>
                          <Typography variant="caption" color="error">{t('beforePo', { d: formatDate(row.purchaseOrder.date) })}</Typography>
                        </Box>
                      ) : row.purchaseOrder?.quotation && new Date(row.date) < new Date(row.purchaseOrder.quotation.date) ? (
                        <Box>
                          <Typography color="error" fontWeight={600}>{formatDate(row.date)}</Typography>
                          <Typography variant="caption" color="error">{t('beforeQuotation', { d: formatDate(row.purchaseOrder.quotation.date) })}</Typography>
                        </Box>
                      ) : formatDate(row.date)}
                    </TableCell>
                    <TableCell data-label={t('colGeneratedOn')}><Typography variant="caption" color="text.secondary">{formatDate(row.createdAt)}</Typography></TableCell>
                    <TableCell data-label={t('colAmount')}>{formatCurrency(row.amount)}</TableCell>
                    <TableCell data-label={t('colCgst')}>{formatCurrency(row.cgstAmount)}</TableCell>
                    <TableCell data-label={t('colSgst')}>{formatCurrency(row.sgstAmount)}</TableCell>
                    <TableCell data-label={t('colIgst')}>{formatCurrency(row.igstAmount)}</TableCell>
                    <TableCell data-label={t('colTotal')}>{formatCurrency(row.totalAmount)}</TableCell>
                    <TableCell data-label={t('colAdvance')}>
                      {Number(row.advancePaid) > 0
                        ? `${formatCurrency(row.advancePaid)} (${row.advanceType === 'Other' ? row.advanceOtherType : (row.advanceType ? t(`advanceTypes.${row.advanceType}`, row.advanceType) : '')})`
                        : '—'}
                    </TableCell>
                    <TableCell data-label={t('colPayment')}>
                      <Chip
                        label={enumLabel(row.paymentStatus)}
                        size="small"
                        color={STATUS_COLORS[row.paymentStatus] ?? 'default'}
                      />
                    </TableCell>
                    <TableCell data-label={t('colStock')}>
                      <Chip
                        label={enumLabel(row.stockStatus)}
                        size="small"
                        color={STATUS_COLORS[row.stockStatus] ?? 'default'}
                      />
                    </TableCell>
                    <TableCell data-label={t('verification')}><Chip label={enumLabel(row.verificationStatus)} size="small" color={STATUS_COLORS[row.verificationStatus] ?? 'default'} /></TableCell>
                    <TableCell data-label={t('colApprovalComments')} sx={{ maxWidth: 260 }}>
                      {row.approvalWorkflow?.steps
                        ? <ApprovalCommentsInline steps={row.approvalWorkflow.steps} />
                        : <Typography variant="caption" color="text.secondary">—</Typography>}
                    </TableCell>
                    <TableCell data-label={t('colFile')}>
                      <LinkedFilesButton recordType="INVOICE" recordId={row.id} title={row.invoiceCode} />
                    </TableCell>
                    <TableCell data-label={t('colActions')}>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        <CommentsButton entityType="INVOICE" entityId={row.id} entityLabel={row.invoiceCode} url="/invoices" />
                        {canApprove(row) && (
                          <>
                            <IconButton size="small" color="success" onClick={() => setApprovalAction({ row, action: 'approve' })} title={t('approve')}><CheckIcon fontSize="small" /></IconButton>
                            <IconButton size="small" color="error" onClick={() => setApprovalAction({ row, action: 'reject' })} title={t('reject')}><CloseIcon fontSize="small" /></IconButton>
                          </>
                        )}
                        {row.verificationStatus === InvoiceVerificationStatus.VERIFIED && !row.isPostedToBooks && (
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => {
                              if (confirm(t('postConfirm', { code: row.invoiceCode, vendor: row.vendor?.name }))) {
                                postToBooksMutation.mutate(row.id);
                              }
                            }}
                            title={t('postToBooks')}
                            disabled={postToBooksMutation.isPending}
                          >
                            <PostToBooksIcon fontSize="small" />
                          </IconButton>
                        )}
                        {row.isPostedToBooks && row.postedVoucherNumber && (
                          <Chip
                            label={t('postedChip', { n: row.postedVoucherNumber })}
                            size="small"
                            color="success"
                            variant="outlined"
                            sx={{ fontSize: '0.7rem' }}
                          />
                        )}
                        {row.verificationStatus !== InvoiceVerificationStatus.VERIFIED && (
                          <IconButton size="small" color="error" onClick={() => setDeleteRow(row)} title={t('delete')}><DeleteIcon fontSize="small" /></IconButton>
                        )}
                        <IconButton size="small" onClick={() => setCrossLinkRow(row)} title={t('crossLink')}><CrossLinkIcon fontSize="small" /></IconButton>
                        <IconButton size="small" color="error" onClick={() => downloadInvoicePdf(row)} title={t('downloadPdf')}><PdfIcon fontSize="small" /></IconButton>
                        <IconButton size="small" sx={{ color: '#25D366' }} onClick={() => shareOnWhatsApp(buildInvoiceShareMessage({ invoiceCode: row.invoiceCode, invoiceNumber: row.invoiceNumber, vendorName: row.vendor?.name, totalAmount: Number(row.totalAmount), paymentStatus: row.paymentStatus, verificationStatus: row.verificationStatus, date: row.date }))} title={t('shareWhatsapp')}><WhatsAppIcon fontSize="small" /></IconButton>
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
          <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>{t('approvalStatus')}</Typography>
          {rows.filter((r) => r.approvalWorkflow).map((row) => (
            <Accordion key={row.id}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography><strong>{row.invoiceCode}</strong> — {row.vendor?.name} — <Chip label={enumLabel(row.approvalWorkflow!.status)} size="small" /></Typography>
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
          <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>{t('paymentHistory')}</Typography>
          {rows.filter((r) => r.verificationStatus === InvoiceVerificationStatus.VERIFIED).map((row) => (
            <PaymentHistoryAccordion key={row.id} invoiceId={row.id} invoiceCode={row.invoiceCode} vendorName={row.vendor?.name ?? '—'} />
          ))}
        </Box>
      )}

      {/* Create Invoice Dialog */}
      <ResponsiveDialog open={createOpen} onClose={() => { setCreateOpen(false); resetForm(); }} maxWidth="md" fullWidth>
        <DialogTitle>{t('createTitle')}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {/* Vendor Selection */}
            <TextField
              select
              label={t('vendor')}
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
                label={t('poSelect')}
                value={selectedPoId}
                onChange={(e) => setSelectedPoId(e.target.value)}
                fullWidth
                size="small"
                helperText={approvedPOs?.length === 0 ? t('noApprovedPOs') : t('selectPoHelp')}
              >
                <MenuItem value="">{t('none')}</MenuItem>
                {approvedPOs?.map((po: { id: string; poNumber: string; grandTotal: number }) => (
                  <MenuItem key={po.id} value={po.id}>{po.poNumber} — {formatCurrency(po.grandTotal)}</MenuItem>
                ))}
              </TextField>
            )}

            {/* PO Materials (read-only) */}
            {selectedPO?.items && selectedPO.items.length > 0 && (
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>{t('poMaterials')}</Typography>
                <ResponsiveTable>
                  <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>{t('sno')}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{t('material')}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{t('qty')}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{t('unit')}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{t('unitPrice')}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{t('gstPct')}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{t('amount')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {selectedPO.items.map((item: POItem, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell data-label={t('sno')}>{idx + 1}</TableCell>
                            <TableCell data-label={t('material')}>{item.materialName}</TableCell>
                            <TableCell data-label={t('qty')}>{item.quantity}</TableCell>
                            <TableCell data-label={t('unit')}>{item.unit ?? '—'}</TableCell>
                            <TableCell data-label={t('unitPrice')}>{formatCurrency(item.unitPrice)}</TableCell>
                            <TableCell data-label={t('gstPct')}>{Number(item.gstRate ?? 0)}%</TableCell>
                            <TableCell data-label={t('colAmount')}>{formatCurrency(item.amount)}</TableCell>
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
              label={t('invoiceNumberLabel')}
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              fullWidth
              size="small"
              helperText={t('invoiceNumberHelp')}
            />
            <TextField
              label={t('invoiceAmount')}
              type="text"
              value={formatIndianNumber(amount)}
              onChange={(e) => setAmount(e.target.value.replace(/,/g, ''))}
              inputMode="decimal"
              inputProps={{ min: 0.01, step: 0.01 }}
              fullWidth
              size="small"
              required
              helperText={selectedPoId ? t('autoFilledPoTotal') : t('enterInvoiceAmount')}
              InputProps={selectedPoId ? { readOnly: true } : undefined}
            />
            <TextField
              label={t('taxAmountGst')}
              type="text"
              value={formatIndianNumber(taxAmount)}
              onChange={(e) => setTaxAmount(e.target.value.replace(/,/g, ''))}
              inputMode="decimal"
              inputProps={{ min: 0, step: 0.01 }}
              fullWidth
              size="small"
              helperText={selectedPoId ? t('autoFilledPoGst') : t('enterGstAmount')}
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
                  helperText={t('autoCalculated')}
                />
                <TextField
                  label="SGST"
                  value={formatIndianNumber(sgstAmount)}
                  size="small"
                  InputProps={{ readOnly: true }}
                  helperText={t('autoCalculated')}
                />
                <TextField
                  label="IGST"
                  value={formatIndianNumber(igstAmount)}
                  size="small"
                  InputProps={{ readOnly: true }}
                  helperText={t('autoCalculated')}
                />
              </Box>
            )}
            <TextField
              label={t('totalAmountLabel')}
              type="text"
              value={formatIndianNumber(totalAmount)}
              inputMode="decimal"
              fullWidth
              size="small"
              required
              InputProps={{ readOnly: true }}
              helperText={t('autoCalculated')}
            />

            {/* Advance Paid */}
            <Box>
              <Button
                size="small"
                onClick={() => { setHasAdvance(!hasAdvance); if (hasAdvance) { setAdvancePaid(''); setAdvanceType(''); setAdvanceOtherType(''); } }}
                variant={hasAdvance ? 'contained' : 'outlined'}
                color={hasAdvance ? 'primary' : 'inherit'}
              >
                {hasAdvance ? t('advancePaidBtn') : t('addAdvance')}
              </Button>
              {hasAdvance && (
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, mt: 1, flexWrap: 'wrap' }}>
                  <TextField
                    label={t('advanceAmount')}
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
                    label={t('paymentType')}
                    value={advanceType}
                    onChange={(e) => setAdvanceType(e.target.value)}
                    size="small"
                    sx={{ flex: 1, minWidth: 0 }}
                  >
                    {ADVANCE_TYPES.map((at) => <MenuItem key={at} value={at}>{t(`advanceTypes.${at}`, at)}</MenuItem>)}
                  </TextField>
                  {advanceType === 'Other' && (
                    <TextField
                      label={t('specifyOther')}
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
              label={t('deliveryDate')}
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              size="small"
              sx={{ width: { xs: '100%', sm: 250 } }}
              InputLabelProps={{ shrink: true }}
            />

            {/* File Upload */}
            <Box>
              <FilePicker
                file={selectedFile}
                onChange={setSelectedFile}
                accept="image/*,application/pdf"
                startIcon={<AddIcon />}
                label={t('uploadInvoiceFile')}
                selectedLabel={selectedFile ? `✓ ${selectedFile.name}` : undefined}
              />
              <OcrAutoFill
                file={selectedFile}
                documentType="INVOICE"
                onExtract={handleOcrExtract}
              />
            </Box>
            <AcknowledgementCheckbox
              checked={acknowledged}
              onChange={setAcknowledged}
              entityLabel={t('entityInvoice')}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => { setCreateOpen(false); resetForm(); }}>{t('cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => { setError(''); if (validateInvoiceForm()) createMutation.mutate(); }}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? <CircularProgress size={20} /> : t('createInvoice')}
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
            <strong>{t('approvedPopupTitle', { code: approvalPopup?.invoiceCode })}</strong>
          </Typography>
          <Typography variant="caption">
            {t('approvedPopupLine', { vendor: approvalPopup?.vendor?.name, total: approvalPopup ? formatCurrency(approvalPopup.totalAmount) : '' })}
          </Typography>
          <Typography variant="caption" display="block">
            {t('approvedPopupNote')}
          </Typography>
        </Alert>
      </Snackbar>

      <ApprovalActionDialog
        open={approvalAction !== null}
        action={approvalAction?.action ?? 'approve'}
        entityLabel={t('entityInvoiceCap')}
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
        <DialogTitle>{t('deleteTitle')}</DialogTitle>
        <DialogContent>
          <Typography><Trans t={t} i18nKey="deleteConfirm" values={{ n: deleteRow?.invoiceCode }} components={{ b: <strong /> }} /></Typography>
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

      {/* Cross-module link dialog — shows PO → quotation → payments → ledger → settlements */}
      <ResponsiveDialog open={crossLinkRow !== null} onClose={() => setCrossLinkRow(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {t('crossTitle', { n: crossLinkRow?.invoiceCode })}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {t('crossChain')}
          </Typography>
        </DialogTitle>
        <DialogContent>
          {crossLinkLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>
          ) : crossLinkData ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Summary */}
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip label={t('chipTotal', { v: formatIndianNumber(crossLinkData.summary.totalAmount) })} color="default" />
                <Chip label={t('chipPaid', { v: formatIndianNumber(crossLinkData.summary.totalPaid) })} color="success" />
                <Chip label={t('chipSettled', { v: formatIndianNumber(crossLinkData.summary.totalSettled) })} color="primary" />
                <Chip label={t('chipOutstanding', { v: formatIndianNumber(crossLinkData.summary.outstanding) })} color="error" />
                <Chip label={crossLinkData.summary.isPostedToBooks ? t('postedToBooks') : t('notPosted')} color={crossLinkData.summary.isPostedToBooks ? 'success' : 'warning'} variant="outlined" />
              </Box>

              {/* Vendor */}
              {crossLinkData.vendor && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="subtitle2">{t('vendorHeading', { name: crossLinkData.vendor.name, code: crossLinkData.vendor.vendorCode })}</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    {crossLinkData.vendorLedger ? (
                      <Typography variant="body2">
                        <Trans t={t} i18nKey="ledgerLine" values={{ name: crossLinkData.vendorLedger.name, v: formatIndianNumber(crossLinkData.vendorLedger.currentBalance) }} components={{ b: <strong /> }} />
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">{t('noVendorLedger')}</Typography>
                    )}
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Purchase Order + Quotation */}
              {crossLinkData.purchaseOrder && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="subtitle2">{t('poHeading', { n: crossLinkData.purchaseOrder.poNumber })}</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Typography variant="body2">{t('dateLine', { d: formatDate(crossLinkData.purchaseOrder.date) })}</Typography>
                    <Typography variant="body2">{t('totalLine', { v: formatIndianNumber(crossLinkData.purchaseOrder.grandTotal) })}</Typography>
                    <Typography variant="body2">{t('statusLine', { s: enumLabel(crossLinkData.purchaseOrder.status) })}</Typography>
                    <Typography variant="body2">{t('paymentTypeLine', { s: enumLabel(crossLinkData.purchaseOrder.paymentType) })}</Typography>
                    {crossLinkData.budgetHead && (
                      <Typography variant="body2">{t('budgetHeadLine')} <Chip label={crossLinkData.budgetHead.particulars} size="small" color="primary" /></Typography>
                    )}
                    {crossLinkData.quotation && (
                      <Box sx={{ mt: 1, p: 1, bgcolor: 'background.paper', border: '1px dashed #ccc' }}>
                        <Typography variant="caption" color="text.secondary">{t('sourceQuotation')}</Typography>
                        <Typography variant="body2">{crossLinkData.quotation.quotationNumber} — ₹{formatIndianNumber(crossLinkData.quotation.totalAmount)} ({formatDate(crossLinkData.quotation.date)})</Typography>
                      </Box>
                    )}
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Payment Requests */}
              {crossLinkData.paymentRequests?.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="subtitle2">{t('paymentRequestsHeading', { n: crossLinkData.paymentRequests.length })}</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('code')}</TableCell>
                          <TableCell>{t('type')}</TableCell>
                          <TableCell align="right">{t('amount')}</TableCell>
                          <TableCell>{t('status')}</TableCell>
                          <TableCell>{t('payments')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {crossLinkData.paymentRequests.map((pr: any) => (
                          <TableRow key={pr.id}>
                            <TableCell>{pr.paymentCode}</TableCell>
                            <TableCell>{enumLabel(pr.type)}</TableCell>
                            <TableCell align="right">₹{formatIndianNumber(pr.amount)}</TableCell>
                            <TableCell><Chip label={enumLabel(pr.status)} size="small" color={pr.status === 'PAID' ? 'success' : 'default'} /></TableCell>
                            <TableCell>
                              {pr.payments?.map((p: any) => (
                                <Typography key={p.id} variant="caption" display="block">
                                  {t('paidVia', { amount: formatIndianNumber(p.amount), mode: enumLabel(p.mode), ref: p.reference ? `(${p.reference})` : '', date: formatDate(p.date) })}
                                </Typography>
                              ))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Purchase Voucher (ledger postings) */}
              {crossLinkData.purchaseVoucher && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="subtitle2">{t('ledgerPosting', { n: crossLinkData.purchaseVoucher.jvNumber })}</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('ledger')}</TableCell>
                          <TableCell>{t('group')}</TableCell>
                          <TableCell align="right">{t('debit')}</TableCell>
                          <TableCell align="right">{t('credit')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {crossLinkData.purchaseVoucher.entries.map((e: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell>{e.ledgerName}</TableCell>
                            <TableCell>{enumLabel(e.ledgerGroup)}</TableCell>
                            <TableCell align="right" sx={{ color: 'error.main' }}>{e.debit > 0 ? formatCurrency(e.debit) : '—'}</TableCell>
                            <TableCell align="right" sx={{ color: 'success.main' }}>{e.credit > 0 ? formatCurrency(e.credit) : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Bill Settlements */}
              {crossLinkData.billSettlements?.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="subtitle2">{t('billSettlements', { n: crossLinkData.billSettlements.length })}</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('voucher')}</TableCell>
                          <TableCell>{t('type')}</TableCell>
                          <TableCell>{t('date')}</TableCell>
                          <TableCell align="right">{t('amount')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {crossLinkData.billSettlements.map((bs: any) => (
                          <TableRow key={bs.id}>
                            <TableCell>{bs.voucher.jvNumber}</TableCell>
                            <TableCell>{enumLabel(bs.voucher.voucherType)}</TableCell>
                            <TableCell>{formatDate(bs.voucher.date)}</TableCell>
                            <TableCell align="right">₹{formatIndianNumber(bs.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Gate Passes */}
              {crossLinkData.gatePasses?.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="subtitle2">{t('gatePasses', { n: crossLinkData.gatePasses.length })}</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    {crossLinkData.gatePasses.map((gp: any) => (
                      <Typography key={gp.id} variant="body2">
                        {gp.passNumber} — {formatDate(gp.date)} — <Chip label={enumLabel(gp.status)} size="small" />
                      </Typography>
                    ))}
                  </AccordionDetails>
                </Accordion>
              )}
            </Box>
          ) : (
            <Typography color="text.secondary">{t('noData')}</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCrossLinkRow(null)}>{t('close')}</Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
