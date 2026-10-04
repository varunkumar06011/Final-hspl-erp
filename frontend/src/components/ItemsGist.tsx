import { Box, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatIndianNumber } from '../utils/enumOptions';

export interface GistItem {
  id?: string;
  materialName: string;
  quantity: number | string;
  unit?: string | null;
  /** PO / quotation use unitPrice, a material request uses estimatedRate */
  unitPrice?: number | string | null;
  estimatedRate?: number | string | null;
  /** pre-GST line amount; derived from quantity x rate when absent */
  amount?: number | string | null;
  gstRate?: number | string | null;
}

/**
 * Excel-style gist of a document's lines (material, qty, rate, amount) so a list
 * shows what is being bought and for how much without opening each record.
 */
export default function ItemsGist({ items, max = 4 }: { items?: GistItem[] | null; max?: number }) {
  const { t } = useTranslation('po');
  if (!items || items.length === 0) return null;
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const cell = { py: 0.25, px: 0.75, fontSize: '0.74rem', borderColor: 'divider', whiteSpace: 'nowrap' } as const;
  return (
    <Box sx={{ width: '100%', mt: 0.5, overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 0.5 }}>
      <Table size="small" sx={{ minWidth: 280 }}>
        <TableHead>
          <TableRow sx={{ bgcolor: 'action.hover' }}>
            <TableCell sx={{ ...cell, fontWeight: 700 }}>{t('material')}</TableCell>
            <TableCell sx={{ ...cell, fontWeight: 700 }} align="right">{t('qty')}</TableCell>
            <TableCell sx={{ ...cell, fontWeight: 700 }} align="right">{t('unitPrice')}</TableCell>
            <TableCell sx={{ ...cell, fontWeight: 700 }} align="right">{t('amountInc')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {shown.map((it, i) => {
            const rate = Number(it.unitPrice ?? it.estimatedRate ?? 0);
            const base = it.amount != null ? Number(it.amount) : Number(it.quantity) * rate;
            return (
              <TableRow key={it.id ?? i}>
                <TableCell sx={{ ...cell, whiteSpace: 'normal', minWidth: 120 }}>{it.materialName}</TableCell>
                <TableCell sx={cell} align="right">{formatIndianNumber(Number(it.quantity))} {it.unit ?? ''}</TableCell>
                <TableCell sx={cell} align="right">{formatCurrency(rate)}</TableCell>
                <TableCell sx={cell} align="right">{formatCurrency(base * (1 + Number(it.gstRate ?? 0) / 100))}</TableCell>
              </TableRow>
            );
          })}
          {rest > 0 && (
            <TableRow>
              <TableCell colSpan={4} sx={{ ...cell, color: 'text.secondary' }}>{t('moreItems', { n: rest })}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Box>
  );
}
