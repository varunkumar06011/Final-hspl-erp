import { useMemo } from 'react';
import { Autocomplete, TextField, createFilterOptions, type SxProps, type Theme } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fuzzyFilter } from '@hospital-erp/shared';
import api from '../config/api';

export interface VendorOption {
  id: string;
  name: string;
  vendorCode: string;
  vendorType?: string;
}

/** Vendors for pickers: one cached request shared by every picker on screen. */
export function useVendorPickerOptions(): VendorOption[] {
  const { data } = useQuery({
    queryKey: ['/vendors', 'picker'],
    queryFn: async () => (await api.get('/vendors', { params: { pageSize: 500 } })).data,
    staleTime: 30_000,
  });
  return useMemo(() => (data?.data ?? []) as VendorOption[], [data]);
}

const label = (v: VendorOption) => `${v.vendorCode} - ${v.name}`;

// MUI still needs a filter for "no input yet"; real filtering is fuzzy and runs below.
const passthrough = createFilterOptions<VendorOption>({ limit: 50 });

/**
 * Vendor picker: type to find a vendor as you go. Matching tolerates spelling
 * mistakes and partial words ("laxmi tradrs" still finds "Lakshmi Traders").
 */
export default function VendorAutocomplete({
  value,
  onChange,
  label: fieldLabel,
  required,
  disabled,
  sx,

}: {
  value: string;
  onChange: (vendorId: string, vendor: VendorOption | null) => void;
  label: string;
  required?: boolean;
  disabled?: boolean;
  sx?: SxProps<Theme>;

}) {
  const { t } = useTranslation();
  const vendors = useVendorPickerOptions();
  const selected = vendors.find((v) => v.id === value) ?? null;

  return (
    <Autocomplete<VendorOption>
      options={vendors}
      value={selected}
      disabled={disabled}

      autoHighlight
      openOnFocus
      getOptionLabel={label}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(options, state) =>
        state.inputValue.trim()
          ? fuzzyFilter(options, state.inputValue, (v) => [v.name, v.vendorCode, label(v)]).slice(0, 50)
          : passthrough(options, state)
      }
      onChange={(_e, option) => onChange(option?.id ?? '', option ?? null)}
      noOptionsText={t('noVendorMatch')}
      renderOption={(props, v) => (
        <li {...props} key={v.id}>
          {label(v)}
          {v.vendorType === 'NON_VENDOR' ? ` (${t('nonVendorTag')})` : ''}
        </li>
      )}
      renderInput={(params) => <TextField {...params} label={fieldLabel} required={required && !selected} size="small" />}
      fullWidth
      sx={sx}
    />
  );
}
