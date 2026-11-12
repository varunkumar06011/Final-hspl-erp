import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Card, Chip, CircularProgress, DialogActions, DialogContent, DialogTitle, Link, MenuItem, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from '../components/ResponsiveDialog';
import RefreshButton from '../components/RefreshButton';
import { formatCurrency, formatDate } from '../utils/enumOptions';

interface EntityRef { entityType: string; entityId: string; label: string; url: string | null }
interface Flag {
  id: string;
  kind: 'FILE' | 'AMOUNT' | 'PROOF_REUSE';
  status: 'OPEN' | 'GENUINE' | 'DUPLICATE';
  reason: string;
  createdAt: string;
  uploadedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  proofNumber: string | null;
  vendorName: string | null;
  amount: number | null;
  fileName: string | null;
  matchedFileName: string | null;
  record: EntityRef | null;
  matched: EntityRef | null;
}
interface Unused { id: string; number: string; baseNumber: string; issuedAt: string; issuedBy: string | null }

const KIND_TONE = { FILE: 'error', AMOUNT: 'warning', PROOF_REUSE: 'secondary' } as const;

function RecordLink({ r }: { r: EntityRef | null }) {
  const { t } = useTranslation('proofs');
  if (!r) return <Typography variant="body2" color="text.secondary">{t('recordUnknown')}</Typography>;
  return r.url ? (
    <Link component={RouterLink} to={r.url} underline="hover" sx={{ fontWeight: 600 }}>{r.label}</Link>
  ) : (
    <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.label}</Typography>
  );
}

