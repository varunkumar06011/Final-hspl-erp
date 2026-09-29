import { useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Popper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ChatBubbleOutline as CommentIcon,
  Delete as DeleteIcon,
  Send as SendIcon,
} from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import ResponsiveDialog from './ResponsiveDialog';

export interface CommentMention {
  id: string;
  name: string;
}

export interface CommentRow {
  id: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  url: string | null;
  body: string;
  mentions: CommentMention[];
  createdAt: string;
  author: { id: string; name: string; role: string };
}

interface MentionUser {
  id: string;
  name: string;
  role: string;
}

export function roleLabel(role: unknown): string {
  return String(role ?? '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/w/g, (c) => c.toUpperCase());
}

export function timeAgo(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const hr = Math.floor(diffMin / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Renders comment text with tagged `@Name` parts highlighted. */
export function CommentBody({ body, mentions }: { body: string; mentions: CommentMention[] }) {
  const parts = useMemo(() => {
    const names = mentions.map((m) => m.name).filter(Boolean);
    if (names.length === 0) return [body];
    const escaped = names
      .sort((a, b) => b.length - a.length)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return body.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g'));
  }, [body, mentions]);

  return (
    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {parts.map((p, i) =>
        p.startsWith('@') && mentions.some((m) => `@${m.name}` === p) ? (
          <Box key={i} component="span" sx={{ color: 'primary.main', fontWeight: 600 }}>
            {p}
          </Box>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </Typography>
  );
}

interface CommentsButtonProps {
  entityType: string;
  entityId: string | null | undefined;
  /** Shown in the comments module and notifications, e.g. "PO-0012". */
  entityLabel?: string;
  /** Route of the page holding the record — where a notification click lands. */
  url?: string;
  size?: 'small' | 'medium';
}

/**
 * Comment icon for any record. Opens a thread where anyone can comment and
 * tag people by typing @. Tagged users alone are notified; with no tag,
 * everyone is.
 */
export default function CommentsButton({
  entityType,
  entityId,
  entityLabel,
  url,
  size = 'small',
}: CommentsButtonProps) {
  const [open, setOpen] = useState(false);
  if (!entityId) return null;
  return (
    <>
      <Tooltip title="Comments">
        <IconButton
          size={size}
          sx={{ p: { xs: 1, sm: 0.5 } }}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <CommentIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {open && (
        <CommentsDialog
          entityType={entityType}
          entityId={entityId}
          entityLabel={entityLabel}
          url={url}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function CommentsDialog({
  entityType,
  entityId,
  entityLabel,
  url,
  onClose,
}: {
  entityType: string;
  entityId: string;
  entityLabel?: string;
  url?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [tagged, setTagged] = useState<Record<string, MentionUser>>({});
  const [pickerIndex, setPickerIndex] = useState(0);
  const [error, setError] = useState('');

  const { data: comments, isLoading } = useQuery<CommentRow[]>({
    queryKey: ['comments', entityType, entityId],
    queryFn: async () => {
      const res = await api.get('/comments', { params: { entityType, entityId } });
      return res.data?.data ?? [];
    },
  });

  const { data: users = [] } = useQuery<MentionUser[]>({
    queryKey: ['comments', 'users'],
    queryFn: async () => (await api.get('/comments/users')).data?.data ?? [],
    staleTime: 5 * 60_000,
  });

  // The "@query" being typed just before the caret (@ must start a word).
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
    return users
      .filter((u) => u.id !== me?.id && u.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [activeMention, users, me?.id]);

  const pickUser = (u: MentionUser) => {
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

  const postMutation = useMutation({
    mutationFn: async () => {
      // Only tags whose @Name is still in the text count.
      const mentionIds = Object.values(tagged)
        .filter((u) => text.includes(`@${u.name}`))
        .map((u) => u.id);
      await api.post('/comments', {
        entityType,
        entityId,
        entityLabel,
        url,
        body: text.trim(),
        mentionIds,
      });
    },
    onSuccess: () => {
      setText('');
      setTagged({});
      setError('');
      queryClient.invalidateQueries({ queryKey: ['comments'] });
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/comments/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments'] }),
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const canDelete = (c: CommentRow) =>
    c.author.id === me?.id || String(me?.role ?? '').startsWith('ADMIN');

  return (
    <ResponsiveDialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Comments{entityLabel ? ` — ${entityLabel}` : ''}</DialogTitle>
      <DialogContent dividers sx={{ minHeight: 200 }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (comments ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            No comments yet. Start the conversation below.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {(comments ?? []).map((c) => (
              <Box key={c.id} sx={{ display: 'flex', gap: 1.25 }}>
                <Avatar sx={{ width: 30, height: 30, fontSize: 14 }}>
                  {c.author.name.charAt(0).toUpperCase()}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                    <Typography variant="subtitle2">{c.author.name}</Typography>
                    <Chip size="small" label={roleLabel(c.author.role)} sx={{ height: 18, fontSize: '0.65rem' }} />
                    <Typography variant="caption" color="text.secondary">
                      {timeAgo(c.createdAt)}
                    </Typography>
                    {canDelete(c) && (
                      <IconButton
                        size="small"
                        sx={{ ml: 'auto' }}
                        onClick={() => deleteMutation.mutate(c.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    )}
                  </Box>
                  <CommentBody body={c.body} mentions={c.mentions ?? []} />
                </Box>
              </Box>
            ))}
          </Box>
        )}
        {error && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ alignItems: { xs: "stretch", sm: "flex-end" }, flexDirection: { xs: "column", sm: "row" }, px: 2, py: 1.5, gap: 1, pb: { xs: "calc(12px + env(safe-area-inset-bottom))", sm: 1.5 } }}>
        <Box sx={{ flex: 1 }}>
          <TextField
            fullWidth
            multiline
            inputProps={{ enterKeyHint: "send" }}
            sx={{ "& .MuiInputBase-input": { fontSize: { xs: 16, sm: "0.875rem" } } }}
            minRows={2}
            maxRows={6}
            size="small"
            inputRef={inputRef}
            value={text}
            placeholder="Write a comment… type @ to tag someone (no tag = notify everyone)"
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
                if (e.key === 'Escape') {
                  e.stopPropagation();
                }
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) {
                e.preventDefault();
                postMutation.mutate();
              }
            }}
          />
          <Popper
            open={suggestions.length > 0}
            anchorEl={inputRef.current}
            placement="top-start"
            style={{ zIndex: 1500 }}
          >
            <Paper elevation={6} sx={{ minWidth: 220, maxHeight: 240, overflow: 'auto' }}>
              <List dense disablePadding>
                {suggestions.map((u, i) => (
                  <ListItemButton
                    key={u.id}
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
        </Box>
        <Button
          variant="contained"
          endIcon={<SendIcon />}
          size="large"
          disabled={!text.trim() || postMutation.isPending}
          onClick={() => postMutation.mutate()}
        >
          Post
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
