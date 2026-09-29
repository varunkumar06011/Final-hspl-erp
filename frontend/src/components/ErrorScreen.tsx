import { useEffect, useRef, useState } from 'react';
import { Box, Typography, Button, Alert } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export type ErrorVariant = '404' | 'offline' | 'generic';

interface Props {
  variant?: ErrorVariant;
  /** Optional custom message; defaults are derived from the variant. */
  message?: string;
  /** Show a "Reload" button instead of "Go Home". Defaults to true for offline. */
  showReload?: boolean;
}

// lottie-web (~300KB) and the animation JSON are separate lazy chunks. If they
// are first requested while offline the fetch fails and the animation never
// shows, so App warms them while online; once loaded, import() resolves from
// the module map with no network.
const loadAnimation = () =>
  Promise.all([import('lottie-web'), import('../assets/lottie-error.json')]);

export function preloadErrorAnimation() {
  loadAnimation().catch(() => undefined);
}

const COPY_KEYS: Record<ErrorVariant, { title: string; message: string }> = {
  '404': { title: 'error.notFoundTitle', message: 'error.notFoundMsg' },
  offline: { title: 'error.offlineTitle', message: 'error.offlineMsg' },
  generic: { title: 'error.genericTitle', message: 'error.genericMsg' },
};

export default function ErrorScreen({
  variant = 'generic',
  message,
  showReload,
}: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation('misc');
  const containerRef = useRef<HTMLDivElement>(null);
  const [stillOffline, setStillOffline] = useState(false);
  const title = t(COPY_KEYS[variant].title);
  const defaultMessage = t(COPY_KEYS[variant].message);
  const reload = showReload ?? variant === 'offline';

  const handleReload = () => {
    if (navigator.onLine) {
      window.location.reload();
    } else {
      setStillOffline(true);
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    let anim: { destroy: () => void } | undefined;
    let cancelled = false;
    loadAnimation()
      .then(([{ default: lottie }, { default: animationData }]) => {
        if (cancelled || !containerRef.current) return;
        anim = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          animationData,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      anim?.destroy();
    };
  }, []);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        p: 3,
        background: 'linear-gradient(135deg, #E3F2FD 0%, #BBDEFB 100%)',
      }}
    >
      <Box
        ref={containerRef}
        sx={{ width: { xs: 220, sm: 280, md: 320 }, height: { xs: 220, sm: 280, md: 320 } }}
      />

      <Typography variant="h4" fontWeight={700} align="center">
        {variant === '404' ? '404' : title}
      </Typography>
      {variant === '404' && (
        <Typography variant="h6" color="text.secondary" align="center">
          {title}
        </Typography>
      )}
      <Typography variant="body1" color="text.secondary" align="center" sx={{ maxWidth: 420 }}>
        {message ?? defaultMessage}
      </Typography>

      <Box sx={{ display: 'flex', gap: 1.5, mt: 2 }}>
        {reload ? (
          <Button variant="contained" size="large" onClick={handleReload}>
            {t('error.reload')}
          </Button>
        ) : (
          <Button variant="contained" size="large" onClick={() => navigate('/', { replace: true })}>
            {t('error.goHome')}
          </Button>
        )}
      </Box>

      {stillOffline && (
        <Alert severity="info" sx={{ mt: 2, maxWidth: 420 }} onClose={() => setStillOffline(false)}>
          {t('error.stillOffline')}
        </Alert>
      )}
    </Box>
  );
}
