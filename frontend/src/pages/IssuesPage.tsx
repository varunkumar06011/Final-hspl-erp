import { useState, useRef } from 'react';
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
  InputAdornment,
  MenuItem,
  Checkbox,
  ListItemText,
  FormControl,
  InputLabel,
  Select,
} from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckCircleIcon,
  Photo as PhotoIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IssueSeverity, IssueCategory, IssueStatus } from '@hospital-erp/shared';
import { enumToOptions, formatDate, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import ResponsiveTable from '../components/ResponsiveTable';
import RefreshButton from '../components/RefreshButton';

interface IssueRow {
  id: string;
  title: string;
  category: string;
  severity: string;
  description: string | null;
  addressTo: string[];
  dateRaised: string;
  status: string;
  closedAt: string | null;
  closurePhotoUrl: string | null;
  closureNotes: string | null;
  createdBy: string;
  createdByUser: { id: string; name: string };
  closedByUser: { id: string; name: string } | null;
}

export default function IssuesPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [closeTarget, setCloseTarget] = useState<IssueRow | null>(null);
  const [closeNotes, setCloseNotes] = useState('');
  const [closeFile, setCloseFile] = useState<File | null>(null);
  const [proofTarget, setProofTarget] = useState<IssueRow | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const closeFileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/issues', page, pageSize, search, severityFilter, statusFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (severityFilter) params.severity = severityFilter;
      if (statusFilter) params.status = statusFilter;
      const response = await api.get('/issues', { params });
      return response.data;
    },
  });

  // Fetch heads (reuse gate-pass heads endpoint)
  const { data: heads } = useQuery({
    queryKey: ['/gate-passes/heads'],
    queryFn: async () => {
      const response = await api.get('/gate-passes/heads');
      return response.data?.data ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editingId) {
        const response = await api.patch(`/issues/${editingId}`, payload);
        return response.data;
      }
      const response = await api.post('/issues', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/issues'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard/summary'] });
      setCreateOpen(false);
      setEditingId(null);
      setForm({});
      setSuccessMsg(editingId ? 'Issue updated.' : 'Issue created.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/issues/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/issues'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard/summary'] });
      setSuccessMsg('Issue deleted.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const closeMutation = useMutation({
    mutationFn: async ({ id, file, notes }: { id: string; file: File | null; notes: string }) => {
      const formData = new FormData();
      if (file) formData.append('file', file);
      if (notes.trim()) formData.append('closureNotes', notes.trim());
      const response = await api.post(`/issues/${id}/close`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/issues'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard/summary'] });
      setCloseTarget(null);
      setCloseNotes('');
      setCloseFile(null);
      setSuccessMsg('Issue closed.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: IssueRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  // Build the address-to options: 4 heads + self
  const addressToOptions = [
    ...(heads as { id: string; name: string; role: string }[] ?? []),
    ...(user && !(heads as { id: string }[] ?? []).some((h) => h.id === user.id)
      ? [{ id: user.id, name: `${user.name} (Self)`, role: user.role }]
      : []),
  ];

  function getNamesForIds(ids: string[]): string {
    return ids.map((id) => addressToOptions.find((o) => o.id === id)?.name ?? 'Unknown').join(', ');
  }

  function openCreate() {
    setEditingId(null);
    setForm({ severity: IssueSeverity.MEDIUM, category: IssueCategory.OTHER, addressTo: [] });
    setError('');
    setCreateOpen(true);
  }

  function openEdit(issue: IssueRow) {
    setEditingId(issue.id);
    setForm({
      title: issue.title,
      category: issue.category,
      severity: issue.severity,
      description: issue.description,
      addressTo: issue.addressTo,
    });
    setError('');
    setCreateOpen(true);
  }

  function openClose(issue: IssueRow) {
    setCloseTarget(issue);
    setCloseNotes('');
    setCloseFile(null);
    setError('');
  }

  function handleCloseFileSelect(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 50 * 1024 * 1024) {
      setError('Photo proof must be a JPEG, PNG, or WebP image smaller than 50 MB');
      return;
    }
    setError('');
    setCloseFile(file);
  }

  async function openProof(issue: IssueRow) {
    setProofTarget(issue);
    setProofUrl(null);
    try {
      const res = await api.get(`/issues/${issue.id}/closure-photo`, { responseType: 'blob' });
      setProofUrl(window.URL.createObjectURL(res.data));
    } catch {
      setProofUrl(null);
    }
  }

  function closeProof() {
    if (proofUrl) window.URL.revokeObjectURL(proofUrl);
    setProofUrl(null);
    setProofTarget(null);
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>Issues</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <RefreshButton onClick={() => refetch()} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Issue</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      <Card>
        <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="Search issues..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />
          <TextField select size="small" label="Severity" value={severityFilter} onChange={(e) => { setSeverityFilter(e.target.value); setPage(0); }} sx={{ width: 150 }}>
            <MenuItem value="">All</MenuItem>
            {Object.values(IssueSeverity).map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} sx={{ width: 150 }}>
            <MenuItem value="">All</MenuItem>
            {Object.values(IssueStatus).map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
          </TextField>
        </Box>

        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Title</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Category</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Severity</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Address To</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Raised By</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No issues found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell data-label="Title">{row.title}</TableCell>
                    <TableCell data-label="Category">{row.category}</TableCell>
                    <TableCell data-label="Severity"><Chip label={row.severity} size="small" color={STATUS_COLORS[row.severity] ?? 'default'} /></TableCell>
                    <TableCell data-label="Status"><Chip label={(row.status ?? IssueStatus.OPEN).replace(/_/g, ' ')} size="small" color={STATUS_COLORS[row.status ?? IssueStatus.OPEN] ?? 'default'} /></TableCell>
                    <TableCell data-label="Address To">{getNamesForIds(row.addressTo)}</TableCell>
                    <TableCell data-label="Raised By">{row.createdByUser?.name ?? '—'}</TableCell>
                    <TableCell data-label="Date">{formatDate(row.dateRaised)}</TableCell>
                    <TableCell data-label="Actions">
                      {row.status !== IssueStatus.CLOSED && (
                        <IconButton size="small" color="success" title="Close issue" onClick={() => openClose(row)}><CheckCircleIcon fontSize="small" /></IconButton>
                      )}
                      {row.status === IssueStatus.CLOSED && row.closurePhotoUrl && (
                        <IconButton size="small" title="View photo proof" onClick={() => openProof(row)}><PhotoIcon fontSize="small" /></IconButton>
                      )}
                      <IconButton size="small" onClick={() => openEdit(row)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => { if (confirm('Delete this issue?')) deleteMutation.mutate(row.id); }}><DeleteIcon fontSize="small" /></IconButton>
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

      {/* Create/Edit Issue Dialog */}
      <ResponsiveDialog open={createOpen} onClose={() => { setCreateOpen(false); setEditingId(null); }} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? 'Edit Issue' : 'New Issue'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="Title" required value={String(form.title ?? '')} onChange={(e) => setForm({ ...form, title: e.target.value })} fullWidth size="small" />
            <TextField
              select
              label="Category"
              required
              value={String(form.category ?? IssueCategory.OTHER)}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              fullWidth
              size="small"
            >
              {enumToOptions(IssueCategory).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </TextField>
            <TextField
              select
              label="Severity"
              value={String(form.severity ?? IssueSeverity.MEDIUM)}
              onChange={(e) => setForm({ ...form, severity: e.target.value })}
              fullWidth
              size="small"
            >
              {enumToOptions(IssueSeverity).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </TextField>
            <TextField label="Description" value={String(form.description ?? '')} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth size="small" multiline rows={3} />
            <FormControl fullWidth size="small">
              <InputLabel>Address To (select multiple)</InputLabel>
              <Select
                multiple
                value={(form.addressTo as string[]) ?? []}
                onChange={(e) => setForm({ ...form, addressTo: e.target.value as string[] })}
                renderValue={(selected) => getNamesForIds(selected as string[])}
                label="Address To (select multiple)"
              >
                {addressToOptions.map((opt) => (
                  <MenuItem key={opt.id} value={opt.id}>
                    <Checkbox checked={((form.addressTo as string[]) ?? []).indexOf(opt.id) > -1} />
                    <ListItemText primary={opt.name} secondary={opt.role?.replace(/_/g, ' ')} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => { setCreateOpen(false); setEditingId(null); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setError('');
              if (!form.title || !(form.addressTo as string[])?.length) {
                setError('Title and Address To are required');
                return;
              }
              createMutation.mutate({
                title: form.title,
                category: form.category,
                severity: form.severity,
                description: form.description || undefined,
                addressTo: form.addressTo,
              });
            }}
            disabled={!form.title || createMutation.isPending}
          >
            {createMutation.isPending ? <CircularProgress size={20} /> : editingId ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Close Issue Dialog */}
      <ResponsiveDialog open={!!closeTarget} onClose={() => { setCloseTarget(null); setCloseFile(null); setCloseNotes(''); }} maxWidth="sm" fullWidth>
        <DialogTitle>Close Issue</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Closing: <strong>{closeTarget?.title}</strong>
            </Typography>
            <input ref={closeFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCloseFileSelect(f); }} />
            <Button variant="outlined" onClick={() => closeFileRef.current?.click()}>
              {closeFile ? '✓ Photo Selected' : 'Add Photo Proof (optional)'}
            </Button>
            {closeFile && (
              <Box component="img" src={URL.createObjectURL(closeFile)} sx={{ width: '100%', maxHeight: 240, objectFit: 'contain', borderRadius: 1 }} />
            )}
            <TextField
              label="Closure Notes (optional)"
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
              fullWidth
              size="small"
              multiline
              rows={3}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => { setCloseTarget(null); setCloseFile(null); setCloseNotes(''); }}>Cancel</Button>
          <Button
            variant="contained"
            color="success"
            disabled={closeMutation.isPending}
            onClick={() => {
              if (closeTarget) closeMutation.mutate({ id: closeTarget.id, file: closeFile, notes: closeNotes });
            }}
          >
            {closeMutation.isPending ? <CircularProgress size={20} /> : 'Close Issue'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Closure Photo Proof Dialog */}
      <ResponsiveDialog open={!!proofTarget} onClose={closeProof} maxWidth="sm" fullWidth>
        <DialogTitle>Closure Proof</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography variant="body2"><strong>Issue:</strong> {proofTarget?.title}</Typography>
            <Typography variant="body2"><strong>Closed By:</strong> {proofTarget?.closedByUser?.name ?? '—'}</Typography>
            <Typography variant="body2"><strong>Closed At:</strong> {formatDate(proofTarget?.closedAt)}</Typography>
            {proofTarget?.closureNotes && (
              <Typography variant="body2"><strong>Notes:</strong> {proofTarget.closureNotes}</Typography>
            )}
            {proofUrl ? (
              <Box component="img" src={proofUrl} sx={{ width: '100%', maxHeight: 400, objectFit: 'contain', borderRadius: 1 }} />
            ) : (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={28} /></Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeProof}>Close</Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
