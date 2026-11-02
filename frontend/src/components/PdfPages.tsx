import { useEffect, useRef, useState } from 'react';
import { Alert, Box, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * A PDF shown inside the app: every page is drawn on a canvas with pdf.js.
 *
 * An <iframe src="blob:..."> does not show PDFs in the iOS app (WKWebView) or in most
 * mobile browsers: it stays blank or falls back to the long blob link. Drawing the pages
 * ourselves works everywhere. pdf.js is loaded on first use so it stays out of the main bundle.
 */
export default function PdfPages({ blob, maxHeight }: { blob: Blob; maxHeight?: string | number }) {
  const { t } = useTranslation();
  const holder = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    const host = holder.current;
    setState('loading');
    if (host) host.replaceChildren();

    (async () => {
      try {
        // the legacy build also runs on the older WebKit that iOS app users may still have
        const [pdfjs, worker] = await Promise.all([
          import('pdfjs-dist/legacy/build/pdf.mjs'),
          import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const data = new Uint8Array(await blob.arrayBuffer());
        const task = pdfjs.getDocument({ data });
        destroy = () => void task.destroy();
        const doc = await task.promise;
        if (cancelled || !host) return;

        const width = Math.max(host.clientWidth, 280);
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= doc.numPages; n += 1) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.cssText = 'width:100%;height:auto;display:block;background:#fff;margin:0 auto 8px;box-shadow:0 1px 4px rgba(0,0,0,.35)';
          host.appendChild(canvas);
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no canvas');
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (n === 1) setState('ready');
        }
        setState('ready');
      } catch (err) {
        if (!cancelled) {
          console.warn('[pdf] could not draw', err);
          setState('failed');
        }
      }
    })();

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [blob]);

  return (
    <Box sx={{ width: '100%', maxHeight, overflowY: maxHeight ? 'auto' : undefined, WebkitOverflowScrolling: 'touch' }}>
      {state === 'loading' && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      )}
      {state === 'failed' && <Alert severity="error" sx={{ m: 2 }}>{t('shared.errOpenFile')}</Alert>}
      <div ref={holder} />
    </Box>
  );
}
