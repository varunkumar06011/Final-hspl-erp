import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  CircularProgress,
  InputAdornment,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Add as AddIcon,
  Forum as GeneralIcon,
  Group as GroupIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../config/api';
import { dateLocale } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import ChatThread from '../components/chat/ChatThread';
import NewChatDialog from '../components/chat/NewChatDialog';
import type { ChatConversationDTO, ChatUser } from '../components/chat/chatTypes';

function listTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short' });
}

export default function ChatPage() {
  const { t } = useTranslation('chat');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [newChatOpen, setNewChatOpen] = useState(false);

  const selectedId = params.get('c');
  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('c', id);
    else next.delete('c');
    setParams(next, { replace: false });
  };

  const { data: conversations = [], isLoading } = useQuery<ChatConversationDTO[]>({
    queryKey: ['chat', 'conversations'],
    queryFn: async () => (await api.get('/chat/conversations')).data?.data ?? [],
  });
  const { data: users = [] } = useQuery<ChatUser[]>({
    queryKey: ['chat', 'users'],
    queryFn: async () => (await api.get('/chat/users')).data?.data ?? [],
    staleTime: 5 * 60_000,
  });

  const nameOf = (c: ChatConversationDTO) => (c.type === 'GENERAL' ? t('general') : c.name);
  const q = search.trim().toLowerCase();
  const visible = q ? conversations.filter((c) => nameOf(c).toLowerCase().includes(q)) : conversations;

  // Desktop opens General by default; on a phone the list is the landing screen.
  const selected =
    conversations.find((c) => c.id === selectedId) ??
    (!isMobile && !selectedId ? conversations.find((c) => c.type === 'GENERAL') : undefined);

  const showList = !isMobile || !selected;
  const showThread = !isMobile || !!selected;

  return (
    <Card
      sx={{
        display: 'flex',
        height: { xs: 'calc(100dvh - 130px)', sm: 'calc(100dvh - 170px)' },
        minHeight: 420,
        overflow: 'hidden',
      }}
    >
      {showList && (
        <Box
          sx={{
            width: { xs: '100%', md: 340 },
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: { md: 1 },
            borderColor: 'divider',
            minHeight: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
              {t('chats')}
            </Typography>
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setNewChatOpen(true)}>
              {t('newChat')}
            </Button>
          </Box>
          <Box sx={{ px: 1.5, pb: 1 }}>
            <TextField
              fullWidth
              size="small"
              placeholder={t('searchChats')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{ '& .MuiInputBase-input': { fontSize: { xs: 16, sm: '0.875rem' } } }}
            />
          </Box>
          <List disablePadding sx={{ flex: 1, overflowY: 'auto' }}>
            {isLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={22} />
              </Box>
            )}
            {visible.map((c) => {
              const last = c.lastMessage;
              const lastText = last
                ? last.deleted
                  ? t('deleted')
                  : `${c.type === 'DIRECT' ? '' : `${last.senderId === me?.id ? t('you') : last.senderName}: `}${last.preview}`
                : '';
              return (
                <ListItemButton key={c.id} selected={selected?.id === c.id} onClick={() => select(c.id)} sx={{ py: 1 }}>
                  <ListItemAvatar>
                    <Badge color="error" badgeContent={c.unread} max={99} invisible={c.unread === 0}>
                      <Avatar>
                        {c.type === 'GENERAL' ? (
                          <GeneralIcon />
                        ) : c.type === 'GROUP' ? (
                          <GroupIcon />
                        ) : (
                          nameOf(c).charAt(0).toUpperCase()
                        )}
                      </Avatar>
                    </Badge>
                  </ListItemAvatar>
                  <ListItemText
                    primary={nameOf(c)}
                    secondary={lastText}
                    primaryTypographyProps={{ noWrap: true, fontWeight: c.unread > 0 ? 700 : 500 }}
                    secondaryTypographyProps={{ noWrap: true, fontWeight: c.unread > 0 ? 600 : 400 }}
                  />
                  {last && (
                    <Typography variant="caption" color={c.unread > 0 ? 'primary' : 'text.secondary'} sx={{ ml: 1, alignSelf: 'flex-start', mt: 0.5 }}>
                      {listTime(c.lastMessageAt)}
                    </Typography>
                  )}
                </ListItemButton>
              );
            })}
            {!isLoading && visible.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                {t('noChats')}
              </Typography>
            )}
          </List>
        </Box>
      )}

      {showThread && (
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {selected ? (
            <ChatThread key={selected.id} conversation={selected} allUsers={users} onBack={isMobile ? () => select(null) : undefined} />
          ) : (
            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
              <Typography color="text.secondary">{t('selectChat')}</Typography>
            </Box>
          )}
        </Box>
      )}

      {newChatOpen && (
        <NewChatDialog
          users={users}
          onClose={() => setNewChatOpen(false)}
          onCreated={(id) => {
            setNewChatOpen(false);
            void queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
            select(id);
          }}
        />
      )}
    </Card>
  );
}
