import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

/** A titled block inside a record's "More details". `single` = full-width content instead of a label/value grid. */
export function DetailSection({ title, single, children }: { title: string; single?: boolean; children: ReactNode }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      <Box sx={{ px: 1.25, py: 0.5, bgcolor: 'action.hover' }}>
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>{title}</Typography>
      </Box>
      {single ? (
        <Box sx={{ p: 1.25, minWidth: 0 }}>{children}</Box>
      ) : (
        <Box sx={{ p: 1.25, display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 1.25 }}>{children}</Box>
      )}
    </Box>
  );
}

export function DetailField({ label, color, children }: { label: string; color?: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }}>{label}</Typography>
      <Typography component="div" variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', overflowWrap: 'anywhere', color }}>{children}</Typography>
    </Box>
  );
}
