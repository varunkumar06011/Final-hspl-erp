import { useState, useRef, useMemo } from 'react';
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
  Stepper,
  Step,
  StepLabel,
  MenuItem,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Share as ShareIcon,
  Send as SendIcon,
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GatePassType } from '@hospital-erp/shared';
import { enumToOptions, formatDate, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import CreatableSelect from '../components/CreatableSelect';
import ResponsiveTable from '../components/ResponsiveTable';

const STEPS = ['Fill Details', 'Select Approver & Send OTP', 'Verify OTP'];

interface GatePassItem {
  description: string;
  quantity: number;
  unit: string;
}

export default function GatePassesPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [items, setItems] = useState<GatePassItem[]>([{ description: '', quantity: 1, unit: 'nos' }]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const photoRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/gate-passes', page, pageSize, search],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      const response = await api.get('/gate-passes', { params });
      return response.data;
    },
  });

  const { data: users } = useQuery({
    queryKey: ['gate-pass-approvers'],
    queryFn: async () => {
      const response = await api.get('/gate-passes/approvers');
      return response.data?.data ?? [];
    },
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: FormData) => {
      const response = await api.post('/gate-passes', payload, { headers: { 'Content-Type': 'multipart/form-data' } });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/gate-passes'] });
      setActiveStep(1); // move to approver/OTP step
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const sendOtpMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/gate-passes/${id}/send-otp`);
      return response.data;
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async ({ id, otp }: { id: string; otp: string }) => {
      const response = await api.post(`/gate-passes/${id}/verify-otp`, { otp });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/gate-passes'] });
      setActiveStep(2);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/gate-passes/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/gate-passes'] }); },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const shareMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.get(`/gate-passes/${id}/whatsapp-link`);
      return response.data;
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  const userOptions = useMemo(() => {
    return ((users as Record<string, unknown>[]) ?? []).map((u) => ({
      value: String(u.id),
      label: String(u.name ?? u.phone),
      secondary: [u.role ? String(u.role).replace(/_/g, ' ') : null, u.phone ? String(u.phone) : null].filter(Boolean).join(' · '),
    }));
  }, [users]);

  const openCreate = () => {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toTimeString().slice(0, 5);
    setForm({
      passNumber: '',
      type: GatePassType.INWARD,
      date: today,
      timeIn: now,
      vendorId: '',
      poId: '',
      invoiceId: '',
      vehicleNumber: '',
      driverName: '',
      driverPhone: '',
      carrierName: '',
      approverId: '',
    });
    setItems([{ description: '', quantity: 1, unit: 'nos' }]);
    setPhotoFile(null);
    setPhotoPreview(null);
    setActiveStep(0);
    setOtp('');
    setEditing(null);
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (row: Record<string, unknown>) => {
    setForm({
      ...row,
      vendorId: (row.vendor as any)?.id ?? '',
      poId: (row.purchaseOrder as any)?.id ?? '',
      invoiceId: (row.invoice as any)?.id ?? '',
      approverId: (row.approver as any)?.id ?? '',
      date: row.date ? new Date(row.date as string).toISOString().split('T')[0] : '',
    });
    setItems((row.items as GatePassItem[]) ?? [{ description: '', quantity: 1, unit: 'nos' }]);
    setPhotoFile(null);
    setPhotoPreview((row.vehiclePhoto as string) ?? null);
    setActiveStep(0);
    setOtp('');
    setEditing(row);
    setError('');
    setDialogOpen(true);
  };

  const buildPayload = () => {
    const payload = new FormData();
    payload.append('passNumber', String(form.passNumber ?? ''));
    payload.append('type', String(form.type ?? GatePassType.INWARD));
    payload.append('date', String(form.date ?? new Date().toISOString().split('T')[0]));
    payload.append('vendorId', String(form.vendorId ?? ''));
    if (form.timeIn) payload.append('timeIn', String(form.timeIn));
    if (form.vehicleNumber) payload.append('vehicleNumber', String(form.vehicleNumber));
    if (form.driverName) payload.append('driverName', String(form.driverName));
    if (form.driverPhone) payload.append('driverPhone', String(form.driverPhone));
    if (form.carrierName) payload.append('carrierName', String(form.carrierName));
    if (form.poId) payload.append('poId', String(form.poId));
    if (form.invoiceId) payload.append('invoiceId', String(form.invoiceId));
    payload.append('approverId', String(form.approverId ?? ''));
    payload.append('items', JSON.stringify(items));
    if (photoFile) payload.append('vehiclePhoto', photoFile);
    return payload;
  };

  const handleCreate = () => {
    if (!form.vendorId || !form.passNumber || !form.approverId) {
      setError('Vendor, Pass Number, and Approver are required');
      return;
    }
    if (items.some((i) => !i.description || !i.unit || i.quantity <= 0)) {
      setError('All material items must have description, quantity, and unit');
      return;
    }
    setError('');
    createMutation.mutate(buildPayload());
  };

  const handleSendOtp = () => {
    if (!editing) {
      setError('Create the Gate Pass first');
      return;
    }
    setError('');
    sendOtpMutation.mutate(editing.id as string);
  };

  const handleVerifyOtp = () => {
    if (!editing) {
      setError('Gate Pass not found');
      return;
    }
    if (!otp.trim()) {
      setError('Enter the OTP');
      return;
    }
    setError('');
    verifyOtpMutation.mutate({ id: editing.id as string, otp });
  };

  const handleShare = async (id: string) => {
    setError('');
    const data = await shareMutation.mutateAsync(id);
    if (data.webLink) {
      // On mobile, try deep link first
      if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        window.location.href = data.mobileLink;
      } else {
        window.open(data.webLink, '_blank');
      }
    }
  };

  const updateItem = (index: number, field: keyof GatePassItem, value: string | number) => {
    const next = [...items];
    (next[index] as any)[field] = value;
    setItems(next);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>Gate Passes</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Gate Pass</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Card>
        <Box sx={{ p: 2 }}>
          <TextField
            size="small"
            placeholder="Search gate passes..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />
        </Box>

        <ResponsiveTable>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Pass #</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Vehicle</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Driver</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No gate passes found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row: Record<string, unknown>) => (
                  <TableRow key={row.id as string} hover>
                    <TableCell data-label="Pass #">{String(row.passNumber ?? '—')}</TableCell>
                    <TableCell data-label="Vendor">{(row.vendor as any)?.name ?? '—'}</TableCell>
                    <TableCell data-label="Vehicle">{String(row.vehicleNumber ?? '—')}</TableCell>
                    <TableCell data-label="Driver">{String(row.driverName ?? '—')}</TableCell>
                    <TableCell data-label="Date">{formatDate(row.date)}</TableCell>
                    <TableCell data-label="Status"><Chip label={String(row.status ?? '')} size="small" color={STATUS_COLORS[String(row.status)] ?? 'default'} /></TableCell>
                    <TableCell data-label="Actions" align="right">
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <IconButton size="small" onClick={() => openEdit(row)}><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" color="error" onClick={() => deleteMutation.mutate(row.id as string)}><DeleteIcon fontSize="small" /></IconButton>
                        <IconButton size="small" color="primary" onClick={() => handleShare(row.id as string)} disabled={row.status !== 'APPROVED' || shareMutation.isPending}>
                          <ShareIcon fontSize="small" />
                        </IconButton>
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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? 'Edit Gate Pass' : 'New Gate Pass'}</DialogTitle>
        <DialogContent>
          <Stepper activeStep={activeStep} sx={{ mb: 2, flexWrap: 'wrap', '& .MuiStepLabel-label': { fontSize: { xs: '0.7rem', sm: '0.875rem' } } }}>
            {STEPS.map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
          </Stepper>

          {activeStep === 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <CreatableSelect label="Vendor Name" required value={String(form.vendorId ?? '')} onChange={(v) => setForm({ ...form, vendorId: v })} optionsEndpoint="/vendors" />
                </Box>
                <TextField label="Vendor ID" value={String(form.vendorId ?? '')} disabled fullWidth size="small" sx={{ flex: 1 }} />
              </Box>
              <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
                <TextField label="Date" type="date" value={String(form.date ?? '')} onChange={(e) => setForm({ ...form, date: e.target.value })} fullWidth size="small" InputLabelProps={{ shrink: true }} />
                <TextField label="Time In" type="time" value={String(form.timeIn ?? '')} onChange={(e) => setForm({ ...form, timeIn: e.target.value })} fullWidth size="small" InputLabelProps={{ shrink: true }} />
              </Box>
              <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
                <TextField label="Pass Number" required value={String(form.passNumber ?? '')} onChange={(e) => setForm({ ...form, passNumber: e.target.value })} fullWidth size="small" />
                <TextField select label="Type" required value={String(form.type ?? GatePassType.INWARD)} onChange={(e) => setForm({ ...form, type: e.target.value })} fullWidth size="small">
                  {enumToOptions(GatePassType).map((opt) => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
                </TextField>
              </Box>
              <TextField label="Vehicle Number" value={String(form.vehicleNumber ?? '')} onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })} fullWidth size="small" />
              <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
                <TextField label="Driver Name" value={String(form.driverName ?? '')} onChange={(e) => setForm({ ...form, driverName: e.target.value })} fullWidth size="small" />
                <TextField label="Driver Phone Number" value={String(form.driverPhone ?? '')} onChange={(e) => setForm({ ...form, driverPhone: e.target.value })} fullWidth size="small" />
              </Box>
              <TextField label="Carrier Name" value={String(form.carrierName ?? '')} onChange={(e) => setForm({ ...form, carrierName: e.target.value })} fullWidth size="small" />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Vehicle/Driver Photo</Typography>
                <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setPhotoFile(f); setPhotoPreview(URL.createObjectURL(f)); }
                }} />
                <Button variant="outlined" size="small" onClick={() => photoRef.current?.click()}>Choose Photo</Button>
                {photoPreview && (
                  <Box component="img" src={photoPreview} sx={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 1, mt: 1 }} />
                )}
              </Box>

              <Typography variant="subtitle2">Materials</Typography>
              {items.map((item, idx) => (
                <Box key={idx} sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, alignItems: { xs: 'stretch', sm: 'center' } }}>
                  <TextField label="Material" value={item.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} fullWidth size="small" sx={{ flex: { sm: 2 } }} />
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <TextField label="Qty" type="number" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))} size="small" sx={{ width: 100 }} />
                    <TextField label="Unit" value={item.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)} size="small" sx={{ width: 120 }} />
                    <Button size="small" color="error" onClick={() => setItems(items.filter((_, i) => i !== idx))}>Remove</Button>
                  </Box>
                </Box>
              ))}
              <Button size="small" onClick={() => setItems([...items, { description: '', quantity: 1, unit: 'nos' }])}>+ Add Material</Button>
            </Box>
          )}

          {activeStep === 1 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
              <CreatableSelect label="Select Approver" required value={String(form.approverId ?? '')} onChange={(v) => setForm({ ...form, approverId: v })} staticOptions={userOptions} />
              <Alert severity="info">OTP will be sent to the approver's registered phone number. Fallback OTP for testing: <strong>1234</strong></Alert>
              <Button
                variant="outlined"
                startIcon={<SendIcon />}
                onClick={handleSendOtp}
                disabled={sendOtpMutation.isPending || !form.approverId}
              >
                {sendOtpMutation.isPending ? <CircularProgress size={16} /> : 'Send OTP'}
              </Button>
              {sendOtpMutation.isSuccess && (
                <Alert severity="success">OTP sent to {(sendOtpMutation.data as any)?.phone ?? 'approver'} (testing fallback: {(sendOtpMutation.data as any)?.otp})</Alert>
              )}
            </Box>
          )}

          {activeStep === 2 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1, alignItems: 'center' }}>
              <CheckCircleIcon color="success" sx={{ fontSize: 64 }} />
              <Typography variant="h6">Gate Pass Approved</Typography>
              <Typography variant="body2" color="text.secondary">You can now share this Gate Pass via WhatsApp.</Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setDialogOpen(false)}>Close</Button>
          {activeStep === 0 && (
            <Button variant="contained" onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? <CircularProgress size={20} /> : 'Create Gate Pass'}
            </Button>
          )}
          {activeStep === 1 && (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField size="small" label="Enter OTP" value={otp} onChange={(e) => setOtp(e.target.value)} sx={{ width: 120 }} />
              <Button variant="contained" onClick={handleVerifyOtp} disabled={verifyOtpMutation.isPending}>Verify OTP</Button>
            </Box>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
