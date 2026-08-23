import { Dialog, DialogProps, useMediaQuery, useTheme } from '@mui/material';

interface ResponsiveDialogProps extends DialogProps {
  children: React.ReactNode;
}

/**
 * Dialog that automatically goes fullScreen on mobile (below sm breakpoint).
 * On tablet/desktop, uses the provided maxWidth/fullWidth props as-is.
 * This prevents modal overflow, clipping, and horizontal scroll on small screens.
 */
export default function ResponsiveDialog({ children, ...props }: ResponsiveDialogProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

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
        ...props.sx,
      }}
    >
      {children}
    </Dialog>
  );
}
