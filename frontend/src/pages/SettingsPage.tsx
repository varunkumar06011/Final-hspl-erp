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
import { useAuthStore } from '../stores/authStore';
import { formatCurrency } from '../utils/enumOptions';

const ROLE_LABELS: Record<string, string> = {
  PROJECT_HEAD: 'Project Head',
  HEAD_OF_CONSTRUCTION: 'Head of Construction',
  ADMIN: 'Admin',
  ADMIN_2: 'Admin 2',
  SUPERVISOR: 'Supervisor',
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { user, setUser } = useAuthStore();
  const [officeAddress, setOfficeAddress] = useState('');
  const [hospitalAddress, setHospitalAddress] = useState('');
  const [totalBudget, setTotalBudget] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['/settings'],
    queryFn: async () => {
      const response = await api.get('/settings');
      return response.data;
    },
  });

  const { data: profile } = useQuery({
    queryKey: ['/settings/profile'],
    queryFn: async () => {
      const response = await api.get('/settings/profile');
      return response.data;
    },
  });

  useEffect(() => {
    if (data) {
      setOfficeAddress(data.officeAddress ?? '');
      setHospitalAddress(data.hospitalAddress ?? '');
      setTotalBudget(data.totalBudget ? String(data.totalBudget) : '');
    }
  }, [data]);

  useEffect(() => {
    if (profile) {
      setProfileName(profile.name ?? '');
      setProfilePhone(profile.phone ?? '');
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: async (payload: { officeAddress?: string; hospitalAddress?: string; totalBudget?: number }) => {
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

  const updateProfileMutation = useMutation({
    mutationFn: async (payload: { name?: string; phone?: string }) => {
      const response = await api.patch('/settings/profile', payload);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/settings/profile'] });
      // Update the auth store so the sidebar/header shows the new name
      if (user) {
        setUser({ ...user, name: data.name, phone: data.phone });
      }
      setSuccess('Profile updated successfully');
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

      {/* Profile Settings */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>My Profile</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Update your name and phone number. Your phone number is used for gate pass OTP verification.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 400 }}>
            <TextField
              label="Name"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Phone Number"
              value={profilePhone}
              onChange={(e) => setProfilePhone(e.target.value)}
              fullWidth
              size="small"
              helperText="Include country code, e.g. +917386861234"
            />
            <TextField
              label="Role"
              value={ROLE_LABELS[profile?.role ?? user?.role ?? ''] ?? profile?.role ?? ''}
              fullWidth
              size="small"
              InputProps={{ readOnly: true }}
              helperText="Role can only be changed by an admin via the Users tab"
            />
            <Button
              variant="contained"
              onClick={() => updateProfileMutation.mutate({ name: profileName, phone: profilePhone })}
              disabled={(!profileName || !profilePhone) || updateProfileMutation.isPending}
              sx={{ alignSelf: 'flex-start' }}
            >
              {updateProfileMutation.isPending ? <CircularProgress size={20} /> : 'Save Profile'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Address Settings */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Project Settings</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            These addresses are used in Purchase Order PDFs. The total budget is used for dashboard tracking.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Total Budget"
              type="number"
              value={totalBudget}
              onChange={(e) => setTotalBudget(e.target.value)}
              fullWidth
              size="small"
              helperText={totalBudget ? `Current: ${formatCurrency(Number(totalBudget))}` : 'Set the total project budget'}
            />
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
              onClick={() => updateMutation.mutate({ officeAddress, hospitalAddress, totalBudget: totalBudget ? Number(totalBudget) : undefined })}
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
