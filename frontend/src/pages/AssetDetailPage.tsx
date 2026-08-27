import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TextField,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Alert,
  CircularProgress,
  MenuItem,
  IconButton,
} from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import {
  ArrowBack as ArrowBackIcon,
  Download as DownloadIcon,
  Print as PrintIcon,
  QrCode as QrCodeIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { AssetStatus, UserRole } from '@hospital-erp/shared';
import { enumToOptions, formatDate } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveTable from '../components/ResponsiveTable';
import { useAuthStore } from '../stores/authStore';

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

export default function AssetDetailPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [printOpen, setPrintOpen] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [actionDialog, setActionDialog] = useState<{ type: string; assetId: string } | null>(null);
  const [actionForm, setActionForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const canRetire = user && (user.role === UserRole.ADMIN || user.role === UserRole.ADMIN_2);

  const { data: itemData } = useQuery({
    queryKey: ['/inventory/items', itemId],
    queryFn: async () => {
      const response = await api.get('/inventory/items', { params: { search: '', pageSize: 100 } });
      return (response.data?.data as Record<string, unknown>[]).find((i) => i.id === itemId);
    },
    enabled: !!itemId,
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/assets', itemId, page, pageSize, statusFilter, search],
    queryFn: async () => {
      const params: Record<string, unknown> = {
        inventoryItemId: itemId,
        page: page + 1,
        pageSize,
      };
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
      const url = `/assets/${assetId}/${type}`;
      await api.post(url, actionForm);
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

  const rows: Record<string, unknown>[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  // Status summary
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

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={() => navigate('/inventory')}><ArrowBackIcon /></IconButton>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          {itemData ? String(itemData.name) : 'Asset'} — Units
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport} size="small">Export CSV</Button>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => setPrintOpen(true)} size="small" disabled={rows.length === 0}>Print QR Stickers</Button>
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
          placeholder="Search by Asset ID or Serial..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          sx={{ width: { xs: '100%', sm: 250 } }}
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

      <Card>
        <ResponsiveTable>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Asset ID</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Serial</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Location</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Issued To</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Last Scanned</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>QR</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No assets found</Typography></TableCell></TableRow>
                ) : rows.map((row) => (
                  <TableRow key={row.id as string} hover>
                    <TableCell data-label="Asset ID"><strong>{String(row.assetId)}</strong></TableCell>
                    <TableCell data-label="Serial">{String(row.serialNumber ?? '—')}</TableCell>
                    <TableCell data-label="Status">
                      <Chip label={STATUS_LABELS[String(row.status)] ?? String(row.status)} size="small" color={STATUS_COLORS[String(row.status)] ?? 'default'} />
                    </TableCell>
                    <TableCell data-label="Location">{String(row.location ?? '—')}</TableCell>
                    <TableCell data-label="Issued To">
                      {row.issuedToDept || row.issuedToPerson
                        ? `${row.issuedToDept ?? ''}${row.issuedToDept && row.issuedToPerson ? ' / ' : ''}${row.issuedToPerson ?? ''}`
                        : '—'}
                    </TableCell>
                    <TableCell data-label="Last Scanned">{row.lastScannedAt ? formatDate(row.lastScannedAt) : '—'}</TableCell>
                    <TableCell data-label="QR">
                      <IconButton size="small" onClick={() => { handlePrintLog(row.id as string); setPrintOpen(true); setSelectedAssetIds([row.id as string]); }}>
                        <QrCodeIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                    <TableCell align="right" data-label="Actions">
                      {row.status === AssetStatus.ACTIVE && (
                        <>
                          <Button size="small" onClick={() => openAction('issue', row.id as string)}>Issue</Button>
                          <Button size="small" onClick={() => openAction('maintenance', row.id as string)}>Maintenance</Button>
                          <Button size="small" onClick={() => openAction('relocate', row.id as string)}>Relocate</Button>
                        </>
                      )}
                      {row.status === AssetStatus.ISSUED && (
                        <>
                          <Button size="small" onClick={() => openAction('return', row.id as string)}>Return</Button>
                          <Button size="small" onClick={() => openAction('maintenance', row.id as string)}>Maintenance</Button>
                        </>
                      )}
                      {row.status === AssetStatus.UNDER_MAINTENANCE && (
                        <Button size="small" onClick={() => openAction('maintenance/complete', row.id as string)}>Complete</Button>
                      )}
                      {canRetire && row.status !== AssetStatus.RETIRED && (
                        <Button size="small" color="error" onClick={() => openAction('retire', row.id as string)}>Retire</Button>
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

      {/* Print QR Stickers Dialog */}
      <ResponsiveDialog open={printOpen} onClose={() => { setPrintOpen(false); setSelectedAssetIds([]); }} maxWidth="md" fullWidth>
        <DialogTitle>Print QR Stickers</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {selectedAssetIds.length > 0
              ? `Printing ${selectedAssetIds.length} sticker(s). Use your browser's print dialog (Ctrl+P) and select A4 paper.`
              : `Showing all ${rows.length} assets. Use your browser's print dialog (Ctrl+P) and select A4 paper.`}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
            {(selectedAssetIds.length > 0
              ? rows.filter((r) => selectedAssetIds.includes(r.id as string))
              : rows.filter((r) => r.status !== AssetStatus.RETIRED)
            ).map((asset) => (
              <Card key={asset.id as string} variant="outlined" sx={{ textAlign: 'center', p: 1 }}>
                <QRCodeSVG value={`${qrBaseUrl}/scan/${String(asset.assetId)}`} size={120} level="M" />
                <Typography variant="caption" fontWeight={600} display="block">{String(asset.assetId)}</Typography>
                <Typography variant="caption" color="text.secondary">{String(itemData?.name ?? '')}</Typography>
              </Card>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => { setPrintOpen(false); setSelectedAssetIds([]); }}>Close</Button>
          <Button variant="contained" startIcon={<PrintIcon />} onClick={() => {
            (selectedAssetIds.length > 0 ? selectedAssetIds : rows.filter((r) => r.status !== AssetStatus.RETIRED).map((r) => r.id as string))
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
                <TextField label="Cost (optional)" type="text" value={String(actionForm.cost ?? '')} onChange={(e) => setActionForm({ ...actionForm, cost: e.target.value })} fullWidth size="small" inputMode="decimal" />
              </>
            )}
            {actionDialog?.type === 'maintenance/complete' && (
              <>
                <TextField label="Completion Notes" value={String(actionForm.completionNotes ?? '')} onChange={(e) => setActionForm({ ...actionForm, completionNotes: e.target.value })} fullWidth size="small" multiline rows={2} />
                <TextField label="Final Cost (optional)" type="text" value={String(actionForm.finalCost ?? '')} onChange={(e) => setActionForm({ ...actionForm, finalCost: e.target.value })} fullWidth size="small" inputMode="decimal" />
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
          <Button
            variant="contained"
            onClick={() => actionMutation.mutate()}
            disabled={actionMutation.isPending}
          >
            {actionMutation.isPending ? <CircularProgress size={20} /> : 'Confirm'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
