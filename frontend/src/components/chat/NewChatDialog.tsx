import { useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api, { extractErrorMessage } from '../../config/api';
import { roleLabel } from '../../utils/enumOptions';
import ResponsiveDialog from '../ResponsiveDialog';
import type { ChatUser } from './chatTypes';

interface NewChatDialogProps {
  users: ChatUser[];
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}

export default function NewChatDialog({ users, onClose, onCreated }: NewChatDialogProps) {
  const { t } = useTranslation('chat');
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? users.filter((u) => u.name.toLowerCase().includes(q)) : users;
  }, [users, search]);

  const create = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await api.post('/chat/conversations', body)).data.data.id as string,
    onSuccess: (id) => onCreated(id),
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const togglePick = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <ResponsiveDialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('newChat')}</DialogTitle>
      <Tabs value={tab} onChange={(_e, v: number) => { setTab(v); setError(''); }} variant="fullWidth">
        <Tab label={t('directTab')} />
        <Tab label={t('groupTab')} />
      </Tabs>
      <DialogContent dividers sx={{ minHeight: 320 }}>
        {tab === 1 && (
          <TextField
            fullWidth
            size="small"
            label={t('groupName')}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            inputProps={{ maxLength: 80 }}
            sx={{ mb: 1.5 }}
          />
        )}
        <TextField
          fullWidth
          size="small"
          placeholder={t('searchPeople')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 1 }}
        />
        {tab === 1 && (
          <Typography variant="caption" color="text.secondary">
            {t('selectPeople')} ({picked.length})
          </Typography>
        )}
        <List dense>
          {filtered.map((u) => (
            <ListItemButton
              key={u.id}
              disabled={create.isPending}
              onClick={() => (tab === 0 ? create.mutate({ type: 'DIRECT', userId: u.id }) : togglePick(u.id))}
            >
              {tab === 1 && <Checkbox edge="start" checked={picked.includes(u.id)} tabIndex={-1} disableRipple />}
              <ListItemAvatar>
                <Avatar sx={{ width: 32, height: 32, fontSize: 14 }}>{u.name.charAt(0).toUpperCase()}</Avatar>
              </ListItemAvatar>
              <ListItemText primary={u.name} secondary={roleLabel(u.role)} />
            </ListItemButton>
          ))}
          {filtered.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
              {t('noPeople')}
            </Typography>
          )}
        </List>
        {error && (
          <Box>
            <Typography variant="caption" color="error">
              {error}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        {tab === 1 && (
          <Button
            variant="contained"
            disabled={!groupName.trim() || picked.length === 0 || create.isPending}
            onClick={() => create.mutate({ type: 'GROUP', name: groupName.trim(), memberIds: picked })}
          >
            {t('create')}
          </Button>
        )}
      </DialogActions>
    </ResponsiveDialog>
  );
}
