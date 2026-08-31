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
import api from '../config/api';
import { formatDate, formatCurrency, formatIndianNumber, STATUS_COLORS } from '../utils/enumOptions';

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

const statusLabel = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ── Vendor Statement Dialog — Tally-style statement with running balance ──
function VendorStatementDialog({ vendorId, open, onClose }: { vendorId: string | null; open: boolean; onClose: () => void }) {
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
        {isLoading || !data ? 'Vendor Statement' : `Statement — ${data.vendor.name} (${data.vendor.vendorCode})`}
      </DialogTitle>
      <DialogContent>
        {/* Date filters */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2, mt: 1 }}>
          <TextField size="small" type="date" label="From" value={startDate} onChange={(e) => setStartDate(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 180 }} />
          <TextField size="small" type="date" label="To" value={endDate} onChange={(e) => setEndDate(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 180 }} />
        </Box>

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : !data ? (
          <Typography color="text.secondary">No data available.</Typography>
        ) : (
          <>
            {/* Summary */}
            <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Chip label={`Opening: ${formatCurrency(data.summary.openingBalance)}`} variant="outlined" />
              <Chip label={`Total Invoices: ${formatCurrency(data.summary.totalDebit)}`} color="error" variant="outlined" />
              <Chip label={`Total Paid: ${formatCurrency(data.summary.totalCredit)}`} color="success" variant="outlined" />
              <Chip label={`Closing: ${formatCurrency(data.summary.closingBalance)}`} color="primary" />
            </Stack>

            {/* Statement table */}
            <TableContainer component={Box} sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Reference</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Debit (Invoice)</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Credit (Paid)</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Balance</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                        <Typography color="text.secondary">No transactions in this period</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.rows.map((row: any, i: number) => (
                      <TableRow key={i} sx={{
                        '&:hover': { bgcolor: 'action.hover' },
                        // Highlight invoice and payment rows
                        bgcolor: row.type === 'Invoice' ? 'error.lightest' : row.type === 'Payment' ? 'success.lightest' : 'inherit',
                      }}>
                        <TableCell>{row.date ? formatDate(row.date) : '—'}</TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={500}>{row.type}</Typography>
                          {row.status && <Chip label={row.status} size="small" sx={{ ml: 0.5, fontSize: '0.65rem', height: 16 }} />}
                        </TableCell>
                        <TableCell>{row.reference}</TableCell>
                        <TableCell align="right" sx={{ color: row.debit > 0 ? 'error.main' : 'text.disabled' }}>
                          {row.debit > 0 ? formatIndianNumber(row.debit) : '—'}
                        </TableCell>
                        <TableCell align="right" sx={{ color: row.credit > 0 ? 'success.main' : 'text.disabled' }}>
                          {row.credit > 0 ? formatIndianNumber(row.credit) : '—'}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {formatIndianNumber(row.runningBalance)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                  {/* Totals row */}
                  <TableRow sx={{ borderTop: 2, borderColor: 'divider' }}>
                    <TableCell colSpan={3} sx={{ fontWeight: 700 }}>Total</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, color: 'error.main' }}>{formatCurrency(data.summary.totalDebit)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, color: 'success.main' }}>{formatCurrency(data.summary.totalCredit)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(data.summary.closingBalance)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>

            {/* Ledger info */}
            {data.ledger && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Ledger: {data.ledger.name} · Current Ledger Balance: {formatCurrency(data.ledger.currentBalance)}
              </Typography>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

function VendorLinkedDialog({ vendorId, open, onClose }: { vendorId: string | null; open: boolean; onClose: () => void }) {
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
        { label: `Quotations (${data.quotations.length})` },
        { label: `Purchase Orders (${data.purchaseOrders.length})` },
        { label: `Assets (${data.assets.length})` },
        { label: `Invoices (${data.invoices.length})` },
        { label: `Payments (${data.paymentRequests.length})` },
      ]
    : [];

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        {isLoading || !data ? 'Linked Records' : `Linked Records — ${data.name} (${data.vendorCode})`}
      </DialogTitle>
      <DialogContent>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : !data ? (
          <Typography color="text.secondary">No data available.</Typography>
        ) : (
          <>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                Category: {data.category ?? '—'} • Status: <Chip size="small" label={statusLabel(data.status ?? 'ACTIVE')} color={(STATUS_COLORS[data.status ?? ''] ?? 'default') as never} />
                {data.referenceBy ? ` • Referred By: ${data.referenceBy}` : ''}
              </Typography>
              {data.gstNumber && <Typography variant="body2" color="text.secondary">GST: {data.gstNumber}</Typography>}
            </Box>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
                {chips.map((c, i) => <Tab key={i} label={c.label} />)}
              </Tabs>
            </Box>

            {tab === 0 && (
              <RecordTable section="Quotations" data={data.quotations} columns={[
                { key: 'quotationNumber', label: 'Quotation #' },
                { key: 'date', label: 'Date', render: (r) => formatDate(r.date) },
                { key: 'status', label: 'Status', chip: true },
                { key: 'grandTotal', label: 'Grand Total', render: (r) => `₹${Number(r.grandTotal).toLocaleString('en-IN')}` },
              ]} />
            )}
            {tab === 1 && (
              <RecordTable section="Purchase Orders" data={data.purchaseOrders} columns={[
                { key: 'poNumber', label: 'PO #' },
                { key: 'date', label: 'Date', render: (r) => formatDate(r.date) },
                { key: 'status', label: 'Status', chip: true },
                { key: 'budgetHead', label: 'Budget Head', render: (r) => r.budgetHead?.particulars ?? '—' },
                { key: 'grandTotal', label: 'Grand Total', render: (r) => `₹${Number(r.grandTotal).toLocaleString('en-IN')}` },
              ]} />
            )}
            {tab === 2 && (
              <RecordTable section="Assets" data={data.assets} columns={[
                { key: 'assetId', label: 'Asset ID', render: (r) => <strong>{r.assetId}</strong> },
                { key: 'itemName', label: 'Item', render: (r) => r.inventoryItem.name },
                { key: 'status', label: 'Status', chip: true },
                { key: 'location', label: 'Location' },
                { key: 'totalCost', label: 'Cost', render: (r) => r.totalCost ? `₹${Number(r.totalCost).toLocaleString('en-IN')}` : '—' },
              ]} onRowClick={(r) => navigate(`/scan/${r.assetId}`)} />
            )}
            {tab === 3 && (
              <RecordTable section="Invoices" data={data.invoices} columns={[
                { key: 'invoiceNumber', label: 'Invoice #' },
                { key: 'date', label: 'Date', render: (r) => formatDate(r.date) },
                { key: 'stockStatus', label: 'Stock', chip: true },
                { key: 'totalAmount', label: 'Amount', render: (r) => `₹${Number(r.totalAmount).toLocaleString('en-IN')}` },
              ]} />
            )}
            {tab === 4 && (
              <RecordTable section="Payments" data={data.paymentRequests} columns={[
                { key: 'requestNumber', label: 'Request #' },
                { key: 'createdAt', label: 'Date', render: (r) => formatDate(r.createdAt) },
                { key: 'type', label: 'Type', chip: true },
                { key: 'status', label: 'Status', chip: true },
                { key: 'amount', label: 'Amount', render: (r) => `₹${Number(r.amount).toLocaleString('en-IN')}` },
              ]} />
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
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
  if (data.length === 0) return <Typography variant="body2" color="text.secondary">No {section.toLowerCase()} found.</Typography>;

  return (
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
                <TableCell key={c.key}>
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
  );
}

export default function VendorsPage() {
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [statementId, setStatementId] = useState<string | null>(null);

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
          { key: 'category', label: 'Category' },
          { key: 'gstNumber', label: 'GST No' },
          { key: 'createdAt', label: 'Date', render: (r) => formatDate(r.createdAt) },
          { key: 'phone', label: 'Phone' },
          { key: 'referenceBy', label: 'Referred By' },
          { key: 'totalBilled', label: 'Total Bill', render: (r) => `₹${Number(r.totalBilled ?? 0).toLocaleString('en-IN')}` },
          { key: 'totalPaid', label: 'Paid', render: (r) => `₹${Number(r.totalPaid ?? 0).toLocaleString('en-IN')}` },
          { key: 'outstanding', label: 'Outstanding', render: (r) => `₹${Number(r.outstanding ?? 0).toLocaleString('en-IN')}` },
          { key: 'weOwe', label: 'We Owe (Ledger)', render: (r) => r.ledgerId ? `₹${Number(r.weOwe ?? 0).toLocaleString('en-IN')}` : '—' },
          { key: 'theyOwe', label: 'They Owe (Ledger)', render: (r) => r.ledgerId ? `₹${Number(r.theyOwe ?? 0).toLocaleString('en-IN')}` : '—' },
          { key: 'status', label: 'Status' },
        ]}
        statusKey="status"
        statusColors={STATUS_COLORS}
        fields={[
          { name: 'name', label: 'Vendor Name', type: 'text', required: true },
          { name: 'phone', label: 'Phone', type: 'text' },
          { name: 'gstNumber', label: 'GST Number', type: 'text' },
          { name: 'category', label: 'Vendor Category', type: 'select', required: true, dropdownType: 'VENDOR_CATEGORY', createOptionLabel: 'New Category', options: [
            { value: 'LABOUR_SUPPLIER', label: 'Labour Supplier' },
            { value: 'ELECTRICAL_CONTRACTOR', label: 'Electrical Contractor' },
            { value: 'WOOD_WORK_CONTRACTOR', label: 'Wood Work Contractor' },
            { value: 'MACHINERY_SUPPLIER', label: 'Machinery Supplier' },
            { value: 'TOOL_SUPPLIER', label: 'Tool Supplier' },
            { value: 'MATERIAL_SUPPLIER', label: 'Material Supplier' },
            { value: 'SUBCONTRACTOR', label: 'Subcontractor' },
            { value: 'SERVICE_PROVIDER', label: 'Service Provider' },
            { value: 'EQUIPMENT_SUPPLIER', label: 'Equipment Supplier' },
            { value: 'OTHER', label: 'Other' },
          ], defaultValue: 'LABOUR_SUPPLIER' },
          { name: 'referenceBy', label: 'Referred By', type: 'select', options: [
            { value: 'Nagarjuna Sir', label: 'Nagarjuna Sir' },
            { value: 'Ashok Sir', label: 'Ashok Sir' },
            { value: 'Kaushal Sir', label: 'Kaushal Sir' },
            { value: 'Vinod Sir', label: 'Vinod Sir' },
          ] },
          { name: 'materials', label: 'Materials Supplied', type: 'materials-list' },
          { name: 'panNumber', label: 'PAN Number', type: 'text' },
          { name: 'bankName', label: 'Bank Name', type: 'text' },
          { name: 'bankAccountNumber', label: 'Account Number', type: 'text' },
          { name: 'ifscCode', label: 'IFSC Code', type: 'text' },
          { name: 'address', label: 'Address', type: 'textarea' },
          { name: 'email', label: 'Email', type: 'text' },
        ]}
        rowActions={(row) => (
          <Stack direction="row" spacing={0.5}>
            <Button
              size="small"
              startIcon={<LinkIcon />}
              onClick={(e) => { e.stopPropagation(); setLinkedId(String(row.id)); }}
            >
              Linked
            </Button>
            <Button
              size="small"
              startIcon={<StatementIcon />}
              onClick={(e) => { e.stopPropagation(); setStatementId(String(row.id)); }}
            >
              Statement
            </Button>
          </Stack>
        )}
      />
      <VendorLinkedDialog vendorId={linkedId} open={!!linkedId} onClose={() => setLinkedId(null)} />
      <VendorStatementDialog vendorId={statementId} open={!!statementId} onClose={() => setStatementId(null)} />
    </>
  );
}
