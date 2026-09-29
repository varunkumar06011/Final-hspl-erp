import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, CircularProgress, Divider, MenuItem, Stack, TablePagination, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../config/api';
import RefreshButton from '../components/RefreshButton';
import ActivityLogRow, { type ActivityItem } from '../components/ActivityLogRow';

interface UserOption {
  id: string;
  name: string;
}

const ACTION_FILTERS = ['APPROVE', 'REJECT', 'COMMENT', 'CREATE', 'UPDATE', 'DELETE'];

export default function ActivityLogPage() {
  const { t: tr } = useTranslation('activity');
  const navigate = useNavigate();
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['comments', 'users'],
    queryFn: async () => (await api.get('/comments/users')).data?.data ?? [],
    staleTime: 5 * 60_000,
  });

  const { data, isLoading, refetch } = useQuery<{ data: ActivityItem[]; pagination: { total: number } }>({
    queryKey: ['activity-log', { userId, action, from, to, page, pageSize }],
    queryFn: async () =>
      (
        await api.get('/activity-log', {
          params: {
            userId: userId || undefined,
            action: action || undefined,
            from: from || undefined,
            to: to || undefined,
            page: page + 1,
            pageSize,
          },
        })
      ).data,
  });

  const rows = data?.data ?? [];
  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(0);
  };
  const hasFilters = !!(userId || action || from || to);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          {tr('title')}
        </Typography>
        <RefreshButton onClick={() => refetch()} />
      </Box>

      <Card sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap">
          <TextField select size="small" label={tr('person')} value={userId} onChange={(e) => reset(setUserId)(e.target.value)} sx={{ minWidth: { xs: '100%', md: 200 } }}>
            <MenuItem value="">{tr('everyone')}</MenuItem>
            {users.map((u) => (
              <MenuItem key={u.id} value={u.id}>
                {u.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label={tr('activity')} value={action} onChange={(e) => reset(setAction)(e.target.value)} sx={{ minWidth: { xs: '100%', md: 180 } }}>
            <MenuItem value="">{tr('allActivity')}</MenuItem>
            {ACTION_FILTERS.map((a) => (
              <MenuItem key={a} value={a}>
                {tr(`filter_${a}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField size="small" type="date" label={tr('from')} value={from} onChange={(e) => reset(setFrom)(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField size="small" type="date" label={tr('to')} value={to} onChange={(e) => reset(setTo)(e.target.value)} InputLabelProps={{ shrink: true }} />
          {hasFilters && (
            <Button
              onClick={() => {
                setUserId('');
                setAction('');
                setFrom('');
                setTo('');
                setPage(0);
              }}
            >
              {tr('clear')}
            </Button>
          )}
        </Stack>
      </Card>

      <Card sx={{ px: 2 }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : rows.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 4, textAlign: 'center' }}>
            {tr('none')}
          </Typography>
        ) : (
          rows.map((item, i) => (
            <Box key={item.id}>
              {i > 0 && <Divider />}
              <ActivityLogRow item={item} onOpen={(p) => navigate(p)} />
            </Box>
          ))
        )}
      </Card>

      <TablePagination
        component="div"
        count={data?.pagination?.total ?? 0}
        page={page}
        rowsPerPage={pageSize}
        rowsPerPageOptions={[10, 20, 50]}
        onPageChange={(_, p) => setPage(p)}
        onRowsPerPageChange={(e) => {
          setPageSize(parseInt(e.target.value, 10));
          setPage(0);
        }}
      />
    </Box>
  );
}
