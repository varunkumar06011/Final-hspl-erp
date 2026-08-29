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
import AttachmentUpload from '../components/AttachmentUpload';
import api, { extractErrorMessage } from '../config/api';
import { GoodsReceiptStatus, InventoryItemType } from '@hospital-erp/shared';
import { formatDate, STATUS_COLORS } from '../utils/enumOptions';

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
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function GRNDetailDialog({ id, open, onClose }: { id: string | null; open: boolean; onClose: () => void }) {
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
      <DialogTitle>{isLoading ? 'Goods Receipt Details' : data ? `GRN ${data.receiptNumber}` : 'Goods Receipt Details'}</DialogTitle>
      <DialogContent>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : !data ? (
          <Typography color="text.secondary">Receipt not found.</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {/* Header */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 1 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Status</Typography>
                <Chip size="small" label={statusLabel(data.status)} color={(STATUS_COLORS[data.status] ?? 'default') as never} />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Created</Typography>
                <Typography variant="body2">{formatDate(data.createdAt)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Posted</Typography>
                <Typography variant="body2">{data.postedAt ? formatDate(data.postedAt) : '—'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Created By</Typography>
                <Typography variant="body2">{data.createdByUser?.name ?? '—'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Inspected By</Typography>
                <Typography variant="body2">{data.inspectedByUser?.name ?? '—'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Posted By</Typography>
                <Typography variant="body2">{data.postedByUser?.name ?? '—'}</Typography>
              </Box>
            </Box>

            {/* Purchase Order */}
            <Card variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Purchase Order</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
                <Box><Typography variant="caption" color="text.secondary">PO Number</Typography><Typography variant="body2">{data.purchaseOrder.poNumber}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Date</Typography><Typography variant="body2">{formatDate(data.purchaseOrder.date)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Vendor</Typography><Typography variant="body2">{data.purchaseOrder.vendor.name} ({data.purchaseOrder.vendor.vendorCode})</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Referred By</Typography><Typography variant="body2">{data.purchaseOrder.vendor.referenceBy ?? '—'}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Payment Type</Typography><Typography variant="body2">{statusLabel(data.purchaseOrder.paymentType)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Grand Total</Typography><Typography variant="body2">{money(data.purchaseOrder.grandTotal)}</Typography></Box>
                {data.purchaseOrder.budgetHead && <Box><Typography variant="caption" color="text.secondary">Budget Head</Typography><Typography variant="body2">{data.purchaseOrder.budgetHead.particulars}</Typography></Box>}
              </Box>
            </Card>

            {/* Gate Pass */}
            <Card variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Gate Pass</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
                <Box><Typography variant="caption" color="text.secondary">Pass Number</Typography><Typography variant="body2">{data.gatePass.passNumber}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Date</Typography><Typography variant="body2">{formatDate(data.gatePass.date)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Type</Typography><Typography variant="body2">{statusLabel(data.gatePass.gatePassType)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Vehicle</Typography><Typography variant="body2">{data.gatePass.vehicleNumber ?? '—'}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Driver</Typography><Typography variant="body2">{data.gatePass.driverName ? `${data.gatePass.driverName} ${data.gatePass.driverMobile || ''}` : '—'}</Typography></Box>
              </Box>
            </Card>

            {/* Items */}
            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Receipt Items</Typography>
              <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Delivered</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Accepted</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Rejected</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Reason</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.materialName}</TableCell>
                        <TableCell>{item.deliveredQty}</TableCell>
                        <TableCell sx={{ color: 'success.main' }}>{item.acceptedQty}</TableCell>
                        <TableCell sx={{ color: item.rejectedQty > 0 ? 'error.main' : 'text.secondary' }}>{item.rejectedQty}</TableCell>
                        <TableCell>{item.rejectionReason ?? '—'}</TableCell>
                        <TableCell><Chip size="small" label={statusLabel(item.itemType)} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>

            {/* Assets */}
            {data.assets.length > 0 && (
              <Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Assets Generated ({data.assets.length})</Typography>
                <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Asset ID</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Item</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Serial</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Location</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Cost</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.assets.map((asset) => (
                        <TableRow key={asset.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/scan/${asset.assetId}`)}>
                          <TableCell><strong>{asset.assetId}</strong></TableCell>
                          <TableCell>{asset.inventoryItem.name}</TableCell>
                          <TableCell>{asset.serialNumber ?? '—'}</TableCell>
                          <TableCell><Chip size="small" label={statusLabel(asset.status)} color={(STATUS_COLORS[asset.status] ?? 'default') as never} /></TableCell>
                          <TableCell>{asset.location}</TableCell>
                          <TableCell>{money(asset.totalCost)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

export default function GoodsReceiptsPage() {
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>Goods Receipts</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setError(''); setCreateOpen(true); }}>
          New Receipt
        </Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      <Card>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead><TableRow>
              <TableCell>Receipt</TableCell><TableCell>PO</TableCell><TableCell>Gatepass</TableCell>
              <TableCell>Vendor</TableCell><TableCell>Budget Head</TableCell><TableCell>Item Types</TableCell><TableCell>Status</TableCell><TableCell>Actions</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {receiptsQuery.isLoading ? (
                <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={28} /></TableCell></TableRow>
              ) : receipts.length === 0 ? (
                <TableRow><TableCell colSpan={8} align="center">No goods receipts found</TableCell></TableRow>
              ) : receipts.map((receipt) => {
                const types = new Set(receipt.items.map((i) => i.itemType || 'CONSUMABLE'));
                return (
                <TableRow key={receipt.id} hover>
                  <TableCell>{receipt.receiptNumber}</TableCell>
                  <TableCell>{receipt.purchaseOrder.poNumber}</TableCell>
                  <TableCell>{receipt.gatePass.passNumber}</TableCell>
                  <TableCell>{receipt.purchaseOrder.vendor.name}</TableCell>
                  <TableCell>
                    {receipt.purchaseOrder.budgetHead
                      ? <Chip size="small" variant="outlined" color="primary" label={receipt.purchaseOrder.budgetHead.particulars} />
                      : <Typography variant="caption" color="text.secondary">—</Typography>}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {types.has('ASSET') && <Chip size="small" label="Asset" color="secondary" variant="outlined" />}
                      {types.has('CONSUMABLE') && <Chip size="small" label="Consumable" color="primary" variant="outlined" />}
                    </Box>
                  </TableCell>
                  <TableCell><Chip size="small" label={receipt.status.replace(/_/g, ' ')} /></TableCell>
                  <TableCell>
                    <Button size="small" startIcon={<ViewIcon />} onClick={() => setDetailId(receipt.id)}>Details</Button>
                    {receipt.status === GoodsReceiptStatus.PENDING_INSPECTION && (
                      <Button size="small" startIcon={<InspectIcon />} onClick={() => openInspection(receipt)}>Inspect</Button>
                    )}
                    {receipt.status === GoodsReceiptStatus.READY_TO_POST && (
                      <>
                        <Button size="small" startIcon={<InspectIcon />} onClick={() => openInspection(receipt)}>Edit Inspection</Button>
                        <Button size="small" color="success" startIcon={<PostIcon />} onClick={() => postMutation.mutate(receipt.id)} disabled={postMutation.isPending}>
                          Post to Inventory
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
      </Card>

      <ResponsiveDialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create Goods Receipt</DialogTitle>
        <DialogContent>
          <TextField select fullWidth size="small" label="Approved Gatepass" value={selectedGatepassId} onChange={(event) => { setSelectedGatepassId(event.target.value); setDeliveredQty({}); }} sx={{ mt: 1 }}>
            {gatepassesQuery.data?.map((gatepass) => (
              <MenuItem key={gatepass.id} value={gatepass.id}>
                {gatepass.passNumber} — {gatepass.purchaseOrder.poNumber} — {gatepass.purchaseOrder.vendor.name}
              </MenuItem>
            ))}
          </TextField>
          {selectedGatepass && <Box sx={{ mt: 2 }}>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
              Enter the actual quantity delivered for each item:
            </Typography>
            <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Expected</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Delivered</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {selectedGatepass.purchaseOrder.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.materialName}</TableCell>
                      <TableCell>{Number(item.quantity)}</TableCell>
                      <TableCell>
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
                      <TableCell>{item.unit ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Expected = quantity from the purchase order. Delivered = actual quantity that arrived. If less than expected, the PO will be marked as partially delivered.
            </Typography>
          </Box>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => createMutation.mutate()} disabled={!selectedGatepassId || createMutation.isPending}>
            {createMutation.isPending ? <CircularProgress size={20} /> : 'Create Receipt'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      <GRNDetailDialog
        id={detailId}
        open={!!detailId}
        onClose={() => setDetailId(null)}
      />

      <ResponsiveDialog open={!!inspectReceipt} onClose={() => setInspectReceipt(null)} maxWidth="md" fullWidth>
        <DialogTitle>Inspect {inspectReceipt?.receiptNumber}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Accepted quantities will be posted to usable inventory. Rejected quantities remain outside usable stock. Entering a rejected quantity automatically reduces the accepted quantity. Mark each item as Consumable or Asset — assets get individual unit tracking with QR codes.
          </Typography>
          {inspectReceipt && <AttachmentUpload entityType="GOODS_RECEIPT" entityId={inspectReceipt.id} />}
          {inspectReceipt?.items.map((item) => {
            const disposition = dispositions[item.id] ?? { acceptedQty: 0, rejectedQty: 0, rejectionReason: '', itemType: InventoryItemType.CONSUMABLE };
            return <Box key={item.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1.5fr 1fr 1fr 1.5fr 1.5fr' }, gap: 1, mb: 1, alignItems: 'center' }}>
              <Typography variant="body2">{item.materialName} ({item.deliveredQty})</Typography>
              <TextField size="small" label="Accepted" type="number" value={disposition.acceptedQty} onChange={(event) => updateDisposition(item.id, 'acceptedQty', event.target.value)} inputProps={{ min: 0, max: item.deliveredQty }} />
              <TextField size="small" label="Rejected" type="number" value={disposition.rejectedQty} onChange={(event) => updateDisposition(item.id, 'rejectedQty', event.target.value)} inputProps={{ min: 0, max: item.deliveredQty }} />
              <TextField size="small" label="Rejection reason" value={disposition.rejectionReason} onChange={(event) => updateDisposition(item.id, 'rejectionReason', event.target.value)} />
              <TextField select size="small" label="Item Type" value={disposition.itemType} onChange={(event) => updateDisposition(item.id, 'itemType', event.target.value)}>
                <MenuItem value={InventoryItemType.CONSUMABLE}>Consumable</MenuItem>
                <MenuItem value={InventoryItemType.ASSET}>Asset</MenuItem>
              </TextField>
            </Box>;
          })}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspectReceipt(null)}>Cancel</Button>
          <Button variant="contained" onClick={() => inspectMutation.mutate()} disabled={inspectMutation.isPending}>
            {inspectMutation.isPending ? <CircularProgress size={20} /> : 'Complete Inspection'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
