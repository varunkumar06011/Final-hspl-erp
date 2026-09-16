import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Accordion, AccordionDetails, AccordionSummary,
  Box, Button, Chip, CircularProgress, DialogActions, DialogTitle, DialogContent,
  Tab, Tabs, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, TextField, Stack,
} from '@mui/material';
import { Link as LinkIcon, ReceiptLong as StatementIcon, ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import EntityPage from '../components/EntityPage';
import ResponsiveDialog from '../components/ResponsiveDialog';
import ResponsiveTable from '../components/ResponsiveTable';
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
            <ResponsiveTable>
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
                        <TableCell data-label="Date">{row.date ? formatDate(row.date) : '—'}</TableCell>
                        <TableCell data-label="Type">
                          <Typography variant="body2" fontWeight={500}>{row.type}</Typography>
                          {row.status && <Chip label={row.status} size="small" sx={{ ml: 0.5, fontSize: '0.65rem', height: 16 }} />}
                        </TableCell>
                        <TableCell data-label="Reference">{row.reference}</TableCell>
                        <TableCell data-label="Debit (Invoice)" align="right" sx={{ color: row.debit > 0 ? 'error.main' : 'text.disabled' }}>
                          {row.debit > 0 ? formatIndianNumber(row.debit) : '—'}
                        </TableCell>
                        <TableCell data-label="Credit (Paid)" align="right" sx={{ color: row.credit > 0 ? 'success.main' : 'text.disabled' }}>
                          {row.credit > 0 ? formatIndianNumber(row.credit) : '—'}
                        </TableCell>
                        <TableCell data-label="Balance" align="right" sx={{ fontWeight: 600 }}>
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
            </ResponsiveTable>

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

// ── Vendor Full History Dialog — everything linked to the vendor, from creation ──
interface VendorHistory {
  vendor: {
    id: string; vendorCode: string; name: string; contactPersonName: string | null;
    contactPersonPhone: string | null; phone: string | null; email: string | null;
    gstNumber: string | null; panNumber: string | null; address: string | null;
    category: string; status: string; rating: number; referenceBy: string | null;
    description: string | null; createdAt: string; createdByName: string | null;
    bankName: string | null; bankAccountNumber: string | null; ifscCode: string | null;
  };
  summary: {
    totalBilled: number; totalPaid: number; advancePaid: number; outstanding: number;
    paymentSheetPaid: number; paymentSheetPending: number;
    ledgerId: string | null; ledgerBalance: number | null; weOwe: number; theyOwe: number;
    counts: {
      quotations: number; purchaseOrders: number; invoices: number;
      paymentRequests: number; payments: number; paymentSheets: number;
      goodsReceipts: number; assets: number;
    };
  };
  timeline: {
    date: string; type: string; reference: string; description: string;
    debit: number; credit: number; runningBalance: number; status?: string; path?: string;
  }[];
  materials: { id: string; name: string; unit: string | null }[];
  quotations: {
    id: string; quotationNumber: string; date: string; status: string; grandTotal: number;
    items: { materialName: string; quantity: string; unit: string | null; unitPrice: string; amount: string; gstRate: string }[];
  }[];
  purchaseOrders: {
    id: string; poNumber: string; date: string; status: string; paymentType: string;
    advanceAmount: number | null; grandTotal: number; totalDeductions: number; netPayable: number;
    items: { materialName: string; quantity: string; unit: string | null; unitPrice: string; amount: string; gstRate: string }[];
    budgetHead: { id: string; particulars: string } | null;
    quotation: { id: string; quotationNumber: string } | null;
  }[];
  invoices: {
    id: string; invoiceCode: string; invoiceNumber: string; date: string;
    amount: string; taxAmount: string; totalAmount: string; advancePaid: string;
    paymentStatus: string; stockStatus: string; verificationStatus: string;
    purchaseOrder: { id: string; poNumber: string } | null;
  }[];
  paymentRequests: {
    id: string; requestNumber: string; paymentCode: string; type: string; amount: string;
    status: string; paymentMode: string | null; description: string | null; createdAt: string;
    invoice: { id: string; invoiceCode: string; invoiceNumber: string } | null;
    purchaseOrder: { id: string; poNumber: string } | null;
    payments: { id: string; amount: string; date: string; mode: string; reference: string | null; status: string }[];
  }[];
  paymentSheets: {
    id: string; date: string; amount: number; status: string; paymentMode: string;
    reference: string | null; notes: string | null;
    purchaseOrder: { id: string; poNumber: string };
    createdByUser: { id: string; name: string };
  }[];
  goodsReceipts: {
    id: string; receiptNumber: string; status: string; createdAt: string;
    purchaseOrder: { id: string; poNumber: string };
    items: { materialName: string; deliveredQty: string; acceptedQty: string; rejectedQty: string; unit: string | null }[];
  }[];
  assets: {
    id: string; assetId: string; status: string; location: string; totalCost: string | null;
    inventoryItem: { id: string; name: string };
  }[];
}

function VendorHistoryDialog({ vendorId, open, onClose }: { vendorId: string | null; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);
  const { data, isLoading } = useQuery<VendorHistory>({
    queryKey: ['/vendors', vendorId, 'history'],
    queryFn: async () => (await api.get(`/vendors/${vendorId}/history`)).data,
    enabled: !!vendorId && open,
  });

  const go = (path?: string) => {
    if (!path) return;
    navigate(path);
    onClose();
  };

  const clickableRow = (path?: string) => ({
    hover: !!path,
    onClick: () => go(path),
    sx: { cursor: path ? 'pointer' : 'default' },
  });

  const money = (v: string | number | null | undefined) => formatCurrency(Number(v ?? 0));
  const s = data?.summary;

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        {isLoading || !data
          ? 'Vendor History'
          : `${data.vendor.name} (${data.vendor.vendorCode}) — Full History`}
      </DialogTitle>
      <DialogContent>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : !data ? (
          <Typography color="text.secondary">No data available.</Typography>
        ) : (
          <>
            {/* Vendor profile strip */}
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {data.vendor.category?.replace(/_/g, ' ') ?? '—'} • Status:{' '}
                <Chip size="small" label={statusLabel(data.vendor.status)} color={(STATUS_COLORS[data.vendor.status] ?? 'default') as never} />
                {' '}• Since {formatDate(data.vendor.createdAt)}
                {data.vendor.createdByName ? ` • Added by ${data.vendor.createdByName}` : ''}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {[
                  data.vendor.phone && `Ph: ${data.vendor.phone}`,
                  data.vendor.contactPersonName && `Contact: ${data.vendor.contactPersonName}${data.vendor.contactPersonPhone ? ` (${data.vendor.contactPersonPhone})` : ''}`,
                  data.vendor.gstNumber && `GST: ${data.vendor.gstNumber}`,
                  data.vendor.referenceBy && `Referred by ${data.vendor.referenceBy}`,
                ].filter(Boolean).join('  ·  ')}
              </Typography>
              {(data.vendor.bankName || data.vendor.bankAccountNumber) && (
                <Typography variant="body2" color="text.secondary">
                  Bank: {[data.vendor.bankName, data.vendor.bankAccountNumber && `A/c ${data.vendor.bankAccountNumber}`, data.vendor.ifscCode && `IFSC ${data.vendor.ifscCode}`].filter(Boolean).join(' · ')}
                </Typography>
              )}
            </Box>

            {/* Financial summary */}
            <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Chip label={`Total Billed: ${money(s?.totalBilled)}`} color="error" variant="outlined" />
              <Chip label={`Total Paid: ${money(s?.totalPaid)}`} color="success" variant="outlined" />
              <Chip label={`Outstanding: ${money(s?.outstanding)}`} color="primary" />
              {(s?.paymentSheetPaid ?? 0) > 0 && (
                <Chip label={`Sheet Paid: ${money(s?.paymentSheetPaid)}`} variant="outlined" />
              )}
              {(s?.paymentSheetPending ?? 0) > 0 && (
                <Chip label={`Sheet Payable: ${money(s?.paymentSheetPending)}`} color="warning" variant="outlined" />
              )}
              {s?.ledgerId && (
                <Chip
                  label={`Ledger: ${s.weOwe > 0 ? `We owe ${money(s.weOwe)}` : s.theyOwe > 0 ? `They owe ${money(s.theyOwe)}` : 'Settled'}`}
                  variant="outlined"
                  onClick={() => go(`/ledgers?id=${s.ledgerId}`)}
                  sx={{ cursor: 'pointer' }}
                />
              )}
            </Stack>

            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
                <Tab label={`Timeline (${data.timeline.length})`} />
                <Tab label={`Purchase Orders (${s?.counts.purchaseOrders ?? 0})`} />
                <Tab label={`Payments (${(s?.counts.paymentRequests ?? 0) + (s?.counts.paymentSheets ?? 0)})`} />
                <Tab label={`Invoices (${s?.counts.invoices ?? 0})`} />
                <Tab label={`Quotations (${s?.counts.quotations ?? 0})`} />
                <Tab label={`More (${(s?.counts.goodsReceipts ?? 0) + (s?.counts.assets ?? 0) + data.materials.length})`} />
              </Tabs>
            </Box>

            {/* ── Timeline: every transaction in chronological order ── */}
            {tab === 0 && (
              <ResponsiveTable>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Reference</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Debit</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Credit</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Balance</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.timeline.length === 0 ? (
                      <TableRow><TableCell colSpan={7} align="center" sx={{ py: 3 }}><Typography color="text.secondary">No transactions yet</Typography></TableCell></TableRow>
                    ) : (
                      data.timeline.map((row, i) => (
                        <TableRow key={i} {...clickableRow(row.path)}>
                          <TableCell data-label="Date">{formatDate(row.date)}</TableCell>
                          <TableCell data-label="Type">
                            <Typography variant="body2" fontWeight={500}>{row.type}</Typography>
                            {row.status && <Chip label={statusLabel(row.status)} size="small" sx={{ fontSize: '0.65rem', height: 16 }} color={(STATUS_COLORS[row.status] ?? 'default') as never} />}
                          </TableCell>
                          <TableCell data-label="Reference">{row.reference}</TableCell>
                          <TableCell data-label="Description" sx={{ whiteSpace: 'normal', minWidth: 180 }}>{row.description || '—'}</TableCell>
                          <TableCell data-label="Debit" align="right" sx={{ color: row.debit > 0 ? 'error.main' : 'text.disabled' }}>{row.debit > 0 ? formatIndianNumber(row.debit) : '—'}</TableCell>
                          <TableCell data-label="Credit" align="right" sx={{ color: row.credit > 0 ? 'success.main' : 'text.disabled' }}>{row.credit > 0 ? formatIndianNumber(row.credit) : '—'}</TableCell>
                          <TableCell data-label="Balance" align="right" sx={{ fontWeight: 600 }}>{formatIndianNumber(row.runningBalance)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              </ResponsiveTable>
            )}

            {/* ── Purchase Orders with item-level detail ── */}
            {tab === 1 && (
              data.purchaseOrders.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No purchase orders.</Typography>
              ) : (
                data.purchaseOrders.map((po) => (
                  <Accordion key={po.id} disableGutters sx={{ mb: 1, border: '1px solid', borderColor: 'divider' }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', width: '100%', rowGap: 0.5 }}>
                        <Typography fontWeight={600}>{po.poNumber}</Typography>
                        <Chip label={statusLabel(po.status)} size="small" color={(STATUS_COLORS[po.status] ?? 'default') as never} />
                        <Typography variant="body2" color="text.secondary">{formatDate(po.date)}</Typography>
                        {po.budgetHead && <Typography variant="body2" color="text.secondary">• {po.budgetHead.particulars}</Typography>}
                        <Box sx={{ flexGrow: 1 }} />
                        <Typography variant="body2" fontWeight={600}>{money(po.grandTotal)}</Typography>
                        <Button size="small" onClick={(e) => { e.stopPropagation(); go(`/pos?id=${po.id}`); }}>Open</Button>
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails>
                      {po.quotation && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                          From quotation{' '}
                          <Button size="small" sx={{ p: 0, minWidth: 0, textTransform: 'none' }} onClick={() => go(`/quotations?id=${po.quotation!.id}`)}>
                            {po.quotation.quotationNumber}
                          </Button>
                          {' '}• {po.paymentType?.replace(/_/g, ' ')}{po.advanceAmount ? ` • Advance ₹${Number(po.advanceAmount).toLocaleString('en-IN')}` : ''}
                          {po.totalDeductions > 0 ? ` • Deductions ₹${po.totalDeductions.toLocaleString('en-IN')} → Net ${money(po.netPayable)}` : ''}
                        </Typography>
                      )}
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600 }}>Item / Description</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>Qty</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>Rate</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>GST</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>Amount</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {po.items.map((it, i) => (
                            <TableRow key={i}>
                              <TableCell>{it.materialName}</TableCell>
                              <TableCell align="right">{Number(it.quantity)} {it.unit ?? ''}</TableCell>
                              <TableCell align="right">{formatIndianNumber(Number(it.unitPrice))}</TableCell>
                              <TableCell align="right">{Number(it.gstRate) > 0 ? `${Number(it.gstRate)}% (₹${formatIndianNumber(Number(it.amount) * Number(it.gstRate) / 100)})` : '—'}</TableCell>
                              <TableCell align="right">{formatIndianNumber(Number(it.amount))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </AccordionDetails>
                  </Accordion>
                ))
              )
            )}

            {/* ── Payments: requests + payments + payment-sheet entries ── */}
            {tab === 2 && (
              <>
                {data.paymentRequests.length === 0 && data.paymentSheets.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">No payments recorded.</Typography>
                ) : (
                  <ResponsiveTable>
                  <TableContainer sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: 'grey.50' }}>
                          <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Reference</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Details</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Mode</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>Amount</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {data.paymentRequests.map((pr) => (
                          <TableRow key={pr.id} {...clickableRow(`/payments?id=${pr.id}`)}>
                            <TableCell data-label="Date">{formatDate(pr.createdAt)}</TableCell>
                            <TableCell data-label="Reference">{pr.requestNumber}</TableCell>
                            <TableCell data-label="Details">
                              {pr.type}
                              {pr.purchaseOrder ? ` · PO ${pr.purchaseOrder.poNumber}` : ''}
                              {pr.invoice ? ` · ${pr.invoice.invoiceCode ?? pr.invoice.invoiceNumber}` : ''}
                              {pr.payments.length > 0 && (
                                <Typography variant="caption" color="text.secondary" display="block">
                                  {pr.payments.map((p) => `${formatDate(p.date)} ${p.mode} ₹${Number(p.amount).toLocaleString('en-IN')}${p.reference ? ` (${p.reference})` : ''}`).join(' · ')}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell data-label="Mode">{pr.paymentMode ?? '—'}</TableCell>
                            <TableCell data-label="Status"><Chip label={statusLabel(pr.status)} size="small" color={(STATUS_COLORS[pr.status] ?? 'default') as never} /></TableCell>
                            <TableCell data-label="Amount" align="right">{money(pr.amount)}</TableCell>
                          </TableRow>
                        ))}
                        {data.paymentSheets.map((ps) => (
                          <TableRow key={ps.id} {...clickableRow(`/pos?id=${ps.purchaseOrder.id}`)}>
                            <TableCell data-label="Date">{formatDate(ps.date)}</TableCell>
                            <TableCell data-label="Reference">Sheet · {ps.purchaseOrder.poNumber}</TableCell>
                            <TableCell data-label="Details">
                              Payment sheet entry{ps.notes ? ` — ${ps.notes}` : ''}
                              <Typography variant="caption" color="text.secondary" display="block">by {ps.createdByUser.name}</Typography>
                            </TableCell>
                            <TableCell data-label="Mode">{ps.paymentMode}</TableCell>
                            <TableCell data-label="Status"><Chip label={statusLabel(ps.status)} size="small" color={(STATUS_COLORS[ps.status] ?? 'default') as never} /></TableCell>
                            <TableCell data-label="Amount" align="right">{money(ps.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  </ResponsiveTable>
                )}
              </>
            )}

            {/* ── Invoices ── */}
            {tab === 3 && (
              <ResponsiveTable>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell sx={{ fontWeight: 600 }}>Invoice #</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>PO</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Payment</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Stock</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Total</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.invoices.length === 0 ? (
                      <TableRow><TableCell colSpan={6} align="center" sx={{ py: 3 }}><Typography color="text.secondary">No invoices</Typography></TableCell></TableRow>
                    ) : (
                      data.invoices.map((inv) => (
                        <TableRow key={inv.id} {...clickableRow(`/invoices?id=${inv.id}`)}>
                          <TableCell data-label="Invoice #">{inv.invoiceCode ?? inv.invoiceNumber}</TableCell>
                          <TableCell data-label="Date">{formatDate(inv.date)}</TableCell>
                          <TableCell data-label="PO">{inv.purchaseOrder?.poNumber ?? '—'}</TableCell>
                          <TableCell data-label="Payment"><Chip label={statusLabel(inv.paymentStatus)} size="small" color={(STATUS_COLORS[inv.paymentStatus] ?? 'default') as never} /></TableCell>
                          <TableCell data-label="Stock"><Chip label={statusLabel(inv.stockStatus)} size="small" color={(STATUS_COLORS[inv.stockStatus] ?? 'default') as never} /></TableCell>
                          <TableCell data-label="Total" align="right">{money(inv.totalAmount)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              </ResponsiveTable>
            )}

            {/* ── Quotations with items ── */}
            {tab === 4 && (
              data.quotations.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No quotations.</Typography>
              ) : (
                data.quotations.map((q) => (
                  <Accordion key={q.id} disableGutters sx={{ mb: 1, border: '1px solid', borderColor: 'divider' }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', width: '100%', rowGap: 0.5 }}>
                        <Typography fontWeight={600}>{q.quotationNumber}</Typography>
                        <Chip label={statusLabel(q.status)} size="small" color={(STATUS_COLORS[q.status] ?? 'default') as never} />
                        <Typography variant="body2" color="text.secondary">{formatDate(q.date)}</Typography>
                        <Box sx={{ flexGrow: 1 }} />
                        <Typography variant="body2" fontWeight={600}>{money(q.grandTotal)}</Typography>
                        <Button size="small" onClick={(e) => { e.stopPropagation(); go(`/quotations?id=${q.id}`); }}>Open</Button>
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600 }}>Item / Description</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>Qty</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>Rate</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>Amount</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {q.items.map((it, i) => (
                            <TableRow key={i}>
                              <TableCell>{it.materialName}</TableCell>
                              <TableCell align="right">{Number(it.quantity)} {it.unit ?? ''}</TableCell>
                              <TableCell align="right">{formatIndianNumber(Number(it.unitPrice))}</TableCell>
                              <TableCell align="right">{formatIndianNumber(Number(it.amount))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </AccordionDetails>
                  </Accordion>
                ))
              )
            )}

            {/* ── More: declared materials, goods receipts, assets ── */}
            {tab === 5 && (
              <Stack spacing={2}>
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Materials Supplied (declared)</Typography>
                  {data.materials.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">None declared.</Typography>
                  ) : (
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {data.materials.map((m) => <Chip key={m.id} size="small" variant="outlined" label={`${m.name}${m.unit ? ` (${m.unit})` : ''}`} />)}
                    </Box>
                  )}
                </Box>
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Goods Receipts</Typography>
                  {data.goodsReceipts.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">None.</Typography>
                  ) : (
                    <Table size="small">
                      <TableBody>
                        {data.goodsReceipts.map((gr) => (
                          <TableRow key={gr.id} {...clickableRow('/goods-receipts')}>
                            <TableCell>{gr.receiptNumber}</TableCell>
                            <TableCell>PO {gr.purchaseOrder.poNumber}</TableCell>
                            <TableCell>{formatDate(gr.createdAt)}</TableCell>
                            <TableCell><Chip label={statusLabel(gr.status)} size="small" color={(STATUS_COLORS[gr.status] ?? 'default') as never} /></TableCell>
                            <TableCell>{gr.items.length} item(s)</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Box>
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Assets Supplied</Typography>
                  {data.assets.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">None.</Typography>
                  ) : (
                    <Table size="small">
                      <TableBody>
                        {data.assets.map((a) => (
                          <TableRow key={a.id} {...clickableRow(`/scan/${a.assetId}`)}>
                            <TableCell><strong>{a.assetId}</strong></TableCell>
                            <TableCell>{a.inventoryItem.name}</TableCell>
                            <TableCell><Chip label={statusLabel(a.status)} size="small" color={(STATUS_COLORS[a.status] ?? 'default') as never} /></TableCell>
                            <TableCell>{a.location}</TableCell>
                            <TableCell align="right">{a.totalCost ? money(a.totalCost) : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Box>
              </Stack>
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
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [statementId, setStatementId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);

  return (
    <>
      <EntityPage
        title="Vendors"
        endpoint="/vendors"
        entityName="Vendor"
        entityType="VENDOR"
        deepLinkField="name"
        onRowClick={(row) => setHistoryId(String(row.id))}
        columns={[
          { key: 'vendorCode', label: 'Vendor ID' },
          { key: 'name', label: 'Vendor Name' },
          { key: 'category', label: 'Category' },
          { key: 'gstNumber', label: 'GST No' },
          { key: 'createdAt', label: 'Date', render: (r) => formatDate(r.createdAt) },
          { key: 'phone', label: 'Phone' },
          { key: 'referenceBy', label: 'Referred By' },
          { key: 'description', label: 'Description' },
          { key: 'totalBilled', label: 'Total Bill', render: (r) => `₹${Number(r.totalBilled ?? 0).toLocaleString('en-IN')}` },
          { key: 'totalPaid', label: 'Paid', render: (r) => `₹${Number(r.totalPaid ?? 0).toLocaleString('en-IN')}` },
          { key: 'outstanding', label: 'Outstanding', render: (r) => `₹${Number(r.outstanding ?? 0).toLocaleString('en-IN')}` },
          { key: 'weOwe', label: 'We Owe (Ledger)', render: (r) => r.ledgerId ? `₹${Number(r.weOwe ?? 0).toLocaleString('en-IN')}` : '—' },
          { key: 'theyOwe', label: 'They Owe (Ledger)', render: (r) => r.ledgerId ? `₹${Number(r.theyOwe ?? 0).toLocaleString('en-IN')}` : '—' },
          { key: 'status', label: 'Status' },
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
          { name: 'description', label: 'Description', type: 'textarea' },
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
      <VendorHistoryDialog vendorId={historyId} open={!!historyId} onClose={() => setHistoryId(null)} />
      <VendorLinkedDialog vendorId={linkedId} open={!!linkedId} onClose={() => setLinkedId(null)} />
      <VendorStatementDialog vendorId={statementId} open={!!statementId} onClose={() => setStatementId(null)} />
    </>
  );
}
