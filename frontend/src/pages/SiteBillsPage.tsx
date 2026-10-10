import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  ReceiptLong as BillIcon,
  Visibility as ViewIcon,
  AccountTree as CombinedIcon,
  PlaylistAddCheck as SelectTodayIcon,
} from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { POPaymentType, SITE_BILL_LIMIT, SiteBillPaymentMode } from '@hospital-erp/shared';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import ResponsiveDialog from '../components/ResponsiveDialog';
import FilePicker from '../components/FilePicker';
import ItemsGist from '../components/ItemsGist';
import RefreshButton from '../components/RefreshButton';
import MaterialAutocomplete, { useMaterialCatalog } from '../components/MaterialAutocomplete';
import { useFileViewer } from '../components/FileViewerDialog';
import { useToast } from '../components/ToastProvider';
import { QTY_UNIT_OPTIONS, enumLabel, formatCurrency, formatDate, unitLabel } from '../utils/enumOptions';

interface SiteBillRow {
  id: string;
  mprNumber: string;
  billDate: string;
  shopName: string | null;
  paymentMode: string | null;
  description: string | null;
  total: number;
  items: { materialName: string; quantity: number; unit: string | null; rate: number; amount: number }[];
  paidBy: { id: string; name: string } | null;
  fileName: string | null;
  hasFile: boolean;
  po: { id: string; poNumber: string; status: string } | null;
  previousPo: { id: string; poNumber: string; status: string } | null;
}

interface ListResponse {
  data: SiteBillRow[];
  summary: { count: number; openCount: number; openTotal: number; limit: number };
}

type Filter = 'open' | 'in_po' | 'all';

const todayIso = () => new Date().toISOString().slice(0, 10);
const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);

/**
 * Site bills: small purchases (up to ₹5,000) paid at site with a proper bill.
 * No approval per bill — add the bills, tick several (e.g. today's) and raise one
 * PO for all of them; that PO goes for approval like any other.
 */
