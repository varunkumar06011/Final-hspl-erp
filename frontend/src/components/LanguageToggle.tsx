import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';
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
          px: { xs: 0.75, sm: 1 },
          py: 0.25,
          minWidth: { xs: 28, sm: 36 },
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
      <ToggleButton value="en" aria-label="English">
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>EN</Box>
        <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>E</Box>
      </ToggleButton>
      <ToggleButton value="te" aria-label="తెలుగు">
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>తెలుగు</Box>
        <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>తె</Box>
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
