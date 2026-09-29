import { Box, Typography, Link as MuiLink } from '@mui/material';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined';
import { Link as RouterLink } from 'react-router-dom';
import LegalLayout from '../components/LegalLayout';

import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('support');
  return (
    <LegalLayout title={t('support')}>
      <Typography variant="body1" paragraph>
        {t('intro')}
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
              {t('email')}
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
              {t('phoneWhatsapp')}
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

      <Typography variant="h5" fontWeight={600}>{t('beforeYouContactUs')}</Typography>
      <ul>
        <li>{t('tip1')}</li>
        <li>{t('tip2')}</li>
        <li>{t('tip3')}</li>
      </ul>

      <Typography variant="h5" fontWeight={600}>{t('legal')}</Typography>
      <Typography variant="body1" paragraph>
        {t('legalIntro')}{' '}
        <MuiLink component={RouterLink} to="/terms" underline="hover">
          {t('termsConditions')}
        </MuiLink>{' '}
        {t('and')}{' '}
        <MuiLink component={RouterLink} to="/privacy-policy" underline="hover">
          {t('privacyPolicy')}
        </MuiLink>
        .
      </Typography>
    </LegalLayout>
  );
}
