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
  title = 'Confirm your PIN',
  message = 'For security, please enter your PIN to confirm this action.',
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: PinConfirmDialogProps) {
  const user = useAuthStore((s) => s.user);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setError('');
    if (!pin || pin.length < 4) {
      setError('Please enter your PIN');
      return;
    }
    if (!user?.phone) {
      setError('Unable to verify identity — no phone on file');
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
        {title}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Typography variant="body2" color="text.secondary">{message}</Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            autoFocus
            fullWidth
            label="PIN"
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
        <Button onClick={handleClose} disabled={loading}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={loading || pin.length < 4}
        >
          {loading ? <CircularProgress size={20} /> : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
