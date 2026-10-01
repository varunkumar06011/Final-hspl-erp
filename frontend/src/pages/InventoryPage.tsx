import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  IconButton,
  Chip,
  Alert,
  CircularProgress,
  MenuItem,
  InputAdornment,
  Tabs,
  Tab,
  Grid,
  Stack,
  LinearProgress,
} from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  SwapVert as SwapVertIcon,
  PhotoCamera as PhotoCameraIcon,
  Inventory2 as ItemsIcon,
  History as HistoryIcon,
  Warning as WarningIcon,
  Category as CategoryIcon,
  Layers as LayersIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { InventoryTxnType, InventoryItemType } from '@hospital-erp/shared';
import { enumToOptions, formatIndianNumber } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import CreatableSelect from '../components/CreatableSelect';
import AttachmentUpload from '../components/AttachmentUpload';
import ResponsiveTable from '../components/ResponsiveTable';
import RefreshButton from '../components/RefreshButton';

import { useTranslation } from 'react-i18next';
import FilePicker from '../components/FilePicker';
export default function InventoryPage() {
  const { t: tr } = useTranslation('inventory');
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [txnDialogOpen, setTxnDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [txnForm, setTxnForm] = useState<Record<string, unknown>>({});
  const [txnPhoto, setTxnPhoto] = useState<File | null>(null);
  const [attachmentTransactionId, setAttachmentTransactionId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const endpoint = tab === 0 ? '/inventory/items' : '/inventory/transactions';

  const { data, isLoading, refetch } = useQuery({
    queryKey: [endpoint, page, pageSize, search],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      const response = await api.get(endpoint, { params });
      return response.data;
    },
  });

  // Fetch all items (up to 100) for summary stats — independent of pagination/search
  const { data: statsData } = useQuery({
    queryKey: ['/inventory/items', 'stats'],
    queryFn: async () => {
      const response = await api.get('/inventory/items', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
  });
  const statsItems: Record<string, unknown>[] = statsData?.data ?? [];
  const stats = {
    total: statsItems.length,
    lowStock: statsItems.filter(
      (i) => Number(i.minStockLevel) > 0 && Number(i.currentStock) <= Number(i.minStockLevel),
    ).length,
    assets: statsItems.filter((i) => i.itemType === InventoryItemType.ASSET).length,
    consumables: statsItems.filter((i) => i.itemType === InventoryItemType.CONSUMABLE).length,
  };

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await api.post('/inventory/items', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/inventory/items'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setDialogOpen(false);
      setForm({});
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) => {
      const response = await api.patch(`/inventory/items/${id}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/inventory/items'] });
      setDialogOpen(false);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/inventory/items/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/inventory/items'] });
      setDeleteConfirm(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const txnMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await api.post('/inventory/transactions', payload);
      let photoUploadFailed = false;
      if (txnPhoto) {
        const formData = new FormData();
        formData.append('file', txnPhoto);
        formData.append('entityType', 'INVENTORY_TRANSACTION');
        formData.append('entityId', response.data.id);
        try {
          await api.post('/attachments/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch {
          photoUploadFailed = true;
        }
      }
      return { transaction: response.data, photoUploadFailed };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/inventory/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/inventory/items'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setTxnDialogOpen(false);
      setTxnForm({});
      setTxnPhoto(null);
      if (data.photoUploadFailed) setError(tr('photoFail'));
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  const openCreate = () => {
    setForm({ name: '', unit: 'nos', itemType: InventoryItemType.CONSUMABLE, currentStock: 0, minStockLevel: 0 });
    setEditing(null);
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (row: Record<string, unknown>) => {
    setForm({
      name: row.name ?? '', sku: row.sku ?? '', category: row.category ?? '',
      unit: row.unit ?? 'nos',
      itemType: row.itemType ?? InventoryItemType.CONSUMABLE,
      currentStock: row.currentStock ?? 0,
      minStockLevel: row.minStockLevel ?? 0, location: row.location ?? '',
    });
    setEditing(row);
    setError('');
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!String(form.name ?? '').trim() || !String(form.unit ?? '').trim()) {
      setError(tr('errNameUnit'));
      return;
    }
    // For new items, currentStock is not user-editable (always 0)
    const valuesToCheck = editing ? [form.currentStock, form.minStockLevel] : [form.minStockLevel];
    if (!valuesToCheck.every((value) => Number.isFinite(Number(value)) && Number(value) >= 0)) {
      setError(tr('errStock'));
      return;
    }
    setError('');
    if (editing) {
      const { currentStock, ...updatePayload } = form;
      updateMutation.mutate({ id: editing.id as string, payload: updatePayload });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleTransactionSubmit = () => {
    if (!txnForm.itemId || !txnForm.type || !Number.isFinite(Number(txnForm.quantity)) || Number(txnForm.quantity) <= 0) {
      setError(tr('errQty'));
      return;
    }
    setError('');
    txnMutation.mutate(txnForm);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>{tr('title')}</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <RefreshButton onClick={() => refetch()} />
          {tab === 0 && (
            <>
              <Button variant="outlined" startIcon={<SwapVertIcon />} onClick={() => { setTxnForm({ type: InventoryTxnType.OUT, quantity: 0 }); setTxnPhoto(null); setTxnDialogOpen(true); }}>
                {tr('stockMovement')}
              </Button>
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{tr('newItem')}</Button>
            </>
          )}
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Summary stat cards */}
      {tab === 0 && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={6} sm={3}>
            <Card sx={{ p: 2, height: '100%' }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Box sx={{ color: 'primary.main', mt: 0.5 }}><ItemsIcon /></Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">{tr('totalItems')}</Typography>
                  <Typography variant="h6" sx={{ color: 'primary.main', fontWeight: 600 }}>{stats.total}</Typography>
                </Box>
              </Stack>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card sx={{ p: 2, height: '100%', borderColor: stats.lowStock > 0 ? 'error.main' : undefined }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Box sx={{ color: stats.lowStock > 0 ? 'error.main' : 'text.secondary', mt: 0.5 }}><WarningIcon /></Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">{tr('lowStock')}</Typography>
                  <Typography variant="h6" sx={{ color: stats.lowStock > 0 ? 'error.main' : 'text.primary', fontWeight: 600 }}>{stats.lowStock}</Typography>
                </Box>
              </Stack>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card sx={{ p: 2, height: '100%' }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Box sx={{ color: 'secondary.main', mt: 0.5 }}><LayersIcon /></Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">{tr('assets')}</Typography>
                  <Typography variant="h6" sx={{ color: 'secondary.main', fontWeight: 600 }}>{stats.assets}</Typography>
                </Box>
              </Stack>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card sx={{ p: 2, height: '100%' }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Box sx={{ color: 'success.main', mt: 0.5 }}><CategoryIcon /></Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">{tr('consumables')}</Typography>
                  <Typography variant="h6" sx={{ color: 'success.main', fontWeight: 600 }}>{stats.consumables}</Typography>
                </Box>
              </Stack>
            </Card>
          </Grid>
        </Grid>
      )}

      <Tabs
        value={tab}
        onChange={(_, v) => { setTab(v); setPage(0); }}
        sx={{ mb: 2 }}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
      >
        <Tab icon={<ItemsIcon />} iconPosition="start" label={tr('items')} />
        <Tab icon={<HistoryIcon />} iconPosition="start" label={tr('transactions')} />
      </Tabs>

      <Card sx={{ overflow: 'hidden' }}>
        {tab === 0 && (
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <TextField
              size="small"
              placeholder={tr('search')}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
              sx={{ width: { xs: '100%', sm: 300 } }}
            />
            {stats.lowStock > 0 && (
              <Chip
                icon={<WarningIcon />}
                color="error"
                size="small"
                label={tr('lowChip', { count: stats.lowStock })}
                variant="outlined"
              />
            )}
          </Box>
        )}

        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              {tab === 0 ? (
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('name')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('sku')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('category')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('type')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('unit')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('stock')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('minLevel')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('location')}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('actions')}</TableCell>
                </TableRow>
              ) : (
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('item')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('type')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('qty')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('balanceAfter')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('gatePass')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('notes')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('proof')}</TableCell>
                </TableRow>
              )}
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} align="center" sx={{ py: 6 }}>
                    <Stack spacing={1} alignItems="center">
                      <ItemsIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
                      <Typography color="text.secondary">
                        {tab === 0 ? tr('emptyItems') : tr('emptyMoves')}
                      </Typography>
                    </Stack>
                  </TableCell>
                </TableRow>
              ) : tab === 0 ? (
                rows.map((row: Record<string, unknown>) => {
                  const currentStock = Number(row.currentStock);
                  const minStock = Number(row.minStockLevel);
                  const lowStock = minStock > 0 && currentStock <= minStock;
                  const outOfStock = currentStock === 0;
                  const isAsset = row.itemType === InventoryItemType.ASSET;
                  const stockPct = minStock > 0 ? Math.min(100, (currentStock / (minStock * 2)) * 100) : 100;
                  return (
                    <TableRow
                      key={row.id as string}
                      hover
                      sx={{
                        ...(isAsset ? { cursor: 'pointer' } : {}),
                        ...(lowStock ? { bgcolor: 'rgba(211, 47, 47, 0.04)' } : {}),
                      }}
                      onClick={isAsset ? () => navigate(`/assets/${row.id}`) : undefined}
                    >
                      <TableCell data-label={tr('name')} sx={{ fontWeight: 500 }}>{String(row.name ?? '—')}</TableCell>
                      <TableCell data-label={tr('sku')}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'text.secondary' }}>
                          {String(row.sku ?? '—')}
                        </Typography>
                      </TableCell>
                      <TableCell data-label={tr('category')}>
                        {row.category ? <Chip label={String(row.category)} size="small" variant="outlined" /> : '—'}
                      </TableCell>
                      <TableCell data-label={tr('type')}>
                        <Chip
                          label={isAsset ? tr('asset') : tr('consumable')}
                          size="small"
                          color={isAsset ? 'secondary' : 'primary'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell data-label={tr('unit')}>{String(row.unit ?? '—')}</TableCell>
                      <TableCell data-label={tr('stock')}>
                        {isAsset ? (
                          <Chip label={tr('seeAssets')} size="small" color="secondary" variant="outlined" onClick={(e) => { e.stopPropagation(); navigate(`/assets/${row.id}`); }} />
                        ) : (
                          <Stack spacing={0.5} sx={{ minWidth: 80 }}>
                            <Stack direction="row" spacing={0.5} alignItems="center">
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 600,
                                  color: outOfStock ? 'error.main' : lowStock ? 'warning.main' : 'text.primary',
                                }}
                              >
                                {formatIndianNumber(currentStock)}
                              </Typography>
                              {outOfStock && <Chip label={tr('out')} size="small" color="error" sx={{ height: 16, '& .MuiChip-label': { px: 0.5, fontSize: '0.6rem' } }} />}
                              {!outOfStock && lowStock && <Chip label={tr('low')} size="small" color="warning" sx={{ height: 16, '& .MuiChip-label': { px: 0.5, fontSize: '0.6rem' } }} />}
                            </Stack>
                            {minStock > 0 && (
                              <LinearProgress
                                variant="determinate"
                                value={stockPct}
                                color={outOfStock ? 'error' : lowStock ? 'warning' : 'success'}
                                sx={{ height: 4, borderRadius: 2 }}
                              />
                            )}
                          </Stack>
                        )}
                      </TableCell>
                      <TableCell data-label={tr('minLevel')}>{minStock > 0 ? formatIndianNumber(minStock) : '—'}</TableCell>
                      <TableCell data-label={tr('location')}>{String(row.location ?? '—')}</TableCell>
                      <TableCell align="right" data-label={tr('actions')} onClick={(e) => e.stopPropagation()}>
                        <IconButton size="small" onClick={() => openEdit(row)}><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" color="error" onClick={() => setDeleteConfirm(row.id as string)}><DeleteIcon fontSize="small" /></IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                rows.map((row: Record<string, unknown>) => (
                  <TableRow key={row.id as string} hover>
                    <TableCell data-label={tr('item')} sx={{ fontWeight: 500 }}>{(row.inventoryItem as any)?.name ?? '—'}</TableCell>
                    <TableCell data-label={tr('type')}>
                      <Chip
                        label={String(row.type)}
                        size="small"
                        color={row.type === 'IN' ? 'success' : row.type === 'OUT' ? 'warning' : 'default'}
                      />
                    </TableCell>
                    <TableCell data-label={tr('qty')} sx={{ fontWeight: 600 }}>{formatIndianNumber(Number(row.quantity ?? 0))}</TableCell>
                    <TableCell data-label={tr('balanceAfter')}>{formatIndianNumber(Number(row.balanceAfter ?? 0))}</TableCell>
                    <TableCell data-label={tr('gatePass')}>{(row.gatePass as any)?.passNumber ?? '—'}</TableCell>
                    <TableCell data-label={tr('notes')}>{String(row.notes ?? '—')}</TableCell>
                    <TableCell data-label={tr('proof')}>
                      <Button size="small" onClick={() => setAttachmentTransactionId(String(row.id))}>{tr('viewUpload')}</Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
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

      <ResponsiveDialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? tr('editItem') : tr('newItem')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label={tr('name')} required value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth size="small" />
            <TextField label={tr('sku')} value={form.sku ?? ''} onChange={(e) => setForm({ ...form, sku: e.target.value })} fullWidth size="small" />
            <CreatableSelect label={tr('category')} value={String(form.category ?? '')} onChange={(v) => setForm({ ...form, category: v })} dropdownType="INVENTORY_CATEGORY" />
            <TextField
              select
              label={tr('itemType')}
              value={String(form.itemType ?? InventoryItemType.CONSUMABLE)}
              onChange={(e) => setForm({ ...form, itemType: e.target.value })}
              fullWidth
              size="small"
              required
              helperText={editing ? tr('typeHelp') : undefined}
            >
              <MenuItem value={InventoryItemType.CONSUMABLE}>{tr('consumableNote')}</MenuItem>
              <MenuItem value={InventoryItemType.ASSET}>Asset — durable equipment with individual unit tracking + QR</MenuItem>
            </TextField>
            {form.itemType === InventoryItemType.ASSET && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                {tr('assetNote')}
              </Alert>
            )}
            <CreatableSelect label={tr('unit')} value={String(form.unit ?? '')} onChange={(v) => setForm({ ...form, unit: v })} required dropdownType="UNIT" />
            <TextField label={tr('minStockLevel')} type="text" value={formatIndianNumber(form.minStockLevel ?? 0)} onChange={(e) => setForm({ ...form, minStockLevel: e.target.value === '' ? '' : Number(e.target.value.replace(/,/g, '')) })} inputMode="decimal" inputProps={{ min: 0, step: 0.01 }} fullWidth size="small" />
            <CreatableSelect label={tr('location')} value={String(form.location ?? '')} onChange={(v) => setForm({ ...form, location: v })} dropdownType="LOCATION" />
          </Box>

          {editing && (
            <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <AttachmentUpload entityType="INVENTORY_ITEM" entityId={editing.id as string} />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setDialogOpen(false)}>{tr('cancel')}</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
            {createMutation.isPending || updateMutation.isPending ? <CircularProgress size={20} /> : editing ? tr('update') : tr('create')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      <ResponsiveDialog open={txnDialogOpen} onClose={() => setTxnDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('stockMovement')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <CreatableSelect label={tr('item')} required value={String(txnForm.itemId ?? '')} onChange={(v) => setTxnForm({ ...txnForm, itemId: v })} optionsEndpoint="/inventory/items" />
            <TextField select label={tr('type')} required value={txnForm.type ?? InventoryTxnType.OUT} onChange={(e) => setTxnForm({ ...txnForm, type: e.target.value })} fullWidth size="small">
              {enumToOptions(InventoryTxnType).filter((opt) => opt.value !== InventoryTxnType.IN).map((opt) => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
            </TextField>
            <TextField label={tr('quantity')} type="text" required value={formatIndianNumber(txnForm.quantity ?? '')} onChange={(e) => setTxnForm({ ...txnForm, quantity: e.target.value === '' ? '' : Number(e.target.value.replace(/,/g, '')) })} inputMode="decimal" inputProps={{ min: 0.01, step: 0.01 }} fullWidth size="small"
              helperText={txnForm.type === 'ADJUST' ? tr('absHelp') : tr('posHelp')} />
            <TextField label={tr('notes')} value={txnForm.notes ?? ''} onChange={(e) => setTxnForm({ ...txnForm, notes: e.target.value })} fullWidth size="small" multiline rows={2} />
            <FilePicker
              file={txnPhoto}
              onChange={setTxnPhoto}
              accept="image/*"
              startIcon={<PhotoCameraIcon />}
              label={tr('addPhoto')}
              selectedLabel={txnPhoto ? tr('photoName', { n: txnPhoto.name }) : undefined}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setTxnDialogOpen(false)}>{tr('cancel')}</Button>
          <Button variant="contained" onClick={handleTransactionSubmit} disabled={txnMutation.isPending}>
            {txnMutation.isPending ? <CircularProgress size={20} /> : tr('record')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      <ResponsiveDialog open={!!attachmentTransactionId} onClose={() => setAttachmentTransactionId(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('stockMovementProof')}</DialogTitle>
        <DialogContent>
          <AttachmentUpload entityType="INVENTORY_TRANSACTION" entityId={attachmentTransactionId} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAttachmentTransactionId(null)}>{tr('close')}</Button>
        </DialogActions>
      </ResponsiveDialog>

      <ResponsiveDialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <DialogTitle>{tr('deleteItem')}</DialogTitle>
        <DialogContent><Typography>{tr('undone')}</Typography></DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setDeleteConfirm(null)}>{tr('cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)} disabled={deleteMutation.isPending}>{tr('delete')}</Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}

