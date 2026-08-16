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
  IconButton,
  Chip,
  Alert,
  CircularProgress,
  MenuItem,
  InputAdornment,
} from '@mui/material';
import { Refresh as RefreshIcon, Search as SearchIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { AuditAction } from '@hospital-erp/shared';
import { enumToOptions, formatDate } from '../utils/enumOptions';
import api from '../config/api';

export default function AuditLogPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['/audit', page, pageSize, search, action],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (action) params.action = action;
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>Audit Log</Typography>
        <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
      </Box>

      <Card>
        <Box sx={{ p: 2, display: 'flex', gap: 2 }}>
          <TextField
            size="small"
            placeholder="Search audit log..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: 300 }}
          />
          <TextField select size="small" label="Action" value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }} sx={{ width: 180 }}>
            <MenuItem value="">All</MenuItem>
            {enumToOptions(AuditAction).map((opt) => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
          </TextField>
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>User</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Action</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Entity</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Details</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : isError ? (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><Alert severity="error">Failed to load audit log</Alert></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No audit entries found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row: Record<string, unknown>) => (
                  <TableRow key={row.id as string} hover>
                    <TableCell>{formatDate(row.createdAt)}</TableCell>
                    <TableCell>{(row.user as any)?.name ?? '—'}</TableCell>
                    <TableCell><Chip label={String(row.action ?? '')} size="small" color={ACTION_COLORS[String(row.action)] ?? 'default'} /></TableCell>
                    <TableCell>{String(row.entityType ?? '—')}</TableCell>
                    <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.newValue ? JSON.stringify(row.newValue) : '—'}
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
    </Box>
  );
}