/** Admin view of possible duplicates: same file, same shop/vendor + amount, proof number used twice. */
export default function DuplicatesPage() {
  const { t } = useTranslation('proofs');
  const qc = useQueryClient();
  const [tab, setTab] = useState<'OPEN' | 'REVIEWED' | 'UNUSED'>('OPEN');
  const [kind, setKind] = useState('');
  const [review, setReview] = useState<{ flag: Flag; status: 'GENUINE' | 'DUPLICATE' } | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const flags = useQuery({
    queryKey: ['/duplicates', tab, kind],
    enabled: tab !== 'UNUSED',
    queryFn: async (): Promise<{ data: Flag[]; counts: { open: number; genuine: number; duplicate: number }; softDuplicateDays: number }> =>
      (await api.get('/duplicates', { params: { status: tab === 'OPEN' ? 'OPEN' : 'ALL', kind: kind || undefined } })).data,
  });
  const counts = useQuery({
    queryKey: ['/duplicates', 'counts'],
    queryFn: async (): Promise<{ counts: { open: number; genuine: number; duplicate: number } }> => (await api.get('/duplicates', { params: { status: 'OPEN' } })).data,
  });
  const unused = useQuery({
    queryKey: ['/duplicates', 'unused'],
    queryFn: async (): Promise<{ data: Unused[] }> => (await api.get('/duplicates/unused-proofs')).data,
  });

  const save = useMutation({
    mutationFn: async (v: { id: string; status: 'GENUINE' | 'DUPLICATE' | 'OPEN'; note?: string }) => (await api.post(`/duplicates/${v.id}/review`, { status: v.status, note: v.note })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/duplicates'] }); setReview(null); setNote(''); },
    onError: (e) => setError(extractErrorMessage(e)),
  });
  const backfill = useMutation({
    mutationFn: async () => (await api.post('/duplicates/backfill')).data as { fingerprinted: number },
  });

  const rows = (flags.data?.data ?? []).filter((f) => tab === 'OPEN' || f.status !== 'OPEN');
  const open = counts.data?.counts.open ?? 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>{t('pageTitle')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('pageIntro', { n: flags.data?.softDuplicateDays ?? 7 })}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="outlined" disabled={backfill.isPending} onClick={() => backfill.mutate()}>
            {backfill.isPending ? <CircularProgress size={16} /> : t('scanOld')}
          </Button>
          <RefreshButton onClick={() => qc.invalidateQueries({ queryKey: ['/duplicates'] })} />
        </Box>
      </Box>
      {backfill.data && <Alert severity="info" sx={{ mb: 1 }} onClose={() => backfill.reset()}>{t('scanned', { n: backfill.data.fingerprinted })}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }} variant="scrollable" scrollButtons="auto">
        <Tab value="OPEN" label={t('tabOpen', { n: open })} />
        <Tab value="REVIEWED" label={t('tabReviewed')} />
        <Tab value="UNUSED" label={t('tabUnused', { n: unused.data?.data.length ?? 0 })} />
      </Tabs>

      {tab !== 'UNUSED' && (
        <TextField select size="small" label={t('filterKind')} value={kind} onChange={(e) => setKind(e.target.value)} sx={{ minWidth: 200, mb: 2 }}>
          <MenuItem value="">{t('allKinds')}</MenuItem>
          <MenuItem value="FILE">{t('kindFILE')}</MenuItem>
          <MenuItem value="AMOUNT">{t('kindAMOUNT')}</MenuItem>
          <MenuItem value="PROOF_REUSE">{t('kindPROOF_REUSE')}</MenuItem>
        </TextField>
      )}

      {tab !== 'UNUSED' && (flags.isLoading ? (
        <CircularProgress />
      ) : rows.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>{tab === 'OPEN' ? t('noneOpen') : t('noneReviewed')}</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {rows.map((f) => {
            const tone = KIND_TONE[f.kind];
            return (
              <Card
                key={f.id}
                variant="outlined"
                sx={(theme) => ({
                  borderLeft: `5px solid ${f.status === 'DUPLICATE' ? theme.palette.error.main : f.status === 'GENUINE' ? theme.palette.success.main : theme.palette[tone].main}`,
                  p: 1.5,
                  bgcolor: f.status === 'OPEN' ? alpha(theme.palette[tone].main, 0.04) : 'background.paper',
                })}
              >
                <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
                  <Chip size="small" color={tone} label={t(`kind${f.kind}`)} sx={{ fontWeight: 600 }} />
                  {f.status !== 'OPEN' && <Chip size="small" variant="outlined" color={f.status === 'GENUINE' ? 'success' : 'error'} label={t(`status${f.status}`)} />}
                  {f.proofNumber && <Chip size="small" variant="outlined" label={f.proofNumber} sx={{ fontFamily: 'monospace' }} />}
                  <Typography variant="caption" color="text.secondary">{formatDate(f.createdAt)}{f.uploadedBy ? ` · ${f.uploadedBy}` : ''}</Typography>
                </Box>
                <Typography variant="body2" sx={{ mb: 1 }}>{f.reason}</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1, mb: 1 }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">{t('thisOne')}</Typography>
                    <Box><RecordLink r={f.record} /></Box>
                    {f.fileName && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{f.fileName}</Typography>}
                  </Box>
                  {(f.matched || f.matchedFileName) && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">{t('matchesWith')}</Typography>
                      <Box><RecordLink r={f.matched} /></Box>
                      {f.matchedFileName && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{f.matchedFileName}</Typography>}
                    </Box>
                  )}
                  {f.amount != null && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">{f.vendorName ?? t('amount')}</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatCurrency(f.amount)}</Typography>
                    </Box>
                  )}
                </Box>
                {f.status === 'OPEN' ? (
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button size="small" variant="contained" color="success" onClick={() => { setReview({ flag: f, status: 'GENUINE' }); setNote(''); }}>{t('markGenuine')}</Button>
                    <Button size="small" variant="contained" color="error" onClick={() => { setReview({ flag: f, status: 'DUPLICATE' }); setNote(''); }}>{t('markDuplicate')}</Button>
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('reviewedBy', { who: f.reviewedBy ?? '', d: f.reviewedAt ? formatDate(f.reviewedAt) : '' })}{f.reviewNote ? ` - ${f.reviewNote}` : ''}
                    </Typography>
                    <Button size="small" onClick={() => save.mutate({ id: f.id, status: 'OPEN' })}>{t('reopen')}</Button>
                  </Box>
                )}
              </Card>
            );
          })}
        </Box>
      ))}

      {tab === 'UNUSED' && (
        (unused.data?.data.length ?? 0) === 0 ? (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>{t('noneUnused')}</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('unusedIntro')}</Typography>
            {unused.data!.data.map((u) => (
              <Card key={u.id} variant="outlined" sx={{ p: 1.25, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{u.number}</Typography>
                <Typography variant="caption" color="text.secondary">{u.issuedBy ?? ''} · {formatDate(u.issuedAt)}</Typography>
              </Card>
            ))}
          </Box>
        )
      )}

      <ResponsiveDialog open={!!review} onClose={() => setReview(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{review?.status === 'GENUINE' ? t('markGenuine') : t('markDuplicate')}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 1.5 }}>{review?.flag.reason}</Typography>
          <TextField fullWidth multiline minRows={2} size="small" label={t('noteLabel')} value={note} onChange={(e) => setNote(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReview(null)}>{t('close')}</Button>
          <Button
            variant="contained"
            color={review?.status === 'GENUINE' ? 'success' : 'error'}
            disabled={save.isPending}
            onClick={() => review && save.mutate({ id: review.flag.id, status: review.status, note: note.trim() || undefined })}
          >
            {save.isPending ? <CircularProgress size={18} /> : t('confirm')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
