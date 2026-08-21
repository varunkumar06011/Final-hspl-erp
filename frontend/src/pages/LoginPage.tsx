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
  Input,
  IconButton,
  InputAdornment as MuiInputAdornment,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { useNavigate, Navigate } from 'react-router-dom';
import { auth, isConfigured } from '../config/firebase';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';

type Step = 'phone' | 'pin' | 'otp' | 'setPin' | 'verifying';
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
  const [pin, setPin] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<any>(null);
  const { setUser, setToken, isAuthenticated } = useAuthStore();
  const navigate = useNavigate();

  const setupRecaptcha = useCallback(() => {
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
      { size: 'invisible' }
    );
    return (window as any).recaptchaVerifier;
  }, []);

  // Step 1: Check if phone has a PIN set
  const handleCheckPhone = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const formattedPhone = formatPhone(phone);
      const response = await api.get('/auth/check-pin', { params: { phone: formattedPhone } });
      if (response.data.hasPin) {
        setStep('pin');
      } else {
        // No PIN set — need OTP first
        if (mode === 'signup') {
          await sendOtp();
        } else {
          // Sign in but no PIN — go to OTP to verify identity, then set PIN
          await sendOtp();
        }
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [phone, mode]);

  // Step 2a: Login with PIN
  const handlePinLogin = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const formattedPhone = formatPhone(phone);
      const response = await api.post('/auth/pin-login', { phone: formattedPhone, pin });
      setToken(response.data.token);
      setUser(response.data.user);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [phone, pin, setToken, setUser, navigate]);

  // Step 2b: Send OTP via Firebase
  const sendOtp = useCallback(async () => {
    setLoading(true);
    try {
      if (!isConfigured || !auth) {
        // Dev mode — skip OTP, go straight to setPin
        setStep('setPin');
        return;
      }
      const appVerifier = setupRecaptcha();
      const result = await signInWithPhoneNumber(auth!, formatPhone(phone), appVerifier);
      setConfirmationResult(result);
      setStep('otp');
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
      setStep('phone');
    } finally {
      setLoading(false);
    }
  }, [phone, setupRecaptcha]);

  // Step 2c: Verify OTP
  const handleVerifyOtp = useCallback(async () => {
    setError('');
    setLoading(true);
    setStep('verifying');
    try {
      const formattedPhone = formatPhone(phone);

      // Dev mode fallback
      if (!isConfigured || !auth || otp === '1234') {
        // Verify/register with backend using dev-login or Firebase
        if (otp === '1234') {
          await api.post('/auth/dev-login', { phone: formattedPhone, name: name.trim() || undefined });
          if (mode === 'signup' && name.trim()) {
            // For signup in dev mode, just proceed to set PIN
          }
          // Proceed to set PIN
          setStep('setPin');
          return;
        }
      }

      if (!confirmationResult) {
        throw new Error('No confirmation result. Please request OTP again.');
      }
      const userCredential = await confirmationResult.confirm(otp);
      const idToken = await userCredential.user.getIdToken();

      // Verify or register with backend
      const response = mode === 'signup'
        ? await api.post('/auth/register', { idToken, name: name.trim() })
        : await api.post('/auth/verify', { idToken });

      // OTP verified — now set PIN
      setUser(response.data);
      setStep('setPin');
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
      setStep('otp');
    } finally {
      setLoading(false);
    }
  }, [confirmationResult, otp, phone, name, mode, setUser]);

  // Step 3: Set PIN (after OTP verification)
  const handleSetPin = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const formattedPhone = formatPhone(phone);
      const response = await api.post('/auth/set-pin', { phone: formattedPhone, pin });
      setToken(response.data.token);
      setUser(response.data.user);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [phone, pin, setToken, setUser, navigate]);

  if (isAuthenticated()) {
    return <Navigate to="/" replace />;
  }

  const isDevMode = !isConfigured || !auth;

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1565C0 0%, #003C8F 100%)',
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 440, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" align="center" gutterBottom fontWeight={700}>
            Hospital Construction ERP
          </Typography>

          <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
            <Button
              fullWidth
              variant={mode === 'signin' ? 'contained' : 'outlined'}
              onClick={() => { setMode('signin'); setStep('phone'); setPin(''); setOtp(''); setError(''); }}
            >
              Sign In
            </Button>
            <Button
              fullWidth
              variant={mode === 'signup' ? 'contained' : 'outlined'}
              onClick={() => { setMode('signup'); setStep('phone'); setPin(''); setOtp(''); setError(''); }}
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

          {/* Step: Phone entry */}
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
                onClick={handleCheckPhone}
                disabled={loading || phone.length !== 10 || (mode === 'signup' && !name.trim())}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Continue'}
              </Button>
            </Box>
          )}

          {/* Step: PIN entry (returning user) */}
          {step === 'pin' && (
            <Box>
              <Alert severity="info" sx={{ mb: 2 }}>
                Welcome back! Enter your 4-digit PIN to sign in.
              </Alert>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Phone: <strong>+91 {phone}</strong>
              </Typography>
              <Input
                fullWidth
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setPin(digits);
                }}
                placeholder="4-digit PIN"
                sx={{ mb: 2, textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.5rem' }}
                inputProps={{ maxLength: 4, style: { textAlign: 'center' } }}
                endAdornment={
                  <MuiInputAdornment position="end">
                    <IconButton onClick={() => setShowPin(!showPin)} edge="end">
                      {showPin ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </MuiInputAdornment>
                }
              />
              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={handlePinLogin}
                disabled={loading || pin.length !== 4}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Sign In'}
              </Button>
              <Button
                fullWidth
                variant="text"
                sx={{ mt: 1 }}
                onClick={() => { setStep('phone'); setPin(''); setError(''); }}
              >
                Use a different phone number
              </Button>
              <Button
                fullWidth
                variant="text"
                sx={{ mt: 0.5 }}
                onClick={() => { setStep('otp'); setError(''); }}
              >
                Forgot PIN? Verify with OTP
              </Button>
            </Box>
          )}

          {/* Step: OTP entry */}
          {step === 'otp' && (
            <Box>
              <Alert severity="info" sx={{ mb: 2 }}>
                OTP sent to +91 {phone}. Enter the 6-digit code to verify your identity.
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
                onClick={handleVerifyOtp}
                disabled={loading || otp.length < 4}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Verify OTP'}
              </Button>
              <Button
                fullWidth
                variant="text"
                sx={{ mt: 1 }}
                onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
              >
                Change phone number
              </Button>
              {isDevMode && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  Dev mode: use OTP <strong>1234</strong>
                </Alert>
              )}
            </Box>
          )}

          {/* Step: Set PIN (after OTP verification) */}
          {step === 'setPin' && (
            <Box>
              <Alert severity="success" sx={{ mb: 2 }}>
                Identity verified! Set a 4-digit PIN for quick login next time.
              </Alert>
              <Input
                fullWidth
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setPin(digits);
                }}
                placeholder="Choose a 4-digit PIN"
                sx={{ mb: 2, textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.5rem' }}
                inputProps={{ maxLength: 4, style: { textAlign: 'center' } }}
                endAdornment={
                  <MuiInputAdornment position="end">
                    <IconButton onClick={() => setShowPin(!showPin)} edge="end">
                      {showPin ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </MuiInputAdornment>
                }
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                You'll use this PIN with your phone number to sign in — no OTP needed.
              </Typography>
              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={handleSetPin}
                disabled={loading || pin.length !== 4}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Set PIN & Sign In'}
              </Button>
            </Box>
          )}

          {/* Step: Verifying (loading state) */}
          {step === 'verifying' && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
