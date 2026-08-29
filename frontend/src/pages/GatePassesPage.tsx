import { useState, useCallback } from 'react';
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
} from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Check as CheckIcon,
  Delete as DeleteIcon,
  Refresh as ResendIcon,
  Download as DownloadIcon,
  PhotoCamera as PhotoCameraIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { auth, isConfigured } from '../config/firebase';
import { formatDate } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveTable from '../components/ResponsiveTable';
import RefreshButton from '../components/RefreshButton';

interface GatePassItem {
  materialName: string;
  quantity: number;
  unit?: string | null;
}

interface GatePassRow {
  id: string;
  passNumber: string;
  gatePassCategory: 'MATERIAL' | 'VISITOR';
  poId: string | null;
  invoiceId: string | null;
  status: string;
  date: string;
  createdBy: string;
  createdByUser: { id: string; name: string };
  purchaseOrder: {
    id: string;
    poNumber: string;
    vendor: { name: string; vendorCode: string };
    items: GatePassItem[];
  } | null;
  invoice: { id: string; invoiceCode: string; invoiceNumber: string } | null;
  items: GatePassItem[];
  otpRequestedForUser: { id: string; name: string; role: string; phone: string } | null;
  otpApprovedByUser: { id: string; name: string } | null;
  otpApprovedAt: string | null;
}

interface ApprovedPO {
  id: string;
  poNumber: string;
  vendor: { name: string; vendorCode: string };
  paymentType: string;
  grandTotal: number;
  items: {
    materialName: string;
    quantity: number;
    orderedQuantity: number;
    receivedQuantity: number;
    inTransitQuantity: number;
    remainingQuantity: number;
    unit: string | null;
  }[];
  invoices: {
    id: string;
    invoiceCode: string;
    invoiceNumber: string;
    verificationStatus: string;
    stockStatus: string;
  }[];
}

