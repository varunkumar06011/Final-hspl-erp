import { useState } from 'react';
import { Button, CircularProgress, Box, Alert } from '@mui/material';
import { AutoFixHigh as AutoFixIcon } from '@mui/icons-material';
import api, { extractErrorMessage } from '../config/api';

export interface OcrQuotationData {
  vendorName: string | null;
  vendorId: string | null;
  quotationNumber: string | null;
  date: string | null;
  lineItems: Array<{ materialName: string; quantity: number; unitPrice: number; unit?: string }>;
  gstAmount: number | null;
  totalAmount: number | null;
  grandTotal: number | null;
}

export interface OcrInvoiceData {
  vendorName: string | null;
  vendorId: string | null;
  invoiceNumber: string | null;
  date: string | null;
  amount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  deliveryDate: string | null;
}

interface OcrAutoFillProps {
  file: File | null;
  documentType: 'QUOTATION' | 'INVOICE';
  onExtract: (data: OcrQuotationData | OcrInvoiceData) => void;
  disabled?: boolean;
}

export default function OcrAutoFill({ file, documentType, onExtract, disabled }: OcrAutoFillProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!file) return null;

  const handleExtract = async () => {
    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', documentType);
      const res = await api.post('/ocr/extract', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60_000,
      });
      onExtract(res.data);
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Button
        size="small"
        variant="outlined"
        color="secondary"
        startIcon={loading ? <CircularProgress size={16} /> : <AutoFixIcon />}
        onClick={handleExtract}
        disabled={loading || disabled}
        sx={{ mt: 1 }}
      >
        {loading ? 'Reading document...' : 'Auto-fill from document'}
      </Button>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
