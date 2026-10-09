import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Step,
  StepLabel,
  Stepper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { GST_RATES, Permission, VendorCategory, VendorType, hasPermission } from '@hospital-erp/shared';
import api, { extractErrorMessage } from '../../config/api';
import { useAuthStore } from '../../stores/authStore';
import ResponsiveDialog from '../ResponsiveDialog';
import VendorAutocomplete, { type VendorOption } from '../VendorAutocomplete';
import MaterialAutocomplete, { useMaterialCatalog } from '../MaterialAutocomplete';
import { QTY_UNIT_OPTIONS, SERVICE_UNIT_OPTIONS, enumLabel, formatCurrency, unitLabel } from '../../utils/enumOptions';

interface ItemDraft {
  materialName: string;
  materialCode?: string | null;
  quantity: string;
  unit: string;
  estimatedRate: string;
}
const emptyItem = (unit = 'nos'): ItemDraft => ({ materialName: '', quantity: '1', unit, estimatedRate: '' });

const emptyVendor = {
  name: '',
  vendorType: VendorType.VENDOR as string,
  category: 'MATERIAL_SUPPLIER',
  phone: '',
  contactPersonName: '',
  gstNumber: '',
  panNumber: '',
  address: '',
  bankName: '',
  bankAccountNumber: '',
  ifscCode: '',
  email: '',
};

/**
 * New material request in three steps: vendor (pick one, or create it with all its
 * details), materials, then save as draft or submit for approval. Once approved, the
 * request gets its first quotation automatically.
 */
