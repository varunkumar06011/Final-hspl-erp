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
  Download as DownloadIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DocumentType } from '@hospital-erp/shared';
import { enumToOptions, formatDate, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import CreatableSelect from '../components/CreatableSelect';

export default function DocumentsPage() {
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
    queryKey: ['/documents', page, pageSize, search],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      const response = await api.get('/documents', { params });
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const formData = new FormData();
      formData.append('file', payload.file as File);
      if (payload.fileType) formData.append('fileType', String(payload.fileType));
      if (payload.entityType) formData.append('entityType', String(payload.entityType));
      if (payload.entityId) formData.append('entityId', String(payload.entityId));
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
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>Documents</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setForm({ fileType: DocumentType.MISC }); setError(''); setDialogOpen(true); }}>
            Upload Document
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Card>
        <Box sx={{ p: 2 }}>
          <TextField
            size="small"
            placeholder="Search documents..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: 300 }}
          />
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>File Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Entity</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Uploaded</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Link</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No documents found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row: Record<string, unknown>) => (
                  <TableRow key={row.id as string} hover>
                    <TableCell>{String(row.fileName ?? '—')}</TableCell>
                    <TableCell><Chip label={String(row.fileType ?? '')} size="small" /></TableCell>
                    <TableCell>{String(row.entityType ?? '—')}</TableCell>
                    <TableCell><Chip label={String(row.status ?? '')} size="small" color={STATUS_COLORS[String(row.status)] ?? 'default'} /></TableCell>
                    <TableCell>{formatDate(row.createdAt)}</TableCell>
                    <TableCell>
                      <IconButton size="small" component="a" href={String(row.filePath ?? '')} target="_blank"><DownloadIcon fontSize="small" /></IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
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
          rowsPerPageOptions={[10, 20, 50]}
        />
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Upload Document</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) setSelectedFile(f); }} />
            <Button variant="outlined" onClick={() => fileRef.current?.click()}>
              {selectedFile ? '✓ File Selected' : 'Choose File'}
            </Button>
            {selectedFile && <Typography variant="body2" color="text.secondary">{selectedFile.name}</Typography>}
            <CreatableSelect label="Document Type" required value={String(form.fileType ?? DocumentType.MISC)} onChange={(v) => setForm({ ...form, fileType: v })} staticOptions={enumToOptions(DocumentType)} dropdownType="DOCUMENT_TYPE" />
            <TextField label="Entity Type" placeholder="e.g. VENDOR, PO, CONTRACT" value={form.entityType ?? ''} onChange={(e) => setForm({ ...form, entityType: e.target.value })} fullWidth size="small" />
            <TextField label="Entity ID (UUID)" value={form.entityId ?? ''} onChange={(e) => setForm({ ...form, entityId: e.target.value })} fullWidth size="small" />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => createMutation.mutate({
            file: selectedFile,
            fileType: form.fileType,
            entityType: form.entityType || 'MISC',
            entityId: form.entityId || undefined,
          })} disabled={!selectedFile || createMutation.isPending}>
            {createMutation.isPending ? <CircularProgress size={20} /> : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
