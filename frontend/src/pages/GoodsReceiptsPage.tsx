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
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Add as AddIcon, FactCheck as InspectIcon, Inventory as PostIcon, Visibility as ViewIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ResponsiveDialog from '../components/ResponsiveDialog';
import ResponsiveTable from '../components/ResponsiveTable';
import AttachmentUpload from '../components/AttachmentUpload';
import api, { extractErrorMessage } from '../config/api';
import { GoodsReceiptStatus, InventoryItemType } from '@hospital-erp/shared';
import { formatDate, STATUS_COLORS, enumLabel } from '../utils/enumOptions';
import { useTranslation } from 'react-i18next';
import CommentsButton from '../components/CommentsButton';

interface ReceiptItem {
  id: string;
  materialName: string;
  unit: string | null;
  deliveredQty: number;
  acceptedQty: number;
  rejectedQty: number;
  itemType?: string;
}

interface GRNDetail {
  id: string;
  receiptNumber: string;
  status: string;
  createdAt: string;
  inspectedAt: string | null;
  postedAt: string | null;
  items: {
    id: string; materialName: string; unit: string | null; deliveredQty: number; acceptedQty: number;
    rejectedQty: number; rejectionReason: string | null; itemType: string;
    poItem: { unitPrice: string; gstRate: string; quantity: string } | null;
  }[];
  inspection: { status: string; completedDate: string | null } | null;
  purchaseOrder: {
    id: string; poNumber: string; date: string; status: string; paymentType: string; grandTotal: string;
    vendor: { id: string; name: string; vendorCode: string; referenceBy: string | null; contactPersonName: string | null; phone: string | null };
    quotation: { id: string; quotationNumber: string; date: string } | null;
    budgetHead: { id: string; particulars: string } | null;
    createdByUser: { name: string } | null;
    items: { materialName: string; quantity: string; unit: string | null; unitPrice: string; gstRate: string; amount: string }[];
  };
  gatePass: {
    id: string; passNumber: string; date: string; status: string; gatePassType: string;
    vehicleNumber: string | null; driverName: string | null; driverMobile: string | null;
    items: { materialName: string; quantity: number; unit: string | null }[];
    createdByUser: { name: string } | null;
  };
  assets: { id: string; assetId: string; status: string; location: string; serialNumber: string | null; totalCost: string | null; warrantyExpiry: string | null; inventoryItem: { id: string; name: string } }[];
  createdByUser: { name: string } | null;
  inspectedByUser: { name: string } | null;
  postedByUser: { name: string } | null;
}

interface Receipt {
  id: string;
  receiptNumber: string;
  status: GoodsReceiptStatus;
  purchaseOrder: { poNumber: string; vendor: { name: string }; budgetHead?: { id: string; particulars: string } | null };
  gatePass: { passNumber: string };
  items: ReceiptItem[];
}

interface Gatepass {
  id: string;
  passNumber: string;
  purchaseOrder: {
    poNumber: string;
    vendor: { name: string };
    items: { id: string; materialName: string; quantity: number; unit: string | null }[];
  };
  items: { materialName: string; quantity: number; unit: string | null }[];
}

interface Disposition {
  acceptedQty: number | '';
  rejectedQty: number | '';
  rejectionReason: string;
  itemType: InventoryItemType;
}

