import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from './ResponsiveDialog';

const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 6);

function PinField({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <TextField
      label={label}
      value={value}
      onChange={(e) => onChange(digitsOnly(e.target.value))}
      type="password"
      autoFocus={autoFocus}
      fullWidth
      size="small"
      autoComplete="off"
      inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', maxLength: 6, style: { letterSpacing: '0.4em' } }}
    />
  );
}

/** Asks for a 6-digit PIN; `onSubmit` throws (or rejects) to show an error and keep the dialog open. */
export function PinPromptDialog({
  open,
  title,
  helper,
  submitLabel,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  helper?: string;
  submitLabel: string;
  onSubmit: (pin: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation('documents');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPin('');
      setError('');
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    if (pin.length !== 6) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit(pin);
    } catch (err) {
      setError(extractErrorMessage(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {helper && <Typography variant="body2" color="text.secondary">{helper}</Typography>}
          {error && <Alert severity="error">{error}</Alert>}
          <Box component="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <PinField label={t('pinLabel')} value={pin} onChange={setPin} autoFocus />
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="contained" disabled={pin.length !== 6 || busy} onClick={() => void submit()}>
          {busy ? <CircularProgress size={20} /> : submitLabel}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

/** Set, change or reset the signed-in user's document PIN. */
export function DocumentPinSettingsDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: () => void }) {
  const { t } = useTranslation('documents');
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['/documents/pin/status'],
    queryFn: async () => (await api.get('/documents/pin/status')).data as { hasPin: boolean },
    enabled: open,
  });
  const hasPin = !!data?.hasPin;
  const [mode, setMode] = useState<'current' | 'login'>('current');
  const [current, setCurrent] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMode('current');
      setCurrent('');
      setNewPin('');
      setConfirm('');
      setError('');
      setBusy(false);
    }
  }, [open]);

  const mismatch = confirm.length === 6 && confirm !== newPin;
  const ready = newPin.length === 6 && confirm === newPin && (!hasPin || current.length === 6);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/documents/pin', {
        pin: newPin,
        ...(hasPin ? (mode === 'current' ? { currentPin: current } : { loginPin: current }) : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ['/documents/pin/status'] });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{hasPin ? t('pinChangeTitle') : t('pinSetTitle')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Alert severity="info">{t('pinExplain')}</Alert>
          {error && <Alert severity="error">{error}</Alert>}
          {hasPin && (
            <>
              <PinField label={mode === 'current' ? t('pinCurrent') : t('pinLogin')} value={current} onChange={setCurrent} autoFocus />
              <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => { setMode(mode === 'current' ? 'login' : 'current'); setCurrent(''); }}>
                {mode === 'current' ? t('pinForgot') : t('pinUseCurrent')}
              </Button>
            </>
          )}
          <PinField label={t('pinNew')} value={newPin} onChange={setNewPin} autoFocus={!hasPin} />
          <PinField label={t('pinConfirm')} value={confirm} onChange={setConfirm} />
          {mismatch && <Typography variant="caption" color="error">{t('pinMismatch')}</Typography>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="contained" disabled={!ready || busy} onClick={() => void save()}>
          {busy ? <CircularProgress size={20} /> : t('pinSave')}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
