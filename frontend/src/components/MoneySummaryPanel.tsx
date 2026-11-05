import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, MenuItem, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { Download as DownloadIcon, PictureAsPdf as PdfIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import api from '../config/api';
import RefreshButton from './RefreshButton';
import { formatCurrency, formatDate } from '../utils/enumOptions';
import { buildCsv, downloadCsv } from '../utils/csvExport';

type Direction = 'PAID' | 'RECEIVED' | 'BOTH';

interface MoneyRow {
  id: string;
  date: string;
  direction: 'PAID' | 'RECEIVED';
  amount: number;
  account: string;
  accountKind: 'BANK' | 'CASH';
  voucherNumber: string | null;
  description: string | null;
  isReversal: boolean;
}

interface MoneyData {
  data: MoneyRow[];
  totals: { paid: number; received: number; net: number };
  truncated: boolean;
}

const today = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

/** Money actually paid and received (from the bank and cash books), with filter and downloads. */
export default function MoneySummaryPanel() {
  const { t } = useTranslation('psheets');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [direction, setDirection] = useState<Direction>('BOTH');

  const { data, isLoading, isError, refetch } = useQuery<MoneyData>({
    queryKey: ['/payment-sheets/money-summary', from, to, direction],
    queryFn: async () => (await api.get('/payment-sheets/money-summary', { params: { startDate: from, endDate: to, direction } })).data,
  });

  const rows = data?.data ?? [];
  const totals = data?.totals ?? { paid: 0, received: 0, net: 0 };
  const dirLabel = (d: 'PAID' | 'RECEIVED') => t(d === 'PAID' ? 'msPaid' : 'msReceived');
  const kindLabel = (k: 'BANK' | 'CASH') => t(k === 'BANK' ? 'msBank' : 'msCash');
  const fileBase = `money-${direction.toLowerCase()}-${from}${to !== from ? `_to_${to}` : ''}`;
  const rangeText = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;

  const exportCsv = () => {
    const csv = buildCsv(
      rows as unknown as Record<string, unknown>[],
      [
        { key: 'date', label: t('date'), format: (r) => formatDate(String(r.date)) },
        { key: 'direction', label: t('msType'), format: (r) => dirLabel(r.direction as 'PAID' | 'RECEIVED') + (r.isReversal ? ` (${t('msReversal')})` : '') },
        { key: 'account', label: t('msAccount') },
        { key: 'accountKind', label: t('msKind'), format: (r) => kindLabel(r.accountKind as 'BANK' | 'CASH') },
        { key: 'voucherNumber', label: t('voucherNo') },
        { key: 'description', label: t('msDetails') },
        { key: 'amount', label: t('amount'), format: (r) => Number(r.amount).toFixed(2) },
      ],
    );
    downloadCsv(`${fileBase}.csv`, csv);
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(14);
    doc.text(`${t('msTitle')} — ${t(direction === 'PAID' ? 'msOnlyPaid' : direction === 'RECEIVED' ? 'msOnlyReceived' : 'msBoth')}`, 14, 14);
    doc.setFontSize(10);
    doc.text(rangeText, 14, 20);
    const num = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const foot: string[][] = [];
    if (direction !== 'RECEIVED') foot.push(['', '', '', '', '', t('msTotalPaid'), num(totals.paid)]);
    if (direction !== 'PAID') foot.push(['', '', '', '', '', t('msTotalReceived'), num(totals.received)]);
    if (direction === 'BOTH') foot.push(['', '', '', '', '', t('msNet'), num(totals.net)]);
    autoTable(doc, {
      startY: 25,
      head: [[t('date'), t('msType'), t('msAccount'), t('msKind'), t('voucherNo'), t('msDetails'), t('amount')]],
      body: rows.map((r) => [
        formatDate(r.date),
        dirLabel(r.direction) + (r.isReversal ? ` (${t('msReversal')})` : ''),
        r.account,
        kindLabel(r.accountKind),
        r.voucherNumber ?? '',
        r.description ?? '',
        num(r.amount),
      ]),
      foot,
      styles: { fontSize: 8 },
      columnStyles: { 6: { halign: 'right' } },
      footStyles: { fontStyle: 'bold' },
    });
    doc.save(`${fileBase}.pdf`);
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('msIntro')}</Typography>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <TextField type="date" size="small" label={t('msFrom')} value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} InputLabelProps={{ shrink: true }} />
        <TextField type="date" size="small" label={t('msTo')} value={to} onChange={(e) => setTo(e.target.value)} inputProps={{ min: from }} InputLabelProps={{ shrink: true }} />
        <TextField select size="small" label={t('msShow')} value={direction} onChange={(e) => setDirection(e.target.value as Direction)} sx={{ minWidth: 170 }}>
          <MenuItem value="BOTH">{t('msBoth')}</MenuItem>
          <MenuItem value="PAID">{t('msOnlyPaid')}</MenuItem>
          <MenuItem value="RECEIVED">{t('msOnlyReceived')}</MenuItem>
        </TextField>
        <Box sx={{ flex: 1 }} />
        <RefreshButton onClick={() => refetch()} />
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv} disabled={rows.length === 0}>{t('msDownloadExcel')}</Button>
        <Button variant="outlined" startIcon={<PdfIcon />} onClick={exportPdf} disabled={rows.length === 0}>{t('msDownloadPdf')}</Button>
      </Box>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        {direction !== 'RECEIVED' && (
          <Card sx={{ flex: 1 }}><CardContent><Typography variant="caption" color="text.secondary">{t('msTotalPaid')}</Typography><Typography variant="h5" sx={{ color: 'error.main', fontWeight: 700 }}>{formatCurrency(totals.paid)}</Typography></CardContent></Card>
        )}
        {direction !== 'PAID' && (
          <Card sx={{ flex: 1 }}><CardContent><Typography variant="caption" color="text.secondary">{t('msTotalReceived')}</Typography><Typography variant="h5" sx={{ color: 'success.main', fontWeight: 700 }}>{formatCurrency(totals.received)}</Typography></CardContent></Card>
        )}
        {direction === 'BOTH' && (
          <Card sx={{ flex: 1 }}><CardContent><Typography variant="caption" color="text.secondary">{t('msNet')}</Typography><Typography variant="h5" sx={{ fontWeight: 700 }}>{formatCurrency(totals.net)}</Typography></CardContent></Card>
        )}
      </Stack>

      {data?.truncated && <Alert severity="warning" sx={{ mb: 2 }}>{t('msTruncated')}</Alert>}
      {isError && <Alert severity="error" sx={{ mb: 2 }}>{t('msError')}</Alert>}

      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{t('date')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('msType')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('msAccount')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('voucherNo')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('msDetails')}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>{t('amount')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><CircularProgress size={28} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{t('msNone')}</Typography></TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(r.date)}</TableCell>
                  <TableCell>
                    <Chip size="small" color={r.direction === 'PAID' ? 'error' : 'success'} variant="outlined" label={dirLabel(r.direction) + (r.isReversal ? ` (${t('msReversal')})` : '')} />
                  </TableCell>
                  <TableCell>{r.account} <Typography component="span" variant="caption" color="text.secondary">· {kindLabel(r.accountKind)}</Typography></TableCell>
                  <TableCell>{r.voucherNumber ?? '—'}</TableCell>
                  <TableCell sx={{ maxWidth: 360 }}>{r.description ?? '—'}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, color: r.direction === 'PAID' ? 'error.main' : 'success.main' }}>{formatCurrency(r.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  );
}
