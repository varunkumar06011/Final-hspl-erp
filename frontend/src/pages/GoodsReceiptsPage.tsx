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
  purchaseOrder: { poNumber: string; vendor: { name: string } };
  items: { materialName: string; quantity: number; unit: string | null }[];
}

interface Disposition {
  acceptedQty: number;
  rejectedQty: number;
  rejectionReason: string;
}

export default function GoodsReceiptsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [inspectReceipt, setInspectReceipt] = useState<Receipt | null>(null);
  const [selectedGatepassId, setSelectedGatepassId] = useState('');
  const [dispositions, setDispositions] = useState<Record<string, Disposition>>({});
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
    mutationFn: async () => (await api.post('/goods-receipts', { gatePassId: selectedGatepassId })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/goods-receipts'] });
      queryClient.invalidateQueries({ queryKey: ['/goods-receipts/available-gatepasses'] });
      setCreateOpen(false);
      setSelectedGatepassId('');
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });
  const inspectMutation = useMutation({
    mutationFn: async () => (await api.post(`/goods-receipts/${inspectReceipt!.id}/inspect`, {
      items: Object.entries(dispositions).map(([id, disposition]) => ({ id, ...disposition })),
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
    setDispositions((current) => ({
      ...current,
      [id]: { ...current[id], [field]: field === 'rejectionReason' ? value : Number(value) },
    }));
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

      <ResponsiveDialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Goods Receipt</DialogTitle>
        <DialogContent>
          <TextField select fullWidth size="small" label="Approved Gatepass" value={selectedGatepassId} onChange={(event) => setSelectedGatepassId(event.target.value)} sx={{ mt: 1 }}>
            {gatepassesQuery.data?.map((gatepass) => (
              <MenuItem key={gatepass.id} value={gatepass.id}>
                {gatepass.passNumber} — {gatepass.purchaseOrder.poNumber} — {gatepass.purchaseOrder.vendor.name}
              </MenuItem>
            ))}
          </TextField>
          {selectedGatepass && <Box sx={{ mt: 2 }}>
            {selectedGatepass.items.map((item) => <Typography key={item.materialName} variant="body2">{item.materialName}: {item.quantity} {item.unit ?? ''}</Typography>)}
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
            Accepted quantities will be posted to usable inventory. Rejected quantities remain outside usable stock.
          </Typography>
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
