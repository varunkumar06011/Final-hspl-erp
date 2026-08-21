import { Box } from '@mui/material';

/**
 * Wraps a MUI Table so that on mobile (< md breakpoint) each row becomes
 * a stacked card with labels (via data-label on TableCell). On desktop
 * the table renders exactly as before — no changes.
 *
 * Usage:
 *   <ResponsiveTable>
 *     <TableContainer>...</TableContainer>
 *   </ResponsiveTable>
 *
 * Add `data-label="Column Name"` to each <TableCell> in <TableBody>
 * so the card shows field labels on mobile.
 */
export default function ResponsiveTable({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        // Desktop: no changes at all
        // Mobile: transform table rows into stacked cards
        '@media (max-width: 899.95px)': {
          '& .MuiTableHead-root': { display: 'none' },
          '& .MuiTableBody-root .MuiTableRow-root': {
            display: 'flex',
            flexDirection: 'column',
            mb: 1.5,
            p: 1,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1.5,
            backgroundColor: 'background.paper',
            '&:last-child': { mb: 0 },
          },
          '& .MuiTableBody-root .MuiTableCell-root': {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 1,
            py: 0.75,
            px: 1.5,
            borderBottom: '1px solid',
            borderColor: 'action.hover',
            '&:last-child': { borderBottom: 'none' },
            '&::before': {
              content: 'attr(data-label)',
              fontWeight: 600,
              fontSize: '0.75rem',
              color: 'text.secondary',
              flexShrink: 0,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            },
          },
          // Hide cells explicitly marked as hidden on mobile
          '& .MuiTableBody-root .MuiTableCell-root.hide-on-mobile': {
            display: 'none',
          },
        },
      }}
    >
      {children}
    </Box>
  );
}
