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
  MenuItem,
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Check as CheckIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';

interface GatePassItem {
  materialName: string;
  quantity: number;
  unit?: string;
}

interface GatePassRow {
  id: string;
  passNumber: string;
  poId: string;
  invoiceId: string;
  status: string;
  date: string;
  createdBy: string;
  createdByUser: { id: string; name: string };
  purchaseOrder: { id: string; poNumber: string; vendor: { name: string; vendorCode: string }; items: GatePassItem[] };
  invoice: { id: string; invoiceCode: string; invoiceNumber: string };
  items: GatePassItem[];
  otpRequestedForUser: { id: string; name: string; role: string; phone: string } | null;
  otpApprovedByUser: { id: string; name: string } | null;
  otpApprovedAt: string | null;
}

interface ApprovedPO {
  id: string;
  poNumber: string;
  vendor: { name: string; vendorCode: string };
  grandTotal: number;
  items: { materialName: string; quantity: number; unit: string }[];
  invoices: { id: string; invoiceCode: string; invoiceNumber: string; verificationStatus: string; stockStatus: string }[];
}

export default function GatePassesPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [otpDialogOpen, setOtpDialogOpen] = useState<GatePassRow | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [createdOtp, setCreatedOtp] = useState<string | null>(null);
  const [selectedPoId, setSelectedPoId] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [selectedHeadId, setSelectedHeadId] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/gate-passes', page, pageSize, search, statusFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const response = await api.get('/gate-passes', { params });
      return response.data;
    },
  });

  // Fetch approved POs with their verified invoices and items (single backend query)
  const { data: approvedPOs } = useQuery<ApprovedPO[]>({
    queryKey: ['/gate-passes/approved-pos'],
    queryFn: async () => {
      const response = await api.get('/gate-passes/approved-pos');
      return response.data?.data ?? [];
    },
  });

  // Fetch the 4 heads
  const { data: heads } = useQuery({
    queryKey: ['/gate-passes', 'heads'],
    queryFn: async () => {
      const response = await api.get('/gate-passes/heads');
      return response.data?.data ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/gate-passes', {
        poId: selectedPoId,
        invoiceId: selectedInvoiceId,
        otpRequestedFor: selectedHeadId,
      });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/gate-passes'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setCreateOpen(false);
      resetForm();
      setCreatedOtp(data.otpCode);
      setSuccessMsg(`Gate pass created. OTP sent to ${data.otpRequestedForUser?.name}. Get the OTP from them to approve.`);
      setTimeout(() => setSuccessMsg(''), 5000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async ({ id, otp }: { id: string; otp: string }) => {
      const response = await api.post(`/gate-passes/${id}/verify-otp`, { otp });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/gate-passes'] });
      queryClient.invalidateQueries({ queryKey: ['/inventory'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setOtpDialogOpen(null);
      setOtpInput('');
      setSuccessMsg(data.message || 'Gate pass approved! Items added to inventory.');
      setTimeout(() => setSuccessMsg(''), 5000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/gate-passes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/gate-passes'] });
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: GatePassRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  function resetForm() {
    setSelectedPoId('');
    setSelectedInvoiceId('');
    setSelectedHeadId('');
    setError('');
  }

  const selectedPO = approvedPOs?.find((po) => po.id === selectedPoId);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>Gate Passes</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { resetForm(); setCreatedOtp(null); setCreateOpen(true); }}>Create Gate Pass</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      <Card>
        <Box sx={{ p: 2, display: 'flex', gap: 2 }}>
          <TextField
            size="small"
            placeholder="Search gate passes..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: 300 }}
          />
          <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} sx={{ width: 150 }}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="PENDING">Pending</MenuItem>
            <MenuItem value="APPROVED">Approved</MenuItem>
          </TextField>
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Pass Number</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>PO</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Invoice</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Items</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>OTP Sent To</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Approved By</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={10} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No gate passes found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell>{row.passNumber}</TableCell>
                    <TableCell>{row.purchaseOrder?.poNumber ?? '—'}</TableCell>
                    <TableCell>{row.invoice?.invoiceCode ?? '—'}</TableCell>
                    <TableCell>{row.purchaseOrder?.vendor ? `${row.purchaseOrder.vendor.vendorCode} - ${row.purchaseOrder.vendor.name}` : '—'}</TableCell>
                    <TableCell>{row.items?.length ?? 0} item(s)</TableCell>
                    <TableCell>{row.otpRequestedForUser?.name ?? '—'}</TableCell>
                    <TableCell>{row.otpApprovedByUser?.name ?? '—'}</TableCell>
                    <TableCell>{formatDate(row.date)}</TableCell>
                    <TableCell><Chip label={row.status} size="small" color={row.status === 'APPROVED' ? 'success' : 'warning'} /></TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {row.status === 'PENDING' && (
                          <>
                            <Button size="small" variant="outlined" startIcon={<CheckIcon />} onClick={() => { setOtpDialogOpen(row); setOtpInput(''); }}>
                              Enter OTP
                            </Button>
                            <IconButton size="small" color="error" onClick={() => { if (confirm('Delete this gate pass?')) deleteMutation.mutate(row.id); }}><DeleteIcon fontSize="small" /></IconButton>
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

      {/* Create Gate Pass Dialog */}
      <Dialog open={createOpen} onClose={() => { setCreateOpen(false); resetForm(); }} maxWidth="sm" fullWidth>
        <DialogTitle>Create Gate Pass</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              select
              label="Purchase Order (approved)"
              value={selectedPoId}
              onChange={(e) => { setSelectedPoId(e.target.value); setSelectedInvoiceId(''); }}
              fullWidth
              size="small"
              required
              helperText={approvedPOs?.length === 0 ? 'No approved POs with verified invoices available' : undefined}
            >
              {approvedPOs?.map((po) => (
                <MenuItem key={po.id} value={po.id}>{po.poNumber} — {po.vendor.vendorCode} - {po.vendor.name}</MenuItem>
              ))}
            </TextField>

            {selectedPO && (
              <TextField
                select
                label="Invoice (verified)"
                value={selectedInvoiceId}
                onChange={(e) => setSelectedInvoiceId(e.target.value)}
                fullWidth
                size="small"
                required
              >
                {selectedPO.invoices.map((inv) => (
                  <MenuItem key={inv.id} value={inv.id}>{inv.invoiceCode} — {inv.invoiceNumber}</MenuItem>
                ))}
              </TextField>
            )}

            {selectedPO && (
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>PO Items (will be added to inventory on approval)</Typography>
                <TableContainer component={Card} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Qty</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedPO?.items?.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{item.materialName}</TableCell>
                          <TableCell>{item.quantity}</TableCell>
                          <TableCell>{item.unit ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Typography variant="caption" color="text.secondary">Items from the PO will be auto-populated.</Typography>
              </Box>
            )}

            <TextField
              select
              label="Select Head for OTP Approval"
              value={selectedHeadId}
              onChange={(e) => setSelectedHeadId(e.target.value)}
              fullWidth
              size="small"
              required
              helperText="OTP will be sent to this person. They will tell you the OTP by other means."
            >
              {heads?.map((h: { id: string; name: string; role: string }) => (
                <MenuItem key={h.id} value={h.id}>{h.name} ({h.role.replace(/_/g, ' ')})</MenuItem>
              ))}
            </TextField>

            {createdOtp && (
              <Alert severity="info">
                OTP generated: <strong>{createdOtp}</strong> — In production, this will be sent via SMS to the selected head. For now, communicate it to them outside the software.
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => { setError(''); createMutation.mutate(); }}
            disabled={(!selectedPoId || !selectedInvoiceId || !selectedHeadId) || createMutation.isPending}
          >
            {createMutation.isPending ? <CircularProgress size={20} /> : 'Create & Generate OTP'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* OTP Verification Dialog */}
      <Dialog open={!!otpDialogOpen} onClose={() => { setOtpDialogOpen(null); setOtpInput(''); }} maxWidth="xs" fullWidth>
        <DialogTitle>Enter OTP for {otpDialogOpen?.passNumber}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography variant="body2">
              OTP was sent to <strong>{otpDialogOpen?.otpRequestedForUser?.name}</strong>.
              Enter the OTP they provided to approve this gate pass and add items to inventory.
            </Typography>
            <TextField
              label="Enter OTP"
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value)}
              fullWidth
              size="small"
              required
              inputProps={{ maxLength: 6 }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setOtpDialogOpen(null); setOtpInput(''); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (!otpDialogOpen) return;
              setError('');
              verifyOtpMutation.mutate({ id: otpDialogOpen.id, otp: otpInput });
            }}
            disabled={!otpInput || verifyOtpMutation.isPending}
          >
            {verifyOtpMutation.isPending ? <CircularProgress size={20} /> : 'Verify & Approve'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
