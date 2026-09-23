import { ReactNode } from 'react';
import { Box, Container, Typography, Link as MuiLink, Divider } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

interface LegalLayoutProps {
  title: string;
  effectiveDate?: string;
  children: ReactNode;
}

/**
 * Shared chrome for the public legal/support pages (Privacy Policy / Terms &
 * Conditions / Support). Rendered outside AppShell so it works without a
 * session — Apple requires these pages to be reachable pre-login.
 */
export default function LegalLayout({ title, effectiveDate, children }: LegalLayoutProps) {
  return (
    <Box sx={{ minHeight: '100dvh', backgroundColor: '#f5f7fa', py: { xs: 3, sm: 6 } }}>
      <Container maxWidth="md">
        <Box
          sx={{
            backgroundColor: '#fff',
            borderRadius: '16px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
            p: { xs: 3, sm: 6 },
          }}
        >
          <Typography variant="h4" fontWeight={700} gutterBottom sx={{ color: '#0a1929' }}>
            {title}
          </Typography>
          <Typography variant="body2" sx={{ color: 'rgba(10,25,41,0.55)', mb: 1 }}>
            Hospital Construction ERP — VGRAND Health Care
          </Typography>
          {effectiveDate && (
            <Typography variant="body2" sx={{ color: 'rgba(10,25,41,0.55)' }}>
              Effective date: {effectiveDate}
            </Typography>
          )}
          <Divider sx={{ my: 3 }} />
          <Box
            sx={{
              '& h5': { color: '#0a1929', marginTop: '1.75rem' },
              '& p, & li': { color: 'rgba(10,25,41,0.8)', lineHeight: 1.7 },
              '& ul': { pl: 3 },
            }}
          >
            {children}
          </Box>
          <Divider sx={{ my: 3 }} />
          <Typography variant="body2" sx={{ color: 'rgba(10,25,41,0.55)' }}>
            <MuiLink component={RouterLink} to="/login" underline="hover">
              ← Back to sign in
            </MuiLink>
          </Typography>
        </Box>
      </Container>
    </Box>
  );
}
