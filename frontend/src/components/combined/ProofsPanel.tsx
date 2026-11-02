import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  CircularProgress,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowBackIosNew as PrevIcon,
  ArrowForwardIos as NextIcon,
  CheckCircle as CheckIcon,
  Close as CloseIcon,
  Download as DownloadIcon,
  FactCheck as ProofsIcon,
  InsertDriveFile as FileIcon,
  PictureAsPdf as PdfIcon,
  Print as PrintIcon,
  RadioButtonUnchecked as MissingIcon,
} from '@mui/icons-material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api, { extractErrorMessage } from '../../config/api';
import { downloadPath, printPdfBlob } from '../../utils/file';
import PdfPages from '../PdfPages';
import ResponsiveDialog from '../ResponsiveDialog';

// ── response of GET /combined-records/:type/:id/proofs ──
interface Proof {
  key: string;
  kind: 'GENERATED' | 'UPLOADED';
  stage: 'MPR' | 'QUOTATION' | 'PO' | 'GOODS_RECEIPT' | 'INVOICE' | 'PAYMENT';
  recordLabel: string;
  fileName: string;
  mimeType: string | null;
  format: 'image' | 'pdf' | 'other';
  description: string | null;
  uploadedBy: string | null;
  viewRoute: string;
}
interface ProofsData {
  generated: Proof[];
  uploaded: Proof[];
}

const STAGES: Proof['stage'][] = ['MPR', 'QUOTATION', 'PO', 'GOODS_RECEIPT', 'INVOICE', 'PAYMENT'];

/** The file as a blob (cached for the session), turned into an object URL for <img> / <iframe>. */
function useProofUrl(proof: Proof | undefined, enabled = true): { url: string | null; blob: Blob | undefined; failed: boolean } {
  const wants = !!proof && enabled && proof.format !== 'other';
  const { data: blob, isError } = useQuery({
    queryKey: ['combined-proof-blob', proof?.viewRoute],
    queryFn: async () => (await api.get(proof!.viewRoute, { responseType: 'blob' })).data as Blob,
    enabled: wants,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: 1,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob || !proof) {
      setUrl(null);
      return undefined;
    }
    const type = proof.format === 'pdf' ? 'application/pdf' : blob.type || proof.mimeType || 'image/jpeg';
    const created = window.URL.createObjectURL(new Blob([blob], { type }));
    setUrl(created);
    return () => window.URL.revokeObjectURL(created);
  }, [blob, proof]);
  return { url, blob, failed: isError };
}

/** One tile: the picture itself for images, a document tile for PDFs / other files. */
function Thumb({ proof, size, onClick, children }: { proof: Proof; size: number | 'fill'; onClick: () => void; children?: React.ReactNode }) {
  const { t } = useTranslation('combined');
  const { url, failed } = useProofUrl(proof, proof.format === 'image');
  return (
    <Box
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      sx={{
        position: 'relative', width: size === 'fill' ? '100%' : size, height: size === 'fill' ? '100%' : size, flexShrink: 0, borderRadius: 1.5, overflow: 'hidden', cursor: 'pointer',
        border: 1, borderColor: 'divider', bgcolor: 'action.hover', '&:hover, &:focus-visible': { borderColor: 'primary.main', outline: 'none' },
      }}
    >
      {proof.format === 'image' ? (
        url ? (
          <Box component="img" src={url} alt={proof.fileName} loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>{failed ? <FileIcon color="disabled" /> : <CircularProgress size={22} />}</Box>
        )
      ) : (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.5, p: 0.5 }}>
          {proof.format === 'pdf' ? <PdfIcon sx={{ fontSize: size === 'fill' ? 48 : size * 0.4, color: 'error.main' }} /> : <FileIcon sx={{ fontSize: size === 'fill' ? 48 : size * 0.4 }} color="action" />}
          <Typography variant="caption" fontWeight={700} color="text.secondary">{proof.format === 'pdf' ? t('proofs.pdfBadge') : t('proofs.fileBadge')}</Typography>
        </Box>
      )}
      <Box sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, px: 0.75, py: 0.25, bgcolor: 'rgba(0,0,0,0.6)', color: '#fff' }}>
        <Typography variant="caption" noWrap display="block" sx={{ fontSize: 11, lineHeight: 1.3 }}>
          {t(`proofs.stage.${proof.stage}`)}{proof.recordLabel ? ` ${proof.recordLabel}` : ''}
        </Typography>
      </Box>
      {children}
    </Box>
  );
}

