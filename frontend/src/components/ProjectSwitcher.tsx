import { useState } from 'react';
import { Chip, CircularProgress, Menu, MenuItem, ListItemText, Snackbar, Alert } from '@mui/material';
import { Business as ProjectIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { useSwitchProject } from '../hooks/useSwitchProject';

interface ProjectRow {
  id: string;
  code: string;
  name: string;
}

/**
 * Top-bar chip showing the project the user is working in. With more than one
 * project it opens a menu to move to another one (same login, different project).
 */
export default function ProjectSwitcher() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { switchTo, switching, error, clearError } = useSwitchProject();

  const { data } = useQuery({
    queryKey: ['/projects'],
    queryFn: async () => (await api.get('/projects')).data,
    staleTime: 5 * 60_000,
  });
  const projects: ProjectRow[] = data?.data ?? [];
  const current = projects.find((p) => p.id === user?.projectId);
  if (!current) return null;

  const canSwitch = projects.length > 1;

  return (
    <>
      <Chip
        icon={switching ? <CircularProgress size={14} color="inherit" /> : <ProjectIcon fontSize="small" />}
        label={current.name}
        size="small"
        onClick={canSwitch ? (e) => setAnchor(e.currentTarget) : undefined}
        disabled={switching}
        title={t('shell.project')}
        sx={{
          mr: 1,
          maxWidth: { xs: 120, sm: 220 },
          bgcolor: 'rgba(255,255,255,0.18)',
          color: 'inherit',
          fontWeight: 600,
          '& .MuiChip-icon': { color: 'inherit' },
          cursor: canSwitch ? 'pointer' : 'default',
        }}
      />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {projects.map((p) => (
          <MenuItem
            key={p.id}
            selected={p.id === current.id}
            onClick={() => {
              setAnchor(null);
              if (p.id !== current.id) void switchTo(p.id);
            }}
          >
            <ListItemText primary={p.name} secondary={p.code} />
          </MenuItem>
        ))}
      </Menu>
      <Snackbar open={!!error} autoHideDuration={6000} onClose={clearError}>
        <Alert severity="error" onClose={clearError}>
          {t('shell.switchFailed')}
        </Alert>
      </Snackbar>
    </>
  );
}
