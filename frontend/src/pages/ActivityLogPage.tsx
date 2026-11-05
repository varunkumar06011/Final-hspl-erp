import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, CircularProgress, DialogActions, DialogContent, DialogTitle, Divider, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TablePagination, TextField, Typography } from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../config/api';
import RefreshButton from '../components/RefreshButton';
import ActivityLogRow, { formatActivityTime, useActivitySentence, type ActivityItem } from '../components/ActivityLogRow';

interface UserOption {
  id: string;
  name: string;
}

const ACTION_FILTERS = ['APPROVE', 'REJECT', 'COMMENT', 'CREATE', 'UPDATE', 'DELETE'];
const ENTITY_FILTERS = [
  'MATERIAL_PURCHASE_REQUEST', 'QUOTATION', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'GATE_PASS', 'VENDOR_INVOICE', 'PAYMENT_REQUEST',
  'JOURNAL_VOUCHER', 'VENDOR', 'BUDGET_HEAD', 'BANK_ACCOUNT', 'CASH_ACCOUNT', 'LEDGER', 'INVENTORY_ITEM', 'ASSET', 'DOCUMENT', 'USER', 'PROJECT',
];
const HIDDEN_FIELDS = ['id', 'createdAt', 'updatedAt', 'projectId', 'password'];

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v, null, 1);
  return String(v);
}

export default function ActivityLogPage() {
  const { t: tr } = useTranslation('activity');
  const navigate = useNavigate();
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [detailItem, setDetailItem] = useState<ActivityItem | null>(null);
  const sentence = useActivitySentence();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['comments', 'users'],
    queryFn: async () => (await api.get('/comments/users')).data?.data ?? [],
    staleTime: 5 * 60_000,
  });

  const { data, isLoading, refetch } = useQuery<{ data: ActivityItem[]; canViewDetails?: boolean; pagination: { total: number } }>({
    queryKey: ['activity-log', { userId, action, entityType, from, to, page, pageSize }],
    queryFn: async () =>
      (
        await api.get('/activity-log', {
          params: {
            userId: userId || undefined,
            action: action || undefined,
            entityType: entityType || undefined,
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
  const hasFilters = !!(userId || action || entityType || from || to);
  const canViewDetails = !!data?.canViewDetails;

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
          <TextField select size="small" label={tr('recordType')} value={entityType} onChange={(e) => reset(setEntityType)(e.target.value)} sx={{ minWidth: { xs: '100%', md: 200 } }}>
            <MenuItem value="">{tr('allRecordTypes')}</MenuItem>
            {ENTITY_FILTERS.map((e) => (
              <MenuItem key={e} value={e}>
                {tr(`entity_${e}`)}
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
                setEntityType('');
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
              <ActivityLogRow item={item} onOpen={(p) => navigate(p)} onDetails={canViewDetails ? setDetailItem : undefined} />
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
      <ResponsiveDialog open={!!detailItem} onClose={() => setDetailItem(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {detailItem && sentence(detailItem)}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {detailItem && `${detailItem.actor?.name ?? '—'} · ${formatActivityTime(detailItem.at)}`}
          </Typography>
        </DialogTitle>
        <DialogContent>
          {detailItem?.details && (() => {
            const oldV = detailItem.details!.oldValue as Record<string, unknown> | null;
            const newV = detailItem.details!.newValue as Record<string, unknown> | null;
            if (detailItem.action === 'UPDATE' && oldV && newV && typeof oldV === 'object' && typeof newV === 'object') {
              return (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('field')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('oldValue')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('newValue')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(newV)
                      .filter(([k]) => !HIDDEN_FIELDS.includes(k))
                      .map(([key, newVal]) => {
                        const oldVal = oldV[key];
                        const changed = JSON.stringify(oldVal) !== JSON.stringify(newVal);
                        return (
                          <TableRow key={key} sx={changed ? { bgcolor: 'warning.light' } : {}}>
                            <TableCell sx={{ fontWeight: 500 }}>{key}</TableCell>
                            <TableCell sx={{ color: changed ? 'error.main' : 'text.secondary', fontFamily: 'monospace', fontSize: 13 }}>{formatValue(oldVal)}</TableCell>
                            <TableCell sx={{ color: changed ? 'success.main' : 'text.primary', fontFamily: 'monospace', fontSize: 13 }}>{formatValue(newVal)}</TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              );
            }
            if (!oldV && !newV) return <Typography color="text.secondary">{tr('noData')}</Typography>;
            return (
              <Stack spacing={2}>
                {([['newValue', newV], ['oldValue', oldV]] as const).map(([label, value]) =>
                  value ? (
                    <Box key={label}>
                      <Typography variant="overline" color="text.secondary">{tr(label)}</Typography>
                      <Box component="pre" sx={{ bgcolor: 'background.default', p: 1.5, borderRadius: 1, fontSize: 12, fontFamily: 'monospace', overflow: 'auto', maxHeight: 300, m: 0 }}>
                        {JSON.stringify(value, null, 2)}
                      </Box>
                    </Box>
                  ) : null,
                )}
              </Stack>
            );
          })()}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailItem(null)}>{tr('close')}</Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