/** Big view of one proof with previous / next arrows (buttons and keyboard). */
function Lightbox({ items, index, onIndex, onClose }: { items: Proof[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const { t } = useTranslation('combined');
  const proof = items[index];
  const { url, blob, failed } = useProofUrl(proof);
  const go = useCallback((d: number) => onIndex(Math.min(items.length - 1, Math.max(0, index + d))), [index, items.length, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  if (!proof) return null;
  const arrow = (side: 'left' | 'right', disabled: boolean) => (
    <IconButton
      aria-label={side === 'left' ? t('proofs.prev') : t('proofs.next')}
      disabled={disabled}
      onClick={() => go(side === 'left' ? -1 : 1)}
      sx={{
        position: 'absolute', top: '50%', [side]: { xs: 4, sm: 12 }, transform: 'translateY(-50%)', zIndex: 3,
        bgcolor: 'rgba(0,0,0,0.55)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' }, '&.Mui-disabled': { opacity: 0.25, color: '#fff' },
      }}
    >
      {side === 'left' ? <PrevIcon /> : <NextIcon />}
    </IconButton>
  );

  return (
    <ResponsiveDialog open onClose={onClose} maxWidth="lg" fullWidth hideCloseButton>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle1" fontWeight={700} noWrap>
            {t(`proofs.stage.${proof.stage}`)}{proof.recordLabel ? ` ${proof.recordLabel}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap display="block">
            {[proof.fileName, proof.description, proof.uploadedBy].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
        <Chip size="small" label={t('proofs.pageOf', { n: index + 1, total: items.length })} />
        <Tooltip title={t('proofs.download1')}>
          <IconButton onClick={() => void downloadPath(proof.viewRoute, proof.fileName)}><DownloadIcon /></IconButton>
        </Tooltip>
        <IconButton aria-label={t('proofs.close')} onClick={onClose}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ position: 'relative', p: 0, bgcolor: '#111', minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {arrow('left', index === 0)}
        {arrow('right', index === items.length - 1)}
        {proof.format === 'other' ? (
          <Alert severity="info" sx={{ m: 3 }}>{t('proofs.noPreview')}</Alert>
        ) : failed ? (
          <Alert severity="error" sx={{ m: 3 }}>{t('proofs.loadFailed')}</Alert>
        ) : !url ? (
          <CircularProgress sx={{ color: '#fff' }} />
        ) : proof.format === 'image' ? (
          <Box component="img" src={url} alt={proof.fileName} sx={{ maxWidth: '100%', maxHeight: '78vh', objectFit: 'contain', display: 'block' }} />
        ) : blob ? (
          // drawn page by page: an iframe on a blob link shows nothing in the iOS app
          <PdfPages key={proof.key} blob={blob} maxHeight="78vh" />
        ) : null}
      </DialogContent>
    </ResponsiveDialog>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {title} · {count}
      </Typography>
      {children}
    </Box>
  );
}

/**
 * Proofs of a combined record, kept at the top of it: the system generated PDFs and the
 * uploaded files (bill photos, quotation copies, invoices, payment proof) shown as
 * thumbnails you can see without opening anything. A tile opens a big view with
 * previous / next arrows; "Open proofs" opens the full grid where files are ticked and
 * printed (or saved) together as one PDF.
 */
export default function ProofsPanel({ type, id }: { type: string; id: string }) {
  const { t } = useTranslation('combined');
  const [modalOpen, setModalOpen] = useState(false);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ severity: 'warning' | 'error'; text: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['/combined-records', 'proofs', type, id],
    queryFn: async () => (await api.get(`/combined-records/${type}/${id}/proofs`)).data as ProofsData,
    staleTime: 10_000,
  });

  const all = useMemo(() => [...(data?.generated ?? []), ...(data?.uploaded ?? [])], [data]);
  const ticked = all.filter((p) => !unticked.has(p.key));
  const toggle = (key: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const build = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/combined-records/${type}/${id}/proof-pdf`, { keys: ticked.map((p) => p.key) }, { responseType: 'blob' });
      return { blob: res.data as Blob, skipped: Number(res.headers['x-proof-skipped'] ?? 0) };
    },
    onError: async (err: unknown) => {
      // a blob error body has to be read as text to show the server's message
      const body = (err as { response?: { data?: Blob } })?.response?.data;
      let text = t('proofs.failed');
      if (body instanceof Blob) {
        try { text = JSON.parse(await body.text()).error ?? text; } catch { /* keep default */ }
      } else {
        text = extractErrorMessage(err) || text;
      }
      setNotice({ severity: 'error', text });
    },
  });

  const run = (mode: 'print' | 'download') => {
    setNotice(null);
    build.mutate(undefined, {
      onSuccess: ({ blob, skipped }) => {
        if (skipped > 0) setNotice({ severity: 'warning', text: t('proofs.skipped', { count: skipped }) });
        if (mode === 'print') {
          printPdfBlob(blob);
        } else {
          const href = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = href;
          a.download = 'proofs.pdf';
          a.click();
          window.URL.revokeObjectURL(href);
        }
      },
    });
  };

  if (isLoading) return null;
  if (error || !data) return <Alert severity="error">{extractErrorMessage(error) || t('proofs.loadFailed')}</Alert>;

  const indexOf = (p: Proof) => all.findIndex((x) => x.key === p.key);
  const stageCount = (s: Proof['stage']) => all.filter((p) => p.stage === s).length;
  const strip = (items: Proof[], empty: string) =>
    items.length === 0 ? (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>{empty}</Typography>
    ) : (
      <Box sx={{ display: 'flex', gap: 1, mt: 0.75, overflowX: 'auto', pb: 0.5 }}>
        {items.map((p) => <Thumb key={p.key} proof={p} size={96} onClick={() => setViewIndex(indexOf(p))} />)}
      </Box>
    );

  return (
    <>
      <Card sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <ProofsIcon color="primary" />
          <Typography variant="subtitle1" fontWeight={700}>{t('proofs.title')}</Typography>
          <Chip size="small" label={all.length} />
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="outlined" startIcon={<PrintIcon />} disabled={all.length === 0} onClick={() => setModalOpen(true)}>{t('proofs.open')}</Button>
        </Box>
        {all.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>{t('proofs.none')}</Typography>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 2fr)' }, gap: 2, mt: 1 }}>
            <Group title={t('proofs.systemPdfs')} count={data.generated.length}>{strip(data.generated, t('proofs.noSystem'))}</Group>
            <Group title={t('proofs.uploaded')} count={data.uploaded.length}>{strip(data.uploaded, t('proofs.noUploaded'))}</Group>
          </Box>
        )}
      </Card>

      <ResponsiveDialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>{t('proofs.title')}</DialogTitle>
        <DialogContent dividers sx={{ bgcolor: 'background.default' }}>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }} aria-label={t('proofs.coverage')}>
            {STAGES.map((s) => {
              const n = stageCount(s);
              return (
                <Chip
                  key={s}
                  size="small"
                  variant={n ? 'filled' : 'outlined'}
                  color={n ? 'success' : 'default'}
                  icon={n ? <CheckIcon /> : <MissingIcon />}
                  label={`${t(`proofs.stage.${s}`)}${n ? ` · ${n}` : ` · ${t('proofs.missing')}`}`}
                />
              );
            })}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
            <Button size="small" onClick={() => setUnticked(new Set())}>{t('proofs.selectAll')}</Button>
            <Button size="small" onClick={() => setUnticked(new Set(all.map((p) => p.key)))}>{t('proofs.clear')}</Button>
            <Typography variant="body2" color="text.secondary">{t('proofs.selected', { count: ticked.length })}</Typography>
            <Box sx={{ flex: 1 }} />
            <Button size="small" startIcon={<DownloadIcon />} disabled={ticked.length === 0 || build.isPending} onClick={() => run('download')}>{t('proofs.download')}</Button>
            <Button
              size="small"
              variant="contained"
              startIcon={build.isPending ? <CircularProgress size={16} color="inherit" /> : <PrintIcon />}
              disabled={ticked.length === 0 || build.isPending}
              onClick={() => run('print')}
            >
              {build.isPending ? t('proofs.preparing') : t('proofs.print')}
            </Button>
          </Box>
          {notice && <Alert severity={notice.severity} sx={{ mb: 1.5 }} onClose={() => setNotice(null)}>{notice.text}</Alert>}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {([[t('proofs.systemPdfs'), data.generated], [t('proofs.uploaded'), data.uploaded]] as [string, Proof[]][]).map(([title, items]) => (
              <Group key={title} title={title} count={items.length}>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.25, mt: 0.75 }}>
                  {items.map((p) => (
                    <Box key={p.key} sx={{ position: 'relative', aspectRatio: '1 / 1' }}>
                      <Thumb proof={p} size="fill" onClick={() => setViewIndex(indexOf(p))} />
                      <Checkbox
                        size="small"
                        checked={!unticked.has(p.key)}
                        onChange={() => toggle(p.key)}
                        inputProps={{ 'aria-label': `${t('proofs.select')} ${p.fileName}` }}
                        sx={{ position: 'absolute', top: 2, left: 2, p: 0.5, bgcolor: 'rgba(255,255,255,0.85)', borderRadius: 1, '&:hover': { bgcolor: '#fff' } }}
                      />
                    </Box>
                  ))}
                </Box>
              </Group>
            ))}
          </Box>
        </DialogContent>
      </ResponsiveDialog>

      {viewIndex !== null && <Lightbox items={all} index={viewIndex} onIndex={setViewIndex} onClose={() => setViewIndex(null)} />}
    </>
  );
}
