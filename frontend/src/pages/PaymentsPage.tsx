import { useState } from 'react';
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
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Payments as PaymentsIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PaymentMode, PaymentStatus } from '@hospital-erp/shared';
import { enumToOptions, formatCurrency, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import CreatableSelect from '../components/CreatableSelect';
import AttachmentUpload from '../components/AttachmentUpload';

export default function PaymentsPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [payOpen, setPayOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [payForm, setPayForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/payments', page, pageSize, search],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      const response = await api.get('/payments', { params });
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await api.post('/payments', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setCreateOpen(false);
      setForm({});
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const approveMutation = useMutation({
    mutationFn: async ({ stepId, comments }: { stepId: string; comments?: string }) => {
      const response = await api.post(`/payments/steps/${stepId}/approve`, { comments });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ stepId, comments }: { stepId: string; comments: string }) => {
      const response = await api.post(`/payments/steps/${stepId}/reject`, { comments });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/payments'] });
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
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setPayOpen(null);
      setPayForm({});
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  const openCreate = () => {
    setForm({ requestNumber: '', amount: 0, paymentMode: PaymentMode.BANK_TRANSFER });
    setError('');
    setCreateOpen(true);
  };

  const handleCreate = () => {
    if (!form.invoiceId || !form.vendorId || !form.requestNumber || !form.amount) {
      setError('Invoice, vendor, request number, and amount are required');
      return;
    }
    if (Number(form.amount) <= 0) {
      setError('Amount must be greater than zero');
      return;
    }
    setError('');
    createMutation.mutate({
      invoiceId: form.invoiceId,
      vendorId: form.vendorId,
      requestNumber: form.requestNumber,
      amount: Number(form.amount),
      paymentMode: form.paymentMode || undefined,
      notes: form.notes || undefined,
    });
  };

  const handlePay = () => {
    if (!payOpen) return;
    if (!payForm.amount || !payForm.mode) {
      setError('Amount and payment mode are required');
      return;
    }
    if (Number(payForm.amount) <= 0) {
      setError('Payment amount must be greater than zero');
      return;
    }
    setError('');
    payMutation.mutate({
      id: payOpen,
      payload: {
        amount: Number(payForm.amount),
        mode: payForm.mode,
        reference: payForm.reference || undefined,
      },
    });
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>Payments</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Payment Request</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Card>
        <Box sx={{ p: 2 }}>
          <TextField
            size="small"
            placeholder="Search payments..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start">🔍</InputAdornment> }}
            sx={{ width: 300 }}
          />
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Request #</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Invoice</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Workflow</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No payment requests found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row: Record<string, unknown>) => {
                  const workflow = row.approvalWorkflow as Record<string, unknown> | null;
                  const steps = (workflow?.steps as Record<string, unknown>[]) ?? [];
                  const currentStep = steps.find((s) => s.status === 'PENDING');
                  return (
                    <TableRow key={row.id as string} hover>
                      <TableCell>{String(row.requestNumber ?? '—')}</TableCell>
                      <TableCell>{(row.vendor as any)?.name ?? '—'}</TableCell>
                      <TableCell>{(row.invoice as any)?.invoiceNumber ?? '—'}</TableCell>
                      <TableCell>{formatCurrency(row.amount)}</TableCell>
                      <TableCell>
                        <Chip label={String(row.status ?? '')} size="small" color={STATUS_COLORS[String(row.status)] ?? 'default'} />
                      </TableCell>
                      <TableCell>
                        {steps.length > 0 ? (
                          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                            {steps.map((s, i) => (
                              <Chip
                                key={i}
                                label={String(s.stepName ?? `Step ${i + 1}`)}
                                size="small"
                                variant={s.status === 'PENDING' ? 'outlined' : 'filled'}
                                color={s.status === 'APPROVED' ? 'success' : s.status === 'REJECTED' ? 'error' : 'default'}
                              />
                            ))}
                          </Box>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        {currentStep && row.status === PaymentStatus.PENDING && (
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <IconButton size="small" color="success" title="Approve"
                              onClick={() => approveMutation.mutate({ stepId: currentStep.id as string })}>
                              <CheckIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" color="error" title="Reject"
                              onClick={() => {
                                const comments = prompt('Rejection reason:');
                                if (comments) rejectMutation.mutate({ stepId: currentStep.id as string, comments });
                              }}>
                              <CloseIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        )}
                        {row.status === PaymentStatus.APPROVED && (
                          <Button size="small" variant="outlined" startIcon={<PaymentsIcon />}
                            onClick={() => { setPayOpen(row.id as string); setPayForm({ amount: row.amount, mode: PaymentMode.BANK_TRANSFER }); }}>
                            Record Payment
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={pagination.total}
          page={page}
          onPageChange={(_e, p) => setPage(p)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 20, 50]}
        />
      </Card>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Payment Request</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <CreatableSelect label="Vendor" required value={String(form.vendorId ?? '')} onChange={(v) => setForm({ ...form, vendorId: v })} optionsEndpoint="/vendors" />
            <CreatableSelect label="Invoice (must be verified)" required value={String(form.invoiceId ?? '')} onChange={(v) => setForm({ ...form, invoiceId: v })} optionsEndpoint="/invoices" optionLabelKey="invoiceNumber" />
            <TextField label="Request Number" required value={form.requestNumber ?? ''} onChange={(e) => setForm({ ...form, requestNumber: e.target.value })} fullWidth size="small" />
            <TextField label="Amount" type="number" required value={form.amount ?? 0} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} fullWidth size="small" />
            <CreatableSelect label="Payment Mode" value={String(form.paymentMode ?? PaymentMode.BANK_TRANSFER)} onChange={(v) => setForm({ ...form, paymentMode: v })} staticOptions={enumToOptions(PaymentMode)} dropdownType="PAYMENT_MODE" />
            <TextField label="Notes" value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} fullWidth size="small" multiline rows={2} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending ? <CircularProgress size={20} /> : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!payOpen} onClose={() => setPayOpen(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Record Payment</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="Amount" type="number" required value={payForm.amount ?? 0} onChange={(e) => setPayForm({ ...payForm, amount: Number(e.target.value) })} fullWidth size="small" />
            <CreatableSelect label="Payment Mode" required value={String(payForm.mode ?? PaymentMode.BANK_TRANSFER)} onChange={(v) => setPayForm({ ...payForm, mode: v })} staticOptions={enumToOptions(PaymentMode)} dropdownType="PAYMENT_MODE" />
            <TextField label="Reference (cheque no, UPI ID, etc.)" value={payForm.reference ?? ''} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} fullWidth size="small" />
          </Box>

          {payOpen && (
            <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <AttachmentUpload entityType="PAYMENT_REQUEST" entityId={payOpen} />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayOpen(null)}>Cancel</Button>
          <Button variant="contained" onClick={handlePay} disabled={payMutation.isPending}>
            {payMutation.isPending ? <CircularProgress size={20} /> : 'Record Payment'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
