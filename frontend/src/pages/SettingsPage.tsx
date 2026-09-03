import { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Input,
  IconButton,
  InputAdornment,
  FormControlLabel,
  Switch,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { formatCurrency, formatIndianNumber } from '../utils/enumOptions';
import NotificationPermissionPrompt from '../components/NotificationPermissionPrompt';

const NOTIFICATION_EVENT_LABELS: { key: string; label: string; description: string }[] = [
  { key: 'entity_created', label: 'New entity created', description: 'PO, quotation, invoice, payment, etc. created by your team' },
  { key: 'approval_request', label: 'Approval requests', description: 'A document is waiting for your approval' },
  { key: 'approval_result', label: 'Approval results', description: 'Your document was approved or rejected' },
];

const ROLE_LABELS: Record<string, string> = {
  PROJECT_HEAD: 'Project Head',
  HEAD_OF_CONSTRUCTION: 'Head of Construction',
  ACCOUNTS_HEAD: 'Accounts Head',
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
  const [hospitalName, setHospitalName] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPins, setShowPins] = useState(false);
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
      setHospitalName(data.name ?? '');
      setOfficeAddress(data.officeAddress ?? '');
      setHospitalAddress(data.hospitalAddress ?? '');
      setGstNumber(data.gstNumber ?? '');
      setPanNumber(data.panNumber ?? '');
      setLogoUrl(data.logoUrl ?? null);
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
    mutationFn: async (payload: { name?: string; officeAddress?: string; hospitalAddress?: string; gstNumber?: string; panNumber?: string; logoUrl?: string | null; totalBudget?: number }) => {
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

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('logo', file);
      const response = await api.post('/settings/logo', formData, {
        headers: { 'Content-Type': undefined } as any,
      });
      return response.data;
    },
    onSuccess: (data) => {
      setLogoUrl(data.logoUrl);
      queryClient.invalidateQueries({ queryKey: ['/settings'] });
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

  const changePinMutation = useMutation({
    mutationFn: async (payload: { oldPin: string; newPin: string }) => {
      const response = await api.post('/auth/change-pin', payload);
      return response.data;
    },
    onSuccess: () => {
      setSuccess('PIN updated successfully');
      setError('');
      setOldPin('');
      setNewPin('');
      setConfirmPin('');
      setTimeout(() => setSuccess(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const { data: notifPrefs } = useQuery({
    queryKey: ['/notifications/preferences'],
    queryFn: async () => {
      const response = await api.get('/notifications/preferences');
      return response.data.prefs as Record<string, boolean>;
    },
  });

  const updatePrefsMutation = useMutation({
    mutationFn: async (prefs: Record<string, boolean>) => {
      const response = await api.patch('/notifications/preferences', { prefs });
      return response.data.prefs as Record<string, boolean>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/notifications/preferences'] });
      setSuccess('Notification preferences saved');
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
      <Typography variant="h5" gutterBottom fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>Settings</Typography>

      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Profile Settings */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>My Profile</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Update your name and phone number. Your phone number is used for gate pass OTP verification.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: { xs: '100%', sm: 400 } }}>
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

      {/* Notifications */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Push Notifications</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Get system-level alerts when an approval is required, even when the website is closed or minimized.
          </Typography>
          <NotificationPermissionPrompt />
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Notification Preferences</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose which types of push notifications you want to receive. Muted categories will not trigger a push, even if you are subscribed.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {NOTIFICATION_EVENT_LABELS.map(({ key, label, description }) => (
              <FormControlLabel
                key={key}
                control={
                  <Switch
                    checked={notifPrefs?.[key] ?? true}
                    onChange={(e) => {
                      const next = { ...(notifPrefs ?? {}), [key]: e.target.checked };
                      updatePrefsMutation.mutate(next);
                    }}
                    disabled={updatePrefsMutation.isPending}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{label}</Typography>
                    <Typography variant="caption" color="text.secondary">{description}</Typography>
                  </Box>
                }
                sx={{ alignItems: 'flex-start', mr: 0 }}
              />
            ))}
          </Box>
        </CardContent>
      </Card>

      {/* Change PIN */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Change Login PIN</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Your 4-digit PIN is used with your phone number to sign in. No OTP needed after setting it.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 400, flexWrap: 'wrap' }}>
            <Input
              type={showPins ? 'text' : 'password'}
              value={oldPin}
              onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 4); setOldPin(d); }}
              placeholder="Current PIN"
              fullWidth
              inputProps={{ maxLength: 4, style: { textAlign: 'center', letterSpacing: '0.3rem', fontSize: '1.25rem' } }}
              endAdornment={
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowPins(!showPins)} edge="end">
                    {showPins ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              }
            />
            <Input
              type={showPins ? 'text' : 'password'}
              value={newPin}
              onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 4); setNewPin(d); }}
              placeholder="New PIN"
              fullWidth
              inputProps={{ maxLength: 4, style: { textAlign: 'center', letterSpacing: '0.3rem', fontSize: '1.25rem' } }}
            />
            <Input
              type={showPins ? 'text' : 'password'}
              value={confirmPin}
              onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 4); setConfirmPin(d); }}
              placeholder="Confirm New PIN"
              fullWidth
              error={confirmPin.length > 0 && confirmPin !== newPin}
              inputProps={{ maxLength: 4, style: { textAlign: 'center', letterSpacing: '0.3rem', fontSize: '1.25rem' } }}
            />
            {confirmPin.length > 0 && confirmPin !== newPin && (
              <Typography variant="caption" color="error">PINs do not match</Typography>
            )}
            <Button
              variant="contained"
              onClick={() => changePinMutation.mutate({ oldPin, newPin })}
              disabled={oldPin.length !== 4 || newPin.length !== 4 || confirmPin !== newPin || changePinMutation.isPending}
              sx={{ alignSelf: 'flex-start' }}
            >
              {changePinMutation.isPending ? <CircularProgress size={20} /> : 'Update PIN'}
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
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              label="Hospital Name"
              value={hospitalName}
              onChange={(e) => setHospitalName(e.target.value)}
              fullWidth
              size="small"
              helperText="This name appears on PO PDFs and across the app"
            />
            <TextField
              label="GST Number"
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value)}
              fullWidth
              size="small"
              helperText="GSTIN shown on PO PDFs (e.g. 36ABCDE1234F1Z5)"
            />
            <TextField
              label="PAN Number"
              value={panNumber}
              onChange={(e) => setPanNumber(e.target.value)}
              fullWidth
              size="small"
              helperText="Company PAN shown on PO PDFs"
            />
            <Box>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadLogoMutation.mutate(f);
                  if (e.target) e.target.value = '';
                }}
              />
              <Button
                variant="outlined"
                size="small"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadLogoMutation.isPending}
                sx={{ mr: 1 }}
              >
                {uploadLogoMutation.isPending ? <CircularProgress size={18} /> : 'Choose Logo'}
              </Button>
              <Typography variant="body2" color="text.secondary" component="span">
                {logoUrl ? `Logo uploaded: ${logoUrl}` : 'Upload company logo for PO PDFs (optional)'}
              </Typography>
            </Box>
            <TextField
              label="Total Budget"
              type="text"
              value={formatIndianNumber(totalBudget)}
              onChange={(e) => setTotalBudget(e.target.value.replace(/,/g, ''))}
              inputMode="decimal"
              inputProps={{ min: 0, step: 0.01 }}
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
              onClick={() => updateMutation.mutate({ name: hospitalName, officeAddress, hospitalAddress, gstNumber, panNumber, totalBudget: totalBudget ? Number(totalBudget) : undefined })}
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