export default function NewRequestDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (mprId: string) => void }) {
  const { t } = useTranslation('combined');
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const catalog = useMaterialCatalog(open);
  const canCreateVendor = !!user && hasPermission(user.role, Permission.CREATE_VENDOR, user.extraPermissions);

  const [step, setStep] = useState(0);
  const [vendorMode, setVendorMode] = useState<'existing' | 'new'>('existing');
  const [vendorId, setVendorId] = useState('');
  const [vendorPicked, setVendorPicked] = useState<VendorOption | null>(null);
  const [vendor, setVendor] = useState({ ...emptyVendor });
  const [requestType, setRequestType] = useState<'MATERIAL' | 'SERVICE'>('MATERIAL');
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [requiredBy, setRequiredBy] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [gstRate, setGstRate] = useState(0);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const unitOptions = requestType === 'SERVICE' ? SERVICE_UNIT_OPTIONS : QTY_UNIT_OPTIONS;
  const validItems = items.filter((i) => i.materialName.trim() && Number(i.quantity) > 0);
  const estimate = validItems.reduce((s, i) => s + Number(i.quantity) * (Number(i.estimatedRate) || 0), 0);
  const vendorName = vendorMode === 'existing' ? vendorPicked?.name ?? '' : vendor.name.trim();
  const vendorReady = vendorMode === 'existing' ? !!vendorId : !!vendor.name.trim();

  const reset = () => {
    setStep(0);
    setVendorMode('existing');
    setVendorId('');
    setVendorPicked(null);
    setVendor({ ...emptyVendor });
    setRequestType('MATERIAL');
    setItems([emptyItem()]);
    setRequiredBy('');
    setPriority('Normal');
    setGstRate(0);
    setDescription('');
    setError('');
  };
  const close = () => { reset(); onClose(); };

  const create = useMutation({
    mutationFn: async (submit: boolean) => {
      // A new vendor is saved with all its details first (Vendors module), else inline with name/phone/type.
      let useVendorId = vendorMode === 'existing' ? vendorId : '';
      let newVendor: { name: string; phone?: string; vendorType: string } | undefined;
      if (vendorMode === 'new') {
        if (canCreateVendor) {
          const strip = Object.fromEntries(Object.entries(vendor).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]).filter(([, v]) => v !== ''));
          const created = (await api.post('/vendors', strip)).data;
          useVendorId = created.id;
          setVendorMode('existing');
          setVendorId(created.id);
          setVendorPicked({ id: created.id, name: created.name, vendorCode: created.vendorCode, vendorType: created.vendorType });
          queryClient.invalidateQueries({ queryKey: ['/vendors'] });
        } else {
          newVendor = { name: vendor.name.trim(), phone: vendor.phone.trim() || undefined, vendorType: vendor.vendorType };
        }
      }
      const mpr = (await api.post('/material-purchase-requests', {
        requestType,
        items: validItems.map((i) => ({
          materialName: i.materialName.trim(),
          materialCode: i.materialCode || undefined,
          quantity: Number(i.quantity),
          unit: i.unit || undefined,
          estimatedRate: Number(i.estimatedRate) || 0,
        })),
        estimatedGstRate: gstRate,
        requiredBy: requiredBy || undefined,
        priority,
        description: description.trim() || undefined,
        ...(useVendorId ? { vendorId: useVendorId } : { newVendor }),
      })).data;
      if (submit) await api.post(`/material-purchase-requests/${mpr.id}/submit`);
      return mpr.id as string;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ['/combined-records'] });
      queryClient.invalidateQueries({ queryKey: ['mprs'] });
      reset();
      onCreated(id);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const setItem = (idx: number, patch: Partial<ItemDraft>) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const setV = (key: keyof typeof emptyVendor, value: string) => setVendor((prev) => ({ ...prev, [key]: value }));
  const steps = [t('wizVendor'), t('wizMaterials'), t('wizReview')];

  return (
    <ResponsiveDialog open={open} onClose={close} maxWidth="md" fullWidth>
      <DialogTitle>{t('newRequest')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
        <Stepper activeStep={step} alternativeLabel>
          {steps.map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
        </Stepper>
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

        {step === 0 && (
          <>
            <ToggleButtonGroup exclusive size="small" value={vendorMode} onChange={(_e, v) => v && setVendorMode(v)}>
              <ToggleButton value="existing">{t('existingVendor')}</ToggleButton>
              <ToggleButton value="new">{t('newVendor')}</ToggleButton>
            </ToggleButtonGroup>
            {vendorMode === 'existing' ? (
              <VendorAutocomplete label={t('vendor')} value={vendorId} onChange={(id, v) => { setVendorId(id); setVendorPicked(v); }} required />
            ) : (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                <TextField size="small" label={t('vendorName')} value={vendor.name} onChange={(e) => setV('name', e.target.value)} required />
                <TextField select size="small" label={t('vendorType')} value={vendor.vendorType} onChange={(e) => setV('vendorType', e.target.value)}>
                  <MenuItem value={VendorType.VENDOR}>{t('vendorTypeVendor')}</MenuItem>
                  <MenuItem value={VendorType.NON_VENDOR}>{t('vendorTypeNonVendor')}</MenuItem>
                </TextField>
                <TextField size="small" label={t('phone')} value={vendor.phone} onChange={(e) => setV('phone', e.target.value)} />
                {canCreateVendor && (
                  <>
                    <TextField select size="small" label={t('category')} value={vendor.category} onChange={(e) => setV('category', e.target.value)}>
                      {Object.values(VendorCategory).map((c) => <MenuItem key={c} value={c}>{enumLabel(c)}</MenuItem>)}
                    </TextField>
                    <TextField size="small" label={t('contactPerson')} value={vendor.contactPersonName} onChange={(e) => setV('contactPersonName', e.target.value)} />
                    <TextField size="small" label={t('email')} value={vendor.email} onChange={(e) => setV('email', e.target.value)} />
                    <TextField size="small" label={t('gstNumber')} value={vendor.gstNumber} onChange={(e) => setV('gstNumber', e.target.value)} />
                    <TextField size="small" label={t('panNumber')} value={vendor.panNumber} onChange={(e) => setV('panNumber', e.target.value)} />
                    <TextField size="small" label={t('address')} value={vendor.address} onChange={(e) => setV('address', e.target.value)} sx={{ gridColumn: { sm: '1 / -1' } }} multiline />
                    <TextField size="small" label={t('bankName')} value={vendor.bankName} onChange={(e) => setV('bankName', e.target.value)} />
                    <TextField size="small" label={t('accountNumber')} value={vendor.bankAccountNumber} onChange={(e) => setV('bankAccountNumber', e.target.value)} />
                    <TextField size="small" label={t('ifsc')} value={vendor.ifscCode} onChange={(e) => setV('ifscCode', e.target.value)} />
                  </>
                )}
                {!canCreateVendor && <Alert severity="info" sx={{ gridColumn: '1 / -1' }}>{t('vendorDetailsLater')}</Alert>}
              </Box>
            )}
            <Alert severity="info">{vendorMode === 'new' && vendor.vendorType === VendorType.NON_VENDOR ? t('nonVendorFlow') : t('vendorFlow')}</Alert>
          </>
        )}

        {step === 1 && (
          <>
            <ToggleButtonGroup exclusive size="small" value={requestType} onChange={(_e, v) => v && setRequestType(v)}>
              <ToggleButton value="MATERIAL">{t('typeMaterial')}</ToggleButton>
              <ToggleButton value="SERVICE">{t('typeService')}</ToggleButton>
            </ToggleButtonGroup>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {items.map((item, idx) => (
                <Box key={idx} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '2fr 90px 130px 130px 40px' }, gap: 1, alignItems: 'center' }}>
                  <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
                    <MaterialAutocomplete
                      value={item.materialName}
                      label={requestType === 'SERVICE' ? t('service') : t('material')}
                      catalog={catalog}
                      onTyped={(name, exact) => setItem(idx, { materialName: name, materialCode: exact?.materialCode ?? null })}
                      onPicked={(m) => setItem(idx, { materialName: m.materialName, materialCode: m.materialCode, unit: m.unit ?? item.unit })}
                      sx={{ minWidth: 0 }}
                    />
                  </Box>
                  <TextField size="small" type="number" label={t('qty')} value={item.quantity} onChange={(e) => setItem(idx, { quantity: e.target.value })} inputProps={{ min: 0, step: 'any' }} />
                  <TextField select size="small" label={t('unit')} value={item.unit} onChange={(e) => setItem(idx, { unit: e.target.value })}>
                    {unitOptions.map((o) => <MenuItem key={o.value} value={o.value}>{unitLabel(o.value)}</MenuItem>)}
                  </TextField>
                  <TextField size="small" type="number" label={t('estRate')} value={item.estimatedRate} onChange={(e) => setItem(idx, { estimatedRate: e.target.value })} inputProps={{ min: 0, step: 'any' }} />
                  <IconButton size="small" disabled={items.length === 1} onClick={() => setItems((prev) => prev.filter((_x, i) => i !== idx))} aria-label={t('removeItem')}><DeleteIcon fontSize="small" /></IconButton>
                </Box>
              ))}
              <Button size="small" startIcon={<AddIcon />} onClick={() => setItems((prev) => [...prev, emptyItem(unitOptions[0]?.value)])} sx={{ alignSelf: 'flex-start' }}>{t('addItem')}</Button>
            </Box>
            <Typography variant="caption" color="text.secondary">{t('estRateHint')}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 1.5 }}>
              <TextField type="date" size="small" label={t('requiredBy')} value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} InputLabelProps={{ shrink: true }} />
              <TextField select size="small" label={t('priority')} value={priority} onChange={(e) => setPriority(e.target.value)}>
                {['Normal', 'Urgent', 'Critical'].map((p) => <MenuItem key={p} value={p}>{t(`priorityOpt.${p}`)}</MenuItem>)}
              </TextField>
              <TextField select size="small" label={t('gst')} value={gstRate} onChange={(e) => setGstRate(Number(e.target.value))}>
                {GST_RATES.map((g) => <MenuItem key={g} value={g}>{g}%</MenuItem>)}
              </TextField>
            </Box>
            <TextField size="small" label={t('descriptionOptional')} value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} />
          </>
        )}

        {step === 2 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography><b>{t('vendor')}:</b> {vendorName || '—'}</Typography>
            <Typography><b>{t('requestType')}:</b> {requestType === 'SERVICE' ? t('typeService') : t('typeMaterial')}</Typography>
            {validItems.map((i, idx) => (
              <Typography key={idx} variant="body2">• {i.materialName} — {i.quantity} {unitLabel(i.unit)}{Number(i.estimatedRate) > 0 ? ` × ${formatCurrency(Number(i.estimatedRate))}` : ''}</Typography>
            ))}
            {estimate > 0 && <Typography fontWeight={700}>{t('estimate')}: {formatCurrency(estimate * (1 + gstRate / 100))}</Typography>}
            <Alert severity="info">{t('reviewHint')}</Alert>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={step === 0 ? close : () => setStep(step - 1)} disabled={create.isPending}>{step === 0 ? t('cancel') : t('back')}</Button>
        {step < 2 ? (
          <Button variant="contained" disabled={step === 0 ? !vendorReady : validItems.length === 0} onClick={() => setStep(step + 1)}>{t('nextStep')}</Button>
        ) : (
          <>
            <Button disabled={create.isPending} onClick={() => create.mutate(false)}>{t('saveDraft')}</Button>
            <Button variant="contained" disabled={create.isPending} onClick={() => create.mutate(true)}>
              {create.isPending ? <CircularProgress size={20} /> : t('submitForApproval')}
            </Button>
          </>
        )}
      </DialogActions>
    </ResponsiveDialog>
  );
}
