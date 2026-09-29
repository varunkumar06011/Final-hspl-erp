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
import ResponsiveTable from '../components/ResponsiveTable';
import {
  ArrowBack as ArrowBackIcon,
  Download as DownloadIcon,
  Print as PrintIcon,
  Edit as EditIcon,
  Warning as WarningIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { AssetStatus, isAdminRole } from '@hospital-erp/shared';
import { enumLabel, enumToOptions, formatDate } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { QR_BASE_URL } from '../config/appConfig';
import { useAuthStore } from '../stores/authStore';
import AttachmentUpload from '../components/AttachmentUpload';
import RefreshButton from '../components/RefreshButton';
import TraceabilityChain, { TraceData } from '../components/TraceabilityChain';

import { useTranslation } from 'react-i18next';
const STATUS_COLORS: Record<string, 'success' | 'warning' | 'info' | 'error' | 'default'> = {
  ACTIVE: 'success',
  ISSUED: 'warning',
  UNDER_MAINTENANCE: 'info',
  RETIRED: 'error',
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
  const { t: tr } = useTranslation('assetdetail');
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

  const canRetire = user && isAdminRole(user.role);

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

  const { data: vendorsData } = useQuery({
    queryKey: ['/vendors'],
    queryFn: async () => {
      const response = await api.get('/vendors', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
  });

  const { data: posData } = useQuery({
    queryKey: ['/purchase-orders', createForm.vendorId],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: 1, pageSize: 100, status: 'APPROVED' };
      if (createForm.vendorId) params.vendorId = createForm.vendorId;
      const response = await api.get('/purchase-orders', { params });
      return response.data;
    },
    enabled: !!createForm.vendorId,
  });

  const { data: invoicesData } = useQuery({
    queryKey: ['/invoices', createForm.vendorId],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: 1, pageSize: 100 };
      if (createForm.vendorId) params.vendorId = createForm.vendorId;
      const response = await api.get('/invoices', { params });
      return response.data;
    },
    enabled: !!createForm.vendorId,
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
      setSuccessMsg(tr('okAction'));
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
      setSuccessMsg(tr('okUpdated'));
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
      setSuccessMsg(tr('okBackfill'));
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
      setSuccessMsg(tr('okSetup'));
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: AssetRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  const vendors: { id: string; name: string }[] = (vendorsData?.data ?? []) as { id: string; name: string }[];
  const purchaseOrders: { id: string; poNumber: string }[] = (posData?.data ?? []) as { id: string; poNumber: string }[];
  const invoices: { id: string; invoiceNumber: string }[] = (invoicesData?.data ?? []) as { id: string; invoiceNumber: string }[];

  // For the detail view, pick the first asset when only one is selected
  const selectedAsset = rows.find((r) => selectedAssetIds.includes(r.id)) ?? rows[0];

  // Traceability chain for the selected asset (fetched on demand when the
  // Traceability tab is opened, to avoid loading the full chain for every row).
  const { data: traceData, isLoading: traceLoading } = useQuery<TraceData>({
    queryKey: ['/assets', selectedAsset?.id, 'trace'],
    queryFn: async () => {
      const response = await api.get(`/assets/${selectedAsset!.id}/trace`);
      return response.data;
    },
    enabled: !!selectedAsset && tab === 4,
  });

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

  const qrBaseUrl = QR_BASE_URL;

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
          {tr('titleUnits', { name: itemData ? String(itemData.name) : tr('asset') })}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <RefreshButton onClick={() => refetch()} />
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport} size="small">{tr('exportCsv')}</Button>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => setPrintOpen(true)} size="small" disabled={rows.length === 0}>{tr('printQrTags')}</Button>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setCreateForm({ location: itemData?.location ?? 'Main Store' }); setCreateOpen(true); }} size="small">{tr('setupAsset')}</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      {/* Status summary */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Chip label={tr('totalN', { n: pagination.total })} color="default" />
        {Object.entries(statusCounts).map(([status, count]) => (
          <Chip key={status} label={`${enumLabel(status)}: ${count}`} color={STATUS_COLORS[status] ?? 'default'} size="small" variant="outlined" />
        ))}
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder={tr('search')}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          sx={{ width: { xs: '100%', sm: 280 } }}
        />
        <TextField
          select
          size="small"
          label={tr('status')}
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          sx={{ width: 150 }}
        >
          <MenuItem value="">{tr('all')}</MenuItem>
          {enumToOptions(AssetStatus).map((opt) => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
        </TextField>
      </Box>

      {/* Asset list table */}
      <Card sx={{ mb: 2 }}>
        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{tr('assetId')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('serial')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('status')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('location')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('issuedTo')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('warranty')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('amc')}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary" sx={{ mb: 1 }}>{tr('notSetup')}</Typography>
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => { setCreateForm({ location: itemData?.location ?? 'Main Store' }); setCreateOpen(true); }}>{tr('setupAsset')}</Button>
                      {Number(itemData?.currentStock ?? 0) > 0 && (
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => generateMutation.mutate()}
                          disabled={generateMutation.isPending}
                        >
                          {generateMutation.isPending ? <CircularProgress size={20} /> : tr('gen', { count: Math.floor(Number(itemData?.currentStock)), n: Math.floor(Number(itemData?.currentStock)) })}
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
                  <TableCell data-label={tr('assetId')}><strong>{row.assetId}</strong></TableCell>
                  <TableCell data-label={tr('serial')}>{row.serialNumber ?? '—'}</TableCell>
                  <TableCell data-label={tr('status')}>
                    <Chip label={enumLabel(row.status)} size="small" color={STATUS_COLORS[row.status] ?? 'default'} />
                  </TableCell>
                  <TableCell data-label={tr('location')}>{row.location}</TableCell>
                  <TableCell data-label={tr('issuedTo')}>
                    {row.issuedToDept || row.issuedToPerson
                      ? `${row.issuedToDept ?? ''}${row.issuedToDept && row.issuedToPerson ? ' / ' : ''}${row.issuedToPerson ?? ''}`
                      : '—'}
                  </TableCell>
                  <TableCell data-label={tr('warranty')}>
                    {row.warrantyExpiry ? (
                      <Box>
                        <Typography variant="caption" display="block">{formatDate(row.warrantyExpiry)}</Typography>
                        {isExpiringSoon(row.warrantyExpiry) && <Chip label={tr('expiring')} size="small" color="warning" sx={{ height: 18 }} />}
                      </Box>
                    ) : '—'}
                  </TableCell>
                  <TableCell data-label={tr('amc')}>
                    {row.amcExpiry ? (
                      <Box>
                        <Typography variant="caption" display="block">{formatDate(row.amcExpiry)}</Typography>
                        {isExpiringSoon(row.amcExpiry) && <Chip label={tr('expiring')} size="small" color="warning" sx={{ height: 18 }} />}
                      </Box>
                    ) : '—'}
                  </TableCell>
                  <TableCell align="right" data-label={tr('actions')} onClick={(e) => e.stopPropagation()}>
                    <IconButton size="small" onClick={() => openEdit(row)} title={tr('editDetails')}><EditIcon fontSize="small" /></IconButton>
                    {row.status === AssetStatus.ACTIVE && (
                      <>
                        <Button size="small" onClick={() => openAction('issue', row.id)}>{tr('issue')}</Button>
                        <Button size="small" onClick={() => openAction('maintenance', row.id)}>{tr('maint')}</Button>
                        <Button size="small" onClick={() => openAction('relocate', row.id)}>{tr('move')}</Button>
                      </>
                    )}
                    {row.status === AssetStatus.ISSUED && (
                      <>
                        <Button size="small" onClick={() => openAction('return', row.id)}>{tr('return')}</Button>
                        <Button size="small" onClick={() => openAction('maintenance', row.id)}>{tr('maint')}</Button>
                      </>
                    )}
                    {row.status === AssetStatus.UNDER_MAINTENANCE && (
                      <Button size="small" onClick={() => openAction('maintenance/complete', row.id)}>{tr('complete')}</Button>
                    )}
                    {canRetire && row.status !== AssetStatus.RETIRED && (
                      <Button size="small" color="error" onClick={() => openAction('retire', row.id)}>{tr('retire')}</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        </ResponsiveTable>
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
              <Tab label={tr('overview')} />
              <Tab label={tr('tabMovement', { n: selectedAsset.movements?.length ?? 0 })} />
              <Tab label={tr('tabMaint', { n: selectedAsset.maintenances?.length ?? 0 })} />
              <Tab label={tr('tabScans', { n: selectedAsset.scans?.length ?? 0 })} />
              <Tab label={tr('traceability')} />
              <Tab label={tr('documents')} />
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
                      <Button size="small" startIcon={<PrintIcon />} onClick={() => { handlePrintLog(selectedAsset.id); setPrintOpen(true); setSelectedAssetIds([selectedAsset.id]); }}>{tr('printTag')}</Button>
                    </Box>
                  </Box>
                </Grid>

                {/* Right: Details grid */}
                <Grid item xs={12} md={8}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                    <Typography variant="h6">{tr('assetDetails')}</Typography>
                    <Button size="small" startIcon={<EditIcon />} onClick={() => openEdit(selectedAsset)}>{tr('editDetails')}</Button>
                  </Box>
                  <Grid container spacing={1}>
                    <Grid item xs={6} sm={4}><DetailField label={tr('status')} value={<Chip label={enumLabel(selectedAsset.status)} size="small" color={STATUS_COLORS[selectedAsset.status]} />} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label={tr('category')} value={selectedAsset.inventoryItem.category ?? '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label={tr('serialNumber')} value={selectedAsset.serialNumber ?? '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label={tr('location')} value={selectedAsset.location} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label={tr('issuedTo')} value={selectedAsset.issuedToDept || selectedAsset.issuedToPerson ? `${selectedAsset.issuedToDept ?? ''}${selectedAsset.issuedToDept && selectedAsset.issuedToPerson ? ' / ' : ''}${selectedAsset.issuedToPerson ?? ''}` : '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label={tr('issuedAt')} value={selectedAsset.issuedAt ? formatDate(selectedAsset.issuedAt) : '—'} /></Grid>
                  </Grid>

                  <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>{tr('regulatoryIdentifiers')}</Typography>
                  <Grid container spacing={1}>
                    <Grid item xs={6} sm={6}><DetailField label={tr('udi')} value={selectedAsset.udi ?? '—'} /></Grid>
                    <Grid item xs={6} sm={6}><DetailField label={tr('gtin')} value={selectedAsset.gtin ?? '—'} /></Grid>
                  </Grid>

                  <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>{tr('warrantyAmc')}</Typography>
                  <Grid container spacing={1}>
                    <Grid item xs={6} sm={4}>
                      <DetailField
                        label={tr('warrantyExpiry')}
                        value={
                          <Box component="span">
                            {selectedAsset.warrantyExpiry ? formatDate(selectedAsset.warrantyExpiry) : '—'}
                            {isExpiringSoon(selectedAsset.warrantyExpiry) && <Chip icon={<WarningIcon />} label={tr('expiring')} size="small" color="warning" sx={{ ml: 0.5, height: 18 }} />}
                          </Box>
                        }
                      />
                    </Grid>
                    <Grid item xs={6} sm={4}><DetailField label={tr('amcVendor')} value={selectedAsset.amcVendor ?? '—'} /></Grid>
                    <Grid item xs={6} sm={4}>
                      <DetailField
                        label={tr('amcExpiry')}
                        value={
                          <Box component="span">
                            {selectedAsset.amcExpiry ? formatDate(selectedAsset.amcExpiry) : '—'}
                            {isExpiringSoon(selectedAsset.amcExpiry) && <Chip icon={<WarningIcon />} label={tr('expiring')} size="small" color="warning" sx={{ ml: 0.5, height: 18 }} />}
                          </Box>
                        }
                      />
                    </Grid>
                  </Grid>

                  <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>{tr('purchaseChain')}</Typography>
                  <Grid container spacing={1}>
                    <Grid item xs={6} sm={4}><DetailField label={tr('vendor')} value={selectedAsset.vendorName ?? '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label={tr('poNumber')} value={selectedAsset.poNumber ?? '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label={tr('invoiceNumber')} value={selectedAsset.invoiceNumber ?? '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label={tr('unitPrice')} value={selectedAsset.unitPrice ? `₹${Number(selectedAsset.unitPrice).toLocaleString('en-IN')}` : '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label={tr('totalCost')} value={selectedAsset.totalCost ? `₹${Number(selectedAsset.totalCost).toLocaleString('en-IN')}` : '—'} /></Grid>
                    <Grid item xs={6} sm={4}><DetailField label={tr('receiptNumber')} value={selectedAsset.receiptNumber ?? '—'} /></Grid>
                  </Grid>

                  {/* Depreciation */}
                  {calcDepreciation(selectedAsset) && (
                    <>
                      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>{tr('depreciation')}</Typography>
                      <Grid container spacing={1}>
                        <Grid item xs={6} sm={4}><DetailField label={tr('usefulLife')} value={tr('years', { n: selectedAsset.usefulLifeYears })} /></Grid>
                        <Grid item xs={6} sm={4}><DetailField label={tr('method')} value={selectedAsset.depreciationMethod === 'STRAIGHT_LINE' ? tr('straightLine') : selectedAsset.depreciationMethod === 'WRITTEN_DOWN_VALUE' ? tr('wdv') : selectedAsset.depreciationMethod ?? '—'} /></Grid>
                        <Grid item xs={6} sm={4}><DetailField label={tr('salvageValue')} value={selectedAsset.salvageValue ? `₹${Number(selectedAsset.salvageValue).toLocaleString('en-IN')}` : '—'} /></Grid>
                        <Grid item xs={6} sm={4}><DetailField label={tr('annualDepreciation')} value={`₹${calcDepreciation(selectedAsset)!.annualDep.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} /></Grid>
                        <Grid item xs={6} sm={4}><DetailField label={tr('accumulatedDep')} value={`₹${calcDepreciation(selectedAsset)!.accDep.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} /></Grid>
                        <Grid item xs={6} sm={4}><DetailField label={tr('currentValue')} value={`₹${calcDepreciation(selectedAsset)!.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} /></Grid>
                      </Grid>
                    </>
                  )}

                  {selectedAsset.notes && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="subtitle2">{tr('notes')}</Typography>
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
                <ResponsiveTable>
                <TableContainer component={Card} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('date')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('type')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('from')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('to')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>By</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('notes')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedAsset.movements.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell data-label={tr('date')}>{formatDate(m.timestamp)}</TableCell>
                          <TableCell data-label={tr('type')}><Chip label={enumLabel(m.type)} size="small" variant="outlined" /></TableCell>
                          <TableCell data-label={tr('from')}>{m.fromLocation ?? m.fromStatus ?? '—'}</TableCell>
                          <TableCell data-label={tr('to')}>{m.toLocation ?? m.toStatus ?? '—'}</TableCell>
                          <TableCell data-label="By">{m.user.name}</TableCell>
                          <TableCell data-label={tr('notes')}>{m.reason ?? m.notes ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                </ResponsiveTable>
              ) : (
                <Typography color="text.secondary">{tr('noMovement')}</Typography>
              )}
            </CardContent>
          )}

          {/* Maintenance Tab */}
          {tab === 2 && (
            <CardContent>
              {selectedAsset.maintenances && selectedAsset.maintenances.length > 0 ? (
                <ResponsiveTable>
                <TableContainer component={Card} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('sentAt')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('reason')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('vendor')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('technician')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('cost')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('completed')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('finalCost')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedAsset.maintenances.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell data-label={tr('sentAt')}>{formatDate(m.sentAt)}</TableCell>
                          <TableCell data-label={tr('reason')}>{m.reason}</TableCell>
                          <TableCell data-label={tr('vendor')}>{m.maintenanceVendor ?? '—'}</TableCell>
                          <TableCell data-label={tr('technician')}>{m.technician ?? '—'}</TableCell>
                          <TableCell data-label={tr('cost')}>{m.cost ? `₹${Number(m.cost).toLocaleString('en-IN')}` : '—'}</TableCell>
                          <TableCell data-label={tr('completed')}>{m.completedAt ? formatDate(m.completedAt) : <Chip label={tr('pending')} size="small" color="warning" />}</TableCell>
                          <TableCell data-label={tr('finalCost')}>{m.finalCost ? `₹${Number(m.finalCost).toLocaleString('en-IN')}` : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                </ResponsiveTable>
              ) : (
                <Typography color="text.secondary">{tr('noMaint')}</Typography>
              )}
            </CardContent>
          )}

          {/* Scans Tab */}
          {tab === 3 && (
            <CardContent>
              {selectedAsset.scans && selectedAsset.scans.length > 0 ? (
                <ResponsiveTable>
                <TableContainer component={Card} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('timestamp')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('location')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('user')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedAsset.scans.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell data-label={tr('timestamp')}>{formatDate(s.timestamp)}</TableCell>
                          <TableCell data-label={tr('location')}>{s.location ?? '—'}</TableCell>
                          <TableCell data-label={tr('user')}>{s.user?.name ?? tr('anon')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                </ResponsiveTable>
              ) : (
                <Typography color="text.secondary">{tr('noScan')}</Typography>
              )}
            </CardContent>
          )}

          {/* Traceability Tab — full procurement chain */}
          {tab === 4 && (
            <CardContent>
              {traceLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
              ) : traceData ? (
                <TraceabilityChain trace={traceData} />
              ) : (
                <Typography color="text.secondary">{tr('noTrace')}</Typography>
              )}
            </CardContent>
          )}

          {/* Documents Tab */}
          {tab === 5 && (
            <CardContent>
              <AttachmentUpload entityType="ASSET" entityId={selectedAsset.id} />
            </CardContent>
          )}
        </Card>
      )}

      {/* Print QR Tags Dialog */}
      <ResponsiveDialog open={printOpen} onClose={() => { setPrintOpen(false); setSelectedAssetIds([]); }} maxWidth="md" fullWidth>
        <DialogTitle>{tr('printQrAssetTags')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {selectedAssetIds.length > 0
              ? tr('printingN', { n: selectedAssetIds.length })
              : tr('showingN', { n: rows.length })}
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
          <Button onClick={() => { setPrintOpen(false); setSelectedAssetIds([]); }}>{tr('close')}</Button>
          <Button variant="contained" startIcon={<PrintIcon />} onClick={() => {
            (selectedAssetIds.length > 0 ? selectedAssetIds : rows.filter((r) => r.status !== AssetStatus.RETIRED).map((r) => r.id))
              .forEach((id) => handlePrintLog(id));
            window.print();
          }}>{tr('print')}</Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Action Dialog */}
      <ResponsiveDialog open={!!actionDialog} onClose={() => setActionDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {actionDialog?.type === 'issue' && tr('tIssue')}
          {actionDialog?.type === 'return' && tr('tReturn')}
          {actionDialog?.type === 'relocate' && tr('tRelocate')}
          {actionDialog?.type === 'maintenance' && tr('tMaint')}
          {actionDialog?.type === 'maintenance/complete' && tr('tMaintDone')}
          {actionDialog?.type === 'retire' && tr('tRetire')}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {actionDialog?.type === 'issue' && (
              <>
                <TextField label={tr('issuedToDepartment')} value={String(actionForm.issuedToDept ?? '')} onChange={(e) => setActionForm({ ...actionForm, issuedToDept: e.target.value })} fullWidth size="small" />
                <TextField label={tr('issuedToPerson')} value={String(actionForm.issuedToPerson ?? '')} onChange={(e) => setActionForm({ ...actionForm, issuedToPerson: e.target.value })} fullWidth size="small" />
                <TextField label={tr('destinationLocation')} required value={String(actionForm.location ?? '')} onChange={(e) => setActionForm({ ...actionForm, location: e.target.value })} fullWidth size="small" />
                <TextField label={tr('notes')} value={String(actionForm.notes ?? '')} onChange={(e) => setActionForm({ ...actionForm, notes: e.target.value })} fullWidth size="small" multiline rows={2} />
              </>
            )}
            {actionDialog?.type === 'return' && (
              <>
                <TextField label={tr('returnToLocation')} value={String(actionForm.location ?? 'Main Store')} onChange={(e) => setActionForm({ ...actionForm, location: e.target.value })} fullWidth size="small" />
                <TextField label={tr('notes')} value={String(actionForm.notes ?? '')} onChange={(e) => setActionForm({ ...actionForm, notes: e.target.value })} fullWidth size="small" multiline rows={2} />
              </>
            )}
            {actionDialog?.type === 'relocate' && (
              <>
                <TextField label={tr('newLocation')} required value={String(actionForm.location ?? '')} onChange={(e) => setActionForm({ ...actionForm, location: e.target.value })} fullWidth size="small" />
                <TextField label={tr('reasonOptional')} value={String(actionForm.reason ?? '')} onChange={(e) => setActionForm({ ...actionForm, reason: e.target.value })} fullWidth size="small" multiline rows={2} />
              </>
            )}
            {actionDialog?.type === 'maintenance' && (
              <>
                <TextField label={tr('reason')} required value={String(actionForm.reason ?? '')} onChange={(e) => setActionForm({ ...actionForm, reason: e.target.value })} fullWidth size="small" multiline rows={2} />
                <TextField label={tr('maintenanceVendorOptional')} value={String(actionForm.maintenanceVendor ?? '')} onChange={(e) => setActionForm({ ...actionForm, maintenanceVendor: e.target.value })} fullWidth size="small" />
                <TextField label={tr('technicianOptional')} value={String(actionForm.technician ?? '')} onChange={(e) => setActionForm({ ...actionForm, technician: e.target.value })} fullWidth size="small" />
                <TextField label={tr('costOptional')} type="text" value={String(actionForm.cost ?? '')} onChange={(e) => setActionForm({ ...actionForm, cost: e.target.value })} fullWidth size="small" inputMode="decimal" InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
              </>
            )}
            {actionDialog?.type === 'maintenance/complete' && (
              <>
                <TextField label={tr('completionNotes')} value={String(actionForm.completionNotes ?? '')} onChange={(e) => setActionForm({ ...actionForm, completionNotes: e.target.value })} fullWidth size="small" multiline rows={2} />
                <TextField label={tr('finalCostOptional')} type="text" value={String(actionForm.finalCost ?? '')} onChange={(e) => setActionForm({ ...actionForm, finalCost: e.target.value })} fullWidth size="small" inputMode="decimal" InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
                <TextField label={tr('returnToLocation')} value={String(actionForm.returnToLocation ?? 'Main Store')} onChange={(e) => setActionForm({ ...actionForm, returnToLocation: e.target.value })} fullWidth size="small" />
              </>
            )}
            {actionDialog?.type === 'retire' && (
              <TextField label={tr('reason')} required value={String(actionForm.reason ?? '')} onChange={(e) => setActionForm({ ...actionForm, reason: e.target.value })} fullWidth size="small" multiline rows={2} />
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setActionDialog(null)}>{tr('cancel')}</Button>
          <Button variant="contained" onClick={() => actionMutation.mutate()} disabled={actionMutation.isPending}>
            {actionMutation.isPending ? <CircularProgress size={20} /> : tr('confirm')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Create Asset Dialog */}
      <ResponsiveDialog open={createOpen} onClose={() => { setCreateOpen(false); setCreateForm({ location: itemData?.location ?? 'Main Store' }); }} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('setupTitle', { name: itemData ? String(itemData.name) : tr('asset') })}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label={tr('location')} value={String(createForm.location ?? 'Main Store')} onChange={(e) => setCreateForm({ ...createForm, location: e.target.value })} fullWidth size="small" required />
            <TextField label={tr('serialNumber')} value={String(createForm.serialNumber ?? '')} onChange={(e) => setCreateForm({ ...createForm, serialNumber: e.target.value })} fullWidth size="small" />
            <TextField label={tr('udiUniqueDeviceIdentifier')} value={String(createForm.udi ?? '')} onChange={(e) => setCreateForm({ ...createForm, udi: e.target.value })} fullWidth size="small" />
            <TextField label={tr('gtinGlobalTradeItem')} value={String(createForm.gtin ?? '')} onChange={(e) => setCreateForm({ ...createForm, gtin: e.target.value })} fullWidth size="small" />
            <TextField label={tr('warrantyExpiry')} type="date" value={String(createForm.warrantyExpiry ?? '')} onChange={(e) => setCreateForm({ ...createForm, warrantyExpiry: e.target.value })} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField label={tr('amcVendor')} value={String(createForm.amcVendor ?? '')} onChange={(e) => setCreateForm({ ...createForm, amcVendor: e.target.value })} fullWidth size="small" />
            <TextField label={tr('amcExpiry')} type="date" value={String(createForm.amcExpiry ?? '')} onChange={(e) => setCreateForm({ ...createForm, amcExpiry: e.target.value })} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField label={tr('usefulLifeYears')} type="number" value={String(createForm.usefulLifeYears ?? '')} onChange={(e) => setCreateForm({ ...createForm, usefulLifeYears: e.target.value })} fullWidth size="small" inputProps={{ step: 0.5, min: 0 }} helperText={tr('forDepreciationCalculation')} />
            <TextField select label={tr('depreciationMethod')} value={String(createForm.depreciationMethod ?? '')} onChange={(e) => setCreateForm({ ...createForm, depreciationMethod: e.target.value })} fullWidth size="small">
              <MenuItem value="">{tr('none')}</MenuItem>
              <MenuItem value="STRAIGHT_LINE">{tr('straightLine')}</MenuItem>
              <MenuItem value="WRITTEN_DOWN_VALUE">{tr('wdv')}</MenuItem>
            </TextField>
            <TextField label={tr('salvageValue')} type="number" value={String(createForm.salvageValue ?? '')} onChange={(e) => setCreateForm({ ...createForm, salvageValue: e.target.value })} fullWidth size="small" inputProps={{ step: 0.01, min: 0 }} InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
            <TextField
              select
              label={tr('vendor')}
              value={String(createForm.vendorId ?? '')}
              onChange={(e) => {
                const vendorId = e.target.value;
                const vendor = vendors.find((v) => v.id === vendorId);
                setCreateForm({
                  ...createForm,
                  vendorId,
                  vendorName: vendor?.name ?? '',
                  poId: '',
                  poNumber: '',
                  invoiceId: '',
                  invoiceNumber: '',
                });
              }}
              fullWidth
              size="small"
            >
              <MenuItem value=""><em>{tr('selectAVendor')}</em></MenuItem>
              {vendors.map((v) => <MenuItem key={v.id} value={v.id}>{v.name}</MenuItem>)}
            </TextField>
            <TextField
              select
              label={tr('poNumber')}
              value={String(createForm.poId ?? '')}
              onChange={(e) => {
                const poId = e.target.value;
                const po = purchaseOrders.find((p) => p.id === poId);
                setCreateForm({ ...createForm, poId, poNumber: po?.poNumber ?? '' });
              }}
              fullWidth
              size="small"
              disabled={!createForm.vendorId}
            >
              <MenuItem value=""><em>{tr('selectAPo')}</em></MenuItem>
              {purchaseOrders.map((p) => <MenuItem key={p.id} value={p.id}>{p.poNumber}</MenuItem>)}
            </TextField>
            <TextField
              select
              label={tr('invoiceNumber')}
              value={String(createForm.invoiceId ?? '')}
              onChange={(e) => {
                const invoiceId = e.target.value;
                const invoice = invoices.find((i) => i.id === invoiceId);
                setCreateForm({ ...createForm, invoiceId, invoiceNumber: invoice?.invoiceNumber ?? '' });
              }}
              fullWidth
              size="small"
              disabled={!createForm.vendorId}
            >
              <MenuItem value=""><em>{tr('selectAnInvoice')}</em></MenuItem>
              {invoices.map((i) => <MenuItem key={i.id} value={i.id}>{i.invoiceNumber}</MenuItem>)}
            </TextField>
            <TextField label={tr('receiptNumber')} value={String(createForm.receiptNumber ?? '')} onChange={(e) => setCreateForm({ ...createForm, receiptNumber: e.target.value })} fullWidth size="small" />
            <TextField label={tr('unitPrice')} type="number" value={String(createForm.unitPrice ?? '')} onChange={(e) => setCreateForm({ ...createForm, unitPrice: e.target.value })} fullWidth size="small" inputProps={{ step: 0.01, min: 0 }} InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
            <TextField label={tr('totalCostInclGst')} type="number" value={String(createForm.totalCost ?? '')} onChange={(e) => setCreateForm({ ...createForm, totalCost: e.target.value })} fullWidth size="small" inputProps={{ step: 0.01, min: 0 }} InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
            <TextField label={tr('purchaseReceiptDate')} type="date" value={String(createForm.receiptDate ?? '')} onChange={(e) => setCreateForm({ ...createForm, receiptDate: e.target.value })} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField label={tr('notes')} value={String(createForm.notes ?? '')} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} fullWidth size="small" multiline rows={2} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => { setCreateOpen(false); setCreateForm({ location: itemData?.location ?? 'Main Store' }); }}>{tr('cancel')}</Button>
          <Button variant="contained" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? <CircularProgress size={20} /> : tr('setupAsset')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Edit Details Dialog */}
      <ResponsiveDialog open={!!editDialog} onClose={() => setEditDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('editTitle', { id: editDialog?.asset.assetId })}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label={tr('serialNumber')} value={String(editForm.serialNumber ?? '')} onChange={(e) => setEditForm({ ...editForm, serialNumber: e.target.value })} fullWidth size="small" />
            <TextField label={tr('udiUniqueDeviceIdentifier')} value={String(editForm.udi ?? '')} onChange={(e) => setEditForm({ ...editForm, udi: e.target.value })} fullWidth size="small" helperText={tr('scannedFromManufacturerS')} />
            <TextField label={tr('gtinGlobalTradeItem')} value={String(editForm.gtin ?? '')} onChange={(e) => setEditForm({ ...editForm, gtin: e.target.value })} fullWidth size="small" helperText={tr('gs1StandardProductIdentifier')} />
            <TextField label={tr('warrantyExpiry')} type="date" value={String(editForm.warrantyExpiry ?? '')} onChange={(e) => setEditForm({ ...editForm, warrantyExpiry: e.target.value })} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField label={tr('amcVendor')} value={String(editForm.amcVendor ?? '')} onChange={(e) => setEditForm({ ...editForm, amcVendor: e.target.value })} fullWidth size="small" />
            <TextField label={tr('amcExpiry')} type="date" value={String(editForm.amcExpiry ?? '')} onChange={(e) => setEditForm({ ...editForm, amcExpiry: e.target.value })} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField label={tr('usefulLifeYears')} type="number" value={String(editForm.usefulLifeYears ?? '')} onChange={(e) => setEditForm({ ...editForm, usefulLifeYears: e.target.value })} fullWidth size="small" inputProps={{ step: 0.5, min: 0 }} helperText={tr('forDepreciationCalculation')} />
            <TextField select label={tr('depreciationMethod')} value={String(editForm.depreciationMethod ?? '')} onChange={(e) => setEditForm({ ...editForm, depreciationMethod: e.target.value })} fullWidth size="small">
              <MenuItem value="">{tr('none')}</MenuItem>
              <MenuItem value="STRAIGHT_LINE">{tr('straightLine')}</MenuItem>
              <MenuItem value="WRITTEN_DOWN_VALUE">{tr('wdv')}</MenuItem>
            </TextField>
            <TextField label={tr('salvageValue')} type="number" value={String(editForm.salvageValue ?? '')} onChange={(e) => setEditForm({ ...editForm, salvageValue: e.target.value })} fullWidth size="small" inputProps={{ step: 0.01, min: 0 }} InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} helperText={tr('residualValueAtEnd')} />
            <TextField label={tr('notes')} value={String(editForm.notes ?? '')} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} fullWidth size="small" multiline rows={2} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setEditDialog(null)}>{tr('cancel')}</Button>
          <Button variant="contained" onClick={() => editMutation.mutate()} disabled={editMutation.isPending}>
            {editMutation.isPending ? <CircularProgress size={20} /> : tr('saveDetails')}
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
