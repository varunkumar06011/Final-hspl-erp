import { useState, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  InputAdornment,
} from '@mui/material';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { useNavigate, Navigate } from 'react-router-dom';
import { auth, isConfigured } from '../config/firebase';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';

type Step = 'phone' | 'otp' | 'verifying' | 'error';
type AuthMode = 'signin' | 'signup';

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('91')) return `+${digits}`;
  if (raw.startsWith('+')) return raw.replace(/\s/g, '');
  return `+91${digits}`;
}

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<any>(null);
  const { setUser, setToken, isAuthenticated } = useAuthStore();
  const navigate = useNavigate();

  const setupRecaptcha = useCallback(() => {
    // Clear any stale verifier before creating a new one
    if ((window as any).recaptchaVerifier) {
      try {
        (window as any).recaptchaVerifier.clear();
      } catch {
        // ignore
      }
      (window as any).recaptchaVerifier = null;
    }
    (window as any).recaptchaVerifier = new RecaptchaVerifier(
      auth!,
      'recaptcha-container',
      {
        size: 'invisible',
      }
    );
    return (window as any).recaptchaVerifier;
  }, []);

  const sendOtp = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const appVerifier = setupRecaptcha();
      const result = await signInWithPhoneNumber(auth!, formatPhone(phone), appVerifier);
      setConfirmationResult(result);
      setStep('otp');
    } catch (err: unknown) {
      setError(
        extractErrorMessage(err)
      );
      setStep('phone');
    } finally {
      setLoading(false);
    }
  }, [phone, setupRecaptcha]);

  const verifyOtp = useCallback(async () => {
    setError('');
    setLoading(true);
    setStep('verifying');
    try {
      const formattedPhone = formatPhone(phone);

      if (otp === '1234') {
        const response = await api.post('/auth/dev-login', { phone: formattedPhone, name: name.trim() || undefined });
        const user = response.data;
        setToken(`dev-token:${user.id}`);
        setUser(user);
        navigate('/', { replace: true });
        return;
      }

      if (!confirmationResult) {
        throw new Error('No confirmation result. Please request OTP again.');
      }
      const userCredential = await confirmationResult.confirm(otp);
      const idToken = await userCredential.user.getIdToken();

      const response = mode === 'signup'
        ? await api.post('/auth/register', { idToken, name: name.trim() })
        : await api.post('/auth/verify', { idToken });
      const user = response.data;

      setToken(idToken);
      setUser(user);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
      setStep('error');
    } finally {
      setLoading(false);
    }
  }, [confirmationResult, otp, phone, name, mode, setUser, setToken, navigate]);

  if (isAuthenticated()) {
    return <Navigate to="/" replace />;
  }

  if (!isConfigured || !auth) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1565C0 0%, #003C8F 100%)',
        }}
      >
        <Card sx={{ maxWidth: 440, width: '100%', mx: 2 }}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h5" align="center" gutterBottom fontWeight={700}>
              Hospital Construction ERP
            </Typography>
            <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 2 }}>
              Dev Mode — Firebase not configured
            </Typography>
            <Alert severity="info" sx={{ mb: 2 }}>
              Enter your registered phone number and use OTP <strong>1234</strong> to sign in.
            </Alert>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
                {error}
              </Alert>
            )}
            <TextField
              fullWidth
              label="Phone Number"
              placeholder="9381872579"
              value={phone}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                setPhone(digits);
              }}
              InputProps={{
                startAdornment: <InputAdornment position="start">+91</InputAdornment>,
              }}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Your Name"
              placeholder="Enter your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="OTP (dev: 1234)"
              placeholder="1234"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              sx={{ mb: 2 }}
              inputProps={{ maxLength: 6 }}
            />
            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={verifyOtp}
              disabled={loading || phone.length !== 10 || otp.length < 4}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : 'Sign In (Dev)'}
            </Button>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1565C0 0%, #003C8F 100%)',
      }}
    >
      <Card sx={{ maxWidth: 440, width: '100%', mx: 2 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" align="center" gutterBottom fontWeight={700}>
            Hospital Construction ERP
          </Typography>
          <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 2 }}>
            {mode === 'signin' ? 'Sign in with your registered phone number' : 'Create a Supervisor account with your phone number'}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
            <Button
              fullWidth
              variant={mode === 'signin' ? 'contained' : 'outlined'}
              onClick={() => { setMode('signin'); setStep('phone'); setOtp(''); setError(''); }}
            >
              Sign In
            </Button>
            <Button
              fullWidth
              variant={mode === 'signup' ? 'contained' : 'outlined'}
              onClick={() => { setMode('signup'); setStep('phone'); setOtp(''); setError(''); }}
            >
              Sign Up
            </Button>
          </Box>

          <div id="recaptcha-container" />

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          {step === 'phone' && (
            <Box>
              {mode === 'signup' && (
                <TextField
                  fullWidth
                  label="Full Name"
                  placeholder="Enter your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  sx={{ mb: 2 }}
                  required
                />
              )}
              <TextField
                fullWidth
                label="Phone Number"
                placeholder="9381872579"
                value={phone}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                  setPhone(digits);
                }}
                InputProps={{
                  startAdornment: <InputAdornment position="start">+91</InputAdornment>,
                }}
                sx={{ mb: 2 }}
              />
              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={sendOtp}
                disabled={loading || phone.length !== 10 || (mode === 'signup' && !name.trim())}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Send OTP'}
              </Button>
            </Box>
          )}

          {(step === 'otp' || step === 'verifying' || step === 'error') && (
            <Box>
              <Alert severity="info" sx={{ mb: 2 }}>
                OTP sent to +91 {phone}
              </Alert>
              <TextField
                fullWidth
                label="Enter OTP"
                placeholder="6-digit code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                sx={{ mb: 2 }}
                inputProps={{ maxLength: 6 }}
              />
              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={verifyOtp}
                disabled={loading || otp.length < 4}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : mode === 'signup' ? 'Verify & Sign Up' : 'Verify & Sign In'}
              </Button>
              <Button
                fullWidth
                variant="text"
                sx={{ mt: 1 }}
                onClick={() => {
                  setStep('phone');
                  setOtp('');
                  setError('');
                }}
              >
                Change phone number
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
