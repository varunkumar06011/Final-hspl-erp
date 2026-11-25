import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, IconButton, Snackbar, Stack, Tooltip, Typography } from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Create as DrawIcon,
  DeleteSweep as ClearIcon,
  RotateLeft as RotateLeftIcon,
  RotateRight as RotateRightIcon,
  Save as SaveIcon,
  Undo as UndoIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  ZoomOutMap as FitIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import api from '../config/api';
import { saveBlobAs } from '../utils/file';

export type MediaKind = 'image' | 'pdf' | 'other';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i;

export function detectMediaKind(mime: string, fileName: string): MediaKind {
  const m = mime.toLowerCase();
  if (m.startsWith('image/') || IMAGE_EXT.test(fileName)) return 'image';
  if (m === 'application/pdf' || /\.pdf$/i.test(fileName)) return 'pdf';
  return 'other';
}

/** One drawn line. Points are 0..1 of the UNROTATED page, so rotating or zooming never moves it. */
interface Stroke {
  page: number;
  color: string;
  pts: [number, number][];
}

interface PageSrc {
  src: CanvasImageSource;
  w: number;
  h: number;
}

type Rot = 0 | 1 | 2 | 3; // quarter turns, clockwise

const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#111111'];
const PEN = 0.005; // pen width as a fraction of the page's width
const PDF_RENDER_WIDTH = 1400;
const DISPLAY_MAX = 2200;
const EXPORT_MAX = 4096;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5;

/** Unrotated page coordinates -> position on the rotated page (both 0..1). */
function toView(x: number, y: number, rot: Rot): [number, number] {
  if (rot === 1) return [1 - y, x];
  if (rot === 2) return [1 - x, 1 - y];
  if (rot === 3) return [y, 1 - x];
  return [x, y];
}

/** Position on the rotated page -> unrotated page coordinates. */
function toSource(u: number, v: number, rot: Rot): [number, number] {
  if (rot === 1) return [v, 1 - u];
  if (rot === 2) return [1 - u, 1 - v];
  if (rot === 3) return [1 - v, u];
  return [u, v];
}

function viewSize(page: PageSrc, rot: Rot, maxW: number): { w: number; h: number; k: number } {
  const sw = rot % 2 ? page.h : page.w;
  const sh = rot % 2 ? page.w : page.h;
  const k = Math.min(1, maxW / sw);
  return { w: Math.max(1, Math.round(sw * k)), h: Math.max(1, Math.round(sh * k)), k };
}

function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, page: PageSrc, rot: Rot, W: number, H: number, k: number) {
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = PEN * page.w * k;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pts = s.pts.map(([x, y]) => toView(x, y, rot));
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0] * W, pts[0][1] * H, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  pts.forEach(([u, v], i) => (i ? ctx.lineTo(u * W, v * H) : ctx.moveTo(u * W, v * H)));
  ctx.stroke();
}

/** Draw the page (rotated) with its strokes onto a canvas of the rotated size. */
function paint(canvas: HTMLCanvasElement, page: PageSrc, rot: Rot, strokes: Stroke[], maxW: number) {
  const { w, h, k } = viewSize(page, rot, maxW);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rot * Math.PI) / 2);
  ctx.drawImage(page.src, (-page.w * k) / 2, (-page.h * k) / 2, page.w * k, page.h * k);
  ctx.restore();
  strokes.forEach((s) => paintStroke(ctx, s, page, rot, w, h, k));
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('export failed'))), type, quality);
  });
}

interface PageViewProps {
  page: PageSrc;
  index: number;
  rot: Rot;
  strokes: Stroke[];
  drawing: boolean;
  color: string;
  onStroke: (s: Stroke) => void;
}

/** One page: the picture plus a layer you can draw on. Drawing is repainted imperatively for speed. */
function PageView({ page, index, rot, strokes, drawing, color, onStroke }: PageViewProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const draft = useRef<Stroke | null>(null);

  const repaint = useCallback(() => {
    if (ref.current) paint(ref.current, page, rot, draft.current ? [...strokes, draft.current] : strokes, DISPLAY_MAX);
  }, [page, rot, strokes]);

  useEffect(repaint, [repaint]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    return toSource(u, v, rot);
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing || !e.isPrimary) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draft.current = { page: index, color, pts: [point(e)] };
    repaint();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = draft.current;
    if (!d) return;
    const p = point(e);
    const last = d.pts[d.pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.0007) return;
    d.pts.push(p);
    repaint();
  };
  const up = () => {
    const d = draft.current;
    draft.current = null;
    if (d) onStroke(d);
  };

  return (
    <canvas
      ref={ref}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      style={{
        width: '100%',
        height: 'auto',
        display: 'block',
        background: '#fff',
        margin: '0 auto 8px',
        boxShadow: '0 1px 4px rgba(0,0,0,.35)',
        touchAction: drawing ? 'none' : 'auto',
        cursor: drawing ? 'crosshair' : 'default',
      }}
    />
  );
}

