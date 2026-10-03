import { memo, useRef, useState } from 'react';
import { Box, Dialog, IconButton, Menu, MenuItem, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Download as DownloadIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  ExpandMore as MoreIcon,
  InsertDriveFileOutlined as DocIcon,
  Reply as ReplyIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { dateLocale } from '../../i18n';
import { downloadFile } from '../../utils/file';
import { SecureImage } from '../SecureImage';
import { CommentBody } from '../CommentsButton';
import type { ChatAttachmentDTO, ChatMessageDTO } from './chatTypes';

const SWIPE_TRIGGER_PX = 64;
const SWIPE_MAX_PX = 96;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
}

// Stable colour per sender so people are easy to tell apart in a group.
const NAME_COLORS = ['#1565C0', '#2E7D32', '#C62828', '#6A1B9A', '#EF6C00', '#00838F', '#AD1457', '#4E342E'];
function nameColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return NAME_COLORS[hash % NAME_COLORS.length];
}

interface ChatMessageItemProps {
  message: ChatMessageDTO;
  mine: boolean;
  showSender: boolean;
  canDelete: boolean;
  highlighted: boolean;
  onReply: (m: ChatMessageDTO) => void;
  onEdit: (m: ChatMessageDTO) => void;
  onDelete: (m: ChatMessageDTO) => void;
  onJumpTo: (messageId: string) => void;
}

