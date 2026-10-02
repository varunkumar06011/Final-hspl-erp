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
import { Visibility, VisibilityOff, Logout as LogoutIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { formatCurrency, formatIndianNumber, roleLabel } from '../utils/enumOptions';
import NotificationPermissionPrompt from '../components/NotificationPermissionPrompt';

import { useTranslation } from 'react-i18next';
import CameraCapture from '../components/CameraCapture';
const NOTIFICATION_EVENT_LABELS: { key: string; label: string; description: string }[] = [
  { key: 'entity_created', label: 'New entity created', description: 'PO, quotation, invoice, payment, etc. created by your team' },
  { key: 'approval_request', label: 'Approval requests', description: 'A document is waiting for your approval' },
  { key: 'approval_result', label: 'Approval results', description: 'Your document was approved or rejected' },
];

export default function SettingsPage() {
  const { t: tr } = useTranslation('settings');
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, setUser, logout } = useAuthStore();
  const [officeAddress, setOfficeAddress] = useState('');
  const [hospitalAddress, setHospitalAddress] = useState('');
  const [totalBudget, setTotalBudget] = useState('');
  const [hospitalName, setHospitalName] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPins, setShowPins] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // Force-update: pull fresh service worker + drop cached assets, then reload.
  // The reload fetches the newest bundle/manifest/icons — no uninstall needed.
  const runAppUpdate = async () => {
    setUpdating(true);
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update().catch(() => undefined)));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      // Replay the opening video on the post-update fresh load.
      try { sessionStorage.removeItem('hspl-opening-shown'); } catch { /* ignore */ }
    } finally {
      window.location.reload();
    }
  };

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
      // The project name also shows in the top-bar switcher and on the dashboard.
      queryClient.invalidateQueries({ queryKey: ['/projects'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      setSuccess(tr('okSettings'));
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
      queryClient.invalidateQueries({ queryKey: ['/projects'] });
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
      setSuccess(tr('okProfile'));
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
      setSuccess(tr('okPrefs'));
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
      <Typography variant="h5" gutterBottom fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>{tr('title')}</Typography>

      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Profile Settings */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>{tr('myProfile')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {tr('profileNote')}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: { xs: '100%', sm: 400 } }}>
            <TextField
              label={tr('name')}
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label={tr('phoneNumber')}
              value={profilePhone}
              onChange={(e) => setProfilePhone(e.target.value)}
              fullWidth
              size="small"
              helperText={tr('phoneHelp')}
            />
            <TextField
              label={tr('role')}
              value={roleLabel(profile?.role ?? user?.role ?? '')}
              fullWidth
              size="small"
              InputProps={{ readOnly: true }}
              helperText={tr('roleHelp')}
            />
            <Button
              variant="contained"
              onClick={() => updateProfileMutation.mutate({ name: profileName, phone: profilePhone })}
              disabled={(!profileName || !profilePhone) || updateProfileMutation.isPending}
              sx={{ alignSelf: 'flex-start' }}
            >
              {updateProfileMutation.isPending ? <CircularProgress size={20} /> : tr('saveProfile')}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>{tr('pushNotifications')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {tr('pushNote')}
          </Typography>
          <NotificationPermissionPrompt />
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>{tr('notificationPreferences')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {tr('prefNote')}
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
                    <Typography variant="body2" fontWeight={600}>{tr(`n_${key}_label`, label)}</Typography>
                    <Typography variant="caption" color="text.secondary">{tr(`n_${key}_desc`, description)}</Typography>
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
          <Typography variant="h6" gutterBottom>{tr('changeLoginPin')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {tr('pinNote')}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: { xs: '100%', sm: 400 }, flexWrap: 'wrap' }}>
            <Input
              type={showPins ? 'text' : 'password'}
              value={oldPin}
              onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 4); setOldPin(d); }}
              placeholder={tr('currentPin')}
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
              placeholder={tr('newPin')}
              fullWidth
              inputProps={{ maxLength: 4, style: { textAlign: 'center', letterSpacing: '0.3rem', fontSize: '1.25rem' } }}
            />
            <Input
              type={showPins ? 'text' : 'password'}
              value={confirmPin}
              onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 4); setConfirmPin(d); }}
              placeholder={tr('confirmNewPin')}
              fullWidth
              error={confirmPin.length > 0 && confirmPin !== newPin}
              inputProps={{ maxLength: 4, style: { textAlign: 'center', letterSpacing: '0.3rem', fontSize: '1.25rem' } }}
            />
            {confirmPin.length > 0 && confirmPin !== newPin && (
              <Typography variant="caption" color="error">{tr('pinsDoNotMatch')}</Typography>
            )}
            <Button
              variant="contained"
              onClick={() => changePinMutation.mutate({ oldPin, newPin })}
              disabled={oldPin.length !== 4 || newPin.length !== 4 || confirmPin !== newPin || changePinMutation.isPending}
              sx={{ alignSelf: 'flex-start' }}
            >
              {changePinMutation.isPending ? <CircularProgress size={20} /> : tr('updatePin')}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Address Settings */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>{tr('projectSettings')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {tr('projNote')}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              label={tr('hospitalName')}
              value={hospitalName}
              onChange={(e) => setHospitalName(e.target.value)}
              fullWidth
              size="small"
              helperText={tr('hospitalHelp')}
            />
            <TextField
              label={tr('gstNumber')}
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value)}
              fullWidth
              size="small"
              helperText={tr('gstHelp')}
            />
            <TextField
              label={tr('panNumber')}
              value={panNumber}
              onChange={(e) => setPanNumber(e.target.value)}
              fullWidth
              size="small"
              helperText={tr('panHelp')}
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
                {uploadLogoMutation.isPending ? <CircularProgress size={18} /> : tr('chooseLogo')}
              </Button>
              <CameraCapture
                onCapture={(f) => uploadLogoMutation.mutate(f)}
                disabled={uploadLogoMutation.isPending}
              />
              <Typography variant="body2" color="text.secondary" component="span">
                {logoUrl ? tr('logoUploaded', { u: logoUrl }) : tr('logoHint')}
              </Typography>
            </Box>
            <TextField
              label={tr('totalBudget')}
              type="text"
              value={formatIndianNumber(totalBudget)}
              onChange={(e) => setTotalBudget(e.target.value.replace(/,/g, ''))}
              inputMode="decimal"
              inputProps={{ min: 0, step: 0.01 }}
              fullWidth
              size="small"
              helperText={totalBudget ? tr('currentV', { v: formatCurrency(Number(totalBudget)) }) : tr('setBudget')}
            />
            <TextField
              label={tr('officeAddressBillTo')}
              value={officeAddress}
              onChange={(e) => setOfficeAddress(e.target.value)}
              fullWidth
              multiline
              rows={3}
            />
            <TextField
              label={tr('hospitalAddressDeliveryAddress')}
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
              {updateMutation.isPending ? <CircularProgress size={20} /> : tr('saveSettings')}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* App Update */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>{tr('appUpdate')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {tr('updateNote')}
          </Typography>
          <Button
            variant="contained"
            color="success"
            onClick={runAppUpdate}
            disabled={updating}
            sx={{ alignSelf: 'flex-start' }}
          >
            {updating ? <CircularProgress size={20} /> : tr('updateApp')}
          </Button>
        </CardContent>
      </Card>

      {/* Account */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>{tr('account')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {tr('logoutNote')}
          </Typography>
          <Button
            variant="outlined"
            color="error"
            startIcon={<LogoutIcon />}
            onClick={() => { logout(); navigate('/login'); }}
          >
            {t('common.logout')}
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
