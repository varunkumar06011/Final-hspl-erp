import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { saveLanguage, type AppLanguage } from '../i18n';

interface Props {
  /** Style for use on the dark login background / navbar. */
  onDark?: boolean;
}

export default function LanguageToggle({ onDark = false }: Props) {
  const { i18n, t } = useTranslation();
  const current = (i18n.language?.startsWith('te') ? 'te' : 'en') as AppLanguage;

  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={current}
      aria-label={t('language.label')}
      onChange={(_, next: AppLanguage | null) => {
        if (!next) return;
        saveLanguage(next);
        void i18n.changeLanguage(next);
      }}
      sx={{
        '& .MuiToggleButton-root': {
          px: 1,
          py: 0.25,
          minWidth: 36,
          fontSize: '0.75rem',
          fontWeight: 700,
          lineHeight: 1.6,
          color: onDark ? 'rgba(255,255,255,0.8)' : 'text.secondary',
          borderColor: onDark ? 'rgba(255,255,255,0.4)' : 'divider',
          '&.Mui-selected': {
            color: onDark ? '#fff' : 'primary.main',
            bgcolor: onDark ? 'rgba(255,255,255,0.22)' : 'action.selected',
          },
        },
      }}
    >
      <ToggleButton value="en">EN</ToggleButton>
      <ToggleButton value="te">తెలుగు</ToggleButton>
    </ToggleButtonGroup>
  );
}
