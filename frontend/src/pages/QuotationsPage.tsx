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
import ResponsiveDialog from '../components/ResponsiveDialog';
import ApprovalStepsDisplay from '../components/ApprovalStepsDisplay';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  ExpandMore as ExpandMoreIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { APPROVER_ROLES, QuotationStatus, GST_RATES } from '@hospital-erp/shared';
import { formatCurrency, formatDate, formatIndianNumber, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { downloadFile } from '../utils/file';
import AcknowledgementCheckbox from '../components/AcknowledgementCheckbox';
import ApprovalActionDialog from '../components/ApprovalActionDialog';
import OcrAutoFill, { type OcrQuotationData } from '../components/OcrAutoFill';
import ResponsiveTable from '../components/ResponsiveTable';
import { useApprovalDeepLink } from '../utils/useApprovalDeepLink';

interface QuotationItem {
  id?: string;
  materialName: string;
  quantity: number | '';
  unit?: string | null;
  unitPrice: string | number | '';
  amount: number;
  gstRate: number;
}

interface VendorMaterial {
  id: string;
  name: string;
  unit?: string | null;
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
  createdAt: string;
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
  const [acknowledged, setAcknowledged] = useState(false);
  const [approvalAction, setApprovalAction] = useState<{ row: QuotationRow; step: ApprovalStep; action: 'approve' | 'reject' } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const createSubmissionLocked = useRef(false);
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
      const filteredItems = lineItems
        .filter((i) => selectedMaterialNames.has(i.materialName))
        .map((i) => ({ materialName: i.materialName, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, gstRate: i.gstRate }));
      const formData = new FormData();
      formData.append('vendorId', selectedVendorId);
      formData.append('items', JSON.stringify(filteredItems));
      formData.append('acknowledged', String(acknowledged));
      if (selectedFile) formData.append('file', selectedFile);
      const response = await api.post('/quotations', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    },
    onSuccess: () => {
      createSubmissionLocked.current = false;
      queryClient.invalidateQueries({ queryKey: ['/quotations'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: unknown) => {
      createSubmissionLocked.current = false;
      setError(extractErrorMessage(err));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append('items', JSON.stringify(lineItems.filter((i) => selectedMaterialNames.has(i.materialName)).map((i) => ({ materialName: i.materialName, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, gstRate: i.gstRate }))));
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

  const validateQuotationForm = (): boolean => {
    const items = lineItems.filter((item) => selectedMaterialNames.has(item.materialName));
    if (!selectedVendorId) {
      setError('Please select a vendor');
      return false;
    }
    if (items.length === 0) {
      setError('Add at least one material');
      return false;
    }
    if (items.some((item) => !item.materialName.trim() || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) {
      setError('Each material must have a name and a quantity greater than zero');
      return false;
    }
    if (items.some((item) => !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0)) {
      setError('Unit price cannot be negative or invalid');
      return false;
    }
    if (!editOpen && !acknowledged) {
      setError('Please acknowledge the quotation before creating it');
      return false;
    }
    if (selectedFile && (!['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'].includes(selectedFile.type) || selectedFile.size > 100 * 1024 * 1024)) {
      setError('Quotation file must be a PDF or image (JPG, PNG, GIF, WebP, BMP, TIFF) smaller than 100 MB');
      return false;
    }
    return true;
  };

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

  const [deleteRow, setDeleteRow] = useState<QuotationRow | null>(null);
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/quotations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/quotations'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setDeleteRow(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: QuotationRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const vendors: { id: string; name: string; vendorCode: string }[] = vendorsData?.data ?? [];

  // Auto-open approval dialog when navigated from a push notification
  useApprovalDeepLink(rows, (row) => {
    const step = canApprove(row);
    if (step) setApprovalAction({ row, step, action: 'approve' });
  });

  const totalAmount = useMemo(
    () => lineItems.filter((i) => selectedMaterialNames.has(i.materialName)).reduce((sum, i) => sum + Number(i.amount), 0),
    [lineItems, selectedMaterialNames]
  );
  const gstAmount = useMemo(
    () => lineItems
      .filter((i) => selectedMaterialNames.has(i.materialName))
      .reduce((sum, i) => sum + Number(i.amount) * Number(i.gstRate) / 100, 0),
    [lineItems, selectedMaterialNames]
  );
  const grandTotal = totalAmount + gstAmount;

  function resetForm() {
    setSelectedVendorId('');
    setLineItems([]);
    setSelectedMaterialNames(new Set());
    setAcknowledged(false);
    setSelectedFile(null);
    setError('');
  }

  function openCreate() {
    createSubmissionLocked.current = false;
    resetForm();
    setCreateOpen(true);
  }

  function handleCreateQuotation() {
    if (createSubmissionLocked.current || createMutation.isPending) return;
    if (!validateQuotationForm()) return;
    createSubmissionLocked.current = true;
    setError('');
    createMutation.mutate();
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
      gstRate: Number(i.gstRate) || 0,
    })));
    setSelectedMaterialNames(new Set(row.items.map((item) => item.materialName)));
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
      unitPrice: 0,
      amount: 0,
      gstRate: 0,
    }));
    setLineItems(items);
    // All materials ticked by default
    setSelectedMaterialNames(new Set(selectedVendor.materials.map((m) => m.name)));
  }, [selectedVendor, createOpen]);

  // In edit mode, merge in any vendor materials that were added after the quotation was created
  // so they appear as unticked rows the user can opt into.
  useEffect(() => {
    if (!editOpen || !selectedVendor?.materials) return;
    setLineItems((prev) => {
      const existingNames = new Set(prev.map((i) => i.materialName));
      const newItems = selectedVendor.materials
        .filter((m) => !existingNames.has(m.name))
        .map((m) => ({
          materialName: m.name,
          quantity: 1,
          unitPrice: 0,
          amount: 0,
          gstRate: 0,
        }));
      if (newItems.length === 0) return prev;
      return [...prev, ...newItems];
    });
  }, [selectedVendor, editOpen]);

  function updateLineItem(index: number, field: keyof QuotationItem, value: string | number) {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    if (field === 'quantity' || field === 'unitPrice') {
      updated[index].amount = Number(updated[index].quantity) * Number(updated[index].unitPrice);
    }
    setLineItems(updated);
  }

  // GST rate options for the dropdown
  const gstRateOptions = GST_RATES;

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

  function handleOcrExtract(data: OcrQuotationData) {
    if (data.lineItems.length > 0) {
      const vendorMaterialsLower = new Set(
        (selectedVendor?.materials ?? []).map((m) => m.name.toLowerCase())
      );
      const existingNamesLower = new Set(lineItems.map((i) => i.materialName.toLowerCase()));

      // Update existing items that match OCR items
      const matched = new Set<string>();
      const updatedItems = lineItems.map((item) => {
        const ocrMatch = data.lineItems.find(
          (o) => o.materialName.toLowerCase() === item.materialName.toLowerCase()
        );
        if (ocrMatch) {
          matched.add(item.materialName.toLowerCase());
          const qty = Number(ocrMatch.quantity) || item.quantity;
          const price = Number(ocrMatch.unitPrice) || item.unitPrice;
          return { ...item, quantity: qty, unitPrice: price, amount: Number(qty) * Number(price) };
        }
        // Also try partial match (OCR may have slightly different name)
        const partialMatch = data.lineItems.find((o) => {
          const ocrLower = o.materialName.toLowerCase();
          const itemLower = item.materialName.toLowerCase();
          return ocrLower.includes(itemLower) || itemLower.includes(ocrLower);
        });
        if (partialMatch) {
          matched.add(item.materialName.toLowerCase());
          const qty = Number(partialMatch.quantity) || item.quantity;
          const price = Number(partialMatch.unitPrice) || item.unitPrice;
          return { ...item, quantity: qty, unitPrice: price, amount: Number(qty) * Number(price) };
        }
        return item;
      });

      // Add OCR items that don't match any existing line item as NEW items
      const newItems: QuotationItem[] = [];
      data.lineItems.forEach((o) => {
        const ocrLower = o.materialName.toLowerCase();
        const isMatched = matched.has(ocrLower) || existingNamesLower.has(ocrLower) || vendorMaterialsLower.has(ocrLower);
        if (!isMatched && o.materialName.trim()) {
          const qty = Number(o.quantity) || 1;
          const price = Number(o.unitPrice) || 0;
          newItems.push({
            materialName: o.materialName,
            quantity: qty,
            unitPrice: price,
            amount: qty * price,
            gstRate: 0,
          });
        }
      });

      const allItems = [...updatedItems, ...newItems];
      setLineItems(allItems);

      // Select all matched + new items
      const allSelected = new Set<string>();
      matched.forEach((name) => allSelected.add(name));
      newItems.forEach((item) => allSelected.add(item.materialName));
      // Also keep previously selected items
      selectedMaterialNames.forEach((name) => {
        if (allItems.some((i) => i.materialName === name)) {
          allSelected.add(name);
        }
      });
      setSelectedMaterialNames(allSelected);

      if (newItems.length > 0) {
        setError(`${newItems.length} new item(s) extracted from the document and added. Review and tick the ones you need.`);
      }
    }
    if (data.vendorId) {
      setSelectedVendorId(data.vendorId);
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>Quotations</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <IconButton onClick={() => refetch()} size="small"><RefreshIcon /></IconButton>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>Add Quotation</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Card>
        <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="Search quotations..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />
          <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} sx={{ width: { xs: '100%', sm: 180 } }}>
            <MenuItem value="">All</MenuItem>
            {Object.values(QuotationStatus).map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
          </TextField>
        </Box>

        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Quotation No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Quotation Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Generated On</TableCell>
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
                <TableRow><TableCell colSpan={11} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={11} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No quotations found</Typography></TableCell></TableRow>
              ) : (
                rows.map((row) => {
                  const pendingStep = canApprove(row);
                  return (
                    <TableRow key={row.id} hover>
                      <TableCell data-label="Quotation No">{row.quotationNumber}</TableCell>
                      <TableCell data-label="Vendor">{row.vendor?.vendorCode} - {row.vendor?.name ?? '—'}</TableCell>
                      <TableCell data-label="Quotation Date">{formatDate(row.date)}</TableCell>
                      <TableCell data-label="Generated On"><Typography variant="caption" color="text.secondary">{formatDate(row.createdAt)}</Typography></TableCell>
                      <TableCell data-label="Total">{formatCurrency(row.totalAmount)}</TableCell>
                      <TableCell data-label="GST">{formatCurrency(row.gstAmount)}</TableCell>
                      <TableCell data-label="Grand Total">{formatCurrency(row.grandTotal)}</TableCell>
                      <TableCell data-label="Created By">{row.createdByUser?.name ?? '—'}</TableCell>
                      <TableCell data-label="Status"><Chip label={row.status.replace(/_/g, ' ')} size="small" color={STATUS_COLORS[row.status] ?? 'default'} /></TableCell>
                      <TableCell data-label="File">
                        {row.filePath ? (
                          <IconButton size="small" onClick={() => handleDownload(row.id, row.fileName ?? 'quotation')}><DownloadIcon fontSize="small" /></IconButton>
                        ) : '—'}
                      </TableCell>
                      <TableCell data-label="Actions">
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
                          {row.status !== QuotationStatus.APPROVED && row.status !== QuotationStatus.CONVERTED_TO_PO && (
                            <IconButton size="small" color="error" onClick={() => setDeleteRow(row)} title="Delete"><DeleteIcon fontSize="small" /></IconButton>
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
        </ResponsiveTable>

        <TablePagination
          component="div"
          count={pagination.total}
          page={page}
          onPageChange={(_e, p) => setPage(p)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 20, 50]}
          sx={{ '& .MuiTablePagination-toolbar': { flexWrap: 'wrap' } }}
        />
      </Card>

      {/* Approval details accordion for each quotation with a workflow */}
      {rows.length > 0 && rows.some((r) => r.approvalWorkflow) && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>Approval Status</Typography>
          {rows.filter((r) => r.approvalWorkflow).map((row) => (
            <Accordion key={row.id}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography component="span"><strong>{row.quotationNumber}</strong> — {row.vendor?.name} — Status: </Typography>
                  <Chip label={row.approvalWorkflow!.status} size="small" color={STATUS_COLORS[row.approvalWorkflow!.status] ?? 'default'} />
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <ApprovalStepsDisplay steps={row.approvalWorkflow!.steps} />
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      )}

      {/* Create / Edit Dialog */}
      <ResponsiveDialog open={createOpen || editOpen} onClose={() => { setCreateOpen(false); setEditOpen(false); setEditing(null); }} maxWidth="md" fullWidth sx={{ '& .MuiDialog-paper': { margin: { xs: 1 } } }}>
        <DialogTitle>{editOpen ? `Edit Quotation ${editing?.quotationNumber ?? ''}` : 'Create Quotation'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1, flexWrap: 'wrap' }}>
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
                    <Box key={index} sx={{
                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' },
                      gap: 1,
                      alignItems: { xs: 'stretch', sm: 'center' },
                      py: { xs: 1, sm: 0 },
                      borderBottom: { xs: '1px solid', sm: 'none' },
                      borderColor: { xs: 'divider', sm: 'transparent' },
                    }}>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', minWidth: 0 }}>
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
                          sx={{ flexShrink: 0 }}
                        />
                        <TextField
                          label="Material"
                          value={item.materialName}
                          size="small"
                          disabled
                          sx={{ flex: 2, minWidth: 0 }}
                        />
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', pl: { xs: 5.5, sm: 0 }, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
                        <TextField
                          label="Qty"
                          type="text"
                          value={formatIndianNumber(item.quantity)}
                          onChange={(e) => updateLineItem(index, 'quantity', e.target.value === '' ? '' : Number(e.target.value.replace(/,/g, '')))}
                          inputMode="decimal"
                          inputProps={{ min: 0.01, step: 0.01 }}
                          size="small"
                          sx={{ flex: 1, minWidth: 0 }}
                        />
                        <TextField
                          label="Unit Price"
                          type="text"
                          value={formatIndianNumber(item.unitPrice)}
                          onChange={(e) => updateLineItem(index, 'unitPrice', e.target.value === '' ? '' : e.target.value.replace(/,/g, ''))}
                          inputMode="decimal"
                          inputProps={{ min: 0, step: 0.01 }}
                          size="small"
                          sx={{ flex: 1, minWidth: 0 }}
                        />
                        <TextField
                          select
                          label="GST %"
                          value={item.gstRate}
                          onChange={(e) => updateLineItem(index, 'gstRate', Number(e.target.value))}
                          size="small"
                          sx={{ flex: { xs: '1 1 80px', sm: '0 0 90px' }, minWidth: 80 }}
                        >
                          {gstRateOptions.map((rate) => (
                            <MenuItem key={rate} value={rate}>{rate}%</MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          label="Amount"
                          value={formatIndianNumber(item.amount)}
                          size="small"
                          disabled
                          sx={{ flex: 1, minWidth: 0 }}
                        />
                      </Box>
                    </Box>
                  );
                })}

                {/* Totals */}
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: { xs: 'stretch', sm: 'flex-end' }, gap: 1, mt: 1 }}>
                  <Typography variant="body2" sx={{ textAlign: { xs: 'left', sm: 'right' } }}>Total: <strong>{formatCurrency(totalAmount)}</strong></Typography>
                  <Typography variant="body2" sx={{ textAlign: { xs: 'left', sm: 'right' } }}>GST (auto-calculated): <strong>{formatCurrency(gstAmount)}</strong></Typography>
                  <Typography variant="body2" sx={{ textAlign: { xs: 'left', sm: 'right' } }}>Grand Total: <strong>{formatCurrency(grandTotal)}</strong></Typography>
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
              <OcrAutoFill
                file={selectedFile}
                documentType="QUOTATION"
                onExtract={handleOcrExtract}
                disabled={!selectedVendorId}
              />
              {!selectedVendorId && selectedFile && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Select a vendor first to auto-fill line items
                </Typography>
              )}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCreateOpen(false); setEditOpen(false); setEditing(null); resetForm(); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={editOpen ? () => { setError(''); if (validateQuotationForm()) updateMutation.mutate(); } : handleCreateQuotation}
            disabled={createMutation.isPending || updateMutation.isPending || (!editOpen && (!acknowledged || createSubmissionLocked.current))}
          >
            {(createMutation.isPending || updateMutation.isPending) ? <CircularProgress size={20} /> : editOpen ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

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

      <ResponsiveDialog open={deleteRow !== null} onClose={() => setDeleteRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Quotation</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete quotation <strong>{deleteRow?.quotationNumber}</strong>?</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            This action cannot be undone. Only quotations that are not approved or converted to a PO can be deleted.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRow(null)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={deleteMutation.isPending} onClick={() => deleteRow && deleteMutation.mutate(deleteRow.id)}>
            {deleteMutation.isPending ? <CircularProgress size={20} /> : 'Delete'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
