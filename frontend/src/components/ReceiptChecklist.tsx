import { Alert, Box, CircularProgress, List, ListItem, ListItemIcon, ListItemText, Typography } from '@mui/material';
import { CheckCircle, RadioButtonUnchecked, RemoveCircleOutline } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../config/api';

export interface ChecklistItem {
  key: 'request' | 'quotation' | 'vendorPath' | 'po' | 'gatePass' | 'proof' | 'inspection' | 'items';
  state: 'OK' | 'MISSING' | 'NOT_NEEDED';
  ref?: string | null;
  reason?: string;
}

export interface ReceiptChecklistData {
  complete: boolean;
  items: ChecklistItem[];
}

export const receiptChecklistKey = (receiptId: string) => [`/goods-receipts/${receiptId}/checklist`];

/** The final checklist of a goods receipt (computed by the server from the whole chain). */
export function useReceiptChecklist(receiptId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: receiptChecklistKey(receiptId ?? ''),
    queryFn: async () => (await api.get(`/goods-receipts/${receiptId}/checklist`)).data as ReceiptChecklistData,
    enabled: !!receiptId && enabled,
    staleTime: 10_000,
  });
}

/**
 * "Final checklist" shown on a goods receipt before it is posted to inventory: request,
 * quotation, vendor / non-vendor path, PO, gate pass, photo proof, inspection and item
 * links, each ticked automatically. Posting stays disabled until every box is ticked.
 */
export default function ReceiptChecklist({ receiptId, data: given }: { receiptId: string; data?: ReceiptChecklistData | null }) {
  const { t } = useTranslation('catalog');
  const query = useReceiptChecklist(receiptId, !given);
  const data = given ?? query.data;

  if (!data) {
    return query.isLoading ? <CircularProgress size={18} /> : null;
  }
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('checklistTitle')}</Typography>
      {data.complete ? (
        <Alert severity="success" sx={{ py: 0 }}>{t('checklistComplete')}</Alert>
      ) : (
        <Alert severity="warning" sx={{ py: 0 }}>{t('checklistIncomplete')}</Alert>
      )}
      <List dense disablePadding>
        {data.items.map((item) => (
          <ListItem key={item.key} disableGutters sx={{ py: 0 }}>
            <ListItemIcon sx={{ minWidth: 30 }}>
              {item.state === 'OK' ? (
                <CheckCircle color="success" fontSize="small" />
              ) : item.state === 'NOT_NEEDED' ? (
                <RemoveCircleOutline color="disabled" fontSize="small" />
              ) : (
                <RadioButtonUnchecked color="error" fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText
              primary={t(`check.${item.key}`)}
              secondary={
                item.state === 'MISSING'
                  ? t(`reason.${item.reason ?? 'UNKNOWN'}`, { ref: item.ref ?? '' })
                  : item.state === 'NOT_NEEDED'
                    ? t(`reason.${item.reason ?? 'UNKNOWN'}`, { ref: '' })
                    : item.ref ?? undefined
              }
              primaryTypographyProps={{ variant: 'body2' }}
              secondaryTypographyProps={{ variant: 'caption', color: item.state === 'MISSING' ? 'error' : 'text.secondary' }}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
