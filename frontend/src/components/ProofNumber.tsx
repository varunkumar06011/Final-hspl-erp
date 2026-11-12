import { useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, DialogActions, DialogContent, DialogTitle, IconButton,
  TextField, Tooltip, Typography,
} from '@mui/material';
import { ContentCopy as CopyIcon, ConfirmationNumber as ProofIcon } from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from './ResponsiveDialog';
import { formatDate } from '../utils/enumOptions';

/** Records a proof number can be issued for (the number belongs to the record's whole purchase chain). */
export type ProofEntityType = 'MATERIAL_PURCHASE_REQUEST' | 'QUOTATION' | 'PURCHASE_ORDER' | 'GATE_PASS' | 'GOODS_RECEIPT' | 'VENDOR_INVOICE';
export interface ProofEntity { entityType: ProofEntityType; entityId: string }

interface ProofRow {
  id: string;
  number: string;
  issuedAt: string;
  issuedByName: string | null;
  usedAt: string | null;
}

/** Request header the server reads to tie an upload to a proof number. */
export const proofHeaders = (number?: string | null): Record<string, string> => (number?.trim() ? { 'x-proof-number': number.trim() } : {});

function useChainProofs(entity: ProofEntity | null, enabled = true) {
  return useQuery({
    queryKey: ['/proof-numbers', entity?.entityType ?? 'SITE_BILL', entity?.entityId ?? ''],
    enabled,
    queryFn: async (): Promise<{ items: ProofRow[]; base?: { baseNumber: string } | null }> =>
      (await api.get(entity ? '/proof-numbers' : '/proof-numbers/site-bill', { params: entity ?? undefined })).data,
  });
}

function useIssue(entity: ProofEntity | null, onIssued?: (row: ProofRow) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<ProofRow> => (await api.post(entity ? '/proof-numbers' : '/proof-numbers/site-bill', entity ?? {})).data,
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['/proof-numbers'] });
      onIssued?.(row);
    },
  });
}

/** Big, copyable number plus the instruction to write it on the paper. */
function NumberCard({ number }: { number: string }) {
  const { t } = useTranslation('proofs');
  const [copied, setCopied] = useState(false);
  return (
    <Box sx={{ textAlign: 'center', p: 2, my: 1, border: '2px dashed', borderColor: 'primary.main', borderRadius: 2, bgcolor: 'action.hover' }}>
      <Typography variant="caption" color="text.secondary">{t('writeOnPaper')}</Typography>
      <Typography sx={{ fontFamily: 'monospace', fontWeight: 800, fontSize: { xs: 26, sm: 32 }, letterSpacing: 1, wordBreak: 'break-all' }}>{number}</Typography>
      <Tooltip title={copied ? t('copied') : t('copy')}>
        <IconButton
          size="small"
          onClick={() => {
            navigator.clipboard?.writeText(number).then(() => setCopied(true)).catch(() => { /* clipboard blocked */ });
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          <CopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/** "Get proof number" on a request / quotation / PO / gate pass: issues the next number of its chain. */
export function ProofNumberButton({ entity, size = 'small', variant = 'text' }: { entity: ProofEntity; size?: 'small' | 'medium'; variant?: 'text' | 'outlined' | 'contained' }) {
  const { t } = useTranslation('proofs');
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState('');
  const list = useChainProofs(entity, open);
  const issue = useIssue(entity, (row) => setIssued(row.number));

  return (
    <>
      <Button size={size} variant={variant} startIcon={<ProofIcon />} onClick={() => { setOpen(true); setIssued(null); setError(''); }}>
        {t('getProof')}
      </Button>
      <ResponsiveDialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('proofTitle')}</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}
          {issued ? (
            <NumberCard number={issued} />
          ) : (
            <Typography variant="body2" color="text.secondary">{t('proofIntro')}</Typography>
          )}
          {(list.data?.items.length ?? 0) > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary">{t('alreadyIssued', { n: list.data?.base?.baseNumber ?? '' })}</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.5 }}>
                {list.data!.items.map((p) => (
                  <Box key={p.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{p.number}</Typography>
                    <Chip size="small" color={p.usedAt ? 'success' : 'warning'} variant="outlined" label={p.usedAt ? t('usedOn', { d: formatDate(p.usedAt) }) : t('notUsed')} />
                    <Typography variant="caption" color="text.secondary">{p.issuedByName ?? ''} · {formatDate(p.issuedAt)}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('close')}</Button>
          <Button
            variant="contained"
            disabled={issue.isPending}
            onClick={() => { setError(''); issue.mutate(undefined, { onError: (e) => setError(extractErrorMessage(e)) }); }}
          >
            {issue.isPending ? <CircularProgress size={18} /> : issued ? t('getAnother') : t('getProof')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </>
  );
}

/**
 * Field for the number written on the paper being uploaded. Pick one issued earlier, type it,
 * or press "Get proof number" to issue one right here. Without `entity` it works on the
 * project's site-bill series.
 */
export function ProofNumberField({
  entity,
  value,
  onChange,
  required,
  disabled,
}: {
  entity?: ProofEntity;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation('proofs');
  const list = useChainProofs(entity ?? null);
  const [error, setError] = useState('');
  const issue = useIssue(entity ?? null, (row) => onChange(row.number));
  const options = (list.data?.items ?? []).filter((p) => !p.usedAt).map((p) => p.number);

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <Autocomplete
          freeSolo
          fullWidth
          size="small"
          disabled={disabled}
          options={options}
          inputValue={value}
          onInputChange={(_e, v) => onChange(v.toUpperCase())}
          renderInput={(params) => <TextField {...params} required={required} label={t('fieldLabel')} helperText={t('fieldHelp')} />}
        />
        <Button
          variant="outlined"
          sx={{ whiteSpace: 'nowrap', mt: 0.25 }}
          startIcon={issue.isPending ? <CircularProgress size={16} /> : <ProofIcon />}
          disabled={disabled || issue.isPending}
          onClick={() => { setError(''); issue.mutate(undefined, { onError: (e) => setError(extractErrorMessage(e)) }); }}
        >
          {t('getProof')}
        </Button>
      </Box>
      {value && issue.data?.number === value && <NumberCard number={value} />}
      {error && <Typography variant="caption" color="error">{error}</Typography>}
    </Box>
  );
}
