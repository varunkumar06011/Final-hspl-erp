import { Dialog, DialogProps, IconButton, useMediaQuery, useTheme } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface ResponsiveDialogProps extends DialogProps {
  children: React.ReactNode;
  /** Set when the dialog already renders its own close/X button. */
  hideCloseButton?: boolean;
}

/**
 * Dialog that automatically goes fullScreen on mobile (below sm breakpoint).
 * On tablet/desktop, uses the provided maxWidth/fullWidth props as-is.
 * This prevents modal overflow, clipping, and horizontal scroll on small screens.
 *
 * Also draws a floating X in the top-right corner (whenever onClose is provided) so
 * iOS users, who have no hardware back button, can always leave a popup.
 */
export default function ResponsiveDialog({
  children,
  hideCloseButton,
  ...props
}: ResponsiveDialogProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { t } = useTranslation();
  const { onClose } = props;

  return (
    <Dialog
      {...props}
      fullScreen={isMobile}
      sx={{
        '& .MuiDialog-paper': {
          margin: isMobile ? 0 : { xs: 1, sm: 3 },
          width: isMobile ? '100%' : undefined,
          maxWidth: isMobile ? '100%' : undefined,
          maxHeight: isMobile ? '100%' : undefined,
          height: isMobile ? '100%' : undefined,
        },
        ...(onClose && !hideCloseButton
          ? { '& .MuiDialogTitle-root': { paddingRight: 7 } }
          : {}),
        ...props.sx,
      }}
    >
      {onClose && !hideCloseButton && (
        <IconButton
          aria-label={t('common.close')}
          onClick={(e) => onClose(e, 'escapeKeyDown')}
          sx={{
            position: 'absolute',
            top: 'calc(8px + env(safe-area-inset-top))',
            right: 8,
            zIndex: 2,
          }}
        >
          <CloseIcon />
        </IconButton>
      )}
      {children}
    </Dialog>
  );
}
