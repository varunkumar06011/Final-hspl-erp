import { Alert, AlertTitle, Button, Slide } from '@mui/material';
import { useNetworkStore } from '../stores/networkStore';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useTranslation } from 'react-i18next';

/**
 * Inline banner shown when an API request failed due to a network error.
 * Dismissed automatically once connectivity is restored, or manually by the user.
 */
export default function OfflineBanner() {
  const { t } = useTranslation('misc');
  const apiNetworkError = useNetworkStore((s) => s.apiNetworkError);
  const clearApiNetworkError = useNetworkStore((s) => s.clearApiNetworkError);
  const online = useOnlineStatus();

  // Auto-clear once the browser reports we're back online.
  if (online && apiNetworkError) {
    clearApiNetworkError();
  }

  if (!apiNetworkError) return null;

  return (
    <Slide direction="down" in={apiNetworkError} mountOnEnter unmountOnExit>
      <Alert
        severity="warning"
        sx={{
          position: 'fixed',
          top: 'calc(16px + env(safe-area-inset-top))',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 2000,
          maxWidth: { xs: 'calc(100vw - 32px)', sm: 480 },
          boxShadow: 3,
        }}
        action={
          <Button color="inherit" size="small" onClick={clearApiNetworkError}>
            {t('offline.dismiss')}
          </Button>
        }
      >
        <AlertTitle>{t('offline.title')}</AlertTitle>
        {t('offline.message')}
      </Alert>
    </Slide>
  );
}
