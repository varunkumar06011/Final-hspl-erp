import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Check as CheckIcon, Close as CloseIcon } from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isApproverRole } from '@hospital-erp/shared';
import ResponsiveDialog from '../ResponsiveDialog';
import AttachmentUpload from '../AttachmentUpload';
import api, { extractErrorMessage } from '../../config/api';
import { useAuthStore } from '../../stores/authStore';
import { enumLabel, formatDate, formatIndianNumber, STATUS_COLORS } from '../../utils/enumOptions';

interface EntryItem {
  id: string;
  materialName: string;
  unit: string | null;
  quantity: string | number;
  unitCost: string | number;
}
interface Entry {
  id: string;
  entryNumber: string;
  sourceType: string;
  status: string;
  entryDate: string;
  supplierName: string | null;
  referenceNo: string | null;
  notes: string | null;
  rejectionReason: string | null;
  items: EntryItem[];
  createdByUser: { name: string } | null;
  approvedByUser: { name: string } | null;
}

const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n || 0);

export default function StockEntriesTab() {
  const { t } = useTranslation('inventory');
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canApprove = !!user && isApproverRole(user.role);
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState<Entry | null>(null);
  const [reason, setReason] = useState('');

  const { data, isLoading } = useQuery<Entry[]>({
    queryKey: ['/stock-entries'],
    queryFn: async () => (await api.get('/stock-entries')).data?.data ?? [],
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['/stock-entries'] });
    queryClient.invalidateQueries({ queryKey: ['/inventory/items'] });
    queryClient.invalidateQueries({ queryKey: ['/inventory/transactions'] });
    queryClient.invalidateQueries({ queryKey: ['/inventory/summary'] });
    queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
  };

  const approve = useMutation({
    mutationFn: async (id: string) => api.post(`/stock-entries/${id}/approve`),
    onSuccess: refresh,
    onError: (e: unknown) => setError(extractErrorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: async ({ id, reason: r }: { id: string; reason: string }) => api.post(`/stock-entries/${id}/reject`, { reason: r }),
    onSuccess: () => {
      setRejecting(null);
      setReason('');
      refresh();
    },
    onError: (e: unknown) => setError(extractErrorMessage(e)),
  });

  if (isLoading) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={32} /></Box>;
  const entries = data ?? [];

  return (
    <Box sx={{ p: 2 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {entries.length === 0 ? (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>{t('emptyEntries')}</Typography>
      ) : (
        <Stack spacing={1.5}>
          {entries.map((e) => {
            const total = e.items.reduce((s, i) => s + Number(i.quantity) * Number(i.unitCost), 0);
            return (
              <Card key={e.id} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} flexWrap="wrap" useFlexGap>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography fontWeight={600}>{e.entryNumber} · {enumLabel(e.sourceType)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(e.entryDate)}
                      {e.supplierName ? ` · ${e.supplierName}` : ''}
                      {e.referenceNo ? ` · ${e.referenceNo}` : ''}
                      {e.createdByUser ? ` · ${t('createdBy')}: ${e.createdByUser.name}` : ''}
                      {e.approvedByUser && e.status === 'POSTED' ? ` · ${t('approvedBy')}: ${e.approvedByUser.name}` : ''}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography fontWeight={600}>{inr(total)}</Typography>
                    <Chip size="small" label={enumLabel(e.status)} color={STATUS_COLORS[e.status] ?? 'default'} />
                  </Stack>
                </Stack>
                <Box sx={{ mt: 1 }}>
                  {e.items.map((i) => (
                    <Typography key={i.id} variant="body2" color="text.secondary">
                      {i.materialName} — {formatIndianNumber(Number(i.quantity))} {i.unit ?? ''} @ {inr(Number(i.unitCost))}
                    </Typography>
                  ))}
                  {e.notes && <Typography variant="body2" sx={{ mt: 0.5 }}>{e.notes}</Typography>}
                  {e.status === 'REJECTED' && e.rejectionReason && (
                    <Alert severity="error" sx={{ mt: 1, py: 0 }}>{e.rejectionReason}</Alert>
                  )}
                </Box>
                {e.status === 'PENDING_APPROVAL' && canApprove && (
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <Button size="small" color="success" variant="contained" startIcon={<CheckIcon />} disabled={approve.isPending} onClick={() => approve.mutate(e.id)}>
                      {t('approve')}
                    </Button>
                    <Button size="small" color="error" startIcon={<CloseIcon />} onClick={() => { setRejecting(e); setReason(''); }}>
                      {t('reject')}
                    </Button>
                  </Stack>
                )}
              </Card>
            );
          })}
        </Stack>
      )}

      <ResponsiveDialog open={!!rejecting} onClose={() => setRejecting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('rejectTitle')}</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth multiline rows={3} size="small" sx={{ mt: 1 }} label={t('rejectReason')} value={reason} onChange={(ev) => setReason(ev.target.value)} />
          {rejecting && <Box sx={{ mt: 2 }}><AttachmentUpload entityType="STOCK_ENTRY" entityId={rejecting.id} /></Box>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejecting(null)}>{t('cancel')}</Button>
          <Button color="error" variant="contained" disabled={!reason.trim() || reject.isPending} onClick={() => rejecting && reject.mutate({ id: rejecting.id, reason: reason.trim() })}>
            {t('rejectConfirm')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
