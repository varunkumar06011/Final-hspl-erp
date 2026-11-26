import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Add as AddIcon, Check as CheckIcon, Delete as DeleteIcon, MoveToInbox as ReceiveIcon, PhotoCamera as PhotoCameraIcon } from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CatalogItemKind, InventoryItemType, StockSourceType, isApproverRole } from '@hospital-erp/shared';
import CatalogLineFields from '../CatalogLineFields';
import { useMaterialCatalog } from '../MaterialAutocomplete';
import ResponsiveDialog from '../ResponsiveDialog';
import CreatableSelect from '../CreatableSelect';
import FilePicker from '../FilePicker';
import api, { extractErrorMessage } from '../../config/api';
import { useAuthStore } from '../../stores/authStore';
import { enumLabel, enumToOptions, formatIndianNumber } from '../../utils/enumOptions';

interface Line {
  materialName: string;
  itemId?: string | null;
  specification?: string | null;
  unit: string;
  quantity: string;
  unitCost: string;
  itemType: string;
}

interface InventoryItemOption {
  id: string;
  name: string;
  unit: string;
  itemType: string;
}

const emptyLine = (): Line => ({ materialName: '', unit: '', quantity: '', unitCost: '', itemType: InventoryItemType.CONSUMABLE });
const todayStr = () => new Date().toISOString().slice(0, 10);
const num = (v: string) => Number(String(v).replace(/,/g, ''));

