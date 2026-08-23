import { useState, useCallback } from 'react';
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
} from '@mui/material';
import ResponsiveDialog from './ResponsiveDialog';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  RemoveCircleOutline as RemoveIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import CreatableSelect from './CreatableSelect';
import SelectWithOther from './SelectWithOther';
import AttachmentUpload from './AttachmentUpload';
import ResponsiveTable from './ResponsiveTable';

export interface MaterialEntry {
  id?: string;
  name: string;
  pricePerUnit?: number;
}

export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'select-with-other' | 'materials-list';
  required?: boolean;
  options?: { value: string; label: string }[];
  optionsEndpoint?: string;
  optionLabelKey?: string;
  dropdownType?: string;
  defaultValue?: string | number;
  readonly?: boolean;
}

export interface ColumnDef {
  key: string;
  label: string;
  render?: (row: Record<string, unknown>) => React.ReactNode;
}

interface EntityPageProps {
  title: string;
  endpoint: string;
  entityName: string;
  entityType: string;
  columns: ColumnDef[];
  fields: FieldDef[];
  buildPayload?: (form: Record<string, unknown>) => Record<string, unknown>;
  statusKey?: string;
  statusColors?: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'>;
  canCreate?: boolean;
}

export default function EntityPage({
  title,
  endpoint,
  entityName,
  entityType,
  columns,
  fields,
  buildPayload,
  statusKey,
  statusColors,
  canCreate = true,
}: EntityPageProps) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
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
      const body = buildPayload ? buildPayload(payload) : payload;
      const response = await api.post(endpoint, body);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      closeDialog();
    },
    onError: (err: unknown) => {
      setError(extractErrorMessage(err));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) => {
      const body = buildPayload ? buildPayload(payload) : payload;
      const response = await api.patch(`${endpoint}/${id}`, body);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      closeDialog();
    },
    onError: (err: unknown) => {
      setError(extractErrorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`${endpoint}/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setDeleteConfirm(null);
    },
    onError: (err: unknown) => {
      setError(extractErrorMessage(err));
    },
  });

  const openCreate = useCallback(() => {
    const defaults: Record<string, unknown> = {};
    fields.forEach((f) => {
      if (f.defaultValue !== undefined) defaults[f.name] = f.defaultValue;
    });
    setForm(defaults);
    setEditing(null);
    setError('');
    setDialogOpen(true);
  }, [fields]);

  const openEdit = useCallback(
    (row: Record<string, unknown>) => {
      const formData: Record<string, unknown> = {};
      fields.forEach((f) => {
        formData[f.name] = row[f.name] ?? f.defaultValue ?? '';
      });
      setForm(formData);
      setEditing(row);
      setError('');
      setDialogOpen(true);
    },
    [fields]
  );

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditing(null);
    setForm({});
    setError('');
  }, []);

  const handleSubmit = useCallback(() => {
    const missingFields = fields.filter((f) => f.required && (form[f.name] === undefined || form[f.name] === null || String(form[f.name]).trim() === ''));
    if (missingFields.length > 0) {
      setError(`Required fields missing: ${missingFields.map((f) => f.label).join(', ')}`);
      return;
    }

    const invalidNumber = fields.find((f) => f.type === 'number' && form[f.name] !== undefined && form[f.name] !== '' && (!Number.isFinite(Number(form[f.name])) || Number(form[f.name]) < 0));
    if (invalidNumber) {
      setError(`${invalidNumber.label} cannot be negative or invalid`);
      return;
    }

    const startDate = form.startDate ?? form.plannedStart;
    const endDate = form.endDate ?? form.plannedEnd;
    if (startDate && endDate && new Date(String(endDate)) < new Date(String(startDate))) {
      setError('End date cannot be before start date');
      return;
    }

    setError('');
    if (editing) {
      updateMutation.mutate({ id: editing.id as string, payload: form });
    } else {
      createMutation.mutate(form);
    }
  }, [editing, form, fields, updateMutation, createMutation]);

  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const submitting = createMutation.isPending || updateMutation.isPending;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          {title}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <IconButton onClick={() => refetch()} size="small">
            <RefreshIcon />
          </IconButton>
          {canCreate && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              New {entityName}
            </Button>
          )}
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <Card>
        <Box sx={{ p: 2 }}>
          <TextField
            size="small"
            placeholder={`Search ${title.toLowerCase()}...`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />
        </Box>

        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {columns.map((col) => (
                  <TableCell key={col.key} sx={{ fontWeight: 600 }}>
                    {col.label}
                  </TableCell>
                ))}
                {canCreate && <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={columns.length + 1} align="center" sx={{ py: 4 }}>
                    <CircularProgress size={32} />
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={columns.length + 1} align="center" sx={{ py: 4 }}>
                    <Alert severity="error" sx={{ mb: 1 }}>Failed to load data. Check your connection and try again.</Alert>
                    <Button size="small" onClick={() => refetch()} startIcon={<RefreshIcon />}>Retry</Button>
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length + 1} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">No {title.toLowerCase()} found</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row: Record<string, unknown>) => (
                  <TableRow key={row.id as string} hover>
                    {columns.map((col) => (
                      <TableCell key={col.key} data-label={col.label}>
                        {col.render
                          ? col.render(row)
                          : col.key === statusKey
                            ? (
                                <Chip
                                  label={String(row[col.key] ?? '')}
                                  size="small"
                                  color={statusColors?.[String(row[col.key])] ?? 'default'}
                                />
                              )
                            : String(row[col.key] ?? '—')}
                      </TableCell>
                    ))}
                    {canCreate && (
                      <TableCell align="right" data-label="Actions">
                        <IconButton size="small" onClick={() => openEdit(row)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => setDeleteConfirm(row.id as string)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    )}
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
          onRowsPerPageChange={(e) => {
            setPageSize(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 20, 50]}
          sx={{ '& .MuiTablePagination-toolbar': { flexWrap: 'wrap' } }}
        />
      </Card>

      <ResponsiveDialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth sx={{ '& .MuiDialog-paper': { margin: { xs: 1 } } }}>
        <DialogTitle>{editing ? `Edit ${entityName}` : `New ${entityName}`}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1, flexWrap: 'wrap' }}>
            {fields.map((field) => {
              if (field.type === 'select') {
                return (
                  <CreatableSelect
                    key={field.name}
                    label={field.label}
                    value={String(form[field.name] ?? field.defaultValue ?? '')}
                    onChange={(v) => setForm({ ...form, [field.name]: v })}
                    required={field.required}
                    staticOptions={field.options}
                    optionsEndpoint={field.optionsEndpoint}
                    optionLabelKey={field.optionLabelKey}
                    dropdownType={field.dropdownType}
                  />
                );
              }
              if (field.type === 'select-with-other') {
                return (
                  <SelectWithOther
                    key={field.name}
                    label={field.label}
                    value={String(form[field.name] ?? '')}
                    onChange={(v) => setForm({ ...form, [field.name]: v })}
                    options={field.options ?? []}
                    required={field.required}
                  />
                );
              }
              if (field.type === 'materials-list') {
                const materials = (form[field.name] as MaterialEntry[] | undefined) ?? [];
                const updateMaterial = (index: number, key: keyof MaterialEntry, val: string | number | undefined) => {
                  const updated = [...materials];
                  updated[index] = { ...updated[index], [key]: val };
                  setForm({ ...form, [field.name]: updated });
                };
                const addMaterial = () => {
                  setForm({ ...form, [field.name]: [...materials, { name: '', pricePerUnit: undefined }] });
                };
                const removeMaterial = (index: number) => {
                  setForm({ ...form, [field.name]: materials.filter((_, i) => i !== index) });
                };
                return (
                  <Box key={field.name} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="body2" fontWeight={600}>{field.label}</Typography>
                      <Button size="small" startIcon={<AddIcon />} onClick={addMaterial}>Add Material</Button>
                    </Box>
                    {materials.length === 0 && (
                      <Typography variant="caption" color="text.secondary">No materials added yet.</Typography>
                    )}
                    {materials.map((mat, index) => (
                      <Box key={index} sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, alignItems: { xs: 'stretch', sm: 'center' } }}>
                        <TextField
                          label="Material Name"
                          value={mat.name ?? ''}
                          onChange={(e) => updateMaterial(index, 'name', e.target.value)}
                          size="small"
                          sx={{ flex: 2, minWidth: 0 }}
                        />
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                          <TextField
                            label="Price / Unit"
                            type="number"
                            value={mat.pricePerUnit ?? ''}
                            onChange={(e) => updateMaterial(index, 'pricePerUnit', e.target.value === '' ? undefined : Number(e.target.value))}
                            size="small"
                            sx={{ flex: 1, minWidth: 0 }}
                            inputProps={{ min: 0, step: 0.01 }}
                          />
                          <IconButton size="small" color="error" onClick={() => removeMaterial(index)} sx={{ flexShrink: 0 }}>
                            <RemoveIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                );
              }
              if (field.readonly) {
                return (
                  <TextField
                    key={field.name}
                    label={field.label}
                    value={form[field.name] !== undefined && form[field.name] !== null ? String(form[field.name]) : 'Auto-generated'}
                    fullWidth
                    size="small"
                    disabled
                    InputProps={{ readOnly: true }}
                  />
                );
              }
              if (field.type === 'textarea') {
                return (
                  <TextField
                    key={field.name}
                    label={field.label}
                    value={form[field.name] ?? ''}
                    onChange={(e) => setForm({ ...form, [field.name]: e.target.value })}
                    required={field.required}
                    fullWidth
                    size="small"
                    multiline
                    rows={3}
                  />
                );
              }
              return (
                <TextField
                  key={field.name}
                  label={field.label}
                  type={field.type}
                  value={form[field.name] ?? ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      [field.name]: field.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value,
                    })
                  }
                  required={field.required}
                  fullWidth
                  size="small"
                  inputProps={field.type === 'number' ? { min: 0, step: 0.01 } : undefined}
                  InputLabelProps={field.type === 'date' ? { shrink: true } : undefined}
                />
              );
            })}
          </Box>

          {editing && (
            <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <AttachmentUpload entityType={entityType} entityId={editing.id as string} />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? <CircularProgress size={20} /> : editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      <ResponsiveDialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <DialogTitle>Delete {entityName}?</DialogTitle>
        <DialogContent>
          <Typography>This action cannot be undone. The record will be soft-deleted.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)}
            disabled={deleteMutation.isPending}
          >
            Delete
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}

