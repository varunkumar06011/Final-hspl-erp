import { useMemo } from 'react';
import { Autocomplete, TextField, createFilterOptions } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CatalogItemKind, catalogNameKey, fuzzyFilter } from '@hospital-erp/shared';
import api from '../config/api';

export interface CatalogSpec {
  id: string;
  value: string;
  isPredefined: boolean;
}

/** One item of the shared item catalog (every project uses the same list). */
export interface CatalogMaterial {
  itemId: string;
  materialName: string;
  materialCode: string | null;
  unit: string | null;
  kind: CatalogItemKind;
  aliases: string[];
  specs: CatalogSpec[];
  uses: number;
}

interface CatalogItemRow {
  id: string;
  code: string;
  kind: CatalogItemKind;
  name: string;
  unit: string | null;
  aliases: string[];
  specs: CatalogSpec[];
  uses: number;
}

export const normalizeMaterialName = (name: string) => catalogNameKey(name);

export const CATALOG_QUERY_KEY = ['/catalog/items'];

/**
 * The item catalog (materials and services, with each item's own spec list), shared by
 * every screen that enters a material so the same material is never created twice.
 * `kind` limits it to materials or services.
 */
export function useMaterialCatalog(enabled = true, kind?: CatalogItemKind): CatalogMaterial[] {
  const { data } = useQuery({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: async () => (await api.get('/catalog/items')).data.data as CatalogItemRow[],
    enabled,
    staleTime: 30_000,
  });
  return useMemo(
    () =>
      (data ?? [])
        .filter((i) => !kind || i.kind === kind)
        .map((i) => ({
          itemId: i.id,
          materialName: i.name,
          materialCode: i.code,
          unit: i.unit,
          kind: i.kind,
          aliases: i.aliases ?? [],
          specs: i.specs ?? [],
          uses: i.uses ?? 0,
        }))
        .sort((a, b) => b.uses - a.uses || a.materialName.localeCompare(b.materialName)),
    [data, kind],
  );
}

/** The catalog item a typed name is (its name or an alias of a merged duplicate), if any. */
export function findCatalogMaterial(catalog: CatalogMaterial[], name: string): CatalogMaterial | null {
  const key = catalogNameKey(name);
  if (!key) return null;
  return catalog.find((m) => catalogNameKey(m.materialName) === key) ?? catalog.find((m) => m.aliases.includes(key)) ?? null;
}

const passthrough = createFilterOptions<CatalogMaterial>({ limit: 30 });

/**
 * Material name field that suggests existing materials as you type (spelling mistakes
 * tolerated). Picking one reuses its code, unit and spec list, so a material is never
 * created twice. A name that is not in the list becomes a new item when the record is saved.
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
  /** Free text typed (not a pick); `exact` is the existing item with that name, if any. */
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
          ? fuzzyFilter(options, state.inputValue, (m) => [m.materialName, m.materialCode, ...m.aliases]).slice(0, 30)
          : passthrough(options, state)
      }
      onInputChange={(_e, text, reason) => {
        if (reason === 'reset') return; // a pick is handled by onChange
        onTyped(text, findCatalogMaterial(catalog, text));
      }}
      onChange={(_e, option) => {
        if (option && typeof option !== 'string') onPicked(option);
      }}
      renderOption={(props, m) => (
        <li {...props} key={m.itemId}>
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
