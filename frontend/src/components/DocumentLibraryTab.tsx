import { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Link,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Image as ImageIcon,
  InsertDriveFile as FileIcon,
  InfoOutlined as InfoIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api, { extractErrorMessage } from '../config/api';
import { formatDateTime } from '../utils/enumOptions';
import ResponsiveDialog from './ResponsiveDialog';
import ResponsiveTable from './ResponsiveTable';
import RefreshButton from './RefreshButton';
import FilePicker from './FilePicker';

interface LibraryRow {
  key: string;
  source: string;
  id: string;
  fileName: string;
  mimeType: string | null;
  fileType: 'IMAGE' | 'DOCUMENT';
  description: string | null;
  uploadedBy: { id: string; name: string } | null;
  uploadedAt: string;
  category: string;
  linkedId: string | null;
  linkedLabel: string | null;
  linkedPath: string | null;
  fileRoute: string;
  canDelete: boolean;
  deleteRoute?: string;
}

interface TargetOption {
  id: string;
  label: string;
}

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,.heic,.heif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt';

const FALLBACK_CATEGORIES = [
  'PURCHASE_ORDER',
  'QUOTATION',
  'INVOICE',
  'PAYMENT',
  'VOUCHER',
  'MPR',
  'VENDOR',
  'GOODS_RECEIPT',
  'GATE_PASS',
  'CONTRACT',
  'INVENTORY',
  'OTHER',
  'GENERAL',
];

export default function DocumentLibraryTab() {
  const { t: tr } = useTranslation('documents');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('');
  const [fileType, setFileType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploadCategory, setUploadCategory] = useState('GENERAL');
  const [target, setTarget] = useState<TargetOption | null>(null);
  const [targetInput, setTargetInput] = useState('');
  const [debouncedTargetInput, setDebouncedTargetInput] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ row: LibraryRow; url: string | null; previewable: boolean } | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedTargetInput(targetInput), 250);
    return () => clearTimeout(id);
  }, [targetInput]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/document-library', page, pageSize, debouncedSearch, category, fileType, from, to],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (debouncedSearch) params.search = debouncedSearch;
      if (category) params.category = category;
      if (fileType) params.fileType = fileType;
      if (from) params.from = from;
      if (to) params.to = to;
      return (await api.get('/document-library', { params })).data;
    },
  });

  const rows: LibraryRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { total: 0 };
  const categories: string[] = data?.categories ?? FALLBACK_CATEGORIES;
  const uploadTargets: string[] = data?.uploadTargets ?? FALLBACK_CATEGORIES.filter((c) => c !== 'OTHER' && c !== 'GENERAL');

  const { data: targetOptions = [], isFetching: loadingTargets } = useQuery<TargetOption[]>({
    queryKey: ['/document-library/targets', uploadCategory, debouncedTargetInput],
    queryFn: async () =>
      (await api.get('/document-library/targets', { params: { category: uploadCategory, q: debouncedTargetInput } })).data
        .data,
    enabled: dialogOpen && uploadCategory !== 'GENERAL',
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error(tr('errChoose'));
      const fd = new FormData();
      fd.append('file', file);
      if (uploadCategory !== 'GENERAL' && target) {
        fd.append('category', uploadCategory);
        fd.append('entityId', target.id);
      }
      if (note) fd.append('description', note);
      return (await api.post('/document-library/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/document-library'] });
      queryClient.invalidateQueries({ queryKey: ['attachments'] });
      setDialogOpen(false);
      setSuccessMsg(tr('libOkUploaded'));
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (route: string) => {
      await api.delete(route);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/document-library'] });
      queryClient.invalidateQueries({ queryKey: ['attachments'] });
      queryClient.invalidateQueries({ queryKey: ['/documents'] });
      setSuccessMsg(tr('libOkDeleted'));
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  async function fetchBlob(row: LibraryRow) {
    return (await api.get(row.fileRoute, { responseType: 'blob' })).data as Blob;
  }

  // Opens the file in an in-page viewer (images and PDFs); other types offer Download.
  async function handleView(row: LibraryRow) {
    const mime = (row.mimeType ?? '').toLowerCase();
    const previewable = mime.startsWith('image/') || mime === 'application/pdf';
    setPreview({ row, url: null, previewable });
    if (!previewable) return;
    try {
      const blob = await fetchBlob(row);
      setPreview((p) =>
        p && p.row.key === row.key ? { ...p, url: window.URL.createObjectURL(new Blob([blob], { type: mime })) } : p
      );
    } catch {
      setPreview(null);
      setError(tr('libErrOpen'));
    }
  }

  function closePreview() {
    if (preview?.url) window.URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  async function handleDownload(row: LibraryRow) {
    try {
      const url = window.URL.createObjectURL(await fetchBlob(row));
      const a = document.createElement('a');
      a.href = url;
      a.download = row.fileName;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setError(tr('libErrOpen'));
    }
  }

  const hasFilters = !!(search || category || fileType || from || to);
  const resetFilters = () => {
    setSearch('');
    setCategory('');
    setFileType('');
    setFrom('');
    setTo('');
    setPage(0);
  };

  const openUpload = () => {
    setError('');
    setUploadCategory('GENERAL');
    setTarget(null);
    setTargetInput('');
    setNote('');
    setFile(null);
    setDialogOpen(true);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 240 }}>
          {tr('libIntro')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <RefreshButton onClick={() => refetch()} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={openUpload}>
            {tr('libUploadBtn')}
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      <Card>
        <Box sx={{ p: 2, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder={tr('libSearch')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />
          <TextField select size="small" label={tr('libType')} value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }} sx={{ minWidth: 190 }}>
            <MenuItem value="">{tr('libAllTypes')}</MenuItem>
            {categories.map((c) => <MenuItem key={c} value={c}>{tr(`cat.${c}`)}</MenuItem>)}
          </TextField>
          <TextField select size="small" label={tr('libFileKind')} value={fileType} onChange={(e) => { setFileType(e.target.value); setPage(0); }} sx={{ minWidth: 160 }}>
            <MenuItem value="">{tr('libAllFiles')}</MenuItem>
            <MenuItem value="IMAGE">{tr('libKindImage')}</MenuItem>
            <MenuItem value="DOCUMENT">{tr('libKindDoc')}</MenuItem>
          </TextField>
          <TextField size="small" type="date" label={tr('libFrom')} value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} InputLabelProps={{ shrink: true }} />
          <TextField size="small" type="date" label={tr('libTo')} value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} InputLabelProps={{ shrink: true }} />
          {hasFilters && <Button size="small" onClick={resetFilters}>{tr('libClear')}</Button>}
        </Box>

        <ResponsiveTable>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('libFile')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('libType')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('libRecord')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('uploadedBy')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('libUploadedOn')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{tr('libNone')}</Typography></TableCell></TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.key} hover>
                      <TableCell data-label={tr('libFile')}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {row.fileType === 'IMAGE' ? <ImageIcon fontSize="small" color="action" /> : <FileIcon fontSize="small" color="action" />}
                          <Box>
                            <Link component="button" type="button" variant="body2" underline="hover" onClick={() => handleView(row)} sx={{ wordBreak: 'break-all', textAlign: 'left' }}>
                              {row.fileName}
                            </Link>
                            {row.description && <Typography variant="caption" color="text.secondary">{row.description}</Typography>}
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell data-label={tr('libType')}>
                        <Chip size="small" variant="outlined" label={tr(`cat.${row.category}`)} />
                      </TableCell>
                      <TableCell data-label={tr('libRecord')}>
                        {row.category === 'GENERAL' ? (
                          '—'
                        ) : (
                          <Typography variant="body2" color={row.linkedLabel ? 'text.primary' : 'text.secondary'}>
                            {row.linkedLabel ?? tr('libNoRecord')}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell data-label={tr('uploadedBy')}>{row.uploadedBy?.name ?? '—'}</TableCell>
                      <TableCell data-label={tr('libUploadedOn')}>{formatDateTime(row.uploadedAt)}</TableCell>
                      <TableCell data-label={tr('actions')}>
                        {row.linkedPath && (
                          <Tooltip title={`${tr('libOpenRecord')}${row.linkedLabel ? ` – ${row.linkedLabel}` : ''}`}>
                            <IconButton size="small" color="primary" aria-label={tr('libDetails')} onClick={() => navigate(row.linkedPath!)}>
                              <InfoIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title={tr('libDownload')}><IconButton size="small" onClick={() => handleDownload(row)}><DownloadIcon fontSize="small" /></IconButton></Tooltip>
                        {row.canDelete && row.deleteRoute && (
                          <Tooltip title={tr('libDelete')}>
                            <IconButton size="small" color="error" onClick={() => { if (confirm(tr('libConfirmDelete'))) deleteMutation.mutate(row.deleteRoute!); }}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
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

      <ResponsiveDialog open={!!preview} onClose={closePreview} maxWidth="md" fullWidth>
        <DialogTitle sx={{ wordBreak: 'break-all' }}>{preview?.row.fileName}</DialogTitle>
        <DialogContent>
          {preview && !preview.previewable ? (
            <Alert severity="info">{tr('libPreviewUnavailable')}</Alert>
          ) : preview?.url ? (
            preview.row.fileType === 'IMAGE' ? (
              <Box component="img" src={preview.url} alt={preview.row.fileName} sx={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', mx: 'auto' }} />
            ) : (
              <Box component="iframe" src={preview.url} title={preview.row.fileName} sx={{ width: '100%', height: '70vh', border: 0 }} />
            )
          ) : (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
          )}
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          {preview?.row.linkedPath && (
            <Button startIcon={<InfoIcon />} onClick={() => { const p = preview.row.linkedPath!; closePreview(); navigate(p); }}>
              {tr('libOpenRecord')}
            </Button>
          )}
          <Button startIcon={<DownloadIcon />} onClick={() => preview && handleDownload(preview.row)}>{tr('libDownload')}</Button>
          <Button variant="contained" onClick={closePreview}>{tr('libClose')}</Button>
        </DialogActions>
      </ResponsiveDialog>

      <ResponsiveDialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('libUploadTitle')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
            <TextField
              select
              size="small"
              fullWidth
              label={tr('libRecordType')}
              value={uploadCategory}
              onChange={(e) => { setUploadCategory(e.target.value); setTarget(null); setTargetInput(''); }}
            >
              <MenuItem value="GENERAL">{tr('libNoRecordOption')}</MenuItem>
              {uploadTargets.map((c) => <MenuItem key={c} value={c}>{tr(`cat.${c}`)}</MenuItem>)}
            </TextField>
            {uploadCategory !== 'GENERAL' && (
            <Autocomplete
              size="small"
              options={targetOptions}
              value={target}
              onChange={(_e, v) => setTarget(v)}
              inputValue={targetInput}
              onInputChange={(_e, v) => setTargetInput(v)}
              getOptionLabel={(o) => o.label}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              filterOptions={(o) => o}
              loading={loadingTargets}
              noOptionsText={tr('libNoOptions')}
              renderInput={(params) => <TextField {...params} label={tr('libPickRecord')} placeholder={tr('libPickHint')} helperText={tr('libPickOptional')} />}
            />
            )}
            <TextField size="small" fullWidth label={tr('libDescription')} value={note} onChange={(e) => setNote(e.target.value)} inputProps={{ maxLength: 500 }} />
            <FilePicker
              accept={ACCEPT}
              file={file}
              onChange={setFile}
              label={tr('chooseFile')}
              selectedLabel={file ? `✓ ${file.name}` : undefined}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setDialogOpen(false)}>{tr('cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => { setError(''); uploadMutation.mutate(); }}
            disabled={!file || uploadMutation.isPending}
          >
            {uploadMutation.isPending ? <CircularProgress size={20} /> : tr('upload')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
