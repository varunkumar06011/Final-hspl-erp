import { Checkbox, FormControlLabel, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

interface AcknowledgementCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  entityLabel: string;
}

export default function AcknowledgementCheckbox({ checked, onChange, entityLabel }: AcknowledgementCheckboxProps) {
  const { t } = useTranslation();
  return (
    <FormControlLabel
      control={<Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)} />}
      label={
        <Typography variant="body2">
          {t('approval.confirmReviewed', { entity: entityLabel })}
        </Typography>
      }
    />
  );
}
