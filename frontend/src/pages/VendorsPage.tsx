import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Chip, CircularProgress, DialogActions, DialogTitle, DialogContent,
  Tab, Tabs, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography,
} from '@mui/material';
import { Link as LinkIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import EntityPage from '../components/EntityPage';
import ResponsiveDialog from '../components/ResponsiveDialog';
import api from '../config/api';
import { formatDate, STATUS_COLORS } from '../utils/enumOptions';

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
          <Button
            size="small"
            startIcon={<LinkIcon />}
            onClick={(e) => { e.stopPropagation(); setLinkedId(String(row.id)); }}
          >
            Linked
          </Button>
        )}
      />
      <VendorLinkedDialog vendorId={linkedId} open={!!linkedId} onClose={() => setLinkedId(null)} />
    </>
  );
}