interface HeadUser {
  id: string;
  name: string;
  role: string;
  phone: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let confirmationResult: any = null;
let confirmationGatePassId: string | null = null;

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
  const [gatePassCategory, setGatePassCategory] = useState<'MATERIAL' | 'VISITOR'>('MATERIAL');
  const [categoryConfirmed, setCategoryConfirmed] = useState(false);
  const [selectedPoId, setSelectedPoId] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [selectedHeadId, setSelectedHeadId] = useState('');
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [visitDate, setVisitDate] = useState('');
  const [visitTime, setVisitTime] = useState('');
  const [purpose, setPurpose] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverMobile, setDriverMobile] = useState('');
  const [gatePassType, setGatePassType] = useState('NON_RETURNABLE');
  const [remarks, setRemarks] = useState('');
  const [photoProof, setPhotoProof] = useState<File | null>(null);
  const [createdGatePass, setCreatedGatePass] = useState<{ id: string; passNumber: string } | null>(
    null,
  );
  const [sendingOtp, setSendingOtp] = useState(false);
  const [resendingOtp, setResendingOtp] = useState(false);
  const [deleteRow, setDeleteRow] = useState<GatePassRow | null>(null);
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

  const { data: approvedPOs } = useQuery<ApprovedPO[]>({
    queryKey: ['/gate-passes/approved-pos'],
    queryFn: async () => {
      const response = await api.get('/gate-passes/approved-pos');
      return response.data?.data ?? [];
    },
  });

  const { data: heads } = useQuery<HeadUser[]>({
    queryKey: ['/gate-passes', 'heads'],
    queryFn: async () => {
      const response = await api.get('/gate-passes/heads');
      return response.data?.data ?? [];
    },
  });

  const setupRecaptcha = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).recaptchaVerifier) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).recaptchaVerifier.clear();
      } catch {
        // ignore
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).recaptchaVerifier = null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).recaptchaVerifier = new RecaptchaVerifier(
      auth!,
      'recaptcha-container-gatepass',
      { size: 'invisible' },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).recaptchaVerifier;
  }, []);

  const sendFirebaseOtp = useCallback(
    async (phone: string, gatePassId?: string): Promise<boolean> => {
      if (!isConfigured || !auth) {
        setError('Firebase is not configured. Cannot send OTP.');
        return false;
      }
      setSendingOtp(true);
      try {
        const appVerifier = setupRecaptcha();
        confirmationResult = await signInWithPhoneNumber(auth, phone, appVerifier);
        if (gatePassId) confirmationGatePassId = gatePassId;
        return true;
      } catch (err: unknown) {
        setError(extractErrorMessage(err));
        return false;
      } finally {
        setSendingOtp(false);
      }
    },
    [setupRecaptcha],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = new FormData();
      payload.append('gatePassCategory', gatePassCategory);
      if (gatePassCategory === 'MATERIAL') {
        payload.append('poId', selectedPoId);
        if (selectedInvoiceId) payload.append('invoiceId', selectedInvoiceId);
      }
      payload.append('otpRequestedFor', selectedHeadId);
      if (gatePassCategory === 'VISITOR') {
        if (visitorName) payload.append('visitorName', visitorName);
        if (visitorPhone) payload.append('visitorPhone', visitorPhone);
        if (visitDate) payload.append('visitDate', visitDate);
        if (visitTime) payload.append('visitTime', visitTime);
        if (purpose) payload.append('purpose', purpose);
      } else {
        payload.append('vehicleType', vehicleType);
        if (vehicleNumber.trim()) payload.append('vehicleNumber', vehicleNumber.trim().toUpperCase());
        if (driverName) payload.append('driverName', driverName);
        if (driverMobile) payload.append('driverMobile', driverMobile);
        payload.append('gatePassType', gatePassType);
      }
      if (remarks) payload.append('remarks', remarks);
      if (photoProof) payload.append('photoProof', photoProof);
      const response = await api.post('/gate-passes', payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['/gate-passes'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setCreateOpen(false);
      setCreatedGatePass({ id: data.id, passNumber: data.passNumber });
      resetForm();
      setSuccessMsg(
        `Gate pass ${data.passNumber} created. Sending OTP to ${data.headName} at ${data.headPhone}...`,
      );
      // Send Firebase OTP to the head's phone
      const sent = await sendFirebaseOtp(data.headPhone, data.id);
      if (sent) {
        setSuccessMsg(
          `OTP sent to ${data.headName} at ${data.headPhone}. Get the OTP from them and click "Enter OTP" to approve.`,
        );
      } else {
        setError(
          `Gate pass created but OTP could not be sent. Click "Enter OTP" then "Resend OTP" to try again.`,
        );
      }
      setTimeout(() => setSuccessMsg(''), 8000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async ({ id, idToken }: { id: string; idToken: string }) => {
      const response = await api.post(`/gate-passes/${id}/verify-otp`, { idToken });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/gate-passes'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setOtpDialogOpen(null);
      setOtpInput('');
      confirmationResult = null;
      confirmationGatePassId = null;
      setSuccessMsg(data.message || 'Gate pass approved. Inventory has not been updated.');
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
      setDeleteRow(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: GatePassRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  function resetForm() {
    setGatePassCategory('MATERIAL');
    setCategoryConfirmed(false);
    setSelectedPoId('');
    setSelectedInvoiceId('');
    setSelectedHeadId('');
    setVisitorName('');
    setVisitorPhone('');
    setVisitDate('');
    setVisitTime('');
    setPurpose('');
    setVehicleType('');
    setVehicleNumber('');
    setDriverName('');
    setDriverMobile('');
    setGatePassType('NON_RETURNABLE');
    setRemarks('');
    setPhotoProof(null);
    setError('');
  }

  const selectedPO = approvedPOs?.find((po) => po.id === selectedPoId);

  async function downloadGatePassPdf(id: string, passNumber?: string) {
    try {
      const response = await api.get(`/gate-passes/${id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${passNumber ?? 'gate-pass'}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  async function handleVerifyOtp() {
    if (!otpDialogOpen) return;
    setError('');
    // Check if we have a valid confirmationResult for this specific gate pass
    if (!confirmationResult || confirmationGatePassId !== otpDialogOpen.id) {
      setError(
        'No OTP has been sent for this gate pass yet. Click "Resend OTP" to send an OTP to the head\'s phone.',
      );
      return;
    }
    try {
      const userCredential = await confirmationResult.confirm(otpInput);
      const idToken = await userCredential.user.getIdToken();
      verifyOtpMutation.mutate({ id: otpDialogOpen.id, idToken });
    } catch (err: unknown) {
      setError(extractErrorMessage(err) || 'Invalid OTP. Please try again.');
    }
  }

  async function handleResendOtp() {
    if (!otpDialogOpen?.otpRequestedForUser?.phone) return;
    setResendingOtp(true);
    setError('');
    const sent = await sendFirebaseOtp(otpDialogOpen.otpRequestedForUser.phone, otpDialogOpen.id);
    if (sent) {
      setSuccessMsg(
        `OTP resent to ${otpDialogOpen.otpRequestedForUser.name} at ${otpDialogOpen.otpRequestedForUser.phone}.`,
      );
      setTimeout(() => setSuccessMsg(''), 5000);
    }
    setResendingOtp(false);
  }

  return (
    <Box>
      <div id="recaptcha-container-gatepass" />

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
          flexWrap: 'wrap',
        }}
      >
        <Typography
          variant="h5"
          fontWeight={600}
          sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}
        >
          Gate Passes
        </Typography>
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            flexWrap: 'wrap',
            justifyContent: { xs: 'flex-end', md: 'flex-end' },
            width: { xs: '100%', md: 'auto' },
          }}
        >
          <RefreshButton onClick={() => refetch()} />
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              resetForm();
              setCreateOpen(true);
            }}
          >
            Create Gate Pass
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {successMsg && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>
          {successMsg}
        </Alert>
      )}
      {createdGatePass && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={<DownloadIcon />}
              onClick={() => downloadGatePassPdf(createdGatePass.id, createdGatePass.passNumber)}
            >
              Download PDF
            </Button>
          }
        >
          Gate Pass {createdGatePass.passNumber} is ready to download. OTP approval is separate.
        </Alert>
      )}

      <Card>
        <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="Search gate passes..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />
          <TextField
            select
            size="small"
            label="Status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            sx={{ width: 150 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="PENDING">Pending</MenuItem>
            <MenuItem value="APPROVED">Approved</MenuItem>
          </TextField>
        </Box>

        <ResponsiveTable>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Pass Number</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
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
                  <TableRow>
                    <TableCell colSpan={11} align="center" sx={{ py: 4 }}>
                      <CircularProgress size={32} />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">No gate passes found</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell data-label="Pass Number">{row.passNumber}</TableCell>
                      <TableCell data-label="Type"><Chip size="small" label={row.gatePassCategory === 'VISITOR' ? 'Visitor' : 'Material'} color={row.gatePassCategory === 'VISITOR' ? 'info' : 'default'} /></TableCell>
                      <TableCell data-label="PO">{row.purchaseOrder?.poNumber ?? '—'}</TableCell>
                      <TableCell data-label="Invoice">{row.invoice?.invoiceCode ?? '—'}</TableCell>
                      <TableCell data-label="Vendor">
                        {row.purchaseOrder?.vendor
                          ? `${row.purchaseOrder.vendor.vendorCode} - ${row.purchaseOrder.vendor.name}`
                          : '—'}
                      </TableCell>
                      <TableCell data-label="Items">{row.items?.length ?? 0} item(s)</TableCell>
                      <TableCell data-label="OTP Sent To">
                        {row.otpRequestedForUser?.name ?? '—'}
                      </TableCell>
                      <TableCell data-label="Approved By">
                        {row.otpApprovedByUser?.name ?? '—'}
                      </TableCell>
                      <TableCell data-label="Date">{formatDate(row.date)}</TableCell>
                      <TableCell data-label="Status">
                        <Chip
                          label={row.status}
                          size="small"
                          color={row.status === 'APPROVED' ? 'success' : row.status === 'DELIVERED' ? 'info' : 'warning'}
                        />
                      </TableCell>
                      <TableCell data-label="Actions">
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <IconButton
                            size="small"
                            title="Download PDF"
                            onClick={() => downloadGatePassPdf(row.id, row.passNumber)}
                          >
                            <DownloadIcon fontSize="small" />
                          </IconButton>
                          {row.status === 'PENDING' && (
                            <>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<CheckIcon />}
                                onClick={() => {
                                  setOtpDialogOpen(row);
                                  setOtpInput('');
                                }}
                              >
                                Enter OTP
                              </Button>
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => setDeleteRow(row)}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
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
          onRowsPerPageChange={(e) => {
            setPageSize(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 20, 50]}
          sx={{ '& .MuiTablePagination-toolbar': { flexWrap: 'wrap' } }}
        />
      </Card>

      {/* Create Gate Pass Dialog */}
      <ResponsiveDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          resetForm();
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Gate Pass</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {!categoryConfirmed ? (
              <TextField
                select
                label="Which gate pass do you need?"
                value=""
                onChange={(e) => {
                  setGatePassCategory(e.target.value as 'MATERIAL' | 'VISITOR');
                  setCategoryConfirmed(true);
                }}
                fullWidth
                size="small"
              >
                <MenuItem value="MATERIAL">Material Delivery Gate Pass</MenuItem>
                <MenuItem value="VISITOR">Visitor Gate Pass</MenuItem>
              </TextField>
            ) : <>
            <Typography variant="body2" color="text.secondary">
              {gatePassCategory === 'MATERIAL' ? 'Material Delivery Gate Pass' : 'Visitor Gate Pass'}
            </Typography>
            {gatePassCategory === 'MATERIAL' && <>
            <TextField
              select
              label="Purchase Order (approved)"
              value={selectedPoId}
              onChange={(e) => {
                const poId = e.target.value;
                setSelectedPoId(poId);
                setSelectedInvoiceId('');
              }}
              fullWidth
              size="small"
              required
              helperText={approvedPOs?.length === 0 ? 'No approved POs available' : undefined}
            >
              {approvedPOs?.map((po) => (
                <MenuItem key={po.id} value={po.id}>
                  {po.poNumber} — {po.vendor.vendorCode} - {po.vendor.name}
                </MenuItem>
              ))}
            </TextField>

            {selectedPO && selectedPO.invoices.length > 0 && (
              <TextField
                select
                label="Invoice (optional)"
                value={selectedInvoiceId}
                onChange={(e) => setSelectedInvoiceId(e.target.value)}
                fullWidth
                size="small"
                helperText="Attach a verified invoice if available — can be added later at goods receipt"
              >
                <MenuItem value="">— None —</MenuItem>
                {selectedPO.invoices.map((inv) => (
                  <MenuItem key={inv.id} value={inv.id}>
                    {inv.invoiceCode} — {inv.invoiceNumber}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {selectedPO && selectedPO.invoices.length === 0 && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                No invoice attached — you can create and attach one later if needed.
              </Alert>
            )}

            {selectedPO && (
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                  PO Items — expected delivery (actual quantities will be entered at goods receipt)
                </Typography>
                <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Ordered</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Accepted</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>In Transit</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Expected</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedPO.items?.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{item.materialName}</TableCell>
                          <TableCell>{item.orderedQuantity}</TableCell>
                          <TableCell>{item.receivedQuantity}</TableCell>
                          <TableCell>{item.inTransitQuantity ?? 0}</TableCell>
                          <TableCell>{item.remainingQuantity}</TableCell>
                          <TableCell>{item.unit ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Typography variant="caption" color="text.secondary">
                  Accepted = quantity inspected and posted to inventory. In Transit = approved gate pass but not yet inspected. Expected = remaining quantity to be delivered. Actual delivered quantities will be recorded when creating the goods receipt.
                </Typography>
              </Box>
            )}
            </>}

            <Typography variant="subtitle2" sx={{ mt: 1 }}>
              {gatePassCategory === 'VISITOR' ? 'Visitor details' : 'Vehicle details'}
            </Typography>
            <Box
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}
            >
              {gatePassCategory === 'VISITOR' && <>
              <TextField
                label="Visitor / person name"
                value={visitorName}
                required={gatePassCategory === 'VISITOR'}
                onChange={(e) => setVisitorName(e.target.value)}
                size="small"
              />
              <TextField
                label="Visitor phone"
                value={visitorPhone}
                onChange={(e) => setVisitorPhone(e.target.value)}
                size="small"
              />
              <TextField
                label="Visit date"
                type="date"
                value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
                size="small"
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Visit time"
                type="time"
                value={visitTime}
                onChange={(e) => setVisitTime(e.target.value)}
                size="small"
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                size="small"
              />
              </>}
              {gatePassCategory === 'MATERIAL' && <>
              <TextField
                select
                label="Vehicle type"
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value)}
                size="small"
                required
              >
                <MenuItem value="LORRY">Lorry</MenuItem>
                <MenuItem value="TRUCK">Truck</MenuItem>
                <MenuItem value="MINI_TRUCK">Mini Truck</MenuItem>
                <MenuItem value="TRAILER">Trailer</MenuItem>
                <MenuItem value="CAR">Car</MenuItem>
                <MenuItem value="BIKE">Bike</MenuItem>
                <MenuItem value="AUTO">Auto</MenuItem>
                <MenuItem value="VAN">Van</MenuItem>
                <MenuItem value="OTHER">Other</MenuItem>
              </TextField>
              <TextField
                label="Vehicle number"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                size="small"
                helperText="Example: AP39AB1234"
                inputProps={{ maxLength: 20 }}
              />
              <TextField
                label="Driver name"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                size="small"
              />
              <TextField
                label="Driver mobile"
                value={driverMobile}
                onChange={(e) => setDriverMobile(e.target.value)}
                size="small"
              />
              <TextField
                select
                label="Gate pass type"
                value={gatePassType}
                onChange={(e) => setGatePassType(e.target.value)}
                size="small"
              >
                <MenuItem value="NON_RETURNABLE">Non-returnable</MenuItem>
                <MenuItem value="RETURNABLE">Returnable</MenuItem>
              </TextField>
              </>}
              <TextField
                label="Remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                size="small"
                multiline
                minRows={1}
              />
            </Box>
            <Button
              component="label"
              variant="outlined"
              startIcon={<PhotoCameraIcon />}
              size="small"
              sx={{ alignSelf: 'flex-start' }}
            >
              {photoProof ? `Photo: ${photoProof.name}` : 'Add photo proof (optional)'}
              <input
                hidden
                type="file"
                accept="image/*"
                onChange={(e) => setPhotoProof(e.target.files?.[0] ?? null)}
              />
            </Button>

            <TextField
              select
              label="Select Head for OTP Approval"
              value={selectedHeadId}
              onChange={(e) => setSelectedHeadId(e.target.value)}
              fullWidth
              size="small"
              required
              helperText="A real OTP will be sent to this person's phone via Firebase. They will tell you the OTP."
            >
              {heads?.map((h) => (
                <MenuItem key={h.id} value={h.id}>
                  {h.name} ({h.role.replace(/_/g, ' ')}) — {h.phone}
                </MenuItem>
              ))}
            </TextField>
            </>}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setCreateOpen(false);
              resetForm();
            }}
          >
            Cancel
          </Button>
          {categoryConfirmed && <Button
            variant="contained"
            onClick={() => {
              setError('');
              createMutation.mutate();
            }}
            disabled={
              !selectedHeadId ||
              (gatePassCategory === 'MATERIAL' && !selectedPoId) ||
              (gatePassCategory === 'VISITOR' && !visitorName.trim()) ||
              createMutation.isPending ||
              sendingOtp
            }
          >
            {createMutation.isPending || sendingOtp ? (
              <CircularProgress size={20} />
            ) : (
              'Create & Send OTP'
            )}
          </Button>}
        </DialogActions>
      </ResponsiveDialog>

      {/* OTP Verification Dialog */}
      <ResponsiveDialog
        open={!!otpDialogOpen}
        onClose={() => {
          setOtpDialogOpen(null);
          setOtpInput('');
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Enter OTP for {otpDialogOpen?.passNumber}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography variant="body2">
              An OTP was sent to <strong>{otpDialogOpen?.otpRequestedForUser?.name}</strong> at{' '}
              <strong>{otpDialogOpen?.otpRequestedForUser?.phone}</strong>. Enter the OTP they
              provide to approve this gate pass. Inventory is updated separately.
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
            <Button
              variant="text"
              startIcon={resendingOtp ? <CircularProgress size={16} /> : <ResendIcon />}
              onClick={handleResendOtp}
              disabled={resendingOtp}
              sx={{ alignSelf: 'flex-start' }}
            >
              Resend OTP
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setOtpDialogOpen(null);
              setOtpInput('');
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleVerifyOtp}
            disabled={!otpInput || verifyOtpMutation.isPending}
          >
            {verifyOtpMutation.isPending ? <CircularProgress size={20} /> : 'Verify & Approve'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      <ResponsiveDialog open={deleteRow !== null} onClose={() => setDeleteRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Gate Pass</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete gate pass <strong>{deleteRow?.passNumber}</strong>?</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            This action cannot be undone. Only pending gate passes created by you can be deleted.
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