export default function ReceiveStockDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useTranslation('inventory');
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const willAutoPost = !!user && isApproverRole(user.role);

  const [sourceType, setSourceType] = useState<string>(StockSourceType.OPENING_STOCK);
  const [entryDate, setEntryDate] = useState(todayStr());
  const [supplierName, setSupplierName] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const catalog = useMaterialCatalog(open, CatalogItemKind.MATERIAL);
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState('');

  const { data: itemOptions = [] } = useQuery<InventoryItemOption[]>({
    queryKey: ['/inventory/items', 'options'],
    queryFn: async () => (await api.get('/inventory/items', { params: { page: 1, pageSize: 100 } })).data?.data ?? [],
    enabled: open,
    staleTime: 30_000,
  });

  const reset = () => {
    setSourceType(StockSourceType.OPENING_STOCK);
    setEntryDate(todayStr());
    setSupplierName('');
    setReferenceNo('');
    setNotes('');
    setLines([emptyLine()]);
    setPhoto(null);
    setError('');
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        sourceType,
        entryDate,
        supplierName: supplierName.trim() || undefined,
        referenceNo: referenceNo.trim() || undefined,
        notes: notes.trim() || undefined,
        items: lines.map((l) => ({
          materialName: l.materialName.trim(),
          itemId: l.itemId || undefined,
          specification: l.specification?.trim() || undefined,
          unit: l.unit.trim(),
          quantity: num(l.quantity),
          unitCost: num(l.unitCost || '0'),
          itemType: l.itemType,
        })),
      };
      const res = await api.post('/stock-entries', payload);
      let photoFailed = false;
      if (photo) {
        const fd = new FormData();
        fd.append('file', photo);
        fd.append('entityType', 'STOCK_ENTRY');
        fd.append('entityId', res.data.id);
        try {
          await api.post('/attachments/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch {
          photoFailed = true;
        }
      }
      return { entry: res.data as { entryNumber: string; status: string }, photoFailed };
    },
    onSuccess: ({ entry, photoFailed }) => {
      queryClient.invalidateQueries({ queryKey: ['/inventory/items'] });
      queryClient.invalidateQueries({ queryKey: ['/inventory/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/inventory/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/stock-entries'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      const msg = entry.status === 'POSTED' ? t('entryPosted', { n: entry.entryNumber }) : t('entryPending', { n: entry.entryNumber });
      onDone(photoFailed ? `${msg} ${t('photoFail')}` : msg);
      reset();
      onClose();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((sum, l) => sum + (num(l.quantity) || 0) * (num(l.unitCost) || 0), 0);

  const submit = () => {
    const valid = lines.every((l) => l.materialName.trim() && l.unit.trim() && num(l.quantity) > 0 && num(l.unitCost || '0') >= 0);
    if (!valid) {
      setError(t('errLines'));
      return;
    }
    setError('');
    mutation.mutate();
  };

  const sectionTitle = (n: number, text: string) => (
    <Stack direction="row" spacing={1} alignItems="center">
      <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: 'primary.main', color: 'primary.contrastText', display: 'grid', placeItems: 'center', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0 }}>{n}</Box>
      <Typography variant="subtitle1" fontWeight={600}>{text}</Typography>
    </Stack>
  );
  const lineCount = lines.filter((l) => l.materialName.trim()).length;
  const inr = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(v);

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: 'success.main', color: 'success.contrastText', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <ReceiveIcon />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" fontWeight={600} sx={{ lineHeight: 1.2 }}>{t('receiveTitle')}</Typography>
            <Typography variant="body2" color="text.secondary">{t('receiveIntro')}</Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

          {/* 1. Where the stock came from */}
          <Stack spacing={1.5}>
            {sectionTitle(1, t('receiveSourceSection'))}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {enumToOptions(StockSourceType).map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  clickable
                  onClick={() => setSourceType(o.value)}
                  color={sourceType === o.value ? 'primary' : 'default'}
                  variant={sourceType === o.value ? 'filled' : 'outlined'}
                  icon={sourceType === o.value ? <CheckIcon /> : undefined}
                />
              ))}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2 }}>
              <TextField id="receive-date" size="small" type="date" label={t('entryDate')} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              <TextField id="receive-supplier" size="small" label={t('supplier')} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
              <TextField id="receive-ref" size="small" label={t('referenceNo')} value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
            </Box>
          </Stack>

          {/* 2. Materials */}
          <Stack spacing={1.5}>
            {sectionTitle(2, t('receiveMaterialsSection'))}
            {lines.map((line, i) => {
              const lineTotal = (num(line.quantity) || 0) * (num(line.unitCost) || 0);
              return (
              <Box key={i} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.5, py: 0.5, bgcolor: 'action.hover', gap: 1 }}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {t('receiveLine', { n: i + 1 })}
                  </Typography>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    {lineTotal > 0 && <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>{inr(lineTotal)}</Typography>}
                    <IconButton
                      size="small"
                      color="error"
                      aria-label={t('removeLine')}
                      disabled={lines.length === 1}
                      onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Stack>
              <Box
                sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: '2.2fr 1fr 1fr 1fr 1.2fr' }, gap: 1.5, alignItems: 'start', p: 1.5 }}
              >
                {/* Same item list as every other screen: material from the catalog, spec from its own list. */}
                <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' }, minWidth: 0 }}>
                  <CatalogLineFields
                    catalog={catalog}
                    line={line}
                    minWidth={0}
                    onChange={(patch) => {
                      // A material already in stock keeps its stock type.
                      const stocked = patch.materialName ? itemOptions.find((o) => o.name.trim().toLowerCase() === patch.materialName!.trim().toLowerCase()) : undefined;
                      setLine(i, { ...patch, unit: patch.unit ?? line.unit, ...(stocked ? { itemType: stocked.itemType } : {}) });
                    }}
                  />
                </Box>
                <CreatableSelect label={t('unit')} value={line.unit} onChange={(v) => setLine(i, { unit: v })} required dropdownType="UNIT" />
                <TextField
                  size="small"
                  label={t('quantity')}
                  required
                  value={formatIndianNumber(line.quantity)}
                  onChange={(e) => setLine(i, { quantity: e.target.value.replace(/,/g, '') })}
                  inputProps={{ inputMode: 'decimal' }}
                />
                <TextField
                  id={`receive-rate-${i}`}
                  size="small"
                  label={t('rateUnit')}
                  value={formatIndianNumber(line.unitCost)}
                  onChange={(e) => setLine(i, { unitCost: e.target.value.replace(/,/g, '') })}
                  inputProps={{ inputMode: 'decimal' }}
                  InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
                />
                <TextField select size="small" label={t('type')} value={line.itemType} onChange={(e) => setLine(i, { itemType: e.target.value })}>
                  <MenuItem value={InventoryItemType.CONSUMABLE}>{enumLabel(InventoryItemType.CONSUMABLE)}</MenuItem>
                  <MenuItem value={InventoryItemType.ASSET}>{enumLabel(InventoryItemType.ASSET)}</MenuItem>
                </TextField>
              </Box>
              </Box>
              );
            })}
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setLines((ls) => [...ls, emptyLine()])} sx={{ borderStyle: 'dashed', py: 1 }} fullWidth>
              {t('addLine')}
            </Button>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, py: 1.5, borderRadius: 2, bgcolor: 'success.main', color: 'success.contrastText', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="body2" fontWeight={500}>{t('receiveCount', { count: lineCount })}</Typography>
              <Typography variant="h6" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {t('entryTotal')}: {inr(total)}
              </Typography>
            </Stack>
          </Stack>

          {/* 3. Notes and photo */}
          <Stack spacing={1.5}>
            {sectionTitle(3, t('receiveProofSection'))}
            <TextField id="receive-notes" size="small" label={t('notes')} value={notes} onChange={(e) => setNotes(e.target.value)} multiline rows={2} />
            <FilePicker file={photo} onChange={setPhoto} accept="image/*" startIcon={<PhotoCameraIcon />} label={t('stockPhoto')} />
          </Stack>

          <Alert severity={willAutoPost ? 'success' : 'warning'} sx={{ py: 0.5 }}>
            {willAutoPost ? t('autoPostHint') : t('pendingHint')}
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, py: 2 }}>
        <Button onClick={() => { reset(); onClose(); }}>{t('cancel')}</Button>
        <Button variant="contained" color="success" size="large" startIcon={mutation.isPending ? undefined : <ReceiveIcon />} onClick={submit} disabled={mutation.isPending}>
          {mutation.isPending ? <CircularProgress size={20} /> : t('record')}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
