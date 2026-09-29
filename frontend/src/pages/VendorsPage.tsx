import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Chip, CircularProgress, DialogActions, DialogTitle, DialogContent,
  Tab, Tabs, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, TextField, Stack,
} from '@mui/material';
import { Link as LinkIcon, ReceiptLong as StatementIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import EntityPage from '../components/EntityPage';
import ResponsiveDialog from '../components/ResponsiveDialog';
import ResponsiveTable from '../components/ResponsiveTable';
import VendorHistoryDialog from '../components/VendorHistoryDialog';
import api from '../config/api';
import { formatDate, formatCurrency, formatIndianNumber, STATUS_COLORS, enumLabel } from '../utils/enumOptions';
import { useTranslation } from 'react-i18next';

interface VendorTrace {
  id: string;
  vendorCode: string;
  name: string;
  referenceBy?: string | null;
  contactPersonName?: string | null;
  contactPersonPhone?: string | null;
  phone?: string | null;
  email?: string | null;
  gstNumber?: string | null;
  address?: string | null;
  category?: string;
  status?: string;
  rating?: number;
  quotations: { id: string; quotationNumber: string; date: string; status: string; grandTotal: string }[];
  purchaseOrders: { id: string; poNumber: string; date: string; status: string; grandTotal: string; budgetHead?: { particulars: string } | null }[];
  assets: { id: string; assetId: string; status: string; location: string; totalCost: string | null; inventoryItem: { name: string } }[];
  invoices: { id: string; invoiceNumber: string; date: string; totalAmount: string; stockStatus: string }[];
  paymentRequests: { id: string; requestNumber: string; amount: string; status: string; type: string; createdAt: string }[];
}

const statusLabel = (s: string) => enumLabel(s);

// ── Vendor Statement Dialog — Tally-style statement with running balance ──
function VendorStatementDialog({ vendorId, open, onClose }: { vendorId: string | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation('vendors');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['/vendors', vendorId, 'statement', startDate, endDate],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      const res = await api.get(`/vendors/${vendorId}/statement`, { params });
      return res.data;
    },
    enabled: !!vendorId && open,
  });

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        {isLoading || !data ? t('statement') : t('statementTitle', { name: data.vendor.name, code: data.vendor.vendorCode })}
      </DialogTitle>
      <DialogContent>
        {/* Date filters */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2, mt: 1 }}>
          <TextField size="small" type="date" label={t('from')} value={startDate} onChange={(e) => setStartDate(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 180 }} />
          <TextField size="small" type="date" label={t('to')} value={endDate} onChange={(e) => setEndDate(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 180 }} />
        </Box>

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : !data ? (
          <Typography color="text.secondary">{t('noData')}</Typography>
        ) : (
          <>
            {/* Summary */}
            <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Chip label={t('opening', { v: formatCurrency(data.summary.openingBalance) })} variant="outlined" />
              <Chip label={t('totalInvoices', { v: formatCurrency(data.summary.totalDebit) })} color="error" variant="outlined" />
              <Chip label={t('totalPaid', { v: formatCurrency(data.summary.totalCredit) })} color="success" variant="outlined" />
              <Chip label={t('closing', { v: formatCurrency(data.summary.closingBalance) })} color="primary" />
            </Stack>

            {/* Statement table */}
            <ResponsiveTable>
            <TableContainer component={Box} sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell sx={{ fontWeight: 600 }}>{t('colDate')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('colType')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('colReference')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{t('debitInvoice')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{t('creditPaid')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{t('balance')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                        <Typography color="text.secondary">{t('noTxn')}</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.rows.map((row: any, i: number) => (
                      <TableRow key={i} sx={{
                        '&:hover': { bgcolor: 'action.hover' },
                        // Highlight invoice and payment rows
                        bgcolor: row.type === 'Invoice' ? 'error.lightest' : row.type === 'Payment' ? 'success.lightest' : 'inherit',
                      }}>
                        <TableCell data-label={t('colDate')}>{row.date ? formatDate(row.date) : '—'}</TableCell>
                        <TableCell data-label={t('colType')}>
                          <Typography variant="body2" fontWeight={500}>{row.type === 'Invoice' ? t('rowInvoice') : row.type === 'Payment' ? t('rowPayment') : row.type}</Typography>
                          {row.status && <Chip label={enumLabel(row.status)} size="small" sx={{ ml: 0.5, fontSize: '0.65rem', height: 16 }} />}
                        </TableCell>
                        <TableCell data-label={t('colReference')}>{row.reference}</TableCell>
                        <TableCell data-label={t('debitInvoice')} align="right" sx={{ color: row.debit > 0 ? 'error.main' : 'text.disabled' }}>
                          {row.debit > 0 ? formatIndianNumber(row.debit) : '—'}
                        </TableCell>
                        <TableCell data-label={t('creditPaid')} align="right" sx={{ color: row.credit > 0 ? 'success.main' : 'text.disabled' }}>
                          {row.credit > 0 ? formatIndianNumber(row.credit) : '—'}
                        </TableCell>
                        <TableCell data-label={t('balance')} align="right" sx={{ fontWeight: 600 }}>
                          {formatIndianNumber(row.runningBalance)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                  {/* Totals row */}
                  <TableRow sx={{ borderTop: 2, borderColor: 'divider' }}>
                    <TableCell colSpan={3} sx={{ fontWeight: 700 }}>{t('total')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, color: 'error.main' }}>{formatCurrency(data.summary.totalDebit)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, color: 'success.main' }}>{formatCurrency(data.summary.totalCredit)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(data.summary.closingBalance)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
            </ResponsiveTable>

            {/* Ledger info */}
            {data.ledger && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {t('ledgerInfo', { name: data.ledger.name, v: formatCurrency(data.ledger.currentBalance) })}
              </Typography>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('close')}</Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

function VendorLinkedDialog({ vendorId, open, onClose }: { vendorId: string | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation('vendors');
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);
  const { data, isLoading } = useQuery<VendorTrace>({
    queryKey: ['/vendors', vendorId, 'trace'],
    queryFn: async () => {
      const res = await api.get(`/vendors/${vendorId}/trace`);
      return res.data;
    },
    enabled: !!vendorId,
  });

  const chips = data
    ? [
        { label: t('tabQuotations', { n: data.quotations.length }) },
        { label: t('tabPOs', { n: data.purchaseOrders.length }) },
        { label: t('tabAssets', { n: data.assets.length }) },
        { label: t('tabInvoices', { n: data.invoices.length }) },
        { label: t('tabPayments', { n: data.paymentRequests.length }) },
      ]
    : [];

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        {isLoading || !data ? t('linkedRecords') : t('linkedTitle', { name: data.name, code: data.vendorCode })}
      </DialogTitle>
      <DialogContent>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : !data ? (
          <Typography color="text.secondary">{t('noData')}</Typography>
        ) : (
          <>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                {t('categoryLine', { v: data.category ? enumLabel(data.category) : '—' })} <Chip size="small" label={statusLabel(data.status ?? 'ACTIVE')} color={(STATUS_COLORS[data.status ?? ''] ?? 'default') as never} />
                {data.referenceBy ? t('referredLine', { v: data.referenceBy }) : ''}
              </Typography>
              {data.gstNumber && <Typography variant="body2" color="text.secondary">{t('gstLine', { v: data.gstNumber })}</Typography>}
            </Box>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
                {chips.map((c, i) => <Tab key={i} label={c.label} />)}
              </Tabs>
            </Box>

            {tab === 0 && (
              <RecordTable section={t('secQuotations')} data={data.quotations} columns={[
                { key: 'quotationNumber', label: t('quotationNo') },
                { key: 'date', label: t('colDate'), render: (r) => formatDate(r.date) },
                { key: 'status', label: t('status'), chip: true },
                { key: 'grandTotal', label: t('grandTotal'), render: (r) => `₹${Number(r.grandTotal).toLocaleString('en-IN')}` },
              ]} />
            )}
            {tab === 1 && (
              <RecordTable section={t('secPOs')} data={data.purchaseOrders} columns={[
                { key: 'poNumber', label: t('poNo') },
                { key: 'date', label: t('colDate'), render: (r) => formatDate(r.date) },
                { key: 'status', label: t('status'), chip: true },
                { key: 'budgetHead', label: t('budgetHead'), render: (r) => r.budgetHead?.particulars ?? '—' },
                { key: 'grandTotal', label: t('grandTotal'), render: (r) => `₹${Number(r.grandTotal).toLocaleString('en-IN')}` },
              ]} />
            )}
            {tab === 2 && (
              <RecordTable section={t('secAssets')} data={data.assets} columns={[
                { key: 'assetId', label: t('assetId'), render: (r) => <strong>{r.assetId}</strong> },
                { key: 'itemName', label: t('item'), render: (r) => r.inventoryItem.name },
                { key: 'status', label: t('status'), chip: true },
                { key: 'location', label: t('location') },
                { key: 'totalCost', label: t('cost'), render: (r) => r.totalCost ? `₹${Number(r.totalCost).toLocaleString('en-IN')}` : '—' },
              ]} onRowClick={(r) => navigate(`/scan/${r.assetId}`)} />
            )}
            {tab === 3 && (
              <RecordTable section={t('secInvoices')} data={data.invoices} columns={[
                { key: 'invoiceNumber', label: t('invoiceNo') },
                { key: 'date', label: t('colDate'), render: (r) => formatDate(r.date) },
                { key: 'stockStatus', label: t('stock'), chip: true },
                { key: 'totalAmount', label: t('amount'), render: (r) => `₹${Number(r.totalAmount).toLocaleString('en-IN')}` },
              ]} />
            )}
            {tab === 4 && (
              <RecordTable section={t('secPayments')} data={data.paymentRequests} columns={[
                { key: 'requestNumber', label: t('requestNo') },
                { key: 'createdAt', label: t('colDate'), render: (r) => formatDate(r.createdAt) },
                { key: 'type', label: t('colType'), chip: true },
                { key: 'status', label: t('status'), chip: true },
                { key: 'amount', label: t('amount'), render: (r) => `₹${Number(r.amount).toLocaleString('en-IN')}` },
              ]} />
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('close')}</Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

interface RecordTableColumn {
  key: string;
  label: string;
  render?: (row: Record<string, any>) => React.ReactNode;
  chip?: boolean;
}

function RecordTable({
  section,
  data,
  columns,
  onRowClick,
}: {
  section: string;
  data: Record<string, any>[];
  columns: RecordTableColumn[];
  onRowClick?: (row: Record<string, any>) => void;
}) {
  const { t } = useTranslation('vendors');
  if (data.length === 0) return <Typography variant="body2" color="text.secondary">{t('noneFound', { section: section.toLowerCase() })}</Typography>;

  return (
    <ResponsiveTable>
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {columns.map((c) => <TableCell key={c.key} sx={{ fontWeight: 600 }}>{c.label}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {data.map((row, i) => (
            <TableRow
              key={i}
              hover={!!onRowClick}
              onClick={() => onRowClick?.(row)}
              sx={{ cursor: onRowClick ? 'pointer' : 'default' }}
            >
              {columns.map((c) => (
                <TableCell key={c.key} data-label={c.label}>
                  {c.chip
                    ? <Chip size="small" label={statusLabel(String(row[c.key]))} color={(STATUS_COLORS[String(row[c.key])] ?? 'default') as never} />
                    : c.render
                      ? c.render(row)
                      : String(row[c.key] ?? '—')}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
    </ResponsiveTable>
  );
}

export default function VendorsPage() {
  const { t } = useTranslation('vendors');
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [statementId, setStatementId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);

  return (
    <>
      <EntityPage
        title={t('title')}
        endpoint="/vendors"
        entityName={t('entity')}
        entityType="VENDOR"
        deepLinkField="name"
        cardLayout
        rowClickLabel={t('history')}
        onRowClick={(row) => setHistoryId(String(row.id))}
        columns={[
          { key: 'vendorCode', label: t('vendorId') },
          { key: 'name', label: t('vendorName') },
          { key: 'vendorType', label: t('type'), render: (r) => r.vendorType === 'NON_VENDOR' ? t('nonVendor') : t('vendor') },
          { key: 'category', label: t('category'), render: (r) => r.category ? enumLabel(r.category) : '—' },
          { key: 'gstNumber', label: t('gstNo') },
          { key: 'createdAt', label: t('date'), render: (r) => formatDate(r.createdAt) },
          { key: 'phone', label: t('phone') },
          { key: 'referenceBy', label: t('referredBy') },
          { key: 'description', label: t('description') },
          { key: 'totalBilled', label: t('totalBill'), render: (r) => `₹${Number(r.totalBilled ?? 0).toLocaleString('en-IN')}` },
          { key: 'totalPaid', label: t('paid'), render: (r) => `₹${Number(r.totalPaid ?? 0).toLocaleString('en-IN')}` },
          { key: 'outstanding', label: t('outstanding'), render: (r) => `₹${Number(r.outstanding ?? 0).toLocaleString('en-IN')}` },
          { key: 'weOwe', label: t('weOwe'), render: (r) => r.ledgerId ? `₹${Number(r.weOwe ?? 0).toLocaleString('en-IN')}` : '—' },
          { key: 'theyOwe', label: t('theyOwe'), render: (r) => r.ledgerId ? `₹${Number(r.theyOwe ?? 0).toLocaleString('en-IN')}` : '—' },
          { key: 'status', label: t('status') },
        ]}
        statusKey="status"
        statusColors={STATUS_COLORS}
        csvFilename="vendors"
        csvColumns={[
          { key: 'vendorCode', label: 'Vendor ID' },
          { key: 'name', label: 'Vendor Name' },
          { key: 'category', label: 'Category' },
          { key: 'gstNumber', label: 'GST No' },
          { key: 'phone', label: 'Phone' },
          { key: 'referenceBy', label: 'Referred By' },
          { key: 'description', label: 'Description' },
          { key: 'totalBilled', label: 'Total Billed', format: (r) => String(Number(r.totalBilled ?? 0)) },
          { key: 'totalPaid', label: 'Total Paid', format: (r) => String(Number(r.totalPaid ?? 0)) },
          { key: 'outstanding', label: 'Outstanding', format: (r) => String(Number(r.outstanding ?? 0)) },
          { key: 'status', label: 'Status' },
        ]}
        fields={[
          { name: 'name', label: t('vendorName'), type: 'text', required: true },
          { name: 'vendorType', label: t('vendorType'), type: 'select', required: true, options: [
            { value: 'VENDOR', label: t('vendorTypeVendor') },
            { value: 'NON_VENDOR', label: t('vendorTypeNon') },
          ], defaultValue: 'VENDOR' },
          { name: 'phone', label: t('phone'), type: 'text' },
          { name: 'gstNumber', label: t('gstNumber'), type: 'text' },
          { name: 'category', label: t('vendorCategory'), type: 'select', required: true, dropdownType: 'VENDOR_CATEGORY', createOptionLabel: t('newCategory'), options: [
            ...['LABOUR_SUPPLIER', 'ELECTRICAL_CONTRACTOR', 'WOOD_WORK_CONTRACTOR', 'MACHINERY_SUPPLIER', 'TOOL_SUPPLIER', 'MATERIAL_SUPPLIER', 'SUBCONTRACTOR', 'SERVICE_PROVIDER', 'EQUIPMENT_SUPPLIER', 'OTHER'].map((v) => ({ value: v, label: enumLabel(v) })),
          ], defaultValue: 'LABOUR_SUPPLIER' },
          { name: 'referenceBy', label: t('referredBy'), type: 'select', options: [
            { value: 'Nagarjuna Sir', label: 'Nagarjuna Sir' },
            { value: 'Ashok Sir', label: 'Ashok Sir' },
            { value: 'Kaushal Sir', label: 'Kaushal Sir' },
            { value: 'Vinod Sir', label: 'Vinod Sir' },
          ] },
          { name: 'materials', label: t('materialsSupplied'), type: 'materials-list' },
          { name: 'panNumber', label: t('panNumber'), type: 'text' },
          { name: 'bankName', label: t('bankName'), type: 'text' },
          { name: 'bankAccountNumber', label: t('accountNumber'), type: 'text' },
          { name: 'ifscCode', label: t('ifsc'), type: 'text' },
          { name: 'address', label: t('address'), type: 'textarea' },
          { name: 'email', label: t('email'), type: 'text' },
          { name: 'description', label: t('description'), type: 'textarea' },
        ]}
        rowActions={(row) => (
          <Stack direction="row" spacing={0.5}>
            <Button
              size="small"
              startIcon={<LinkIcon />}
              onClick={(e) => { e.stopPropagation(); setLinkedId(String(row.id)); }}
            >
              {t('linked')}
            </Button>
            <Button
              size="small"
              startIcon={<StatementIcon />}
              onClick={(e) => { e.stopPropagation(); setStatementId(String(row.id)); }}
            >
              {t('statement')}
            </Button>
          </Stack>
        )}
      />
      <VendorHistoryDialog vendorId={historyId} open={!!historyId} onClose={() => setHistoryId(null)} />
      <VendorLinkedDialog vendorId={linkedId} open={!!linkedId} onClose={() => setLinkedId(null)} />
      <VendorStatementDialog vendorId={statementId} open={!!statementId} onClose={() => setStatementId(null)} />
    </>
  );
}
