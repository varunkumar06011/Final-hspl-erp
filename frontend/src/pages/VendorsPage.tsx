import { useState, useRef } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { Payment as PaymentIcon } from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import EntityPage from '../components/EntityPage';
import { PaymentMode, VendorCategory, VendorStatus } from '@hospital-erp/shared';
import { enumToOptions, formatDate, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';

interface PaymentDialogProps {
  vendor: any;
  open: boolean;
  onClose: () => void;
}

function RecordPaymentDialog({ vendor, open, onClose }: PaymentDialogProps) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [mode, setMode] = useState(PaymentMode.CASH);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entityType', 'VENDOR');
      formData.append('entityId', vendor.id);
      const response = await api.post('/attachments/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const paymentMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/vendors/${vendor.id}/payments`, {
        amount: Number(amount),
        date,
        mode,
        reference,
        notes,
        proofUrl,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      onClose();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const data = await uploadMutation.mutateAsync(file);
      setProofUrl(String(data.filePath ?? data.fileUrl ?? data.url ?? ''));
      setFileName(file.name);
    } catch {
      // handled by onError
    }
  };

  const handleSubmit = () => {
    setError('');
    if (!amount || Number(amount) <= 0) {
      setError('Amount is required');
      return;
    }
    paymentMutation.mutate();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Record Payment — {vendor?.name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <TextField
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            select
            label="Mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as PaymentMode)}
          >
            {enumToOptions(PaymentMode).map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Reference / Transaction ID"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            rows={2}
          />
          <Box>
            <input
              ref={fileRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleFile}
            />
            <Button
              variant="outlined"
              onClick={() => fileRef.current?.click()}
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending ? <CircularProgress size={16} /> : 'Upload Payment Proof'}
            </Button>
            {fileName && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                Uploaded: {fileName}
              </Typography>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={paymentMutation.isPending}
          startIcon={<PaymentIcon />}
        >
          {paymentMutation.isPending ? <CircularProgress size={16} /> : 'Record Payment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function VendorsPage() {
  const [paymentVendor, setPaymentVendor] = useState<any>(null);

  return (
    <>
      <EntityPage
        title="Vendors"
        endpoint="/vendors"
        entityName="Vendor"
        entityType="VENDOR"
        columns={[
          { key: 'vendorCode', label: 'Vendor ID' },
          { key: 'name', label: 'Vendor Name' },
          { key: 'gstNumber', label: 'GST No' },
          { key: 'createdAt', label: 'Date', render: (r) => formatDate(r.createdAt) },
          { key: 'phone', label: 'Phone' },
          { key: 'material', label: 'Material' },
          { key: 'subCategory', label: 'Sub Category' },
          { key: 'unitPrice', label: 'Unit Price', render: (r) => `₹${Number(r.unitPrice ?? 0).toLocaleString('en-IN')}` },
          { key: 'totalBilled', label: 'Total Bill', render: (r) => `₹${Number(r.totalBilled ?? 0).toLocaleString('en-IN')}` },
          { key: 'totalPaid', label: 'Paid', render: (r) => `₹${Number(r.totalPaid ?? 0).toLocaleString('en-IN')}` },
          { key: 'outstanding', label: 'Outstanding', render: (r) => `₹${Number(r.outstanding ?? 0).toLocaleString('en-IN')}` },
          { key: 'status', label: 'Status' },
          {
            key: 'recordPayment',
            label: 'Payment',
            render: (r) => (
              <Button
                size="small"
                variant="outlined"
                startIcon={<PaymentIcon />}
                onClick={() => setPaymentVendor(r)}
              >
                Pay
              </Button>
            ),
          },
        ]}
        statusKey="status"
        statusColors={STATUS_COLORS}
        fields={[
          { name: 'name', label: 'Vendor Name', type: 'text', required: true },
          { name: 'phone', label: 'Phone', type: 'text' },
          { name: 'gstNumber', label: 'GST Number', type: 'text' },
          { name: 'category', label: 'Category', type: 'select', options: enumToOptions(VendorCategory), defaultValue: VendorCategory.OTHER, dropdownType: 'VENDOR_CATEGORY' },
          { name: 'subCategory', label: 'Sub Category', type: 'text' },
          { name: 'material', label: 'Material', type: 'text' },
          { name: 'unitPrice', label: 'Unit Price', type: 'number' },
          { name: 'panNumber', label: 'PAN Number', type: 'text' },
          { name: 'bankName', label: 'Bank Name', type: 'text' },
          { name: 'bankAccountNumber', label: 'Account Number', type: 'text' },
          { name: 'ifscCode', label: 'IFSC Code', type: 'text' },
          { name: 'address', label: 'Address', type: 'textarea' },
          { name: 'email', label: 'Email', type: 'text' },
          { name: 'status', label: 'Status', type: 'select', options: enumToOptions(VendorStatus), defaultValue: VendorStatus.ACTIVE },
          { name: 'rating', label: 'Rating (0-5)', type: 'number', defaultValue: 0 },
        ]}
      />
      {paymentVendor && (
        <RecordPaymentDialog
          vendor={paymentVendor}
          open={!!paymentVendor}
          onClose={() => setPaymentVendor(null)}
        />
      )}
    </>
  );
}
