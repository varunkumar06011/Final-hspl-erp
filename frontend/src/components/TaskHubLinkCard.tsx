import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api, { extractErrorMessage } from '../config/api';

/**
 * Settings card for approvers: makes a one-time 6-digit code that they type into
 * Task Hub (Approvals → Connect Hospital ERP) so their ERP approvals show there.
 */
export default function TaskHubLinkCard() {
  const { t } = useTranslation('settings');
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [code]);

  const makeCode = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/integrations/taskhub/link-code');
      setCode({ code: res.data.code, expiresAt: new Date(res.data.expiresAt).getTime() });
      setNow(Date.now());
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const secondsLeft = code ? Math.max(0, Math.round((code.expiresAt - now) / 1000)) : 0;
  const live = code && secondsLeft > 0;
  const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>{t('taskHubTitle')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('taskHubBody')}</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {live && (
          <Box sx={{ mb: 2 }}>
            <Typography
              variant="h4"
              sx={{ fontFamily: 'monospace', letterSpacing: '0.3em', fontWeight: 700 }}
              aria-label={t('taskHubCodeLabel')}
            >
              {code.code}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('taskHubCodeHint', { time: clock })}
            </Typography>
          </Box>
        )}
        {code && !live && <Alert severity="info" sx={{ mb: 2 }}>{t('taskHubCodeExpired')}</Alert>}
        <Button variant="outlined" onClick={makeCode} disabled={loading} startIcon={loading ? <CircularProgress size={16} /> : undefined}>
          {code ? t('taskHubNewCode') : t('taskHubGetCode')}
        </Button>
      </CardContent>
    </Card>
  );
}
