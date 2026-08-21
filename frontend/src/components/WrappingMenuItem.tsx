import { MenuItem, MenuItemProps, Box, Typography } from '@mui/material';

interface WrappingMenuItemProps extends Omit<MenuItemProps, 'children'> {
  primary: string;
  secondary?: string;
}

/**
 * MenuItem that wraps long text instead of clipping it.
 * Renders primary text on the first line and optional secondary text
 * (e.g. role, phone number) on a second line in muted color.
 * Works correctly on mobile where single-line MenuItems get clipped.
 */
export default function WrappingMenuItem({
  primary,
  secondary,
  ...props
}: WrappingMenuItemProps) {
  return (
    <MenuItem
      {...props}
      sx={{
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
        py: 1,
        ...props.sx,
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, width: '100%', minWidth: 0 }}>
        <Typography variant="body2" sx={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
          {primary}
        </Typography>
        {secondary && (
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
            {secondary}
          </Typography>
        )}
      </Box>
    </MenuItem>
  );
}
