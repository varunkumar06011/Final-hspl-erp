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
  Chip,
  CircularProgress,
  TextField,
  InputAdornment,
  Stack,
} from '@mui/material';
import {
  TrendingDown as OutflowIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDate, enumLabel } from '../utils/enumOptions';
import api from '../config/api';
import ResponsiveTable from '../components/ResponsiveTable';
import RefreshButton from '../components/RefreshButton';

import { useTranslation } from 'react-i18next';
interface OutflowTransaction {
  id: string;
  account: string;
  accountType: 'BANK' | 'CASH';
  amount: number;
  description: string;
  date: string;
  budgetHead?: { id: string; particulars: string } | null;
}

export default function ExpenditurePage() {
  const { t: tr } = useTranslation('expenditure');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/dashboard', 'outflow-by-range', 'all'],
    queryFn: async () => {
      const response = await api.get('/dashboard/outflow-by-range', {
        params: { startDate: '2000-01-01', endDate: '2099-12-31', limit: 5000 },
      });
      return response.data as { totalAmount: number; totalCount: number; transactions: OutflowTransaction[] };
    },
  });

  const allRows = data?.transactions ?? [];
  const filteredRows = search
    ? allRows.filter((t) => {
        const q = search.toLowerCase();
        return (
          t.account.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.accountType.toLowerCase().includes(q) ||
          (t.budgetHead?.particulars ?? '').toLowerCase().includes(q)
        );
      })
    : allRows;

  const rows = filteredRows.slice(page * pageSize, page * pageSize + pageSize);
  const total = filteredRows.length;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <OutflowIcon color="error" />
          <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
            {tr('expenditure')}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={2} alignItems="center">
          {!isLoading && data && (
            <Stack direction="row" spacing={2} alignItems="center">
              <Chip label={tr('count', { n: data.totalCount })} size="small" color="default" />
              <Typography variant="h6" fontWeight={700} color="error.main">
                {formatCurrency(data.totalAmount)}
              </Typography>
            </Stack>
          )}
          <RefreshButton onClick={() => refetch()} />
        </Stack>
      </Box>

      <Card>
        <Box sx={{ p: 2 }}>
          <TextField
            size="small"
            placeholder={tr('search')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: { xs: '100%', sm: 350 } }}
          />
        </Box>

        <ResponsiveTable>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('date')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('account')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('budgetHead')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('description')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">{tr('amount')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{tr('none')}</Typography></TableCell></TableRow>
                ) : (
                  rows.map((t) => (
                    <TableRow key={t.id} hover>
                      <TableCell data-label={tr('date')}>{formatDate(t.date)}</TableCell>
                      <TableCell data-label={tr('account')}>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Chip label={enumLabel(t.accountType)} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                          <Typography variant="body2" noWrap>{t.account}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell data-label={tr('budgetHead')}>
                        {t.budgetHead ? (
                          <Chip label={t.budgetHead.particulars} size="small" color="primary" variant="outlined" sx={{ height: 22, fontSize: '0.7rem', maxWidth: 200 }} />
                        ) : (
                          <Typography variant="body2" color="text.secondary" noWrap>—</Typography>
                        )}
                      </TableCell>
                      <TableCell data-label={tr('description')}>{t.description || '—'}</TableCell>
                      <TableCell data-label={tr('amount')} align="right" sx={{ color: 'error.main', fontWeight: 700 }}>
                        −{formatCurrency(t.amount)}
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
          count={total}
          page={page}
          onPageChange={(_e, p) => setPage(p)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 25, 50, 100]}
          sx={{ '& .MuiTablePagination-toolbar': { flexWrap: 'wrap' } }}
        />
      </Card>
    </Box>
  );
}
