import { useState } from 'react';
import {
  Box, Typography, Button, Card, CardContent, Chip, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, CircularProgress,
  MenuItem, InputAdornment, Grid, Alert,
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
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MPRStatus } from '@hospital-erp/shared';
import { formatDate, STATUS_COLORS, QTY_UNIT_OPTIONS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';

interface MPRItem {
  materialName: string;
  materialCode?: string;
  specification?: string;
  quantity: string | number;
  unit?: string;
  requiredDate?: string;
  remarks?: string;
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
  technicalRequirements?: string | null;
  createdByUser: { id: string; name: string };
  items: MPRItem[];
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  QUOTATIONS_RECEIVED: 'Quotations Received',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export default function MaterialPurchaseRequestsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState<MPRRow | null>(null);
  const [error, setError] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);

  // Form state
  const [requiredBy, setRequiredBy] = useState('');
  const [department, setDepartment] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [description, setDescription] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [technicalRequirements, setTechnicalRequirements] = useState('');
  const [items, setItems] = useState<MPRItem[]>([]);

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
    setTechnicalRequirements('');
    setItems([{ materialName: '', materialCode: '', quantity: '', unit: 'nos', requiredDate: '', remarks: '' }]);
  }

  function openCreate() {
    resetForm();
    setEditRow(null);
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
    setTechnicalRequirements(row.technicalRequirements ?? '');
    setItems(row.items.map((i) => ({
      materialName: i.materialName,
      materialCode: i.materialCode ?? '',
      specification: i.specification ?? '',
      quantity: String(i.quantity),
      unit: i.unit ?? 'nos',
      requiredDate: i.requiredDate ? new Date(i.requiredDate).toISOString().slice(0, 10) : '',
      remarks: i.remarks ?? '',
    })));
    setCreateOpen(true);
  }

  function updateItem(index: number, field: keyof MPRItem, value: string | number) {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  }

  function addItem() {
    setItems([...items, { materialName: '', materialCode: '', quantity: '', unit: 'nos', requiredDate: '', remarks: '' }]);
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index));
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        requiredBy: requiredBy || undefined,
        department: department || undefined,
        priority: priority || undefined,
        description: description || undefined,
        deliveryAddress: deliveryAddress || undefined,
        contactPerson: contactPerson || undefined,
        contactNumber: contactNumber || undefined,
        billingAddress: billingAddress || undefined,
        stateCode: stateCode || undefined,
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
      if (editRow) {
        const res = await api.put(`/material-purchase-requests/${editRow.id}`, payload);
        return res.data;
      }
      const res = await api.post('/material-purchase-requests', payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mprs'] });
      setCreateOpen(false);
      setError('');
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

  function downloadPDF(mprId: string, mprNumber: string) {
    const token = localStorage.getItem('firebaseToken');
    const url = `${api.defaults.baseURL}/material-purchase-requests/${mprId}/pdf`;
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
    const url = `${api.defaults.baseURL}/material-purchase-requests/${mprId}/pdf`;
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
          {mprs.map((row) => (
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

                  {/* Actions */}
                  <Box sx={{ display: 'flex', gap: 0.5, mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'action.hover', flexWrap: 'wrap' }}>
                    <IconButton size="small" onClick={() => previewPDF(row.id)} title="Preview PDF" disabled={pdfLoading}>
                      {pdfLoading ? <CircularProgress size={16} /> : <PdfIcon fontSize="small" />}
                    </IconButton>
                    <IconButton size="small" onClick={() => downloadPDF(row.id, row.mprNumber)} title="Download PDF">
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                    {row.status === MPRStatus.DRAFT && (
                      <>
                        <IconButton size="small" onClick={() => openEdit(row)} title="Edit"><EditIcon fontSize="small" /></IconButton>
                        <Button size="small" startIcon={<SendIcon />} onClick={() => submitMutation.mutate(row.id)} disabled={submitMutation.isPending}>Submit</Button>
                        <IconButton size="small" onClick={() => deleteMutation.mutate(row.id)} title="Delete"><DeleteIcon fontSize="small" /></IconButton>
                      </>
                    )}
                    {row.status === MPRStatus.SUBMITTED && (
                      <>
                        <Button size="small" color="success" onClick={() => closeMutation.mutate(row.id)} disabled={closeMutation.isPending}>Mark Closed</Button>
                        <Button size="small" color="error" startIcon={<CloseIcon />} onClick={() => cancelMutation.mutate(row.id)} disabled={cancelMutation.isPending}>Cancel</Button>
                      </>
                    )}
                    {(row.status === MPRStatus.QUOTATIONS_RECEIVED) && (
                      <Button size="small" color="success" onClick={() => closeMutation.mutate(row.id)} disabled={closeMutation.isPending}>Mark Closed</Button>
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>{editRow ? `Edit ${editRow.mprNumber}` : 'New Material Purchase Request'}</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

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
              <TextField
                fullWidth
                size="small"
                label="Department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
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
    </Box>
  );
}
