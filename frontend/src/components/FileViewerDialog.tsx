import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../config/api';
import { downloadPath } from '../utils/file';
import MediaViewer, { detectMediaKind } from './MediaViewer';
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

/**
 * View an authenticated `/:route/:id/file` document in-page (images and PDFs) instead of
 * downloading it. Types a browser cannot render (Word/Excel) only offer a download fallback.
 *
 * const { openFile, viewer } = useFileViewer();  ...  {viewer}
 */
export function useFileViewer() {
  const { t } = useTranslation();
  const [target, setTarget] = useState<OpenTarget | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [kind, setKind] = useState<Kind>('other');
  const [status, setStatus] = useState<Status>('loading');

  const close = useCallback(() => setTarget(null), []);

  useEffect(() => {
    if (!target) return undefined;
    let cancelled = false;
    setBlob(null);
    setStatus('loading');
    api
      .get(target.path, { responseType: 'blob', headers: target.headers })
      .then((res) => {
        if (cancelled) return;
        const data = res.data as Blob;
        const k = detectMediaKind(data.type || '', target.fileName);
        setKind(k);
        if (k === 'other') {
          setStatus('unsupported');
          return;
        }
        setBlob(data);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('failed');
      });
    return () => {
      cancelled = true;
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
    <ResponsiveDialog open={!!target} onClose={close} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ wordBreak: 'break-all' }}>{target?.fileName}</DialogTitle>
      <DialogContent>
        {status === 'failed' && <Alert severity="error">{t('shared.errOpenFile')}</Alert>}
        {status === 'unsupported' && <Alert severity="info">{t('shared.noPreview')}</Alert>}
        {status === 'loading' && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        )}
        {status === 'ready' && blob && (kind === 'image' || kind === 'pdf') && (
          <MediaViewer key={target?.path} blob={blob} kind={kind} fileName={target?.fileName ?? ''} />
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
