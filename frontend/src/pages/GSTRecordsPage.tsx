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
import ResponsiveTable from '../components/ResponsiveTable';
import { useTranslation } from 'react-i18next';
import { enumLabel } from '../utils/enumOptions';

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
  const { t } = useTranslation('gst');
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
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2, fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>{t('title')}</Typography>
      {isError && <Alert severity="error" sx={{ mb: 2 }}>{extractErrorMessage(error)}</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mb: 2 }}>
        <Card sx={{ p: 2 }}><Typography variant="caption">{t('gstRecorded')}</Typography><Typography variant="h6">{money(data?.summary.gstRecorded ?? 0)}</Typography></Card>
        <Card sx={{ p: 2 }}><Typography variant="caption">{t('gstPaid')}</Typography><Typography variant="h6" color="success.main">{money(data?.summary.gstPaid ?? 0)}</Typography></Card>
        <Card sx={{ p: 2 }}><Typography variant="caption">{t('gstOutstanding')}</Typography><Typography variant="h6" color="warning.dark">{money(data?.summary.gstOutstanding ?? 0)}</Typography></Card>
      </Box>

      <Card sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
          <Tab label={t('all')} />
          <Tab label={t('paid')} />
          <Tab label={t('outstanding')} />
        </Tabs>
      </Card>

      <Card sx={{ mb: 2 }}>
        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead><TableRow>
              <TableCell>{t('source')}</TableCell><TableCell>{t('vendor')}</TableCell><TableCell>{t('po')}</TableCell>
              <TableCell>{t('date')}</TableCell><TableCell>{t('gstRecorded')}</TableCell>
              <TableCell>{t('cgst')}</TableCell><TableCell>{t('sgst')}</TableCell><TableCell>{t('igst')}</TableCell>
              <TableCell>{t('gstPaid')}</TableCell>
              <TableCell>{t('gstOutstanding')}</TableCell><TableCell>{t('status')}</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {records.length === 0 ? <TableRow><TableCell colSpan={11} align="center">{t('noRecords')}</TableCell></TableRow> : records.map((record) => (
                <TableRow key={record.id} hover title={record.note}>
                  <TableCell data-label={t('source')}>
                    {record.sourceType === 'INVOICE' ? t('invoiceSource', { n: record.sourceNumber }) : t('poEstimate', { n: record.sourceNumber })}
                    {record.sourceType === 'INVOICE' && record.po && <Typography variant="caption" display="block" color="text.secondary">{t('poGstReplaced', { v: money(record.poGstRecorded ?? 0) })}</Typography>}
                    {record.sourceType === 'INVOICE' && record.quotation && <Typography variant="caption" display="block" color="text.secondary">{t('quotationGstEstimate', { v: money(record.quotationGstRecorded ?? 0) })}</Typography>}
                  </TableCell>
                  <TableCell data-label={t('vendor')}>{record.vendor.vendorCode} - {record.vendor.name}</TableCell>
                  <TableCell data-label={t('po')}>{record.po?.poNumber ?? '—'}</TableCell>
                  <TableCell data-label={t('date')}>{new Date(record.date).toLocaleDateString('en-IN')}</TableCell>
                  <TableCell data-label={t('gstRecorded')}>{money(record.gstRecorded)}</TableCell>
                  <TableCell data-label={t('cgst')}>{money(record.cgstAmount ?? 0)}</TableCell>
                  <TableCell data-label={t('sgst')}>{money(record.sgstAmount ?? 0)}</TableCell>
                  <TableCell data-label={t('igst')}>{money(record.igstAmount ?? 0)}</TableCell>
                  <TableCell data-label={t('gstPaid')}>{money(record.gstPaid)}</TableCell>
                  <TableCell data-label={t('gstOutstanding')}>{money(record.gstOutstanding)}</TableCell>
                  <TableCell data-label={t('status')}><Chip size="small" label={enumLabel(record.paymentStatus)} color={record.paymentStatus === 'PAID' ? 'success' : record.paymentStatus === 'UNBILLED' ? 'default' : 'warning'} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        </ResponsiveTable>
      </Card>

      <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>{t('vendorWise')}</Typography>
      <Card>
        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead><TableRow><TableCell>{t('vendor')}</TableCell><TableCell>{t('gstRecorded')}</TableCell><TableCell>{t('gstPaid')}</TableCell><TableCell>{t('gstOutstanding')}</TableCell></TableRow></TableHead>
            <TableBody>
              {(data?.summary.vendorWise ?? []).map((vendor) => <TableRow key={vendor.vendorId}>
                <TableCell data-label={t('vendor')}>{vendor.vendorCode} - {vendor.vendorName}</TableCell>
                <TableCell data-label={t('gstRecorded')}>{money(vendor.gstRecorded)}</TableCell>
                <TableCell data-label={t('gstPaid')}>{money(vendor.gstPaid)}</TableCell>
                <TableCell data-label={t('gstOutstanding')}>{money(vendor.gstOutstanding)}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </TableContainer>
        </ResponsiveTable>
      </Card>
    </Box>
  );
}
