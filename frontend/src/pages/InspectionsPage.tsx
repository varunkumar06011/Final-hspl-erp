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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Chip,
  Alert,
  CircularProgress,
  InputAdornment,
  MenuItem,
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { InspectionStatus } from '@hospital-erp/shared';
import { enumToOptions, formatDate, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveTable from '../components/ResponsiveTable';

interface InspectionRow {
  id: string;
  name: string;
  date: string;
  scheduledDate: string | null;
  status: string;
  correctiveAction: string | null;
  completedDate: string | null;
  inspector: { id: string; name: string };
  createdByUser: { id: string; name: string };
}

export default function InspectionsPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/inspections', page, pageSize, search, statusFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const response = await api.get('/inspections', { params });
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editingId) {
        const response = await api.patch(`/inspections/${editingId}`, payload);
        return response.data;
      }
      const response = await api.post('/inspections', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/inspections'] });
      setCreateOpen(false);
      setEditingId(null);
      setForm({});
      setSuccessMsg(editingId ? 'Inspection updated.' : 'Inspection created.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/inspections/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/inspections'] });
      setSuccessMsg('Inspection deleted.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: InspectionRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  function openCreate() {
    setEditingId(null);
    setForm({ name: '', date: new Date().toISOString().slice(0, 10), status: InspectionStatus.SCHEDULED });
    setError('');
    setCreateOpen(true);
  }

  function openEdit(row: InspectionRow) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      date: row.date ? new Date(row.date).toISOString().slice(0, 10) : '',
      scheduledDate: row.scheduledDate ? new Date(row.scheduledDate).toISOString().slice(0, 10) : '',
      status: row.status,
      correctiveAction: row.correctiveAction,
    });
    setError('');
    setCreateOpen(true);
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>Inspections</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Inspection</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      <Card>
        <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="Search inspections..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />
          <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} sx={{ width: 150 }}>
            <MenuItem value="">All</MenuItem>
            {Object.values(InspectionStatus).map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
          </TextField>
        </Box>

        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Scheduled Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Completed</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Inspector</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No inspections found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell data-label="Name">{row.name}</TableCell>
                    <TableCell data-label="Date">{formatDate(row.date)}</TableCell>
                    <TableCell data-label="Scheduled Date">{row.scheduledDate ? formatDate(row.scheduledDate) : '—'}</TableCell>
                    <TableCell data-label="Status"><Chip label={row.status.replace(/_/g, ' ')} size="small" color={STATUS_COLORS[row.status] ?? 'default'} /></TableCell>
                    <TableCell data-label="Completed">{row.completedDate ? formatDate(row.completedDate) : '—'}</TableCell>
                    <TableCell data-label="Inspector">{row.inspector?.name ?? '—'}</TableCell>
                    <TableCell data-label="Actions">
                      <IconButton size="small" onClick={() => openEdit(row)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => { if (confirm('Delete this inspection?')) deleteMutation.mutate(row.id); }}><DeleteIcon fontSize="small" /></IconButton>
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

      {/* Create/Edit Dialog */}
      <Dialog open={createOpen} onClose={() => { setCreateOpen(false); setEditingId(null); }} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? 'Edit Inspection' : 'New Inspection'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="Name" required value={String(form.name ?? '')} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth size="small" />
            <TextField
              label="Date"
              type="date"
              value={String(form.date ?? '')}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Scheduled Date"
              type="date"
              value={String(form.scheduledDate ?? '')}
              onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
            />
            {editingId && (
              <>
                <TextField
                  select
                  label="Status"
                  value={String(form.status ?? InspectionStatus.SCHEDULED)}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  fullWidth
                  size="small"
                >
                  {enumToOptions(InspectionStatus).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                </TextField>
                <TextField label="Corrective Action" value={String(form.correctiveAction ?? '')} onChange={(e) => setForm({ ...form, correctiveAction: e.target.value })} fullWidth size="small" multiline rows={2} />
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCreateOpen(false); setEditingId(null); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setError('');
              if (!form.name) { setError('Name is required'); return; }
              createMutation.mutate({
                name: form.name,
                date: form.date || undefined,
                scheduledDate: form.scheduledDate || undefined,
                ...(editingId ? { status: form.status, correctiveAction: form.correctiveAction || undefined } : {}),
              });
            }}
            disabled={!form.name || createMutation.isPending}
          >
            {createMutation.isPending ? <CircularProgress size={20} /> : editingId ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
