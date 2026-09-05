import { useState, useCallback, useEffect } from 'react';
import { keyframes } from '@mui/system';
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

// ── Animations ──────────────────────────────────────────────
const fadeInUp = keyframes`
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0);    }
`;

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
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const { setUser, setToken, isAuthenticated } = useAuthStore();
  const navigate = useNavigate();

  // Fetch project logo (public endpoint, no auth needed)
  useEffect(() => {
    api.get('/settings/logo', { responseType: 'blob' })
      .then((res) => {
        const rawMime = res.headers['content-type'];
        const mime = typeof rawMime === 'string' ? rawMime : 'image/png';
        setLogoUrl(URL.createObjectURL(new Blob([res.data], { type: mime })));
      })
      .catch(() => {
        // No logo uploaded — fallback to favicon
      });
    return () => { if (logoUrl) URL.revokeObjectURL(logoUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        // User exists but no PIN — go to OTP to verify identity, then set PIN
        await sendOtp();
      }
    } catch (err: unknown) {
      // 404 = phone not registered
      if (mode === 'signup') {
        // Signup mode: not registered is expected — proceed to OTP to register
        await sendOtp();
      } else {
        // Sign in mode: not registered is an error
        setError(extractErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }, [phone, mode, sendOtp]);

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

  // Step 2c: Verify OTP
  const handleVerifyOtp = useCallback(async () => {
    setError('');
    setLoading(true);
    setStep('verifying');
    try {
      const formattedPhone = formatPhone(phone);

      // Dev mode fallback
      if (!isConfigured || !auth || otp === '1234') {
        if (otp === '1234') {
          if (mode === 'signup') {
            // Dev signup: create user via register endpoint (won't have real Firebase token,
            // so use dev-login which creates/returns the user)
            try {
              await api.post('/auth/dev-login', { phone: formattedPhone, name: name.trim() || undefined });
            } catch {
              // If dev-login fails (user doesn't exist), we can't create in dev mode without Firebase
              // Just proceed to setPin — set-pin endpoint will create the PIN if user exists
            }
          } else {
            await api.post('/auth/dev-login', { phone: formattedPhone, name: name.trim() || undefined });
          }
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

  const fadeAnim = `${fadeInUp} 0.6s ease-out`;
  const stepFadeAnim = `${fadeInUp} 0.4s ease-out`;

  // Apple-style shared input/button styles
  const glassInputSx = {
    mb: 2,
    '& .MuiOutlinedInput-root': {
      borderRadius: '12px',
      background: 'rgba(255, 255, 255, 0.95)',
      color: '#0a1929',
      '& fieldset': { borderColor: 'rgba(0, 0, 0, 0.15)' },
      '&:hover fieldset': { borderColor: 'rgba(21, 101, 192, 0.4)' },
      '&.Mui-focused fieldset': { borderColor: '#1565C0', borderWidth: 2 },
      '& input': { color: '#0a1929' },
      '& input::placeholder': { color: 'rgba(10, 25, 41, 0.4)' },
    },
    '& .MuiInputLabel-root': { color: 'rgba(10, 25, 41, 0.6)' },
    '& .MuiInputLabel-root.Mui-focused': { color: '#1565C0' },
    '& .MuiInputAdornment-root': { color: 'rgba(10, 25, 41, 0.5)' },
  } as const;

  const glassButtonSx = {
    borderRadius: '12px',
    textTransform: 'none',
    fontWeight: 600,
    fontSize: '1rem',
    py: 1.2,
    background: '#1565C0',
    boxShadow: '0 4px 16px rgba(21, 101, 192, 0.3)',
    '&:hover': {
      background: '#0D47A1',
      boxShadow: '0 6px 20px rgba(21, 101, 192, 0.4)',
    },
    '&:disabled': {
      background: 'rgba(0, 0, 0, 0.15)',
      boxShadow: 'none',
    },
  } as const;

  const glassTextButtonSx = {
    textTransform: 'none',
    color: 'rgba(10, 25, 41, 0.6)',
    '&:hover': { background: 'rgba(255, 255, 255, 0.2)' },
  } as const;

  const glassAlertSx = {
    mb: 2,
    borderRadius: '12px',
    backdropFilter: 'blur(10px)',
  } as const;

  const glassPinInputSx = {
    mb: 2,
    textAlign: 'center',
    fontSize: '1.5rem',
    letterSpacing: '0.5rem',
    color: '#0a1929',
    background: 'rgba(255, 255, 255, 0.9)',
    borderRadius: '12px',
    px: 2,
    py: 1,
    '&:before': { display: 'none' },
    '&:after': { borderBottomColor: '#1565C0' },
    '& input': { color: '#0a1929', textAlign: 'center' },
    '& input::placeholder': { color: 'rgba(10, 25, 41, 0.35)' },
  } as const;

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Premium dark gradient — deep navy to blue
        background: 'linear-gradient(160deg, #0a1929 0%, #0d2847 40%, #0a1929 100%)',
        p: 2,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle radial glow — top center, like a soft spotlight */}
      <Box
        sx={{
          position: 'absolute',
          top: '-20%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(21, 101, 192, 0.15) 0%, rgba(21, 101, 192, 0) 60%)',
          filter: 'blur(40px)',
        }}
      />
      {/* Subtle teal glow — bottom right */}
      <Box
        sx={{
          position: 'absolute',
          bottom: '-15%',
          right: '-10%',
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0, 105, 92, 0.12) 0%, rgba(0, 105, 92, 0) 60%)',
          filter: 'blur(40px)',
        }}
      />

      {/* Frosted glass login card */}
      <Card
        sx={{
          maxWidth: 420,
          width: '100%',
          // Frosted glass — 70% opaque so blobs tint through subtly
          background: 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(30px) saturate(150%)',
          WebkitBackdropFilter: 'blur(30px) saturate(150%)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          borderRadius: '24px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.5)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <CardContent sx={{ p: 4 }}>
          {/* Logo + title */}
          <Box sx={{ textAlign: 'center', mb: 3, animation: fadeAnim }}>
            <Box
              component="img"
              src={logoUrl || '/favicon-192.png'}
              alt="Logo"
              sx={{
                width: 64,
                height: 64,
                borderRadius: '14px',
                mb: 2,
                objectFit: 'contain',
              }}
            />
            <Typography variant="h5" align="center" gutterBottom fontWeight={700} sx={{ color: '#0a1929', letterSpacing: '-0.5px' }}>
              Hospital Construction ERP
            </Typography>
            <Typography variant="body2" align="center" sx={{ color: 'rgba(10, 25, 41, 0.6)' }}>
              Sign in to manage your project
            </Typography>
          </Box>

          {/* Sign In / Sign Up toggle — Apple segmented control style */}
          <Box
            sx={{
              display: 'flex',
              p: 0.5,
              mb: 3,
              borderRadius: 3,
              background: 'rgba(10, 25, 41, 0.08)',
            }}
          >
            <Box
              onClick={() => { setMode('signin'); setStep('phone'); setPin(''); setOtp(''); setError(''); }}
              sx={{
                flex: 1,
                textAlign: 'center',
                py: 1,
                borderRadius: 2,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
                transition: 'all 0.2s',
                color: mode === 'signin' ? '#0a1929' : 'rgba(10, 25, 41, 0.5)',
                background: mode === 'signin' ? '#fff' : 'transparent',
                boxShadow: mode === 'signin' ? '0 2px 8px rgba(0, 0, 0, 0.15)' : 'none',
              }}
            >
              Sign In
            </Box>
            <Box
              onClick={() => { setMode('signup'); setStep('phone'); setPin(''); setOtp(''); setError(''); }}
              sx={{
                flex: 1,
                textAlign: 'center',
                py: 1,
                borderRadius: 2,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
                transition: 'all 0.2s',
                color: mode === 'signup' ? '#0a1929' : 'rgba(10, 25, 41, 0.5)',
                background: mode === 'signup' ? '#fff' : 'transparent',
                boxShadow: mode === 'signup' ? '0 2px 8px rgba(0, 0, 0, 0.15)' : 'none',
              }}
            >
              Sign Up
            </Box>
          </Box>

          <div id="recaptcha-container" />

          {error && (
            <Alert severity="error" sx={glassAlertSx} onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          {/* Step: Phone entry */}
          {step === 'phone' && (
            <Box sx={{ animation: stepFadeAnim }}>
              {mode === 'signup' && (
                <TextField
                  fullWidth
                  label="Full Name"
                  placeholder="Enter your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  sx={glassInputSx}
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
                sx={glassInputSx}
              />
              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={handleCheckPhone}
                disabled={loading || phone.length !== 10 || (mode === 'signup' && !name.trim())}
                sx={glassButtonSx}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Continue'}
              </Button>
            </Box>
          )}

          {/* Step: PIN entry (returning user) */}
          {step === 'pin' && (
            <Box sx={{ animation: stepFadeAnim }}>
              <Alert severity="info" sx={glassAlertSx}>
                Welcome back! Enter your 4-digit PIN to sign in.
              </Alert>
              <Typography variant="body2" sx={{ mb: 1, color: 'rgba(10, 25, 41, 0.7)' }}>
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
                sx={glassPinInputSx}
                inputProps={{ maxLength: 4, style: { textAlign: 'center' } }}
                endAdornment={
                  <MuiInputAdornment position="end">
                    <IconButton onClick={() => setShowPin(!showPin)} edge="end" sx={{ color: 'rgba(10, 25, 41, 0.5)' }}>
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
                sx={glassButtonSx}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Sign In'}
              </Button>
              <Button
                fullWidth
                variant="text"
                sx={{ mt: 1, ...glassTextButtonSx }}
                onClick={() => { setStep('phone'); setPin(''); setError(''); }}
              >
                Use a different phone number
              </Button>
              <Button
                fullWidth
                variant="text"
                sx={{ mt: 0.5, ...glassTextButtonSx }}
                onClick={() => { setStep('otp'); setError(''); }}
              >
                Forgot PIN? Verify with OTP
              </Button>
            </Box>
          )}

          {/* Step: OTP entry */}
          {step === 'otp' && (
            <Box sx={{ animation: stepFadeAnim }}>
              <Alert severity="info" sx={glassAlertSx}>
                OTP sent to +91 {phone}. Enter the 6-digit code to verify your identity.
              </Alert>
              <TextField
                fullWidth
                label="Enter OTP"
                placeholder="6-digit code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                sx={glassInputSx}
                inputProps={{ maxLength: 6 }}
              />
              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={handleVerifyOtp}
                disabled={loading || otp.length < 4}
                sx={glassButtonSx}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Verify OTP'}
              </Button>
              <Button
                fullWidth
                variant="text"
                sx={{ mt: 1, ...glassTextButtonSx }}
                onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
              >
                Change phone number
              </Button>
              {isDevMode && (
                <Alert severity="info" sx={{ ...glassAlertSx, mb: 0, mt: 2 }}>
                  Dev mode: use OTP <strong>1234</strong>
                </Alert>
              )}
            </Box>
          )}

          {/* Step: Set PIN (after OTP verification) */}
          {step === 'setPin' && (
            <Box sx={{ animation: stepFadeAnim }}>
              <Alert severity="success" sx={glassAlertSx}>
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
                sx={glassPinInputSx}
                inputProps={{ maxLength: 4, style: { textAlign: 'center' } }}
                endAdornment={
                  <MuiInputAdornment position="end">
                    <IconButton onClick={() => setShowPin(!showPin)} edge="end" sx={{ color: 'rgba(10, 25, 41, 0.5)' }}>
                      {showPin ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </MuiInputAdornment>
                }
              />
              <Typography variant="caption" sx={{ display: 'block', mb: 2, color: 'rgba(10, 25, 41, 0.5)' }}>
                You'll use this PIN with your phone number to sign in — no OTP needed.
              </Typography>
              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={handleSetPin}
                disabled={loading || pin.length !== 4}
                sx={glassButtonSx}
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