async function loadImagePage(blob: Blob): Promise<PageSrc> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // a copy on a canvas, so the object URL can go and the picture is not re-decoded on every repaint
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')?.drawImage(img, 0, 0);
    return { src: c, w: c.width, h: c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface MediaViewerProps {
  blob: Blob;
  kind: Exclude<MediaKind, 'other'>;
  fileName: string;
  maxHeight?: string | number;
}

/**
 * A photo or PDF with the tools to read it properly: rotate, zoom in/out and draw on it.
 * Once something is drawn (or the page is turned) Save and Copy appear: Save downloads the
 * marked-up copy (image, or a PDF of the pages), Copy puts the marked-up picture on the
 * clipboard. The original file on the server is never changed.
 *
 * PDFs are drawn page by page with pdf.js (an iframe on a blob link shows nothing in the iOS app).
 */
export default function MediaViewer({ blob, kind, fileName, maxHeight = '75vh' }: MediaViewerProps) {
  const { t } = useTranslation();
  const [pages, setPages] = useState<PageSrc[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [rot, setRot] = useState<Rot>(0);
  const [zoom, setZoom] = useState(1);
  const [drawing, setDrawing] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    setPages([]);
    setStrokes([]);
    setRot(0);
    setZoom(1);
    setDrawing(false);
    setFailed(false);
    setLoading(true);

    (async () => {
      try {
        if (kind === 'image') {
          const p = await loadImagePage(blob);
          if (!cancelled) setPages([p]);
          return;
        }
        // the legacy build also runs on the older WebKit that iOS app users may still have
        const [pdfjs, worker] = await Promise.all([
          import('pdfjs-dist/legacy/build/pdf.mjs'),
          import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
        destroy = () => void task.destroy();
        const doc = await task.promise;
        for (let n = 1; n <= doc.numPages; n += 1) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: PDF_RENDER_WIDTH / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no canvas');
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          setPages((prev) => [...prev, { src: canvas, w: canvas.width, h: canvas.height }]);
          if (n === 1) setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[viewer] could not draw', err);
          setFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [blob, kind]);

  const byPage = useMemo(() => {
    const map = new Map<number, Stroke[]>();
    strokes.forEach((s) => map.set(s.page, [...(map.get(s.page) ?? []), s]));
    return map;
  }, [strokes]);

  const edited = strokes.length > 0 || rot !== 0;
  const baseName = fileName.replace(/\.[^.]+$/, '') || 'file';

  const exportPage = (index: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    paint(canvas, pages[index], rot, byPage.get(index) ?? [], EXPORT_MAX);
    return canvas;
  };

  const save = async () => {
    setBusy(true);
    try {
      if (kind === 'image') {
        const jpeg = /jpe?g/i.test(blob.type) || /\.jpe?g$/i.test(fileName);
        const out = await canvasBlob(exportPage(0), jpeg ? 'image/jpeg' : 'image/png', 0.92);
        await saveBlobAs(out, `${baseName}-marked.${jpeg ? 'jpg' : 'png'}`);
      } else {
        const { jsPDF } = await import('jspdf');
        let doc: InstanceType<typeof jsPDF> | null = null;
        for (let i = 0; i < pages.length; i += 1) {
          const c = exportPage(i);
          const w = 595;
          const h = (w * c.height) / c.width;
          if (!doc) doc = new jsPDF({ unit: 'pt', format: [w, h], orientation: w > h ? 'l' : 'p' });
          else doc.addPage([w, h], w > h ? 'l' : 'p');
          doc.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, w, h);
        }
        if (doc) await saveBlobAs(doc.output('blob'), `${baseName}-marked.pdf`);
      }
      setToast({ severity: 'success', text: t('shared.viewer.saved') });
    } catch (err) {
      console.warn('[viewer] save failed', err);
      setToast({ severity: 'error', text: t('shared.viewer.saveFailed') });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    setBusy(true);
    try {
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('clipboard unsupported');
      // for a PDF: the page last drawn on (else the first page)
      const index = strokes.length ? strokes[strokes.length - 1].page : 0;
      const png = canvasBlob(exportPage(index), 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      setToast({
        severity: 'success',
        text: kind === 'pdf' && pages.length > 1 ? t('shared.viewer.copiedPage', { n: index + 1 }) : t('shared.viewer.copied'),
      });
    } catch (err) {
      console.warn('[viewer] copy failed', err);
      setToast({ severity: 'error', text: t('shared.viewer.copyFailed') });
    } finally {
      setBusy(false);
    }
  };

  const setZoomBy = (f: number) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(z * f).toFixed(3))));
  const turn = (d: 1 | -1) => setRot((r) => ((r + d + 4) % 4) as Rot);

  return (
    <Box sx={{ width: '100%' }}>
      <Stack direction="row" alignItems="center" flexWrap="wrap" gap={0.5} sx={{ mb: 1 }}>
        <Tooltip title={t('shared.viewer.rotateLeft')}><IconButton size="small" onClick={() => turn(-1)}><RotateLeftIcon /></IconButton></Tooltip>
        <Tooltip title={t('shared.viewer.rotateRight')}><IconButton size="small" onClick={() => turn(1)}><RotateRightIcon /></IconButton></Tooltip>
        <Tooltip title={t('shared.zoomOut')}><span><IconButton size="small" disabled={zoom <= ZOOM_MIN} onClick={() => setZoomBy(1 / 1.25)}><ZoomOutIcon /></IconButton></span></Tooltip>
        <Typography variant="caption" sx={{ minWidth: 38, textAlign: 'center' }}>{Math.round(zoom * 100)}%</Typography>
        <Tooltip title={t('shared.zoomIn')}><span><IconButton size="small" disabled={zoom >= ZOOM_MAX} onClick={() => setZoomBy(1.25)}><ZoomInIcon /></IconButton></span></Tooltip>
        <Tooltip title={t('shared.resetZoom')}><IconButton size="small" onClick={() => setZoom(1)}><FitIcon /></IconButton></Tooltip>
        <Tooltip title={t(drawing ? 'shared.viewer.stopDraw' : 'shared.viewer.draw')}>
          <IconButton size="small" color={drawing ? 'primary' : 'default'} onClick={() => setDrawing((d) => !d)} sx={drawing ? { bgcolor: 'action.selected' } : undefined}>
            <DrawIcon />
          </IconButton>
        </Tooltip>
        {drawing && (
          <>
            {COLORS.map((c) => (
              <Box
                key={c}
                role="button"
                aria-label={c}
                onClick={() => setColor(c)}
                sx={{ width: 22, height: 22, borderRadius: '50%', bgcolor: c, cursor: 'pointer', border: 2, borderColor: color === c ? 'primary.main' : 'divider', boxSizing: 'border-box' }}
              />
            ))}
          </>
        )}
        {strokes.length > 0 && (
          <>
            <Tooltip title={t('shared.viewer.undo')}><IconButton size="small" onClick={() => setStrokes((s) => s.slice(0, -1))}><UndoIcon /></IconButton></Tooltip>
            <Tooltip title={t('shared.viewer.clearDrawing')}><IconButton size="small" onClick={() => setStrokes([])}><ClearIcon /></IconButton></Tooltip>
          </>
        )}
        {edited && (
          <Stack direction="row" gap={0.5} sx={{ ml: 'auto' }}>
            <Button size="small" variant="contained" startIcon={<SaveIcon />} disabled={busy || loading} onClick={() => void save()}>{t('shared.viewer.save')}</Button>
            <Button size="small" variant="outlined" startIcon={<CopyIcon />} disabled={busy || loading} onClick={() => void copy()}>{t('shared.viewer.copy')}</Button>
          </Stack>
        )}
      </Stack>

      <Box sx={{ maxHeight, overflow: 'auto', WebkitOverflowScrolling: 'touch', bgcolor: 'action.hover', borderRadius: 1, p: 0.5 }}>
        {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>}
        {failed && <Alert severity="error" sx={{ m: 2 }}>{t('shared.errOpenFile')}</Alert>}
        <Box sx={{ width: `${zoom * 100}%`, mx: zoom < 1 ? 'auto' : 0 }}>
          {pages.map((p, i) => (
            <PageView
              key={i}
              page={p}
              index={i}
              rot={rot}
              strokes={byPage.get(i) ?? []}
              drawing={drawing}
              color={color}
              onStroke={(s) => setStrokes((prev) => [...prev, s])}
            />
          ))}
        </Box>
      </Box>

      <Snackbar open={!!toast} autoHideDuration={3500} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.text}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}

/** Fetches an authenticated `/:route/:id/file` and shows it in the viewer (photos, chat pictures). */
export function RemoteMediaViewer({ route, id, fileName, maxHeight }: { route: string; id: string; fileName: string; maxHeight?: string | number }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ blob: Blob; kind: Exclude<MediaKind, 'other'> } | 'failed' | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    api
      .get(`/${route}/${id}/file`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        const blob = res.data as Blob;
        const kind = detectMediaKind(blob.type || '', fileName);
        setState(kind === 'other' ? 'failed' : { blob, kind });
      })
      .catch(() => !cancelled && setState('failed'));
    return () => {
      cancelled = true;
    };
  }, [route, id, fileName]);

  if (state === 'failed') return <Alert severity="error" sx={{ m: 2 }}>{t('shared.errOpenFile')}</Alert>;
  if (!state) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  return <MediaViewer blob={state.blob} kind={state.kind} fileName={fileName} maxHeight={maxHeight} />;
}
