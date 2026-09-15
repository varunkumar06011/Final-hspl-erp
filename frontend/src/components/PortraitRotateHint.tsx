import { Alert, AlertTitle } from '@mui/material';
import { ScreenRotation as RotateIcon } from '@mui/icons-material';

/**
 * Shows a "Rotate your phone horizontally for a better view" banner.
 *
 * This is meant to be rendered on mobile PORTRAIT mode (when the landscape
 * Excel table is NOT visible) so the user is prompted to rotate. Once they
 * rotate, this component unmounts (the parent stops rendering it) and the
 * Excel table takes over.
 */
export default function PortraitRotateHint() {
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
        Rotate for a better view
      </AlertTitle>
      Rotate your phone horizontally to see an Excel-style table with all
      columns, zoom controls, and search. Or tap the <strong>Table View</strong>{' '}
      button above to switch manually.
      <br />
      <br />
      If the screen doesn't rotate, make sure auto-rotate is enabled in your
      phone settings. If you're using this app as an installed app (from home
      screen), you may need to remove and re-add it for the orientation change
      to take effect.
    </Alert>
  );
}
