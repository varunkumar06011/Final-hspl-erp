import { useState } from 'react';
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
} from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Check as CheckIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  PhotoCamera as PhotoCameraIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDate, enumLabel } from '../utils/enumOptions';
import { useTranslation, Trans } from 'react-i18next';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveTable from '../components/ResponsiveTable';
import RefreshButton from '../components/RefreshButton';
import CommentsButton from '../components/CommentsButton';
import FilePicker from '../components/FilePicker';

interface GatePassItem {
  materialName: string;
  quantity: number;
  unit?: string | null;
}

interface GatePassRow {
  id: string;
  passNumber: string;
  gatePassCategory: 'MATERIAL' | 'VISITOR';
  poId: string | null;
  invoiceId: string | null;
  status: string;
  date: string;
  createdBy: string;
  createdByUser: { id: string; name: string };
  purchaseOrder: {
    id: string;
    poNumber: string;
    vendor: { name: string; vendorCode: string };
    items: GatePassItem[];
  } | null;
  invoice: { id: string; invoiceCode: string; invoiceNumber: string } | null;
  items: GatePassItem[];
  otpApprovedByUser: { id: string; name: string } | null;
  otpApprovedAt: string | null;
}

interface ApprovedPO {
  id: string;
  poNumber: string;
  vendor: { name: string; vendorCode: string };
  paymentType: string;
  grandTotal: number;
  items: {
    materialName: string;
    quantity: number;
    orderedQuantity: number;
    receivedQuantity: number;
    inTransitQuantity: number;
    remainingQuantity: number;
    unit: string | null;
  }[];
  invoices: {
    id: string;
    invoiceCode: string;
    invoiceNumber: string;
    verificationStatus: string;
    stockStatus: string;
  }[];
}

