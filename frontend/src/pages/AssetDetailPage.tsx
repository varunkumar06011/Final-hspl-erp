import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TextField,
  Tabs,
  Tab,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Alert,
  CircularProgress,
  MenuItem,
  IconButton,
  Grid,
  InputAdornment,
} from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import {
  ArrowBack as ArrowBackIcon,
  Download as DownloadIcon,
  Print as PrintIcon,
  Refresh as RefreshIcon,
  Edit as EditIcon,
  Warning as WarningIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { AssetStatus, UserRole } from '@hospital-erp/shared';
import { enumToOptions, formatDate } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import AttachmentUpload from '../components/AttachmentUpload';

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'info' | 'error' | 'default'> = {
  ACTIVE: 'success',
  ISSUED: 'warning',
  UNDER_MAINTENANCE: 'info',
  RETIRED: 'error',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  ISSUED: 'Issued',
  UNDER_MAINTENANCE: 'Under Maintenance',
  RETIRED: 'Retired',
};

const MOVEMENT_LABELS: Record<string, string> = {
  CREATED: 'Created',
  ISSUED: 'Issued',
  RETURNED: 'Returned',
  RELOCATED: 'Relocated',
  MAINTENANCE_START: 'Maintenance Start',
  MAINTENANCE_COMPLETE: 'Maintenance Complete',
  RETIRED: 'Retired',
  SCANNED: 'Scanned',
};

interface AssetRow {
  id: string;
  assetId: string;
  serialNumber: string | null;
  status: string;
  location: string;
  issuedToDept: string | null;
  issuedToPerson: string | null;
  issuedAt: string | null;
  notes: string | null;
  lastScannedAt: string | null;
  warrantyExpiry: string | null;
  amcVendor: string | null;
  amcExpiry: string | null;
  udi: string | null;
  gtin: string | null;
  totalCost: string | null;
  unitPrice: string | null;
  usefulLifeYears: string | null;
  depreciationMethod: string | null;
  salvageValue: string | null;
  vendorName: string | null;
  poNumber: string | null;
  invoiceNumber: string | null;
  receiptNumber: string | null;
  receiptDate: string | null;
  poDate: string | null;
  invoiceDate: string | null;
  gatePassNumber: string | null;
  postedBy: string | null;
  gstRate: string | null;
  gstAmount: string | null;
  movements: { id: string; type: string; fromLocation: string | null; toLocation: string | null; fromStatus: string | null; toStatus: string | null; reason: string | null; notes: string | null; timestamp: string; user: { id: string; name: string; role: string } }[];
  maintenances: { id: string; reason: string; maintenanceVendor: string | null; technician: string | null; notes: string | null; cost: string | null; sentAt: string; completedAt: string | null; completionNotes: string | null; finalCost: string | null; sentByUser: { name: string }; completedByUser: { name: string } | null }[];
  scans: { id: string; timestamp: string; location: string | null; user: { id: string; name: string } | null }[];
  inventoryItem: { id: string; name: string; category: string | null; unit: string; itemType: string };
}

export default function AssetDetailPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState(0);
  const [printOpen, setPrintOpen] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [actionDialog, setActionDialog] = useState<{ type: string; assetId: string } | null>(null);
  const [actionForm, setActionForm] = useState<Record<string, unknown>>({});
  const [editDialog, setEditDialog] = useState<{ asset: AssetRow } | null>(null);
  const [editForm, setEditForm] = useState<Record<string, unknown>>({});
  const { data: itemData } = useQuery({
    queryKey: ['/inventory/items', itemId],
    queryFn: async () => {
      const response = await api.get('/inventory/items', { params: { search: '', pageSize: 100 } });
      return (response.data?.data as Record<string, unknown>[]).find((i) => i.id === itemId);
    },
    enabled: !!itemId,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<Record<string, unknown>>({
    location: itemData?.location ?? 'Main Store',
  });
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const canRetire = user && (user.role === UserRole.ADMIN || user.role === UserRole.ADMIN_2);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/assets', itemId, page, pageSize, statusFilter, search],
    queryFn: async () => {
      const params: Record<string, unknown> = { inventoryItemId: itemId, page: page + 1, pageSize };
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;
      const response = await api.get('/assets', { params });
      return response.data;
    },
    enabled: !!itemId,
  });

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!actionDialog) return;
      const { type, assetId } = actionDialog;
      await api.post(`/assets/${assetId}/${type}`, actionForm);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/assets'] });
      setActionDialog(null);
      setActionForm({});
      setSuccessMsg('Action completed successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editDialog) return;
      await api.patch(`/assets/${editDialog.asset.id}/details`, editForm);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/assets'] });
      setEditDialog(null);
      setEditForm({});
      setSuccessMsg('Asset details updated.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!itemId) return;
      await api.post(`/assets/generate/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/assets'] });
      setSuccessMsg('Asset records generated.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!itemId) return;
      await api.post(`/assets/${itemId}`, createForm);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/assets'] });
      queryClient.invalidateQueries({ queryKey: ['/inventory/items'] });
      setCreateOpen(false);
      setCreateForm({ location: itemData?.location ?? 'Main Store' });
      setSuccessMsg('Asset unit created.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: AssetRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  // For the detail view, pick the first asset when only one is selected
  const selectedAsset = rows.find((r) => selectedAssetIds.includes(r.id)) ?? rows[0];

  const statusCounts = rows.reduce((acc: Record<string, number>, row) => {
    const s = String(row.status);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const openAction = (type: string, assetId: string) => {
    setActionDialog({ type, assetId });
    setActionForm({});
    setError('');
  };

  const openEdit = (asset: AssetRow) => {
    setEditDialog({ asset });
    setEditForm({
      serialNumber: asset.serialNumber ?? '',
      notes: asset.notes ?? '',
      udi: asset.udi ?? '',
      gtin: asset.gtin ?? '',
      warrantyExpiry: asset.warrantyExpiry ? asset.warrantyExpiry.slice(0, 10) : '',
      amcVendor: asset.amcVendor ?? '',
      amcExpiry: asset.amcExpiry ? asset.amcExpiry.slice(0, 10) : '',
      usefulLifeYears: asset.usefulLifeYears ?? '',
      depreciationMethod: asset.depreciationMethod ?? '',
      salvageValue: asset.salvageValue ?? '',
    });
    setError('');
  };

  const handleExport = () => {
    api.get('/assets/export/csv', { responseType: 'blob' })
      .then((res) => {
        const url = URL.createObjectURL(res.data);
        const a = window.document.createElement('a');
        a.href = url;
        a.download = `assets-export-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((err) => setError(extractErrorMessage(err)));
  };

  const handlePrintLog = (assetId: string) => {
    api.post(`/assets/${assetId}/print-log`).catch(() => {});
  };

  const qrBaseUrl = import.meta.env.VITE_QR_BASE_URL || import.meta.env.VITE_API_URL?.replace('/api', '') || window.location.origin;

  // Depreciation calculation
  const calcDepreciation = (asset: AssetRow | undefined) => {
    if (!asset || !asset.unitPrice || !asset.usefulLifeYears) return null;
    const cost = Number(asset.unitPrice);
    const life = Number(asset.usefulLifeYears);
    const salvage = Number(asset.salvageValue ?? 0);
    if (asset.depreciationMethod === 'STRAIGHT_LINE') {
      const annualDep = (cost - salvage) / life;
      const yearsElapsed = (Date.now() - new Date(asset.issuedAt ?? asset.movements?.[asset.movements.length - 1]?.timestamp ?? Date.now()).getTime()) / (1000 * 60 * 60 * 24 * 365);
      const accDep = Math.min(annualDep * Math.max(yearsElapsed, 0), cost - salvage);
      return { annualDep, accDep, currentValue: cost - accDep };
    }
    return null;
  };

  const isExpiringSoon = (dateStr: string | null) => {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const now = new Date();
    const diff = (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 30;
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={() => navigate('/assets')}><ArrowBackIcon /></IconButton>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          {itemData ? String(itemData.name) : 'Asset'} — Units
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport} size="small">Export CSV</Button>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => setPrintOpen(true)} size="small" disabled={rows.length === 0}>Print QR Tags</Button>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setCreateForm({ location: itemData?.location ?? 'Main Store' }); setCreateOpen(true); }} size="small">Add Asset Unit</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      {/* Status summary */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Chip label={`Total: ${pagination.total}`} color="default" />
        {Object.entries(statusCounts).map(([status, count]) => (
          <Chip key={status} label={`${STATUS_LABELS[status] ?? status}: ${count}`} color={STATUS_COLORS[status] ?? 'default'} size="small" variant="outlined" />
        ))}
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder="Search by Asset ID, Serial, UDI, GTIN..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          sx={{ width: { xs: '100%', sm: 280 } }}
        />
        <TextField
          select
          size="small"
          label="Status"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          sx={{ width: 150 }}
        >
          <MenuItem value="">All</MenuItem>
          {enumToOptions(AssetStatus).map((opt) => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
        </TextField>
      </Box>

      {/* Asset list table */}
      <Card sx={{ mb: 2 }}>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Asset ID</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Serial</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Location</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Issued To</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Warranty</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>AMC</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary" sx={{ mb: 1 }}>No asset units found for this item.</Typography>
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => { setCreateForm({ location: itemData?.location ?? 'Main Store' }); setCreateOpen(true); }}>Add Asset Unit</Button>
                      {Number(itemData?.currentStock ?? 0) > 0 && (
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => generateMutation.mutate()}
                          disabled={generateMutation.isPending}
                        >
                          {generateMutation.isPending ? <CircularProgress size={20} /> : `Generate ${Math.floor(Number(itemData?.currentStock))} Asset Record${Number(itemData?.currentStock) === 1 ? '' : 's'}`}
                        </Button>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ) : rows.map((row) => (
                <TableRow
                  key={row.id}
                  hover
                  sx={{ cursor: 'pointer', backgroundColor: selectedAsset?.id === row.id ? 'action.selected' : undefined }}
                  onClick={() => setSelectedAssetIds([row.id])}
                >
                  <TableCell data-label="Asset ID"><strong>{row.assetId}</strong></TableCell>
                  <TableCell data-label="Serial">{row.serialNumber ?? '—'}</TableCell>
                  <TableCell data-label="Status">
                    <Chip label={STATUS_LABELS[row.status] ?? row.status} size="small" color={STATUS_COLORS[row.status] ?? 'default'} />
                  </TableCell>
                  <TableCell data-label="Location">{row.location}</TableCell>
                  <TableCell data-label="Issued To">
                    {row.issuedToDept || row.issuedToPerson
                      ? `${row.issuedToDept ?? ''}${row.issuedToDept && row.issuedToPerson ? ' / ' : ''}${row.issuedToPerson ?? ''}`
                      : '—'}
                  </TableCell>
                  <TableCell data-label="Warranty">
                    {row.warrantyExpiry ? (
                      <Box>
                        <Typography variant="caption" display="block">{formatDate(row.warrantyExpiry)}</Typography>
                        {isExpiringSoon(row.warrantyExpiry) && <Chip label="Expiring" size="small" color="warning" sx={{ height: 18 }} />}
                      </Box>
                    ) : '—'}
                  </TableCell>
                  <TableCell data-label="AMC">
                    {row.amcExpiry ? (
                      <Box>
                        <Typography variant="caption" display="block">{formatDate(row.amcExpiry)}</Typography>
                        {isExpiringSoon(row.amcExpiry) && <Chip label="Expiring" size="small" color="warning" sx={{ height: 18 }} />}
                      </Box>
                    ) : '—'}
                  </TableCell>
                  <TableCell align="right" data-label="Actions" onClick={(e) => e.stopPropagation()}>
                    <IconButton size="small" onClick={() => openEdit(row)} title="Edit Details"><EditIcon fontSize="small" /></IconButton>
                    {row.status === AssetStatus.ACTIVE && (
                      <>
                        <Button size="small" onClick={() => openAction('issue', row.id)}>Issue</Button>
                        <Button size="small" onClick={() => openAction('maintenance', row.id)}>Maint</Button>
                        <Button size="small" onClick={() => openAction('relocate', row.id)}>Move</Button>
                      </>
                    )}
                    {row.status === AssetStatus.ISSUED && (
                      <>
                        <Button size="small" onClick={() => openAction('return', row.id)}>Return</Button>
                        <Button size="small" onClick={() => openAction('maintenance', row.id)}>Maint</Button>
                      </>
                    )}
                    {row.status === AssetStatus.UNDER_MAINTENANCE && (
                      <Button size="small" onClick={() => openAction('maintenance/complete', row.id)}>Complete</Button>
                    )}
                    {canRetire && row.status !== AssetStatus.RETIRED && (
                      <Button size="small" color="error" onClick={() => openAction('retire', row.id)}>Retire</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={pagination.total}
          page={page}
          onPageChange={(_e, p) => setPage(p)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 20, 50]}
          sx={{ '& .MuiTablePagination-toolbar': { flexWrap: 'wrap' } }}
        />
      </Card>

      {/* Detail panel with tabs for the selected asset */}
      {selectedAsset && (
        <Card>
          <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
              <Tab label="Overview" />
              <Tab label={`Movement (${selectedAsset.movements?.length ?? 0})`} />
              <Tab label={`Maintenance (${selectedAsset.maintenances?.length ?? 0})`} />
              <Tab label={`Scans (${selectedAsset.scans?.length ?? 0})`} />
              <Tab label="Documents" />
            </Tabs>
          </Box>

          {/* Overview Tab */}
          {tab === 0 && (
            <CardContent>
              <Grid container spacing={3}>
                {/* Left: QR + basic info */}
                <Grid item xs={12} md={4}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Card variant="outlined" sx={{ p: 2, display: 'inline-block' }}>
                      <QRCodeSVG value={`${qrBaseUrl}/scan/${selectedAsset.assetId}`} size={160} level="M" />
                      <Typography variant="h6" fontWeight={700} sx={{ mt: 1 }}>{selectedAsset.assetId}</Typography>
                      <Typography variant="body2" color="text.secondary">{selectedAsset.inventoryItem.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{selectedAsset.location}</Typography>
                    </Card>
                    <Box sx={{ mt: 1 }}>
                      <Button size="small" startIcon={<PrintIcon />} onClick={() => { handlePrintLog(selectedAsset.id); setPrintOpen(true); setSelectedAssetIds([selectedAsset.id]); }}>Print Tag</Button>
                    </Box>
                  </Box>
                </Grid>

                {/* Right: Details grid */}
                <Grid item xs={12} md={8}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="h6">Asset Details</Typography>
                    <Button size="small" startIcon={<EditIcon />} onClick={() => openEdit(selectedAsset)}>Edit Details</Button>
                  </Box>
                  <Grid container spacing={1}>
                    <Grid item xs={6} sm={4}><DetailField label="Status" value={<Chip label={STATUS_LABELS[selectedAsset.status]} size="small" color={STATUS_COLORS[selectedAsset.status]} />} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label="Category" value={selectedAsset.inventoryItem.category ?? '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label="Serial Number" value={selectedAsset.serialNumber ?? '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label="Location" value={selectedAsset.location} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label="Issued To" value={selectedAsset.issuedToDept || selectedAsset.issuedToPerson ? `${selectedAsset.issuedToDept ?? ''}${selectedAsset.issuedToDept && selectedAsset.issuedToPerson ? ' / ' : ''}${selectedAsset.issuedToPerson ?? ''}` : '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label="Issued At" value={selectedAsset.issuedAt ? formatDate(selectedAsset.issuedAt) : '—'} /></Grid>
                  </Grid>

                  <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Regulatory Identifiers</Typography>
                  <Grid container spacing={1}>
                    <Grid item xs={6} sm={6}><DetailField label="UDI" value={selectedAsset.udi ?? '—'} /></Grid>
                    <Grid item xs={6} sm={6}><DetailField label="GTIN" value={selectedAsset.gtin ?? '—'} /></Grid>
                  </Grid>

                  <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Warranty & AMC</Typography>
                  <Grid container spacing={1}>
                    <Grid item xs={6} sm={4}>
                      <DetailField
                        label="Warranty Expiry"
                        value={
                          <Box component="span">
                            {selectedAsset.warrantyExpiry ? formatDate(selectedAsset.warrantyExpiry) : '—'}
                            {isExpiringSoon(selectedAsset.warrantyExpiry) && <Chip icon={<WarningIcon />} label="Expiring" size="small" color="warning" sx={{ ml: 0.5, height: 18 }} />}
                          </Box>
                        }
                      />
                    </Grid>
                    <Grid item xs={6} sm={4}><DetailField label="AMC Vendor" value={selectedAsset.amcVendor ?? '—'} /></Grid>
                    <Grid item xs={6} sm={4}>
                      <DetailField
                        label="AMC Expiry"
                        value={
                          <Box component="span">
                            {selectedAsset.amcExpiry ? formatDate(selectedAsset.amcExpiry) : '—'}
                            {isExpiringSoon(selectedAsset.amcExpiry) && <Chip icon={<WarningIcon />} label="Expiring" size="small" color="warning" sx={{ ml: 0.5, height: 18 }} />}
                          </Box>
                        }
                      />
                    </Grid>
                  </Grid>

                  <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Purchase Chain</Typography>
                  <Grid container spacing={1}>
                    <Grid item xs={6} sm={4}><DetailField label="Vendor" value={selectedAsset.vendorName ?? '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label="PO Number" value={selectedAsset.poNumber ?? '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label="Invoice Number" value={selectedAsset.invoiceNumber ?? '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label="Unit Price" value={selectedAsset.unitPrice ? `₹${Number(selectedAsset.unitPrice).toLocaleString('en-IN')}` : '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label="Total Cost" value={selectedAsset.totalCost ? `₹${Number(selectedAsset.totalCost).toLocaleString('en-IN')}` : '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label="Receipt Number" value={selectedAsset.receiptNumber ?? '—'} /></Grid>
                  </Grid>

                  {/* Depreciation */}
                  {calcDepreciation(selectedAsset) && (
                    <>
                      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Depreciation</Typography>
                      <Grid container spacing={1}>
                        <Grid item xs={6} sm={4}><DetailField label="Useful Life" value={`${selectedAsset.usefulLifeYears} years`} /></Grid>
                        <Grid item xs={6} sm={4}><DetailField label="Method" value={selectedAsset.depreciationMethod === 'STRAIGHT_LINE' ? 'Straight Line' : selectedAsset.depreciationMethod ?? '—'} /></Grid>
                        <Grid item xs={6} sm={4}><DetailField label="Salvage Value" value={selectedAsset.salvageValue ? `₹${Number(selectedAsset.salvageValue).toLocaleString('en-IN')}` : '—'} /></Grid>
                        <Grid item xs={6} sm={4}><DetailField label="Annual Depreciation" value={`₹${calcDepreciation(selectedAsset)!.annualDep.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} /></Grid>
                        <Grid item xs={6} sm={4}><DetailField label="Accumulated Dep." value={`₹${calcDepreciation(selectedAsset)!.accDep.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} /></Grid>
                        <Grid item xs={6} sm={4}><DetailField label="Current Value" value={`₹${calcDepreciation(selectedAsset)!.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} /></Grid>
                      </Grid>
                    </>
                  )}

                  {selectedAsset.notes && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="subtitle2">Notes</Typography>
                      <Typography variant="body2" color="text.secondary">{selectedAsset.notes}</Typography>
                    </Box>
                  )}
                </Grid>
              </Grid>
            </CardContent>
          )}

          {/* Movement History Tab */}
          {tab === 1 && (
            <CardContent>
              {selectedAsset.movements && selectedAsset.movements.length > 0 ? (
                <TableContainer component={Card} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>From</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>To</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>By</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Notes</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedAsset.movements.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell>{formatDate(m.timestamp)}</TableCell>
                          <TableCell><Chip label={MOVEMENT_LABELS[m.type] ?? m.type} size="small" variant="outlined" /></TableCell>
                          <TableCell>{m.fromLocation ?? m.fromStatus ?? '—'}</TableCell>
                          <TableCell>{m.toLocation ?? m.toStatus ?? '—'}</TableCell>
                          <TableCell>{m.user.name}</TableCell>
                          <TableCell>{m.reason ?? m.notes ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography color="text.secondary">No movement history.</Typography>
              )}
            </CardContent>
          )}

          {/* Maintenance Tab */}
          {tab === 2 && (
            <CardContent>
              {selectedAsset.maintenances && selectedAsset.maintenances.length > 0 ? (
                <TableContainer component={Card} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Sent At</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Reason</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Technician</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Cost</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Completed</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Final Cost</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedAsset.maintenances.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell>{formatDate(m.sentAt)}</TableCell>
                          <TableCell>{m.reason}</TableCell>
                          <TableCell>{m.maintenanceVendor ?? '—'}</TableCell>
                          <TableCell>{m.technician ?? '—'}</TableCell>
                          <TableCell>{m.cost ? `₹${Number(m.cost).toLocaleString('en-IN')}` : '—'}</TableCell>
                          <TableCell>{m.completedAt ? formatDate(m.completedAt) : <Chip label="Pending" size="small" color="warning" />}</TableCell>
                          <TableCell>{m.finalCost ? `₹${Number(m.finalCost).toLocaleString('en-IN')}` : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography color="text.secondary">No maintenance records.</Typography>
              )}
            </CardContent>
          )}

          {/* Scans Tab */}
          {tab === 3 && (
            <CardContent>
              {selectedAsset.scans && selectedAsset.scans.length > 0 ? (
                <TableContainer component={Card} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Timestamp</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Location</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>User</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedAsset.scans.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>{formatDate(s.timestamp)}</TableCell>
                          <TableCell>{s.location ?? '—'}</TableCell>
                          <TableCell>{s.user?.name ?? 'Anonymous'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography color="text.secondary">No scan history.</Typography>
              )}
            </CardContent>
          )}

          {/* Documents Tab */}
          {tab === 4 && (
            <CardContent>
              <AttachmentUpload entityType="ASSET" entityId={selectedAsset.id} />
            </CardContent>
          )}
        </Card>
      )}

      {/* Print QR Tags Dialog */}
      <ResponsiveDialog open={printOpen} onClose={() => { setPrintOpen(false); setSelectedAssetIds([]); }} maxWidth="md" fullWidth>
        <DialogTitle>Print QR Asset Tags</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {selectedAssetIds.length > 0
              ? `Printing ${selectedAssetIds.length} tag(s). Use your browser's print dialog (Ctrl+P) and select A4 paper.`
              : `Showing all ${rows.length} assets. Use your browser's print dialog (Ctrl+P) and select A4 paper.`}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 2 }} className="print-area">
            {(selectedAssetIds.length > 0
              ? rows.filter((r) => selectedAssetIds.includes(r.id))
              : rows.filter((r) => r.status !== AssetStatus.RETIRED)
            ).map((asset) => (
              <Card key={asset.id} variant="outlined" sx={{ textAlign: 'center', p: 1.5, border: '2px dashed', borderColor: 'divider' }}>
                <Typography variant="caption" fontWeight={700} color="primary">VGH HOSPITAL</Typography>
                <Box sx={{ display: 'flex', justifyContent: 'center', my: 1 }}>
                  <QRCodeSVG value={`${qrBaseUrl}/scan/${asset.assetId}`} size={120} level="M" />
                </Box>
                <Typography variant="body2" fontWeight={700}>{asset.assetId}</Typography>
                <Typography variant="caption" color="text.secondary" display="block" noWrap>{asset.inventoryItem.name}</Typography>
                <Typography variant="caption" color="text.secondary">{asset.location}</Typography>
              </Card>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => { setPrintOpen(false); setSelectedAssetIds([]); }}>Close</Button>
          <Button variant="contained" startIcon={<PrintIcon />} onClick={() => {
            (selectedAssetIds.length > 0 ? selectedAssetIds : rows.filter((r) => r.status !== AssetStatus.RETIRED).map((r) => r.id))
              .forEach((id) => handlePrintLog(id));
            window.print();
          }}>Print</Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Action Dialog */}
      <ResponsiveDialog open={!!actionDialog} onClose={() => setActionDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {actionDialog?.type === 'issue' && 'Issue Asset'}
          {actionDialog?.type === 'return' && 'Return Asset'}
          {actionDialog?.type === 'relocate' && 'Relocate Asset'}
          {actionDialog?.type === 'maintenance' && 'Send for Maintenance'}
          {actionDialog?.type === 'maintenance/complete' && 'Complete Maintenance'}
          {actionDialog?.type === 'retire' && 'Retire Asset'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {actionDialog?.type === 'issue' && (
              <>
                <TextField label="Issued To Department" value={String(actionForm.issuedToDept ?? '')} onChange={(e) => setActionForm({ ...actionForm, issuedToDept: e.target.value })} fullWidth size="small" />
                <TextField label="Issued To Person" value={String(actionForm.issuedToPerson ?? '')} onChange={(e) => setActionForm({ ...actionForm, issuedToPerson: e.target.value })} fullWidth size="small" />
                <TextField label="Destination Location" required value={String(actionForm.location ?? '')} onChange={(e) => setActionForm({ ...actionForm, location: e.target.value })} fullWidth size="small" />
                <TextField label="Notes" value={String(actionForm.notes ?? '')} onChange={(e) => setActionForm({ ...actionForm, notes: e.target.value })} fullWidth size="small" multiline rows={2} />
              </>
            )}
            {actionDialog?.type === 'return' && (
              <>
                <TextField label="Return To Location" value={String(actionForm.location ?? 'Main Store')} onChange={(e) => setActionForm({ ...actionForm, location: e.target.value })} fullWidth size="small" />
                <TextField label="Notes" value={String(actionForm.notes ?? '')} onChange={(e) => setActionForm({ ...actionForm, notes: e.target.value })} fullWidth size="small" multiline rows={2} />
              </>
            )}
            {actionDialog?.type === 'relocate' && (
              <>
                <TextField label="New Location" required value={String(actionForm.location ?? '')} onChange={(e) => setActionForm({ ...actionForm, location: e.target.value })} fullWidth size="small" />
                <TextField label="Reason (optional)" value={String(actionForm.reason ?? '')} onChange={(e) => setActionForm({ ...actionForm, reason: e.target.value })} fullWidth size="small" multiline rows={2} />
              </>
            )}
            {actionDialog?.type === 'maintenance' && (
              <>
                <TextField label="Reason" required value={String(actionForm.reason ?? '')} onChange={(e) => setActionForm({ ...actionForm, reason: e.target.value })} fullWidth size="small" multiline rows={2} />
                <TextField label="Maintenance Vendor (optional)" value={String(actionForm.maintenanceVendor ?? '')} onChange={(e) => setActionForm({ ...actionForm, maintenanceVendor: e.target.value })} fullWidth size="small" />
                <TextField label="Technician (optional)" value={String(actionForm.technician ?? '')} onChange={(e) => setActionForm({ ...actionForm, technician: e.target.value })} fullWidth size="small" />
                <TextField label="Cost (optional)" type="text" value={String(actionForm.cost ?? '')} onChange={(e) => setActionForm({ ...actionForm, cost: e.target.value })} fullWidth size="small" inputMode="decimal" InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
              </>
            )}
            {actionDialog?.type === 'maintenance/complete' && (
              <>
                <TextField label="Completion Notes" value={String(actionForm.completionNotes ?? '')} onChange={(e) => setActionForm({ ...actionForm, completionNotes: e.target.value })} fullWidth size="small" multiline rows={2} />
                <TextField label="Final Cost (optional)" type="text" value={String(actionForm.finalCost ?? '')} onChange={(e) => setActionForm({ ...actionForm, finalCost: e.target.value })} fullWidth size="small" inputMode="decimal" InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
                <TextField label="Return To Location" value={String(actionForm.returnToLocation ?? 'Main Store')} onChange={(e) => setActionForm({ ...actionForm, returnToLocation: e.target.value })} fullWidth size="small" />
              </>
            )}
            {actionDialog?.type === 'retire' && (
              <TextField label="Reason" required value={String(actionForm.reason ?? '')} onChange={(e) => setActionForm({ ...actionForm, reason: e.target.value })} fullWidth size="small" multiline rows={2} />
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setActionDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={() => actionMutation.mutate()} disabled={actionMutation.isPending}>
            {actionMutation.isPending ? <CircularProgress size={20} /> : 'Confirm'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Create Asset Dialog */}
      <ResponsiveDialog open={createOpen} onClose={() => { setCreateOpen(false); setCreateForm({ location: itemData?.location ?? 'Main Store' }); }} maxWidth="sm" fullWidth>
        <DialogTitle>Add Asset Unit — {itemData ? String(itemData.name) : 'Asset'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="Location" value={String(createForm.location ?? 'Main Store')} onChange={(e) => setCreateForm({ ...createForm, location: e.target.value })} fullWidth size="small" required />
            <TextField label="Serial Number" value={String(createForm.serialNumber ?? '')} onChange={(e) => setCreateForm({ ...createForm, serialNumber: e.target.value })} fullWidth size="small" />
            <TextField label="UDI (Unique Device Identifier)" value={String(createForm.udi ?? '')} onChange={(e) => setCreateForm({ ...createForm, udi: e.target.value })} fullWidth size="small" />
            <TextField label="GTIN (Global Trade Item Number)" value={String(createForm.gtin ?? '')} onChange={(e) => setCreateForm({ ...createForm, gtin: e.target.value })} fullWidth size="small" />
            <TextField label="Warranty Expiry" type="date" value={String(createForm.warrantyExpiry ?? '')} onChange={(e) => setCreateForm({ ...createForm, warrantyExpiry: e.target.value })} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField label="AMC Vendor" value={String(createForm.amcVendor ?? '')} onChange={(e) => setCreateForm({ ...createForm, amcVendor: e.target.value })} fullWidth size="small" />
            <TextField label="AMC Expiry" type="date" value={String(createForm.amcExpiry ?? '')} onChange={(e) => setCreateForm({ ...createForm, amcExpiry: e.target.value })} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField label="Useful Life (Years)" type="number" value={String(createForm.usefulLifeYears ?? '')} onChange={(e) => setCreateForm({ ...createForm, usefulLifeYears: e.target.value })} fullWidth size="small" inputProps={{ step: 0.5, min: 0 }} helperText="For depreciation calculation" />
            <TextField select label="Depreciation Method" value={String(createForm.depreciationMethod ?? '')} onChange={(e) => setCreateForm({ ...createForm, depreciationMethod: e.target.value })} fullWidth size="small">
              <MenuItem value="">None</MenuItem>
              <MenuItem value="STRAIGHT_LINE">Straight Line</MenuItem>
              <MenuItem value="WRITTEN_DOWN_VALUE">Written Down Value</MenuItem>
            </TextField>
            <TextField label="Salvage Value" type="number" value={String(createForm.salvageValue ?? '')} onChange={(e) => setCreateForm({ ...createForm, salvageValue: e.target.value })} fullWidth size="small" inputProps={{ step: 0.01, min: 0 }} InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
            <TextField label="Vendor" value={String(createForm.vendorName ?? '')} onChange={(e) => setCreateForm({ ...createForm, vendorName: e.target.value })} fullWidth size="small" />
            <TextField label="PO Number" value={String(createForm.poNumber ?? '')} onChange={(e) => setCreateForm({ ...createForm, poNumber: e.target.value })} fullWidth size="small" />
            <TextField label="Invoice Number" value={String(createForm.invoiceNumber ?? '')} onChange={(e) => setCreateForm({ ...createForm, invoiceNumber: e.target.value })} fullWidth size="small" />
            <TextField label="Receipt Number" value={String(createForm.receiptNumber ?? '')} onChange={(e) => setCreateForm({ ...createForm, receiptNumber: e.target.value })} fullWidth size="small" />
            <TextField label="Unit Price" type="number" value={String(createForm.unitPrice ?? '')} onChange={(e) => setCreateForm({ ...createForm, unitPrice: e.target.value })} fullWidth size="small" inputProps={{ step: 0.01, min: 0 }} InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
            <TextField label="Total Cost (incl. GST)" type="number" value={String(createForm.totalCost ?? '')} onChange={(e) => setCreateForm({ ...createForm, totalCost: e.target.value })} fullWidth size="small" inputProps={{ step: 0.01, min: 0 }} InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
            <TextField label="Purchase / Receipt Date" type="date" value={String(createForm.receiptDate ?? '')} onChange={(e) => setCreateForm({ ...createForm, receiptDate: e.target.value })} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField label="Notes" value={String(createForm.notes ?? '')} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} fullWidth size="small" multiline rows={2} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => { setCreateOpen(false); setCreateForm({ location: itemData?.location ?? 'Main Store' }); }}>Cancel</Button>
          <Button variant="contained" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? <CircularProgress size={20} /> : 'Create Asset'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Edit Details Dialog */}
      <ResponsiveDialog open={!!editDialog} onClose={() => setEditDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Asset Details — {editDialog?.asset.assetId}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="Serial Number" value={String(editForm.serialNumber ?? '')} onChange={(e) => setEditForm({ ...editForm, serialNumber: e.target.value })} fullWidth size="small" />
            <TextField label="UDI (Unique Device Identifier)" value={String(editForm.udi ?? '')} onChange={(e) => setEditForm({ ...editForm, udi: e.target.value })} fullWidth size="small" helperText="Scanned from manufacturer's label (CDSCO requirement for Class C/D devices)" />
            <TextField label="GTIN (Global Trade Item Number)" value={String(editForm.gtin ?? '')} onChange={(e) => setEditForm({ ...editForm, gtin: e.target.value })} fullWidth size="small" helperText="GS1 standard product identifier" />
            <TextField label="Warranty Expiry" type="date" value={String(editForm.warrantyExpiry ?? '')} onChange={(e) => setEditForm({ ...editForm, warrantyExpiry: e.target.value })} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField label="AMC Vendor" value={String(editForm.amcVendor ?? '')} onChange={(e) => setEditForm({ ...editForm, amcVendor: e.target.value })} fullWidth size="small" />
            <TextField label="AMC Expiry" type="date" value={String(editForm.amcExpiry ?? '')} onChange={(e) => setEditForm({ ...editForm, amcExpiry: e.target.value })} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField label="Useful Life (Years)" type="number" value={String(editForm.usefulLifeYears ?? '')} onChange={(e) => setEditForm({ ...editForm, usefulLifeYears: e.target.value })} fullWidth size="small" inputProps={{ step: 0.5, min: 0 }} helperText="For depreciation calculation" />
            <TextField select label="Depreciation Method" value={String(editForm.depreciationMethod ?? '')} onChange={(e) => setEditForm({ ...editForm, depreciationMethod: e.target.value })} fullWidth size="small">
              <MenuItem value="">None</MenuItem>
              <MenuItem value="STRAIGHT_LINE">Straight Line</MenuItem>
              <MenuItem value="WRITTEN_DOWN_VALUE">Written Down Value</MenuItem>
            </TextField>
            <TextField label="Salvage Value" type="number" value={String(editForm.salvageValue ?? '')} onChange={(e) => setEditForm({ ...editForm, salvageValue: e.target.value })} fullWidth size="small" inputProps={{ step: 0.01, min: 0 }} InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} helperText="Residual value at end of useful life" />
            <TextField label="Notes" value={String(editForm.notes ?? '')} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} fullWidth size="small" multiline rows={2} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setEditDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={() => editMutation.mutate()} disabled={editMutation.isPending}>
            {editMutation.isPending ? <CircularProgress size={20} /> : 'Save Details'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  );
}
