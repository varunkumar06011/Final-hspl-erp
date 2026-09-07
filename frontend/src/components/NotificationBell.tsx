import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconButton,
  Badge,
  Popover,
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
  Button,
  CircularProgress,
  Stack,
  Chip,
} from '@mui/material';
import {
  Notifications as NotificationsIcon,
  Circle as CircleIcon,
  DoneAll as DoneAllIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../config/api';

interface AppNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  url: string | null;
  entityId: string | null;
  entityType: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationResponse {
  data: AppNotification[];
  unreadCount: number;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay > 0) return `${diffDay}d ago`;
  if (diffHr > 0) return `${diffHr}h ago`;
  if (diffMin > 0) return `${diffMin}m ago`;
  return 'just now';
}

/**
 * Notification Bell — shows unread badge count and a dropdown panel with
 * in-app notifications. Clicking a notification navigates to its URL and
 * marks it as read. Uses the existing /notifications/app endpoints.
 *
 * Additive — does not modify any existing AppShell behavior.
 */
export default function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const { data, isLoading } = useQuery<NotificationResponse>({
    queryKey: ['/notifications/app'],
    queryFn: async () => {
      const response = await api.get<NotificationResponse>('/notifications/app', {
        params: { pageSize: 20 },
      });
      return response.data;
    },
    refetchInterval: 30000, // poll every 30s for new notifications
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/notifications/app/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/notifications/app'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await api.patch('/notifications/app/mark-all-read');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/notifications/app'] });
    },
  });

  const notifications = data?.data ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  const handleClick = (notification: AppNotification) => {
    if (!notification.isRead) {
      markReadMutation.mutate(notification.id);
    }
    setAnchorEl(null);
    if (notification.url) {
      navigate(notification.url);
    }
  };

  return (
    <>
      <IconButton
        color="inherit"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        title="Notifications"
      >
        <Badge badgeContent={unreadCount} color="error">
          <NotificationsIcon />
        </Badge>
      </IconButton>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            width: { xs: 320, sm: 380 },
            maxHeight: 500,
          },
        }}
      >
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle1" fontWeight={600}>
            Notifications
            {unreadCount > 0 && (
              <Chip label={unreadCount} size="small" color="error" sx={{ ml: 1 }} />
            )}
          </Typography>
          {unreadCount > 0 && (
            <Button
              size="small"
              startIcon={<DoneAllIcon />}
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
            >
              Mark all read
            </Button>
          )}
        </Box>

        {/* List */}
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress size={28} />
          </Box>
        ) : notifications.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography color="text.secondary" variant="body2">
              No notifications yet
            </Typography>
          </Box>
        ) : (
          <List sx={{ py: 0, maxHeight: 400, overflow: 'auto' }}>
            {notifications.map((n, i) => (
              <Box key={n.id}>
                {i > 0 && <Divider />}
                <ListItem
                  button
                  onClick={() => handleClick(n)}
                  sx={{
                    bgcolor: n.isRead ? 'inherit' : 'action.hover',
                    '&:hover': { bgcolor: 'action.selected' },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {!n.isRead && <CircleIcon sx={{ color: 'error.main', fontSize: 10 }} />}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography variant="body2" fontWeight={n.isRead ? 400 : 700}>
                          {n.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {timeAgo(n.createdAt)}
                        </Typography>
                      </Stack>
                    }
                    secondary={
                      <>
                        <Typography variant="body2" color="text.secondary" component="span" sx={{ display: 'block', mt: 0.5 }}>
                          {n.body}
                        </Typography>
                        {n.url && (
                          <Typography variant="caption" color="primary" sx={{ display: 'block', mt: 0.5 }}>
                            Click to view →
                          </Typography>
                        )}
                      </>
                    }
                  />
                </ListItem>
              </Box>
            ))}
          </List>
        )}
      </Popover>
    </>
  );
}
