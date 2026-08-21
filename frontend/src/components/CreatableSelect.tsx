import { useState, useMemo } from 'react';
import { Autocomplete, TextField, Chip, Box, Typography } from '@mui/material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../config/api';

interface SelectOption {
  value: string;
  label: string;
  secondary?: string;
}

interface CreatableSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  size?: 'small' | 'medium';
  dropdownType?: string;
  staticOptions?: SelectOption[];
  optionsEndpoint?: string;
  optionLabelKey?: string;
  placeholder?: string;
}

export default function CreatableSelect({
  label,
  value,
  onChange,
  required = false,
  size = 'small',
  dropdownType,
  staticOptions = [],
  optionsEndpoint,
  optionLabelKey = 'name',
  placeholder,
}: CreatableSelectProps) {
  const queryClient = useQueryClient();
  const [inputValue, setInputValue] = useState('');

  const { data: dynamicOptions } = useQuery({
    queryKey: ['dropdown-options', dropdownType],
    queryFn: async () => {
      const response = await api.get('/dropdown-options', { params: { type: dropdownType } });
      return response.data?.data ?? [];
    },
    enabled: !!dropdownType,
    staleTime: 30_000,
  });

  const { data: endpointOptions, isLoading } = useQuery({
    queryKey: ['options', optionsEndpoint],
    queryFn: async () => {
      const response = await api.get(optionsEndpoint!, { params: { pageSize: 100 } });
      return response.data?.data ?? [];
    },
    enabled: !!optionsEndpoint,
    staleTime: 30_000,
  });

  const createOptionMutation = useMutation({
    mutationFn: async (newValue: string) => {
      const response = await api.post('/dropdown-options', {
        type: dropdownType,
        value: newValue,
        label: newValue,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dropdown-options', dropdownType] });
    },
  });

  const allOptions = useMemo(() => {
    const opts: SelectOption[] = [];

    if (staticOptions.length > 0) {
      opts.push(...staticOptions);
    }

    if (dynamicOptions) {
      (dynamicOptions as Record<string, unknown>[]).forEach((item) => {
        const val = String(item.value);
        if (!opts.find((o) => o.value === val)) {
          opts.push({ value: val, label: String(item.label ?? item.value) });
        }
      });
    }

    if (endpointOptions) {
      (endpointOptions as Record<string, unknown>[]).forEach((item) => {
        const val = String(item.id);
        const lbl = String(
          item[optionLabelKey] ??
          item.invoiceNumber ??
          item.poNumber ??
          item.quotationNumber ??
          item.passNumber ??
          item.requestNumber ??
          item.id
        );
        if (!opts.find((o) => o.value === val)) {
          opts.push({ value: val, label: lbl });
        }
      });
    }

    return opts;
  }, [staticOptions, dynamicOptions, endpointOptions, optionLabelKey]);

  const selectedOption = allOptions.find((o) => o.value === value) ?? null;

  return (
    <Autocomplete
      size={size}
      value={selectedOption}
      inputValue={inputValue}
      onInputChange={(_, newInputValue) => setInputValue(newInputValue)}
      onChange={(_, newValue) => {
        if (newValue && typeof newValue === 'string') {
          onChange(newValue);
        } else if (newValue && typeof newValue === 'object' && 'value' in newValue) {
          const v = (newValue as { value: string }).value;
          if (v.startsWith('__create__')) {
            const createdValue = v.replace('__create__', '');
            createOptionMutation.mutate(createdValue);
            onChange(createdValue);
            return;
          }
          onChange(v);
        } else if (newValue === null) {
          onChange('');
        }
      }}
      options={allOptions}
      loading={isLoading}
      isOptionEqualToValue={(option, val) => option.value === val.value}
      getOptionLabel={(option) => {
        if (typeof option === 'string') return option;
        return (option as { label: string }).label;
      }}
      filterOptions={(options, params) => {
        const filtered = options.filter((opt) =>
          opt.label.toLowerCase().includes(params.inputValue.toLowerCase())
        );
        if (
          dropdownType &&
          params.inputValue.trim() !== '' &&
          !filtered.find((opt) => opt.label.toLowerCase() === params.inputValue.toLowerCase())
        ) {
          filtered.push({
            value: `__create__${params.inputValue}`,
            label: `Create "${params.inputValue}"`,
          });
        }
        return filtered;
      }}
      renderOption={(props, option) => {
        const isCreateOption = option.label.startsWith('Create "');
        return (
          <li {...props} style={{ fontWeight: isCreateOption ? 600 : 400, display: 'block', padding: '6px 16px' }}>
            {isCreateOption ? (
              <span style={{ color: '#1976d2' }}>{option.label}</span>
            ) : option.secondary ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                <Typography variant="body2" component="span" sx={{ overflowWrap: 'break-word' }}>{option.label}</Typography>
                <Typography variant="caption" component="span" color="text.secondary" sx={{ overflowWrap: 'break-word' }}>{option.secondary}</Typography>
              </Box>
            ) : (
              <span style={{ overflowWrap: 'break-word' }}>{option.label}</span>
            )}
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          placeholder={placeholder}
          helperText={isLoading ? 'Loading...' : undefined}
        />
      )}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => (
          <Chip
            {...getTagProps({ index })}
            key={option.value}
            label={option.label}
            size="small"
          />
        ))
      }
      freeSolo
      selectOnFocus
      clearOnBlur
      handleHomeEndKeys
    />
  );
}
