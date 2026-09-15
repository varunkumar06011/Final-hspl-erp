import { useState } from 'react';
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
  paymentType: string;
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
  const [form, setForm] = useState({ amount: '', paymentMode: PaymentMode.BANK_TRANSFER, reference: '', notes: '' });
  const [file, setFile] = useState<File | null>(null);

  const queryKey = ['/payment-sheets', date];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await api.get('/payment-sheets', { params: { date } });
      return res.data as { data: PaymentSheetRow[]; totalAmount: number };
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
      if (file) fd.append('file', file);
      const res = await api.post('/payment-sheets', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setAddOpen(false);
      setSelectedPO(null);
      setPoSearch('');
      setForm({ amount: '', paymentMode: PaymentMode.BANK_TRANSFER, reference: '', notes: '' });
      setFile(null);
      setSuccessMsg('Payment sheet entry added.');
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => api.patch(`/payment-sheets/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setSuccessMsg('Entry marked done.');
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/payment-sheets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setSuccessMsg('Entry deleted.');
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const rows = data?.data ?? [];
  const totalAmount = data?.totalAmount ?? 0;

  const handlePrint = () => window.print();

  const handleExportCSV = () => {
    const header = ['Date', 'PO Number', 'Vendor', 'Amount', 'Payment Mode', 'Reference', 'Status', 'Created By', 'Created At'];
    const lines = rows.map((r) => [
      formatDate(r.date),
      r.purchaseOrder.poNumber,
      r.purchaseOrder.vendor.name,
      r.amount,
      r.paymentMode,
      r.reference ?? '',
      r.status,
      r.createdByUser.name,
      formatDate(r.createdAt),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payment-sheet-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportCSV} disabled={rows.length === 0}>Export CSV</Button>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={handlePrint} disabled={rows.length === 0}>Print</Button>
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
              <Typography variant="caption" color="text.secondary">Total Paid Today</Typography>
              <Typography variant="h6">{formatCurrency(totalAmount)}</Typography>
            </Box>
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
                      {r.status === PaymentStatus.PENDING && r.createdBy === user?.id && (
                        <IconButton size="small" color="success" title="Mark done" onClick={() => approveMutation.mutate(r.id)}>
                          <CheckIcon fontSize="small" />
                        </IconButton>
                      )}
                      {r.status === PaymentStatus.PENDING && r.createdBy === user?.id && (
                        <IconButton size="small" color="error" title="Delete" onClick={() => deleteMutation.mutate(r.id)}>
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

      {/* Printable detail block — one card per entry with full PO details */}
      <Box sx={{ display: 'none', '@media print': { display: 'block' } }}>
        {rows.map((r) => (
          <Box key={r.id} sx={{ mb: 4, pageBreakInside: 'avoid' }}>
            <Typography variant="h6" gutterBottom>Payment Sheet — {formatDate(r.date)}</Typography>
            <Typography variant="subtitle2">PO: {r.purchaseOrder.poNumber} &nbsp;|&nbsp; Vendor: {r.purchaseOrder.vendor.name}</Typography>
            <Table size="small" sx={{ mb: 1 }}>
              <TableBody>
                <TableRow><TableCell sx={{ fontWeight: 600, width: '30%' }}>PO Date</TableCell><TableCell>{formatDate(r.purchaseOrder.date)}</TableCell></TableRow>
                <TableRow><TableCell sx={{ fontWeight: 600 }}>Vendor Code</TableCell><TableCell>{r.purchaseOrder.vendor.vendorCode}</TableCell></TableRow>
                <TableRow><TableCell sx={{ fontWeight: 600 }}>Vendor Phone</TableCell><TableCell>{r.purchaseOrder.vendor.phone ?? '—'}</TableCell></TableRow>
                <TableRow><TableCell sx={{ fontWeight: 600 }}>Vendor Address</TableCell><TableCell>{r.purchaseOrder.vendor.address ?? '—'}</TableCell></TableRow>
                <TableRow><TableCell sx={{ fontWeight: 600 }}>Payment Type</TableCell><TableCell>{r.purchaseOrder.paymentType}</TableCell></TableRow>
                <TableRow><TableCell sx={{ fontWeight: 600 }}>PO Grand Total</TableCell><TableCell>{formatCurrency(r.purchaseOrder.grandTotal)}</TableCell></TableRow>
                <TableRow><TableCell sx={{ fontWeight: 600 }}>Net Payable</TableCell><TableCell>{formatCurrency(r.purchaseOrder.netPayable)}</TableCell></TableRow>
                <TableRow><TableCell sx={{ fontWeight: 600 }}>PO Created By</TableCell><TableCell>{r.purchaseOrder.createdByUser.name}</TableCell></TableRow>
                <TableRow><TableCell sx={{ fontWeight: 600 }}>Payment Amount</TableCell><TableCell>{formatCurrency(r.amount)}</TableCell></TableRow>
                <TableRow><TableCell sx={{ fontWeight: 600 }}>Payment Mode</TableCell><TableCell>{r.paymentMode}</TableCell></TableRow>
                <TableRow><TableCell sx={{ fontWeight: 600 }}>Reference</TableCell><TableCell>{r.reference ?? '—'}</TableCell></TableRow>
                <TableRow><TableCell sx={{ fontWeight: 600 }}>Notes</TableCell><TableCell>{r.notes ?? '—'}</TableCell></TableRow>
                <TableRow><TableCell sx={{ fontWeight: 600 }}>Status</TableCell><TableCell>{r.status}</TableCell></TableRow>
                <TableRow><TableCell sx={{ fontWeight: 600 }}>Recorded By</TableCell><TableCell>{r.createdByUser.name}</TableCell></TableRow>
                <TableRow><TableCell sx={{ fontWeight: 600 }}>Recorded At</TableCell><TableCell>{formatDate(r.createdAt)}</TableCell></TableRow>
              </TableBody>
            </Table>
            <Typography variant="subtitle2" sx={{ mt: 1 }}>PO Items</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Qty</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Unit Price</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>GST %</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {r.purchaseOrder.items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell>{it.materialName}</TableCell>
                    <TableCell>{it.quantity}</TableCell>
                    <TableCell>{it.unit ?? '—'}</TableCell>
                    <TableCell>{formatCurrency(it.unitPrice)}</TableCell>
                    <TableCell>{it.gstRate}</TableCell>
                    <TableCell>{formatCurrency(it.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Divider sx={{ my: 2 }} />
          </Box>
        ))}
        <Typography variant="h6" sx={{ mt: 2 }}>Total Paid: {formatCurrency(totalAmount)}</Typography>
      </Box>

      {/* Add Entry dialog — PO-first flow */}
      <ResponsiveDialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Add Payment Sheet Entry</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Autocomplete
              options={poOptions?.data ?? []}
              getOptionLabel={(po) => `${po.poNumber} — ${po.vendor.name}`}
              value={selectedPO}
              onChange={(_, v) => setSelectedPO(v)}
              inputValue={poSearch}
              onInputChange={(_, v) => setPoSearch(v)}
              renderInput={(params) => (
                <TextField {...params} label="Search approved Purchase Order" placeholder="PO number or vendor" required
                  InputProps={{ ...params.InputProps, startAdornment: (<><InputAdornment position="start"><SearchIcon /></InputAdornment>{params.InputProps.startAdornment}</>) }}
                />
              )}
              noOptionsText="No approved POs found"
            />

            {selectedPO && (
              <Card variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>PO Details</Typography>
                <Stack direction="row" spacing={3} flexWrap="wrap">
                  <Box><Typography variant="caption" color="text.secondary">PO Number</Typography><Typography>{selectedPO.poNumber}</Typography></Box>
                  <Box><Typography variant="caption" color="text.secondary">Vendor</Typography><Typography>{selectedPO.vendor.name}</Typography></Box>
                  <Box><Typography variant="caption" color="text.secondary">Grand Total</Typography><Typography>{formatCurrency(selectedPO.grandTotal)}</Typography></Box>
                  <Box><Typography variant="caption" color="text.secondary">Net Payable</Typography><Typography>{formatCurrency(selectedPO.netPayable)}</Typography></Box>
                  <Box><Typography variant="caption" color="text.secondary">Payment Type</Typography><Typography>{selectedPO.paymentType}</Typography></Box>
                </Stack>
              </Card>
            )}

            <TextField label="Amount" type="number" size="small" required value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} />

            <TextField select label="Payment Mode" size="small" value={form.paymentMode}
              onChange={(e) => setForm({ ...form, paymentMode: e.target.value as PaymentMode })}>
              {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
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
    </Box>
  );
}
