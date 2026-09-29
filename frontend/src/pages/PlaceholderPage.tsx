import { Box, Typography, Card, CardContent } from '@mui/material';
import { Construction as ConstructionIcon } from '@mui/icons-material';

import { useTranslation } from 'react-i18next';
export default function PlaceholderPage({ title }: { title: string }) {
  const { t } = useTranslation('support');
  return (
    <Box>
      <Typography variant="h5" gutterBottom fontWeight={600}>
        {title}
      </Typography>
      <Card>
        <CardContent sx={{ textAlign: 'center', py: 8 }}>
          <ConstructionIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            {t('placeholderTitle', { title })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('placeholderNote')}
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
