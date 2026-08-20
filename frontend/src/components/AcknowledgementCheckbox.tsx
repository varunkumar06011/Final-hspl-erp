import { Checkbox, FormControlLabel, Typography } from '@mui/material';

interface AcknowledgementCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  entityLabel: string;
}

export default function AcknowledgementCheckbox({ checked, onChange, entityLabel }: AcknowledgementCheckboxProps) {
  return (
    <FormControlLabel
      control={<Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)} />}
      label={
        <Typography variant="body2">
          I confirm that I have thoroughly reviewed and verified all details of this {entityLabel}.
        </Typography>
      }
    />
  );
}