export default function SiteBillsPage() {
  const { t } = useTranslation('sitebills');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { openPath, viewer } = useFileViewer();
  const [filter, setFilter] = useState<Filter>('open');
  const [search, setSearch] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [poOpen, setPoOpen] = useState(false);
  const [deleteRow, setDeleteRow] = useState<SiteBillRow | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/site-bills', filter, search, paymentMode],
    queryFn: async () =>
      (await api.get('/site-bills', { params: { filter, search: search || undefined, paymentMode: paymentMode || undefined } })).data as ListResponse,
  });
  const rows = useMemo(() => data?.data ?? [], [data]);
  const openRows = rows.filter((r) => !r.po);
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const selectedTotal = selectedRows.reduce((s, r) => s + r.total, 0);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectToday = () => setSelected(new Set(openRows.filter((r) => sameDay(r.billDate, todayIso())).map((r) => r.id)));

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/site-bills/${id}`),
    onSuccess: () => {
      setDeleteRow(null);
      queryClient.invalidateQueries({ queryKey: ['/site-bills'] });
      toast.success(t('deleted'));
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  return (
    <Box sx={{ pb: selected.size > 0 ? 10 : 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>{t('title')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('subtitle', { limit: formatCurrency(SITE_BILL_LIMIT) })}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <RefreshButton onClick={() => refetch()} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>{t('addBill')}</Button>
        </Box>
      </Box>

      {data && (
        <Alert severity="info" icon={<BillIcon />} sx={{ mb: 2 }}>
          {t('openSummary', { count: data.summary.openCount, total: formatCurrency(data.summary.openTotal) })}
        </Alert>
      )}

      <Card sx={{ p: 1.5, mb: 2 }}>
        <Tabs value={filter} onChange={(_e, v) => { setFilter(v); setSelected(new Set()); }} variant="scrollable" sx={{ mb: 1 }}>
          <Tab value="open" label={t('tabOpen')} />
          <Tab value="in_po" label={t('tabInPo')} />
          <Tab value="all" label={t('tabAll')} />
        </Tabs>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ flex: 1, minWidth: 200 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          />
          <TextField select size="small" label={t('paymentMode')} value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="">{t('allModes')}</MenuItem>
            {Object.values(SiteBillPaymentMode).map((m) => <MenuItem key={m} value={m}>{enumLabel(m)}</MenuItem>)}
          </TextField>
          {filter !== 'in_po' && openRows.length > 0 && (
            <Button size="small" startIcon={<SelectTodayIcon />} onClick={selectToday}>{t('selectToday')}</Button>
          )}
        </Box>
      </Card>

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : rows.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <BillIcon color="disabled" sx={{ fontSize: 48 }} />
          <Typography color="text.secondary" sx={{ mt: 1 }}>{filter === 'open' ? t('noneOpen') : t('none')}</Typography>
        </Paper>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {rows.map((row) => {
            const selectable = !row.po;
            return (
              <Card
                key={row.id}
                variant="outlined"
                sx={{ p: 1.25, borderColor: selected.has(row.id) ? 'primary.main' : 'divider', bgcolor: selected.has(row.id) ? 'action.selected' : 'background.paper' }}
              >
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  {selectable && <Checkbox checked={selected.has(row.id)} onChange={() => toggle(row.id)} sx={{ p: 0.5 }} inputProps={{ 'aria-label': t('select') }} />}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography fontWeight={700}>{row.shopName || '—'}</Typography>
                      <Typography variant="body2" color="text.secondary">{row.mprNumber} · {formatDate(row.billDate)}</Typography>
                      {row.paymentMode && <Chip size="small" label={enumLabel(row.paymentMode)} variant="outlined" />}
                      {row.po ? (
                        <Chip size="small" color="success" icon={<CombinedIcon />} label={t('inPo', { po: row.po.poNumber, status: enumLabel(row.po.status) })} onClick={() => navigate(`/combined-records?type=po&id=${row.po!.id}`)} />
                      ) : (
                        <Chip size="small" color="warning" label={t('notInPo')} />
                      )}
                      {row.previousPo && <Chip size="small" variant="outlined" label={t('previousPo', { po: row.previousPo.poNumber, status: enumLabel(row.previousPo.status) })} />}
                      <Box sx={{ flex: 1 }} />
                      <Typography fontWeight={700}>{formatCurrency(row.total)}</Typography>
                    </Box>
                    <ItemsGist items={row.items.map((i) => ({ ...i, unitPrice: i.rate }))} max={6} />
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mt: 0.5 }}>
                      {row.paidBy && <Typography variant="caption" color="text.secondary">{t('paidBy', { name: row.paidBy.name })}</Typography>}
                      {row.description && <Typography variant="caption" color="text.secondary">· {row.description}</Typography>}
                      <Box sx={{ flex: 1 }} />
                      {row.hasFile && (
                        <Button size="small" startIcon={<ViewIcon />} onClick={() => openPath(`/material-purchase-requests/${row.id}/receipt`, row.fileName ?? 'bill')}>{t('viewBill')}</Button>
                      )}
                      {!row.po && (
                        <IconButton size="small" color="error" onClick={() => setDeleteRow(row)} aria-label={t('delete')}><DeleteIcon fontSize="small" /></IconButton>
                      )}
                    </Box>
                  </Box>
                </Box>
              </Card>
            );
          })}
        </Box>
      )}

      {selected.size > 0 && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed', left: { xs: 8, md: 'auto' }, right: { xs: 8, md: 24 }, bottom: 'calc(12px + env(safe-area-inset-bottom))',
            p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', zIndex: 10, borderRadius: 2,
          }}
        >
          <Typography fontWeight={700}>{t('selectedSummary', { count: selected.size, total: formatCurrency(selectedTotal) })}</Typography>
          <Button size="small" onClick={() => setSelected(new Set())}>{t('clear')}</Button>
          <Button variant="contained" onClick={() => setPoOpen(true)}>{t('generatePo')}</Button>
        </Paper>
      )}

      <AddBillDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <GeneratePoDialog
        open={poOpen}
        bills={selectedRows}
        onClose={() => setPoOpen(false)}
        onDone={(po) => {
          setPoOpen(false);
          setSelected(new Set());
          toast.success(t('poCreated', { po: po.poNumber }));
          navigate(`/combined-records?type=po&id=${po.id}`);
        }}
      />

      <ResponsiveDialog open={!!deleteRow} onClose={() => setDeleteRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('deleteTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('deleteConfirm', { n: deleteRow?.mprNumber, shop: deleteRow?.shopName ?? '' })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRow(null)}>{t('cancel')}</Button>
          <Button color="error" variant="contained" disabled={deleteMutation.isPending} onClick={() => deleteRow && deleteMutation.mutate(deleteRow.id)}>{t('delete')}</Button>
        </DialogActions>
      </ResponsiveDialog>
      {viewer}
    </Box>
  );
}

interface ItemDraft {
  materialName: string;
  quantity: string;
  unit: string;
  rate: string;
}
const emptyItem = (): ItemDraft => ({ materialName: '', quantity: '1', unit: 'nos', rate: '' });

function AddBillDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('sitebills');
  const queryClient = useQueryClient();
  const toast = useToast();
  const catalog = useMaterialCatalog(open);
  const [billDate, setBillDate] = useState(todayIso());
  const [shopName, setShopName] = useState('');
  const [mode, setMode] = useState<string>(SiteBillPaymentMode.CASH);
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');

  const total = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.rate) || 0), 0);
  const overLimit = total > SITE_BILL_LIMIT;
  const validItems = items.filter((i) => i.materialName.trim() && Number(i.quantity) > 0);
  const canSave = !!shopName.trim() && validItems.length > 0 && total > 0 && !overLimit;

  const reset = () => {
    setBillDate(todayIso());
    setShopName('');
    setMode(SiteBillPaymentMode.CASH);
    setDescription('');
    setItems([emptyItem()]);
    setFile(null);
    setError('');
  };
  const close = () => { reset(); onClose(); };

  const save = useMutation({
    mutationFn: async (addAnother: boolean) => {
      const form = new FormData();
      form.append('billDate', billDate);
      form.append('shopName', shopName.trim());
      form.append('paymentMode', mode);
      if (description.trim()) form.append('description', description.trim());
      form.append('items', JSON.stringify(validItems.map((i) => ({
        materialName: i.materialName.trim(),
        quantity: Number(i.quantity),
        unit: i.unit || undefined,
        rate: Number(i.rate) || 0,
      }))));
      if (file) form.append('file', file);
      await api.post('/site-bills', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      return addAnother;
    },
    onSuccess: (addAnother) => {
      queryClient.invalidateQueries({ queryKey: ['/site-bills'] });
      toast.success(t('billSaved'));
      if (addAnother) {
        // Same day and shop are common for the next bill: keep the date, clear the rest.
        setShopName('');
        setDescription('');
        setItems([emptyItem()]);
        setFile(null);
        setError('');
      } else close();
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const setItem = (idx: number, patch: Partial<ItemDraft>) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  return (
    <ResponsiveDialog open={open} onClose={close} maxWidth="md" fullWidth>
      <DialogTitle>{t('addBill')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '180px 1fr' }, gap: 2 }}>
          <TextField type="date" size="small" label={t('billDate')} value={billDate} onChange={(e) => setBillDate(e.target.value)} InputLabelProps={{ shrink: true }} required />
          <TextField size="small" label={t('shopName')} value={shopName} onChange={(e) => setShopName(e.target.value)} required />
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>{t('howPaid')}</Typography>
          <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_e, v) => v && setMode(v)} sx={{ flexWrap: 'wrap' }}>
            {Object.values(SiteBillPaymentMode).map((m) => <ToggleButton key={m} value={m}>{enumLabel(m)}</ToggleButton>)}
          </ToggleButtonGroup>
        </Box>

        <Box>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{t('items')}</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {items.map((item, idx) => (
              <Box key={idx} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '2fr 80px 110px 110px 110px 40px' }, gap: 1, alignItems: 'center' }}>
                <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
                  <MaterialAutocomplete
                    value={item.materialName}
                    label={t('item')}
                    catalog={catalog}
                    onTyped={(name) => setItem(idx, { materialName: name })}
                    onPicked={(m) => setItem(idx, { materialName: m.materialName, unit: m.unit ?? item.unit })}
                    sx={{ minWidth: 0 }}
                  />
                </Box>
                <TextField size="small" type="number" label={t('qty')} value={item.quantity} onChange={(e) => setItem(idx, { quantity: e.target.value })} inputProps={{ min: 0, step: 'any' }} />
                <TextField select size="small" label={t('unit')} value={item.unit} onChange={(e) => setItem(idx, { unit: e.target.value })}>
                  {QTY_UNIT_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{unitLabel(o.value)}</MenuItem>)}
                </TextField>
                <TextField size="small" type="number" label={t('rate')} value={item.rate} onChange={(e) => setItem(idx, { rate: e.target.value })} inputProps={{ min: 0, step: 'any' }} />
                <Typography variant="body2" fontWeight={600} sx={{ textAlign: 'right' }}>{formatCurrency((Number(item.quantity) || 0) * (Number(item.rate) || 0))}</Typography>
                <IconButton size="small" disabled={items.length === 1} onClick={() => setItems((prev) => prev.filter((_x, i) => i !== idx))} aria-label={t('removeItem')}><DeleteIcon fontSize="small" /></IconButton>
              </Box>
            ))}
          </Box>
          <Button size="small" startIcon={<AddIcon />} onClick={() => setItems((prev) => [...prev, emptyItem()])} sx={{ mt: 1 }}>{t('addItem')}</Button>
        </Box>

        <Alert severity={overLimit ? 'error' : 'success'} icon={false}>
          <Typography fontWeight={700}>{t('billTotal', { total: formatCurrency(total) })}</Typography>
          <Typography variant="caption">{overLimit ? t('overLimit', { limit: formatCurrency(SITE_BILL_LIMIT) }) : t('withinLimit', { limit: formatCurrency(SITE_BILL_LIMIT) })}</Typography>
        </Alert>

        <TextField size="small" label={t('descriptionOptional')} value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} />
        <Box>
          <FilePicker file={file} onChange={setFile} label={t('attachBill')} accept="image/*,application/pdf" />
        </Box>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={close}>{t('cancel')}</Button>
        <Button disabled={!canSave || save.isPending} onClick={() => save.mutate(true)}>{t('saveAddAnother')}</Button>
        <Button variant="contained" disabled={!canSave || save.isPending} onClick={() => save.mutate(false)}>
          {save.isPending ? <CircularProgress size={20} /> : t('saveBill')}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

function GeneratePoDialog({
  open,
  bills,
  onClose,
  onDone,
}: {
  open: boolean;
  bills: SiteBillRow[];
  onClose: () => void;
  onDone: (po: { id: string; poNumber: string }) => void;
}) {
  const { t } = useTranslation('sitebills');
  const { user } = useAuthStore();
  const [paymentType, setPaymentType] = useState<string>(POPaymentType.FULL_PAYMENT);
  const [reimburseTo, setReimburseTo] = useState('');
  const [budgetHeadId, setBudgetHeadId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const total = bills.reduce((s, b) => s + b.total, 0);
  const payers = Array.from(new Set(bills.map((b) => b.paidBy?.name).filter(Boolean))).join(', ');
  const modes = Array.from(new Set(bills.map((b) => b.paymentMode).filter(Boolean))) as string[];

  const { data: heads } = useQuery({
    queryKey: ['/budget-heads', 'all'],
    queryFn: async () => (await api.get('/budget-heads', { params: { page: 1, pageSize: 100 } })).data,
    enabled: open,
  });
  const budgetHeads: { id: string; particulars: string }[] = heads?.data ?? [];

  const generate = useMutation({
    mutationFn: async () =>
      (await api.post('/site-bills/generate-po', {
        billIds: bills.map((b) => b.id),
        paymentType,
        reimburseTo: reimburseTo.trim() || undefined,
        budgetHeadId: budgetHeadId || undefined,
        notes: notes.trim() || undefined,
      })).data as { id: string; poNumber: string },
    onSuccess: (po) => {
      setNotes('');
      setBudgetHeadId('');
      setReimburseTo('');
      setError('');
      onDone(po);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('generatePoTitle', { count: bills.length })}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
        <Alert severity="info">{t('generatePoInfo', { total: formatCurrency(total) })}</Alert>
        {modes.length > 1 && <Alert severity="warning">{t('mixedModes', { modes: modes.map(enumLabel).join(', ') })}</Alert>}
        <Box sx={{ maxHeight: 180, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
          {bills.map((b) => (
            <Box key={b.id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.25 }}>
              <Typography variant="body2" noWrap>{b.mprNumber} · {b.shopName} · {formatDate(b.billDate)} · {b.paymentMode ? enumLabel(b.paymentMode) : ''}</Typography>
              <Typography variant="body2" fontWeight={600}>{formatCurrency(b.total)}</Typography>
            </Box>
          ))}
        </Box>
        <TextField select size="small" label={t('poPaymentType')} value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
          {Object.values(POPaymentType).map((p) => <MenuItem key={p} value={p}>{enumLabel(p)}</MenuItem>)}
        </TextField>
        <TextField size="small" label={t('reimburseTo')} placeholder={payers || user?.name || ''} value={reimburseTo} onChange={(e) => setReimburseTo(e.target.value)} helperText={t('reimburseToHelp', { names: payers || '—' })} />
        <TextField select size="small" label={t('budgetHeadOptional')} value={budgetHeadId} onChange={(e) => setBudgetHeadId(e.target.value)} helperText={t('budgetHeadLater')}>
          <MenuItem value="">{t('noBudgetHead')}</MenuItem>
          {budgetHeads.map((h) => <MenuItem key={h.id} value={h.id}>{h.particulars}</MenuItem>)}
        </TextField>
        <TextField size="small" label={t('descriptionOptional')} value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="contained" disabled={generate.isPending || bills.length === 0} onClick={() => generate.mutate()}>
          {generate.isPending ? <CircularProgress size={20} /> : t('generatePoConfirm', { total: formatCurrency(total) })}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
