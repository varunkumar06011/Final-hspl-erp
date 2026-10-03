import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Box, Button, CircularProgress, IconButton, Typography } from '@mui/material';
import { ArrowBack as BackIcon, Forum as GeneralIcon, Group as GroupIcon } from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api, { extractErrorMessage } from '../../config/api';
import { dateLocale } from '../../i18n';
import { getSocket } from '../../hooks/usePresence';
import { useAuthStore } from '../../stores/authStore';
import ChatComposer from './ChatComposer';
import ChatMessageItem from './ChatMessageItem';
import { messagesKey, upsertMessage } from './chatCache';
import type { ChatConversationDTO, ChatMessageDTO, ChatUser, MessagePage } from './chatTypes';

function dayLabel(iso: string, t: (k: string) => string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t('today');
  if (d.toDateString() === yesterday.toDateString()) return t('yesterday');
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

interface ChatThreadProps {
  conversation: ChatConversationDTO;
  allUsers: ChatUser[];
  onBack?: () => void;
}

export default function ChatThread({ conversation, allUsers, onBack }: ChatThreadProps) {
  const { t } = useTranslation('chat');
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const firstLoadRef = useRef(true);
  const restoreRef = useRef<number | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessageDTO | null>(null);
  const [editing, setEditing] = useState<ChatMessageDTO | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const { data, isLoading } = useQuery<MessagePage>({
    queryKey: messagesKey(conversation.id),
    queryFn: async () => (await api.get(`/chat/conversations/${conversation.id}/messages`)).data,
    // Realtime events keep this fresh; refetching would drop older pages the user loaded.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const messages = useMemo(() => data?.data ?? [], [data]);

  // ── Tell the server which chat is on screen (suppresses push for it) ──
  useEffect(() => {
    let cancelled = false;
    let off: (() => void) | undefined;
    void getSocket().then((s) => {
      if (cancelled || !s) return;
      const open = () => s.emit('chat:open', { conversationId: conversation.id });
      if (s.connected) open();
      s.on('connect', open);
      off = () => {
        s.off('connect', open);
        s.emit('chat:close', { conversationId: conversation.id });
      };
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [conversation.id]);

  // ── Mark as read when opened and whenever something new lands while visible ──
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (isLoading || document.visibilityState === 'hidden') return;
    void api
      .post(`/chat/conversations/${conversation.id}/read`)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ['chat', 'unread'] });
        void queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
        void queryClient.invalidateQueries({ queryKey: ['/notifications/app'] });
      })
      .catch(() => {});
  }, [conversation.id, lastId, isLoading, queryClient]);

  // ── Scrolling: stay at the bottom for new messages, keep position when loading older ──
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoreRef.current !== null) {
      el.scrollTop = el.scrollHeight - restoreRef.current;
      restoreRef.current = null;
      return;
    }
    const last = messages[messages.length - 1];
    if (firstLoadRef.current || atBottomRef.current || last?.sender.id === me?.id) {
      el.scrollTop = el.scrollHeight;
      if (messages.length > 0) firstLoadRef.current = false;
    }
  }, [messages, me?.id]);

  const loadOlder = useMutation({
    mutationFn: async () => {
      const before = messages[0]?.createdAt;
      const res = await api.get(`/chat/conversations/${conversation.id}/messages`, { params: { before } });
      return res.data as MessagePage;
    },
    onSuccess: (older) => {
      restoreRef.current = scrollRef.current?.scrollHeight ?? null;
      queryClient.setQueryData<MessagePage>(messagesKey(conversation.id), (cur) =>
        cur ? { data: [...older.data, ...cur.data], hasMore: older.hasMore } : older,
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/chat/messages/${id}`);
    },
    onError: (err) => setActionError(extractErrorMessage(err)),
  });

  const handleSaved = useCallback(
    (message: ChatMessageDTO) => {
      queryClient.setQueryData<MessagePage>(messagesKey(conversation.id), (cur) => upsertMessage(cur, message));
      void queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    },
    [conversation.id, queryClient],
  );

  const jumpTo = useCallback((messageId: string) => {
    const el = document.getElementById(`chat-msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlightId(messageId);
    window.setTimeout(() => setHighlightId((cur) => (cur === messageId ? null : cur)), 1600);
  }, []);

  const handleReply = useCallback((m: ChatMessageDTO) => {
    setEditing(null);
    setReplyTo(m);
  }, []);
  const handleEdit = useCallback((m: ChatMessageDTO) => {
    setReplyTo(null);
    setEditing(m);
  }, []);
  const handleDelete = useCallback(
    (m: ChatMessageDTO) => {
      if (window.confirm(t('confirmDelete'))) {
        setActionError('');
        deleteMutation.mutate(m.id);
        setEditing((cur) => (cur?.id === m.id ? null : cur));
        setReplyTo((cur) => (cur?.id === m.id ? null : cur));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  // People who can be tagged: everyone in General, only members elsewhere.
  const mentionUsers = useMemo<ChatUser[]>(() => {
    if (conversation.type === 'GENERAL') return allUsers;
    if (conversation.type === 'DIRECT') return conversation.directUser ? [conversation.directUser] : [];
    return (conversation.members ?? []).filter((u) => u.id !== me?.id);
  }, [conversation, allUsers, me?.id]);

  const isAdmin = String(me?.role ?? '').startsWith('ADMIN');
  const title = conversation.type === 'GENERAL' ? t('general') : conversation.name;
  const subtitle =
    conversation.type === 'GENERAL'
      ? t('generalHint')
      : conversation.type === 'GROUP'
        ? t('members', { n: conversation.memberCount ?? 0 })
        : '';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        {onBack && (
          <IconButton onClick={onBack} aria-label={t('back')} edge="start">
            <BackIcon />
          </IconButton>
        )}
        <Avatar sx={{ width: 36, height: 36 }}>
          {conversation.type === 'GENERAL' ? (
            <GeneralIcon fontSize="small" />
          ) : conversation.type === 'GROUP' ? (
            <GroupIcon fontSize="small" />
          ) : (
            title.charAt(0).toUpperCase()
          )}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {subtitle}
            </Typography>
          )}
        </Box>
      </Box>

      <Box
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', py: 1, bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'background.default' : 'grey.100') }}
      >
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <>
            {data?.hasMore && (
              <Box sx={{ textAlign: 'center', py: 1 }}>
                <Button size="small" onClick={() => loadOlder.mutate()} disabled={loadOlder.isPending}>
                  {t('loadOlder')}
                </Button>
              </Box>
            )}
            {messages.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                {t('noMessages')}
              </Typography>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
              const mine = m.sender.id === me?.id;
              const sameSender = !!prev && !newDay && prev.sender.id === m.sender.id;
              return (
                <Box key={m.id}>
                  {newDay && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', my: 1 }}>
                      <Typography
                        variant="caption"
                        sx={{ px: 1.25, py: 0.25, borderRadius: 3, bgcolor: 'background.paper', border: 1, borderColor: 'divider', color: 'text.secondary' }}
                      >
                        {dayLabel(m.createdAt, t)}
                      </Typography>
                    </Box>
                  )}
                  <Box sx={{ mt: sameSender ? 0 : 0.75 }}>
                    <ChatMessageItem
                      message={m}
                      mine={mine}
                      showSender={conversation.type !== 'DIRECT' && !sameSender}
                      canDelete={!m.deletedAt && (mine || isAdmin)}
                      highlighted={highlightId === m.id}
                      onReply={handleReply}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onJumpTo={jumpTo}
                    />
                  </Box>
                </Box>
              );
            })}
            {actionError && (
              <Typography variant="caption" color="error" sx={{ display: 'block', textAlign: 'center' }}>
                {actionError}
              </Typography>
            )}
          </>
        )}
      </Box>

      <ChatComposer
        conversationId={conversation.id}
        mentionUsers={mentionUsers}
        replyTo={replyTo}
        editing={editing}
        onCancelContext={() => {
          setReplyTo(null);
          setEditing(null);
        }}
        onSaved={handleSaved}
      />
    </Box>
  );
}
