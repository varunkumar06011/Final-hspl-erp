import { useMemo } from 'react';
import { Autocomplete, TextField, createFilterOptions } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fuzzyFilter } from '@hospital-erp/shared';
import api from '../config/api';

export interface CatalogMaterial {
  materialName: string;
  materialCode: string | null;
  unit: string | null;
  uses: number;
}

export const normalizeMaterialName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/** Every material the project has already used (requests + inventory), for duplicate-free entry. */
export function useMaterialCatalog(enabled = true): CatalogMaterial[] {
  const { data } = useQuery({
    queryKey: ['/material-purchase-requests/material-catalog'],
    queryFn: async () => (await api.get('/material-purchase-requests/material-catalog')).data.data as CatalogMaterial[],
    enabled,
    staleTime: 30_000,
  });
  return useMemo(() => data ?? [], [data]);
}

const passthrough = createFilterOptions<CatalogMaterial>({ limit: 30 });

/**
 * Material name field that suggests existing materials as you type (spelling mistakes
 * tolerated). Picking one reuses its code and unit, so a material is never created twice.
 */
export default function MaterialAutocomplete({
  value,
  catalog,
  onTyped,
  onPicked,
  sx,
  label,
}: {
  value: string;
  catalog: CatalogMaterial[];
  /** Free text typed (not a pick). */
  onTyped: (name: string, exact: CatalogMaterial | null) => void;
  /** An existing material was chosen from the list. */
  onPicked: (material: CatalogMaterial) => void;
  sx?: object;
  /** Optional field label (tables usually have a column header instead). */
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <Autocomplete<CatalogMaterial, false, false, true>
      freeSolo
      options={catalog}
      inputValue={value}
      autoHighlight
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.materialName)}
      filterOptions={(options, state) =>
        state.inputValue.trim()
          ? fuzzyFilter(options, state.inputValue, (m) => [m.materialName, m.materialCode]).slice(0, 30)
          : passthrough(options, state)
      }
      onInputChange={(_e, text, reason) => {
        if (reason === 'reset') return; // a pick is handled by onChange
        const exact = catalog.find((m) => normalizeMaterialName(m.materialName) === normalizeMaterialName(text)) ?? null;
        onTyped(text, exact);
      }}
      onChange={(_e, option) => {
        if (option && typeof option !== 'string') onPicked(option);
      }}
      renderOption={(props, m) => (
        <li {...props} key={`${m.materialName}|${m.materialCode ?? ''}`}>
          {m.materialName}
          {m.materialCode ? ` · ${m.materialCode}` : ''}
          {m.unit ? ` · ${m.unit}` : ''}
        </li>
      )}
      noOptionsText={t('newMaterialHint')}
      renderInput={(params) => <TextField {...params} size="small" label={label} />}
      sx={{ minWidth: 190, ...sx }}
    />
  );
}
