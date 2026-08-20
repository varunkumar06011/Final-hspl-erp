import { useState, useMemo, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Chip,
  Alert,
  CircularProgress,
  InputAdornment,
  MenuItem,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  RemoveCircleOutline as RemoveIcon,
  ExpandMore as ExpandMoreIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QuotationStatus } from '@hospital-erp/shared';
import { formatCurrency, formatDate, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';

interface QuotationItem {
  id?: string;
  materialName: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  amount: number;
}

interface VendorMaterial {
  id: string;
  name: string;
  unit?: string | null;
  pricePerUnit?: number | null;
}

interface Vendor {
  id: string;
  name: string;
  vendorCode: string;
  materials: VendorMaterial[];
}

interface ApprovalStep {
  id: string;
  stepNumber: number;
  approverRole: string;
  status: string;
  approverUser?: { id: string; name: string; role: string } | null;
  comments?: string | null;
  decidedAt?: string | null;
}

interface QuotationRow {
  id: string;
  quotationNumber: string;
  vendorId: string;
  vendor: { id: string; name: string; vendorCode: string };
  date: string;
  status: string;
  totalAmount: number;
  gstAmount: number;
  grandTotal: number;
  fileName?: string | null;
  filePath?: string | null;
  createdByUser: { id: string; name: string };
  items: QuotationItem[];
  approvalWorkflow?: {
    id: string;
    status: string;
    currentStep: number;
    steps: ApprovalStep[];
  } | null;
}

export default function QuotationsPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<QuotationRow | null>(null);
  const [error, setError] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [lineItems, setLineItems] = useState<QuotationItem[]>([]);
  const [gstAmount, setGstAmount] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/quotations', page, pageSize, search, statusFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const response = await api.get('/quotations', { params });
      return response.data;
    },
  });

  const { data: vendorsData } = useQuery({
    queryKey: ['/vendors', 'for-quotation'],
    queryFn: async () => {
      const response = await api.get('/vendors', { params: { pageSize: 100 } });
      return response.data;
    },
  });

  const { data: selectedVendor } = useQuery<Vendor | null>({
    queryKey: ['/vendors', selectedVendorId],
    queryFn: async () => {
      if (!selectedVendorId) return null;
      const response = await api.get(`/vendors/${selectedVendorId}`);
      return response.data;
    },
    enabled: !!selectedVendorId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append('vendorId', selectedVendorId);
      formData.append('items', JSON.stringify(lineItems));
      if (gstAmount) formData.append('gstAmount', gstAmount);
      if (selectedFile) formData.append('file', selectedFile);
      const response = await api.post('/quotations', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/quotations'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append('items', JSON.stringify(lineItems));
      if (gstAmount) formData.append('gstAmount', gstAmount);
      if (selectedFile) formData.append('file', selectedFile);
      const response = await api.patch(`/quotations/${editing!.id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/quotations'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setEditOpen(false);
      setEditing(null);
      resetForm();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const approveMutation = useMutation({
    mutationFn: async ({ quotationId, stepId, comments }: { quotationId: string; stepId: string; comments?: string }) => {
      const response = await api.post(`/quotations/${quotationId}/approve/${stepId}`, { comments });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/quotations'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ quotationId, stepId, reason }: { quotationId: string; stepId: string; reason: string }) => {
      const response = await api.post(`/quotations/${quotationId}/reject/${stepId}`, { reason });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/quotations'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: QuotationRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const vendors: { id: string; name: string; vendorCode: string }[] = vendorsData?.data ?? [];

  const totalAmount = useMemo(
    () => lineItems.reduce((sum, i) => sum + Number(i.amount), 0),
    [lineItems]
  );
  const grandTotal = totalAmount + (Number(gstAmount) || 0);

  function resetForm() {
    setSelectedVendorId('');
    setLineItems([]);
    setGstAmount('');
    setSelectedFile(null);
    setError('');
  }

  function openCreate() {
    resetForm();
    setCreateOpen(true);
  }

  function openEdit(row: QuotationRow) {
    setEditing(row);
    setSelectedVendorId(row.vendorId);
    setLineItems(row.items.map((i) => ({
      id: i.id,
      materialName: i.materialName,
      quantity: Number(i.quantity),
      unit: i.unit ?? '',
      unitPrice: Number(i.unitPrice),
      amount: Number(i.amount),
    })));
    setGstAmount(String(row.gstAmount ?? ''));
    setSelectedFile(null);
    setError('');
    setEditOpen(true);
  }

  function addLineItem() {
    if (!selectedVendor?.materials?.length) return;
    const firstMat = selectedVendor.materials[0];
    setLineItems([...lineItems, {
      materialName: firstMat.name,
      quantity: 1,
      unit: firstMat.unit ?? '',
      unitPrice: firstMat.pricePerUnit ? Number(firstMat.pricePerUnit) : 0,
      amount: firstMat.pricePerUnit ? Number(firstMat.pricePerUnit) : 0,
    }]);
  }

  function updateLineItem(index: number, field: keyof QuotationItem, value: string | number) {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    if (field === 'quantity' || field === 'unitPrice') {
      updated[index].amount = Number(updated[index].quantity) * Number(updated[index].unitPrice);
    }
    setLineItems(updated);
  }

  function removeLineItem(index: number) {
    setLineItems(lineItems.filter((_, i) => i !== index));
  }

  function canApprove(row: QuotationRow): ApprovalStep | null {
    if (!row.approvalWorkflow) return null;
    const pendingStep = row.approvalWorkflow.steps.find((s) => s.status === 'PENDING');
    return pendingStep ?? null;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>Quotations</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>Add Quotation</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Card>
        <Box sx={{ p: 2, display: 'flex', gap: 2 }}>
          <TextField
            size="small"
            placeholder="Search quotations..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: 300 }}
          />
          <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} sx={{ width: 180 }}>
            <MenuItem value="">All</MenuItem>
            {Object.values(QuotationStatus).map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
          </TextField>
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Quotation No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>GST</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Grand Total</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created By</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>File</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={10} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No quotations found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row) => {
                  const pendingStep = canApprove(row);
                  return (
                    <TableRow key={row.id} hover>
                      <TableCell>{row.quotationNumber}</TableCell>
                      <TableCell>{row.vendor?.vendorCode} - {row.vendor?.name ?? '—'}</TableCell>
                      <TableCell>{formatDate(row.date)}</TableCell>
                      <TableCell>{formatCurrency(row.totalAmount)}</TableCell>
                      <TableCell>{formatCurrency(row.gstAmount)}</TableCell>
                      <TableCell>{formatCurrency(row.grandTotal)}</TableCell>
                      <TableCell>{row.createdByUser?.name ?? '—'}</TableCell>
                      <TableCell><Chip label={row.status.replace(/_/g, ' ')} size="small" color={STATUS_COLORS[row.status] ?? 'default'} /></TableCell>
                      <TableCell>
                        {row.filePath ? (
                          <IconButton size="small" component="a" href={row.filePath} target="_blank"><DownloadIcon fontSize="small" /></IconButton>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {row.status === QuotationStatus.SUBMITTED || row.status === QuotationStatus.UNDER_REVIEW ? (
                            <IconButton size="small" onClick={() => openEdit(row)}><EditIcon /></IconButton>
                          ) : null}
                          {pendingStep && (
                            <>
                              <IconButton size="small" color="success" onClick={() => approveMutation.mutate({ quotationId: row.id, stepId: pendingStep.id })} title={`Approve (Step ${pendingStep.stepNumber})`}><CheckIcon fontSize="small" /></IconButton>
                              <IconButton size="small" color="error" onClick={() => { const reason = prompt('Reason for rejection:'); if (reason) rejectMutation.mutate({ quotationId: row.id, stepId: pendingStep.id, reason }); }} title="Reject"><CloseIcon fontSize="small" /></IconButton>
                            </>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={pagination.total}
          page={page}
          onPageChange={(_e, p) => setPage(p)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 20, 50]}
        />
      </Card>

      {/* Approval details accordion for each quotation with a workflow */}
      {rows.length > 0 && rows.some((r) => r.approvalWorkflow) && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>Approval Status</Typography>
          {rows.filter((r) => r.approvalWorkflow).map((row) => (
            <Accordion key={row.id}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography><strong>{row.quotationNumber}</strong> — {row.vendor?.name} — Status: <Chip label={row.approvalWorkflow!.status} size="small" color={STATUS_COLORS[row.approvalWorkflow!.status] ?? 'default'} /></Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Step</TableCell>
                      <TableCell>Approver Role</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Approver</TableCell>
                      <TableCell>Comments</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {row.approvalWorkflow!.steps.map((step) => (
                      <TableRow key={step.id}>
                        <TableCell>{step.stepNumber}</TableCell>
                        <TableCell>{step.approverRole.replace(/_/g, ' ')}</TableCell>
                        <TableCell><Chip label={step.status} size="small" color={step.status === 'APPROVED' ? 'success' : step.status === 'REJECTED' ? 'error' : 'default'} /></TableCell>
                        <TableCell>{step.approverUser?.name ?? '—'}</TableCell>
                        <TableCell>{step.comments ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={createOpen || editOpen} onClose={() => { setCreateOpen(false); setEditOpen(false); setEditing(null); }} maxWidth="md" fullWidth>
        <DialogTitle>{editOpen ? `Edit Quotation ${editing?.quotationNumber ?? ''}` : 'Create Quotation'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {/* Vendor Selection */}
            <TextField
              select
              label="Vendor"
              value={selectedVendorId}
              onChange={(e) => { setSelectedVendorId(e.target.value); setLineItems([]); }}
              fullWidth
              size="small"
              disabled={editOpen}
              required
            >
              {vendors.map((v) => (
                <MenuItem key={v.id} value={v.id}>{v.vendorCode} - {v.name}</MenuItem>
              ))}
            </TextField>

            {/* Materials / Line Items */}
            {selectedVendorId && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body2" fontWeight={600}>Materials</Typography>
                  <Button size="small" startIcon={<AddIcon />} onClick={addLineItem} disabled={!selectedVendor?.materials?.length}>Add Material</Button>
                </Box>
                {selectedVendor?.materials?.length === 0 && (
                  <Alert severity="info">This vendor has no materials registered. Please add materials to the vendor first.</Alert>
                )}
                {lineItems.map((item, index) => (
                  <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <TextField
                      select
                      label="Material"
                      value={item.materialName}
                      onChange={(e) => {
                        const mat = selectedVendor?.materials?.find((m) => m.name === e.target.value);
                        const newQty = item.quantity;
                        const newPrice = mat?.pricePerUnit ? Number(mat.pricePerUnit) : item.unitPrice;
                        updateLineItem(index, 'materialName', e.target.value);
                        updateLineItem(index, 'unit', mat?.unit ?? '');
                        updateLineItem(index, 'unitPrice', newPrice);
                        // Recalculate amount
                        const updated = [...lineItems];
                        updated[index] = { ...updated[index], materialName: e.target.value, unit: mat?.unit ?? '', unitPrice: newPrice, amount: newQty * newPrice };
                        setLineItems(updated);
                      }}
                      size="small"
                      sx={{ flex: 2 }}
                    >
                      {selectedVendor?.materials?.map((m) => (
                        <MenuItem key={m.id} value={m.name}>{m.name}</MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      label="Qty"
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, 'quantity', Number(e.target.value))}
                      size="small"
                      sx={{ flex: 1 }}
                    />
                    <TextField
                      label="Unit"
                      value={item.unit ?? ''}
                      onChange={(e) => updateLineItem(index, 'unit', e.target.value)}
                      size="small"
                      sx={{ flex: 1 }}
                    />
                    <TextField
                      label="Unit Price"
                      type="number"
                      value={item.unitPrice}
                      onChange={(e) => updateLineItem(index, 'unitPrice', Number(e.target.value))}
                      size="small"
                      sx={{ flex: 1 }}
                    />
                    <TextField
                      label="Amount"
                      value={item.amount}
                      size="small"
                      disabled
                      sx={{ flex: 1 }}
                    />
                    <IconButton size="small" color="error" onClick={() => removeLineItem(index)}><RemoveIcon fontSize="small" /></IconButton>
                  </Box>
                ))}

                {/* Totals */}
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, mt: 1 }}>
                  <Typography variant="body2">Total: <strong>{formatCurrency(totalAmount)}</strong></Typography>
                  <TextField
                    label="GST Amount (optional)"
                    type="number"
                    value={gstAmount}
                    onChange={(e) => setGstAmount(e.target.value)}
                    size="small"
                    sx={{ width: 200 }}
                  />
                  <Typography variant="body2">Grand Total: <strong>{formatCurrency(grandTotal)}</strong></Typography>
                </Box>
              </Box>
            )}

            {/* File Upload */}
            <Box>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) setSelectedFile(f); }} />
              <Button variant="outlined" onClick={() => fileRef.current?.click()} startIcon={<AddIcon />}>
                {selectedFile ? `✓ ${selectedFile.name}` : 'Upload Photo/PDF'}
              </Button>
              {editing?.fileName && !selectedFile && (
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>Current: {editing.fileName}</Typography>
              )}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCreateOpen(false); setEditOpen(false); setEditing(null); resetForm(); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => { setError(''); if (editOpen) updateMutation.mutate(); else createMutation.mutate(); }}
            disabled={(!selectedVendorId || lineItems.length === 0) || createMutation.isPending || updateMutation.isPending}
          >
            {(createMutation.isPending || updateMutation.isPending) ? <CircularProgress size={20} /> : editOpen ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
