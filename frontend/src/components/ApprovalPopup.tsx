import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { SocketEvents } from '@hospital-erp/shared';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { useToast } from './ToastProvider';
import { getSocket } from '../hooks/usePresence';
import { formatCurrency } from '../utils/enumOptions';

interface PopupItem {
  kind: 'MPR' | 'PO' | 'INVOICE';
  id: string;
  number: string;
  party: string | null;
  amount: number | null;
  summary: string | null;
  lines: { name: string; quantity: number; unit: string | null }[];
  requestedBy: string | null;
  waitingSince: string;
  path: string;
}

interface PopupData {
  enabled: boolean;
  items: PopupItem[];
}

const QUERY_KEY = ['/approval-popup'];
const ROUTE: Record<PopupItem['kind'], string> = {
  MPR: 'material-purchase-requests',
  PO: 'purchase-orders',
  INVOICE: 'invoices',
};
const MAX_LINES = 6;
const SNOOZE_KEY = 'approvalPopupSnoozed';

// "Later" hides a card until the app is opened again (kept per browser tab session).
function readSnoozed(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SNOOZE_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function writeSnoozed(ids: Set<string>): void {
  try {
    sessionStorage.setItem(SNOOZE_KEY, JSON.stringify([...ids]));
  } catch {
    /* storage can be blocked (iOS WebKit); the card then simply comes back on the next refresh */
  }
}

/**
 * Pop-up for requests waiting on the signed-in user's approval. Only appears for users an admin
 * switched it on for (Module Access; Project Heads by default). The list comes from the server,
 * pushed live by a socket event the moment something is submitted. Approve / Reject use the
 * normal approval endpoints, so the workflow behind them is exactly the one already running.
 */
export default function ApprovalPopup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const [snoozed, setSnoozed] = useState<Set<string>>(readSnoozed);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const toast = useToast();

  const { data } = useQuery<PopupData>({
    queryKey: QUERY_KEY,
    queryFn: async () => (await api.get('/approval-popup')).data,
    enabled: !!userId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  // A submission anywhere makes the server nudge this app to look again.
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    let off: (() => void) | undefined;
    void getSocket().then((s) => {
      if (cancelled || !s) return;
      const refresh = () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      s.on(SocketEvents.APPROVAL_POPUP_REFRESH, refresh);
      off = () => s.off(SocketEvents.APPROVAL_POPUP_REFRESH, refresh);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [userId, queryClient]);

  const queue = useMemo(() => (data?.enabled ? data.items.filter((i) => !snoozed.has(`${i.kind}:${i.id}`)) : []), [data, snoozed]);
  const current = queue[0];

  useEffect(() => {
    setRejecting(false);
    setReason('');
  }, [current?.id]);

  const refreshAfter = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ['/my-work'] });
    void queryClient.invalidateQueries({ queryKey: ['mprs'] });
    void queryClient.invalidateQueries({ queryKey: ['/pos'] });
    void queryClient.invalidateQueries({ queryKey: ['/invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['pending-items'] });
  }, [queryClient]);

  // Optimistic: the card leaves (and the next one shows) the moment a button is tapped; the request
  // runs behind it. A refused request puts the card back with the reason it was refused.
  const decide = useMutation({
    mutationFn: async (v: { item: PopupItem; action: 'approve' | 'reject'; reason?: string }) => {
      const body = v.action === 'approve' ? { acknowledged: true } : { reason: v.reason, comments: v.reason, acknowledged: true };
      await api.post(`/${ROUTE[v.item.kind]}/${v.item.id}/${v.action}`, body);
    },
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<PopupData>(QUERY_KEY);
      queryClient.setQueryData<PopupData>(QUERY_KEY, (cur) =>
        cur && { ...cur, items: cur.items.filter((i) => !(i.kind === v.item.kind && i.id === v.item.id)) },
      );
      setFailed(null);
      return { previous };
    },
    onError: (err, v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(QUERY_KEY, ctx.previous);
      const message = extractErrorMessage(err);
      setFailed({ id: v.item.id, message });
      toast.error(message);
    },
    onSettled: refreshAfter,
  });

  const later = (item: PopupItem) => {
    const next = new Set(snoozed).add(`${item.kind}:${item.id}`);
    setSnoozed(next);
    writeSnoozed(next);
  };

  if (!current) return null;
  const lines = current.lines.slice(0, MAX_LINES);
  const extra = current.lines.length - lines.length;

  return (
    <Dialog open maxWidth="xs" fullWidth onClose={() => later(current)} sx={{ zIndex: (theme) => theme.zIndex.modal + 10 }}>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
          <Typography variant="h6" component="span" fontWeight={700}>{t('shared.approvalPopup.title')}</Typography>
          {queue.length > 1 && <Chip size="small" color="warning" label={t('shared.approvalPopup.more', { n: queue.length - 1 })} />}
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5, bgcolor: 'action.hover' }}>
          <Typography variant="caption" color="text.secondary">{t(`shared.approvalPopup.kind.${current.kind}`)}</Typography>
          <Typography variant="subtitle1" fontWeight={700}>{current.number}</Typography>
          <Row label={t('shared.approvalPopup.vendor')} value={current.party ?? '—'} />
          <Row label={t('shared.approvalPopup.total')} value={current.amount != null ? formatCurrency(current.amount) : '—'} strong />
          {current.requestedBy && <Row label={t('shared.approvalPopup.requestedBy')} value={current.requestedBy} />}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{t('shared.approvalPopup.materials')}</Typography>
          {lines.length > 0 ? (
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {lines.map((l, i) => (
                <li key={i}><Typography variant="body2">{l.name} × {l.quantity}{l.unit ? ` ${l.unit}` : ''}</Typography></li>
              ))}
              {extra > 0 && <li><Typography variant="body2" color="text.secondary">{t('shared.approvalPopup.moreLines', { n: extra })}</Typography></li>}
            </Box>
          ) : (
            <Typography variant="body2">{current.summary ?? '—'}</Typography>
          )}
        </Box>

        {rejecting && (
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            size="small"
            sx={{ mt: 2 }}
            label={t('shared.approvalPopup.reason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
        {failed?.id === current.id && (
          <Alert severity="error" sx={{ mt: 2 }} action={<Button color="inherit" size="small" onClick={() => navigate(current.path)}>{t('shared.approvalPopup.open')}</Button>}>
            {failed.message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
        {rejecting ? (
          <>
            <Button onClick={() => setRejecting(false)}>{t('shared.cancel')}</Button>
            <Button
              color="error"
              variant="contained"
              disabled={!reason.trim()}
              onClick={() => decide.mutate({ item: current, action: 'reject', reason: reason.trim() })}
            >
              {t('shared.approvalPopup.reject')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => later(current)} sx={{ mr: 'auto' }}>{t('shared.approvalPopup.later')}</Button>
            <Button color="error" variant="outlined" onClick={() => setRejecting(true)}>{t('shared.approvalPopup.reject')}</Button>
            <Button color="success" variant="contained" onClick={() => decide.mutate({ item: current, action: 'approve' })}>
              {t('shared.approvalPopup.approve')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" gap={2} sx={{ mt: 0.5 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={strong ? 700 : 500} sx={{ textAlign: 'right' }}>{value}</Typography>
    </Stack>
  );
}
