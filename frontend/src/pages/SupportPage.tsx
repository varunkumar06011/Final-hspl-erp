import { Box, Typography, Link as MuiLink } from '@mui/material';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined';
import { Link as RouterLink } from 'react-router-dom';
import LegalLayout from '../components/LegalLayout';

const contactCardSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  p: 2,
  border: '1px solid rgba(10,25,41,0.1)',
  borderRadius: '12px',
  backgroundColor: '#f8fafc',
};

export default function SupportPage() {
  return (
    <LegalLayout title="Support">
      <Typography variant="body1" paragraph>
        Need help with the Hospital Construction ERP? Reach the VGRAND Health Care
        support team through either channel below, or contact your project
        administrator for account access issues.
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          my: 3,
        }}
      >
        <Box sx={contactCardSx}>
          <EmailOutlinedIcon sx={{ color: '#1565C0', fontSize: 28 }} />
          <Box>
            <Typography variant="body2" sx={{ color: 'rgba(10,25,41,0.55)' }}>
              Email
            </Typography>
            <MuiLink
              href="mailto:vgrandhealthcare@gmail.com"
              underline="hover"
              sx={{ color: '#1565C0', fontWeight: 600, wordBreak: 'break-all' }}
            >
              vgrandhealthcare@gmail.com
            </MuiLink>
          </Box>
        </Box>
        <Box sx={contactCardSx}>
          <PhoneOutlinedIcon sx={{ color: '#1565C0', fontSize: 28 }} />
          <Box>
            <Typography variant="body2" sx={{ color: 'rgba(10,25,41,0.55)' }}>
              Phone / WhatsApp
            </Typography>
            <MuiLink
              href="tel:+919381872579"
              underline="hover"
              sx={{ color: '#1565C0', fontWeight: 600 }}
            >
              +91 93818 72579
            </MuiLink>
          </Box>
        </Box>
      </Box>

      <Typography variant="h5" fontWeight={600}>Before you contact us</Typography>
      <ul>
        <li>For account access, role, or permission issues, contact your project
          administrator first — they can reset your PIN or adjust your access.</li>
        <li>Include your registered phone number and project name so we can
          locate your account quickly.</li>
        <li>For OTP delivery problems, wait a minute and use "Resend OTP" on the
          sign-in screen before reaching out.</li>
      </ul>

      <Typography variant="h5" fontWeight={600}>Legal</Typography>
      <Typography variant="body1" paragraph>
        Please also review our{' '}
        <MuiLink component={RouterLink} to="/terms" underline="hover">
          Terms &amp; Conditions
        </MuiLink>{' '}
        and{' '}
        <MuiLink component={RouterLink} to="/privacy-policy" underline="hover">
          Privacy Policy
        </MuiLink>
        .
      </Typography>
    </LegalLayout>
  );
}
