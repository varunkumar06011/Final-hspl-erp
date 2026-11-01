import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import api from '../config/api';
import { dateLocale } from '../i18n';
import { roleLabel } from '../utils/enumOptions';
import { useAuthStore } from '../stores/authStore';

/** One row of GET /assistant/activity. */
interface ActivityRow {
  id: string;
  userId: string;
  tool: string;
  args: Record<string, unknown>;
  summary: { rows?: number | null; total?: number | null } | null;
  status: string;
  resultLabel: string | null;
  error: string | null;
  createdAt: string;
  user: { id: string; name: string; role: string } | null;
}

type Kind = 'all' | 'read' | 'write';
const PAGE_SIZE = 50;

const STATUS_COLOR: Record<string, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
  READ: 'info',
  EXECUTED: 'success',
  FAILED: 'error',
  PENDING: 'warning',
  EXECUTING: 'warning',
};

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Miko's audit trail: what it read and what it prepared or did, per person (admins see everyone). */
export default function MikoActivityDialog({ open, onClose }: Props) {
  const { t } = useTranslation('assistant');
  const me = useAuthStore((s) => s.user);
  const [kind, setKind] = useState<Kind>('all');
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(
    async (nextPage: number, which: Kind) => {
      setLoading(true);
      setError(false);
      try {
        const { data } = await api.get('/assistant/activity', { params: { kind: which, page: nextPage, pageSize: PAGE_SIZE } });
        setRows((prev) => (nextPage === 1 ? data.data : [...prev, ...data.data]));
        setTotal(data.pagination?.total ?? 0);
        setPage(nextPage);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (open) void load(1, kind);
  }, [open, kind, load]);

  const others = rows.some((r) => r.userId !== me?.id);

  const what = (r: ActivityRow) => {
    const tool = t(`tool.${r.tool}`, { defaultValue: r.tool });
    const model = typeof r.args?.model === 'string' ? r.args.model : typeof r.args?.entity === 'string' ? r.args.entity : null;
    const query = typeof r.args?.query === 'string' ? `“${r.args.query}”` : null;
    return [tool, model, query].filter(Boolean).join(' · ');
  };

  const result = (r: ActivityRow) => {
    if (r.error) return r.error;
    if (r.status === 'READ') return r.summary?.rows != null ? t('activity.rows', { count: r.summary.rows }) : '';
    return r.resultLabel ?? '';
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      // Above Miko's drawer.
      sx={{ zIndex: (theme) => theme.zIndex.tooltip + 200 }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Box sx={{ flexGrow: 1 }}>{t('activity.title')}</Box>
        <IconButton onClick={onClose} aria-label={t('close')}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {others ? t('activity.hint') : t('activity.hintOwn')}
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={kind}
          onChange={(_e, v: Kind | null) => v && setKind(v)}
          sx={{ mb: 1.5 }}
        >
          <ToggleButton value="all">{t('activity.all')}</ToggleButton>
          <ToggleButton value="read">{t('activity.reads')}</ToggleButton>
          <ToggleButton value="write">{t('activity.writes')}</ToggleButton>
        </ToggleButtonGroup>

        {error && <Alert severity="error">{t('activity.error')}</Alert>}
        {!error && !loading && rows.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('activity.empty')}
          </Typography>
        )}
        {rows.length > 0 && (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('activity.when')}</TableCell>
                  {others && <TableCell>{t('activity.who')}</TableCell>}
                  <TableCell>{t('activity.what')}</TableCell>
                  <TableCell>{t('activity.result')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {new Date(r.createdAt).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' })}
                    </TableCell>
                    {others && (
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {r.user ? `${r.user.name} (${roleLabel(r.user.role)})` : '—'}
                      </TableCell>
                    )}
                    <TableCell>{what(r)}</TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Chip
                          size="small"
                          color={STATUS_COLOR[r.status] ?? 'default'}
                          variant="outlined"
                          label={t(`activity.status.${r.status}`, { defaultValue: r.status })}
                        />
                        <Typography variant="caption" color={r.error ? 'error' : 'text.secondary'}>
                          {result(r)}
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.5 }}>
          {loading ? (
            <CircularProgress size={20} />
          ) : (
            rows.length < total && <Button onClick={() => void load(page + 1, kind)}>{t('activity.more')}</Button>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
