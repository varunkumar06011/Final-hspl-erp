import { Box, Grid, MenuItem, TextField, ToggleButton, ToggleButtonGroup, Typography, Alert } from '@mui/material';
import {
  AccountBalance as BankIcon,
  Payments as CashIcon,
  RequestPage as ChequeIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { IFSC_PATTERN, MPRPaymentMethod } from '@hospital-erp/shared';
import api from '../config/api';

export interface PaymentFieldsValue {
  method: MPRPaymentMethod | '';
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  /** A saved account of the vendor picked from the list (undefined = a typed account). */
  bankAccountId?: string;
}

export const EMPTY_PAYMENT: PaymentFieldsValue = { method: '', accountHolderName: '', accountNumber: '', ifscCode: '', bankName: '' };

/** One of a vendor's saved bank accounts (GET /vendors/:id/bank-accounts). */
export interface SavedBankAccount {
  id: string;
  bankName: string | null;
  accountHolderName: string | null;
  accountNumber: string;
  ifscCode: string;
  isPrimary: boolean;
}

/** Payment fields of a request that has a stored payee account (its own account, else the vendor's). */
export function paymentFromSaved(
  method: string | null | undefined,
  row: { paymentBankAccount?: { id: string; bankName: string | null; accountHolderName: string | null; accountNumber: string; ifscCode: string } | null; vendor?: Parameters<typeof paymentFromVendor>[1] },
): PaymentFieldsValue {
  const a = row.paymentBankAccount;
  if (!a) return paymentFromVendor(method, row.vendor);
  return {
    method: (method as MPRPaymentMethod) || '',
    accountHolderName: a.accountHolderName ?? '',
    accountNumber: a.accountNumber,
    ifscCode: a.ifscCode,
    bankName: a.bankName ?? '',
    bankAccountId: a.id,
  };
}

/** Payment fields prefilled from a vendor's bank details on file. */
export function paymentFromVendor(
  method: string | null | undefined,
  vendor?: { accountHolderName?: string | null; bankAccountNumber?: string | null; ifscCode?: string | null; bankName?: string | null } | null,
): PaymentFieldsValue {
  return {
    method: (method as MPRPaymentMethod) || '',
    accountHolderName: vendor?.accountHolderName ?? '',
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
  const bank = v.method === MPRPaymentMethod.BANK_TRANSFER;
  return {
    paymentMethod: v.method || undefined,
    // A saved account chosen from the list; the details below describe the same account.
    vendorBankAccountId: bank && v.bankAccountId ? v.bankAccountId : undefined,
    accountDetails: bank
      ? {
          accountHolderName: v.accountHolderName.trim() || undefined,
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
 * Payment type picker (bank transfer / cash / cheque). Bank transfer pays to one of the vendor's
 * saved bank accounts (picked from the list) or to a typed account, which is added to the vendor.
 */
export default function PaymentMethodFields({
  value,
  onChange,
  disabled,
  showError,
  hasVendor,
  vendorId,
}: {
  value: PaymentFieldsValue;
  onChange: (v: PaymentFieldsValue) => void;
  disabled?: boolean;
  /** Mark empty required fields red (after a failed save). */
  showError?: boolean;
  hasVendor: boolean;
  /** The vendor whose saved accounts are offered for a bank transfer. */
  vendorId?: string | null;
}) {
  const { t } = useTranslation('mpr');
  const bank = value.method === MPRPaymentMethod.BANK_TRANSFER;
  const errKey = showError ? paymentErrorKey(value, hasVendor) : null;
  const acctBad = showError && bank && !/^[0-9]{6,20}$/.test(value.accountNumber.trim());
  const ifscBad = showError && bank && !IFSC_PATTERN.test(value.ifscCode.trim().toUpperCase());

  const { data: accountsData } = useQuery({
    queryKey: ['/vendors', vendorId, 'bank-accounts'],
    enabled: bank && !!vendorId,
    queryFn: async () => (await api.get<SavedBankAccount[]>(`/vendors/${vendorId}/bank-accounts`)).data,
  });
  const accounts = bank && vendorId ? (accountsData ?? []) : [];
  // The saved account being paid: the one picked, else the one whose number and IFSC are typed.
  const matched = accounts.find((a) => a.accountNumber === value.accountNumber && a.ifscCode === value.ifscCode);
  const selectedId = value.bankAccountId ?? matched?.id ?? '';

  // Editing a field turns the payee into a typed account (the backend reuses it if it already exists).
  const setField = (patch: Partial<PaymentFieldsValue>) => onChange({ ...value, ...patch, bankAccountId: undefined });
  const pickAccount = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    if (!a) {
      onChange({ ...value, bankAccountId: undefined, accountHolderName: '', accountNumber: '', ifscCode: '', bankName: '' });
      return;
    }
    onChange({
      ...value,
      bankAccountId: a.id,
      accountHolderName: a.accountHolderName ?? '',
      accountNumber: a.accountNumber,
      ifscCode: a.ifscCode,
      bankName: a.bankName ?? '',
    });
  };

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
          {accounts.length > 0 && (
            <TextField
              select fullWidth size="small" disabled={disabled}
              label={t('savedBankAccount')}
              value={selectedId}
              onChange={(e) => pickAccount(e.target.value)}
              sx={{ mb: 2 }}
            >
              <MenuItem value="">{t('newBankAccount')}</MenuItem>
              {accounts.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {`${a.bankName ? `${a.bankName} · ` : ''}${a.accountHolderName ? `${a.accountHolderName} · ` : ''}${'•••• ' + a.accountNumber.slice(-4)} · ${a.ifscCode}${a.isPrimary ? ` (${t('primaryAccountTag')})` : ''}`}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                fullWidth size="small" disabled={disabled}
                label={t('accountHolderName')}
                value={value.accountHolderName}
                onChange={(e) => setField({ accountHolderName: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={5}>
              <TextField
                fullWidth size="small" required disabled={disabled}
                label={t('accountNumber')}
                value={value.accountNumber}
                onChange={(e) => setField({ accountNumber: e.target.value.replace(/\D/g, '').slice(0, 20) })}
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
                onChange={(e) => setField({ ifscCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11) })}
                error={ifscBad}
                helperText={ifscBad ? t('errIfsc') : undefined}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth size="small" disabled={disabled}
                label={t('bankName')}
                value={value.bankName}
                onChange={(e) => setField({ bankName: e.target.value })}
              />
            </Grid>
          </Grid>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{t('bankDetailsNote')}</Typography>
        </Box>
      )}
    </Box>
  );
}
