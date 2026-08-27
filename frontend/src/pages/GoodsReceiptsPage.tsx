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
import { Add as AddIcon, FactCheck as InspectIcon, Inventory as PostIcon } from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ResponsiveDialog from '../components/ResponsiveDialog';
import AttachmentUpload from '../components/AttachmentUpload';
import api, { extractErrorMessage } from '../config/api';
import { GoodsReceiptStatus } from '@hospital-erp/shared';

interface ReceiptItem {
  id: string;
  materialName: string;
  unit: string | null;
  deliveredQty: number;
  acceptedQty: number;
  rejectedQty: number;
}

interface Receipt {
  id: string;
  receiptNumber: string;
  status: GoodsReceiptStatus;
  purchaseOrder: { poNumber: string; vendor: { name: string } };
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
}

export default function GoodsReceiptsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [inspectReceipt, setInspectReceipt] = useState<Receipt | null>(null);
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
    }])));
  }

  function updateDisposition(id: string, field: keyof Disposition, value: string) {
    setDispositions((current) => {
      const existing = current[id];
      if (field === 'rejectionReason') {
        return { ...current, [id]: { ...existing, rejectionReason: value } };
      }

      const numericValue = value === '' ? '' : Number(value);
      if (field === 'rejectedQty') {
        const delivered = inspectReceipt?.items.find((item) => item.id === id)?.deliveredQty ?? 0;
        const rejected = numericValue === '' ? 0 : numericValue;
        return {
          ...current,
          [id]: {
            ...existing,
            rejectedQty: numericValue,
            acceptedQty: Math.max(0, Number(delivered) - rejected),
          },
        };
      }

      const delivered = inspectReceipt?.items.find((item) => item.id === id)?.deliveredQty ?? 0;
      const accepted = numericValue === '' ? 0 : numericValue;
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
              <TableCell>Vendor</TableCell><TableCell>Status</TableCell><TableCell>Actions</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {receiptsQuery.isLoading ? (
                <TableRow><TableCell colSpan={6} align="center"><CircularProgress size={28} /></TableCell></TableRow>
              ) : receipts.length === 0 ? (
                <TableRow><TableCell colSpan={6} align="center">No goods receipts found</TableCell></TableRow>
              ) : receipts.map((receipt) => (
                <TableRow key={receipt.id} hover>
                  <TableCell>{receipt.receiptNumber}</TableCell>
                  <TableCell>{receipt.purchaseOrder.poNumber}</TableCell>
                  <TableCell>{receipt.gatePass.passNumber}</TableCell>
                  <TableCell>{receipt.purchaseOrder.vendor.name}</TableCell>
                  <TableCell><Chip size="small" label={receipt.status.replace(/_/g, ' ')} /></TableCell>
                  <TableCell>
                    {receipt.status === GoodsReceiptStatus.PENDING_INSPECTION && (
                      <Button size="small" startIcon={<InspectIcon />} onClick={() => openInspection(receipt)}>Inspect</Button>
                    )}
                    {receipt.status === GoodsReceiptStatus.READY_TO_POST && (
                      <Button size="small" color="success" startIcon={<PostIcon />} onClick={() => postMutation.mutate(receipt.id)} disabled={postMutation.isPending}>
                        Post to Inventory
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
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

      <ResponsiveDialog open={!!inspectReceipt} onClose={() => setInspectReceipt(null)} maxWidth="md" fullWidth>
        <DialogTitle>Inspect {inspectReceipt?.receiptNumber}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Accepted quantities will be posted to usable inventory. Rejected quantities remain outside usable stock. Entering a rejected quantity automatically reduces the accepted quantity.
          </Typography>
          {inspectReceipt && <AttachmentUpload entityType="GOODS_RECEIPT" entityId={inspectReceipt.id} />}
          {inspectReceipt?.items.map((item) => {
            const disposition = dispositions[item.id] ?? { acceptedQty: 0, rejectedQty: 0, rejectionReason: '' };
            return <Box key={item.id} sx={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 2fr', gap: 1, mb: 1, alignItems: 'center' }}>
              <Typography variant="body2">{item.materialName} ({item.deliveredQty})</Typography>
              <TextField size="small" label="Accepted" type="number" value={disposition.acceptedQty} onChange={(event) => updateDisposition(item.id, 'acceptedQty', event.target.value)} inputProps={{ min: 0, max: item.deliveredQty }} />
              <TextField size="small" label="Rejected" type="number" value={disposition.rejectedQty} onChange={(event) => updateDisposition(item.id, 'rejectedQty', event.target.value)} inputProps={{ min: 0, max: item.deliveredQty }} />
              <TextField size="small" label="Rejection reason" value={disposition.rejectionReason} onChange={(event) => updateDisposition(item.id, 'rejectionReason', event.target.value)} />
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
