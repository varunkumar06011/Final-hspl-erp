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
      className="responsive-table"
      sx={{
        // Desktop: no changes at all
        // Mobile: transform table rows into stacked cards
        '@media (max-width: 899.95px)': {
          // The table element keeps display:table on mobile — its intrinsic
          // min-width comes from cell content, so wide cells push the whole
          // card row past the viewport and the page slides horizontally.
          // Force block layout so rows always fit the container width.
          '& .MuiTableContainer-root': { overflowX: 'hidden' },
          '& .MuiTable-root': { display: 'block', width: '100%' },
          '& .MuiTableBody-root': { display: 'block', width: '100%' },
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
          // Stacked label-over-value cells: the label sits small-caps on top
          // and the value gets the full row width underneath — side-by-side
          // squeezed values into a 65% column and looked detached/cramped.
          '& .MuiTableBody-root .MuiTableCell-root': {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 0.25,
            py: 0.75,
            px: 1.5,
            minWidth: 0,
            // cells like Item Description carry sx={{ maxWidth: 220 }} which
            // would narrow the stacked row — this selector outranks sx.
            maxWidth: 'none',
            overflowWrap: 'break-word',
            borderBottom: '1px solid',
            borderColor: 'action.hover',
            '&:last-child': { borderBottom: 'none' },
            // Label on top
            '&::before': {
              content: 'attr(data-label)',
              fontWeight: 600,
              fontSize: '0.7rem',
              color: 'text.secondary',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            },
            // Value fills the row and wraps cleanly.
            // overflowWrap (not wordBreak) so normal words stay intact and only
            // genuinely-long unbreakable strings wrap.
            '& > *': {
              textAlign: 'left',
              maxWidth: '100%',
              overflowWrap: 'break-word',
            },
          },
          // Action buttons flow left-aligned under the label, wrapping onto
          // a second line on narrow screens.
          '& .MuiTableBody-root .MuiTableCell-root[data-label="Actions"]': {
            '& > *': {
              display: 'flex',
              gap: 0.5,
              maxWidth: '100%',
              flexWrap: 'wrap',
              justifyContent: 'flex-start',
            },
          },
          // Loading / empty-state rows: center the spinner/message
          '& .MuiTableBody-root .MuiTableRow-root .MuiTableCell-root:not([data-label])': {
            justifyContent: 'center',
            py: 3,
            '&::before': { content: 'none' },
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
