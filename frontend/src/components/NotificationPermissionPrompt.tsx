import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Alert,
  Snackbar,
  Typography,
  CircularProgress,
} from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import {
  isPushSupported,
  getPermissionState,
  enableNotifications,
  disableNotifications,
  getSubscriptionStatus,
  type NotificationPermissionState,
} from '../config/notifications';

import { useTranslation } from 'react-i18next';
export default function NotificationPermissionPrompt() {
  const { t } = useTranslation('widgets');
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermissionState>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'info',
  });

  const refreshStatus = useCallback(async () => {
    const isSupported = await isPushSupported();
    setSupported(isSupported);
    setPermission(getPermissionState());

    if (isSupported) {
      const status = await getSubscriptionStatus();
      setSubscribed(status.enabled);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleEnable = async () => {
    setLoading(true);
    const result = await enableNotifications();
    setLoading(false);

    if (result.success) {
      setSubscribed(true);
      setPermission('granted');
      setSnack({ open: true, message: t('npOn'), severity: 'success' });
    } else {
      setSnack({ open: true, message: result.error || t('npOnFail'), severity: 'error' });
      setPermission(getPermissionState());
    }
  };

  const handleDisable = async () => {
    setLoading(true);
    const result = await disableNotifications();
    setLoading(false);

    if (result.success) {
      setSubscribed(false);
      setSnack({ open: true, message: t('npOff'), severity: 'info' });
    } else {
      setSnack({ open: true, message: result.error || t('npOffFail'), severity: 'error' });
    }
  };

  if (!supported) {
    return (
      <Alert severity="warning" icon={<NotificationsOffIcon />}>
        <Typography variant="body2">
          {t('npUnsupported')}
        </Typography>
      </Alert>
    );
  }

  if (permission === 'denied') {
    return (
      <Alert severity="error" icon={<NotificationsOffIcon />}>
        <Typography variant="body2">
          {t('npDenied')}
        </Typography>
      </Alert>
    );
  }

  if (subscribed && permission === 'granted') {
    return (
      <Box>
        <Alert severity="success" icon={<NotificationsActiveIcon />} sx={{ mb: 1 }}>
          <Typography variant="body2">
            {t('npEnabled')}
          </Typography>
        </Alert>
        <Button
          variant="outlined"
          color="error"
          size="small"
          onClick={handleDisable}
          disabled={loading}
          sx={{ mt: 1 }}
        >
          {loading ? <CircularProgress size={20} /> : t('npDisable')}
        </Button>
        <Snackbar
          open={snack.open}
          autoHideDuration={4000}
          onClose={() => setSnack({ ...snack, open: false })}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert
            severity={snack.severity}
            onClose={() => setSnack({ ...snack, open: false })}
          >
            {snack.message}
          </Alert>
        </Snackbar>
      </Box>
    );
  }

  return (
    <Box>
      <Alert severity="info" icon={<NotificationsActiveIcon />} sx={{ mb: 1 }}>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {t('npPrompt')}
        </Typography>
      </Alert>
      <Button
        variant="contained"
        color="primary"
        onClick={handleEnable}
        disabled={loading}
        startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <NotificationsActiveIcon />}
        sx={{ mt: 1 }}
      >
        {t('npEnable')}
      </Button>
      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack({ ...snack, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snack.severity}
          onClose={() => setSnack({ ...snack, open: false })}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
