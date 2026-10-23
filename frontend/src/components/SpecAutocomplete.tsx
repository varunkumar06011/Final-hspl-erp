import { useState } from 'react';
import { Autocomplete, CircularProgress, TextField } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { catalogSpecKey, fuzzyFilter, tidySpec } from '@hospital-erp/shared';
import api from '../config/api';
import { useToast } from './ToastProvider';
import { CATALOG_QUERY_KEY, type CatalogMaterial } from './MaterialAutocomplete';

type Option = { value: string; isNew?: boolean };

/**
 * Specification picker for one material line. It offers only the chosen item's own specs
 * (steel shows steel sizes, iron shows iron sections). A spec that is not in the list can be
 * added right there; for a material that is not in the catalog yet, the typed spec is saved
 * with the new item when the record is saved.
 */
export default function SpecAutocomplete({
  item,
  value,
  onChange,
  sx,
  label,
  disabled,
}: {
  /** The line's catalog item (null while the material is new / not picked). */
  item: CatalogMaterial | null;
  value: string;
  onChange: (spec: string) => void;
  sx?: object;
  label?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation('catalog');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [input, setInput] = useState<string | null>(null);
  const text = input ?? value;

  const addSpec = useMutation({
    mutationFn: async (spec: string) => (await api.post(`/catalog/items/${item!.itemId}/specs`, { value: spec })).data as { value: string },
    onSuccess: (saved) => {
      onChange(saved.value);
      setInput(null);
      queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
      toast.success(t('specAdded', { spec: saved.value, item: item?.materialName }));
    },
    onError: () => toast.error(t('specAddFailed')),
  });

  const specs: Option[] = (item?.specs ?? []).map((s) => ({ value: s.value }));
  const typed = tidySpec(text);
  const known = typed ? specs.find((s) => catalogSpecKey(s.value) === catalogSpecKey(typed)) : undefined;

  return (
    <Autocomplete<Option, false, false, true>
      freeSolo
      disabled={disabled}
      options={specs}
      inputValue={text}
      autoHighlight
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.value)}
      filterOptions={(options) => {
        const matches = typed ? fuzzyFilter(options, typed, (o) => [o.value]).slice(0, 30) : options.slice(0, 50);
        // Offer to add a typed spec the item does not have yet.
        return item && typed && !known ? [...matches, { value: typed, isNew: true }] : matches;
      }}
      onInputChange={(_e, next, reason) => {
        if (reason === 'reset') return;
        setInput(next);
        onChange(next);
      }}
      onChange={(_e, option) => {
        if (!option) return;
        if (typeof option === 'string') {
          onChange(option);
          return;
        }
        if (option.isNew && item) addSpec.mutate(option.value);
        else {
          setInput(null);
          onChange(option.value);
        }
      }}
      onBlur={() => {
        // A typed spelling of a known spec takes the list's spelling.
        if (known && known.value !== value) onChange(known.value);
        setInput(null);
      }}
      renderOption={(props, o) => (
        <li {...props} key={`${o.isNew ? 'new:' : ''}${o.value}`}>
          {o.isNew ? t('addSpecOption', { spec: o.value }) : o.value}
        </li>
      )}
      noOptionsText={item ? t('noSpecsYet') : t('specForNewItem')}
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          label={label}
          placeholder={item && specs.length > 0 ? t('pickSpec') : undefined}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {addSpec.isPending ? <CircularProgress size={14} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      sx={{ minWidth: 150, ...sx }}
    />
  );
}
