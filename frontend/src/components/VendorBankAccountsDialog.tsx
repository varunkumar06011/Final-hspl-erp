import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Delete as DeleteIcon, Edit as EditIcon, Star as PrimaryIcon, StarBorder as MakePrimaryIcon } from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { IFSC_PATTERN } from '@hospital-erp/shared';
import ResponsiveDialog from './ResponsiveDialog';
import api, { extractErrorMessage } from '../config/api';
import type { SavedBankAccount } from './PaymentMethodFields';

interface Draft {
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  makePrimary: boolean;
}
const emptyDraft = (): Draft => ({ bankName: '', accountHolderName: '', accountNumber: '', ifscCode: '', makePrimary: false });

/**
 * A vendor's bank accounts: list, add, edit, make primary, remove. The primary account is the one
 * shown on the vendor and used when a request does not pick an account.
 */
export default function VendorBankAccountsDialog({
  vendorId,
  vendorName,
  open,
  onClose,
  canEdit,
}: {
  vendorId: string | null;
  vendorName?: string;
  open: boolean;
  onClose: () => void;
  canEdit: boolean;
}) {
  const { t } = useTranslation('vendors');
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setDraft(emptyDraft()); setEditingId(null); setError(''); }
  }, [open, vendorId]);

  const listKey = ['/vendors', vendorId, 'bank-accounts'];
  const { data, isLoading } = useQuery({
    queryKey: listKey,
    enabled: open && !!vendorId,
    queryFn: async () => (await api.get<SavedBankAccount[]>(`/vendors/${vendorId}/bank-accounts`)).data,
  });
  const accounts = data ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: listKey });
    queryClient.invalidateQueries({ queryKey: ['/vendors'] });
    queryClient.invalidateQueries({ queryKey: ['/material-purchase-requests'] });
  };
  const fail = (err: unknown) => setError(extractErrorMessage(err));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        bankName: draft.bankName.trim() || undefined,
        accountHolderName: draft.accountHolderName.trim() || undefined,
        accountNumber: draft.accountNumber.trim(),
        ifscCode: draft.ifscCode.trim().toUpperCase(),
        makePrimary: draft.makePrimary || undefined,
      };
      if (editingId) return (await api.patch(`/vendors/${vendorId}/bank-accounts/${editingId}`, body)).data;
      return (await api.post(`/vendors/${vendorId}/bank-accounts`, body)).data;
    },
    onSuccess: () => { setDraft(emptyDraft()); setEditingId(null); setError(''); refresh(); },
    onError: fail,
  });

  const primaryMutation = useMutation({
    mutationFn: async (id: string) => (await api.patch(`/vendors/${vendorId}/bank-accounts/${id}`, { makePrimary: true })).data,
    onSuccess: () => { setError(''); refresh(); },
    onError: fail,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/vendors/${vendorId}/bank-accounts/${id}`)).data,
    onSuccess: () => { setError(''); refresh(); },
    onError: fail,
  });

  const startEdit = (a: SavedBankAccount) => {
    setEditingId(a.id);
    setDraft({
      bankName: a.bankName ?? '',
      accountHolderName: a.accountHolderName ?? '',
      accountNumber: a.accountNumber,
      ifscCode: a.ifscCode,
      makePrimary: a.isPrimary,
    });
  };

  const numberOk = /^[0-9]{6,20}$/.test(draft.accountNumber.trim());
  const ifscOk = IFSC_PATTERN.test(draft.ifscCode.trim().toUpperCase());
  const busy = saveMutation.isPending || primaryMutation.isPending || deleteMutation.isPending;

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('bankAccountsTitle', { name: vendorName ?? '' })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">{t('bankAccountsHelp')}</Typography>
          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

          {isLoading && <CircularProgress size={22} />}
          {!isLoading && accounts.length === 0 && (
            <Alert severity="info">{t('noBankAccounts')}</Alert>
          )}

          {accounts.map((a) => (
            <Box
              key={a.id}
              sx={{ border: '1px solid', borderColor: a.isPrimary ? 'primary.main' : 'divider', borderRadius: 1, p: 1.5 }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle2">
                    {a.bankName || '—'}
                    {a.isPrimary && <Chip size="small" color="primary" label={t('primaryTag')} sx={{ ml: 1 }} />}
                  </Typography>
                  <Typography variant="body2">{a.accountHolderName || '—'}</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {a.accountNumber} · {a.ifscCode}
                  </Typography>
                </Box>
                {canEdit && (
                  <Stack direction="row" spacing={0.5}>
                    {!a.isPrimary && (
                      <Tooltip title={t('makePrimary')}>
                        <span>
                          <IconButton size="small" disabled={busy} onClick={() => primaryMutation.mutate(a.id)} aria-label={t('makePrimary')}>
                            <MakePrimaryIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                    {a.isPrimary && <PrimaryIcon fontSize="small" color="primary" sx={{ alignSelf: 'center', mx: 0.5 }} />}
                    <Tooltip title={t('editBankAccount')}>
                      <span>
                        <IconButton size="small" disabled={busy} onClick={() => startEdit(a)} aria-label={t('editBankAccount')}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={t('removeBankAccount')}>
                      <span>
                        <IconButton size="small" color="error" disabled={busy || a.isPrimary && accounts.length === 1} onClick={() => deleteMutation.mutate(a.id)} aria-label={t('removeBankAccount')}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                )}
              </Stack>
            </Box>
          ))}

          {canEdit && (
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {editingId ? t('editBankAccount') : t('addBankAccount')}
              </Typography>
              <Stack spacing={1.5}>
                <TextField size="small" fullWidth label={t('bankName')} value={draft.bankName} onChange={(e) => setDraft({ ...draft, bankName: e.target.value })} />
                <TextField size="small" fullWidth label={t('accountHolderName')} value={draft.accountHolderName} onChange={(e) => setDraft({ ...draft, accountHolderName: e.target.value })} />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <TextField
                    size="small" fullWidth required label={t('accountNumber')}
                    value={draft.accountNumber}
                    onChange={(e) => setDraft({ ...draft, accountNumber: e.target.value.replace(/\D/g, '').slice(0, 20) })}
                    inputProps={{ inputMode: 'numeric' }}
                    error={!!draft.accountNumber && !numberOk}
                    helperText={!!draft.accountNumber && !numberOk ? t('bankAccountErrNumber') : undefined}
                  />
                  <TextField
                    size="small" fullWidth required label={t('ifsc')}
                    value={draft.ifscCode}
                    onChange={(e) => setDraft({ ...draft, ifscCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11) })}
                    error={!!draft.ifscCode && !ifscOk}
                    helperText={!!draft.ifscCode && !ifscOk ? t('bankAccountErrIfsc') : undefined}
                  />
                </Stack>
                <FormControlLabel
                  control={<Checkbox size="small" checked={draft.makePrimary} onChange={(e) => setDraft({ ...draft, makePrimary: e.target.checked })} />}
                  label={t('makePrimaryOnSave')}
                />
              </Stack>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {editingId && (
          <Button onClick={() => { setEditingId(null); setDraft(emptyDraft()); }}>{t('cancel')}</Button>
        )}
        <Button onClick={onClose}>{t('close')}</Button>
        {canEdit && (
          <Button
            variant="contained"
            disabled={!numberOk || !ifscOk || busy}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? <CircularProgress size={20} /> : editingId ? t('saveBankAccount') : t('addBankAccount')}
          </Button>
        )}
      </DialogActions>
    </ResponsiveDialog>
  );
}
