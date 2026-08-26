import { useState } from 'react';
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
} from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  SwapVert as SwapVertIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { InventoryTxnType } from '@hospital-erp/shared';
import { enumToOptions, formatIndianNumber } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import CreatableSelect from '../components/CreatableSelect';
import AttachmentUpload from '../components/AttachmentUpload';
import ResponsiveTable from '../components/ResponsiveTable';

export default function InventoryPage() {
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [txnDialogOpen, setTxnDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [txnForm, setTxnForm] = useState<Record<string, unknown>>({});
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
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/inventory/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/inventory/items'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setTxnDialogOpen(false);
      setTxnForm({});
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  const openCreate = () => {
    setForm({ name: '', unit: 'nos', minStockLevel: 0 });
    setEditing(null);
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (row: Record<string, unknown>) => {
    setForm({
      name: row.name ?? '', sku: row.sku ?? '', category: row.category ?? '',
      unit: row.unit ?? 'nos',
      minStockLevel: row.minStockLevel ?? 0, location: row.location ?? '',
    });
    setEditing(row);
    setError('');
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!String(form.name ?? '').trim() || !String(form.unit ?? '').trim()) {
      setError('Item name and unit are required');
      return;
    }
    if (![form.currentStock, form.minStockLevel].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0)) {
      setError('Stock values must be zero or greater');
      return;
    }
    setError('');
    if (editing) {
      updateMutation.mutate({ id: editing.id as string, payload: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleTransactionSubmit = () => {
    if (!txnForm.itemId || !txnForm.type || !Number.isFinite(Number(txnForm.quantity)) || Number(txnForm.quantity) <= 0) {
      setError('Select an item and enter a quantity greater than zero');
      return;
    }
    setError('');
    txnMutation.mutate(txnForm);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>Inventory</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
          {tab === 0 && (
            <>
              <Button variant="outlined" startIcon={<SwapVertIcon />} onClick={() => { setTxnForm({ type: InventoryTxnType.OUT, quantity: 0 }); setTxnDialogOpen(true); }}>
                Stock Movement
              </Button>
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Item</Button>
            </>
          )}
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Tabs value={tab} onChange={(_, v) => { setTab(v); setPage(0); }} sx={{ mb: 2 }} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
        <Tab label="Items" />
        <Tab label="Transactions" />
      </Tabs>

      <Card>
        {tab === 0 && (
          <Box sx={{ p: 2 }}>
            <TextField
              size="small"
              placeholder="Search items..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
              sx={{ width: { xs: '100%', sm: 300 } }}
            />
          </Box>
        )}

        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              {tab === 0 ? (
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>SKU</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Category</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Stock</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Min Level</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Location</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              ) : (
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Item</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Qty</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Balance After</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Gate Pass</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Notes</TableCell>
                </TableRow>
              )}
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No records found</Typography></TableCell></TableRow>
              ) : tab === 0 ? (
                rows.map((row: Record<string, unknown>) => {
                  const lowStock = Number(row.currentStock) <= Number(row.minStockLevel) && Number(row.minStockLevel) > 0;
                  return (
                    <TableRow key={row.id as string} hover>
                      <TableCell data-label="Name">{String(row.name ?? '—')}</TableCell>
                      <TableCell data-label="SKU">{String(row.sku ?? '—')}</TableCell>
                      <TableCell data-label="Category">{String(row.category ?? '—')}</TableCell>
                      <TableCell data-label="Unit">{String(row.unit ?? '—')}</TableCell>
                      <TableCell data-label="Stock">
                        <Chip label={String(row.currentStock)} size="small" color={lowStock ? 'error' : 'default'} />
                      </TableCell>
                      <TableCell data-label="Min Level">{String(row.minStockLevel ?? 0)}</TableCell>
                      <TableCell data-label="Location">{String(row.location ?? '—')}</TableCell>
                      <TableCell align="right" data-label="Actions">
                        <IconButton size="small" onClick={() => openEdit(row)}><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" color="error" onClick={() => setDeleteConfirm(row.id as string)}><DeleteIcon fontSize="small" /></IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                rows.map((row: Record<string, unknown>) => (
                  <TableRow key={row.id as string} hover>
                    <TableCell data-label="Item">{(row.inventoryItem as any)?.name ?? '—'}</TableCell>
                    <TableCell data-label="Type"><Chip label={String(row.type)} size="small" color={row.type === 'IN' ? 'success' : row.type === 'OUT' ? 'warning' : 'default'} /></TableCell>
                    <TableCell data-label="Qty">{String(row.quantity ?? '—')}</TableCell>
                    <TableCell data-label="Balance After">{String(row.balanceAfter ?? '—')}</TableCell>
                    <TableCell data-label="Gate Pass">{(row.gatePass as any)?.passNumber ?? '—'}</TableCell>
                    <TableCell data-label="Notes">{String(row.notes ?? '—')}</TableCell>
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
        <DialogTitle>{editing ? 'Edit Item' : 'New Inventory Item'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="Name" required value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth size="small" />
            <TextField label="SKU" value={form.sku ?? ''} onChange={(e) => setForm({ ...form, sku: e.target.value })} fullWidth size="small" />
            <CreatableSelect label="Category" value={String(form.category ?? '')} onChange={(v) => setForm({ ...form, category: v })} dropdownType="INVENTORY_CATEGORY" />
            <CreatableSelect label="Unit" value={String(form.unit ?? '')} onChange={(v) => setForm({ ...form, unit: v })} required dropdownType="UNIT" />
            <TextField label="Min Stock Level" type="text" value={formatIndianNumber(form.minStockLevel ?? 0)} onChange={(e) => setForm({ ...form, minStockLevel: e.target.value === '' ? '' : Number(e.target.value.replace(/,/g, '')) })} inputMode="decimal" inputProps={{ min: 0, step: 0.01 }} fullWidth size="small" />
            <CreatableSelect label="Location" value={String(form.location ?? '')} onChange={(v) => setForm({ ...form, location: v })} dropdownType="LOCATION" />
          </Box>

          {editing && (
            <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <AttachmentUpload entityType="INVENTORY_ITEM" entityId={editing.id as string} />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
            {createMutation.isPending || updateMutation.isPending ? <CircularProgress size={20} /> : editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      <ResponsiveDialog open={txnDialogOpen} onClose={() => setTxnDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Stock Movement</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <CreatableSelect label="Item" required value={String(txnForm.itemId ?? '')} onChange={(v) => setTxnForm({ ...txnForm, itemId: v })} optionsEndpoint="/inventory/items" />
            <TextField select label="Type" required value={txnForm.type ?? InventoryTxnType.IN} onChange={(e) => setTxnForm({ ...txnForm, type: e.target.value })} fullWidth size="small">
              {enumToOptions(InventoryTxnType).filter((opt) => opt.value !== InventoryTxnType.IN).map((opt) => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
            </TextField>
            <TextField label="Quantity" type="text" required value={formatIndianNumber(txnForm.quantity ?? '')} onChange={(e) => setTxnForm({ ...txnForm, quantity: e.target.value === '' ? '' : Number(e.target.value.replace(/,/g, '')) })} inputMode="decimal" inputProps={{ min: 0.01, step: 0.01 }} fullWidth size="small"
              helperText={txnForm.type === 'ADJUST' ? 'Set absolute stock value' : 'Positive number'} />
            <TextField label="Notes" value={txnForm.notes ?? ''} onChange={(e) => setTxnForm({ ...txnForm, notes: e.target.value })} fullWidth size="small" multiline rows={2} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setTxnDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleTransactionSubmit} disabled={txnMutation.isPending}>
            {txnMutation.isPending ? <CircularProgress size={20} /> : 'Record'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      <ResponsiveDialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <DialogTitle>Delete Item?</DialogTitle>
        <DialogContent><Typography>This action cannot be undone.</Typography></DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)} disabled={deleteMutation.isPending}>Delete</Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}

