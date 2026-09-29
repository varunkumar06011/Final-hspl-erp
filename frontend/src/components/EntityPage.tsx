import { useState, useCallback, useEffect, useRef, Fragment, type ReactNode } from 'react';
import { useTheme } from '@mui/material/styles';
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
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import ResponsiveDialog from './ResponsiveDialog';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  RemoveCircleOutline as RemoveIcon,
  Download as DownloadIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import CreatableSelect from './CreatableSelect';
import SelectWithOther from './SelectWithOther';
import AttachmentUpload from './AttachmentUpload';
import ResponsiveTable from './ResponsiveTable';
import RefreshButton from './RefreshButton';
import PinConfirmDialog from './PinConfirmDialog';
import { exportToCsv, type CsvColumn } from '../utils/csvExport';
import { useUrlState } from '../hooks/useUrlState';
import { useDeepLinkRow } from '../hooks/useDeepLinkRow';
import { useTranslation } from 'react-i18next';
import { enumLabel } from '../utils/enumOptions';
import CommentsButton from './CommentsButton';

export interface MaterialEntry {
  id?: string;
  name: string;
  unit?: string;
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
  otherLabel?: string;
  otherFieldLabel?: string;
  createOptionLabel?: string;
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
  rowActions?: (row: Record<string, unknown>) => ReactNode;
  /** Called when a row/card is clicked (e.g. open a detail view). */
  onRowClick?: (row: Record<string, unknown>) => void;
  /** Optional CSV column definitions. When provided, an Export button is shown. */
  csvColumns?: CsvColumn[];
  csvFilename?: string;
  /** Field name used to deep-link from global search (e.g. 'name', 'accountName'). */
  deepLinkField?: string;
  /** Render rows as expandable cards (Quotation-style) instead of a table. */
  cardLayout?: boolean;
  /** Label for the button that triggers onRowClick in card layout. */
  rowClickLabel?: string;
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
  rowActions,
  onRowClick,
  csvColumns,
  csvFilename,
  deepLinkField,
  cardLayout = false,
  rowClickLabel,
}: EntityPageProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [page, setPage] = useUrlState<number>('page', 0, Number);
  const [pageSize, setPageSize] = useUrlState<number>('pageSize', 20, Number);
  const [search, setSearch] = useUrlState<string>('search', '');
  // Local input state — the field types freely; the URL param (and query) sync
  // after a short debounce so typing never fights the URL write/re-render.
  const [searchInput, setSearchInput] = useState(search);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the input in sync when the URL param changes externally (deep links,
  // back/forward navigation, global-search handoff).
  useEffect(() => {
    setSearchInput(search);
  }, [search]);
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        setSearch(value);
        setPage(0);
      }, 350);
    },
    [setSearch, setPage],
  );
  useEffect(() => () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }, []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
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
      setError(t('entity.requiredMissing', { fields: missingFields.map((f) => f.label).join(', ') }));
      return;
    }

    const invalidNumber = fields.find((f) => f.type === 'number' && form[f.name] !== undefined && form[f.name] !== '' && (!Number.isFinite(Number(form[f.name])) || Number(form[f.name]) < 0));
    if (invalidNumber) {
      setError(t('entity.negativeInvalid', { field: invalidNumber.label }));
      return;
    }

    const startDate = form.startDate ?? form.plannedStart;
    const endDate = form.endDate ?? form.plannedEnd;
    if (startDate && endDate && new Date(String(endDate)) < new Date(String(startDate))) {
      setError(t('entity.endBeforeStart'));
      return;
    }

    setError('');
    if (editing) {
      updateMutation.mutate({ id: editing.id as string, payload: form });
    } else {
      createMutation.mutate(form);
    }
  }, [editing, form, fields, updateMutation, createMutation, t]);

  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const submitting = createMutation.isPending || updateMutation.isPending;

  // Deep-link from global search: ?id=<rowId> — filter to that row and highlight it
  const { highlightId, rowRef } = useDeepLinkRow<Record<string, unknown> & { id: string }>(
    endpoint, rows as (Record<string, unknown> & { id: string })[], deepLinkField ?? 'name', setSearch,
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  useEffect(() => {
    if (highlightId) setExpandedId(highlightId);
  }, [highlightId]);

  // Shared cell renderer — used by both the table and the card layout.
  const renderCellContent = (row: Record<string, unknown>, col: ColumnDef): ReactNode =>
    col.render
      ? col.render(row)
      : col.key === statusKey
        ? (
            <Chip
              label={enumLabel(row[col.key])}
              size="small"
              color={statusColors?.[String(row[col.key])] ?? 'default'}
            />
          )
        : String(row[col.key] ?? '—');

  return (
    <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, overflowWrap: 'break-word' }}>
          {title}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, alignItems: 'center', width: { xs: '100%', md: 'auto' }, minWidth: { md: 'max-content' } }}>
          <RefreshButton onClick={() => refetch()} />
          {csvColumns && csvColumns.length > 0 && (
            <Button
              variant="outlined"
              size="small"
              startIcon={exporting ? <CircularProgress size={16} /> : <DownloadIcon />}
              onClick={async () => {
                setExporting(true);
                try {
                  await exportToCsv(endpoint, csvColumns, csvFilename ?? entityName, search);
                } catch (err: unknown) {
                  setError(extractErrorMessage(err));
                } finally {
                  setExporting(false);
                }
              }}
              disabled={exporting}
            >
              {t('entity.export')}
            </Button>
          )}
          {canCreate && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              {t('entity.new', { name: entityName })}
            </Button>
          )}
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <Card sx={{ overflow: 'hidden' }}>
        <Box sx={{ p: 2 }}>
          <TextField
            size="small"
            placeholder={t('entity.search', { title: title.toLowerCase() })}
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
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

        {cardLayout ? (
          /* Expandable cards — same pattern as the Quotations page */
          isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={32} /></Box>
          ) : isError ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Alert severity="error" sx={{ mb: 1 }}>{t('entity.loadFailed')}</Alert>
              <Button size="small" onClick={() => refetch()} startIcon={<RefreshIcon />}>{t('entity.retry')}</Button>
            </Box>
          ) : rows.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}><Typography color="text.secondary">{t('entity.noneFound', { title: title.toLowerCase() })}</Typography></Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, px: 2, pb: 2 }}>
              {rows.map((row: Record<string, unknown>) => (
                <Accordion
                  key={row.id as string}
                  ref={rowRef(row.id as string)}
                  expanded={expandedId === row.id}
                  onChange={(_event, expanded) => setExpandedId(expanded ? (row.id as string) : null)}
                  sx={{
                    mb: 1,
                    bgcolor: highlightId === row.id ? (theme.palette.mode === 'dark' ? 'rgba(255, 202, 40, 0.14)' : 'warning.light') : 'background.paper',
                    color: 'text.primary',
                    border: '1px solid',
                    borderColor: highlightId === row.id ? 'primary.main' : 'divider',
                    borderRadius: 1,
                    overflow: 'hidden',
                    '&:before': { display: 'none' },
                    '&:hover': { borderColor: 'primary.main' },
                  }}
                >
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                    sx={{ minHeight: 52, '&.Mui-expanded': { minHeight: 52 }, '& .MuiAccordionSummary-content': { my: 1, '&.Mui-expanded': { my: 1 } } }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
                      <Typography component="span" sx={{ fontSize: { xs: '0.82rem', sm: '0.9rem' } }}>
                        <strong>{String(row[columns[0]?.key] ?? '—')}</strong>
                        {columns[1] && <> — {String(row[columns[1].key] ?? '—')}</>}
                        {statusKey && ` — ${t('entity.statusColon')}`}
                      </Typography>
                      {statusKey && (
                        <Chip
                          label={enumLabel(row[statusKey])}
                          size="small"
                          color={statusColors?.[String(row[statusKey])] ?? 'default'}
                        />
                      )}
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary', p: 1.25 }}>
                    <Box sx={{ minWidth: 0 }}>
                      {/* Two-column label/value grid over all columns */}
                      <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: '140px 1fr 140px 1fr' },
                        gap: { xs: 0.25, sm: '2px 12px' },
                        alignItems: 'baseline',
                      }}>
                        {columns.map((col) => (
                          <Fragment key={col.key}>
                            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>
                              {col.label}
                            </Typography>
                            <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 0, overflowWrap: 'break-word' }}>
                              {renderCellContent(row, col)}
                            </Typography>
                          </Fragment>
                        ))}
                      </Box>

                      {/* Actions */}
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                        {onRowClick && (
                          <Button size="small" variant="outlined" onClick={() => onRowClick(row)}>{rowClickLabel ?? t('entity.view')}</Button>
                        )}
                        {rowActions?.(row)}
                        <CommentsButton entityType={entityType} entityId={row.id as string} entityLabel={String(row.name ?? row.title ?? row.code ?? "")} url={window.location.pathname} />
                        {canCreate && (
                          <>
                            <Button size="small" startIcon={<EditIcon />} onClick={() => openEdit(row)}>{t('entity.edit')}</Button>
                            <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => setDeleteConfirm(row.id as string)}>{t('entity.delete')}</Button>
                          </>
                        )}
                      </Box>
                    </Box>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Box>
          )
        ) : (
        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ '@media (min-width: 900px)': { minWidth: 'max-content', '& .MuiTableCell-root': { whiteSpace: 'nowrap' } } }}>
            <TableHead>
              <TableRow>
                {columns.map((col) => (
                  <TableCell key={col.key} sx={{ fontWeight: 600 }}>
                    {col.label}
                  </TableCell>
                ))}
                {canCreate && <TableCell align="right" sx={{ fontWeight: 600 }}>{t('entity.actions')}</TableCell>}
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
                    <Alert severity="error" sx={{ mb: 1 }}>{t('entity.loadFailed')}</Alert>
                    <Button size="small" onClick={() => refetch()} startIcon={<RefreshIcon />}>{t('entity.retry')}</Button>
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length + 1} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">{t('entity.noneFound', { title: title.toLowerCase() })}</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row: Record<string, unknown>) => (
                  <TableRow
                    key={row.id as string}
                    hover
                    ref={rowRef(row.id as string)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    sx={{
                      ...(onRowClick && { cursor: 'pointer' }),
                      ...(highlightId === row.id && { bgcolor: 'warning.light', '&:hover': { bgcolor: 'warning.light' } }),
                    }}
                  >
                    {columns.map((col) => (
                      <TableCell key={col.key} data-label={col.label}>
                        {renderCellContent(row, col)}
                      </TableCell>
                    ))}
                    {canCreate && (
                      <TableCell align="right" data-label={t('entity.actions')} onClick={(e) => e.stopPropagation()}>
                        {rowActions?.(row)}
                        <CommentsButton entityType={entityType} entityId={row.id as string} entityLabel={String(row.name ?? row.title ?? row.code ?? "")} url={window.location.pathname} />
                        <IconButton size="small" title={t('entity.edit')} onClick={() => openEdit(row)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" title={t('entity.delete')} onClick={() => setDeleteConfirm(row.id as string)}>
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
        )}

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
        <DialogTitle>{editing ? t('entity.editName', { name: entityName }) : t('entity.new', { name: entityName })}</DialogTitle>
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
                    createButtonLabel={field.createOptionLabel}
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
                    otherLabel={field.otherLabel}
                    otherFieldLabel={field.otherFieldLabel}
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
                  setForm({ ...form, [field.name]: [...materials, { name: '', unit: '' }] });
                };
                const removeMaterial = (index: number) => {
                  setForm({ ...form, [field.name]: materials.filter((_, i) => i !== index) });
                };
                return (
                  <Box key={field.name} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="body2" fontWeight={600}>{field.label}</Typography>
                      <Button size="small" startIcon={<AddIcon />} onClick={addMaterial}>{t('entity.addMaterial')}</Button>
                    </Box>
                    {materials.length === 0 && (
                      <Typography variant="caption" color="text.secondary">{t('entity.noMaterials')}</Typography>
                    )}
                    {materials.map((mat, index) => (
                      <Box key={index} sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, alignItems: { xs: 'stretch', sm: 'center' } }}>
                        <TextField
                          label={t('entity.materialName')}
                          value={mat.name ?? ''}
                          onChange={(e) => updateMaterial(index, 'name', e.target.value)}
                          size="small"
                          InputLabelProps={{ shrink: true }}
                          sx={{ flex: 2, minWidth: 0 }}
                        />
                        <IconButton size="small" color="error" onClick={() => removeMaterial(index)} sx={{ flexShrink: 0 }}>
                          <RemoveIcon fontSize="small" />
                        </IconButton>
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
                    value={form[field.name] !== undefined && form[field.name] !== null ? String(form[field.name]) : t('entity.autoGenerated')}
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
          <Button onClick={closeDialog}>{t('entity.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? <CircularProgress size={20} /> : editing ? t('entity.update') : t('entity.create')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      <PinConfirmDialog
        open={!!deleteConfirm}
        title={t('entity.deleteTitle', { name: entityName })}
        message={t('entity.deleteMessage')}
        confirmLabel={t('entity.delete')}
        onConfirm={() => {
          if (deleteConfirm) deleteMutation.mutate(deleteConfirm);
          setDeleteConfirm(null);
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </Box>
  );
}

