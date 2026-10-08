import { useState } from 'react';
import { Alert, Box, Button, Card, Chip, CircularProgress, DialogActions, DialogContent, DialogTitle, Radio, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import ResponsiveDialog from '../ResponsiveDialog';
import api, { extractErrorMessage } from '../../config/api';
import { formatCurrency, formatIndianNumber } from '../../utils/enumOptions';

interface Candidate {
  id: string;
  name: string;
  sku: string | null;
  materialCode: string | null;
  unit: string;
  itemType: string;
  currentStock: number;
  totalValue: number;
  transactions: number;
}

/** Suggests inventory items that are the same material under different spellings and merges them. */
export default function MergeDuplicatesDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const { t } = useTranslation('inventory');
  const queryClient = useQueryClient();
  const [keep, setKeep] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['/inventory/duplicates'],
    queryFn: async () => (await api.get('/inventory/duplicates')).data.data as Candidate[][],
    enabled: open,
  });
  const groups = data ?? [];

  const merge = useMutation({
    mutationFn: async (v: { sourceId: string; targetId: string }) => (await api.post('/inventory/merge', v)).data,
    onSuccess: (res) => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['/inventory/duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['/inventory'] });
      onDone(t('mergeDone', { from: res.summary.sourceName, to: res.summary.targetName }));
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('mergeTitle')}</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>{t('mergeHelp')}</Alert>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : groups.length === 0 ? (
          <Typography color="text.secondary">{t('mergeNone')}</Typography>
        ) : (
          <Stack spacing={2}>
            {groups.map((group, gi) => {
              const keepId = keep[gi] ?? [...group].sort((a, b) => b.transactions - a.transactions)[0].id;
              return (
                <Card key={group.map((g) => g.id).join('|')} variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">{t('mergeKeepHint')}</Typography>
                  {group.map((item) => (
                    <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', py: 0.5 }}>
                      <Radio size="small" checked={keepId === item.id} onChange={() => setKeep({ ...keep, [gi]: item.id })} />
                      <Box sx={{ flex: 1, minWidth: 200 }}>
                        <Typography sx={{ fontWeight: 600 }}>{item.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {[item.sku, item.materialCode].filter(Boolean).join(' · ') || '—'} · {formatIndianNumber(item.currentStock)} {item.unit} · {formatCurrency(item.totalValue)} · {t('mergeMoves', { n: item.transactions })}
                        </Typography>
                      </Box>
                      {keepId === item.id ? (
                        <Chip size="small" color="success" label={t('mergeKeeping')} />
                      ) : (
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={merge.isPending}
                          onClick={() => {
                            if (window.confirm(t('mergeConfirm', { from: item.name, to: group.find((g) => g.id === keepId)?.name ?? '' }))) {
                              merge.mutate({ sourceId: item.id, targetId: keepId });
                            }
                          }}
                        >
                          {t('mergeInto')}
                        </Button>
                      )}
                    </Box>
                  ))}
                </Card>
              );
            })}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('close')}</Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
