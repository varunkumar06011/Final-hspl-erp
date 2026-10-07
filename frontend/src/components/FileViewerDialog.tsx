import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../config/api';
import { downloadPath } from '../utils/file';
import ResponsiveDialog from './ResponsiveDialog';

interface OpenTarget {
  /** API path (under /api) that serves the file */
  path: string;
  fileName: string;
  /** Extra request headers, e.g. the unlock token of a PIN-locked document. */
  headers?: Record<string, string>;
}

type Kind = 'image' | 'pdf' | 'other';
type Status = 'loading' | 'ready' | 'unsupported' | 'failed';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i;

function detectKind(mime: string, fileName: string): Kind {
  const m = mime.toLowerCase();
  if (m.startsWith('image/') || IMAGE_EXT.test(fileName)) return 'image';
  if (m === 'application/pdf' || /\.pdf$/i.test(fileName)) return 'pdf';
  return 'other';
}

/**
 * View an authenticated `/:route/:id/file` document in-page (images and PDFs) instead of
 * downloading it. Types a browser cannot render (Word/Excel) only offer a download fallback.
 *
 * const { openFile, viewer } = useFileViewer();  ...  {viewer}
 */
export function useFileViewer() {
  const { t } = useTranslation();
  const [target, setTarget] = useState<OpenTarget | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>('other');
  const [status, setStatus] = useState<Status>('loading');

  const close = useCallback(() => setTarget(null), []);

  useEffect(() => {
    if (!target) return undefined;
    let cancelled = false;
    let created: string | null = null;
    setUrl(null);
    setStatus('loading');
    api
      .get(target.path, { responseType: 'blob', headers: target.headers })
      .then((res) => {
        if (cancelled) return;
        const blob = res.data as Blob;
        const k = detectKind(blob.type || '', target.fileName);
        setKind(k);
        if (k === 'other') {
          setStatus('unsupported');
          return;
        }
        const type = k === 'pdf' ? 'application/pdf' : blob.type || 'image/jpeg';
        created = window.URL.createObjectURL(new Blob([blob], { type }));
        setUrl(created);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('failed');
      });
    return () => {
      cancelled = true;
      if (created) window.URL.revokeObjectURL(created);
    };
  }, [target]);

  const openFile = useCallback((route: string, id: string, fileName: string, headers?: Record<string, string>) => {
    setTarget({ path: `/${route}/${id}/file`, fileName, headers });
  }, []);

  /** Open a file by its full API path, e.g. `/material-purchase-requests/:id/receipt`. */
  const openPath = useCallback((path: string, fileName: string) => {
    setTarget({ path, fileName });
  }, []);

  const viewer = (
    <ResponsiveDialog open={!!target} onClose={close} maxWidth="md" fullWidth>
      <DialogTitle sx={{ wordBreak: 'break-all' }}>{target?.fileName}</DialogTitle>
      <DialogContent>
        {status === 'failed' && <Alert severity="error">{t('shared.errOpenFile')}</Alert>}
        {status === 'unsupported' && <Alert severity="info">{t('shared.noPreview')}</Alert>}
        {status === 'loading' && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        )}
        {status === 'ready' && url && kind === 'image' && (
          <Box component="img" src={url} alt={target?.fileName} sx={{ maxWidth: '100%', maxHeight: '75vh', display: 'block', mx: 'auto' }} />
        )}
        {status === 'ready' && url && kind === 'pdf' && (
          <Box component="iframe" src={url} title={target?.fileName} sx={{ width: '100%', height: '75vh', border: 0 }} />
        )}
      </DialogContent>
      <DialogActions>
        {target && status !== 'loading' && (
          <Button onClick={() => void downloadPath(target.path, target.fileName, target.headers)}>{t('shared.download')}</Button>
        )}
        <Button variant="contained" onClick={close}>{t('shared.close')}</Button>
      </DialogActions>
    </ResponsiveDialog>
  );

  return { openFile, openPath, viewer };
}
