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
  Alert,
  CircularProgress,
  InputAdornment,
  MenuItem,
  Checkbox,
  ListItemText,
  FormControl,
  InputLabel,
  Select,
  Chip,
} from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { downloadFile } from '../utils/file';
import ResponsiveTable from '../components/ResponsiveTable';

interface DocumentRow {
  id: string;
  name: string;
  description: string | null;
  resolveTo: string[];
  fileName: string;
  filePath: string;
  mimeType: string;
  uploadedBy: string;
  uploadedByUser: { id: string; name: string };
  createdAt: string;
}

export default function DocumentsPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/documents', page, pageSize, search],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      const response = await api.get('/documents', { params });
      return response.data;
    },
  });

  // Fetch heads for resolveTo dropdown
  const { data: heads } = useQuery({
    queryKey: ['/gate-passes/heads'],
    queryFn: async () => {
      const response = await api.get('/gate-passes/heads');
      return response.data?.data ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      if (!selectedFile) throw new Error('No file selected');
      formData.append('file', selectedFile);
      formData.append('name', String(form.name ?? ''));
      if (form.description) formData.append('description', String(form.description));
      formData.append('resolveTo', JSON.stringify(form.resolveTo ?? []));
      const response = await api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/documents'] });
      setDialogOpen(false);
      setForm({});
      setSelectedFile(null);
      setSuccessMsg('Document uploaded successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/documents/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/documents'] });
      setSuccessMsg('Document deleted.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: DocumentRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  // Build resolve-to options: 4 heads + self
  const resolveToOptions = [
    ...(heads as { id: string; name: string; role: string }[] ?? []),
    ...(user && !(heads as { id: string }[] ?? []).some((h) => h.id === user.id)
      ? [{ id: user.id, name: `${user.name} (Self)`, role: user.role }]
      : []),
  ];

  function getNamesForIds(ids: string[]): string {
    return ids.map((id) => resolveToOptions.find((o) => o.id === id)?.name ?? 'Unknown').join(', ');
  }

  function handleDownload(id: string, fileName: string) {
    downloadFile('documents', id, fileName).catch(() => setError('Failed to download file'));
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>Documents</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setForm({ resolveTo: [] }); setError(''); setSelectedFile(null); setDialogOpen(true); }}>
            Upload Document
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      <Card>
        <Box sx={{ p: 2 }}>
          <TextField
            size="small"
            placeholder="Search documents..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />
        </Box>

        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Resolve To</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>File</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Uploaded By</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No documents found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell data-label="Name">{row.name}</TableCell>
                    <TableCell data-label="Description">{row.description ?? '—'}</TableCell>
                    <TableCell data-label="Resolve To">{getNamesForIds(row.resolveTo)}</TableCell>
                    <TableCell data-label="File">
                      <Chip label={row.fileName} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell data-label="Uploaded By">{row.uploadedByUser?.name ?? '—'}</TableCell>
                    <TableCell data-label="Date">{formatDate(row.createdAt)}</TableCell>
                    <TableCell data-label="Actions">
                      <IconButton size="small" onClick={() => handleDownload(row.id, row.fileName)}><DownloadIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => { if (confirm('Delete this document?')) deleteMutation.mutate(row.id); }}><DeleteIcon fontSize="small" /></IconButton>
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

      {/* Upload Dialog */}
      <ResponsiveDialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Upload Document</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1, flexWrap: 'wrap' }}>
            <TextField label="Document Name" required value={String(form.name ?? '')} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth size="small" />
            <TextField label="What is this document?" value={String(form.description ?? '')} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth size="small" multiline rows={2} />
            <FormControl fullWidth size="small">
              <InputLabel>Resolve To (select multiple)</InputLabel>
              <Select
                multiple
                value={(form.resolveTo as string[]) ?? []}
                onChange={(e) => setForm({ ...form, resolveTo: e.target.value as string[] })}
                renderValue={(selected) => getNamesForIds(selected as string[])}
                label="Resolve To (select multiple)"
              >
                {resolveToOptions.map((opt) => (
                  <MenuItem key={opt.id} value={opt.id}>
                    <Checkbox checked={((form.resolveTo as string[]) ?? []).indexOf(opt.id) > -1} />
                    <ListItemText primary={opt.name} secondary={opt.role?.replace(/_/g, ' ')} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) setSelectedFile(f); }} />
            <Button variant="outlined" onClick={() => fileRef.current?.click()}>
              {selectedFile ? `✓ ${selectedFile.name}` : 'Choose File'}
            </Button>
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setError('');
              if (!form.name) { setError('Document name is required'); return; }
              if (!(form.resolveTo as string[])?.length) { setError('Select at least one person to resolve to'); return; }
              if (!selectedFile) { setError('Please choose a file'); return; }
              createMutation.mutate();
            }}
            disabled={!form.name || !selectedFile || createMutation.isPending}
          >
            {createMutation.isPending ? <CircularProgress size={20} /> : 'Upload'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
