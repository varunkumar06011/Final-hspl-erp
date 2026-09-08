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
  TrendingUp as InflowIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '../utils/enumOptions';
import api from '../config/api';
import ResponsiveTable from '../components/ResponsiveTable';
import RefreshButton from '../components/RefreshButton';

const TXN_TYPE_LABELS: Record<string, string> = {
  DEPOSIT: 'Deposit',
  TRANSFER_IN: 'Transfer In',
  REVERSAL_IN: 'Reversal In',
  MANUAL_DEPOSIT: 'Manual Deposit',
  IN: 'Cash In',
};

const TXN_TYPE_COLORS: Record<string, 'success' | 'info' | 'warning' | 'default'> = {
  DEPOSIT: 'success',
  TRANSFER_IN: 'info',
  REVERSAL_IN: 'warning',
  MANUAL_DEPOSIT: 'success',
  IN: 'success',
};

interface InflowTransaction {
  id: string;
  account: string;
  accountType: 'BANK' | 'CASH';
  amount: number;
  description: string;
  type: string;
  date: string;
}

export default function InwardFundsPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/dashboard/admin-inflow-detail'],
    queryFn: async () => {
      const response = await api.get('/dashboard/admin-inflow-detail', { params: { limit: 5000 } });
      return response.data as { totalAmount: number; totalCount: number; transactions: InflowTransaction[] };
    },
  });

  const allRows = data?.transactions ?? [];
  const filteredRows = search
    ? allRows.filter((t) => {
        const q = search.toLowerCase();
        return (
          t.account.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.type.toLowerCase().includes(q) ||
          t.accountType.toLowerCase().includes(q)
        );
      })
    : allRows;

  const rows = filteredRows.slice(page * pageSize, page * pageSize + pageSize);
  const total = filteredRows.length;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <InflowIcon color="success" />
          <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
            Inward Funds
          </Typography>
        </Stack>
        <Stack direction="row" spacing={2} alignItems="center">
          {!isLoading && data && (
            <Stack direction="row" spacing={2} alignItems="center">
              <Chip label={`${data.totalCount} transactions`} size="small" color="default" />
              <Typography variant="h6" fontWeight={700} color="success.main">
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
            placeholder="Search by account, description, type..."
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
                  <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Account</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No inward fund transactions found</Typography></TableCell></TableRow>
                ) : (
                  rows.map((t) => (
                    <TableRow key={t.id} hover>
                      <TableCell data-label="Date">{formatDate(t.date)}</TableCell>
                      <TableCell data-label="Account">
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Chip label={t.accountType} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                          <Typography variant="body2" noWrap>{t.account}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell data-label="Type">
                        <Chip
                          label={TXN_TYPE_LABELS[t.type] ?? t.type}
                          size="small"
                          color={TXN_TYPE_COLORS[t.type] ?? 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell data-label="Description">{t.description || '—'}</TableCell>
                      <TableCell data-label="Amount" align="right" sx={{ color: 'success.main', fontWeight: 700 }}>
                        +{formatCurrency(t.amount)}
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
