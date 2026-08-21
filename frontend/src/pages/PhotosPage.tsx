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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Chip,
  Alert,
  CircularProgress,
  InputAdornment,
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PhotoTag } from '@hospital-erp/shared';
import { enumToOptions, formatDate, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { SecureImage } from '../components/SecureImage';
import CreatableSelect from '../components/CreatableSelect';
import ResponsiveTable from '../components/ResponsiveTable';

export default function PhotosPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/photos', page, pageSize, search],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      const response = await api.get('/photos', { params });
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const formData = new FormData();
      formData.append('file', payload.file as File);
      if (payload.caption) formData.append('caption', String(payload.caption));
      if (payload.tag) formData.append('tag', String(payload.tag));
      if (payload.zone) formData.append('zone', String(payload.zone));
      const response = await api.post('/photos/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/photos'] });
      setDialogOpen(false);
      setForm({});
      setSelectedFile(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setForm((prev) => ({ ...prev, fileName: file.name }));
  };

  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>Site Photos</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setForm({ tag: PhotoTag.DURING }); setError(''); setDialogOpen(true); }}>
            Upload Photo
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Card>
        <Box sx={{ p: 2 }}>
          <TextField
            size="small"
            placeholder="Search photos..."
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
                <TableCell sx={{ fontWeight: 600 }}>Image</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Caption</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Tag</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Zone</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No photos found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row: Record<string, unknown>) => (
                  <TableRow key={row.id as string} hover>
                    <TableCell data-label="Image">
                      <SecureImage route="photos" id={row.id as string} alt={String(row.caption ?? '')} sx={{ width: 60, height: 60 }} />
                    </TableCell>
                    <TableCell data-label="Caption">{String(row.caption ?? '—')}</TableCell>
                    <TableCell data-label="Tag"><Chip label={String(row.tag ?? '')} size="small" color={STATUS_COLORS[String(row.tag)] ?? 'default'} /></TableCell>
                    <TableCell data-label="Zone">{String(row.zone ?? '—')}</TableCell>
                    <TableCell data-label="Date">{formatDate(row.takenAt)}</TableCell>
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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Upload Photo</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />
            <Button variant="outlined" onClick={() => fileRef.current?.click()}>
              {selectedFile ? '✓ File Selected' : 'Choose Image'}
            </Button>
            {selectedFile && (
              <Box component="img" src={URL.createObjectURL(selectedFile)} sx={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 1 }} />
            )}
            <TextField label="Caption" value={form.caption ?? ''} onChange={(e) => setForm({ ...form, caption: e.target.value })} fullWidth size="small" />
            <CreatableSelect label="Tag" value={String(form.tag ?? PhotoTag.DURING)} onChange={(v) => setForm({ ...form, tag: v })} staticOptions={enumToOptions(PhotoTag)} dropdownType="PHOTO_TAG" />
            <TextField label="Zone" value={form.zone ?? ''} onChange={(e) => setForm({ ...form, zone: e.target.value })} fullWidth size="small" />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => createMutation.mutate({
            file: selectedFile,
            caption: form.caption || undefined,
            tag: form.tag,
            zone: form.zone || undefined,
          })} disabled={!selectedFile || createMutation.isPending}>
            {createMutation.isPending ? <CircularProgress size={20} /> : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
