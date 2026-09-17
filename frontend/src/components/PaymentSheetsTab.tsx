import { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Stack,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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
  Autocomplete,
  Divider,
} from '@mui/material';
import ResponsiveDialog from './ResponsiveDialog';
import RefreshButton from './RefreshButton';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Check as CheckIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Print as PrintIcon,
  Download as DownloadIcon,
  AttachFile as AttachFileIcon,
  Receipt as ReceiptIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PaymentMode, PaymentStatus } from '@hospital-erp/shared';
import { formatCurrency, formatDate, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { downloadFile } from '../utils/file';

const PAYMENT_MODES = Object.values(PaymentMode);

interface POOption {
  id: string;
  poNumber: string;
  date: string;
  grandTotal: number;
  netPayable: number;
  advanceAmount: number | null;
  paymentType: string;
  paymentTerms: string | null;
  notes: string | null;
  status: string;
  vendor: { id: string; name: string; vendorCode: string };
}

interface POItem {
  id: string;
  materialName: string;
  quantity: string;
  unit: string | null;
  unitPrice: string;
  amount: string;
  gstRate: string;
}

interface PaymentSheetRow {
  id: string;
  poId: string;
  date: string;
  amount: number;
  paymentMode: string;
  reference: string | null;
  notes: string | null;
  filePath: string | null;
  fileName: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
  purchaseOrder: {
    id: string;
    poNumber: string;
    date: string;
    grandTotal: number;
    netPayable: number;
    totalAmount: number;
    gstAmount: number;
    totalDeductions: number;
    paymentType: string;
    paymentTerms: string | null;
    deliveryDate: string | null;
    notes: string | null;
    vendor: { id: string; name: string; vendorCode: string; phone: string | null; address: string | null; contactPersonName: string | null; contactPersonPhone: string | null };
    items: POItem[];
    budgetHead: { id: string; particulars: string } | null;
    createdByUser: { id: string; name: string };
  };
  createdByUser: { id: string; name: string };
}

export default function PaymentSheetsTab() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [date, setDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Add-entry dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [poSearch, setPoSearch] = useState('');
  const [selectedPO, setSelectedPO] = useState<POOption | null>(null);
  const [form, setForm] = useState({ amount: '', paymentMode: PaymentMode.BANK_TRANSFER, reference: '', notes: '', status: PaymentStatus.PENDING });
  const [file, setFile] = useState<File | null>(null);

  // Edit-entry dialog state
  const [editRow, setEditRow] = useState<PaymentSheetRow | null>(null);
  const [editForm, setEditForm] = useState({ amount: '', paymentMode: '', reference: '', notes: '', status: '' });

  // Confirm-dialog state
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const queryKey = ['/payment-sheets', date];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await api.get('/payment-sheets', { params: { date } });
      return res.data as { data: PaymentSheetRow[]; totalAmount: number; payableAmount: number; grandTotal: number; narration: string };
    },
  });

  const { data: poOptions } = useQuery({
    queryKey: ['/payment-sheets/pos', poSearch],
    queryFn: async () => {
      const res = await api.get('/payment-sheets/pos', { params: { search: poSearch || undefined } });
      return res.data as { data: POOption[] };
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPO) throw new Error('Select a purchase order first');
      const fd = new FormData();
      fd.append('poId', selectedPO.id);
      fd.append('amount', form.amount);
      fd.append('paymentMode', form.paymentMode);
      if (form.reference) fd.append('reference', form.reference);
      if (form.notes) fd.append('notes', form.notes);
      fd.append('status', form.status);
      if (file) fd.append('file', file);
      const res = await api.post('/payment-sheets', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['/transaction-register'] });
      setAddOpen(false);
      setSelectedPO(null);
      setPoSearch('');
      setForm({ amount: '', paymentMode: PaymentMode.BANK_TRANSFER, reference: '', notes: '', status: PaymentStatus.PENDING });
      setFile(null);
      setSuccessMsg('Payment sheet entry added.');
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => api.patch(`/payment-sheets/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      // A paid entry must leave the register's payable totals immediately
      queryClient.invalidateQueries({ queryKey: ['/transaction-register'] });
      setConfirmApproveId(null);
      setSuccessMsg('Entry marked done.');
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/payment-sheets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['/transaction-register'] });
      setConfirmDeleteId(null);
      setSuccessMsg('Entry deleted.');
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async (id: string) =>
      api.patch(`/payment-sheets/${id}`, {
        amount: Number(editForm.amount),
        paymentMode: editForm.paymentMode,
        reference: editForm.reference || undefined,
        notes: editForm.notes || undefined,
        status: editForm.status || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['/transaction-register'] });
      setEditRow(null);
      setSuccessMsg('Entry updated.');
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const narrationMutation = useMutation({
    mutationFn: async (narration: string) =>
      api.put('/payment-sheets/narration', { date, narration }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setSuccessMsg('Narration saved.');
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const openEdit = (r: PaymentSheetRow) => {
    setEditRow(r);
    setEditForm({
      amount: String(r.amount),
      paymentMode: r.paymentMode,
      reference: r.reference ?? '',
      notes: r.notes ?? '',
      status: r.status,
    });
  };

  const rows = data?.data ?? [];
  const totalAmount = data?.totalAmount ?? 0;
  const payableAmount = data?.payableAmount ?? 0;
  const grandTotal = data?.grandTotal ?? 0;

  // Day-level narration — synced from the server, edited locally, saved via PUT.
  const [narrationText, setNarrationText] = useState('');
  useEffect(() => {
    setNarrationText(data?.narration ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.narration, date]);
  const narrationDirty = narrationText !== (data?.narration ?? '');

  const handleSelectPO = (po: POOption | null) => {
    setSelectedPO(po);
    if (!po) return;
    // Auto-fill amount from PO type — advance POs default to the advance amount,
    // others to the net payable. Still editable.
    const suggested = po.paymentType === 'ADVANCE' && Number(po.advanceAmount) > 0
      ? Number(po.advanceAmount)
      : Number(po.netPayable ?? po.grandTotal);
    // Auto-fill description from the PO's payment terms / notes.
    const desc = po.paymentTerms || po.notes || '';
    setForm((f) => ({ ...f, amount: String(suggested), notes: desc }));
  };

  const fetchPdfBlob = async (path: string): Promise<Blob> => {
    const token = localStorage.getItem('firebaseToken');
    const r = await fetch(`${api.defaults.baseURL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.blob();
  };

  const openPdf = async (path: string) => {
    const blob = await fetchPdfBlob(path);
    window.open(URL.createObjectURL(blob), '_blank');
  };

  const downloadPdf = async (path: string, filename: string) => {
    const blob = await fetchPdfBlob(path);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const dayPdfPath = `/payment-sheets/pdf?date=${date}`;
  const entryPdfPath = (id: string) => `/payment-sheets/${id}/pdf`;

  const handlePrint = () => openPdf(dayPdfPath);
  const handleExportPDF = () => downloadPdf(dayPdfPath, `payment-sheet-${date}.pdf`);

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      {/* Toolbar */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }} className="no-print">
        <TextField
          type="date"
          label="Date"
          size="small"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <Box sx={{ flex: 1 }} />
        <RefreshButton onClick={() => queryClient.invalidateQueries({ queryKey })} />
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportPDF}>Export PDF</Button>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={handlePrint}>Print</Button>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setAddOpen(true); setSelectedPO(null); setPoSearch(''); }}>Add Entry</Button>
      </Box>

      {/* Day summary — visible on print */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6">Payment Sheet — {formatDate(date)}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Daily register of payments made against approved purchase orders.
          </Typography>
          <Divider sx={{ my: 1 }} />
          <Stack direction="row" spacing={4} flexWrap="wrap">
            <Box>
              <Typography variant="caption" color="text.secondary">Entries</Typography>
              <Typography variant="h6">{rows.length}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Total Amount</Typography>
              <Typography variant="h6">{formatCurrency(grandTotal)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Total Paid Today</Typography>
              <Typography variant="h6">{formatCurrency(totalAmount)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Total Payable</Typography>
              <Typography variant="h6">{formatCurrency(payableAmount)}</Typography>
            </Box>
          </Stack>
          <Divider sx={{ my: 1.5 }} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="flex-start" className="no-print">
            <TextField
              label="Narration"
              placeholder="e.g. reason for pending payments on this date"
              size="small"
              multiline
              minRows={1}
              maxRows={4}
              fullWidth
              value={narrationText}
              onChange={(e) => setNarrationText(e.target.value)}
              inputProps={{ maxLength: 2000 }}
            />
            <Button
              variant="contained"
              size="small"
              sx={{ whiteSpace: 'nowrap', mt: { xs: 0, sm: 0.5 } }}
              disabled={!narrationDirty || narrationMutation.isPending}
              onClick={() => narrationMutation.mutate(narrationText.trim())}
            >
              {narrationMutation.isPending ? 'Saving…' : 'Save Narration'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* Entries table */}
      <Card>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>PO Number</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Mode</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Reference</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created By</TableCell>
                <TableCell sx={{ fontWeight: 600 }} className="no-print">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 3 }}><CircularProgress size={24} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 3, color: 'text.secondary' }}>No payment sheet entries for this date. Click "Add Entry" to record a payment.</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.purchaseOrder.poNumber}</TableCell>
                  <TableCell>{r.purchaseOrder.vendor.name}</TableCell>
                  <TableCell>{formatCurrency(r.amount)}</TableCell>
                  <TableCell>{r.paymentMode}</TableCell>
                  <TableCell>{r.reference ?? '—'}</TableCell>
                  <TableCell><Chip size="small" color={STATUS_COLORS[r.status] ?? 'default'} label={r.status} /></TableCell>
                  <TableCell>{r.createdByUser.name}</TableCell>
                  <TableCell className="no-print">
                    <Stack direction="row" spacing={0.5}>
                      {r.fileName && (
                        <IconButton size="small" title={r.fileName} onClick={() => downloadFile('payment-sheets', r.id, r.fileName as string)}>
                          <AttachFileIcon fontSize="small" />
                        </IconButton>
                      )}
                      <IconButton size="small" title="Download PDF" onClick={() => downloadPdf(entryPdfPath(r.id), `payment-sheet-${r.purchaseOrder.poNumber}.pdf`)}>
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" title="Print" onClick={() => openPdf(entryPdfPath(r.id))}>
                        <PrintIcon fontSize="small" />
                      </IconButton>
                      {r.status !== PaymentStatus.PAID && r.status !== 'APPROVED' && r.createdBy === user?.id && (
                        <IconButton size="small" title="Edit" onClick={() => openEdit(r)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      )}
                      {r.status !== PaymentStatus.PAID && r.status !== 'APPROVED' && r.createdBy === user?.id && (
                        <IconButton size="small" color="success" title="Mark paid" onClick={() => setConfirmApproveId(r.id)}>
                          <CheckIcon fontSize="small" />
                        </IconButton>
                      )}
                      {r.status !== PaymentStatus.PAID && r.status !== 'APPROVED' && r.createdBy === user?.id && (
                        <IconButton size="small" color="error" title="Delete" onClick={() => setConfirmDeleteId(r.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Add Entry dialog — PO-first flow */}
      <ResponsiveDialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Add Payment Sheet Entry</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Autocomplete
              options={poOptions?.data ?? []}
              getOptionLabel={(po) => `${po.poNumber} — ${po.vendor.name}`}
              value={selectedPO}
              onChange={(_, v) => handleSelectPO(v)}
              inputValue={poSearch}
              onInputChange={(_, v) => setPoSearch(v)}
              renderOption={(props, po) => (
                <li {...props} key={po.id}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 1 }}>
                    <Typography variant="body2">{po.poNumber} — {po.vendor.name}</Typography>
                    <Chip size="small" variant="outlined" label={po.status.replace(/_/g, ' ')} />
                  </Box>
                </li>
              )}
              renderInput={(params) => (
                <TextField {...params} label="Search Purchase Order" placeholder="PO number or vendor" required
                  InputProps={{ ...params.InputProps, startAdornment: (<><InputAdornment position="start"><SearchIcon /></InputAdornment>{params.InputProps.startAdornment}</>) }}
                />
              )}
              noOptionsText="No payable POs found"
            />

            {selectedPO && (
              <Card variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>PO Details</Typography>
                <Stack direction="row" spacing={3} flexWrap="wrap">
                  <Box><Typography variant="caption" color="text.secondary">PO Number</Typography><Typography>{selectedPO.poNumber}</Typography></Box>
                  <Box><Typography variant="caption" color="text.secondary">Vendor</Typography><Typography>{selectedPO.vendor.name}</Typography></Box>
                  <Box><Typography variant="caption" color="text.secondary">Grand Total</Typography><Typography>{formatCurrency(selectedPO.grandTotal)}</Typography></Box>
                  <Box><Typography variant="caption" color="text.secondary">Net Payable</Typography><Typography>{formatCurrency(selectedPO.netPayable)}</Typography></Box>
                  {selectedPO.paymentType === 'ADVANCE' && Number(selectedPO.advanceAmount) > 0 && (
                    <Box><Typography variant="caption" color="text.secondary">Advance Amount</Typography><Typography>{formatCurrency(Number(selectedPO.advanceAmount))}</Typography></Box>
                  )}
                  <Box><Typography variant="caption" color="text.secondary">Payment Type</Typography><Typography>{selectedPO.paymentType}</Typography></Box>
                  <Box><Typography variant="caption" color="text.secondary">PO Status</Typography><Typography>{selectedPO.status.replace(/_/g, ' ')}</Typography></Box>
                </Stack>
              </Card>
            )}

            <TextField label="Amount" type="number" size="small" required value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} />

            <TextField select label="Payment Mode" size="small" value={form.paymentMode}
              onChange={(e) => setForm({ ...form, paymentMode: e.target.value as PaymentMode })}>
              {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
            </TextField>

            <TextField select label="Status" size="small" value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as PaymentStatus })}>
              <MenuItem value={PaymentStatus.PENDING}>Pending</MenuItem>
              <MenuItem value={PaymentStatus.PAID}>Paid</MenuItem>
              <MenuItem value={PaymentStatus.ADVANCE_PAID}>Advance Paid</MenuItem>
            </TextField>

            <TextField label="Reference (cheque / UPI / txn no.)" size="small" value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })} />

            <TextField label="Notes" size="small" multiline rows={2} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />

            <Button variant="outlined" component="label" startIcon={<AttachFileIcon />}>
              {file ? file.name : 'Attach bill / receipt'}
              <input type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" startIcon={<ReceiptIcon />} disabled={!selectedPO || !form.amount || createMutation.isPending}
            onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? <CircularProgress size={20} /> : 'Save Entry'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Edit Entry dialog */}
      <ResponsiveDialog open={!!editRow} onClose={() => setEditRow(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Payment Sheet Entry</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {editRow && (
              <Card variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>PO: {editRow.purchaseOrder.poNumber} — {editRow.purchaseOrder.vendor.name}</Typography>
              </Card>
            )}
            <TextField label="Amount" type="number" size="small" required value={editForm.amount}
              onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} />
            <TextField select label="Payment Mode" size="small" value={editForm.paymentMode}
              onChange={(e) => setEditForm({ ...editForm, paymentMode: e.target.value })}>
              {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
            </TextField>
            <TextField select label="Status" size="small" value={editForm.status}
              onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
              <MenuItem value={PaymentStatus.PENDING}>Pending</MenuItem>
              <MenuItem value={PaymentStatus.PAID}>Paid</MenuItem>
              <MenuItem value={PaymentStatus.ADVANCE_PAID}>Advance Paid</MenuItem>
            </TextField>
            <TextField label="Reference (cheque / UPI / txn no.)" size="small" value={editForm.reference}
              onChange={(e) => setEditForm({ ...editForm, reference: e.target.value })} />
            <TextField label="Notes" size="small" multiline rows={2} value={editForm.notes}
              onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditRow(null)}>Cancel</Button>
          <Button variant="contained" disabled={!editForm.amount || updateMutation.isPending}
            onClick={() => editRow && updateMutation.mutate(editRow.id)}>
            {updateMutation.isPending ? <CircularProgress size={20} /> : 'Save Changes'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Confirm: mark paid */}
      <ResponsiveDialog open={!!confirmApproveId} onClose={() => setConfirmApproveId(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Mark entry as paid?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This confirms the payment was made and locks the entry from editing and deletion.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmApproveId(null)}>Cancel</Button>
          <Button variant="contained" color="success" disabled={approveMutation.isPending}
            onClick={() => confirmApproveId && approveMutation.mutate(confirmApproveId)}>
            {approveMutation.isPending ? <CircularProgress size={20} /> : 'Mark Paid'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Confirm: delete */}
      <ResponsiveDialog open={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this entry?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            The payment sheet entry will be removed from the day's register. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
          <Button variant="contained" color="error" disabled={deleteMutation.isPending}
            onClick={() => confirmDeleteId && deleteMutation.mutate(confirmDeleteId)}>
            {deleteMutation.isPending ? <CircularProgress size={20} /> : 'Delete'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
