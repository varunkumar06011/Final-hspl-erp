import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { GST_RATES } from '@hospital-erp/shared';
import api, { extractErrorMessage } from '../../config/api';
import ResponsiveDialog from '../ResponsiveDialog';
import VendorAutocomplete from '../VendorAutocomplete';
import FilePicker from '../FilePicker';
import { formatCurrency } from '../../utils/enumOptions';

export interface RequestLine {
  materialName: string;
  quantity: number | string;
  unit: string | null;
  estimatedRate: number | string;
}

interface Line {
  include: boolean;
  materialName: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  gstRate: number;
}

/** Edit rates of a waiting quotation, or add a new one (any vendor) for a material request. */
export default function AddQuotationDialog({
  open,
  mprId,
  mprNumber,
  lines,
  preferMaterials,
  gstRate,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  mprId: string | null;
  mprNumber?: string | null;
  /** Request lines to quote for. */
  lines: RequestLine[];
  /** Materials not finalized yet; only these are ticked by default. */
  preferMaterials?: string[];
  gstRate?: number;
  /** When set, the dialog edits this waiting quotation's rates instead of creating one. */
  editing?: { id: string; quotationNumber: string; vendorId: string; items: { materialName: string; quantity: number | string; unit: string | null; unitPrice: number | string; gstRate: number | string }[] } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation('combined');
  const [vendorId, setVendorId] = useState('');
  const [rows, setRows] = useState<Line[]>([]);
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setNotes('');
    setFile(null);
    if (editing) {
      setVendorId(editing.vendorId);
      setRows(editing.items.map((i) => ({
        include: true,
        materialName: i.materialName,
        quantity: String(i.quantity),
        unit: i.unit ?? 'nos',
        unitPrice: Number(i.unitPrice) > 0 ? String(i.unitPrice) : '',
        gstRate: Number(i.gstRate) || 0,
      })));
      return;
    }
    setVendorId('');
    const prefer = new Set((preferMaterials ?? []).map((m) => m.trim().toLowerCase()));
    setRows(lines.map((l) => ({
      include: prefer.size === 0 || prefer.has(l.materialName.trim().toLowerCase()),
      materialName: l.materialName,
      quantity: String(l.quantity),
      unit: l.unit ?? 'nos',
      unitPrice: '',
      gstRate: gstRate ?? 0,
    })));
    // Fill the form only when the dialog opens; later prop changes must not wipe what was typed.
  }, [open]);

  const chosen = rows.filter((r) => r.include && r.materialName.trim() && Number(r.quantity) > 0);
  const subtotal = chosen.reduce((s, r) => s + Number(r.quantity) * (Number(r.unitPrice) || 0), 0);
  const gst = chosen.reduce((s, r) => s + (Number(r.quantity) * (Number(r.unitPrice) || 0) * r.gstRate) / 100, 0);

  const save = useMutation({
    mutationFn: async () => {
      const items = chosen.map((r) => ({
        materialName: r.materialName.trim(),
        quantity: Number(r.quantity),
        unit: r.unit || undefined,
        unitPrice: Number(r.unitPrice) || 0,
        gstRate: r.gstRate,
      }));
      if (editing) {
        await api.patch(`/quotations/${editing.id}`, { items, ...(notes.trim() ? { notes: notes.trim() } : {}) });
        return;
      }
      const form = new FormData();
      form.append('vendorId', vendorId);
      if (mprId) form.append('mprId', mprId);
      form.append('items', JSON.stringify(items));
      form.append('acknowledged', 'true');
      if (notes.trim()) form.append('notes', notes.trim());
      if (file) form.append('file', file);
      await api.post('/quotations', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: onSaved,
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const setRow = (idx: number, patch: Partial<Line>) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const canSave = !!vendorId && chosen.length > 0 && !save.isPending;

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {editing ? t('editRatesTitle', { n: editing.quotationNumber }) : t('addQuotationTitle', { n: mprNumber ?? '' })}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
        {!editing && <Alert severity="info">{t('addQuotationHint')}</Alert>}
        <VendorAutocomplete label={t('vendor')} value={vendorId} onChange={(id) => setVendorId(id)} required disabled={!!editing} />

        <Box>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{t('ratesForMaterials')}</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {rows.map((r, idx) => (
              <Box key={idx} sx={{ display: 'grid', gridTemplateColumns: { xs: '40px 1fr 1fr', sm: '40px 2fr 90px 120px 100px 120px' }, gap: 1, alignItems: 'center', opacity: r.include ? 1 : 0.55 }}>
                <Checkbox checked={r.include} onChange={(e) => setRow(idx, { include: e.target.checked })} sx={{ p: 0.5 }} />
                <Typography variant="body2" fontWeight={600} sx={{ gridColumn: { xs: '2 / -1', sm: 'auto' } }}>{r.materialName}</Typography>
                <TextField size="small" type="number" label={t('qty')} value={r.quantity} onChange={(e) => setRow(idx, { quantity: e.target.value })} disabled={!r.include} inputProps={{ min: 0, step: 'any' }} />
                <TextField size="small" type="number" label={t('rate')} value={r.unitPrice} onChange={(e) => setRow(idx, { unitPrice: e.target.value })} disabled={!r.include} inputProps={{ min: 0, step: 'any' }} />
                <TextField select size="small" label={t('gst')} value={r.gstRate} onChange={(e) => setRow(idx, { gstRate: Number(e.target.value) })} disabled={!r.include}>
                  {GST_RATES.map((g) => <MenuItem key={g} value={g}>{g}%</MenuItem>)}
                </TextField>
                <Typography variant="body2" sx={{ textAlign: 'right' }}>{formatCurrency(Number(r.quantity) * (Number(r.unitPrice) || 0) * (1 + r.gstRate / 100))}</Typography>
              </Box>
            ))}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 3, flexWrap: 'wrap' }}>
          <Typography variant="body2">{t('subtotal')}: {formatCurrency(subtotal)}</Typography>
          <Typography variant="body2">{t('gst')}: {formatCurrency(gst)}</Typography>
          <Typography fontWeight={700}>{t('total')}: {formatCurrency(subtotal + gst)}</Typography>
        </Box>
        {subtotal <= 0 && chosen.length > 0 && <Alert severity="warning">{t('ratesNeededToFinalize')}</Alert>}

        <TextField size="small" label={t('notesOptional')} value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} />
        {!editing && <FilePicker file={file} onChange={setFile} label={t('attachQuotation')} accept="image/*,application/pdf" />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="contained" disabled={!canSave} onClick={() => save.mutate()}>
          {save.isPending ? <CircularProgress size={20} /> : editing ? t('saveRates') : t('saveQuotation')}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
