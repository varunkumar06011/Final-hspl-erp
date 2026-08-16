import { Box, Typography, Card, CardContent } from '@mui/material';
import { Construction as ConstructionIcon } from '@mui/icons-material';

export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <Box>
      <Typography variant="h5" gutterBottom fontWeight={600}>
        {title}
      </Typography>
      <Card>
        <CardContent sx={{ textAlign: 'center', py: 8 }}>
          <ConstructionIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            {title} module — coming in the next build step
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This page will be built with live API data when its phase is implemented.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
