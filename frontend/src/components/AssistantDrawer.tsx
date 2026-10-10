import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Drawer,
  IconButton,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AttachFile as AttachIcon,
  AutoAwesome as AssistantIcon,
  Build as ServiceIcon,
  Close as CloseIcon,
  Description as DocumentIcon,
  Inventory2 as MaterialIcon,
  LocalShipping as ReceiptIcon,
  PersonAdd as VendorIcon,
  PhotoCamera as CameraIcon,
  PointOfSale as SiteBillIcon,
  Receipt as InvoiceIcon,
  ReceiptLong as POIcon,
  RequestQuote as QuotationIcon,
  Warehouse as StockIcon,
  PictureAsPdf as PdfIcon,
  Mic as MicIcon,
  MicOff as MicOffIcon,
  OpenInNew as OpenIcon,
  RestartAlt as NewChatIcon,
  Send as SendIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import api from '../config/api';
import CameraCapture from './CameraCapture';
import { enumLabel, formatCurrency, formatDate } from '../utils/enumOptions';

interface GeminiContent {
  role: 'user' | 'model';
  parts: Record<string, unknown>[];
}
interface SummaryItem {
  name: string;
  qty?: string;
  unit?: string;
  rate?: string;
  amount?: string;
}
interface ActionSummary {
  fields: { key: string; value: string }[];
  items?: SummaryItem[];
  totals?: { key: string; value: string }[];
}
interface PendingAction {
  id: string;
  tool: string;
  summary: ActionSummary;
}
interface ListTable {
  entity: string;
  columns: string[];
  total: number;
  rows: { id: string; link: string | null; values: Record<string, unknown> }[];
}
/** A question from Miko with tap-able answers. */
interface AskPrompt {
  question: string;
  options: string[];
  askPhoto: boolean;
}
/** What Miko's reader made of a photo / PDF. */
interface DocumentNote {
  id: string;
  documentType: string;
  lines: number;
  vendor: string | null;
  total: number | null;
  unclear: boolean;
}
/** A create flow on Miko's start menu (GET /assistant/flows). */
interface FlowOption {
  id: string;
  tool: string;
  photo: 'required' | 'optional';
}
type Msg =
  | { id: number; role: 'user'; text: string; images?: string[] }
  | {
      id: number;
      role: 'assistant';
      text: string;
      tables: ListTable[];
      pending: PendingAction[];
      ask: AskPrompt | null;
      document: DocumentNote | null;
    }
  | { id: number; role: 'menu' }
  | { id: number; role: 'error'; text: string };

const FLOW_ICONS: Record<string, typeof MaterialIcon> = {
  material_request: MaterialIcon,
  service_request: ServiceIcon,
  quotation: QuotationIcon,
  purchase_order: POIcon,
  goods_receipt: ReceiptIcon,
  invoice: InvoiceIcon,
  stock_entry: StockIcon,
  site_bill: SiteBillIcon,
  vendor: VendorIcon,
};

type NewMsg = Msg extends infer M ? (M extends { id: number } ? Omit<M, 'id'> : never) : never;

interface ActionState {
  status: 'idle' | 'saving' | 'saved' | 'failed' | 'discarded';
  label?: string;
  link?: string | null;
  error?: string;
  photos?: { attached: number; total: number };
}

const AMOUNT_COLS = /(total|amount|grandTotal)$/i;
const STATUS_COLS = /(status|type)$/i;
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}T/;

const MAX_PHOTOS = 3;
const MAX_PHOTO_EDGE = 1600;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const isPdfUrl = (src: string) => src.startsWith('data:application/pdf');

/** Reads a PDF as a data URL (PDFs are sent as they are, not re-encoded). */
function pdfToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('unreadable pdf'));
    r.readAsDataURL(file);
  });
}

/** Shrinks a camera/gallery photo to a JPEG data URL small enough to send in a chat message. */
async function photoToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('unreadable image'));
      el.src = url;
    });
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

type MicState = 'idle' | 'recording' | 'transcribing';

const MIC_MAX_MS = 120_000;
const MIC_LIVE_EVERY_MS = 3_000;
const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

const micSupported = () =>
  typeof window !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof window.MediaRecorder !== 'undefined';

