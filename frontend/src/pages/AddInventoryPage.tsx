import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  AddBox as AddInventoryIcon,
  Check as CheckIcon,
  Delete as DeleteIcon,
  PhotoCamera as PhotoCameraIcon,
} from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CatalogItemKind, StockSourceType } from '@hospital-erp/shared';
import CatalogLineFields from '../components/CatalogLineFields';
import { useMaterialCatalog } from '../components/MaterialAutocomplete';
import ResponsiveDialog from '../components/ResponsiveDialog';
import CreatableSelect from '../components/CreatableSelect';
import FilePicker from '../components/FilePicker';
import api, { extractErrorMessage } from '../config/api';
import { enumLabel, formatIndianNumber } from '../utils/enumOptions';

interface Line {
  materialName: string;
  itemId?: string | null;
  specification?: string | null;
  unit: string;
  quantity: string;
  unitCost: string;
}

/** Where the material came from; "delivery" is the usual one. Opening stock is left to Receive Stock. */
const SOURCES = [
  StockSourceType.MATERIAL_DELIVERY,
  StockSourceType.CASH_PURCHASE,
  StockSourceType.OWNER_FREE_ISSUE,
  StockSourceType.PROJECT_TRANSFER,
  StockSourceType.SITE_RETURN,
];

const emptyLine = (): Line => ({ materialName: '', unit: '', quantity: '', unitCost: '' });
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const num = (v: string) => Number(String(v).replace(/,/g, ''));

/**
 * "Add Inventory": anyone types in material that arrived. This screen deliberately shows no
 * stock, quantities in store or values — the person only enters data. What they save is
 * added to stock at once and appears on the Inventory page.
 */
export default function AddInventoryPage() {
  const { t } = useTranslation('inventory');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState<{ entryNumber: string; photoFailed: boolean }[]>([]);

  const [sourceType, setSourceType] = useState<string>(StockSourceType.MATERIAL_DELIVERY);
  const [entryDate, setEntryDate] = useState(todayStr());
  const [supplierName, setSupplierName] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState('');
  const catalog = useMaterialCatalog(open, CatalogItemKind.MATERIAL);

  const reset = () => {
    setSourceType(StockSourceType.MATERIAL_DELIVERY);
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
      const res = await api.post('/inventory-intake', {
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
          // Left blank = the server values it at the item's current rate.
          unitCost: l.unitCost.trim() ? num(l.unitCost) : undefined,
        })),
      });
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
      return { entry: res.data as { entryNumber: string }, photoFailed };
    },
    onSuccess: ({ entry, photoFailed }) => {
      setSaved((s) => [{ entryNumber: entry.entryNumber, photoFailed }, ...s]);
      // For people who also see the Inventory page.
      queryClient.invalidateQueries({ queryKey: ['/inventory/items'] });
      queryClient.invalidateQueries({ queryKey: ['/inventory/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/inventory/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/stock-entries'] });
      reset();
      setOpen(false);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const submit = () => {
    const valid = lines.every(
      (l) => l.materialName.trim() && l.unit.trim() && num(l.quantity) > 0 && (!l.unitCost.trim() || num(l.unitCost) >= 0),
    );
    if (!valid) {
      setError(t('errLines'));
      return;
    }
    setError('');
    mutation.mutate();
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          {t('intakeTitle')}
        </Typography>
        <Button variant="contained" color="success" startIcon={<AddInventoryIcon />} onClick={() => setOpen(true)}>
          {t('intakeTitle')}
        </Button>
      </Box>

      <Card sx={{ p: 2 }}>
        <Typography color="text.secondary">{t('intakeIntro')}</Typography>
        {saved.length > 0 && (
          <Stack spacing={1} sx={{ mt: 2 }}>
            {saved.map((s) => (
              <Alert key={s.entryNumber} severity="success">
                {t('entryPosted', { n: s.entryNumber })}
                {s.photoFailed ? ` ${t('photoFail')}` : ''}
              </Alert>
            ))}
          </Stack>
        )}
      </Card>

      <ResponsiveDialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('intakeTitle')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {SOURCES.map((v) => (
                <Chip
                  key={v}
                  label={enumLabel(v)}
                  clickable
                  onClick={() => setSourceType(v)}
                  color={sourceType === v ? 'primary' : 'default'}
                  variant={sourceType === v ? 'filled' : 'outlined'}
                  icon={sourceType === v ? <CheckIcon /> : undefined}
                />
              ))}
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2 }}>
              <TextField id="intake-date" size="small" type="date" label={t('entryDate')} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              <TextField id="intake-supplier" size="small" label={t('supplier')} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
              <TextField id="intake-ref" size="small" label={t('referenceNo')} value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
            </Box>

            {lines.map((line, i) => (
              <Box key={i} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary">
                    {t('intakeLine', { n: i + 1 })}
                  </Typography>
                  <IconButton size="small" color="error" aria-label={t('removeLine')} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: '2.2fr 1fr 1fr 1fr' }, gap: 1.5, alignItems: 'start' }}>
                  <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' }, minWidth: 0 }}>
                    <CatalogLineFields catalog={catalog} line={line} minWidth={0} label={t('item')} onChange={(patch) => setLine(i, { ...patch, unit: patch.unit ?? line.unit })} />
                  </Box>
                  <CreatableSelect label={t('unit')} value={line.unit} onChange={(v) => setLine(i, { unit: v })} required dropdownType="UNIT" />
                  <TextField
                    id={`intake-qty-${i}`}
                    size="small"
                    label={t('quantity')}
                    required
                    value={formatIndianNumber(line.quantity)}
                    onChange={(e) => setLine(i, { quantity: e.target.value.replace(/,/g, '') })}
                    inputProps={{ inputMode: 'decimal' }}
                  />
                  <TextField
                    id={`intake-rate-${i}`}
                    size="small"
                    label={t('intakeRate')}
                    value={formatIndianNumber(line.unitCost)}
                    onChange={(e) => setLine(i, { unitCost: e.target.value.replace(/,/g, '') })}
                    inputProps={{ inputMode: 'decimal' }}
                    InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
                  />
                </Box>
              </Box>
            ))}
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setLines((ls) => [...ls, emptyLine()])} sx={{ borderStyle: 'dashed' }} fullWidth>
              {t('addLine')}
            </Button>

            <TextField id="intake-notes" size="small" label={t('notes')} value={notes} onChange={(e) => setNotes(e.target.value)} multiline rows={2} />
            <FilePicker file={photo} onChange={setPhoto} accept="image/*" startIcon={<PhotoCameraIcon />} label={t('stockPhoto')} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => { reset(); setOpen(false); }}>{t('cancel')}</Button>
          <Button variant="contained" color="success" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? <CircularProgress size={20} /> : t('intakeSave')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
