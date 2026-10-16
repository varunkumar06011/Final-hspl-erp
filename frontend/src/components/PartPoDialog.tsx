import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, DialogActions, DialogContent, DialogTitle, MenuItem, TextField } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { POPaymentType } from '@hospital-erp/shared';
import api, { extractErrorMessage } from '../config/api';
import { enumLabel, formatCurrency } from '../utils/enumOptions';
import ResponsiveDialog from './ResponsiveDialog';

const decimalOnly = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');

interface Balance {
  total: number;
  paid: number;
  inSubPos: number;
  remaining: number;
}

/**
 * Raise the next part-payment sub-PO (<PO>-SUB01 ...) of an approved PO. It is approved on its
 * own but adds no budget commitment or vendor payable: the main PO already holds the whole amount.
 */
export function PartPoDialog({ po, onClose }: { po: { id: string; poNumber: string } | null; onClose: () => void }) {
  const { t } = useTranslation('po');
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [paymentType, setPaymentType] = useState<string>(POPaymentType.FULL_PAYMENT);
  const [advance, setAdvance] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const { data: balance } = useQuery<Balance>({
    queryKey: ['part-balance', po?.id],
    queryFn: async () => (await api.get(`/purchase-orders/${po!.id}/part-balance`)).data,
    enabled: !!po,
  });

  useEffect(() => {
    if (po) { setAmount(''); setAdvance(''); setNotes(''); setPaymentType(POPaymentType.FULL_PAYMENT); setError(''); }
  }, [po]);
  useEffect(() => {
    if (balance && po) setAmount(String(balance.remaining));
  }, [balance, po]);

  const value = Number(amount);
  const needsAdvance = paymentType === POPaymentType.ADVANCE;
  const valid = Number.isFinite(value) && value > 0 && !!balance && value <= balance.remaining && (!needsAdvance || (Number(advance) > 0 && Number(advance) <= value));

  const mutation = useMutation({
    mutationFn: async () =>
      (await api.post(`/purchase-orders/${po!.id}/part-pos`, {
        amount: value,
        paymentType,
        advanceAmount: needsAdvance ? Number(advance) : undefined,
        notes: notes.trim() || undefined,
      })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/pos'] });
      queryClient.invalidateQueries({ queryKey: ['part-balance'] });
      onClose();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  return (
    <ResponsiveDialog open={!!po} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('partPoTitle', { n: po?.poNumber })}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Alert severity="info">{t('partPoHelp', { n: po?.poNumber })}</Alert>
          {balance && (
            <Alert severity={balance.remaining > 0 ? 'success' : 'warning'}>
              {t('partPoBalance', {
                total: formatCurrency(balance.total),
                paid: formatCurrency(balance.paid),
                subs: formatCurrency(balance.inSubPos),
                left: formatCurrency(balance.remaining),
              })}
            </Alert>
          )}
          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
          <TextField label={t('partPoAmount')} value={amount} onChange={(e) => setAmount(decimalOnly(e.target.value))} inputProps={{ inputMode: 'decimal' }} fullWidth />
          <TextField select label={t('paymentType')} value={paymentType} onChange={(e) => setPaymentType(e.target.value)} fullWidth>
            {Object.values(POPaymentType).map((p) => <MenuItem key={p} value={p}>{enumLabel(p)}</MenuItem>)}
          </TextField>
          {needsAdvance && (
            <TextField label={t('advanceAmount')} value={advance} onChange={(e) => setAdvance(decimalOnly(e.target.value))} inputProps={{ inputMode: 'decimal' }} fullWidth />
          )}
          <TextField label={t('description')} value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} fullWidth inputProps={{ maxLength: 1000 }} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="contained" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? <CircularProgress size={20} /> : t('partPoCreate')}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
