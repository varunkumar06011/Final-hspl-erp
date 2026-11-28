import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AssetStatus, InventoryItemType, fuzzyFilter } from '@hospital-erp/shared';
import ResponsiveDialog from '../ResponsiveDialog';
import ResponsiveTable from '../ResponsiveTable';
import api, { extractErrorMessage } from '../../config/api';
import { enumLabel, formatCurrency, formatIndianNumber } from '../../utils/enumOptions';

/** Which summary card was clicked. */
export type InventoryListKind = 'all' | 'low' | 'assets' | 'consumables';

interface Item {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  itemType: string;
  currentStock: string | number;
  minStockLevel: string | number;
  totalValue: string | number;
  location: string | null;
}

interface AssetRow {
  id: string;
  assetId: string;
  status: string;
  location: string | null;
  inventoryItem: { id: string; name: string } | null;
}

/** Every page of a list endpoint, so the dialog shows all records, not just the first page. */
async function fetchAll<T>(url: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const res = (await api.get(url, { params: { page, pageSize: 500 } })).data as { data: T[]; pagination?: { totalPages: number } };
    out.push(...res.data);
    if (page >= (res.pagination?.totalPages ?? 1)) return out;
  }
}

const isLow = (i: Item) => Number(i.minStockLevel) > 0 && Number(i.currentStock) <= Number(i.minStockLevel);
const isOut = (i: Item) => Number(i.currentStock) <= 0;

/** The real records behind a summary card: items, low / out of stock items, asset units or consumables. */
export default function InventoryListDialog({ kind, onClose }: { kind: InventoryListKind | null; onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const showAssets = kind === 'assets';

  const itemsQuery = useQuery({
    queryKey: ['/inventory/items', 'card-list'],
    queryFn: () => fetchAll<Item>('/inventory/items'),
    enabled: !!kind && !showAssets,
  });
  const assetsQuery = useQuery({
    queryKey: ['/assets', 'card-list'],
    queryFn: () => fetchAll<AssetRow>('/assets'),
    enabled: showAssets,
  });

  const items = (itemsQuery.data ?? []).filter((i) => {
    if (kind === 'consumables') return i.itemType === InventoryItemType.CONSUMABLE;
    // The card counts consumables only: assets are tracked one by one, not by stock level.
    if (kind === 'low') return i.itemType === InventoryItemType.CONSUMABLE && (isLow(i) || isOut(i));
    return true;
  });
  // Retired units are not counted on the card.
  const assets = (assetsQuery.data ?? []).filter((a) => a.status !== AssetStatus.RETIRED);

  const shownItems = search.trim() ? fuzzyFilter(items, search, (i) => [i.name, i.sku ?? '', i.location ?? '']) : items;
  const shownAssets = search.trim()
    ? fuzzyFilter(assets, search, (a) => [a.assetId, a.inventoryItem?.name ?? '', a.location ?? ''])
    : assets;

  const query = showAssets ? assetsQuery : itemsQuery;
  const count = showAssets ? shownAssets.length : shownItems.length;
  const title = kind === 'assets' ? t('assets') : kind === 'consumables' ? t('consumables') : kind === 'low' ? t('lowStock') : t('totalItems');

  const close = () => {
    setSearch('');
    onClose();
  };
  const openAssets = (itemId: string) => {
    close();
    navigate(`/assets/${itemId}`);
  };

  return (
    <ResponsiveDialog open={!!kind} onClose={close} maxWidth="md" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }}>
            <TextField id="inventory-card-search" size="small" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} sx={{ width: { xs: '100%', sm: 300 } }} />
            {!query.isLoading && !query.error && <Typography variant="body2" color="text.secondary">{t('listCount', { count })}</Typography>}
          </Stack>

          {query.error && <Alert severity="error">{extractErrorMessage(query.error)}</Alert>}
          {query.isLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={28} /></Box>
          ) : !query.error && count === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2 }}>{t('noData')}</Typography>
          ) : (
            <ResponsiveTable>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    {showAssets ? (
                      <TableRow>
                        <TableCell>{t('assetNo')}</TableCell>
                        <TableCell>{t('item')}</TableCell>
                        <TableCell>{t('status')}</TableCell>
                        <TableCell>{t('location')}</TableCell>
                      </TableRow>
                    ) : (
                      <TableRow>
                        <TableCell>{t('item')}</TableCell>
                        <TableCell>{t('type')}</TableCell>
                        <TableCell align="right">{t('stock')}</TableCell>
                        <TableCell align="right">{t('minLevel')}</TableCell>
                        <TableCell align="right">{t('value')}</TableCell>
                        <TableCell>{t('location')}</TableCell>
                      </TableRow>
                    )}
                  </TableHead>
                  <TableBody>
                    {showAssets
                      ? shownAssets.map((a) => (
                          <TableRow key={a.id} hover sx={{ cursor: a.inventoryItem ? 'pointer' : 'default' }} onClick={() => a.inventoryItem && openAssets(a.inventoryItem.id)}>
                            <TableCell data-label={t('assetNo')} sx={{ fontFamily: 'monospace' }}>{a.assetId}</TableCell>
                            <TableCell data-label={t('item')}>{a.inventoryItem?.name ?? '—'}</TableCell>
                            <TableCell data-label={t('status')}><Chip size="small" variant="outlined" label={enumLabel(a.status)} /></TableCell>
                            <TableCell data-label={t('location')}>{a.location ?? '—'}</TableCell>
                          </TableRow>
                        ))
                      : shownItems.map((i) => {
                          const asset = i.itemType === InventoryItemType.ASSET;
                          return (
                            <TableRow key={i.id} hover sx={{ cursor: asset ? 'pointer' : 'default' }} onClick={() => asset && openAssets(i.id)}>
                              <TableCell data-label={t('item')}>
                                <Typography variant="body2" fontWeight={600}>{i.name}</Typography>
                                {i.sku && <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{i.sku}</Typography>}
                              </TableCell>
                              <TableCell data-label={t('type')}>{asset ? t('asset') : t('consumable')}</TableCell>
                              <TableCell data-label={t('stock')} align="right">
                                <Stack direction="row" spacing={0.75} justifyContent="flex-end" alignItems="center">
                                  <span>{formatIndianNumber(Number(i.currentStock))} {i.unit}</span>
                                  {!asset && isOut(i) && <Chip size="small" color="error" label={t('out')} />}
                                  {!asset && !isOut(i) && isLow(i) && <Chip size="small" color="warning" label={t('low')} />}
                                </Stack>
                              </TableCell>
                              <TableCell data-label={t('minLevel')} align="right">{Number(i.minStockLevel) > 0 ? formatIndianNumber(Number(i.minStockLevel)) : '—'}</TableCell>
                              <TableCell data-label={t('value')} align="right">{!asset && Number(i.totalValue) > 0 ? formatCurrency(i.totalValue) : '—'}</TableCell>
                              <TableCell data-label={t('location')}>{i.location ?? '—'}</TableCell>
                            </TableRow>
                          );
                        })}
                  </TableBody>
                </Table>
              </TableContainer>
            </ResponsiveTable>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('close')}</Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
