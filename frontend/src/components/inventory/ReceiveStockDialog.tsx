import { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, PhotoCamera as PhotoCameraIcon } from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { InventoryItemType, StockSourceType, isApproverRole } from '@hospital-erp/shared';
import ResponsiveDialog from '../ResponsiveDialog';
import CreatableSelect from '../CreatableSelect';
import FilePicker from '../FilePicker';
import api, { extractErrorMessage } from '../../config/api';
import { useAuthStore } from '../../stores/authStore';
import { enumLabel, enumToOptions, formatIndianNumber } from '../../utils/enumOptions';

interface Line {
  materialName: string;
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

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('receiveTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info" sx={{ py: 0.5 }}>{t('receiveIntro')}</Alert>
          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField select size="small" label={t('sourceType')} value={sourceType} onChange={(e) => setSourceType(e.target.value)} required>
              {enumToOptions(StockSourceType).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </TextField>
            <TextField size="small" type="date" label={t('entryDate')} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" label={t('supplier')} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
            <TextField size="small" label={t('referenceNo')} value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
          </Box>

          <Stack spacing={1.5}>
            {lines.map((line, i) => (
              <Box
                key={i}
                sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: '2.2fr 1fr 1fr 1fr 1.2fr auto' }, gap: 1, alignItems: 'start', p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
              >
                <Autocomplete
                  freeSolo
                  size="small"
                  options={itemOptions}
                  getOptionLabel={(o) => (typeof o === 'string' ? o : o.name)}
                  inputValue={line.materialName}
                  onInputChange={(_e, v, reason) => {
                    if (reason === 'input' || reason === 'clear') setLine(i, { materialName: v });
                  }}
                  onChange={(_e, v) => {
                    if (v && typeof v !== 'string') setLine(i, { materialName: v.name, unit: v.unit, itemType: v.itemType });
                  }}
                  sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }}
                  renderInput={(params) => <TextField {...params} label={t('materialName')} required />}
                />
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
                  size="small"
                  label={t('rateUnit')}
                  value={formatIndianNumber(line.unitCost)}
                  onChange={(e) => setLine(i, { unitCost: e.target.value.replace(/,/g, '') })}
                  inputProps={{ inputMode: 'decimal' }}
                />
                <TextField select size="small" label={t('type')} value={line.itemType} onChange={(e) => setLine(i, { itemType: e.target.value })}>
                  <MenuItem value={InventoryItemType.CONSUMABLE}>{enumLabel(InventoryItemType.CONSUMABLE)}</MenuItem>
                  <MenuItem value={InventoryItemType.ASSET}>{enumLabel(InventoryItemType.ASSET)}</MenuItem>
                </TextField>
                <IconButton
                  size="small"
                  color="error"
                  aria-label={t('removeLine')}
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            <Box>
              <Button size="small" startIcon={<AddIcon />} onClick={() => setLines((ls) => [...ls, emptyLine()])}>{t('addLine')}</Button>
            </Box>
          </Stack>

          <Typography variant="subtitle2" sx={{ textAlign: 'right' }}>
            {t('entryTotal')}: {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(total)}
          </Typography>

          <TextField size="small" label={t('notes')} value={notes} onChange={(e) => setNotes(e.target.value)} multiline rows={2} />
          <FilePicker file={photo} onChange={setPhoto} accept="image/*" startIcon={<PhotoCameraIcon />} label={t('stockPhoto')} />
          <Alert severity={willAutoPost ? 'success' : 'warning'} sx={{ py: 0.5 }}>
            {willAutoPost ? t('autoPostHint') : t('pendingHint')}
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={() => { reset(); onClose(); }}>{t('cancel')}</Button>
        <Button variant="contained" onClick={submit} disabled={mutation.isPending}>
          {mutation.isPending ? <CircularProgress size={20} /> : t('record')}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
