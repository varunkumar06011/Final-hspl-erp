import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Card, CardContent, Chip, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, CircularProgress,
  MenuItem, InputAdornment, Grid, Alert, ToggleButtonGroup, ToggleButton, Divider, Autocomplete,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Download as DownloadIcon,
  PictureAsPdf as PdfIcon,
  Send as SendIcon,
  Close as CloseIcon,
  Search as SearchIcon,
  Check as CheckIcon,
  RequestQuote as QuotationIcon,
  ReceiptLong as ReceiptIcon,
  Balance as VarianceIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MPRStatus, isApproverRole } from '@hospital-erp/shared';
import { formatDate, STATUS_COLORS, QTY_UNIT_OPTIONS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import ApprovalStepsDisplay from '../components/ApprovalStepsDisplay';
import ApprovalActionDialog from '../components/ApprovalActionDialog';
import ResponsiveDialog from '../components/ResponsiveDialog';

interface MPRItem {
  materialName: string;
  materialCode?: string;
  specification?: string;
  quantity: string | number;
  unit?: string;
  requiredDate?: string;
  estimatedRate?: string | number;
  remarks?: string;
}

interface ApprovalStep {
  id: string;
  stepNumber: number;
  approverRole: string;
  status: string;
  approverUserId?: string | null;
  approverUser?: { id: string; name: string; role: string } | null;
  comments?: string | null;
}

interface MPRRow {
  id: string;
  mprNumber: string;
  date: string;
  requiredBy?: string | null;
  department?: string | null;
  priority?: string | null;
  status: string;
  description?: string | null;
  deliveryAddress?: string | null;
  contactPerson?: string | null;
  contactNumber?: string | null;
  billingAddress?: string | null;
  stateCode?: string | null;
  requestRaisedById?: string | null;
  requestRaisedBy?: { id: string; name: string } | null;
  technicalRequirements?: string | null;
  createdByUser: { id: string; name: string };
  items: MPRItem[];
  vendorId?: string | null;
  vendor?: { id: string; name: string; vendorCode: string; vendorType: string; phone?: string | null; contactPersonPhone?: string | null } | null;
  quotations?: { id: string; quotationNumber: string; status: string; grandTotal: number }[];
  approvalWorkflowId?: string | null;
  approvalWorkflow?: { id: string; status: string; currentStep: number; steps: ApprovalStep[] } | null;
  receiptFilePath?: string | null;
  receiptFileName?: string | null;
}

interface Vendor {
  id: string;
  name: string;
  vendorCode: string;
  vendorType: string;
}

interface VarianceRow {
  materialName: string;
  unit: string | null;
  requestedQty: number;
  quotedQty: number;
  quotedRate: number;
  orderedQty: number;
  orderedRate: number;
  qtyVarianceVsRequested: number;
  qtyVarianceVsQuoted: number;
  rateVarianceVsQuoted: number;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Pending Approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  QUOTATIONS_RECEIVED: 'Quotations Received',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export default function MaterialPurchaseRequestsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState<MPRRow | null>(null);
  const [error, setError] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [approvalAction, setApprovalAction] = useState<{ row: MPRRow; step: ApprovalStep; action: 'approve' | 'reject' } | null>(null);
  const [receiptRow, setReceiptRow] = useState<MPRRow | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptNotes, setReceiptNotes] = useState('');
  const [varianceRow, setVarianceRow] = useState<MPRRow | null>(null);

  const MPR_DRAFT_KEY = 'mpr_form_draft';
  const MPR_DEPARTMENTS_KEY = 'mpr_department_history';

  // Remembered department names, so previously typed values can be picked again instead of retyped.
  const [departmentOptions, setDepartmentOptions] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DEPARTMENTS_KEY) || '[]'); } catch { return []; }
  });

  function rememberDepartment(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setDepartmentOptions((prev) => {
      const next = [trimmed, ...prev.filter((d) => d.toLowerCase() !== trimmed.toLowerCase())].slice(0, 20);
      try { localStorage.setItem(MPR_DEPARTMENTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  // Form state — initialized from localStorage if available
  const [requiredBy, setRequiredBy] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').requiredBy ?? ''; } catch { return ''; }
  });
  const [department, setDepartment] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').department ?? ''; } catch { return ''; }
  });
  const [priority, setPriority] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').priority ?? 'Normal'; } catch { return 'Normal'; }
  });
  const [description, setDescription] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').description ?? ''; } catch { return ''; }
  });
  const [deliveryAddress, setDeliveryAddress] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').deliveryAddress ?? ''; } catch { return ''; }
  });
  const [contactPerson, setContactPerson] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').contactPerson ?? ''; } catch { return ''; }
  });
  const [contactNumber, setContactNumber] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').contactNumber ?? ''; } catch { return ''; }
  });
  const [billingAddress, setBillingAddress] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').billingAddress ?? ''; } catch { return ''; }
  });
  const [stateCode, setStateCode] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').stateCode ?? ''; } catch { return ''; }
  });
  const [requestRaisedById, setRequestRaisedById] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').requestRaisedById ?? ''; } catch { return ''; }
  });
  const [technicalRequirements, setTechnicalRequirements] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').technicalRequirements ?? ''; } catch { return ''; }
  });
  const [items, setItems] = useState<MPRItem[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').items;
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch { /* ignore */ }
    return [{ materialName: '', materialCode: '', quantity: '', unit: 'nos', requiredDate: '', estimatedRate: '', remarks: '' }];
  });

  // Vendor selection — an existing vendor, or a brand-new one created inline
  // (name + phone + type only). Non-vendor requests skip the Quotation step.
  const [vendorMode, setVendorMode] = useState<'existing' | 'new'>('existing');
  const [selectedVendorId, setSelectedVendorId] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').selectedVendorId ?? ''; } catch { return ''; }
  });
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorPhone, setNewVendorPhone] = useState('');
  const [newVendorType, setNewVendorType] = useState<'VENDOR' | 'NON_VENDOR'>('VENDOR');

  // Persist form state to localStorage whenever it changes (only for new MPR, not editing)
  useEffect(() => {
    if (editRow) return; // Don't save when editing an existing MPR
    const draft = {
      requiredBy, department, priority, description, deliveryAddress,
      contactPerson, contactNumber, billingAddress, stateCode,
      requestRaisedById, technicalRequirements, items, selectedVendorId,
    };
    try { localStorage.setItem(MPR_DRAFT_KEY, JSON.stringify(draft)); } catch { /* ignore quota errors */ }
  }, [requiredBy, department, priority, description, deliveryAddress, contactPerson, contactNumber, billingAddress, stateCode, requestRaisedById, technicalRequirements, items, selectedVendorId, editRow]);

  const { data, isLoading } = useQuery({
    queryKey: ['mprs', search, statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/material-purchase-requests', { params });
      return res.data;
    },
  });

  const { data: usersData } = useQuery({
    queryKey: ['/work-tasks/assignable-users'],
    queryFn: async () => (await api.get('/work-tasks/assignable-users')).data?.data ?? [],
  });
  const users: { id: string; name: string; role: string }[] = usersData ?? [];

  const { data: vendorsData } = useQuery({
    queryKey: ['/vendors', 'for-mpr'],
    queryFn: async () => (await api.get('/vendors', { params: { pageSize: 200 } })).data,
  });
  const vendors: Vendor[] = vendorsData?.data ?? [];

  // Project settings — Delivery Address defaults to the hospital site address,
  // Billing Address to the office ("Bill To") address, both configured once
  // in Settings instead of retyped on every MPR.
  const { data: projectSettings } = useQuery({
    queryKey: ['/settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  const { data: varianceData, isLoading: varianceLoading } = useQuery({
    queryKey: ['/material-purchase-requests', varianceRow?.id, 'variance'],
    queryFn: async () => (await api.get(`/material-purchase-requests/${varianceRow!.id}/variance`)).data,
    enabled: !!varianceRow,
  });
  const varianceItems: VarianceRow[] = varianceData?.items ?? [];

  const mprs: MPRRow[] = data?.data ?? [];

  function resetForm() {
    setRequiredBy('');
    setDepartment('');
    setPriority('Normal');
    setDescription('');
    setDeliveryAddress('');
    setContactPerson('');
    setContactNumber('');
    setBillingAddress('');
    setStateCode('');
    setRequestRaisedById('');
    setTechnicalRequirements('');
    setItems([{ materialName: '', materialCode: '', quantity: '', unit: 'nos', requiredDate: '', estimatedRate: '', remarks: '' }]);
    setVendorMode('existing');
    setSelectedVendorId('');
    setNewVendorName('');
    setNewVendorPhone('');
    setNewVendorType('VENDOR');
    try { localStorage.removeItem(MPR_DRAFT_KEY); } catch { /* ignore */ }
  }

  function openCreate() {
    resetForm();
    setEditRow(null);
    // Default Delivery/Billing address from Settings (Hospital Address →
    // Delivery, Office Address → Bill To) instead of retyping every time.
    // Still editable per-request — this only sets the starting value.
    if (projectSettings?.hospitalAddress) setDeliveryAddress(projectSettings.hospitalAddress);
    if (projectSettings?.officeAddress) setBillingAddress(projectSettings.officeAddress);
    setCreateOpen(true);
  }

  function openEdit(row: MPRRow) {
    setEditRow(row);
    setRequiredBy(row.requiredBy ? new Date(row.requiredBy).toISOString().slice(0, 10) : '');
    setDepartment(row.department ?? '');
    setPriority(row.priority ?? 'Normal');
    setDescription(row.description ?? '');
    setDeliveryAddress(row.deliveryAddress ?? '');
    setContactPerson(row.contactPerson ?? '');
    setContactNumber(row.contactNumber ?? '');
    setBillingAddress(row.billingAddress ?? '');
    setStateCode(row.stateCode ?? '');
    setRequestRaisedById(row.requestRaisedById ?? '');
    setTechnicalRequirements(row.technicalRequirements ?? '');
    setItems(row.items.map((i) => ({
      materialName: i.materialName,
      materialCode: i.materialCode ?? '',
      specification: i.specification ?? '',
      quantity: String(i.quantity),
      unit: i.unit ?? 'nos',
      requiredDate: i.requiredDate ? new Date(i.requiredDate).toISOString().slice(0, 10) : '',
      estimatedRate: i.estimatedRate !== undefined && i.estimatedRate !== null ? String(i.estimatedRate) : '',
      remarks: i.remarks ?? '',
    })));
    setVendorMode('existing');
    setSelectedVendorId(row.vendorId ?? '');
    setNewVendorName('');
    setNewVendorPhone('');
    setNewVendorType('VENDOR');
    setCreateOpen(true);
  }

  function updateItem(index: number, field: keyof MPRItem, value: string | number) {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  }

  function addItem() {
    setItems([...items, { materialName: '', materialCode: '', quantity: '', unit: 'nos', requiredDate: '', estimatedRate: '', remarks: '' }]);
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index));
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        requiredBy: requiredBy || undefined,
        department: department || undefined,
        priority: priority || undefined,
        description: description || undefined,
        deliveryAddress: deliveryAddress || undefined,
        contactPerson: contactPerson || undefined,
        contactNumber: contactNumber || undefined,
        billingAddress: billingAddress || undefined,
        stateCode: stateCode || undefined,
        requestRaisedById: requestRaisedById || undefined,
        technicalRequirements: technicalRequirements || undefined,
        items: items.map((i) => ({
          materialName: i.materialName,
          materialCode: i.materialCode || undefined,
          specification: i.specification || undefined,
          quantity: Number(i.quantity),
          unit: i.unit || undefined,
          requiredDate: i.requiredDate || undefined,
          estimatedRate: i.estimatedRate !== undefined && i.estimatedRate !== '' ? Number(i.estimatedRate) : undefined,
          remarks: i.remarks || undefined,
        })),
      };
      if (vendorMode === 'existing' && selectedVendorId) {
        payload.vendorId = selectedVendorId;
      } else if (vendorMode === 'new' && newVendorName.trim()) {
        payload.newVendor = { name: newVendorName.trim(), phone: newVendorPhone.trim() || undefined, vendorType: newVendorType };
      }
      if (editRow) {
        const res = await api.put(`/material-purchase-requests/${editRow.id}`, payload);
        return res.data;
      }
      const res = await api.post('/material-purchase-requests', payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mprs'] });
      queryClient.invalidateQueries({ queryKey: ['/vendors'] });
      setCreateOpen(false);
      setError('');
      rememberDepartment(department);
      try { localStorage.removeItem(MPR_DRAFT_KEY); } catch { /* ignore */ }
    },
    onError: (err: unknown) => {
      setError(extractErrorMessage(err));
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/material-purchase-requests/${id}/submit`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mprs'] });
    },
    onError: (err: unknown) => {
      setError(extractErrorMessage(err));
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/material-purchase-requests/${id}/cancel`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mprs'] });
    },
    onError: (err: unknown) => {
      setError(extractErrorMessage(err));
    },
  });

  const closeMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/material-purchase-requests/${id}/close`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mprs'] });
    },
    onError: (err: unknown) => {
      setError(extractErrorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/material-purchase-requests/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mprs'] });
    },
    onError: (err: unknown) => {
      setError(extractErrorMessage(err));
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ mprId, comments }: { mprId: string; comments?: string }) => {
      await api.post(`/material-purchase-requests/${mprId}/approve`, { comments, acknowledged: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mprs'] });
      setApprovalAction(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ mprId, reason }: { mprId: string; reason: string }) => {
      await api.post(`/material-purchase-requests/${mprId}/reject`, { reason, acknowledged: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mprs'] });
      setApprovalAction(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const receiptMutation = useMutation({
    mutationFn: async () => {
      if (!receiptRow || !receiptFile) return;
      const formData = new FormData();
      formData.append('file', receiptFile);
      if (receiptNotes.trim()) formData.append('notes', receiptNotes.trim());
      await api.post(`/material-purchase-requests/${receiptRow.id}/receipt`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mprs'] });
      setReceiptRow(null);
      setReceiptFile(null);
      setReceiptNotes('');
      setError('');
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  function canApprove(row: MPRRow): ApprovalStep | null {
    if (!row.approvalWorkflow || !user || !isApproverRole(user.role)) return null;
    if (row.status !== MPRStatus.SUBMITTED) return null;
    const alreadyDecided = row.approvalWorkflow.steps.some(
      (step) => step.approverUserId === user.id && step.status !== 'PENDING'
    );
    if (alreadyDecided) return null;
    return row.approvalWorkflow.steps.find(
      (step) => step.approverRole === user.role && step.status === 'PENDING'
    ) ?? null;
  }

  function raiseQuotation(row: MPRRow) {
    if (!row.vendorId) return;
    navigate(`/quotations?create=true&vendorId=${row.vendorId}&mprId=${row.id}`);
  }

  function downloadReceipt(mprId: string, fileName: string) {
    const token = localStorage.getItem('firebaseToken');
    const url = `${api.defaults.baseURL}/material-purchase-requests/${mprId}/receipt?_t=${Date.now()}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const objUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = fileName;
        a.click();
        window.URL.revokeObjectURL(objUrl);
      })
      .catch(() => setError('Failed to open receipt'));
  }

  function downloadPDF(mprId: string, mprNumber: string) {
    const token = localStorage.getItem('firebaseToken');
    const url = `${api.defaults.baseURL}/material-purchase-requests/${mprId}/pdf?_t=${Date.now()}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const objUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = `${mprNumber}.pdf`;
        a.click();
        window.URL.revokeObjectURL(objUrl);
      })
      .catch(() => setError('Failed to download PDF'));
  }

  function previewPDF(mprId: string) {
    if (pdfLoading) return;
    setPdfLoading(true);
    const token = localStorage.getItem('firebaseToken');
    const url = `${api.defaults.baseURL}/material-purchase-requests/${mprId}/pdf?_t=${Date.now()}`;
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write('<html><head><title>MPR PDF Loading...</title></head><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;"><div style="text-align:center;"><div style="border:4px solid #f3f3f3;border-top:4px solid #1976d2;border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite;margin:0 auto 16px;"></div><style>@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style><p>Loading PDF...</p></div></body></html>');
    }
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const objUrl = window.URL.createObjectURL(blob);
        if (newWindow && !newWindow.closed) {
          newWindow.location.href = objUrl;
        } else {
          window.open(objUrl, '_blank');
        }
      })
      .catch(() => {
        if (newWindow && !newWindow.closed) newWindow.close();
        setError('Failed to preview PDF');
      })
      .finally(() => setPdfLoading(false));
  }

  function handleSave() {
    if (items.some((i) => !i.materialName.trim() || !Number.isFinite(Number(i.quantity)) || Number(i.quantity) <= 0)) {
      setError('Each item must have a name and quantity greater than zero');
      return;
    }
    if (vendorMode === 'new' && !newVendorName.trim()) {
      setError('Enter a name for the new vendor, or switch to an existing vendor');
      return;
    }
    setError('');
    createMutation.mutate();
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={700}>Material Purchase Requests</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New MPR</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder="Search by MPR number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
          sx={{ minWidth: 200 }}
        />
        <TextField
          size="small"
          select
          label="Status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">All</MenuItem>
          {Object.values(MPRStatus).map((s) => (
            <MenuItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</MenuItem>
          ))}
        </TextField>
      </Box>

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={32} /></Box>
      ) : mprs.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">No Material Purchase Requests found. Click "New MPR" to create one.</Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {mprs.map((row) => {
            const pendingStep = canApprove(row);
            const isNonVendor = row.vendor?.vendorType === 'NON_VENDOR';
            return (
            <Grid item xs={12} key={row.id}>
              <Card variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
                    <Box>
                      <Typography variant="subtitle1" fontWeight={700}>{row.mprNumber}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Date: {formatDate(row.date)} | Required By: {row.requiredBy ? formatDate(row.requiredBy) : '—'} | Dept: {row.department ?? '—'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Requested By: {row.createdByUser?.name ?? '—'} | Priority: {row.priority ?? 'Normal'} | Items: {row.items.length}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Vendor: {row.vendor ? `${row.vendor.name} (${row.vendor.vendorCode})` : '—'}
                        {row.vendor && (
                          <Chip
                            label={isNonVendor ? 'Non-Vendor' : 'Vendor'}
                            size="small"
                            sx={{ ml: 0.75, height: 18, fontSize: '0.65rem' }}
                            color={isNonVendor ? 'default' : 'primary'}
                            variant="outlined"
                          />
                        )}
                      </Typography>
                      {row.description && (
                        <Typography variant="body2" sx={{ mt: 0.5, color: 'text.primary' }}>{row.description}</Typography>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                      <Chip
                        label={STATUS_LABELS[row.status] ?? row.status}
                        size="small"
                        color={(STATUS_COLORS[row.status] as any) ?? 'default'}
                      />
                    </Box>
                  </Box>

                  {/* Items summary */}
                  <Box sx={{ mt: 1 }}>
                    {row.items.slice(0, 3).map((item, idx) => (
                      <Typography key={idx} variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        • {item.materialCode ? `[${item.materialCode}] ` : ''}{item.materialName} — {item.quantity}{item.unit ? ` ${item.unit}` : ''}{item.requiredDate ? ` (by ${formatDate(item.requiredDate)})` : ''}
                      </Typography>
                    ))}
                    {row.items.length > 3 && (
                      <Typography variant="caption" color="text.secondary">...and {row.items.length - 3} more items</Typography>
                    )}
                  </Box>

                  {/* Quotations raised against this MPR */}
                  {row.quotations && row.quotations.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>Quotations: </Typography>
                      {row.quotations.map((q) => (
                        <Chip key={q.id} label={`${q.quotationNumber} · ${q.status.replace(/_/g, ' ')} · ₹${Number(q.grandTotal).toLocaleString('en-IN')}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
                      ))}
                    </Box>
                  )}

                  {/* Receipt attached (non-vendor fast path) */}
                  {row.receiptFilePath && (
                    <Box sx={{ mt: 1 }}>
                      <Button size="small" startIcon={<ReceiptIcon />} onClick={() => downloadReceipt(row.id, row.receiptFileName ?? 'receipt')}>
                        {row.receiptFileName ?? 'Receipt attached'}
                      </Button>
                    </Box>
                  )}

                  {/* Approval workflow */}
                  {row.approvalWorkflow && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Approval Status</Typography>
                      <ApprovalStepsDisplay steps={row.approvalWorkflow.steps} />
                    </Box>
                  )}

                  {/* Actions */}
                  <Box sx={{ display: 'flex', gap: 0.5, mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'action.hover', flexWrap: 'wrap' }}>
                    <IconButton size="small" onClick={() => previewPDF(row.id)} title="Preview PDF" disabled={pdfLoading}>
                      {pdfLoading ? <CircularProgress size={16} /> : <PdfIcon fontSize="small" />}
                    </IconButton>
                    <IconButton size="small" onClick={() => downloadPDF(row.id, row.mprNumber)} title="Download PDF">
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                    {(row.status !== MPRStatus.DRAFT) && (
                      <Button size="small" startIcon={<VarianceIcon />} onClick={() => setVarianceRow(row)}>Variance</Button>
                    )}
                    {row.status === MPRStatus.DRAFT && (
                      <>
                        <IconButton size="small" onClick={() => openEdit(row)} title="Edit"><EditIcon fontSize="small" /></IconButton>
                        <Button size="small" startIcon={<SendIcon />} onClick={() => submitMutation.mutate(row.id)} disabled={submitMutation.isPending}>Submit for Approval</Button>
                        <IconButton size="small" onClick={() => deleteMutation.mutate(row.id)} title="Delete"><DeleteIcon fontSize="small" /></IconButton>
                      </>
                    )}
                    {row.status === MPRStatus.SUBMITTED && (
                      <>
                        <IconButton size="small" onClick={() => openEdit(row)} title="Edit (will re-raise for approval)"><EditIcon fontSize="small" /></IconButton>
                        {pendingStep && (
                          <>
                            <Button size="small" color="success" startIcon={<CheckIcon />} onClick={() => setApprovalAction({ row, step: pendingStep, action: 'approve' })}>Approve</Button>
                            <Button size="small" color="error" startIcon={<CloseIcon />} onClick={() => setApprovalAction({ row, step: pendingStep, action: 'reject' })}>Reject</Button>
                          </>
                        )}
                        <Button size="small" color="error" startIcon={<CloseIcon />} onClick={() => cancelMutation.mutate(row.id)} disabled={cancelMutation.isPending}>Cancel</Button>
                      </>
                    )}
                    {row.status === MPRStatus.APPROVED && !isNonVendor && row.vendorId && (
                      <Button size="small" variant="contained" startIcon={<QuotationIcon />} onClick={() => raiseQuotation(row)}>Raise Quotation</Button>
                    )}
                    {row.status === MPRStatus.APPROVED && isNonVendor && (
                      <Button size="small" variant="contained" startIcon={<ReceiptIcon />} onClick={() => setReceiptRow(row)}>Upload Receipt & Close</Button>
                    )}
                    {row.status === MPRStatus.QUOTATIONS_RECEIVED && !isNonVendor && row.vendorId && (
                      <Button size="small" startIcon={<QuotationIcon />} onClick={() => raiseQuotation(row)}>Raise Another Quotation</Button>
                    )}
                    {(row.status === MPRStatus.APPROVED || row.status === MPRStatus.QUOTATIONS_RECEIVED) && (
                      <Button size="small" color="success" onClick={() => closeMutation.mutate(row.id)} disabled={closeMutation.isPending}>Mark Closed</Button>
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            );
          })}
        </Grid>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>{editRow ? `Edit ${editRow.mprNumber}` : 'New Material Purchase Request'}</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

          {/* Vendor Selection */}
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Vendor</Typography>
          <ToggleButtonGroup
            value={vendorMode}
            exclusive
            size="small"
            onChange={(_e, v) => { if (v) setVendorMode(v); }}
            sx={{ mb: 1 }}
          >
            <ToggleButton value="existing">Existing Vendor</ToggleButton>
            <ToggleButton value="new">New Vendor</ToggleButton>
          </ToggleButtonGroup>
          {vendorMode === 'existing' ? (
            <TextField
              fullWidth
              size="small"
              select
              label="Vendor"
              value={selectedVendorId}
              onChange={(e) => setSelectedVendorId(e.target.value)}
              sx={{ mb: 2 }}
            >
              <MenuItem value=""><em>— Select —</em></MenuItem>
              {vendors.map((v) => (
                <MenuItem key={v.id} value={v.id}>{v.vendorCode} - {v.name} {v.vendorType === 'NON_VENDOR' ? '(Non-Vendor)' : ''}</MenuItem>
              ))}
            </TextField>
          ) : (
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={5}>
                <TextField fullWidth size="small" label="Vendor Name" value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} required />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField fullWidth size="small" label="Phone" value={newVendorPhone} onChange={(e) => setNewVendorPhone(e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField fullWidth size="small" select label="Type" value={newVendorType} onChange={(e) => setNewVendorType(e.target.value as 'VENDOR' | 'NON_VENDOR')}>
                  <MenuItem value="VENDOR">Vendor (recurring)</MenuItem>
                  <MenuItem value="NON_VENDOR">Non-Vendor (one-time)</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12}>
                <Alert severity="info" sx={{ mt: 0 }}>
                  {newVendorType === 'NON_VENDOR'
                    ? 'Non-vendor requests skip the Quotation step — once approved, you attach a receipt/bill directly and close the request.'
                    : 'This vendor will also be saved to the Vendors module. You can add bank/GST details there later.'}
                </Alert>
              </Grid>
            </Grid>
          )}

          <Divider sx={{ mb: 2 }} />

          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="Required By"
                value={requiredBy}
                onChange={(e) => setRequiredBy(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Autocomplete
                freeSolo
                fullWidth
                size="small"
                options={departmentOptions}
                value={department}
                inputValue={department}
                onInputChange={(_e, newValue) => setDepartment(newValue)}
                onChange={(_e, newValue) => setDepartment(newValue ?? '')}
                onBlur={() => rememberDepartment(department)}
                renderInput={(params) => <TextField {...params} label="Department" />}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                size="small"
                select
                label="Priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <MenuItem value="Normal">Normal</MenuItem>
                <MenuItem value="Urgent">Urgent</MenuItem>
                <MenuItem value="Critical">Critical</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                size="small"
                select
                label="Request Raised By"
                value={requestRaisedById}
                onChange={(e) => setRequestRaisedById(e.target.value)}
              >
                <MenuItem value=""><em>— Select —</em></MenuItem>
                {users.map((u) => (
                  <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>

          {/* Delivery & Billing Information */}
          <Typography variant="subtitle2" sx={{ mt: 1, mb: 1 }}>Delivery & Billing Information</Typography>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} md={6}>
              <Box sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Typography variant="caption" fontWeight={700} color="primary">DELIVERY ADDRESS</Typography>
                <TextField fullWidth size="small" label="Delivery Address" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Where material is physically delivered" sx={{ mt: 1 }} />
                <TextField fullWidth size="small" label="Contact Person" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} sx={{ mt: 1 }} />
                <TextField fullWidth size="small" label="Contact Number" value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} sx={{ mt: 1 }} />
              </Box>
            </Grid>
            <Grid item xs={12} md={6}>
              <Box sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Typography variant="caption" fontWeight={700} color="primary">BILL TO</Typography>
                <TextField fullWidth size="small" label="Billing Address" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} placeholder="V Grand Health Care Pvt. Ltd. billing address" sx={{ mt: 1 }} />
                <TextField fullWidth size="small" label="State / State Code" value={stateCode} onChange={(e) => setStateCode(e.target.value)} sx={{ mt: 1 }} />
              </Box>
            </Grid>
          </Grid>

          <TextField
            fullWidth
            size="small"
            label="Purpose / Justification"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Explain why the material is required"
            sx={{ mb: 2 }}
          />

          {/* Items table */}
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Material Details</Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 2, overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Material / Item Description</TableCell>
                  <TableCell>Material Code</TableCell>
                  <TableCell>Specification / Grade</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell>Unit</TableCell>
                  <TableCell>Required Date</TableCell>
                  <TableCell align="right">Price</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell>Remarks</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <TextField
                        size="small"
                        value={item.materialName}
                        onChange={(e) => updateItem(index, 'materialName', e.target.value)}
                        sx={{ minWidth: 140 }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={item.materialCode ?? ''}
                        onChange={(e) => updateItem(index, 'materialCode', e.target.value)}
                        sx={{ width: 90 }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={item.specification ?? ''}
                        onChange={(e) => updateItem(index, 'specification', e.target.value)}
                        sx={{ minWidth: 100 }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                        sx={{ width: 60 }}
                        inputProps={{ style: { textAlign: 'right' }, inputMode: 'decimal' }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        value={item.unit ?? 'nos'}
                        onChange={(e) => updateItem(index, 'unit', e.target.value)}
                        sx={{ width: 90 }}
                      >
                        {QTY_UNIT_OPTIONS.map((opt) => (
                          <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="date"
                        value={item.requiredDate ?? ''}
                        onChange={(e) => updateItem(index, 'requiredDate', e.target.value)}
                        sx={{ width: 130 }}
                        InputLabelProps={{ shrink: true }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="number"
                        value={item.estimatedRate ?? ''}
                        onChange={(e) => updateItem(index, 'estimatedRate', e.target.value)}
                        sx={{ width: 90 }}
                        inputProps={{ style: { textAlign: 'right' }, inputMode: 'decimal', min: 0, step: '0.01' }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" sx={{ minWidth: 80 }}>
                        {(Number(item.quantity) > 0 && Number(item.estimatedRate) > 0)
                          ? (Number(item.quantity) * Number(item.estimatedRate)).toLocaleString('en-IN', { maximumFractionDigits: 2 })
                          : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={item.remarks ?? ''}
                        onChange={(e) => updateItem(index, 'remarks', e.target.value)}
                        sx={{ minWidth: 100 }}
                      />
                    </TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => removeItem(index)} disabled={items.length <= 1}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={7} align="right" sx={{ borderBottom: 'none' }}>
                    <Typography variant="subtitle2" fontWeight={700}>Grand Total</Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ borderBottom: 'none' }}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      ₹{items.reduce((sum, i) => sum + (Number(i.quantity) > 0 && Number(i.estimatedRate) > 0 ? Number(i.quantity) * Number(i.estimatedRate) : 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </Typography>
                  </TableCell>
                  <TableCell colSpan={2} sx={{ borderBottom: 'none' }} />
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          <Button size="small" startIcon={<AddIcon />} onClick={addItem} sx={{ mb: 2 }}>Add Item</Button>

          {/* Technical Requirements */}
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Technical / Purchase Requirements</Typography>
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={3}
            value={technicalRequirements}
            onChange={(e) => setTechnicalRequirements(e.target.value)}
            placeholder="e.g. Material must conform to project specifications. Vendor quotation should mention brand/make, taxes, freight, delivery and payment terms. MTC/test certificates where required."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={createMutation.isPending}
            startIcon={createMutation.isPending ? <CircularProgress size={16} /> : null}
          >
            {editRow ? 'Update' : 'Create'} MPR
          </Button>
        </DialogActions>
      </Dialog>

      {/* Approve / Reject Dialog */}
      <ApprovalActionDialog
        open={approvalAction !== null}
        action={approvalAction?.action ?? 'approve'}
        entityLabel="Material Purchase Request"
        pending={approveMutation.isPending || rejectMutation.isPending}
        error={error}
        onClearError={() => setError('')}
        onClose={() => setApprovalAction(null)}
        onConfirm={(payload) => {
          if (!approvalAction) return;
          if (approvalAction.action === 'approve') {
            approveMutation.mutate({ mprId: approvalAction.row.id, comments: payload.comments });
          } else {
            rejectMutation.mutate({ mprId: approvalAction.row.id, reason: payload.reason! });
          }
        }}
      />

      {/* Receipt Upload Dialog — NON_VENDOR fast path */}
      <ResponsiveDialog open={receiptRow !== null} onClose={() => { setReceiptRow(null); setReceiptFile(null); setReceiptNotes(''); }} maxWidth="sm" fullWidth>
        <DialogTitle>Upload Receipt & Close — {receiptRow?.mprNumber}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
          <Alert severity="info">This request will be marked Closed once the receipt/bill is uploaded.</Alert>
          <Button component="label" variant="outlined" startIcon={<ReceiptIcon />}>
            {receiptFile ? receiptFile.name : 'Choose Receipt / Bill File'}
            <input type="file" hidden accept="application/pdf,image/*" onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />
          </Button>
          <TextField label="Notes (optional)" value={receiptNotes} onChange={(e) => setReceiptNotes(e.target.value)} multiline minRows={2} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setReceiptRow(null); setReceiptFile(null); setReceiptNotes(''); }} disabled={receiptMutation.isPending}>Cancel</Button>
          <Button variant="contained" disabled={!receiptFile || receiptMutation.isPending} onClick={() => receiptMutation.mutate()}>
            {receiptMutation.isPending ? <CircularProgress size={16} /> : 'Upload & Close'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Variance Dialog — Requested vs Quoted vs Ordered */}
      <ResponsiveDialog open={varianceRow !== null} onClose={() => setVarianceRow(null)} maxWidth="md" fullWidth>
        <DialogTitle>Variance — {varianceRow?.mprNumber}</DialogTitle>
        <DialogContent>
          {varianceLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={28} /></Box>
          ) : varianceItems.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2 }}>No items to compare yet.</Typography>
          ) : (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Material</TableCell>
                    <TableCell align="right">Requested</TableCell>
                    <TableCell align="right">Quoted</TableCell>
                    <TableCell align="right">Ordered</TableCell>
                    <TableCell align="right">Qty Δ (Quoted−Req.)</TableCell>
                    <TableCell align="right">Qty Δ (Ordered−Quoted)</TableCell>
                    <TableCell align="right">Rate Δ (Ordered−Quoted)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {varianceItems.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell>{row.materialName}</TableCell>
                      <TableCell align="right">{row.requestedQty}{row.unit ? ` ${row.unit}` : ''}</TableCell>
                      <TableCell align="right">{row.quotedQty || '—'}</TableCell>
                      <TableCell align="right">{row.orderedQty || '—'}</TableCell>
                      <TableCell align="right" sx={{ color: row.qtyVarianceVsRequested !== 0 ? 'warning.main' : 'success.main', fontWeight: 600 }}>
                        {row.qtyVarianceVsRequested > 0 ? '+' : ''}{row.qtyVarianceVsRequested || 0}
                      </TableCell>
                      <TableCell align="right" sx={{ color: row.qtyVarianceVsQuoted !== 0 ? 'warning.main' : 'success.main', fontWeight: 600 }}>
                        {row.qtyVarianceVsQuoted > 0 ? '+' : ''}{row.qtyVarianceVsQuoted || 0}
                      </TableCell>
                      <TableCell align="right" sx={{ color: row.rateVarianceVsQuoted !== 0 ? 'warning.main' : 'success.main', fontWeight: 600 }}>
                        {row.rateVarianceVsQuoted > 0 ? '+' : ''}₹{row.rateVarianceVsQuoted || 0}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVarianceRow(null)}>Close</Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
