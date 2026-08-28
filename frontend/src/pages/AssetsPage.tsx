import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Chip,
  Alert,
  CircularProgress,
  MenuItem,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Grid,
  Divider,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Download as DownloadIcon,
  Print as PrintIcon,
  ViewModule as ViewModuleIcon,
  ViewList as ViewListIcon,
  QrCode as QrCodeIcon,
  Warning as WarningIcon,
  Devices as DevicesIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { AssetStatus } from '@hospital-erp/shared';
import { enumToOptions, formatDate } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from '../components/ResponsiveDialog';

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

interface AssetRow {
  id: string;
  assetId: string;
  serialNumber: string | null;
  status: string;
  location: string;
  issuedToDept: string | null;
  issuedToPerson: string | null;
  issuedAt: string | null;
  lastScannedAt: string | null;
  warrantyExpiry: string | null;
  amcExpiry: string | null;
  udi: string | null;
  gtin: string | null;
  totalCost: string | null;
  inventoryItem: { id: string; name: string; category: string | null; unit: string };
}

export default function AssetsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(24);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [printOpen, setPrintOpen] = useState(false);
  const [error, setError] = useState('');

  const { data: statsData } = useQuery({
    queryKey: ['/assets/stats'],
    queryFn: async () => {
      const response = await api.get('/assets/stats');
      return response.data;
    },
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/assets', 'all', page, pageSize, statusFilter, search],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;
      const response = await api.get('/assets', { params });
      return response.data;
    },
  });

  const rows: AssetRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 24, total: 0, totalPages: 0 };

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

  const qrBaseUrl = import.meta.env.VITE_QR_BASE_URL || import.meta.env.VITE_API_URL?.replace('/api', '') || window.location.origin;

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
        <DevicesIcon color="primary" />
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          Asset Management
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport} size="small">Export CSV</Button>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => setPrintOpen(true)} size="small" disabled={rows.length === 0}>Print QR Tags</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Stats Dashboard */}
      {statsData && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined">
              <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                <Typography variant="h4" fontWeight={700} color="primary">{statsData.total}</Typography>
                <Typography variant="caption" color="text.secondary">Total Assets</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined">
              <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                <Typography variant="h4" fontWeight={700} color="success.main">{statsData.statusCounts?.ACTIVE ?? 0}</Typography>
                <Typography variant="caption" color="text.secondary">Active</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined" sx={{ borderColor: statsData.warrantyExpiring > 0 ? 'warning.main' : undefined }}>
              <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                <Typography variant="h4" fontWeight={700} color={statsData.warrantyExpiring > 0 ? 'warning.main' : 'text.secondary'}>
                  {statsData.warrantyExpiring ?? 0}
                </Typography>
                <Typography variant="caption" color="text.secondary">Warranty Expiring (30d)</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined" sx={{ borderColor: statsData.amcExpiring > 0 ? 'warning.main' : undefined }}>
              <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                <Typography variant="h4" fontWeight={700} color={statsData.amcExpiring > 0 ? 'warning.main' : 'text.secondary'}>
                  {statsData.amcExpiring ?? 0}
                </Typography>
                <Typography variant="caption" color="text.secondary">AMC Expiring (30d)</Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Status chips */}
      {statsData && (
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          {Object.entries(statsData.statusCounts ?? {}).map(([status, count]) => (
            <Chip
              key={status}
              label={`${STATUS_LABELS[status] ?? status}: ${count}`}
              color={STATUS_COLORS[status] ?? 'default'}
              size="small"
              variant={statusFilter === status ? 'filled' : 'outlined'}
              onClick={() => { setStatusFilter(statusFilter === status ? '' : status); setPage(0); }}
            />
          ))}
          {statsData.totalValue > 0 && (
            <Chip label={`Total Value: ₹${Number(statsData.totalValue).toLocaleString('en-IN')}`} color="primary" variant="outlined" size="small" />
          )}
        </Box>
      )}

      {/* Filters + View Toggle */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Search by Asset ID, Serial, UDI, GTIN..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          sx={{ width: { xs: '100%', sm: 300 } }}
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
        <Box sx={{ flexGrow: 1 }} />
        <ToggleButtonGroup
          value={view}
          exclusive
          onChange={(_, v) => v && setView(v)}
          size="small"
        >
          <ToggleButton value="cards"><ViewModuleIcon /></ToggleButton>
          <ToggleButton value="table"><ViewListIcon /></ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Content */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : rows.length === 0 ? (
        <Card variant="outlined">
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <DevicesIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
            <Typography color="text.secondary">No assets found. Assets are created automatically when goods receipts are posted for ASSET-type inventory items.</Typography>
          </CardContent>
        </Card>
      ) : view === 'cards' ? (
        <>
          <Grid container spacing={2}>
            {rows.map((asset) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={asset.id}>
                <Card
                  variant="outlined"
                  sx={{ cursor: 'pointer', height: '100%', '&:hover': { boxShadow: 3 } }}
                  onClick={() => navigate(`/assets/${asset.inventoryItem.id}`)}
                >
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                      <Typography variant="h6" fontWeight={700} color="primary">{asset.assetId}</Typography>
                      <Chip label={STATUS_LABELS[asset.status] ?? asset.status} size="small" color={STATUS_COLORS[asset.status] ?? 'default'} />
                    </Box>
                    <Typography variant="body2" fontWeight={600} noWrap>{asset.inventoryItem.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {asset.inventoryItem.category ?? 'Uncategorized'}
                    </Typography>
                    <Divider sx={{ my: 1 }} />
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Box>
                        <Typography variant="caption" color="text.secondary" display="block">Location</Typography>
                        <Typography variant="body2">{asset.location}</Typography>
                      </Box>
                      <QrCodeIcon color="action" />
                    </Box>
                    {asset.issuedToDept || asset.issuedToPerson ? (
                      <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.5 }}>
                        Issued to: {asset.issuedToDept ?? ''}{asset.issuedToDept && asset.issuedToPerson ? ' / ' : ''}{asset.issuedToPerson ?? ''}
                      </Typography>
                    ) : null}
                    {isExpiringSoon(asset.warrantyExpiry) && (
                      <Chip icon={<WarningIcon />} label="Warranty expiring" size="small" color="warning" sx={{ mt: 0.5 }} />
                    )}
                    {isExpiringSoon(asset.amcExpiry) && (
                      <Chip icon={<WarningIcon />} label="AMC expiring" size="small" color="warning" sx={{ mt: 0.5 }} />
                    )}
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
          <TablePagination
            component="div"
            count={pagination.total}
            page={page}
            onPageChange={(_e, p) => setPage(p)}
            rowsPerPage={pageSize}
            onRowsPerPageChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[12, 24, 48]}
            sx={{ '& .MuiTablePagination-toolbar': { flexWrap: 'wrap' } }}
          />
        </>
      ) : (
        <Card>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Asset ID</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Category</TableCell>
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
                {rows.map((row) => (
                  <TableRow key={row.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/assets/${row.inventoryItem.id}`)}>
                    <TableCell data-label="Asset ID"><strong>{row.assetId}</strong></TableCell>
                    <TableCell data-label="Name">{row.inventoryItem.name}</TableCell>
                    <TableCell data-label="Category">{row.inventoryItem.category ?? '—'}</TableCell>
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
                      <IconButton size="small" onClick={() => navigate(`/assets/${row.inventoryItem.id}`)}><QrCodeIcon fontSize="small" /></IconButton>
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
            rowsPerPageOptions={[12, 24, 48]}
            sx={{ '& .MuiTablePagination-toolbar': { flexWrap: 'wrap' } }}
          />
        </Card>
      )}

      {/* Print QR Tags Dialog */}
      <ResponsiveDialog open={printOpen} onClose={() => setPrintOpen(false)} maxWidth="md" fullWidth>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pr: 2 }}>
          <Typography variant="h6" sx={{ p: 2 }}>Print QR Asset Tags</Typography>
          <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()} sx={{ mr: 2 }}>Print</Button>
        </Box>
        <Divider />
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {rows.filter((r) => r.status !== AssetStatus.RETIRED).length} asset tag(s) ready to print. Use your browser's print dialog (Ctrl+P) and select A4 paper.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 2 }} className="print-area">
            {rows.filter((r) => r.status !== AssetStatus.RETIRED).map((asset) => (
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
        </Box>
      </ResponsiveDialog>
    </Box>
  );
}
