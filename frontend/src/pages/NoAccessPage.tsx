import { Navigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { Lock as LockIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/authStore';
import { firstModulePath } from '../utils/moduleAccess';

/** Shown when an admin has switched off every module for this user. */
export default function NoAccessPage() {
  const { t } = useTranslation('access');
  const user = useAuthStore((s) => s.user);
  // Access may come back while this page is open (the session profile refreshes).
  const home = firstModulePath(user);
  if (home) return <Navigate to={home} replace />;

  return (
    <Box sx={{ textAlign: 'center', py: 10, px: 2 }}>
      <LockIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
      <Typography variant="h6" gutterBottom>{t('noAccessTitle')}</Typography>
      <Typography variant="body2" color="text.secondary">{t('noAccessBody')}</Typography>
    </Box>
  );
}
