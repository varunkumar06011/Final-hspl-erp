import { useState, useMemo, useRef, useEffect } from 'react';
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
  Checkbox,
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  ExpandMore as ExpandMoreIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { APPROVER_ROLES, QuotationStatus } from '@hospital-erp/shared';
import { formatCurrency, formatDate, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { downloadFile } from '../utils/file';
import AcknowledgementCheckbox from '../components/AcknowledgementCheckbox';
import ApprovalActionDialog from '../components/ApprovalActionDialog';

interface QuotationItem {
  id?: string;
  materialName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface VendorMaterial {
  id: string;
  name: string;
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
  approverUserId?: string | null;
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
  const [selectedMaterialNames, setSelectedMaterialNames] = useState<Set<string>>(new Set());
  const [gstAmount, setGstAmount] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [approvalAction, setApprovalAction] = useState<{ row: QuotationRow; step: ApprovalStep; action: 'approve' | 'reject' } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

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
      const filteredItems = lineItems.filter((i) => selectedMaterialNames.has(i.materialName));
      const formData = new FormData();
      formData.append('vendorId', selectedVendorId);
      formData.append('items', JSON.stringify(filteredItems));
      formData.append('acknowledged', String(acknowledged));
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
    mutationFn: async ({ quotationId, stepId, comments, acknowledged }: { quotationId: string; stepId: string; comments?: string; acknowledged: true }) => {
      const response = await api.post(`/quotations/${quotationId}/approve/${stepId}`, { comments, acknowledged });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/quotations'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setApprovalAction(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ quotationId, stepId, reason, acknowledged }: { quotationId: string; stepId: string; reason: string; acknowledged: true }) => {
      const response = await api.post(`/quotations/${quotationId}/reject/${stepId}`, { reason, acknowledged });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/quotations'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setApprovalAction(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: QuotationRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const vendors: { id: string; name: string; vendorCode: string }[] = vendorsData?.data ?? [];

  const totalAmount = useMemo(
    () => lineItems.filter((i) => selectedMaterialNames.has(i.materialName)).reduce((sum, i) => sum + Number(i.amount), 0),
    [lineItems, selectedMaterialNames]
  );
  const grandTotal = totalAmount + (Number(gstAmount) || 0);

  function resetForm() {
    setSelectedVendorId('');
    setLineItems([]);
    setSelectedMaterialNames(new Set());
    setGstAmount('');
    setAcknowledged(false);
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
      unitPrice: Number(i.unitPrice),
      amount: Number(i.amount),
    })));
    setSelectedMaterialNames(new Set(row.items.map((item) => item.materialName)));
    setGstAmount(String(row.gstAmount ?? ''));
    setSelectedFile(null);
    setError('');
    setEditOpen(true);
  }

  // Auto-populate line items from vendor materials when vendor is selected (create mode)
  useEffect(() => {
    if (!createOpen || !selectedVendor?.materials) return;
    const items = selectedVendor.materials.map((m) => ({
      materialName: m.name,
      quantity: 1,
      unitPrice: m.pricePerUnit ? Number(m.pricePerUnit) : 0,
      amount: m.pricePerUnit ? Number(m.pricePerUnit) : 0,
    }));
    setLineItems(items);
    // All materials ticked by default
    setSelectedMaterialNames(new Set(selectedVendor.materials.map((m) => m.name)));
  }, [selectedVendor, createOpen]);

  function updateLineItem(index: number, field: keyof QuotationItem, value: string | number) {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    if (field === 'quantity' || field === 'unitPrice') {
      updated[index].amount = Number(updated[index].quantity) * Number(updated[index].unitPrice);
    }
    setLineItems(updated);
  }

  function canApprove(row: QuotationRow): ApprovalStep | null {
    if (!row.approvalWorkflow || !user || !APPROVER_ROLES.some((role) => role === user.role)) return null;
    if (![QuotationStatus.SUBMITTED, QuotationStatus.UNDER_REVIEW].includes(row.status as QuotationStatus)) return null;
    const alreadyDecided = row.approvalWorkflow.steps.some(
      (step) => step.approverUserId === user.id && step.status !== 'PENDING'
    );
    if (alreadyDecided) return null;
    return row.approvalWorkflow.steps.find(
      (step) => step.approverRole === user.role && step.status === 'PENDING'
    ) ?? null;
  }

  function handleDownload(id: string, fileName: string) {
    downloadFile('quotations', id, fileName).catch(() => setError('Failed to download file'));
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
                          <IconButton size="small" onClick={() => handleDownload(row.id, row.fileName ?? 'quotation')}><DownloadIcon fontSize="small" /></IconButton>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {row.status === QuotationStatus.SUBMITTED || row.status === QuotationStatus.UNDER_REVIEW ? (
                            <IconButton size="small" onClick={() => openEdit(row)}><EditIcon /></IconButton>
                          ) : null}
                          {pendingStep && (
                            <>
                              <IconButton size="small" color="success" onClick={() => setApprovalAction({ row, step: pendingStep, action: 'approve' })} title="Approve"><CheckIcon fontSize="small" /></IconButton>
                              <IconButton size="small" color="error" onClick={() => setApprovalAction({ row, step: pendingStep, action: 'reject' })} title="Reject"><CloseIcon fontSize="small" /></IconButton>
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
              onChange={(e) => { setSelectedVendorId(e.target.value); setLineItems([]); setSelectedMaterialNames(new Set()); }}
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
                <Typography variant="body2" fontWeight={600}>Materials (tick the ones you need)</Typography>
                {selectedVendor?.materials?.length === 0 && (
                  <Alert severity="info">This vendor has no materials registered. Please add materials to the vendor first.</Alert>
                )}
                {lineItems.map((item, index) => {
                  const checked = selectedMaterialNames.has(item.materialName);
                  return (
                    <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Checkbox
                        checked={checked}
                        onChange={(e) => {
                          const newSet = new Set(selectedMaterialNames);
                          if (e.target.checked) {
                            newSet.add(item.materialName);
                          } else {
                            newSet.delete(item.materialName);
                          }
                          setSelectedMaterialNames(newSet);
                        }}
                        size="small"
                      />
                      <TextField
                        label="Material"
                        value={item.materialName}
                        size="small"
                        disabled
                        sx={{ flex: 2 }}
                      />
                      <TextField
                        label="Qty"
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(index, 'quantity', Number(e.target.value))}
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
                    </Box>
                  );
                })}

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

            {!editOpen && (
              <AcknowledgementCheckbox
                checked={acknowledged}
                onChange={setAcknowledged}
                entityLabel="quotation"
              />
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
            disabled={(!selectedVendorId || selectedMaterialNames.size === 0 || (!editOpen && !acknowledged)) || createMutation.isPending || updateMutation.isPending}
          >
            {(createMutation.isPending || updateMutation.isPending) ? <CircularProgress size={20} /> : editOpen ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <ApprovalActionDialog
        open={approvalAction !== null}
        action={approvalAction?.action ?? 'approve'}
        entityLabel="Quotation"
        pending={approveMutation.isPending || rejectMutation.isPending}
        onClose={() => setApprovalAction(null)}
        onConfirm={(payload) => {
          if (!approvalAction) return;
          if (approvalAction.action === 'approve') {
            approveMutation.mutate({
              quotationId: approvalAction.row.id,
              stepId: approvalAction.step.id,
              comments: payload.comments,
              acknowledged: true,
            });
          } else {
            rejectMutation.mutate({
              quotationId: approvalAction.row.id,
              stepId: approvalAction.step.id,
              reason: payload.reason!,
              acknowledged: true,
            });
          }
        }}
      />
    </Box>
  );
}
