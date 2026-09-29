import { Alert, AlertTitle } from '@mui/material';
import { ScreenRotation as RotateIcon } from '@mui/icons-material';
import { useTranslation, Trans } from 'react-i18next';

/**
 * Shows a "Rotate your phone horizontally for a better view" banner.
 *
 * This is meant to be rendered on mobile PORTRAIT mode (when the landscape
 * Excel table is NOT visible) so the user is prompted to rotate. Once they
 * rotate, this component unmounts (the parent stops rendering it) and the
 * Excel table takes over.
 */
export default function PortraitRotateHint() {
  const { t } = useTranslation();
  return (
    <Alert
      severity="info"
      icon={<RotateIcon />}
      sx={{
        mb: 1,
        '& .MuiAlert-message': { py: 0.5 },
        '& .MuiAlert-icon': { alignItems: 'center' },
      }}
    >
      <AlertTitle sx={{ fontSize: '0.85rem', fontWeight: 700, mb: 0.25 }}>
        {t('shared.rotateHintTitle')}
      </AlertTitle>
      <Trans i18nKey="shared.rotateHintBody" components={{ b: <strong /> }} />
      <br />
      <br />
      {t('shared.rotateHintNote')}
    </Alert>
  );
}
