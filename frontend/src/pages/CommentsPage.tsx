import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  MenuItem,
  Stack,
  TablePagination,
  TextField,
  Typography,
  Avatar,
} from '@mui/material';
import { OpenInNew as OpenIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import api from '../config/api';
import RefreshButton from '../components/RefreshButton';
import CommentsButton, { CommentBody, CommentRow, roleLabel, timeAgo } from '../components/CommentsButton';

import { useTranslation } from 'react-i18next';
// Record types that can carry comments — keep in sync with the CommentsButton
// usages across pages.
export const COMMENT_ENTITY_LABELS: Record<string, string> = {
  MATERIAL_PURCHASE_REQUEST: 'Material Request',
  QUOTATION: 'Quotation',
  PURCHASE_ORDER: 'Purchase Order',
  INVOICE: 'Invoice',
  PAYMENT: 'Payment',
  VOUCHER: 'Voucher',
  JOURNAL_VOUCHER: 'Journal Voucher',
  GOODS_RECEIPT: 'Goods Receipt',
  GATE_PASS: 'Gate Pass',
  VENDOR: 'Vendor',
  CONTRACT: 'Contract',
  ISSUE: 'Issue',
};

interface UserOption {
  id: string;
  name: string;
  role: string;
}

export default function CommentsPage() {
  const { t: tr } = useTranslation('comments');
  const navigate = useNavigate();
  const [authorId, setAuthorId] = useState('');
  const [mentionedUserId, setMentionedUserId] = useState('');
  const [entityType, setEntityType] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['comments', 'users'],
    queryFn: async () => (await api.get('/comments/users')).data?.data ?? [],
    staleTime: 5 * 60_000,
  });

  const { data, isLoading, refetch } = useQuery<{
    data: CommentRow[];
    pagination: { total: number };
  }>({
    queryKey: ['comments', 'all', { authorId, mentionedUserId, entityType, search, from, to, page, pageSize }],
    queryFn: async () => {
      const res = await api.get('/comments/all', {
        params: {
          authorId: authorId || undefined,
          mentionedUserId: mentionedUserId || undefined,
          entityType: entityType || undefined,
          search: search || undefined,
          from: from || undefined,
          to: to || undefined,
          page: page + 1,
          pageSize,
        },
      });
      return res.data;
    },
  });

  const rows = data?.data ?? [];
  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(0);
  };
  const hasFilters = !!(authorId || mentionedUserId || entityType || search || from || to);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          {tr('comments')}
        </Typography>
        <RefreshButton onClick={() => refetch()} />
      </Box>

      <Card sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap">
          <TextField
            select
            size="small"
            label={tr('commentedBy')}
            value={authorId}
            onChange={(e) => reset(setAuthorId)(e.target.value)}
            sx={{ minWidth: { xs: "100%", md: 180 } }}
          >
            <MenuItem value="">{tr('anyone')}</MenuItem>
            {users.map((u) => (
              <MenuItem key={u.id} value={u.id}>
                {u.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={tr('taggedUser')}
            value={mentionedUserId}
            onChange={(e) => reset(setMentionedUserId)(e.target.value)}
            sx={{ minWidth: { xs: "100%", md: 180 } }}
          >
            <MenuItem value="">{tr('anyone')}</MenuItem>
            {users.map((u) => (
              <MenuItem key={u.id} value={u.id}>
                {u.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="On"
            value={entityType}
            onChange={(e) => reset(setEntityType)(e.target.value)}
            sx={{ minWidth: { xs: "100%", md: 180 } }}
          >
            <MenuItem value="">{tr('allRecords')}</MenuItem>
            {Object.entries(COMMENT_ENTITY_LABELS).map(([k, label]) => (
              <MenuItem key={k} value={k}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="date"
            label={tr('from')}
            value={from}
            onChange={(e) => reset(setFrom)(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            size="small"
            type="date"
            label="To"
            value={to}
            onChange={(e) => reset(setTo)(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            size="small"
            label={tr('search')}
            value={search}
            onChange={(e) => reset(setSearch)(e.target.value)}
            sx={{ minWidth: { xs: "100%", md: 220 }, flex: 1 }}
          />
          {hasFilters && (
            <Button
              onClick={() => {
                setAuthorId('');
                setMentionedUserId('');
                setEntityType('');
                setSearch('');
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

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : rows.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">{tr('notFound')}</Typography>
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {rows.map((c) => (
            <Card key={c.id} sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', gap: 1.5 }}>
                <Avatar sx={{ width: 34, height: 34 }}>{c.author.name.charAt(0).toUpperCase()}</Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
                    <Typography variant="subtitle2">{c.author.name}</Typography>
                    <Chip size="small" label={roleLabel(c.author.role)} sx={{ height: 18, fontSize: '0.65rem' }} />
                    <Typography variant="caption" color="text.secondary">
                      {timeAgo(c.createdAt)}
                    </Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      color="primary"
                      label={`${tr(`entity_${c.entityType}`, COMMENT_ENTITY_LABELS[c.entityType] ?? c.entityType)}${c.entityLabel ? ` · ${c.entityLabel}` : ''}`}
                    />
                    {(c.mentions ?? []).length === 0 && (
                      <Chip size="small" label={tr('toEveryone')} sx={{ height: 20, fontSize: '0.65rem' }} />
                    )}
                    <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
                      <CommentsButton
                        entityType={c.entityType}
                        entityId={c.entityId}
                        entityLabel={c.entityLabel ?? undefined}
                        url={c.url ?? undefined}
                      />
                      {c.url && (
                        <Button size="small" startIcon={<OpenIcon />} onClick={() => navigate(c.url as string)}>
                          {tr('open')}
                        </Button>
                      )}
                    </Box>
                  </Box>
                  <CommentBody body={c.body} mentions={c.mentions ?? []} />
                </Box>
              </Box>
            </Card>
          ))}
        </Stack>
      )}

      <TablePagination
        component="div"
        count={data?.pagination?.total ?? 0}
        page={page}
        rowsPerPage={pageSize}
        rowsPerPageOptions={[10, 25, 50, 100]}
        onPageChange={(_, p) => setPage(p)}
        onRowsPerPageChange={(e) => {
          setPageSize(parseInt(e.target.value, 10));
          setPage(0);
        }}
      />
    </Box>
  );
}
