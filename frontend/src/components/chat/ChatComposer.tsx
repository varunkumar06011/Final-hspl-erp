import { useMemo, useRef, useState } from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Popper,
  TextField,
  Typography,
} from '@mui/material';
import {
  AttachFile as AttachIcon,
  Close as CloseIcon,
  EmojiEmotionsOutlined as EmojiIcon,
  Send as SendIcon,
} from '@mui/icons-material';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api, { extractErrorMessage } from '../../config/api';
import { roleLabel } from '../../utils/enumOptions';
import EmojiPicker from './EmojiPicker';
import {
  CHAT_MAX_FILES,
  CHAT_MAX_FILE_MB,
  type ChatMessageDTO,
  type ChatUser,
} from './chatTypes';

// Mirrors backend/src/utils/uploadFileTypes.ts (the server check is the real guard).
const ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,.heic,.heif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt';

interface ChatComposerProps {
  conversationId: string;
  /** People who can be tagged in this chat (never includes the current user). */
  mentionUsers: ChatUser[];
  replyTo: ChatMessageDTO | null;
  editing: ChatMessageDTO | null;
  onCancelContext: () => void;
  /** Called with the saved message (new or edited). */
  onSaved: (message: ChatMessageDTO, wasEdit: boolean) => void;
}

export default function ChatComposer({
  conversationId,
  mentionUsers,
  replyTo,
  editing,
  onCancelContext,
  onSaved,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [tagged, setTagged] = useState<Record<string, ChatUser>>({});
  const [pickerIndex, setPickerIndex] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const [loadedEditId, setLoadedEditId] = useState<string | null>(null);

  // Entering edit mode loads the message into the box (derived during render, no effect needed).
  if ((editing?.id ?? null) !== loadedEditId) {
    setLoadedEditId(editing?.id ?? null);
    if (editing) {
      setText(editing.body);
      setCaret(editing.body.length);
      setTagged(Object.fromEntries(editing.mentions.map((m) => [m.id, { id: m.id, name: m.name, role: '' }])));
      setFiles([]);
      setError('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  const activeMention = useMemo(() => {
    const before = text.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at < 0) return null;
    if (at > 0 && !/\s/.test(before[at - 1])) return null;
    const query = before.slice(at + 1);
    if (query.length > 30 || query.includes('\n')) return null;
    return { start: at, query };
  }, [text, caret]);

  const suggestions = useMemo(() => {
    if (!activeMention) return [];
    const q = activeMention.query.toLowerCase();
    return mentionUsers.filter((u) => u.name.toLowerCase().includes(q));
  }, [activeMention, mentionUsers]);

  const pickUser = (u: ChatUser) => {
    if (!activeMention) return;
    const next = `${text.slice(0, activeMention.start)}@${u.name} ${text.slice(caret)}`;
    const newCaret = activeMention.start + u.name.length + 2;
    setText(next);
    setCaret(newCaret);
    setTagged((prev) => ({ ...prev, [u.id]: u }));
    setPickerIndex(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCaret, newCaret);
    });
  };

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    const newCaret = start + emoji.length;
    setText(next);
    setCaret(newCaret);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(newCaret, newCaret);
    });
  };

  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    const next = [...files];
    for (const f of Array.from(picked)) {
      if (f.size > CHAT_MAX_FILE_MB * 1024 * 1024) {
        setError(t('fileTooLarge', { name: f.name, n: CHAT_MAX_FILE_MB }));
        continue;
      }
      if (next.length >= CHAT_MAX_FILES) {
        setError(t('tooManyFiles', { n: CHAT_MAX_FILES }));
        break;
      }
      next.push(f);
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = '';
  };

  const reset = () => {
    setText('');
    setTagged({});
    setFiles([]);
    setError('');
    setLoadedEditId(null);
  };

  const send = useMutation({
    mutationFn: async () => {
      // Only tags whose @Name is still in the text count.
      const mentionIds = Object.values(tagged)
        .filter((u) => text.includes(`@${u.name}`))
        .map((u) => u.id);
      if (editing) {
        const res = await api.patch(`/chat/messages/${editing.id}`, { body: text.trim(), mentionIds });
        return { message: res.data.data as ChatMessageDTO, wasEdit: true };
      }
      const form = new FormData();
      form.append('body', text.trim());
      form.append('mentionIds', JSON.stringify(mentionIds));
      if (replyTo) form.append('replyToId', replyTo.id);
      files.forEach((f) => form.append('files', f));
      const res = await api.post(`/chat/conversations/${conversationId}/messages`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      });
      return { message: res.data.data as ChatMessageDTO, wasEdit: false };
    },
    onSuccess: ({ message, wasEdit }) => {
      reset();
      onCancelContext();
      onSaved(message, wasEdit);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const canSend = (text.trim().length > 0 || (!editing && files.length > 0)) && !send.isPending;
  // On phones Enter adds a new line (the Send button sends); on desktop Enter sends.
  const enterSends = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches;

  const cancelContext = () => {
    if (editing) reset();
    onCancelContext();
  };

  return (
    <Box sx={{ borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 1, pt: 0.75, pb: 'calc(8px + env(safe-area-inset-bottom))' }}>
      {(replyTo || editing) && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mb: 0.75,
            px: 1,
            py: 0.5,
            borderLeft: 3,
            borderColor: 'primary.main',
            borderRadius: 1,
            bgcolor: 'action.hover',
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" color="primary" sx={{ fontWeight: 700, display: 'block' }}>
              {editing ? t('editing') : t('replyingTo', { name: replyTo!.sender.name })}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {(editing ?? replyTo)!.body || (editing ?? replyTo)!.attachments[0]?.fileName || ''}
            </Typography>
          </Box>
          <IconButton size="small" onClick={cancelContext} aria-label={t('cancel')}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {files.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.75 }}>
          {files.map((f, i) => (
            <Chip
              key={`${f.name}-${i}`}
              size="small"
              label={f.name}
              onDelete={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
              sx={{ maxWidth: 220 }}
            />
          ))}
        </Box>
      )}

      {error && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mb: 0.5 }}>
          {error}
        </Typography>
      )}

      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5 }}>
        <IconButton onClick={(e) => setEmojiAnchor(e.currentTarget)} aria-label={t('emoji')} sx={{ mb: 0.25 }}>
          <EmojiIcon />
        </IconButton>
        {!editing && (
          <>
            <IconButton
              onClick={() => fileRef.current?.click()}
              aria-label={t('attach')}
              disabled={files.length >= CHAT_MAX_FILES}
              sx={{ mb: 0.25 }}
            >
              <AttachIcon sx={{ transform: 'rotate(45deg)' }} />
            </IconButton>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              accept={ACCEPT}
              onChange={(e) => addFiles(e.target.files)}
            />
          </>
        )}
        <TextField
          fullWidth
          multiline
          minRows={1}
          maxRows={5}
          size="small"
          inputRef={inputRef}
          value={text}
          placeholder={t('typeMessage')}
          inputProps={{ enterKeyHint: enterSends ? 'send' : 'enter', maxLength: 4000 }}
          sx={{ '& .MuiInputBase-input': { fontSize: { xs: 16, sm: '0.875rem' } }, '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setPickerIndex(0);
          }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (suggestions.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setPickerIndex((i) => (i + 1) % suggestions.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setPickerIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                pickUser(suggestions[pickerIndex] ?? suggestions[0]);
                return;
              }
            }
            if (e.key === 'Escape' && (editing || replyTo)) {
              cancelContext();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey && enterSends && canSend && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send.mutate();
            }
          }}
        />
        <IconButton
          color="primary"
          onClick={() => send.mutate()}
          disabled={!canSend}
          aria-label={t('send')}
          sx={{ mb: 0.25 }}
        >
          {send.isPending ? <CircularProgress size={22} /> : <SendIcon />}
        </IconButton>
      </Box>

      <Popper open={suggestions.length > 0} anchorEl={inputRef.current} placement="top-start" style={{ zIndex: 1500 }}>
        <Paper elevation={6} sx={{ minWidth: 220, maxHeight: 240, overflow: 'auto' }}>
          <List dense disablePadding>
            {suggestions.map((u, i) => (
              <ListItemButton
                key={u.id}
                ref={i === pickerIndex ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                selected={i === pickerIndex}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep textarea focus
                  pickUser(u);
                }}
              >
                <ListItemText primary={u.name} secondary={roleLabel(u.role)} />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      </Popper>

      <EmojiPicker
        anchorEl={emojiAnchor}
        onClose={() => setEmojiAnchor(null)}
        onPick={(emoji) => insertEmoji(emoji)}
      />
    </Box>
  );
}
