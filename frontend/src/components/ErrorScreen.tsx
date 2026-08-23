import { Box, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { Lottie } from 'lottie-react';
import errorAnimation from '../assets/lottie-error.json';

export type ErrorVariant = '404' | 'offline' | 'generic';

interface Props {
  variant?: ErrorVariant;
  /** Optional custom message; defaults are derived from the variant. */
  message?: string;
  /** Show a "Reload" button instead of "Go Home". Defaults to true for offline. */
  showReload?: boolean;
}

const COPY: Record<ErrorVariant, { title: string; defaultMessage: string }> = {
  '404': {
    title: 'Page Not Found',
    defaultMessage: "The page you're looking for doesn't exist or has been moved.",
  },
  offline: {
    title: "You're Offline",
    defaultMessage: 'Please check your internet connection and try again.',
  },
  generic: {
    title: 'Something Went Wrong',
    defaultMessage: 'An unexpected error occurred. Please try again.',
  },
};

export default function ErrorScreen({
  variant = 'generic',
  message,
  showReload,
}: Props) {
  const navigate = useNavigate();
  const { title, defaultMessage } = COPY[variant];
  const reload = showReload ?? variant === 'offline';

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
      <Box sx={{ width: { xs: 220, sm: 280, md: 320 } }}>
        <Lottie src={errorAnimation} loop autoplay style={{ width: '100%', height: '100%' }} />
      </Box>

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
          <Button variant="contained" size="large" onClick={() => window.location.reload()}>
            Reload
          </Button>
        ) : (
          <Button variant="contained" size="large" onClick={() => navigate('/', { replace: true })}>
            Go Home
          </Button>
        )}
        <Button variant="outlined" size="large" onClick={() => window.history.back()}>
          Go Back
        </Button>
      </Box>
    </Box>
  );
}
