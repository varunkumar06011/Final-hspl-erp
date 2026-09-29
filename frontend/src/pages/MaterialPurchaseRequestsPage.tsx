import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, Typography, Button, Card, CardContent, Chip, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, CircularProgress,
  MenuItem, InputAdornment, Grid, Alert, ToggleButtonGroup, ToggleButton, Divider, Autocomplete, Tabs, Tab,
} from '@mui/material';
import {
  Add as AddIcon,
  SwapHoriz as SwitchIcon,
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
import { MPRStatus, MPRRequestType, isApproverRole } from '@hospital-erp/shared';
import { formatDate, STATUS_COLORS, QTY_UNIT_OPTIONS, SERVICE_UNIT_OPTIONS, SERVICE_CATEGORY_OPTIONS, enumLabel, unitLabel, serviceCategoryLabel } from '../utils/enumOptions';
import { useTranslation } from 'react-i18next';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import ApprovalStepsDisplay from '../components/ApprovalStepsDisplay';
import ApprovalActionDialog from '../components/ApprovalActionDialog';
import ResponsiveDialog from '../components/ResponsiveDialog';
import { useDeepLinkRow } from '../hooks/useDeepLinkRow';
import CommentsButton from '../components/CommentsButton';

interface MPRItem {
  materialName: string;
  materialCode?: string;
  specification?: string;
  quantity: string | number;
  unit?: string;
  requiredDate?: string;
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
  requestType?: string;
  serviceCategory?: string | null;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
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
  purchaseOrders?: { id: string; poNumber: string; status: string }[];
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

export default function MaterialPurchaseRequestsPage() {
  const { t } = useTranslation('mpr');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [requestTypeTab, setRequestTypeTab] = useState<MPRRequestType>(MPRRequestType.MATERIAL);
  const isServiceTab = requestTypeTab === MPRRequestType.SERVICE;
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
  const [serviceCategory, setServiceCategory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').serviceCategory ?? ''; } catch { return ''; }
  });
  const [servicePeriodStart, setServicePeriodStart] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').servicePeriodStart ?? ''; } catch { return ''; }
  });
  const [servicePeriodEnd, setServicePeriodEnd] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').servicePeriodEnd ?? ''; } catch { return ''; }
  });
  const [items, setItems] = useState<MPRItem[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(MPR_DRAFT_KEY) || '{}').items;
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch { /* ignore */ }
    return [{ materialName: '', materialCode: '', quantity: '', unit: 'nos', requiredDate: '', remarks: '' }];
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
      requestType: requestTypeTab, serviceCategory, servicePeriodStart, servicePeriodEnd,
      requiredBy, department, priority, description, deliveryAddress,
      contactPerson, contactNumber, billingAddress, stateCode,
      requestRaisedById, technicalRequirements, items, selectedVendorId,
    };
    try { localStorage.setItem(MPR_DRAFT_KEY, JSON.stringify(draft)); } catch { /* ignore quota errors */ }
  }, [requestTypeTab, serviceCategory, servicePeriodStart, servicePeriodEnd, requiredBy, department, priority, description, deliveryAddress, contactPerson, contactNumber, billingAddress, stateCode, requestRaisedById, technicalRequirements, items, selectedVendorId, editRow]);

  const { data, isLoading } = useQuery({
    queryKey: ['mprs', requestTypeTab, search, statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = { requestType: requestTypeTab };
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

  // Deep-link from a push notification or global search: ?id=<mprId> scrolls
  // to and briefly highlights the matching card.
  const { highlightId, rowRef } = useDeepLinkRow<MPRRow>('/material-purchase-requests', mprs, 'mprNumber', setSearch);

  // A deep-linked row (from a notification / global search) may live on the
  // other tab — switch to its tab first so useDeepLinkRow above can find it.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const targetId = searchParams.get('id');
    if (!targetId) return;
    if (mprs.some((m) => m.id === targetId)) return; // already visible on this tab
    api.get(`/material-purchase-requests/${targetId}`)
      .then((res) => {
        const rt = res.data?.requestType;
        if (rt === MPRRequestType.SERVICE || rt === MPRRequestType.MATERIAL) {
          setRequestTypeTab(rt);
        }
      })
      .catch(() => { /* ignore — useDeepLinkRow will clear the param */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('id')]);

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
    setServiceCategory('');
    setServicePeriodStart('');
    setServicePeriodEnd('');
    setItems([{ materialName: '', materialCode: '', quantity: '', unit: isServiceTab ? 'hrs' : 'nos', requiredDate: '', remarks: '' }]);
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
    setServiceCategory(row.serviceCategory ?? '');
    setServicePeriodStart(row.servicePeriodStart ? new Date(row.servicePeriodStart).toISOString().slice(0, 10) : '');
    setServicePeriodEnd(row.servicePeriodEnd ? new Date(row.servicePeriodEnd).toISOString().slice(0, 10) : '');
    setItems(row.items.map((i) => ({
      materialName: i.materialName,
      materialCode: i.materialCode ?? '',
      specification: i.specification ?? '',
      quantity: String(i.quantity),
      unit: i.unit ?? 'nos',
      requiredDate: i.requiredDate ? new Date(i.requiredDate).toISOString().slice(0, 10) : '',
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
    setItems([...items, { materialName: '', materialCode: '', quantity: '', unit: isServiceTab ? 'hrs' : 'nos', requiredDate: '', remarks: '' }]);
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index));
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        requestType: requestTypeTab,
        serviceCategory: isServiceTab ? (serviceCategory || undefined) : undefined,
        servicePeriodStart: isServiceTab ? (servicePeriodStart || undefined) : undefined,
        servicePeriodEnd: isServiceTab ? (servicePeriodEnd || undefined) : undefined,
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
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['pending-items', 'mprs'] });
    },
    onError: (err: unknown) => {
      setError(extractErrorMessage(err));
    },
  });

  const switchTypeMutation = useMutation({
    mutationFn: async (id: string) => (await api.post(`/material-purchase-requests/${id}/switch-type`)).data,
    onSuccess: (updated: { requestType?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['mprs'] });
      // follow the record to the tab it now belongs to
      if (updated?.requestType === 'SERVICE') setRequestTypeTab(MPRRequestType.SERVICE);
      else if (updated?.requestType === 'MATERIAL') setRequestTypeTab(MPRRequestType.MATERIAL);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/material-purchase-requests/${id}/cancel`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mprs'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['pending-items', 'mprs'] });
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
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['pending-items', 'mprs'] });
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
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['pending-items', 'mprs'] });
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
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['pending-items', 'mprs'] });
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
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['pending-items', 'mprs'] });
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
      .catch(() => setError(t('errFailedReceipt')));
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
      .catch(() => setError(t('errFailedPdf')));
  }

  function previewPDF(mprId: string) {
    if (pdfLoading) return;
    setPdfLoading(true);
    const token = localStorage.getItem('firebaseToken');
    const url = `${api.defaults.baseURL}/material-purchase-requests/${mprId}/pdf?_t=${Date.now()}`;
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(`<html><head><title>${t('pdfLoadingTitle')}</title></head><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;"><div style="text-align:center;"><div style="border:4px solid #f3f3f3;border-top:4px solid #1976d2;border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite;margin:0 auto 16px;"></div><style>@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style><p>${t('pdfLoadingText')}</p></div></body></html>`);
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
        setError(t('errFailedPreview'));
      })
      .finally(() => setPdfLoading(false));
  }

  function handleSave() {
    if (items.some((i) => !i.materialName.trim() || !Number.isFinite(Number(i.quantity)) || Number(i.quantity) <= 0)) {
      setError(t('errItems'));
      return;
    }
    if (vendorMode === 'new' && !newVendorName.trim()) {
      setError(t('errNewVendor'));
      return;
    }
    setError('');
    createMutation.mutate();
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={700}>{isServiceTab ? t('titleService') : t('titleMaterial')}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{isServiceTab ? t('newService') : t('newMpr')}</Button>
      </Box>

      <Tabs
        value={requestTypeTab}
        onChange={(_e, v) => setRequestTypeTab(v)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label={t('tabMaterial')} value="MATERIAL" />
        <Tab label={t('tabService')} value="SERVICE" />
      </Tabs>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
          sx={{ minWidth: 200 }}
        />
        <TextField
          size="small"
          select
          label={t('statusLabel')}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">{t('all')}</MenuItem>
          {Object.values(MPRStatus).map((s) => (
            <MenuItem key={s} value={s}>{t(`status.${s}`, enumLabel(s))}</MenuItem>
          ))}
        </TextField>
      </Box>

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={32} /></Box>
      ) : mprs.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {isServiceTab ? t('emptyService') : t('emptyMaterial')}
          </Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {mprs.map((row) => {
            const pendingStep = canApprove(row);
            const isNonVendor = row.vendor?.vendorType === 'NON_VENDOR';
            return (
            <Grid item xs={12} key={row.id}>
              <Card
                variant="outlined"
                ref={rowRef(row.id)}
                sx={highlightId === row.id ? {
                  borderColor: 'primary.main',
                  boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}`,
                  transition: 'box-shadow 0.3s ease',
                } : undefined}
              >
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
                    <Box>
                      <Typography variant="subtitle1" fontWeight={700}>{row.mprNumber}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('dateLine', { date: formatDate(row.date), required: row.requiredBy ? formatDate(row.requiredBy) : '—', dept: row.department ?? '—' })}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('requestedLine', { by: row.createdByUser?.name ?? '—', priority: t(`priority.${row.priority ?? 'Normal'}`, row.priority ?? 'Normal'), n: row.items.length })}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('vendorLine', { v: row.vendor ? `${row.vendor.name} (${row.vendor.vendorCode})` : '—' })}
                        {row.vendor && (
                          <Chip
                            label={isNonVendor ? t('nonVendor') : t('vendor')}
                            size="small"
                            sx={{ ml: 0.75, height: 18, fontSize: '0.65rem' }}
                            color={isNonVendor ? 'default' : 'primary'}
                            variant="outlined"
                          />
                        )}
                      </Typography>
                      {row.requestType === 'SERVICE' && (row.serviceCategory || row.servicePeriodStart || row.servicePeriodEnd) && (
                        <Typography variant="body2" color="text.secondary">
                          {row.serviceCategory ?? '—'}
                          {(row.servicePeriodStart || row.servicePeriodEnd) && t('periodLine', { from: row.servicePeriodStart ? formatDate(row.servicePeriodStart) : '—', to: row.servicePeriodEnd ? formatDate(row.servicePeriodEnd) : '—' })}
                        </Typography>
                      )}
                      {row.description && (
                        <Typography variant="body2" sx={{ mt: 0.5, color: 'text.primary' }}>{row.description}</Typography>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                      <Chip
                        label={t(`status.${row.status}`, enumLabel(row.status))}
                        size="small"
                        color={(STATUS_COLORS[row.status] as any) ?? 'default'}
                      />
                    </Box>
                  </Box>

                  {/* Items summary */}
                  <Box sx={{ mt: 1 }}>
                    {row.items.slice(0, 3).map((item, idx) => (
                      <Typography key={idx} variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        • {item.materialCode ? `[${item.materialCode}] ` : ''}{item.materialName} — {item.quantity}{item.unit ? ` ${item.unit}` : ''}{item.requiredDate ? t('requiredByShort', { d: formatDate(item.requiredDate) }) : ''}
                      </Typography>
                    ))}
                    {row.items.length > 3 && (
                      <Typography variant="caption" color="text.secondary">{t('andMore', { n: row.items.length - 3 })}</Typography>
                    )}
                  </Box>

                  {/* Quotations raised against this MPR */}
                  {row.quotations && row.quotations.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>{t('quotations')} </Typography>
                      {row.quotations.map((q) => (
                        <Chip key={q.id} label={`${q.quotationNumber} · ${enumLabel(q.status)} · ₹${Number(q.grandTotal).toLocaleString('en-IN')}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
                      ))}
                    </Box>
                  )}

                  {/* Receipt attached (non-vendor fast path) */}
                  {row.receiptFilePath && (
                    <Box sx={{ mt: 1 }}>
                      <Button size="small" startIcon={<ReceiptIcon />} onClick={() => downloadReceipt(row.id, row.receiptFileName ?? 'receipt')}>
                        {row.receiptFileName ?? t('receiptAttached')}
                      </Button>
                    </Box>
                  )}

                  {/* Approval workflow */}
                  {row.approvalWorkflow && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{t('approvalStatus')}</Typography>
                      <ApprovalStepsDisplay steps={row.approvalWorkflow.steps} />
                    </Box>
                  )}

                  {/* Actions */}
                  <Box sx={{ display: 'flex', gap: 0.5, mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'action.hover', flexWrap: 'wrap' }}>
                    <IconButton size="small" onClick={() => previewPDF(row.id)} title={t('previewPdf')} disabled={pdfLoading}>
                      {pdfLoading ? <CircularProgress size={16} /> : <PdfIcon fontSize="small" />}
                    </IconButton>
                    <CommentsButton entityType="MATERIAL_PURCHASE_REQUEST" entityId={row.id} entityLabel={row.mprNumber} url="/material-purchase-requests" />
                    <IconButton size="small" onClick={() => downloadPDF(row.id, row.mprNumber)} title={t('downloadPdf')}>
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                    {row.status !== MPRStatus.CLOSED && row.status !== MPRStatus.CANCELLED && (
                      <Button size="small" startIcon={<SwitchIcon />} onClick={() => switchTypeMutation.mutate(row.id)} disabled={switchTypeMutation.isPending}>
                        {row.requestType === 'SERVICE' ? t('switchToMaterial') : t('switchToService')}
                      </Button>
                    )}
                    {(row.status !== MPRStatus.DRAFT) && (
                      <Button size="small" startIcon={<VarianceIcon />} onClick={() => setVarianceRow(row)}>{t('variance')}</Button>
                    )}
                    {row.status === MPRStatus.DRAFT && (
                      <>
                        <IconButton size="small" onClick={() => openEdit(row)} title={t('edit')}><EditIcon fontSize="small" /></IconButton>
                        <Button size="small" startIcon={<SendIcon />} onClick={() => submitMutation.mutate(row.id)} disabled={submitMutation.isPending}>{t('submitForApproval')}</Button>
                        <IconButton size="small" onClick={() => deleteMutation.mutate(row.id)} title={t('delete')}><DeleteIcon fontSize="small" /></IconButton>
                      </>
                    )}
                    {row.status === MPRStatus.SUBMITTED && (
                      <>
                        <IconButton size="small" onClick={() => openEdit(row)} title={t('editReRaise')}><EditIcon fontSize="small" /></IconButton>
                        {pendingStep && (
                          <>
                            <Button size="small" color="success" startIcon={<CheckIcon />} onClick={() => setApprovalAction({ row, step: pendingStep, action: 'approve' })}>{t('approve')}</Button>
                            <Button size="small" color="error" startIcon={<CloseIcon />} onClick={() => setApprovalAction({ row, step: pendingStep, action: 'reject' })}>{t('reject')}</Button>
                          </>
                        )}
                        <Button size="small" color="error" startIcon={<CloseIcon />} onClick={() => cancelMutation.mutate(row.id)} disabled={cancelMutation.isPending}>{t('cancel')}</Button>
                      </>
                    )}
                    {row.status === MPRStatus.APPROVED && !isNonVendor && row.vendorId && (
                      <Button size="small" variant="contained" startIcon={<QuotationIcon />} onClick={() => raiseQuotation(row)}>{t('raiseQuotation')}</Button>
                    )}
                    {isNonVendor && row.purchaseOrders?.map((po) => (
                      <Chip key={po.id} label={t('poRaised', { n: po.poNumber })} size="small" color="success" variant="outlined" sx={{ alignSelf: 'center' }} />
                    ))}
                    {row.status === MPRStatus.APPROVED && isNonVendor && !row.purchaseOrders?.length && (
                      <Button size="small" variant="contained" startIcon={<ReceiptIcon />} onClick={() => setReceiptRow(row)}>{t('uploadReceiptClose')}</Button>
                    )}
                    {row.status === MPRStatus.QUOTATIONS_RECEIVED && !isNonVendor && row.vendorId && (
                      <Button size="small" startIcon={<QuotationIcon />} onClick={() => raiseQuotation(row)}>{t('raiseAnother')}</Button>
                    )}
                    {(row.status === MPRStatus.APPROVED || row.status === MPRStatus.QUOTATIONS_RECEIVED) && (
                      <Button size="small" color="success" onClick={() => closeMutation.mutate(row.id)} disabled={closeMutation.isPending}>{t('markClosed')}</Button>
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
        <DialogTitle>{editRow ? t('editTitle', { n: editRow.mprNumber }) : (isServiceTab ? t('newService') : t('newMaterialFull'))}</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

          {/* Vendor Selection */}
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('vendorSection')}</Typography>
          <ToggleButtonGroup
            value={vendorMode}
            exclusive
            size="small"
            onChange={(_e, v) => { if (v) setVendorMode(v); }}
            sx={{ mb: 1 }}
          >
            <ToggleButton value="existing">{t('existingVendor')}</ToggleButton>
            <ToggleButton value="new">{t('newVendor')}</ToggleButton>
          </ToggleButtonGroup>
          {vendorMode === 'existing' ? (
            <TextField
              fullWidth
              size="small"
              select
              label={t('vendorSection')}
              value={selectedVendorId}
              onChange={(e) => setSelectedVendorId(e.target.value)}
              sx={{ mb: 2 }}
            >
              <MenuItem value=""><em>{t('select')}</em></MenuItem>
              {vendors.map((v) => (
                <MenuItem key={v.id} value={v.id}>{v.vendorCode} - {v.name} {v.vendorType === 'NON_VENDOR' ? t('nonVendorTag') : ''}</MenuItem>
              ))}
            </TextField>
          ) : (
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={5}>
                <TextField fullWidth size="small" label={t('vendorName')} value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} required />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField fullWidth size="small" label={t('phone')} value={newVendorPhone} onChange={(e) => setNewVendorPhone(e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField fullWidth size="small" select label={t('type')} value={newVendorType} onChange={(e) => setNewVendorType(e.target.value as 'VENDOR' | 'NON_VENDOR')}>
                  <MenuItem value="VENDOR">{t('vendorRecurring')}</MenuItem>
                  <MenuItem value="NON_VENDOR">{t('nonVendorOneTime')}</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12}>
                <Alert severity="info" sx={{ mt: 0 }}>
                  {newVendorType === 'NON_VENDOR' ? t('nonVendorInfo') : t('vendorInfo')}
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
                label={t('requiredBy')}
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
                renderInput={(params) => <TextField {...params} label={t('department')} />}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                size="small"
                select
                label={t('priorityLabel')}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <MenuItem value="Normal">{t('priority.Normal')}</MenuItem>
                <MenuItem value="Urgent">{t('priority.Urgent')}</MenuItem>
                <MenuItem value="Critical">{t('priority.Critical')}</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                size="small"
                select
                label={t('requestRaisedBy')}
                value={requestRaisedById}
                onChange={(e) => setRequestRaisedById(e.target.value)}
              >
                <MenuItem value=""><em>{t('select')}</em></MenuItem>
                {users.map((u) => (
                  <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>

          {isServiceTab && (
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6} md={4}>
                <Autocomplete
                  freeSolo
                  fullWidth
                  size="small"
                  options={[...SERVICE_CATEGORY_OPTIONS]}
                  value={serviceCategory}
                  inputValue={serviceCategory}
                  onInputChange={(_e, newValue) => setServiceCategory(newValue)}
                  onChange={(_e, newValue) => setServiceCategory(newValue ?? '')}
                  renderOption={(props, opt) => <li {...props}>{serviceCategoryLabel(opt)}</li>}
                  renderInput={(params) => <TextField {...params} label={t('serviceCategory')} />}
                />
              </Grid>
              <Grid item xs={12} sm={3} md={4}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label={t('periodFrom')}
                  value={servicePeriodStart}
                  onChange={(e) => setServicePeriodStart(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={3} md={4}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label={t('periodTo')}
                  value={servicePeriodEnd}
                  onChange={(e) => setServicePeriodEnd(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
            </Grid>
          )}

          {/* Delivery & Billing Information */}
          <Typography variant="subtitle2" sx={{ mt: 1, mb: 1 }}>{t('deliveryBilling')}</Typography>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} md={6}>
              <Box sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Typography variant="caption" fontWeight={700} color="primary">{t('deliveryAddressCaps')}</Typography>
                <TextField fullWidth size="small" label={t('deliveryAddress')} value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder={t('deliveryPlaceholder')} sx={{ mt: 1 }} />
                <TextField fullWidth size="small" label={t('contactPerson')} value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} sx={{ mt: 1 }} />
                <TextField fullWidth size="small" label={t('contactNumber')} value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} sx={{ mt: 1 }} />
              </Box>
            </Grid>
            <Grid item xs={12} md={6}>
              <Box sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Typography variant="caption" fontWeight={700} color="primary">{t('billTo')}</Typography>
                <TextField fullWidth size="small" label={t('billingAddress')} value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} placeholder={t('billingPlaceholder')} sx={{ mt: 1 }} />
                <TextField fullWidth size="small" label={t('stateCode')} value={stateCode} onChange={(e) => setStateCode(e.target.value)} sx={{ mt: 1 }} />
              </Box>
            </Grid>
          </Grid>

          <TextField
            fullWidth
            size="small"
            label={t('purpose')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('purposePlaceholder')}
            sx={{ mb: 2 }}
          />

          {/* Items table */}
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{isServiceTab ? t('serviceDetails') : t('materialDetails')}</Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 2, overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{isServiceTab ? t('colServiceDesc') : t('colMaterialDesc')}</TableCell>
                  <TableCell>{isServiceTab ? t('colServiceCode') : t('colMaterialCode')}</TableCell>
                  <TableCell>{isServiceTab ? t('colScope') : t('colSpec')}</TableCell>
                  <TableCell align="right">{t('colQty')}</TableCell>
                  <TableCell>{t('colUnit')}</TableCell>
                  <TableCell>{isServiceTab ? t('colServiceDate') : t('colRequiredDate')}</TableCell>
                  <TableCell>{t('colRemarks')}</TableCell>
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
                        value={item.unit ?? (isServiceTab ? 'hrs' : 'nos')}
                        onChange={(e) => updateItem(index, 'unit', e.target.value)}
                        sx={{ width: 90 }}
                      >
                        {(isServiceTab ? SERVICE_UNIT_OPTIONS : QTY_UNIT_OPTIONS).map((opt) => (
                          <MenuItem key={opt.value} value={opt.value}>{unitLabel(isServiceTab && opt.value === 'nos' ? 'nosUnits' : opt.value)}</MenuItem>
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
              </TableBody>
            </Table>
          </TableContainer>

          <Button size="small" startIcon={<AddIcon />} onClick={addItem} sx={{ mb: 2 }}>{t('addItem')}</Button>

          {/* Technical Requirements */}
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{isServiceTab ? t('termsService') : t('termsMaterial')}</Typography>
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={3}
            value={technicalRequirements}
            onChange={(e) => setTechnicalRequirements(e.target.value)}
            placeholder={isServiceTab ? t('termsServicePlaceholder') : t('termsMaterialPlaceholder')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>{t('cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={createMutation.isPending}
            startIcon={createMutation.isPending ? <CircularProgress size={16} /> : null}
          >
            {editRow ? t('updateMpr') : t('createMpr')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Approve / Reject Dialog */}
      <ApprovalActionDialog
        open={approvalAction !== null}
        action={approvalAction?.action ?? 'approve'}
        entityLabel={approvalAction?.row.requestType === 'SERVICE' ? t('entityService') : t('entityMaterial')}
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
        <DialogTitle>{t('receiptTitle', { n: receiptRow?.mprNumber })}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
          <Alert severity="info">{t('receiptInfo')}</Alert>
          <Button component="label" variant="outlined" startIcon={<ReceiptIcon />}>
            {receiptFile ? receiptFile.name : t('chooseReceipt')}
            <input type="file" hidden accept="application/pdf,image/*" onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />
          </Button>
          <TextField label={t('notesOptional')} value={receiptNotes} onChange={(e) => setReceiptNotes(e.target.value)} multiline minRows={2} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setReceiptRow(null); setReceiptFile(null); setReceiptNotes(''); }} disabled={receiptMutation.isPending}>{t('cancel')}</Button>
          <Button variant="contained" disabled={!receiptFile || receiptMutation.isPending} onClick={() => receiptMutation.mutate()}>
            {receiptMutation.isPending ? <CircularProgress size={16} /> : t('uploadClose')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Variance Dialog — Requested vs Quoted vs Ordered */}
      <ResponsiveDialog open={varianceRow !== null} onClose={() => setVarianceRow(null)} maxWidth="md" fullWidth>
        <DialogTitle>{t('varianceTitle', { n: varianceRow?.mprNumber })}</DialogTitle>
        <DialogContent>
          {varianceLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={28} /></Box>
          ) : varianceItems.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2 }}>{t('noItemsCompare')}</Typography>
          ) : (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('colMaterial')}</TableCell>
                    <TableCell align="right">{t('requested')}</TableCell>
                    <TableCell align="right">{t('quoted')}</TableCell>
                    <TableCell align="right">{t('ordered')}</TableCell>
                    <TableCell align="right">{t('qtyDeltaQuoted')}</TableCell>
                    <TableCell align="right">{t('qtyDeltaOrdered')}</TableCell>
                    <TableCell align="right">{t('rateDelta')}</TableCell>
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
          <Button onClick={() => setVarianceRow(null)}>{t('close')}</Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