const pickAudioType = () =>
  MediaRecorder.isTypeSupported
    ? (AUDIO_TYPES.find((ty) => MediaRecorder.isTypeSupported(ty)) ?? '')
    : '';

const joinSpeech = (base: string, spoken: string) => [base, spoken].filter(Boolean).join(' ');

const formatMicTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('unreadable audio'));
    r.readAsDataURL(blob);
  });
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AssistantDrawer({ open, onClose }: Props) {
  const { t, i18n } = useTranslation('assistant');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [mic, setMic] = useState<MicState>('idle');
  const [micSeconds, setMicSeconds] = useState(0);
  const [photos, setPhotos] = useState<{ id: number; dataUrl: string }[]>([]);
  // The guided flow in progress and the documents already read for it (kept server-side by id).
  const [flow, setFlow] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocumentNote[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const quickFileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const historyRef = useRef<GeminiContent[]>([]);
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunksSentRef = useRef(0);
  const sessionRef = useRef(0);
  const liveBusyRef = useRef(false);
  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baseRef = useRef('');
  const startedAtRef = useRef(0);

  const { data: flowOptions = [] } = useQuery<FlowOption[]>({
    queryKey: ['assistant-flows'],
    queryFn: async () => (await api.get('/assistant/flows')).data?.flows ?? [],
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, actions, busy]);

  const addMsg = useCallback((m: NewMsg) => {
    idRef.current += 1;
    setMessages((prev) => [...prev, { ...m, id: idRef.current } as Msg]);
  }, []);

  const errorText = useCallback(
    (err: any): string => {
      const code = err?.response?.data?.code;
      if (code === 'ASSISTANT_LIMIT') return t('errors.limit');
      if (code === 'ASSISTANT_DISABLED') return t('errors.disabled');
      if (err?.response?.status === 429) return t('errors.busy');
      return t('errors.generic');
    },
    [t],
  );

  const addPhotos = useCallback(
    async (files: File[]) => {
      const room = MAX_PHOTOS - photos.length;
      if (room <= 0) {
        addMsg({ role: 'error', text: t('photoMax', { n: MAX_PHOTOS }) });
        return;
      }
      for (const file of files.slice(0, room)) {
        try {
          const isPdf = file.type === 'application/pdf' || /.pdf$/i.test(file.name);
          if (isPdf && file.size > MAX_PDF_BYTES) {
            addMsg({ role: 'error', text: t('pdfTooBig') });
            continue;
          }
          const dataUrl = isPdf ? await pdfToDataUrl(file) : await photoToDataUrl(file);
          idRef.current += 1;
          const id = idRef.current;
          setPhotos((prev) => (prev.length >= MAX_PHOTOS ? prev : [...prev, { id, dataUrl }]));
        } catch {
          addMsg({ role: 'error', text: t('photoError') });
        }
      }
      if (files.length > room) addMsg({ role: 'error', text: t('photoMax', { n: MAX_PHOTOS }) });
    },
    [photos.length, addMsg, t],
  );

  /** Sends a recording to the server; the server returns the words as text. */
  const transcribe = async (blob: Blob, live: boolean): Promise<string> => {
    const audio = await blobToBase64(blob);
    const { data } = await api.post(
      '/assistant/transcribe',
      {
        audio,
        mimeType: blob.type.split(';')[0] || 'audio/webm',
        language: i18n.language?.startsWith('te') ? 'te' : 'en',
        live,
      },
      { timeout: 90_000 },
    );
    return String(data.text ?? '').trim();
  };

  /** Drops the recording without transcribing it (new chat, closing Miko, leaving the page). */
  const cancelRecording = useCallback(() => {
    sessionRef.current += 1;
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    liveTimerRef.current = null;
    if (rec && rec.state !== 'inactive') rec.stop();
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    chunksRef.current = [];
    setMic('idle');
  }, []);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    // Stopping fires onstop, which transcribes the whole clip.
    if (rec && rec.state !== 'inactive') rec.stop();
  }, []);

  /** Full-clip transcription once the user stops; replaces the live preview. */
  const finishRecording = async (session: number, mime: string) => {
    if (session !== sessionRef.current) return;
    if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    liveTimerRef.current = null;
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    recorderRef.current = null;
    const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' });
    chunksRef.current = [];
    if (blob.size === 0) {
      setMic('idle');
      addMsg({ role: 'error', text: t('micError') });
      return;
    }
    setMic('transcribing');
    try {
      const text = await transcribe(blob, false);
      if (session !== sessionRef.current) return;
      setInput(joinSpeech(baseRef.current, text));
      if (!text) addMsg({ role: 'error', text: t('micEmpty') });
    } catch (err) {
      if (session !== sessionRef.current) return;
      setInput(baseRef.current);
      const status = (err as { response?: { status?: number } })?.response?.status;
      addMsg({ role: 'error', text: status === 429 ? t('errors.busy') : t('micError') });
    } finally {
      if (session === sessionRef.current) setMic('idle');
    }
  };

  /** Live preview: transcribes everything said so far every few seconds while the user keeps talking. */
  const livePass = async (session: number) => {
    const rec = recorderRef.current;
    if (liveBusyRef.current || session !== sessionRef.current || !rec || rec.state !== 'recording')
      return;
    const seen = chunksRef.current.length;
    if (seen === 0 || seen === chunksSentRef.current) return;
    liveBusyRef.current = true;
    try {
      const text = await transcribe(new Blob(chunksRef.current, { type: rec.mimeType }), true);
      chunksSentRef.current = seen;
      if (session === sessionRef.current && recorderRef.current?.state === 'recording' && text)
        setInput(joinSpeech(baseRef.current, text));
    } catch {
      /* best effort: the final pass reports any error */
    } finally {
      liveBusyRef.current = false;
    }
  };

  const startRecording = async () => {
    if (mic !== 'idle' || busy) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      addMsg({ role: 'error', text: t('micDenied') });
      return;
    }
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    let recorder: MediaRecorder;
    try {
      const type = pickAudioType();
      recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    } catch {
      stream.getTracks().forEach((tr) => tr.stop());
      addMsg({ role: 'error', text: t('micError') });
      return;
    }
    baseRef.current = input.trim();
    chunksRef.current = [];
    chunksSentRef.current = 0;
    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => void finishRecording(session, recorder.mimeType);
    // A chunk every second: each chunk after the first only adds to the clip, so the clip so far is always playable.
    recorder.start(1000);
    startedAtRef.current = Date.now();
    setMicSeconds(0);
    setMic('recording');
    liveTimerRef.current = setInterval(() => void livePass(session), MIC_LIVE_EVERY_MS);
  };

  // Clock on screen, and the two-minute cap.
  useEffect(() => {
    if (mic !== 'recording') return undefined;
    const tick = () => {
      const ms = Date.now() - startedAtRef.current;
      setMicSeconds(Math.floor(ms / 1000));
      if (ms >= MIC_MAX_MS) stopRecording();
    };
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [mic, stopRecording]);

  // Leaving the page or closing Miko drops any recording in progress.
  useEffect(() => () => cancelRecording(), [cancelRecording]);
  useEffect(() => {
    if (!open) cancelRecording();
  }, [open, cancelRecording]);

  /**
   * Sends one message. `opts.flow` starts a guided flow (from the menu); `opts.files`
   * sends photos picked straight from a quick-reply button instead of the tray.
   */
  const send = useCallback(
    async (raw: string, opts: { flow?: string | null; files?: string[] } = {}) => {
      const typed = raw.trim();
      const sending = opts.files ?? photos.map((p) => p.dataUrl);
      if ((!typed && sending.length === 0) || busy || mic !== 'idle') return;
      const text = typed || t('photoDefault');
      const activeFlow = opts.flow !== undefined ? opts.flow : flow;
      // Starting a flow from the menu begins with no documents from an earlier one.
      const docIds = opts.flow !== undefined ? [] : docs.map((d) => d.id);
      if (opts.flow !== undefined) setFlow(opts.flow);
      if (!opts.files) {
        setInput('');
        setPhotos([]);
      }
      addMsg({ role: 'user', text, images: sending });
      setBusy(true);
      try {
        const { data } = await api.post(
          '/assistant/chat',
          {
            message: text,
            history: historyRef.current,
            images: sending.map((src) => ({
              mimeType: isPdfUrl(src) ? 'application/pdf' : 'image/jpeg',
              data: src.split(',')[1],
            })),
            ...(activeFlow ? { flow: activeFlow } : {}),
            ...(docIds.length ? { documentIds: docIds } : {}),
          },
          { timeout: 180_000 },
        ); // reading a document and looking up records can take well over the default 30 s
        historyRef.current = data.history ?? [];
        setFlow(data.flow ?? null);
        if (data.document) setDocs((prev) => [...prev, data.document as DocumentNote]);
        addMsg({
          role: 'assistant',
          text: data.reply ?? '',
          tables: data.tables ?? [],
          pending: data.pending ?? [],
          ask: data.ask ?? null,
          document: data.document ?? null,
        });
      } catch (err) {
        addMsg({ role: 'error', text: errorText(err) });
      } finally {
        setBusy(false);
      }
    },
    [busy, mic, photos, flow, docs, addMsg, errorText, t],
  );

  /** Reads photos / PDFs picked from a quick-reply button and sends them right away. */
  const sendFiles = useCallback(
    async (files: File[]) => {
      const urls: string[] = [];
      for (const file of files.slice(0, MAX_PHOTOS)) {
        try {
          const isPdf = file.type === 'application/pdf' || /.pdf$/i.test(file.name);
          if (isPdf && file.size > MAX_PDF_BYTES) {
            addMsg({ role: 'error', text: t('pdfTooBig') });
            continue;
          }
          urls.push(isPdf ? await pdfToDataUrl(file) : await photoToDataUrl(file));
        } catch {
          addMsg({ role: 'error', text: t('photoError') });
        }
      }
      if (urls.length) await send('', { files: urls });
    },
    [send, addMsg, t],
  );

  const startFlow = (id: string) => {
    if (busy) return;
    setDocs([]);
    void send(t(`flows.${id}.start`, { defaultValue: id }), { flow: id });
  };

  const stopFlow = () => {
    setFlow(null);
    setDocs([]);
    addMsg({ role: 'menu' });
  };

  const setAction = (id: string, patch: ActionState) =>
    setActions((prev) => ({ ...prev, [id]: patch }));

  const confirm = async (a: PendingAction) => {
    setAction(a.id, { status: 'saving' });
    try {
      const { data } = await api.post(`/assistant/actions/${a.id}/confirm`);
      historyRef.current = [...historyRef.current, ...(data.historyAppend ?? [])];
      setAction(a.id, {
        status: 'saved',
        label: data.result?.label,
        link: data.result?.link,
        photos: data.result?.photos,
      });
      void queryClient.invalidateQueries();
      const flowTool = flowOptions.find((f) => f.id === flow)?.tool;
      if (flow && flowTool && flowTool !== a.tool) {
        // A step on the way (e.g. the vendor an invoice needs): carry on with the flow.
        void send(t('continueAfterSave'));
      } else {
        setFlow(null);
        setDocs([]);
        addMsg({ role: 'menu' });
      }
    } catch (err: any) {
      const body = err?.response?.data;
      if (body?.historyAppend) historyRef.current = [...historyRef.current, ...body.historyAppend];
      setAction(a.id, { status: 'failed', error: body?.error ?? errorText(err) });
    }
  };

  const discard = async (a: PendingAction) => {
    setAction(a.id, { status: 'discarded' });
    try {
      await api.post(`/assistant/actions/${a.id}/cancel`);
    } catch {
      /* best effort — the proposal also expires on its own */
    }
  };

  const newChat = () => {
    cancelRecording();
    historyRef.current = [];
    setMessages([]);
    setActions({});
    setInput('');
    setPhotos([]);
    setFlow(null);
    setDocs([]);
  };

  const go = (link: string | null) => {
    if (!link) return;
    onClose();
    navigate(link);
  };

  const cellValue = (col: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'string' && DATE_VALUE.test(v)) return formatDate(v);
    if (AMOUNT_COLS.test(col) && !Number.isNaN(Number(v))) return formatCurrency(v);
    if (STATUS_COLS.test(col)) return enumLabel(v);
    return String(v);
  };

  const colLabel = (col: string) => t(`col.${col.replace(/\./g, '_')}`, { defaultValue: col });

  const examples = [t('ex1'), t('ex3')];

  const flowLabel = (id: string) => t(`flows.${id}.label`, { defaultValue: id });

  /** The "what would you like to create?" buttons (start screen and after each save). */
  const renderMenu = (title: string, compact: boolean) => (
    <Box>
      <Typography variant={compact ? 'subtitle2' : 'subtitle1'} sx={{ fontWeight: 600, mb: 1 }}>
        {title}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
        {flowOptions.map((f) => {
          const Icon = FLOW_ICONS[f.id] ?? DocumentIcon;
          return (
            <Button
              key={f.id}
              variant="outlined"
              size={compact ? 'small' : 'medium'}
              startIcon={<Icon />}
              onClick={() => startFlow(f.id)}
              disabled={busy}
              sx={{ justifyContent: 'flex-start', textAlign: 'left', textTransform: 'none', lineHeight: 1.25 }}
            >
              {flowLabel(f.id)}
            </Button>
          );
        })}
      </Box>
    </Box>
  );

  const lastId = messages.length ? messages[messages.length - 1].id : -1;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      // Above page dialogs, menus and snackbars so Miko is never hidden behind them.
      sx={{ zIndex: (theme) => theme.zIndex.tooltip + 100 }}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: 460 },
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        },
        onDragEnter: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        },
        onDragOver: (e: React.DragEvent) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          const files = Array.from(e.dataTransfer.files).filter(
            (f) =>
              f.type.startsWith('image/') || f.type === 'application/pdf' || /.pdf$/i.test(f.name),
          );
          if (files.length === 0) addMsg({ role: 'error', text: t('photoError') });
          else if (!busy) void addPhotos(files);
        },
      }}
    >
      {dragging && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            bgcolor: 'rgba(25,118,210,0.12)',
            border: 3,
            borderStyle: 'dashed',
            borderColor: 'primary.main',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <Typography variant="h6" color="primary">
            {t('dropHere')}
          </Typography>
        </Box>
      )}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 1.25,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <AssistantIcon color="primary" />
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {t('title')}
        </Typography>
        <Tooltip title={t('newChat')}>
          <span>
            <IconButton
              onClick={newChat}
              disabled={busy || messages.length === 0}
              aria-label={t('newChat')}
            >
              <NewChatIcon />
            </IconButton>
          </span>
        </Tooltip>
        <IconButton onClick={onClose} aria-label={t('close')}>
          <CloseIcon />
        </IconButton>
      </Box>

      {flow && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 0.75,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
            flexWrap: 'wrap',
          }}
        >
          <Chip
            size="small"
            color="primary"
            icon={(() => {
              const Icon = FLOW_ICONS[flow] ?? DocumentIcon;
              return <Icon />;
            })()}
            label={t('creating', { name: flowLabel(flow) })}
            onDelete={busy ? undefined : stopFlow}
            deleteIcon={<CloseIcon aria-label={t('stopFlow')} />}
          />
          {docs.length > 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <AttachIcon sx={{ fontSize: 14 }} />
              {t('docsAttached', { count: docs.length })}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <CameraIcon sx={{ fontSize: 14 }} />
              {t('scanHint')}
            </Typography>
          )}
        </Box>
      )}

      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          px: 2,
          py: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        {messages.length === 0 && (
          <Box sx={{ mt: 1 }}>
            <Box sx={{ textAlign: 'center', mb: 2 }}>
              <Typography variant="h6" gutterBottom>
                {t('welcomeTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('menuHint')}
              </Typography>
            </Box>
            {flowOptions.length > 0 && renderMenu(t('menuTitle'), false)}
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 2.5, mb: 1 }}>
              {t('menuOr')}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'stretch' }}>
              {examples.map((ex) => (
                <Chip
                  key={ex}
                  label={ex}
                  onClick={() => void send(ex)}
                  variant="outlined"
                  sx={{ height: 'auto', py: 0.75, '& .MuiChip-label': { whiteSpace: 'normal' } }}
                />
              ))}
            </Box>
          </Box>
        )}

        {messages.map((m) => {
          if (m.role === 'menu') {
            return m.id === lastId && flowOptions.length > 0 ? (
              <Box key={m.id}>{renderMenu(t('whatNext'), true)}</Box>
            ) : null;
          }
          if (m.role === 'user') {
            return (
              <Paper
                key={m.id}
                elevation={0}
                sx={{
                  alignSelf: 'flex-end',
                  maxWidth: '85%',
                  px: 1.5,
                  py: 1,
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  borderRadius: 2,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.images && m.images.length > 0 && (
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: m.text ? 0.75 : 0 }}>
                    {m.images.map((src, i) =>
                      isPdfUrl(src) ? (
                        <Box
                          key={i}
                          sx={{
                            width: 72,
                            height: 72,
                            borderRadius: 1,
                            bgcolor: 'rgba(255,255,255,0.2)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <PdfIcon />
                          <Typography variant="caption">PDF</Typography>
                        </Box>
                      ) : (
                        <Box
                          key={i}
                          component="img"
                          src={src}
                          alt=""
                          sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 1 }}
                        />
                      ),
                    )}
                  </Box>
                )}
                <Typography variant="body2">{m.text}</Typography>
              </Paper>
            );
          }
          if (m.role === 'error') {
            return (
              <Alert key={m.id} severity="error" sx={{ alignSelf: 'stretch' }}>
                {m.text}
              </Alert>
            );
          }
          return (
            <Box
              key={m.id}
              sx={{ alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 1 }}
            >
              {m.text && (
                <Paper
                  variant="outlined"
                  sx={{
                    px: 1.5,
                    py: 1,
                    borderRadius: 2,
                    alignSelf: 'flex-start',
                    maxWidth: '92%',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  <Typography variant="body2">{m.text}</Typography>
                </Paper>
              )}

              {m.document && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignSelf: 'flex-start', maxWidth: '92%' }}>
                  <Chip
                    size="small"
                    icon={<DocumentIcon />}
                    variant="outlined"
                    color={m.document.unclear ? 'warning' : 'default'}
                    label={[
                      t('docRead', { type: t(`docType.${m.document.documentType}`, { defaultValue: m.document.documentType }) }),
                      m.document.vendor,
                      m.document.lines ? t('docLines', { count: m.document.lines }) : null,
                      m.document.total != null ? formatCurrency(m.document.total) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    sx={{ height: 'auto', py: 0.5, '& .MuiChip-label': { whiteSpace: 'normal' } }}
                  />
                  {m.document.unclear && (
                    <Typography variant="caption" color="warning.main">
                      {t('docUnclear')}
                    </Typography>
                  )}
                </Box>
              )}

              {m.ask && m.id === lastId && !busy && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {m.ask.options.map((o) => (
                    <Chip
                      key={o}
                      label={o}
                      color="primary"
                      variant="outlined"
                      clickable
                      onClick={() => void send(o)}
                      sx={{ height: 'auto', py: 0.5, maxWidth: '100%', '& .MuiChip-label': { whiteSpace: 'normal' } }}
                    />
                  ))}
                  {m.ask.askPhoto && (
                    <>
                      <CameraCapture onCapture={(file) => void sendFiles([file])} label disabled={mic !== 'idle'} />
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<AttachIcon />}
                        onClick={() => quickFileRef.current?.click()}
                        disabled={mic !== 'idle'}
                      >
                        {t('uploadFile')}
                      </Button>
                    </>
                  )}
                </Box>
              )}

              {m.tables.map((tb, i) => (
                <Paper key={i} variant="outlined" sx={{ overflowX: 'auto' }}>
                  {tb.rows.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
                      {t('noRows')}
                    </Typography>
                  ) : (
                    <>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            {tb.columns.map((c) => (
                              <TableCell key={c} sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                                {colLabel(c)}
                              </TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {tb.rows.map((r) => (
                            <TableRow
                              key={r.id}
                              hover={!!r.link}
                              onClick={() => go(r.link)}
                              sx={{ cursor: r.link ? 'pointer' : 'default' }}
                            >
                              {tb.columns.map((c) => (
                                <TableCell key={c} sx={{ whiteSpace: 'nowrap' }}>
                                  {cellValue(c, r.values[c])}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', px: 1.5, py: 0.75 }}
                      >
                        {t('showing', { shown: tb.rows.length, total: tb.total })}
                      </Typography>
                    </>
                  )}
                </Paper>
              ))}

              {m.pending.map((a) => {
                const st = actions[a.id] ?? { status: 'idle' as const };
                return (
                  <Paper
                    key={a.id}
                    variant="outlined"
                    sx={{ p: 1.5, borderColor: 'primary.main', borderWidth: 1.5 }}
                  >
                    <Typography variant="subtitle2" gutterBottom>
                      {t(`tool.${a.tool}`, { defaultValue: a.tool })}
                    </Typography>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'max-content 1fr',
                        columnGap: 1.5,
                        rowGap: 0.25,
                        mb: 1,
                      }}
                    >
                      {a.summary.fields.map((f, i) => (
                        <Box key={i} sx={{ display: 'contents' }}>
                          <Typography variant="caption" color="text.secondary">
                            {t(`field.${f.key}`, { defaultValue: f.key })}
                          </Typography>
                          <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                            {/^[A-Z_]{3,}$/.test(f.value) ? enumLabel(f.value) : f.value}
                          </Typography>
                        </Box>
                      ))}
                    </Box>

                    {a.summary.items && a.summary.items.length > 0 && (
                      <Box sx={{ overflowX: 'auto', mb: 1 }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>{t('item.material')}</TableCell>
                              <TableCell align="right">{t('item.qty')}</TableCell>
                              <TableCell align="right">{t('item.rate')}</TableCell>
                              <TableCell align="right">{t('item.amount')}</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {a.summary.items.map((it, i) => (
                              <TableRow key={i}>
                                <TableCell>{it.name}</TableCell>
                                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                  {[it.qty, it.unit].filter(Boolean).join(' ')}
                                </TableCell>
                                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                  {it.rate ?? '—'}
                                </TableCell>
                                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                  {it.amount ?? '—'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Box>
                    )}

                    {a.summary.totals?.map((tt, i) => (
                      <Box
                        key={i}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontWeight: tt.key === 'total' ? 700 : 400,
                        }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 'inherit' }}>
                          {t(`total.${tt.key}`, { defaultValue: tt.key })}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 'inherit' }}>
                          {tt.value}
                        </Typography>
                      </Box>
                    ))}

                    <Box sx={{ mt: 1.5 }}>
                      {st.status === 'idle' && (
                        <>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', mb: 1 }}
                          >
                            {t('reviewNote')}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button
                              variant="contained"
                              size="small"
                              onClick={() => void confirm(a)}
                            >
                              {t('confirm')}
                            </Button>
                            <Button size="small" onClick={() => void discard(a)}>
                              {t('discard')}
                            </Button>
                          </Box>
                        </>
                      )}
                      {st.status === 'saving' && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <CircularProgress size={16} />
                          <Typography variant="body2">{t('saving')}</Typography>
                        </Box>
                      )}
                      {st.status === 'saved' && (
                        <Alert severity="success" sx={{ py: 0 }}>
                          {t('saved')}: <strong>{st.label}</strong>{' '}
                          {st.link && (
                            <Link
                              component="button"
                              type="button"
                              onClick={() => go(st.link ?? null)}
                              sx={{ verticalAlign: 'baseline' }}
                            >
                              {t('openRecord')}{' '}
                              <OpenIcon sx={{ fontSize: 14, verticalAlign: 'middle' }} />
                            </Link>
                          )}
                          {st.photos && (
                            <Typography variant="caption" sx={{ display: 'block' }}>
                              {st.photos.attached === st.photos.total
                                ? t('photosSaved', { count: st.photos.attached })
                                : t('photosPartial', {
                                    attached: st.photos.attached,
                                    total: st.photos.total,
                                  })}
                            </Typography>
                          )}
                        </Alert>
                      )}
                      {st.status === 'failed' && (
                        <Alert severity="error" sx={{ py: 0 }}>
                          {t('failed')}: {st.error}
                        </Alert>
                      )}
                      {st.status === 'discarded' && (
                        <Typography variant="caption" color="text.secondary">
                          {t('discarded')}
                        </Typography>
                      )}
                    </Box>
                  </Paper>
                );
              })}
            </Box>
          );
        })}

        {busy && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
            <CircularProgress size={16} />
            <Typography variant="body2">{t('thinking')}</Typography>
          </Box>
        )}
        <div ref={endRef} />
      </Box>

      {photos.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            px: 1.5,
            pt: 1.5,
            flexWrap: 'wrap',
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
          {photos.map((p) => (
            <Box key={p.id} sx={{ position: 'relative' }}>
              {isPdfUrl(p.dataUrl) ? (
                <Box
                  sx={{
                    width: 64,
                    height: 64,
                    borderRadius: 1,
                    border: 1,
                    borderColor: 'divider',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'error.main',
                  }}
                >
                  <PdfIcon />
                  <Typography variant="caption">PDF</Typography>
                </Box>
              ) : (
                <Box
                  component="img"
                  src={p.dataUrl}
                  alt=""
                  sx={{
                    width: 64,
                    height: 64,
                    objectFit: 'cover',
                    borderRadius: 1,
                    display: 'block',
                  }}
                />
              )}
              <IconButton
                size="small"
                aria-label={t('removePhoto')}
                onClick={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))}
                sx={{
                  position: 'absolute',
                  top: -8,
                  right: -8,
                  bgcolor: 'background.paper',
                  border: 1,
                  borderColor: 'divider',
                  p: 0.25,
                  '&:hover': { bgcolor: 'background.paper' },
                }}
              >
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}
      <input
        ref={quickFileRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void sendFiles(files);
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void addPhotos(files);
        }}
      />
      {mic !== 'idle' && (
        <Box
          role="status"
          aria-live="polite"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            pt: 1.5,
            color: 'text.secondary',
          }}
        >
          {mic === 'recording' ? (
            <>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: 'error.main',
                  flexShrink: 0,
                  animation: 'mikoPulse 1.2s ease-in-out infinite',
                  '@keyframes mikoPulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
                }}
              />
              <Typography variant="body2" sx={{ flexGrow: 1 }}>
                {t('listening', { time: formatMicTime(micSeconds) })}
              </Typography>
              <Typography variant="caption">{t('micHint')}</Typography>
            </>
          ) : (
            <>
              <CircularProgress size={14} />
              <Typography variant="body2">{t('transcribing')}</Typography>
            </>
          )}
        </Box>
      )}
      <Box
        sx={{
          display: 'flex',
          gap: 0.5,
          alignItems: 'flex-end',
          p: 1.5,
          borderTop: photos.length || mic !== 'idle' ? 0 : 1,
          borderColor: 'divider',
        }}
      >
        <TextField
          fullWidth
          multiline
          maxRows={4}
          size="small"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('placeholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
          inputProps={{ maxLength: 4000, readOnly: mic !== 'idle' }}
        />
        <Tooltip title={t('attach')}>
          <span>
            <IconButton
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || photos.length >= MAX_PHOTOS}
              aria-label={t('attach')}
            >
              <AttachIcon />
            </IconButton>
          </span>
        </Tooltip>
        <CameraCapture
          onCapture={(file) => void addPhotos([file])}
          disabled={busy || photos.length >= MAX_PHOTOS}
          size="medium"
        />
        {micSupported() && (
          <Tooltip title={mic === 'recording' ? t('micStop') : t('mic')}>
            <span>
              <IconButton
                color={mic === 'recording' ? 'error' : 'default'}
                onClick={mic === 'recording' ? stopRecording : () => void startRecording()}
                disabled={busy || mic === 'transcribing'}
                aria-label={mic === 'recording' ? t('micStop') : t('mic')}
              >
                {mic === 'recording' ? (
                  <MicOffIcon />
                ) : mic === 'transcribing' ? (
                  <CircularProgress size={20} />
                ) : (
                  <MicIcon />
                )}
              </IconButton>
            </span>
          </Tooltip>
        )}
        <Tooltip title={t('send')}>
          <span>
            <IconButton
              color="primary"
              onClick={() => void send(input)}
              disabled={busy || mic !== 'idle' || (!input.trim() && photos.length === 0)}
              aria-label={t('send')}
            >
              <SendIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Drawer>
  );
}