export default function GatePassesPage() {
  const { t } = useTranslation('gatepass');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [gatePassCategory, setGatePassCategory] = useState<'MATERIAL' | 'VISITOR'>('MATERIAL');
  const [categoryConfirmed, setCategoryConfirmed] = useState(false);
  const [selectedPoId, setSelectedPoId] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [visitDate, setVisitDate] = useState('');
  const [visitTime, setVisitTime] = useState('');
  const [purpose, setPurpose] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverMobile, setDriverMobile] = useState('');
  const [gatePassType, setGatePassType] = useState('NON_RETURNABLE');
  const [remarks, setRemarks] = useState('');
  const [photoProof, setPhotoProof] = useState<File | null>(null);
  const [createdGatePass, setCreatedGatePass] = useState<{ id: string; passNumber: string } | null>(
    null,
  );
  const [deleteRow, setDeleteRow] = useState<GatePassRow | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/gate-passes', page, pageSize, search, statusFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const response = await api.get('/gate-passes', { params });
      return response.data;
    },
  });

  const { data: approvedPOs } = useQuery<ApprovedPO[]>({
    queryKey: ['/gate-passes/approved-pos'],
    queryFn: async () => {
      const response = await api.get('/gate-passes/approved-pos');
      return response.data?.data ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = new FormData();
      payload.append('gatePassCategory', gatePassCategory);
      if (gatePassCategory === 'MATERIAL') {
        payload.append('poId', selectedPoId);
        if (selectedInvoiceId) payload.append('invoiceId', selectedInvoiceId);
      }
      if (gatePassCategory === 'VISITOR') {
        if (visitorName) payload.append('visitorName', visitorName);
        if (visitorPhone) payload.append('visitorPhone', visitorPhone);
        if (visitDate) payload.append('visitDate', visitDate);
        if (visitTime) payload.append('visitTime', visitTime);
        if (purpose) payload.append('purpose', purpose);
      } else {
        payload.append('vehicleType', vehicleType);
        if (vehicleNumber.trim()) payload.append('vehicleNumber', vehicleNumber.trim().toUpperCase());
        if (driverName) payload.append('driverName', driverName);
        if (driverMobile) payload.append('driverMobile', driverMobile);
        payload.append('gatePassType', gatePassType);
      }
      if (remarks) payload.append('remarks', remarks);
      if (photoProof) payload.append('photoProof', photoProof);
      const response = await api.post('/gate-passes', payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/gate-passes'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/goods-receipts/available-gatepasses'] });
      setCreateOpen(false);
      setCreatedGatePass({ id: data.id, passNumber: data.passNumber });
      resetForm();
      setSuccessMsg(t('createdMsg', { n: data.passNumber }));
      setTimeout(() => setSuccessMsg(''), 8000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  // One-click approval for passes created before OTP was removed (still PENDING).
  const approveMutation = useMutation({
    mutationFn: async (id: string) => (await api.post(`/gate-passes/${id}/approve`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/gate-passes'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/goods-receipts/available-gatepasses'] });
      setSuccessMsg(t('approvedMsg'));
      setTimeout(() => setSuccessMsg(''), 5000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/gate-passes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/gate-passes'] });
      setDeleteRow(null);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: GatePassRow[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  function resetForm() {
    setGatePassCategory('MATERIAL');
    setCategoryConfirmed(false);
    setSelectedPoId('');
    setSelectedInvoiceId('');
    setVisitorName('');
    setVisitorPhone('');
    setVisitDate('');
    setVisitTime('');
    setPurpose('');
    setVehicleType('');
    setVehicleNumber('');
    setDriverName('');
    setDriverMobile('');
    setGatePassType('NON_RETURNABLE');
    setRemarks('');
    setPhotoProof(null);
    setError('');
  }

  const selectedPO = approvedPOs?.find((po) => po.id === selectedPoId);

  async function downloadGatePassPdf(id: string, passNumber?: string) {
    try {
      const response = await api.get(`/gate-passes/${id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${passNumber ?? 'gate-pass'}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
          flexWrap: 'wrap',
        }}
      >
        <Typography
          variant="h5"
          fontWeight={600}
          sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}
        >
          {t('title')}
        </Typography>
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            flexWrap: 'wrap',
            justifyContent: { xs: 'flex-end', md: 'flex-end' },
            width: { xs: '100%', md: 'auto' },
          }}
        >
          <RefreshButton onClick={() => refetch()} />
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              resetForm();
              setCreateOpen(true);
            }}
          >
            {t('create')}
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {successMsg && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>
          {successMsg}
        </Alert>
      )}
      {createdGatePass && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={<DownloadIcon />}
              onClick={() => downloadGatePassPdf(createdGatePass.id, createdGatePass.passNumber)}
            >
              {t('downloadPdf')}
            </Button>
          }
        >
          {t('readyToDownload', { n: createdGatePass.passNumber })}
        </Alert>
      )}

      <Card>
        <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder={t('search')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />
          <TextField
            select
            size="small"
            label={t('status')}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            sx={{ width: 150 }}
          >
            <MenuItem value="">{t('all')}</MenuItem>
            <MenuItem value="PENDING">{enumLabel('PENDING')}</MenuItem>
            <MenuItem value="APPROVED">{enumLabel('APPROVED')}</MenuItem>
          </TextField>
        </Box>

        <ResponsiveTable>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{t('passNumber')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('type')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('po')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('invoice')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('vendor')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('items')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('approvedBy')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('date')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('status')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} align="center" sx={{ py: 4 }}>
                      <CircularProgress size={32} />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">{t('none')}</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell data-label={t('passNumber')}>{row.passNumber}</TableCell>
                      <TableCell data-label={t('type')}><Chip size="small" label={row.gatePassCategory === 'VISITOR' ? t('visitor') : t('material')} color={row.gatePassCategory === 'VISITOR' ? 'info' : 'default'} /></TableCell>
                      <TableCell data-label={t('po')}>{row.purchaseOrder?.poNumber ?? '—'}</TableCell>
                      <TableCell data-label={t('invoice')}>{row.invoice?.invoiceCode ?? '—'}</TableCell>
                      <TableCell data-label={t('vendor')}>
                        {row.purchaseOrder?.vendor
                          ? `${row.purchaseOrder.vendor.vendorCode} - ${row.purchaseOrder.vendor.name}`
                          : '—'}
                      </TableCell>
                      <TableCell data-label={t('items')}>{t('itemsCount', { n: row.items?.length ?? 0 })}</TableCell>
                      <TableCell data-label={t('approvedBy')}>
                        {row.otpApprovedByUser?.name ?? '—'}
                      </TableCell>
                      <TableCell data-label={t('date')}>{formatDate(row.date)}</TableCell>
                      <TableCell data-label={t('status')}>
                        <Chip
                          label={enumLabel(row.status)}
                          size="small"
                          color={row.status === 'APPROVED' ? 'success' : row.status === 'DELIVERED' ? 'info' : 'warning'}
                        />
                      </TableCell>
                      <TableCell data-label={t('actions')}>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <CommentsButton entityType="GATE_PASS" entityId={row.id} entityLabel={row.passNumber} url="/gate-passes" />
                          <IconButton
                            size="small"
                            title={t('downloadPdf')}
                            onClick={() => downloadGatePassPdf(row.id, row.passNumber)}
                          >
                            <DownloadIcon fontSize="small" />
                          </IconButton>
                          {row.status === 'PENDING' && (
                            <>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<CheckIcon />}
                                disabled={approveMutation.isPending}
                                onClick={() => approveMutation.mutate(row.id)}
                              >
                                {t('approve')}
                              </Button>
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => setDeleteRow(row)}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))
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
          onRowsPerPageChange={(e) => {
            setPageSize(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 20, 50]}
          sx={{ '& .MuiTablePagination-toolbar': { flexWrap: 'wrap' } }}
        />
      </Card>

      {/* Create Gate Pass Dialog */}
      <ResponsiveDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          resetForm();
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('createTitle')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {!categoryConfirmed ? (
              <TextField
                select
                label={t('whichPass')}
                value=""
                onChange={(e) => {
                  setGatePassCategory(e.target.value as 'MATERIAL' | 'VISITOR');
                  setCategoryConfirmed(true);
                }}
                fullWidth
                size="small"
              >
                <MenuItem value="MATERIAL">{t('materialPass')}</MenuItem>
                <MenuItem value="VISITOR">{t('visitorPass')}</MenuItem>
              </TextField>
            ) : <>
            <Typography variant="body2" color="text.secondary">
              {gatePassCategory === 'MATERIAL' ? t('materialPass') : t('visitorPass')}
            </Typography>
            {gatePassCategory === 'MATERIAL' && <>
            <TextField
              select
              label={t('poApproved')}
              value={selectedPoId}
              onChange={(e) => {
                const poId = e.target.value;
                setSelectedPoId(poId);
                setSelectedInvoiceId('');
              }}
              fullWidth
              size="small"
              required
              helperText={approvedPOs?.length === 0 ? t('noApprovedPOs') : undefined}
            >
              {approvedPOs?.map((po) => (
                <MenuItem key={po.id} value={po.id}>
                  {po.poNumber} — {po.vendor.vendorCode} - {po.vendor.name}
                </MenuItem>
              ))}
            </TextField>

            {selectedPO && selectedPO.invoices.length > 0 && (
              <TextField
                select
                label={t('invoiceOptional')}
                value={selectedInvoiceId}
                onChange={(e) => setSelectedInvoiceId(e.target.value)}
                fullWidth
                size="small"
                helperText={t('invoiceHelp')}
              >
                <MenuItem value="">{t('noneOption')}</MenuItem>
                {selectedPO.invoices.map((inv) => (
                  <MenuItem key={inv.id} value={inv.id}>
                    {inv.invoiceCode} — {inv.invoiceNumber}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {selectedPO && selectedPO.invoices.length === 0 && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                {t('noInvoice')}
              </Alert>
            )}

            {selectedPO && (
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                  {t('poItemsTitle')}
                </Typography>
                <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>{t('colMaterial')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('ordered')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('accepted')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('inTransit')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('expected')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t('unit')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedPO.items?.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{item.materialName}</TableCell>
                          <TableCell>{item.orderedQuantity}</TableCell>
                          <TableCell>{item.receivedQuantity}</TableCell>
                          <TableCell>{item.inTransitQuantity ?? 0}</TableCell>
                          <TableCell>{item.remainingQuantity}</TableCell>
                          <TableCell>{item.unit ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Typography variant="caption" color="text.secondary">
                  {t('qtyHelp')}
                </Typography>
              </Box>
            )}
            </>}

            <Typography variant="subtitle2" sx={{ mt: 1 }}>
              {gatePassCategory === 'VISITOR' ? t('visitorDetails') : t('vehicleDetails')}
            </Typography>
            <Box
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}
            >
              {gatePassCategory === 'VISITOR' && <>
              <TextField
                label={t('visitorName')}
                value={visitorName}
                required={gatePassCategory === 'VISITOR'}
                onChange={(e) => setVisitorName(e.target.value)}
                size="small"
              />
              <TextField
                label={t('visitorPhone')}
                value={visitorPhone}
                onChange={(e) => setVisitorPhone(e.target.value)}
                size="small"
              />
              <TextField
                label={t('visitDate')}
                type="date"
                value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
                size="small"
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label={t('visitTime')}
                type="time"
                value={visitTime}
                onChange={(e) => setVisitTime(e.target.value)}
                size="small"
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label={t('purpose')}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                size="small"
              />
              </>}
              {gatePassCategory === 'MATERIAL' && <>
              <TextField
                select
                label={t('vehicleType')}
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value)}
                size="small"
                required
              >
                {['LORRY', 'TRUCK', 'MINI_TRUCK', 'TRAILER', 'CAR', 'BIKE', 'AUTO', 'VAN', 'OTHER'].map((v) => (
                  <MenuItem key={v} value={v}>{t(`vehicleTypes.${v}`)}</MenuItem>
                ))}
              </TextField>
              <TextField
                label={t('vehicleNumber')}
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                size="small"
                helperText={t('vehicleNumberHelp')}
                inputProps={{ maxLength: 20 }}
              />
              <TextField
                label={t('driverName')}
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                size="small"
              />
              <TextField
                label={t('driverMobile')}
                value={driverMobile}
                onChange={(e) => setDriverMobile(e.target.value)}
                size="small"
              />
              <TextField
                select
                label={t('gatePassType')}
                value={gatePassType}
                onChange={(e) => setGatePassType(e.target.value)}
                size="small"
              >
                <MenuItem value="NON_RETURNABLE">{t('nonReturnable')}</MenuItem>
                <MenuItem value="RETURNABLE">{t('returnable')}</MenuItem>
              </TextField>
              </>}
              <TextField
                label={t('remarks')}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                size="small"
                multiline
                minRows={1}
              />
            </Box>
            <FilePicker
              file={photoProof}
              onChange={setPhotoProof}
              accept="image/*"
              size="small"
              startIcon={<PhotoCameraIcon />}
              label={t('addPhoto')}
              selectedLabel={photoProof ? t('photoName', { name: photoProof.name }) : undefined}
            />

            </>}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setCreateOpen(false);
              resetForm();
            }}
          >
            {t('cancel')}
          </Button>
          {categoryConfirmed && <Button
            variant="contained"
            onClick={() => {
              setError('');
              createMutation.mutate();
            }}
            disabled={
              (gatePassCategory === 'MATERIAL' && !selectedPoId) ||
              (gatePassCategory === 'VISITOR' && !visitorName.trim()) ||
              createMutation.isPending
            }
          >
            {createMutation.isPending ? (
              <CircularProgress size={20} />
            ) : (
              t('createPass')
            )}
          </Button>}
        </DialogActions>
      </ResponsiveDialog>

      <ResponsiveDialog open={deleteRow !== null} onClose={() => setDeleteRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('deleteTitle')}</DialogTitle>
        <DialogContent>
          <Typography><Trans t={t} i18nKey="deleteConfirm" values={{ n: deleteRow?.passNumber }} components={{ b: <strong /> }} /></Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {t('deleteNote')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRow(null)}>{t('cancel')}</Button>
          <Button color="error" variant="contained" disabled={deleteMutation.isPending} onClick={() => deleteRow && deleteMutation.mutate(deleteRow.id)}>
            {deleteMutation.isPending ? <CircularProgress size={20} /> : t('delete')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
