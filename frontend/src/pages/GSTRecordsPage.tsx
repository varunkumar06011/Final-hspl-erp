import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  Chip,
  CircularProgress,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';

interface GSTRecord {
  id: string;
  sourceType: 'INVOICE' | 'PURCHASE_ORDER';
  sourceNumber: string;
  date: string;
  vendor: { id: string; name: string; vendorCode: string };
  po: { id: string; poNumber: string } | null;
  quotation: { id: string; quotationNumber: string } | null;
  poGstRecorded: number | null;
  quotationGstRecorded: number | null;
  gstRecorded: number;
  gstPaid: number;
  gstOutstanding: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  paymentStatus: 'PAID' | 'PARTIALLY_PAID' | 'OUTSTANDING' | 'UNBILLED';
  note: string;
}

interface GSTResponse {
  data: GSTRecord[];
  summary: {
    gstRecorded: number;
    gstPaid: number;
    gstOutstanding: number;
    vendorWise: { vendorId: string; vendorName: string; vendorCode: string; gstRecorded: number; gstPaid: number; gstOutstanding: number }[];
  };
}

const money = (value: number) => `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function GSTRecordsPage() {
  const [tab, setTab] = useState(0);
  const { data, isLoading, isError, error } = useQuery<GSTResponse>({
    queryKey: ['/gst-records'],
    queryFn: async () => (await api.get('/gst-records')).data,
  });

  const records = useMemo(() => {
    const all = data?.data ?? [];
    if (tab === 1) return all.filter((record) => record.paymentStatus === 'PAID');
    if (tab === 2) return all.filter((record) => ['PARTIALLY_PAID', 'OUTSTANDING', 'UNBILLED'].includes(record.paymentStatus));
    return all;
  }, [data, tab]);

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>GST Records</Typography>
      {isError && <Alert severity="error" sx={{ mb: 2 }}>{extractErrorMessage(error)}</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mb: 2 }}>
        <Card sx={{ p: 2 }}><Typography variant="caption">GST Recorded</Typography><Typography variant="h6">{money(data?.summary.gstRecorded ?? 0)}</Typography></Card>
        <Card sx={{ p: 2 }}><Typography variant="caption">GST Paid</Typography><Typography variant="h6" color="success.main">{money(data?.summary.gstPaid ?? 0)}</Typography></Card>
        <Card sx={{ p: 2 }}><Typography variant="caption">GST Outstanding</Typography><Typography variant="h6" color="warning.dark">{money(data?.summary.gstOutstanding ?? 0)}</Typography></Card>
      </Box>

      <Card sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
          <Tab label="All" />
          <Tab label="Paid" />
          <Tab label="Outstanding" />
        </Tabs>
      </Card>

      <Card sx={{ mb: 2 }}>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead><TableRow>
              <TableCell>Source</TableCell><TableCell>Vendor</TableCell><TableCell>PO</TableCell>
              <TableCell>Date</TableCell><TableCell>GST Recorded</TableCell>
              <TableCell>CGST</TableCell><TableCell>SGST</TableCell><TableCell>IGST</TableCell>
              <TableCell>GST Paid</TableCell>
              <TableCell>GST Outstanding</TableCell><TableCell>Status</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {records.length === 0 ? <TableRow><TableCell colSpan={11} align="center">No GST records found</TableCell></TableRow> : records.map((record) => (
                <TableRow key={record.id} hover title={record.note}>
                  <TableCell>
                    {record.sourceType === 'INVOICE' ? `Invoice: ${record.sourceNumber}` : `PO estimate: ${record.sourceNumber}`}
                    {record.sourceType === 'INVOICE' && record.po && <Typography variant="caption" display="block" color="text.secondary">PO GST estimate replaced: {money(record.poGstRecorded ?? 0)}</Typography>}
                    {record.sourceType === 'INVOICE' && record.quotation && <Typography variant="caption" display="block" color="text.secondary">Quotation GST estimate: {money(record.quotationGstRecorded ?? 0)}</Typography>}
                  </TableCell>
                  <TableCell>{record.vendor.vendorCode} - {record.vendor.name}</TableCell>
                  <TableCell>{record.po?.poNumber ?? '—'}</TableCell>
                  <TableCell>{new Date(record.date).toLocaleDateString('en-IN')}</TableCell>
                  <TableCell>{money(record.gstRecorded)}</TableCell>
                  <TableCell>{money(record.cgstAmount ?? 0)}</TableCell>
                  <TableCell>{money(record.sgstAmount ?? 0)}</TableCell>
                  <TableCell>{money(record.igstAmount ?? 0)}</TableCell>
                  <TableCell>{money(record.gstPaid)}</TableCell>
                  <TableCell>{money(record.gstOutstanding)}</TableCell>
                  <TableCell><Chip size="small" label={record.paymentStatus.replace(/_/g, ' ')} color={record.paymentStatus === 'PAID' ? 'success' : record.paymentStatus === 'UNBILLED' ? 'default' : 'warning'} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>Vendor-wise GST</Typography>
      <Card>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead><TableRow><TableCell>Vendor</TableCell><TableCell>GST Recorded</TableCell><TableCell>GST Paid</TableCell><TableCell>GST Outstanding</TableCell></TableRow></TableHead>
            <TableBody>
              {(data?.summary.vendorWise ?? []).map((vendor) => <TableRow key={vendor.vendorId}>
                <TableCell>{vendor.vendorCode} - {vendor.vendorName}</TableCell>
                <TableCell>{money(vendor.gstRecorded)}</TableCell>
                <TableCell>{money(vendor.gstPaid)}</TableCell>
                <TableCell>{money(vendor.gstOutstanding)}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  );
}
