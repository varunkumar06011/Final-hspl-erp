import { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TextField,
  Chip,
  Alert,
  CircularProgress,
  MenuItem,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
} from '@mui/material';
import { Search as SearchIcon, Visibility as ViewIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { AuditAction } from '@hospital-erp/shared';
import { enumToOptions } from '../utils/enumOptions';
import i18n from '../i18n';
import { enumLabel } from '../utils/enumOptions';
import api from '../config/api';
import ResponsiveTable from '../components/ResponsiveTable';
import RefreshButton from '../components/RefreshButton';

import { useTranslation } from 'react-i18next';
interface AuditLogRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  timestamp: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  user: { id: string; name: string; role: string } | null;
}

function formatTimestamp(date: unknown): string {
  if (!date) return '—';
  const d = new Date(String(date));
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDetails(row: AuditLogRow): string {
  const value = row.newValue ?? row.oldValue;
  if (!value) return '—';
  const entries = Object.entries(value);
  if (entries.length === 0) return '—';

  const entityLabel = entityName(row.entityType);
  const actionLower = row.action.toLowerCase();

  // For CREATE actions, summarize what was created
  if (actionLower === 'create') {
    const name = (value as Record<string, unknown>).name ?? (value as Record<string, unknown>).code ?? (value as Record<string, unknown>).invoiceNo ?? (value as Record<string, unknown>).passNumber ?? (value as Record<string, unknown>).title;
    if (name) return i18n.t('auditlog:created', { e: entityLabel.toLowerCase(), n: String(name) });
    return i18n.t('auditlog:createdNew', { e: entityLabel.toLowerCase() });
  }

  // For DELETE actions, summarize what was deleted
  if (actionLower === 'delete') {
    const name = (value as Record<string, unknown>).name ?? (value as Record<string, unknown>).code ?? (value as Record<string, unknown>).title;
    if (name) return i18n.t('auditlog:deleted', { e: entityLabel.toLowerCase(), n: String(name) });
    return i18n.t('auditlog:deletedNoName', { e: entityLabel.toLowerCase() });
  }

  // For APPROVE/REJECT, summarize the action
  if (actionLower === 'approve') return i18n.t('auditlog:approved', { e: entityLabel.toLowerCase() });
  if (actionLower === 'reject') return i18n.t('auditlog:rejected', { e: entityLabel.toLowerCase() });

  // For UPDATE actions, show what changed
  const readableParts: string[] = [];
  for (const [k, v] of entries) {
    // Skip noisy/internal fields
    if (['id', 'createdAt', 'updatedAt', 'projectId', 'password'].includes(k)) continue;
    const valStr = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    if (valStr && valStr !== 'null' && valStr !== 'undefined' && valStr !== '[object Object]') {
      readableParts.push(`${k}: ${valStr}`);
    }
  }
  if (readableParts.length === 0) return i18n.t('auditlog:actionOn', { a: enumLabel(row.action), e: entityLabel.toLowerCase() });
  return readableParts.join('  |  ');
}

function entityName(type: string): string {
  return i18n.t(`auditlog:entity_${type}`, { defaultValue: enumLabel(type) });
}

export default function AuditLogPage() {
  const { t: tr } = useTranslation('auditlog');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [detailRow, setDetailRow] = useState<AuditLogRow | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['/audit', page, pageSize, search, action, startDate, endDate, userFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (action) params.action = action;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (userFilter) params.user = userFilter;
      const response = await api.get('/audit', { params });
      return response.data;
    },
  });

  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  const ACTION_COLORS: Record<string, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
    CREATE: 'success',
    UPDATE: 'info',
    DELETE: 'error',
    APPROVE: 'primary',
    REJECT: 'error',
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>{tr('title')}</Typography>
        <RefreshButton onClick={() => refetch()} />
      </Box>

      <Card>
        <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder={tr('search')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />
          <TextField select size="small" label={tr('action')} value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }} sx={{ width: { xs: '100%', sm: 180 } }}>
            <MenuItem value="">{tr('all')}</MenuItem>
            {enumToOptions(AuditAction).map((opt) => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
          </TextField>
          <TextField size="small" type="date" label={tr('from')} value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(0); }} InputLabelProps={{ shrink: true }} sx={{ width: { xs: '100%', sm: 140 } }} />
          <TextField size="small" type="date" label="To" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(0); }} InputLabelProps={{ shrink: true }} sx={{ width: { xs: '100%', sm: 140 } }} />
          <TextField size="small" placeholder={tr('filterUser')} value={userFilter} onChange={(e) => { setUserFilter(e.target.value); setPage(0); }} sx={{ width: { xs: '100%', sm: 160 } }} />
        </Box>

        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{tr('date')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('user')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('action')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('entity')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tr('details')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}> </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : isError ? (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><Alert severity="error">{tr('errLoad')}</Alert></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{tr('none')}</Typography></TableCell></TableRow>
              ) : (
                rows.map((row: AuditLogRow) => (
                  <TableRow key={row.id} hover>
                    <TableCell data-label={tr('date')} sx={{ whiteSpace: 'nowrap' }}>{formatTimestamp(row.timestamp)}</TableCell>
                    <TableCell data-label={tr('user')}>{row.user?.name ?? '—'}</TableCell>
                    <TableCell data-label={tr('action')}><Chip label={enumLabel(row.action)} size="small" color={ACTION_COLORS[row.action] ?? 'default'} /></TableCell>
                    <TableCell data-label={tr('entity')}>{entityName(row.entityType)}</TableCell>
                    <TableCell data-label={tr('details')} sx={{ maxWidth: { xs: '65%', md: 400 }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: { xs: 'normal', md: 'nowrap' } }}>
                      {formatDetails(row)}
                    </TableCell>
                    <TableCell data-label={tr('view')}>
                      <Button size="small" startIcon={<ViewIcon fontSize="small" />} onClick={() => setDetailRow(row)}>{tr('view')}</Button>
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

      {/* Diff viewer dialog */}
      <Dialog open={!!detailRow} onClose={() => setDetailRow(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {detailRow && `${enumLabel(detailRow.action)} — ${entityName(detailRow.entityType)}`}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {detailRow && `${detailRow.user?.name ?? '—'} · ${formatTimestamp(detailRow.timestamp)}`}
          </Typography>
        </DialogTitle>
        <DialogContent>
          {detailRow && (
            <Box>
              {/* Show field-by-field diff for UPDATE actions */}
              {detailRow.action === 'UPDATE' && detailRow.oldValue && detailRow.newValue ? (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('field')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('oldValue')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('newValue')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(detailRow.newValue)
                      .filter(([k]) => !['id', 'createdAt', 'updatedAt', 'projectId', 'password'].includes(k))
                      .map(([key, newVal]) => {
                        const oldVal = detailRow.oldValue?.[key];
                        const changed = JSON.stringify(oldVal) !== JSON.stringify(newVal);
                        return (
                          <TableRow key={key} sx={changed ? { bgcolor: 'warning.light' } : {}}>
                            <TableCell sx={{ fontWeight: 500 }}>{key}</TableCell>
                            <TableCell sx={{ color: changed ? 'error.main' : 'text.secondary', fontFamily: 'monospace', fontSize: 13 }}>
                              {formatValue(oldVal)}
                            </TableCell>
                            <TableCell sx={{ color: changed ? 'success.main' : 'text.primary', fontFamily: 'monospace', fontSize: 13 }}>
                              {formatValue(newVal)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              ) : (
                /* Show full JSON for CREATE/DELETE/APPROVE/REJECT */
                <Stack spacing={2}>
                  {detailRow.newValue && (
                    <Box>
                      <Typography variant="overline" color="text.secondary">{tr('newValue')}</Typography>
                      <Box component="pre" sx={{ bgcolor: 'background.default', p: 1.5, borderRadius: 1, fontSize: 12, fontFamily: 'monospace', overflow: 'auto', maxHeight: 300, m: 0 }}>
                        {JSON.stringify(detailRow.newValue, null, 2)}
                      </Box>
                    </Box>
                  )}
                  {detailRow.oldValue && (
                    <Box>
                      <Typography variant="overline" color="text.secondary">{tr('oldValue')}</Typography>
                      <Box component="pre" sx={{ bgcolor: 'background.default', p: 1.5, borderRadius: 1, fontSize: 12, fontFamily: 'monospace', overflow: 'auto', maxHeight: 300, m: 0 }}>
                        {JSON.stringify(detailRow.oldValue, null, 2)}
                      </Box>
                    </Box>
                  )}
                  {!detailRow.newValue && !detailRow.oldValue && (
                    <Typography color="text.secondary">{tr('noData')}</Typography>
                  )}
                </Stack>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailRow(null)}>{tr('close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v, null, 1);
  return String(v);
}
