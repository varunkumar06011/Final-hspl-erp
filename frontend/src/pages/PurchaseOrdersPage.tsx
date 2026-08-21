import { useState, useMemo, useEffect } from 'react';
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
  Dialog,
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
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Download as DownloadIcon,
  PictureAsPdf as PdfIcon,
  ExpandMore as ExpandMoreIcon,
  LocalShipping as GatePassIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { POStatus, UserRole } from '@hospital-erp/shared';
import { formatCurrency, formatDate, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import AcknowledgementCheckbox from '../components/AcknowledgementCheckbox';
import ApprovalActionDialog from '../components/ApprovalActionDialog';
import ResponsiveTable from '../components/ResponsiveTable';

interface POItem {
  id?: string;
  materialName: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  amount: number;
}

interface Quotation {
  id: string;
  quotationNumber: string;
  totalAmount: number;
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
  quotation: { id: string; quotationNumber: string };
  date: string;
  status: string;
  totalAmount: number;
  gstAmount: number;
  grandTotal: number;
  createdBy: string;
  createdByUser: { id: string; name: string };
  items: POItem[];
  approvalWorkflow?: {
    id: string;
    status: string;
    currentStep: number;
    steps: ApprovalStep[];
  } | null;
}

const HEAD_ROLES = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ADMIN, UserRole.ADMIN_2];

export default function PurchaseOrdersPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedQuotationId, setSelectedQuotationId] = useState('');
  const [gstAmount, setGstAmount] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [approvalAction, setApprovalAction] = useState<{ row: PORow; action: 'approve' | 'reject' } | null>(null);
  const [approvalPopup, setApprovalPopup] = useState<PORow | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const navigate = useNavigate();

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
        gstAmount: gstAmount || undefined,
        acknowledged,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
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

  const rows: PORow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const vendors: { id: string; name: string; vendorCode: string }[] = vendorsData?.data ?? [];

  const quotationTotal = useMemo(() => {
    if (!selectedQuotation?.items) return 0;
    return selectedQuotation.items.reduce((sum, i) => sum + Number(i.amount), 0);
  }, [selectedQuotation]);

  const grandTotal = quotationTotal + (Number(gstAmount) || 0);

  function resetForm() {
    setSelectedVendorId('');
    setSelectedQuotationId('');
    setGstAmount('');
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
          <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
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
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>GST</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Grand Total</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created By</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={10} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No purchase orders found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell data-label="PO No">{row.poNumber}</TableCell>
                    <TableCell data-label="Vendor">{row.vendor?.vendorCode} - {row.vendor?.name ?? '—'}</TableCell>
                    <TableCell data-label="Quotation">{row.quotation?.quotationNumber ?? '—'}</TableCell>
                    <TableCell data-label="Date">{formatDate(row.date)}</TableCell>
                    <TableCell data-label="Total">{formatCurrency(row.totalAmount)}</TableCell>
                    <TableCell data-label="GST">{formatCurrency(row.gstAmount)}</TableCell>
                    <TableCell data-label="Grand Total">{formatCurrency(row.grandTotal)}</TableCell>
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
                        {row.status === POStatus.APPROVED && (
                          <IconButton size="small" color="primary" onClick={() => navigate('/gate-passes')} title="Create Gate Pass"><GatePassIcon fontSize="small" /></IconButton>
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

      {/* Create PO Dialog */}
      <Dialog open={createOpen} onClose={() => { setCreateOpen(false); resetForm(); }} maxWidth="md" fullWidth sx={{ '& .MuiDialog-paper': { margin: { xs: 1 } } }}>
        <DialogTitle>Create Purchase Order</DialogTitle>
        <DialogContent>
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
                onChange={(e) => setSelectedQuotationId(e.target.value)}
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

            {/* Items from quotation (read-only) */}
            {selectedQuotation?.items && selectedQuotation.items.length > 0 && (
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>Items (from quotation)</Typography>
                <TableContainer component={Card} variant="outlined">
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
                      {selectedQuotation.items.map((item, idx) => (
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
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, mt: 1 }}>
                  <Typography variant="body2">Total: <strong>{formatCurrency(quotationTotal)}</strong></Typography>
                  <TextField
                    label="GST Amount (optional)"
                    type="number"
                    value={gstAmount}
                    onChange={(e) => setGstAmount(e.target.value)}
                    size="small"
                    sx={{ width: 200 }}
                  />
                  <Typography variant="body2">Grand Total: <strong>{formatCurrency(grandTotal)}</strong></Typography>
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
            onClick={() => { setError(''); createMutation.mutate(); }}
            disabled={(!selectedVendorId || !selectedQuotationId || !acknowledged) || createMutation.isPending}
          >
            {createMutation.isPending ? <CircularProgress size={20} /> : 'Create PO'}
          </Button>
        </DialogActions>
      </Dialog>

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
    </Box>
  );
}