function ChatMessageItem({
  message,
  mine,
  showSender,
  canDelete,
  highlighted,
  onReply,
  onEdit,
  onDelete,
  onJumpTo,
}: ChatMessageItemProps) {
  const { t } = useTranslation('chat');
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [lightbox, setLightbox] = useState<ChatAttachmentDTO | null>(null);
  const deleted = !!message.deletedAt;

  // ── Swipe right to reply (touch). Vertical scrolling is left alone. ──
  const [dx, setDx] = useState(0);
  const touch = useRef<{ x: number; y: number; axis: 'h' | 'v' | null } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (deleted) return;
    const p = e.touches[0];
    touch.current = { x: p.clientX, y: p.clientY, axis: null };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = touch.current;
    if (!s) return;
    const p = e.touches[0];
    const ddx = p.clientX - s.x;
    const ddy = p.clientY - s.y;
    if (!s.axis && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) {
      s.axis = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';
    }
    if (s.axis === 'h') setDx(Math.max(0, Math.min(ddx, SWIPE_MAX_PX)));
  };
  const onTouchEnd = () => {
    if (touch.current?.axis === 'h' && dx >= SWIPE_TRIGGER_PX) {
      try {
        navigator.vibrate?.(10);
      } catch {
        /* not supported */
      }
      onReply(message);
    }
    touch.current = null;
    setDx(0);
  };

  const images = message.attachments.filter((a) => a.fileType === 'IMAGE');
  const docs = message.attachments.filter((a) => a.fileType !== 'IMAGE');

  return (
    <Box
      id={`chat-msg-${message.id}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      sx={{
        position: 'relative',
        display: 'flex',
        justifyContent: mine ? 'flex-end' : 'flex-start',
        px: 1,
        py: 0.25,
        touchAction: 'pan-y',
        '&:hover .chat-msg-more': { opacity: 1 },
      }}
    >
      {/* Reply hint revealed while swiping */}
      <ReplyIcon
        sx={{
          position: 'absolute',
          left: 12,
          top: '50%',
          mt: '-12px',
          color: 'text.secondary',
          opacity: Math.min(1, dx / SWIPE_TRIGGER_PX),
          transform: `scale(${0.6 + Math.min(0.4, dx / (SWIPE_TRIGGER_PX * 2.5))})`,
        }}
      />
      <Box
        sx={{
          maxWidth: { xs: '86%', sm: '70%' },
          minWidth: 0,
          transform: `translateX(${dx}px)`,
          transition: dx === 0 ? 'transform 0.2s ease' : 'none',
        }}
      >
        <Box
          sx={{
            position: 'relative',
            px: 1.25,
            pt: 0.75,
            pb: 0.5,
            borderRadius: 2,
            borderTopRightRadius: mine ? 4 : undefined,
            borderTopLeftRadius: mine ? undefined : 4,
            bgcolor: (theme) =>
              mine ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.32 : 0.14) : 'background.paper',
            border: 1,
            borderColor: highlighted ? 'primary.main' : 'divider',
            boxShadow: highlighted ? (theme) => `0 0 0 2px ${alpha(theme.palette.primary.main, 0.35)}` : 'none',
            transition: 'box-shadow 0.3s, border-color 0.3s',
          }}
        >
          {!deleted && (
            <IconButton
              className="chat-msg-more"
              size="small"
              aria-label={t('messageActions')}
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              sx={{
                position: 'absolute',
                top: 0,
                right: 0,
                p: 0.25,
                opacity: { xs: 0.7, md: 0 },
                transition: 'opacity 0.15s',
                bgcolor: 'background.paper',
                '&:hover': { bgcolor: 'background.paper' },
              }}
            >
              <MoreIcon sx={{ fontSize: 18 }} />
            </IconButton>
          )}

          {showSender && !mine && (
            <Typography variant="caption" sx={{ fontWeight: 700, color: nameColor(message.sender.id), display: 'block' }}>
              {message.sender.name}
            </Typography>
          )}

          {message.replyTo && (
            <Box
              onClick={() => onJumpTo(message.replyTo!.id)}
              sx={{
                cursor: 'pointer',
                mb: 0.5,
                px: 1,
                py: 0.5,
                borderLeft: 3,
                borderColor: nameColor(message.replyTo.senderName),
                borderRadius: 1,
                bgcolor: 'action.hover',
                minWidth: 0,
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }} noWrap>
                {message.replyTo.senderName}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', fontStyle: message.replyTo.deleted ? 'italic' : 'normal' }}
                noWrap
              >
                {message.replyTo.deleted
                  ? t('deleted')
                  : message.replyTo.body || (message.replyTo.attachmentName ? `📎 ${message.replyTo.attachmentName}` : '')}
              </Typography>
            </Box>
          )}

          {deleted ? (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', pr: 1 }}>
              {t('deleted')}
            </Typography>
          ) : (
            <>
              {images.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: message.body || docs.length ? 0.5 : 0 }}>
                  {images.map((a) => (
                    <Box key={a.id} onClick={() => setLightbox(a)} sx={{ cursor: 'zoom-in', lineHeight: 0 }}>
                      <SecureImage
                        route="chat/attachments"
                        id={a.id}
                        alt={a.fileName}
                        sx={{ width: images.length === 1 ? 240 : 116, height: images.length === 1 ? 180 : 116, maxWidth: '100%' }}
                      />
                    </Box>
                  ))}
                </Box>
              )}
              {docs.map((a) => (
                <Box
                  key={a.id}
                  onClick={() => void downloadFile('chat/attachments', a.id, a.fileName)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    mb: 0.5,
                    p: 0.75,
                    borderRadius: 1,
                    bgcolor: 'action.hover',
                    cursor: 'pointer',
                    minWidth: 160,
                  }}
                >
                  <DocIcon color="primary" />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                      {a.fileName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatSize(a.size)}
                    </Typography>
                  </Box>
                </Box>
              ))}
              {message.body && <CommentBody body={message.body} mentions={message.mentions} />}
            </>
          )}

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', textAlign: 'right', fontSize: '0.68rem', mt: 0.25 }}
          >
            {message.editedAt && !deleted ? `${t('edited')} · ` : ''}
            {formatTime(message.createdAt)}
          </Typography>
        </Box>
      </Box>

      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onReply(message);
          }}
        >
          <ReplyIcon fontSize="small" sx={{ mr: 1 }} /> {t('reply')}
        </MenuItem>
        {message.body && (
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              void navigator.clipboard?.writeText(message.body).catch(() => {});
            }}
          >
            <CopyIcon fontSize="small" sx={{ mr: 1 }} /> {t('copy')}
          </MenuItem>
        )}
        {mine && (
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              onEdit(message);
            }}
          >
            <EditIcon fontSize="small" sx={{ mr: 1 }} /> {t('edit')}
          </MenuItem>
        )}
        {canDelete && (
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              onDelete(message);
            }}
            sx={{ color: 'error.main' }}
          >
            <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> {t('delete')}
          </MenuItem>
        )}
      </Menu>

      <Dialog open={!!lightbox} onClose={() => setLightbox(null)} maxWidth="lg">
        {lightbox && (
          <Box sx={{ position: 'relative', lineHeight: 0, bgcolor: 'black' }}>
            <SecureImage
              route="chat/attachments"
              id={lightbox.id}
              alt={lightbox.fileName}
              sx={{ maxWidth: '100%', maxHeight: '85vh', width: 'auto', height: 'auto', objectFit: 'contain', borderRadius: 0 }}
            />
            <IconButton
              aria-label={t('attachment')}
              onClick={() => void downloadFile('chat/attachments', lightbox.id, lightbox.fileName)}
              sx={{ position: 'absolute', right: 8, bottom: 8, color: 'white', bgcolor: 'rgba(0,0,0,.5)' }}
            >
              <DownloadIcon />
            </IconButton>
          </Box>
        )}
      </Dialog>
    </Box>
  );
}

export default memo(ChatMessageItem);
