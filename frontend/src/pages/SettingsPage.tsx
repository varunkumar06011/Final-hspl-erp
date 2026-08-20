import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Alert,
  CircularProgress,
} from '@mui/material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [officeAddress, setOfficeAddress] = useState('');
  const [hospitalAddress, setHospitalAddress] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['/settings'],
    queryFn: async () => {
      const response = await api.get('/settings');
      return response.data;
    },
  });

  useEffect(() => {
    if (data) {
      setOfficeAddress(data.officeAddress ?? '');
      setHospitalAddress(data.hospitalAddress ?? '');
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: async (payload: { officeAddress?: string; hospitalAddress?: string }) => {
      const response = await api.patch('/settings', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/settings'] });
      setSuccess('Settings saved successfully');
      setError('');
      setTimeout(() => setSuccess(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  if (isLoading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Typography variant="h5" gutterBottom fontWeight={600}>Settings</Typography>

      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Address Settings</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            These addresses are used in Purchase Order PDFs.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Office Address (Bill To)"
              value={officeAddress}
              onChange={(e) => setOfficeAddress(e.target.value)}
              fullWidth
              multiline
              rows={3}
            />
            <TextField
              label="Hospital Address (Delivery Address)"
              value={hospitalAddress}
              onChange={(e) => setHospitalAddress(e.target.value)}
              fullWidth
              multiline
              rows={3}
            />
            <Button
              variant="contained"
              onClick={() => updateMutation.mutate({ officeAddress, hospitalAddress })}
              disabled={updateMutation.isPending}
              sx={{ alignSelf: 'flex-start' }}
            >
              {updateMutation.isPending ? <CircularProgress size={20} /> : 'Save Settings'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
