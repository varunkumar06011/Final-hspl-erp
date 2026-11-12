import { Box, Grid, TextField, ToggleButton, ToggleButtonGroup, Typography, Alert } from '@mui/material';
import {
  AccountBalance as BankIcon,
  Payments as CashIcon,
  RequestPage as ChequeIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { IFSC_PATTERN, MPRPaymentMethod } from '@hospital-erp/shared';

export interface PaymentFieldsValue {
  method: MPRPaymentMethod | '';
  accountNumber: string;
  ifscCode: string;
  bankName: string;
}

export const EMPTY_PAYMENT: PaymentFieldsValue = { method: '', accountNumber: '', ifscCode: '', bankName: '' };

/** Payment fields prefilled from a vendor's bank details on file. */
export function paymentFromVendor(
  method: string | null | undefined,
  vendor?: { bankAccountNumber?: string | null; ifscCode?: string | null; bankName?: string | null } | null,
): PaymentFieldsValue {
  return {
    method: (method as MPRPaymentMethod) || '',
    accountNumber: vendor?.bankAccountNumber ?? '',
    ifscCode: vendor?.ifscCode ?? '',
    bankName: vendor?.bankName ?? '',
  };
}

/** i18n key of the first problem with the payment fields (null when fine). */
export function paymentErrorKey(v: PaymentFieldsValue, hasVendor: boolean): string | null {
  if (!v.method) return 'errPaymentType';
  if (v.method !== MPRPaymentMethod.BANK_TRANSFER) return null;
  if (!hasVendor) return 'errBankVendor';
  if (!/^[0-9]{6,20}$/.test(v.accountNumber.trim())) return 'errAccountNumber';
  if (!IFSC_PATTERN.test(v.ifscCode.trim().toUpperCase())) return 'errIfsc';
  return null;
}

/** Body fields for the API: method, plus bank details for a bank transfer. */
export function paymentPayload(v: PaymentFieldsValue) {
  return {
    paymentMethod: v.method || undefined,
    accountDetails:
      v.method === MPRPaymentMethod.BANK_TRANSFER
        ? {
            accountNumber: v.accountNumber.trim(),
            ifscCode: v.ifscCode.trim().toUpperCase(),
            bankName: v.bankName.trim() || undefined,
          }
        : undefined,
  };
}

export function paymentMethodLabel(t: (k: string) => string, method?: string | null): string {
  switch (method) {
    case MPRPaymentMethod.BANK_TRANSFER: return t('payBank');
    case MPRPaymentMethod.CASH: return t('payCash');
    case MPRPaymentMethod.CHEQUE: return t('payCheque');
    default: return '';
  }
}

/**
 * Payment type picker (bank transfer / cash / cheque). Bank transfer asks for the vendor's
 * account number and IFSC, which are saved on the vendor.
 */
export default function PaymentMethodFields({
  value,
  onChange,
  disabled,
  showError,
  hasVendor,
}: {
  value: PaymentFieldsValue;
  onChange: (v: PaymentFieldsValue) => void;
  disabled?: boolean;
  /** Mark empty required fields red (after a failed save). */
  showError?: boolean;
  hasVendor: boolean;
}) {
  const { t } = useTranslation('mpr');
  const bank = value.method === MPRPaymentMethod.BANK_TRANSFER;
  const errKey = showError ? paymentErrorKey(value, hasVendor) : null;
  const acctBad = showError && bank && !/^[0-9]{6,20}$/.test(value.accountNumber.trim());
  const ifscBad = showError && bank && !IFSC_PATTERN.test(value.ifscCode.trim().toUpperCase());

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {t('paymentTypeLabel')} <Box component="span" sx={{ color: 'error.main' }}>*</Box>
      </Typography>
      <ToggleButtonGroup
        exclusive
        size="small"
        color="primary"
        value={value.method || null}
        disabled={disabled}
        onChange={(_e, m) => { if (m) onChange({ ...value, method: m }); }}
        sx={{ flexWrap: 'wrap', ...(showError && !value.method ? { outline: '1px solid', outlineColor: 'error.main', borderRadius: 1 } : {}) }}
      >
        <ToggleButton value={MPRPaymentMethod.BANK_TRANSFER} sx={{ gap: 0.75, px: 2 }}><BankIcon fontSize="small" />{t('payBank')}</ToggleButton>
        <ToggleButton value={MPRPaymentMethod.CASH} sx={{ gap: 0.75, px: 2 }}><CashIcon fontSize="small" />{t('payCash')}</ToggleButton>
        <ToggleButton value={MPRPaymentMethod.CHEQUE} sx={{ gap: 0.75, px: 2 }}><ChequeIcon fontSize="small" />{t('payCheque')}</ToggleButton>
      </ToggleButtonGroup>
      {errKey && !bank && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>{t(errKey)}</Typography>
      )}

      {bank && (
        <Box sx={{ mt: 1.5 }}>
          {!hasVendor && showError && <Alert severity="error" sx={{ mb: 1 }}>{t('errBankVendor')}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={5}>
              <TextField
                fullWidth size="small" required disabled={disabled}
                label={t('accountNumber')}
                value={value.accountNumber}
                onChange={(e) => onChange({ ...value, accountNumber: e.target.value.replace(/\D/g, '').slice(0, 20) })}
                inputProps={{ inputMode: 'numeric' }}
                error={acctBad}
                helperText={acctBad ? t('errAccountNumber') : undefined}
              />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField
                fullWidth size="small" required disabled={disabled}
                label={t('ifscCode')}
                value={value.ifscCode}
                onChange={(e) => onChange({ ...value, ifscCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11) })}
                error={ifscBad}
                helperText={ifscBad ? t('errIfsc') : undefined}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth size="small" disabled={disabled}
                label={t('bankName')}
                value={value.bankName}
                onChange={(e) => onChange({ ...value, bankName: e.target.value })}
              />
            </Grid>
          </Grid>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{t('bankDetailsNote')}</Typography>
        </Box>
      )}
    </Box>
  );
}
