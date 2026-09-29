import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
  CircularProgress,
  Typography,
  Box,
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { useTranslation } from 'react-i18next';

interface PinConfirmDialogProps {
  open: boolean;
  title?: string;
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Re-authentication gate for sensitive actions (deletes, large payments).
 * Calls /auth/pin-login with the current user's phone + the entered PIN to
 * confirm identity. The existing Firebase token is NOT replaced — this only
 * verifies the user knows the PIN before proceeding with the action.
 */
export default function PinConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: PinConfirmDialogProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setError('');
    if (!pin || pin.length < 4) {
      setError(t('shared.errEnterPin'));
      return;
    }
    if (!user?.phone) {
      setError(t('shared.errNoPhone'));
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/pin-login', { phone: user.phone, pin });
      setPin('');
      onConfirm();
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setPin('');
    setError('');
    onCancel();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LockIcon color="action" />
        {title ?? t('shared.confirmPinTitle')}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Typography variant="body2" color="text.secondary">{message ?? t('shared.confirmPinMessage')}</Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            autoFocus
            fullWidth
            label={t('shared.pin')}
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loading) handleConfirm();
            }}
            inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>{t('shared.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={loading || pin.length < 4}
        >
          {loading ? <CircularProgress size={20} /> : (confirmLabel ?? t('shared.confirm'))}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
