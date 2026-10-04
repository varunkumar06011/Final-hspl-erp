import { useState } from 'react';
import CommentsButton from '../components/CommentsButton';
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
  Tabs,
  Tab,
} from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Visibility as ViewIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { useFileViewer } from '../components/FileViewerDialog';
import ResponsiveTable from '../components/ResponsiveTable';
import RefreshButton from '../components/RefreshButton';

import { useTranslation } from 'react-i18next';
import FilePicker from '../components/FilePicker';
import DocumentLibraryTab from '../components/DocumentLibraryTab';
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

function GeneralDocumentsTab() {
  const { t: tr } = useTranslation('documents');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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
      if (!selectedFile) throw new Error(tr('errNoFile'));
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
      setSuccessMsg(tr('okUploaded'));
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/documents/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/documents'] });
      setSuccessMsg(tr('okDeleted'));
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
      ? [{ id: user.id, name: tr('self', { name: user.name }), role: user.role }]
      : []),
  ];

  function getNamesForIds(ids: string[]): string {
    return ids.map((id) => resolveToOptions.find((o) => o.id === id)?.name ?? tr('unknown')).join(', ');
  }

  const { openFile, viewer } = useFileViewer();
  function handleDownload(id: string, fileName: string) {
    openFile('documents', id, fileName);
  }

  return (
    <Box>
      {viewer}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <RefreshButton onClick={() => refetch()} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setForm({ resolveTo: [] }); setError(''); setSelectedFile(null); setDialogOpen(true); }}>
            {tr('uploadDocument')}
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      <Card>
        <Box sx={{ p: 2 }}>
          <TextField
            size="small"
            placeholder={tr('search')}
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
                <TableCell sx={{ fontWeight: 600 }}>{tr('name')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('description')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('resolveTo')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('file')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('uploadedBy')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('date')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{tr('none')}</Typography></TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell data-label={tr('name')}>{row.name}</TableCell>
                    <TableCell data-label={tr('description')}>{row.description ?? '—'}</TableCell>
                    <TableCell data-label={tr('resolveTo')}>{getNamesForIds(row.resolveTo)}</TableCell>
                    <TableCell data-label={tr('file')}>
                      <Chip label={row.fileName} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell data-label={tr('uploadedBy')}>{row.uploadedByUser?.name ?? '—'}</TableCell>
                    <TableCell data-label={tr('date')}>{formatDate(row.createdAt)}</TableCell>
                    <TableCell data-label={tr('actions')}>
                      <CommentsButton entityType="DOCUMENT" entityId={row.id} entityLabel={row.name} url="/documents" />
                      <IconButton size="small" onClick={() => handleDownload(row.id, row.fileName)}><ViewIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => { if (confirm(tr('confirmDelete'))) deleteMutation.mutate(row.id); }}><DeleteIcon fontSize="small" /></IconButton>
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
        <DialogTitle>{tr('uploadDocument')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1, flexWrap: 'wrap' }}>
            <TextField label={tr('documentName')} required value={String(form.name ?? '')} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth size="small" />
            <TextField label={tr('whatIs')} value={String(form.description ?? '')} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth size="small" multiline rows={2} />
            <FormControl fullWidth size="small">
              <InputLabel>{tr('resolveToSelectMultiple')}</InputLabel>
              <Select
                multiple
                value={(form.resolveTo as string[]) ?? []}
                onChange={(e) => setForm({ ...form, resolveTo: e.target.value as string[] })}
                renderValue={(selected) => getNamesForIds(selected as string[])}
                label={tr('resolveToSelectMultiple')}
              >
                {resolveToOptions.map((opt) => (
                  <MenuItem key={opt.id} value={opt.id}>
                    <Checkbox checked={((form.resolveTo as string[]) ?? []).indexOf(opt.id) > -1} />
                    <ListItemText primary={opt.name} secondary={opt.role?.replace(/_/g, ' ')} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FilePicker
              file={selectedFile}
              onChange={setSelectedFile}
              label={tr('chooseFile')}
              selectedLabel={selectedFile ? `✓ ${selectedFile.name}` : undefined}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setDialogOpen(false)}>{tr('cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => {
              setError('');
              if (!form.name) { setError(tr('errName')); return; }
              if (!(form.resolveTo as string[])?.length) { setError(tr('errResolve')); return; }
              if (!selectedFile) { setError(tr('errChoose')); return; }
              createMutation.mutate();
            }}
            disabled={!form.name || !selectedFile || createMutation.isPending}
          >
            {createMutation.isPending ? <CircularProgress size={20} /> : tr('upload')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}

export default function DocumentsPage() {
  const { t: tr } = useTranslation('documents');
  const [tab, setTab] = useState<'library' | 'general'>('library');
  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 1 }}>{tr('title')}</Typography>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="library" label={tr('tabLibrary')} />
        <Tab value="general" label={tr('tabGeneral')} />
      </Tabs>
      {tab === 'library' ? <DocumentLibraryTab /> : <GeneralDocumentsTab />}
    </Box>
  );
}