function money(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function statusLabel(s: string | null): string {
  if (!s) return '—';
  return enumLabel(s);
}

function GRNDetailDialog({ id, open, onClose }: { id: string | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation('grn');
  const navigate = useNavigate();
  const { data, isLoading } = useQuery<GRNDetail>({
    queryKey: ['/goods-receipts', id],
    queryFn: async () => {
      const res = await api.get(`/goods-receipts/${id}`);
      return res.data;
    },
    enabled: !!id,
  });

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{isLoading ? t('detailsTitle') : data ? t('grnTitle', { n: data.receiptNumber }) : t('detailsTitle')}</DialogTitle>
      <DialogContent>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : !data ? (
          <Typography color="text.secondary">{t('notFound')}</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {/* Header */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 1 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('status')}</Typography>
                <Chip size="small" label={statusLabel(data.status)} color={(STATUS_COLORS[data.status] ?? 'default') as never} />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('created')}</Typography>
                <Typography variant="body2">{formatDate(data.createdAt)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('posted')}</Typography>
                <Typography variant="body2">{data.postedAt ? formatDate(data.postedAt) : '—'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('createdBy')}</Typography>
                <Typography variant="body2">{data.createdByUser?.name ?? '—'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('inspectedBy')}</Typography>
                <Typography variant="body2">{data.inspectedByUser?.name ?? '—'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('postedBy')}</Typography>
                <Typography variant="body2">{data.postedByUser?.name ?? '—'}</Typography>
              </Box>
            </Box>

            {/* Purchase Order */}
            <Card variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{t('purchaseOrder')}</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
                <Box><Typography variant="caption" color="text.secondary">{t('poNumber')}</Typography><Typography variant="body2">{data.purchaseOrder.poNumber}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">{t('date')}</Typography><Typography variant="body2">{formatDate(data.purchaseOrder.date)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">{t('vendor')}</Typography><Typography variant="body2">{data.purchaseOrder.vendor.name} ({data.purchaseOrder.vendor.vendorCode})</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">{t('referredBy')}</Typography><Typography variant="body2">{data.purchaseOrder.vendor.referenceBy ?? '—'}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">{t('paymentType')}</Typography><Typography variant="body2">{statusLabel(data.purchaseOrder.paymentType)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">{t('grandTotal')}</Typography><Typography variant="body2">{money(data.purchaseOrder.grandTotal)}</Typography></Box>
                {data.purchaseOrder.budgetHead && <Box><Typography variant="caption" color="text.secondary">{t('budgetHead')}</Typography><Typography variant="body2">{data.purchaseOrder.budgetHead.particulars}</Typography></Box>}
              </Box>
            </Card>

            {/* Gate Pass */}
            <Card variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{t('gatePass')}</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
                <Box><Typography variant="caption" color="text.secondary">{t('passNumber')}</Typography><Typography variant="body2">{data.gatePass.passNumber}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">{t('date')}</Typography><Typography variant="body2">{formatDate(data.gatePass.date)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">{t('type')}</Typography><Typography variant="body2">{statusLabel(data.gatePass.gatePassType)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">{t('vehicle')}</Typography><Typography variant="body2">{data.gatePass.vehicleNumber ?? '—'}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">{t('driver')}</Typography><Typography variant="body2">{data.gatePass.driverName ? `${data.gatePass.driverName} ${data.gatePass.driverMobile || ''}` : '—'}</Typography></Box>
              </Box>
            </Card>

            {/* Items */}
            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{t('receiptItems')}</Typography>
              <ResponsiveTable>
              <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>{t('material')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('delivered')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('accepted')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('rejected')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('reason')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('type')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell data-label={t('material')}>{item.materialName}</TableCell>
                        <TableCell data-label={t('delivered')}>{item.deliveredQty}</TableCell>
                        <TableCell data-label={t('accepted')} sx={{ color: 'success.main' }}>{item.acceptedQty}</TableCell>
                        <TableCell data-label={t('rejected')} sx={{ color: item.rejectedQty > 0 ? 'error.main' : 'text.secondary' }}>{item.rejectedQty}</TableCell>
                        <TableCell data-label={t('reason')}>{item.rejectionReason ?? '—'}</TableCell>
                        <TableCell data-label={t('type')}><Chip size="small" label={statusLabel(item.itemType)} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              </ResponsiveTable>
            </Box>

            {/* Assets */}
            {data.assets.length > 0 && (
              <Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{t('assetsGenerated', { n: data.assets.length })}</Typography>
                <ResponsiveTable>
                <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>{t('assetId')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('item')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('serial')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('status')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('location')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('cost')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.assets.map((asset) => (
                        <TableRow key={asset.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/scan/${asset.assetId}`)}>
                          <TableCell data-label={t('assetId')}><strong>{asset.assetId}</strong></TableCell>
                          <TableCell data-label={t('item')}>{asset.inventoryItem.name}</TableCell>
                          <TableCell data-label={t('serial')}>{asset.serialNumber ?? '—'}</TableCell>
                          <TableCell data-label={t('status')}><Chip size="small" label={statusLabel(asset.status)} color={(STATUS_COLORS[asset.status] ?? 'default') as never} /></TableCell>
                          <TableCell data-label={t('location')}>{asset.location}</TableCell>
                          <TableCell data-label={t('cost')}>{money(asset.totalCost)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                </ResponsiveTable>
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('close')}</Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

export default function GoodsReceiptsPage() {
  const { t } = useTranslation('grn');
  const [createOpen, setCreateOpen] = useState(false);
  const [inspectReceipt, setInspectReceipt] = useState<Receipt | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectedGatepassId, setSelectedGatepassId] = useState('');
  const [dispositions, setDispositions] = useState<Record<string, Disposition>>({});
  const [deliveredQty, setDeliveredQty] = useState<Record<string, number | string>>({});
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const receiptsQuery = useQuery({
    queryKey: ['/goods-receipts'],
    queryFn: async () => (await api.get('/goods-receipts')).data,
  });
  const gatepassesQuery = useQuery<Gatepass[]>({
    queryKey: ['/goods-receipts/available-gatepasses'],
    queryFn: async () => (await api.get('/goods-receipts/available-gatepasses')).data?.data ?? [],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const poItems = selectedGatepass?.purchaseOrder.items ?? [];
      const items = poItems
        .map((item) => ({
          materialName: item.materialName,
          deliveredQty: Number(deliveredQty[item.materialName] ?? 0),
          unit: item.unit,
        }))
        .filter((item) => item.deliveredQty > 0);
      return (await api.post('/goods-receipts', { gatePassId: selectedGatepassId, items })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/goods-receipts'] });
      queryClient.invalidateQueries({ queryKey: ['/goods-receipts/available-gatepasses'] });
      setCreateOpen(false);
      setSelectedGatepassId('');
      setDeliveredQty({});
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });
  const inspectMutation = useMutation({
    mutationFn: async () => (await api.post(`/goods-receipts/${inspectReceipt!.id}/inspect`, {
      items: Object.entries(dispositions).map(([id, disposition]) => ({
        id,
        acceptedQty: Number(disposition.acceptedQty || 0),
        rejectedQty: Number(disposition.rejectedQty || 0),
        rejectionReason: disposition.rejectionReason,
        itemType: disposition.itemType,
      })),
    })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/goods-receipts'] });
      setInspectReceipt(null);
      setDispositions({});
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });
  const postMutation = useMutation({
    mutationFn: async (id: string) => (await api.post(`/goods-receipts/${id}/post`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/goods-receipts'] });
      queryClient.invalidateQueries({ queryKey: ['/inventory/items'] });
      queryClient.invalidateQueries({ queryKey: ['/inventory/transactions'] });
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const receipts: Receipt[] = receiptsQuery.data?.data ?? [];
  const selectedGatepass = gatepassesQuery.data?.find((gatepass) => gatepass.id === selectedGatepassId);

  function openInspection(receipt: Receipt) {
    setError('');
    setInspectReceipt(receipt);
    setDispositions(Object.fromEntries(receipt.items.map((item) => [item.id, {
      acceptedQty: Number(item.deliveredQty),
      rejectedQty: 0,
      rejectionReason: '',
      itemType: (item.itemType as InventoryItemType) || InventoryItemType.CONSUMABLE,
    }])));
  }

  function updateDisposition(id: string, field: keyof Disposition, value: string) {
    setDispositions((current) => {
      const existing = current[id];
      if (field === 'rejectionReason') {
        return { ...current, [id]: { ...existing, rejectionReason: value } };
      }
      if (field === 'itemType') {
        return { ...current, [id]: { ...existing, itemType: value as InventoryItemType } };
      }

      const numericValue = value === '' ? '' : Number(value);
      if (field === 'rejectedQty') {
        const delivered = inspectReceipt?.items.find((item) => item.id === id)?.deliveredQty ?? 0;
        // ── E09: Cap rejected at deliveredQty to prevent accepted+rejected > delivered ──
        const rejected = numericValue === '' ? 0 : Math.min(numericValue, Number(delivered));
        return {
          ...current,
          [id]: {
            ...existing,
            rejectedQty: rejected,
            acceptedQty: Math.max(0, Number(delivered) - rejected),
          },
        };
      }

      const delivered = inspectReceipt?.items.find((item) => item.id === id)?.deliveredQty ?? 0;
      // ── E09: Cap accepted at deliveredQty to prevent accepted+rejected > delivered ──
      const accepted = numericValue === '' ? 0 : Math.min(numericValue, Number(delivered));
      return {
        ...current,
        [id]: {
          ...existing,
          acceptedQty: numericValue,
          rejectedQty: Math.max(0, Number(delivered) - accepted),
        },
      };
    });
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>{t('title')}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setError(''); setCreateOpen(true); }}>
          {t('newReceipt')}
        </Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      <Card>
        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead><TableRow>
              <TableCell>{t('colReceipt')}</TableCell><TableCell>{t('colPO')}</TableCell><TableCell>{t('colGatepass')}</TableCell>
              <TableCell>{t('vendor')}</TableCell><TableCell>{t('budgetHead')}</TableCell><TableCell>{t('itemTypes')}</TableCell><TableCell>{t('status')}</TableCell><TableCell>{t('actions')}</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {receiptsQuery.isLoading ? (
                <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={28} /></TableCell></TableRow>
              ) : receipts.length === 0 ? (
                <TableRow><TableCell colSpan={8} align="center">{t('noReceipts')}</TableCell></TableRow>
              ) : receipts.map((receipt) => {
                const types = new Set(receipt.items.map((i) => i.itemType || 'CONSUMABLE'));
                return (
                <TableRow key={receipt.id} hover>
                  <TableCell data-label={t('colReceipt')}>{receipt.receiptNumber}</TableCell>
                  <TableCell data-label={t('colPO')}>{receipt.purchaseOrder.poNumber}</TableCell>
                  <TableCell data-label={t('colGatepass')}>{receipt.gatePass.passNumber}</TableCell>
                  <TableCell data-label={t('vendor')}>{receipt.purchaseOrder.vendor.name}</TableCell>
                  <TableCell data-label={t('budgetHead')}>
                    {receipt.purchaseOrder.budgetHead
                      ? <Chip size="small" variant="outlined" color="primary" label={receipt.purchaseOrder.budgetHead.particulars} />
                      : <Typography variant="caption" color="text.secondary">—</Typography>}
                  </TableCell>
                  <TableCell data-label={t('itemTypes')}>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {types.has('ASSET') && <Chip size="small" label={t('asset')} color="secondary" variant="outlined" />}
                      {types.has('CONSUMABLE') && <Chip size="small" label={t('consumable')} color="primary" variant="outlined" />}
                    </Box>
                  </TableCell>
                  <TableCell data-label={t('status')}><Chip size="small" label={enumLabel(receipt.status)} /></TableCell>
                  <TableCell data-label={t('actions')}>
                    <Button size="small" startIcon={<ViewIcon />} onClick={() => setDetailId(receipt.id)}>{t('details')}</Button>
                    <CommentsButton entityType="GOODS_RECEIPT" entityId={receipt.id} entityLabel={receipt.receiptNumber} url="/goods-receipts" />
                    {receipt.status === GoodsReceiptStatus.PENDING_INSPECTION && (
                      <Button size="small" startIcon={<InspectIcon />} onClick={() => openInspection(receipt)}>{t('inspect')}</Button>
                    )}
                    {receipt.status === GoodsReceiptStatus.READY_TO_POST && (
                      <>
                        <Button size="small" startIcon={<InspectIcon />} onClick={() => openInspection(receipt)}>{t('editInspection')}</Button>
                        <Button size="small" color="success" startIcon={<PostIcon />} onClick={() => postMutation.mutate(receipt.id)} disabled={postMutation.isPending}>
                          {t('postToInventory')}
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        </ResponsiveTable>
      </Card>

      <ResponsiveDialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('createTitle')}</DialogTitle>
        <DialogContent>
          <TextField select fullWidth size="small" label={t('approvedGatepass')} value={selectedGatepassId} onChange={(event) => { setSelectedGatepassId(event.target.value); setDeliveredQty({}); }} sx={{ mt: 1 }}>
            {gatepassesQuery.data?.map((gatepass) => (
              <MenuItem key={gatepass.id} value={gatepass.id}>
                {gatepass.passNumber} — {gatepass.purchaseOrder.poNumber} — {gatepass.purchaseOrder.vendor.name}
              </MenuItem>
            ))}
          </TextField>
          {selectedGatepass && <Box sx={{ mt: 2 }}>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
              {t('enterDelivered')}
            </Typography>
            <ResponsiveTable>
            <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>{t('material')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('expected')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('delivered')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('unit')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {selectedGatepass.purchaseOrder.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell data-label={t('material')}>{item.materialName}</TableCell>
                      <TableCell data-label={t('expected')}>{Number(item.quantity)}</TableCell>
                      <TableCell data-label={t('delivered')}>
                        <TextField
                          type="number"
                          size="small"
                          value={deliveredQty[item.materialName] ?? ''}
                          onChange={(e) => setDeliveredQty((current) => ({ ...current, [item.materialName]: e.target.value }))}
                          inputProps={{ min: 0, step: 0.01 }}
                          sx={{ width: 100 }}
                          placeholder="0"
                        />
                      </TableCell>
                      <TableCell data-label={t('unit')}>{item.unit ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            </ResponsiveTable>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {t('expectedHelp')}
            </Typography>
          </Box>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>{t('cancel')}</Button>
          <Button variant="contained" onClick={() => createMutation.mutate()} disabled={!selectedGatepassId || createMutation.isPending}>
            {createMutation.isPending ? <CircularProgress size={20} /> : t('createReceipt')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      <GRNDetailDialog
        id={detailId}
        open={!!detailId}
        onClose={() => setDetailId(null)}
      />

      <ResponsiveDialog open={!!inspectReceipt} onClose={() => setInspectReceipt(null)} maxWidth="md" fullWidth>
        <DialogTitle>{t('inspectTitle', { n: inspectReceipt?.receiptNumber })}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('inspectHelp')}
          </Typography>
          {inspectReceipt && <AttachmentUpload entityType="GOODS_RECEIPT" entityId={inspectReceipt.id} />}
          {inspectReceipt?.items.map((item) => {
            const disposition = dispositions[item.id] ?? { acceptedQty: 0, rejectedQty: 0, rejectionReason: '', itemType: InventoryItemType.CONSUMABLE };
            return <Box key={item.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1.5fr 1fr 1fr 1.5fr 1.5fr' }, gap: 1, mb: 1, alignItems: 'center' }}>
              <Typography variant="body2">{item.materialName} ({item.deliveredQty})</Typography>
              <TextField size="small" label={t('accepted')} type="number" value={disposition.acceptedQty} onChange={(event) => updateDisposition(item.id, 'acceptedQty', event.target.value)} inputProps={{ min: 0, max: item.deliveredQty }} />
              <TextField size="small" label={t('rejected')} type="number" value={disposition.rejectedQty} onChange={(event) => updateDisposition(item.id, 'rejectedQty', event.target.value)} inputProps={{ min: 0, max: item.deliveredQty }} />
              <TextField size="small" label={t('rejectionReason')} value={disposition.rejectionReason} onChange={(event) => updateDisposition(item.id, 'rejectionReason', event.target.value)} />
              <TextField select size="small" label={t('itemType')} value={disposition.itemType} onChange={(event) => updateDisposition(item.id, 'itemType', event.target.value)}>
                <MenuItem value={InventoryItemType.CONSUMABLE}>{t('consumable')}</MenuItem>
                <MenuItem value={InventoryItemType.ASSET}>{t('asset')}</MenuItem>
              </TextField>
            </Box>;
          })}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspectReceipt(null)}>{t('cancel')}</Button>
          <Button variant="contained" onClick={() => inspectMutation.mutate()} disabled={inspectMutation.isPending}>
            {inspectMutation.isPending ? <CircularProgress size={20} /> : t('completeInspection')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
