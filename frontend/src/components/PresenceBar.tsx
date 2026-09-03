import { Avatar, Box, Tooltip, Typography, Fade } from '@mui/material';
import { usePresence } from '../hooks/usePresence';
import { UserRole } from '@hospital-erp/shared';

const ROLE_COLORS: Record<string, string> = {
  [UserRole.SUPERVISOR]: '#FF9800',
  [UserRole.ACCOUNTANT]: '#2196F3',
  [UserRole.SITE_SUPERVISOR]: '#FF9800',
  [UserRole.PROJECT_HEAD]: '#9C27B0',
  [UserRole.HEAD_OF_CONSTRUCTION]: '#9C27B0',
  [UserRole.ACCOUNTS_HEAD]: '#2196F3',
  [UserRole.ADMIN]: '#F44336',
  [UserRole.ADMIN_2]: '#F44336',
};

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 50%)`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/**
 * Shows avatars of other users currently viewing the same page.
 * Floating bar at the bottom-right of the screen.
 */
export default function PresenceBar() {
  const { viewers } = usePresence();

  if (viewers.length === 0) return null;

  const label = viewers.length === 1
    ? `${viewers[0].userName} is also viewing this page`
    : `${viewers.length} others are also viewing this page`;

  return (
    <Fade in={viewers.length > 0}>
      <Box
        sx={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          bgcolor: 'background.paper',
          borderRadius: 28,
          pl: 1.5,
          pr: 2,
          py: 0.5,
          boxShadow: 3,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ display: 'flex' }}>
          {viewers.slice(0, 4).map((v, i) => (
            <Tooltip key={v.userId} title={`${v.userName} (${v.userRole})`} arrow>
              <Avatar
                sx={{
                  width: 28,
                  height: 28,
                  fontSize: 11,
                  fontWeight: 600,
                  bgcolor: ROLE_COLORS[v.userRole] ?? stringToColor(v.userName),
                  border: '2px solid',
                  borderColor: 'background.paper',
                  ml: i > 0 ? -1 : 0,
                  zIndex: viewers.length - i,
                }}
              >
                {getInitials(v.userName)}
              </Avatar>
            </Tooltip>
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
          {label}
        </Typography>
      </Box>
    </Fade>
  );
}
