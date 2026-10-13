import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Paper,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Refresh as RefreshIcon, Search as SearchIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import api from '../config/api';
import { useUrlState } from '../hooks/useUrlState';
import { formatCurrency, roleLabel } from '../utils/enumOptions';

type Kind = 'MPR' | 'QUOTATION' | 'PO' | 'INVOICE' | 'PAYMENT';
type Action = 'APPROVE' | 'FINALIZE' | 'REVIEW' | 'SUBMIT' | 'FIX';
type TabKey = 'needsAction' | 'waiting' | 'sentBack' | 'drafts';

interface WorkFlag {
  code: string;
  level: 'warn' | 'info';
  value?: number;
}

interface WorkItem {
  kind: Kind;
  id: string;
  number: string;
  party: string | null;
  amount: number | null;
  summary: string | null;
  why: string | null;
  status: string;
  action: Action;
  requestedBy: string | null;
  waitingOn: string[];
  waitingSince: string;
  path: string;
  flags: WorkFlag[];
}

interface MyWork {
  needsAction: WorkItem[];
  waiting: WorkItem[];
  sentBack: WorkItem[];
  drafts: WorkItem[];
}

const TABS: TabKey[] = ['needsAction', 'waiting', 'sentBack', 'drafts'];
const KINDS: Kind[] = ['MPR', 'QUOTATION', 'PO', 'INVOICE', 'PAYMENT'];
const DAY_MS = 86_400_000;

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS));

function WorkCard({ item, tab }: { item: WorkItem; tab: TabKey }) {
  const { t } = useTranslation('mywork');
  const navigate = useNavigate();
  const days = daysSince(item.waitingSince);
  const primary = tab === 'needsAction';

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderColor: primary && item.flags.some((f) => f.level === 'warn') ? 'warning.main' : 'divider' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'flex-start' }}>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Chip size="small" label={t(`kind.${item.kind}`)} />
            <Typography sx={{ fontWeight: 700 }}>{item.number}</Typography>
          </Box>
          {item.party && (
            <Typography variant="body2" color="text.secondary" noWrap>
              {item.party}
            </Typography>
          )}
        </Box>
        {item.amount != null && (
          <Typography sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatCurrency(item.amount)}</Typography>
        )}
      </Box>

      <Box sx={{ mt: 1 }}>
        {item.why ? (
          <Typography variant="body2">
            <Box component="span" sx={{ fontWeight: 600 }}>{t('why')}: </Box>
            {item.why}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            {t('noWhy')}
          </Typography>
        )}
        {item.summary && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {item.summary}
          </Typography>
        )}
      </Box>

      {item.flags.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
          {item.flags.map((f) => (
            <Chip
              key={f.code}
              size="small"
              variant="outlined"
              color={f.level === 'warn' ? 'warning' : 'info'}
              label={t(`flag.${f.code}`, { value: f.value ?? 0 })}
            />
          ))}
        </Box>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 1.25 }}>
        <Typography variant="caption" color="text.secondary">
          {[
            item.requestedBy ? t('raisedBy', { name: item.requestedBy }) : null,
            item.waitingOn.length > 0 && tab !== 'drafts' && tab !== 'sentBack'
              ? t('waitingOn', { who: item.waitingOn.map(roleLabel).join(' / ') })
              : null,
            tab !== 'drafts' ? (days > 0 ? t('daysShort', { n: days }) : t('today')) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
        <Button size="small" variant={primary ? 'contained' : 'outlined'} onClick={() => navigate(item.path)}>
          {t(`act.${item.action}`)}
        </Button>
      </Box>
    </Paper>
  );
}

export default function MyWorkPage() {
  const { t } = useTranslation('mywork');
  const [tab, setTab] = useUrlState<string>('tab', 'needsAction');
  const [kind, setKind] = useUrlState<string>('kind', '');
  const [q, setQ] = useUrlState<string>('q', '');
  const [longOnly, setLongOnly] = useUrlState<number>('long', 0, Number);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<MyWork>({
    queryKey: ['/my-work'],
    queryFn: async () => (await api.get('/my-work')).data,
    refetchInterval: 60000,
    refetchOnWindowFocus: 'always',
  });

  const active: TabKey = (TABS as string[]).includes(tab) ? (tab as TabKey) : 'needsAction';

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.[active] ?? []).filter((i) => {
      if (kind && i.kind !== kind) return false;
      if (longOnly && daysSince(i.waitingSince) < 3) return false;
      if (!needle) return true;
      return [i.number, i.party, i.why, i.summary, i.requestedBy].some((v) => (v ?? '').toLowerCase().includes(needle));
    });
  }, [data, active, kind, q, longOnly]);

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>{t('title')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('subtitle')}</Typography>
        </Box>
        <Tooltip title={t('refresh')}>
          <span>
            <IconButton onClick={() => refetch()} disabled={isFetching} aria-label={t('refresh')}>
              {isFetching ? <CircularProgress size={20} /> : <RefreshIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Tabs value={active} onChange={(_e, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 1 }}>
        {TABS.map((k) => (
          <Tab key={k} value={k} label={`${t(`tab.${k}`)}${data ? ` (${data[k].length})` : ''}`} />
        ))}
      </Tabs>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
        <TextField
          size="small"
          placeholder={t('search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
          sx={{ minWidth: 200, flex: 1 }}
        />
        <Chip label={t('all')} color={kind === '' ? 'primary' : 'default'} onClick={() => setKind('')} />
        {KINDS.map((k) => (
          <Chip key={k} label={t(`kind.${k}`)} color={kind === k ? 'primary' : 'default'} onClick={() => setKind(kind === k ? '' : k)} />
        ))}
        {(active === 'needsAction' || active === 'waiting') && (
          <Chip
            label={t('longOnly')}
            color={longOnly ? 'warning' : 'default'}
            variant={longOnly ? 'filled' : 'outlined'}
            onClick={() => setLongOnly(longOnly ? 0 : 1)}
          />
        )}
      </Box>

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : isError ? (
        <Alert severity="error">{t('loadError')}</Alert>
      ) : filtered.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {(data?.[active] ?? []).length === 0 ? t(`empty.${active}`) : t('noMatch')}
          </Typography>
        </Paper>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {filtered.map((item) => (
            <WorkCard key={`${item.kind}-${item.id}`} item={item} tab={active} />
          ))}
        </Box>
      )}
    </Box>
  );
}
