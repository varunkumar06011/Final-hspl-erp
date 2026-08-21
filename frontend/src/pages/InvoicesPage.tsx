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
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Download as DownloadIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { InvoiceVerificationStatus, PaymentStatus, StockStatus, UserRole } from '@hospital-erp/shared';
import { formatCurrency, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { downloadFile } from '../utils/file';
import AcknowledgementCheckbox from '../components/AcknowledgementCheckbox';
import ApprovalActionDialog from '../components/ApprovalActionDialog';
import OcrAutoFill, { type OcrInvoiceData } from '../components/OcrAutoFill';
import ResponsiveTable from '../components/ResponsiveTable';

interface POItem {
  id?: string;
  materialName: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  amount: number;
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
  purchaseOrder: { id: string; poNumber: string; items: POItem[] } | null;
  date: string;
  amount: number;
  taxAmount: number;
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

  // Fetch approved POs for the selected vendor
  const { data: approvedPOs } = useQuery({
    queryKey: ['/pos', 'approved', selectedVendorId],
    queryFn: async () => {
      if (!selectedVendorId) return [];
      const response = await api.get('/purchase-orders', { params: { vendorId: selectedVendorId, status: 'APPROVED', pageSize: 100 } });
      return response.data?.data ?? [];
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
    } else {
      setAmount('');
      setTaxAmount('');
      setTotalAmount('');
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

  const markPaymentPaidMutation = useMutation({
    mutationFn: async (invId: string) => {
      const response = await api.post(`/invoices/${invId}/mark-payment-paid`);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/inventory'] });
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      if (data?.inventoryWarning) {
        setError(data.inventoryWarning);
      } else {
        setSuccessMsg('Payment marked as paid.');
        setTimeout(() => setSuccessMsg(''), 5000);
      }
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ invId, paymentStatus, stockStatus }: { invId: string; paymentStatus?: string; stockStatus?: string }) => {
      const response = await api.patch(`/invoices/${invId}/status`, { paymentStatus, stockStatus });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/inventory'] });
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      if (data?.inventoryWarning) {
        setError(data.inventoryWarning);
      } else {
        setSuccessMsg('Status updated.');
        setTimeout(() => setSuccessMsg(''), 5000);
      }
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: InvoiceRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const vendors: { id: string; name: string; vendorCode: string }[] = vendorsData?.data ?? [];

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
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Invoice Code</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Invoice No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>PO</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Tax</TableCell>
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
                <TableRow><TableCell colSpan={13} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={13} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No invoices found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell data-label="Invoice Code">{row.invoiceCode}</TableCell>
                    <TableCell data-label="Invoice No">{row.invoiceNumber}</TableCell>
                    <TableCell data-label="Vendor">{row.vendor?.vendorCode} - {row.vendor?.name ?? '—'}</TableCell>
                    <TableCell data-label="PO">{row.purchaseOrder?.poNumber ?? '—'}</TableCell>
                    <TableCell data-label="Amount">{formatCurrency(row.amount)}</TableCell>
                    <TableCell data-label="Tax">{formatCurrency(row.taxAmount)}</TableCell>
                    <TableCell data-label="Total">{formatCurrency(row.totalAmount)}</TableCell>
                    <TableCell data-label="Advance">
                      {Number(row.advancePaid) > 0
                        ? `${formatCurrency(row.advancePaid)} (${row.advanceType === 'Other' ? row.advanceOtherType : row.advanceType})`
                        : '—'}
                    </TableCell>
                    <TableCell data-label="Payment">
                      <TextField
                        select
                        size="small"
                        value={row.paymentStatus}
                        onChange={(e) => {
                          const newStatus = e.target.value;
                          if (newStatus === PaymentStatus.PAID) {
                            markPaymentPaidMutation.mutate(row.id);
                          } else {
                            updateStatusMutation.mutate({ invId: row.id, paymentStatus: newStatus });
                          }
                        }}
                        sx={{ minWidth: 140 }}
                        disabled={row.verificationStatus !== InvoiceVerificationStatus.VERIFIED || updateStatusMutation.isPending || markPaymentPaidMutation.isPending}
                      >
                        <MenuItem value={PaymentStatus.PENDING}>Payment Pending</MenuItem>
                        <MenuItem value={PaymentStatus.PAID}>Paid</MenuItem>
                        <MenuItem value={PaymentStatus.DELAYED}>Delayed</MenuItem>
                        <MenuItem value={PaymentStatus.OTHER}>Other</MenuItem>
                      </TextField>
                    </TableCell>
                    <TableCell data-label="Stock">
                      <TextField
                        select
                        size="small"
                        value={row.stockStatus}
                        onChange={(e) => updateStatusMutation.mutate({ invId: row.id, stockStatus: e.target.value })}
                        sx={{ minWidth: 130 }}
                        disabled={row.verificationStatus !== InvoiceVerificationStatus.VERIFIED || updateStatusMutation.isPending}
                      >
                        <MenuItem value={StockStatus.PENDING}>Yet to Start</MenuItem>
                        <MenuItem value={StockStatus.ON_THE_WAY}>On the Way</MenuItem>
                        <MenuItem value={StockStatus.RECEIVED}>Received</MenuItem>
                      </TextField>
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
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Step</TableCell>
                      <TableCell>Approver Role</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Approver</TableCell>
                      <TableCell>Comments</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {row.approvalWorkflow!.steps.map((step) => (
                      <TableRow key={step.id}>
                        <TableCell>{step.stepNumber}</TableCell>
                        <TableCell>{step.approverRole.replace(/_/g, ' ')}</TableCell>
                        <TableCell><Chip label={step.status} size="small" color={step.status === 'APPROVED' ? 'success' : step.status === 'REJECTED' ? 'error' : 'default'} /></TableCell>
                        <TableCell>{step.approverUser?.name ?? '—'}</TableCell>
                        <TableCell>{step.comments ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      )}

      {/* Create Invoice Dialog */}
      <ResponsiveDialog open={createOpen} onClose={() => { setCreateOpen(false); resetForm(); }} maxWidth="md" fullWidth>
        <DialogTitle>Create Vendor Invoice</DialogTitle>
        <DialogContent>
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
                <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>S.no</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Qty</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Unit Price</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedPO.items.map((item: POItem, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell>{idx + 1}</TableCell>
                          <TableCell>{item.materialName}</TableCell>
                          <TableCell>{item.quantity}</TableCell>
                          <TableCell>{item.unit ?? '—'}</TableCell>
                          <TableCell>{formatCurrency(item.unitPrice)}</TableCell>
                          <TableCell>{formatCurrency(item.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
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
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              fullWidth
              size="small"
              required
              helperText={selectedPoId ? 'Auto-filled from PO total' : 'Enter invoice amount'}
              InputProps={selectedPoId ? { readOnly: true } : undefined}
            />
            <TextField
              label="Tax Amount (GST)"
              type="number"
              value={taxAmount}
              onChange={(e) => setTaxAmount(e.target.value)}
              fullWidth
              size="small"
              helperText={selectedPoId && Number(selectedPO?.gstAmount) > 0 ? 'Auto-filled from PO GST' : 'Optional — enter if applicable'}
              InputProps={selectedPoId && Number(selectedPO?.gstAmount) > 0 ? { readOnly: true } : undefined}
            />
            <TextField
              label="Total Amount (Amount + Tax)"
              type="number"
              value={totalAmount}
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
                    type="number"
                    value={advancePaid}
                    onChange={(e) => setAdvancePaid(e.target.value)}
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
        <DialogActions>
          <Button onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => { setError(''); createMutation.mutate(); }}
            disabled={(!selectedVendorId || !amount || !totalAmount || !acknowledged) || createMutation.isPending}
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
    </Box>
  );
}
