import { useState, useEffect } from 'react';
import { TextField, MenuItem, Box } from '@mui/material';

interface SelectWithOtherProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  otherLabel?: string;
  otherFieldLabel?: string;
  required?: boolean;
}

const OTHER_VALUE = '__other__';

export default function SelectWithOther({
  label,
  value,
  onChange,
  options,
  otherLabel = 'Other',
  otherFieldLabel,
  required = false,
}: SelectWithOtherProps) {
  const isPredefined = options.some((o) => o.value === value);
  const [selectValue, setSelectValue] = useState(isPredefined ? value : value ? OTHER_VALUE : '');
  const [otherText, setOtherText] = useState(isPredefined ? '' : value);

  useEffect(() => {
    const matched = options.some((o) => o.value === value);
    setSelectValue(matched ? value : value ? OTHER_VALUE : '');
    setOtherText(matched ? '' : value);
  }, [value, options]);

  const handleSelectChange = (newValue: string) => {
    setSelectValue(newValue);
    if (newValue === OTHER_VALUE) {
      onChange(otherText);
    } else {
      setOtherText('');
      onChange(newValue);
    }
  };

  const handleOtherTextChange = (text: string) => {
    setOtherText(text);
    onChange(text);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <TextField
        select
        label={label}
        required={required}
        value={selectValue}
        onChange={(e) => handleSelectChange(e.target.value)}
        fullWidth
        size="small"
      >
        {!required && (
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
        )}
        {options.map((opt) => (
          <MenuItem key={opt.value} value={opt.value}>
            {opt.label}
          </MenuItem>
        ))}
        <MenuItem value={OTHER_VALUE}>{otherLabel}</MenuItem>
      </TextField>
      {selectValue === OTHER_VALUE && (
        <TextField
          label={otherFieldLabel ?? `${otherLabel} name`}
          value={otherText}
          onChange={(e) => handleOtherTextChange(e.target.value)}
          fullWidth
          size="small"
          required={required}
          error={required && otherText.trim() === ''}
          helperText={required && otherText.trim() === '' ? 'This field is required' : undefined}
        />
      )}
    </Box>
  );
}
