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
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Grid,
  Divider,
} from '@mui/material';
import {
  Download as DownloadIcon,
  ViewModule as ViewModuleIcon,
  ViewList as ViewListIcon,
  Devices as DevicesIcon,
  QrCode as QrCodeIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import RefreshButton from '../components/RefreshButton';

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

interface InventoryItemRow {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  location: string | null;
  currentStock: string;
}

export default function AssetsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(24);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [error, setError] = useState('');

  // Aggregate stats across all asset units (total units, status counts, expiring warranties/AMCs)
  const { data: statsData } = useQuery({
    queryKey: ['/assets/stats'],
    queryFn: async () => {
      const response = await api.get('/assets/stats');
      return response.data;
    },
  });

  // ASSET-type inventory items — the asset register at the item level.
  // For asset items, currentStock equals the number of received units (each
  // received unit becomes an individually tracked asset record via goods receipt).
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/inventory/items', 'ASSET', page, pageSize, search],
    queryFn: async () => {
      const params: Record<string, unknown> = { itemType: 'ASSET', page: page + 1, pageSize };
      if (search) params.search = search;
      const response = await api.get('/inventory/items', { params });
      return response.data;
    },
  });

  const items: InventoryItemRow[] = data?.data ?? [];
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

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <DevicesIcon color="primary" />
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          Asset Management
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <RefreshButton onClick={() => refetch()} />
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport} size="small">Export CSV</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Stats Dashboard */}
      {statsData && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined">
              <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                <Typography variant="h4" fontWeight={700} color="primary">{pagination.total}</Typography>
                <Typography variant="caption" color="text.secondary">Asset Items</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined">
              <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                <Typography variant="h4" fontWeight={700} color="success.main">{statsData.total}</Typography>
                <Typography variant="caption" color="text.secondary">Total Units</Typography>
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

      {/* Status chips across all units */}
      {statsData && (
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          {Object.entries(statsData.statusCounts ?? {}).map(([status, count]) => (
            <Chip
              key={status}
              label={`${STATUS_LABELS[status] ?? status}: ${count}`}
              color={STATUS_COLORS[status] ?? 'default'}
              size="small"
              variant="outlined"
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
          placeholder="Search asset items by name or SKU..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          sx={{ width: { xs: '100%', sm: 320 } }}
        />
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
      ) : items.length === 0 ? (
        <Card variant="outlined">
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <DevicesIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
            <Typography color="text.secondary">No asset items yet. Create an inventory item with type &quot;Asset&quot; to get started.</Typography>
          </CardContent>
        </Card>
      ) : view === 'cards' ? (
        <>
          <Grid container spacing={2}>
            {items.map((item) => {
              const unitCount = Number(item.currentStock);
              return (
                <Grid item xs={12} sm={6} md={4} lg={3} key={item.id}>
                  <Card
                    variant="outlined"
                    sx={{ cursor: 'pointer', height: '100%', '&:hover': { boxShadow: 3 } }}
                    onClick={() => navigate(`/assets/${item.id}`)}
                  >
                    <CardContent>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                        <Typography variant="h6" fontWeight={700} noWrap>{item.name}</Typography>
                        <QrCodeIcon color="action" />
                      </Box>
                      <Typography variant="caption" color="text.secondary">{item.category ?? 'Uncategorized'}</Typography>
                      <Typography variant="caption" color="text.secondary" display="block">SKU: {item.sku ?? '—'}</Typography>
                      <Divider sx={{ my: 1 }} />
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box>
                          <Typography variant="caption" color="text.secondary" display="block">Units</Typography>
                          <Typography variant="h6" fontWeight={700} color="primary">{unitCount}</Typography>
                        </Box>
                        <Box sx={{ textAlign: 'right' }}>
                          <Typography variant="caption" color="text.secondary" display="block">Location</Typography>
                          <Typography variant="body2">{item.location ?? '—'}</Typography>
                        </Box>
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
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
                  <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>SKU</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Category</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Units</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Location</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item) => {
                  const unitCount = Number(item.currentStock);
                  return (
                    <TableRow key={item.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/assets/${item.id}`)}>
                      <TableCell data-label="Name"><strong>{item.name}</strong></TableCell>
                      <TableCell data-label="SKU">{item.sku ?? '—'}</TableCell>
                      <TableCell data-label="Category">{item.category ?? '—'}</TableCell>
                      <TableCell data-label="Units">{unitCount}</TableCell>
                      <TableCell data-label="Location">{item.location ?? '—'}</TableCell>
                      <TableCell align="right" data-label="Actions" onClick={(e) => e.stopPropagation()}>
                        <IconButton size="small" onClick={() => navigate(`/assets/${item.id}`)} title="View units"><QrCodeIcon fontSize="small" /></IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
    </Box>
  );
}
