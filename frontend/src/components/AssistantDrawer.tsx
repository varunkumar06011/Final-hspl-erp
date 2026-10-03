import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
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
  AutoAwesome as AssistantIcon,
  Close as CloseIcon,
  Mic as MicIcon,
  MicOff as MicOffIcon,
  OpenInNew as OpenIcon,
  RestartAlt as NewChatIcon,
  Send as SendIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import api from '../config/api';
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
type Msg =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; text: string; tables: ListTable[]; pending: PendingAction[] }
  | { id: number; role: 'error'; text: string };

type NewMsg = Msg extends infer M ? (M extends { id: number } ? Omit<M, 'id'> : never) : never;

interface ActionState {
  status: 'idle' | 'saving' | 'saved' | 'failed' | 'discarded';
  label?: string;
  link?: string | null;
  error?: string;
}

const AMOUNT_COLS = /(total|amount|grandTotal)$/i;
const STATUS_COLS = /(status|type)$/i;
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}T/;

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
  const [listening, setListening] = useState(false);

  const historyRef = useRef<GeminiContent[]>([]);
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  const SpeechRecognitionCtor = useMemo(
    () => (typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null),
    [],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, actions, busy]);

  useEffect(() => () => recognitionRef.current?.abort?.(), []);

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

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setInput('');
      addMsg({ role: 'user', text });
      setBusy(true);
      try {
        const { data } = await api.post('/assistant/chat', { message: text, history: historyRef.current });
        historyRef.current = data.history ?? [];
        addMsg({ role: 'assistant', text: data.reply ?? '', tables: data.tables ?? [], pending: data.pending ?? [] });
      } catch (err) {
        addMsg({ role: 'error', text: errorText(err) });
      } finally {
        setBusy(false);
      }
    },
    [busy, addMsg, errorText],
  );

  const setAction = (id: string, patch: ActionState) => setActions((prev) => ({ ...prev, [id]: patch }));

  const confirm = async (a: PendingAction) => {
    setAction(a.id, { status: 'saving' });
    try {
      const { data } = await api.post(`/assistant/actions/${a.id}/confirm`);
      historyRef.current = [...historyRef.current, ...(data.historyAppend ?? [])];
      setAction(a.id, { status: 'saved', label: data.result?.label, link: data.result?.link });
      void queryClient.invalidateQueries();
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
    recognitionRef.current?.abort?.();
    setListening(false);
    historyRef.current = [];
    setMessages([]);
    setActions({});
    setInput('');
  };

  const toggleMic = () => {
    if (!SpeechRecognitionCtor) return;
    if (listening) {
      recognitionRef.current?.stop?.();
      return;
    }
    const rec = new SpeechRecognitionCtor();
    rec.lang = i18n.language?.startsWith('te') ? 'te-IN' : 'en-IN';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      const heard = Array.from(e.results as ArrayLike<any>)
        .map((r) => r[0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (heard) setInput((prev) => (prev ? `${prev} ${heard}` : heard));
    };
    rec.onerror = () => addMsg({ role: 'error', text: t('micError') });
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
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

  const examples = [t('ex1'), t('ex2'), t('ex3'), t('ex4')];

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 460 }, display: 'flex', flexDirection: 'column' } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
        <AssistantIcon color="primary" />
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {t('title')}
        </Typography>
        <Tooltip title={t('newChat')}>
          <span>
            <IconButton onClick={newChat} disabled={busy || messages.length === 0} aria-label={t('newChat')}>
              <NewChatIcon />
            </IconButton>
          </span>
        </Tooltip>
        <IconButton onClick={onClose} aria-label={t('close')}>
          <CloseIcon />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {messages.length === 0 && (
          <Box sx={{ textAlign: 'center', mt: 3 }}>
            <Typography variant="h6" gutterBottom>
              {t('welcomeTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('welcomeBody')}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'stretch' }}>
              {examples.map((ex) => (
                <Chip key={ex} label={ex} onClick={() => void send(ex)} variant="outlined" sx={{ height: 'auto', py: 0.75, '& .MuiChip-label': { whiteSpace: 'normal' } }} />
              ))}
            </Box>
          </Box>
        )}

        {messages.map((m) => {
          if (m.role === 'user') {
            return (
              <Paper key={m.id} elevation={0} sx={{ alignSelf: 'flex-end', maxWidth: '85%', px: 1.5, py: 1, bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: 2, whiteSpace: 'pre-wrap' }}>
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
            <Box key={m.id} sx={{ alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 1 }}>
              {m.text && (
                <Paper variant="outlined" sx={{ px: 1.5, py: 1, borderRadius: 2, alignSelf: 'flex-start', maxWidth: '92%', whiteSpace: 'pre-wrap' }}>
                  <Typography variant="body2">{m.text}</Typography>
                </Paper>
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
                            <TableRow key={r.id} hover={!!r.link} onClick={() => go(r.link)} sx={{ cursor: r.link ? 'pointer' : 'default' }}>
                              {tb.columns.map((c) => (
                                <TableCell key={c} sx={{ whiteSpace: 'nowrap' }}>
                                  {cellValue(c, r.values[c])}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 0.75 }}>
                        {t('showing', { shown: tb.rows.length, total: tb.total })}
                      </Typography>
                    </>
                  )}
                </Paper>
              ))}

              {m.pending.map((a) => {
                const st = actions[a.id] ?? { status: 'idle' as const };
                return (
                  <Paper key={a.id} variant="outlined" sx={{ p: 1.5, borderColor: 'primary.main', borderWidth: 1.5 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      {t(`tool.${a.tool}`, { defaultValue: a.tool })}
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 1.5, rowGap: 0.25, mb: 1 }}>
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
                      <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', fontWeight: tt.key === 'total' ? 700 : 400 }}>
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
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                            {t('reviewNote')}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button variant="contained" size="small" onClick={() => void confirm(a)}>
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
                            <Link component="button" type="button" onClick={() => go(st.link ?? null)} sx={{ verticalAlign: 'baseline' }}>
                              {t('openRecord')} <OpenIcon sx={{ fontSize: 14, verticalAlign: 'middle' }} />
                            </Link>
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

      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-end', p: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <TextField
          fullWidth
          multiline
          maxRows={4}
          size="small"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? t('micStop') : t('placeholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
          inputProps={{ maxLength: 4000 }}
        />
        {SpeechRecognitionCtor && (
          <Tooltip title={listening ? t('micStop') : t('mic')}>
            <IconButton color={listening ? 'error' : 'default'} onClick={toggleMic} aria-label={t('mic')}>
              {listening ? <MicOffIcon /> : <MicIcon />}
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={t('send')}>
          <span>
            <IconButton color="primary" onClick={() => void send(input)} disabled={busy || !input.trim()} aria-label={t('send')}>
              <SendIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Drawer>
  );
}
