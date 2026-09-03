import { useState, useCallback } from 'react';
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
import { Visibility, VisibilityOff, LocalHospital, Construction } from '@mui/icons-material';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { useNavigate, Navigate } from 'react-router-dom';
import { auth, isConfigured } from '../config/firebase';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';

// ── Animations ──────────────────────────────────────────────
const gradientShift = keyframes`
  0%   { background-position:   0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position:   0% 50%; }
`;

const floatUp = keyframes`
  0%   { transform: translateY(0)     rotate(0deg);   opacity: 0.7; }
  50%  { transform: translateY(-30px) rotate(10deg);  opacity: 0.4; }
  100% { transform: translateY(0)     rotate(0deg);   opacity: 0.7; }
`;

const fadeInUp = keyframes`
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0);    }
`;

const pulseGlow = keyframes`
  0%, 100% { box-shadow: 0 0 20px rgba(255,255,255,0.1); }
  50%      { box-shadow: 0 0 40px rgba(255,255,255,0.2); }
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

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Animated gradient — 4 colors slowly shifting
        background: 'linear-gradient(-45deg, #0D47A1, #1565C0, #00695C, #1B5E20)',
        backgroundSize: '400% 400%',
        animation: `${gradientShift} 15s ease infinite`,
        p: 2,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Floating decorative icons */}
      <Construction
        sx={{
          position: 'absolute',
          top: '12%',
          left: '8%',
          fontSize: 80,
          color: 'rgba(255,255,255,0.08)',
          animation: `${floatUp} 6s ease-in-out infinite`,
        }}
      />
      <LocalHospital
        sx={{
          position: 'absolute',
          bottom: '15%',
          right: '10%',
          fontSize: 100,
          color: 'rgba(255,255,255,0.07)',
          animation: `${floatUp} 8s ease-in-out infinite`,
          animationDelay: '1s',
        }}
      />
      <Construction
        sx={{
          position: 'absolute',
          top: '60%',
          left: '15%',
          fontSize: 60,
          color: 'rgba(255,255,255,0.06)',
          animation: `${floatUp} 7s ease-in-out infinite`,
          animationDelay: '2s',
        }}
      />
      <LocalHospital
        sx={{
          position: 'absolute',
          top: '20%',
          right: '18%',
          fontSize: 50,
          color: 'rgba(255,255,255,0.05)',
          animation: `${floatUp} 9s ease-in-out infinite`,
          animationDelay: '0.5s',
        }}
      />

      {/* Glassmorphism login card */}
      <Card
        sx={{
          maxWidth: 440,
          width: '100%',
          // Frosted glass effect
          background: 'rgba(255, 255, 255, 0.12)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.18)',
          borderRadius: 4,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          animation: `${pulseGlow} 4s ease-in-out infinite`,
          position: 'relative',
          zIndex: 1,
        }}
      >
        <CardContent sx={{ p: 4 }}>
          {/* Logo + title */}
          <Box sx={{ textAlign: 'center', mb: 3, animation: `${fadeInUp} 0.6s ease-out` }}>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.15)',
                mb: 1.5,
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              <LocalHospital sx={{ fontSize: 36, color: '#fff' }} />
            </Box>
            <Typography variant="h5" align="center" gutterBottom fontWeight={700} sx={{ color: '#fff' }}>
              Hospital Construction ERP
            </Typography>
            <Typography variant="body2" align="center" sx={{ color: 'rgba(255,255,255,0.7)' }}>
              Sign in to manage your project
            </Typography>
          </Box>

          {/* Sign In / Sign Up toggle */}
          <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
            <Button
              fullWidth
              variant={mode === 'signin' ? 'contained' : 'outlined'}
              onClick={() => { setMode('signin'); setStep('phone'); setPin(''); setOtp(''); setError(''); }}
              sx={{
                ...(mode !== 'signin' && {
                  borderColor: 'rgba(255,255,255,0.3)',
                  color: '#fff',
                  '&:hover': { borderColor: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.05)' },
                }),
              }}
            >
              Sign In
            </Button>
            <Button
              fullWidth
              variant={mode === 'signup' ? 'contained' : 'outlined'}
              onClick={() => { setMode('signup'); setStep('phone'); setPin(''); setOtp(''); setError(''); }}
              sx={{
                ...(mode !== 'signup' && {
                  borderColor: 'rgba(255,255,255,0.3)',
                  color: '#fff',
                  '&:hover': { borderColor: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.05)' },
                }),
              }}
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
            <Box sx={{ animation: `${fadeInUp} 0.4s ease-out` }}>
              {mode === 'signup' && (
                <TextField
                  fullWidth
                  label="Full Name"
                  placeholder="Enter your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  sx={{
                    mb: 2,
                    '& .MuiOutlinedInput-root': {
                      background: 'rgba(255,255,255,0.9)',
                    },
                  }}
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
                sx={{
                  mb: 2,
                  '& .MuiOutlinedInput-root': {
                    background: 'rgba(255,255,255,0.9)',
                  },
                }}
              />
              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={handleCheckPhone}
                disabled={loading || phone.length !== 10 || (mode === 'signup' && !name.trim())}
                sx={{
                  background: 'rgba(255,255,255,0.25)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  '&:hover': { background: 'rgba(255,255,255,0.35)' },
                  '&:disabled': { background: 'rgba(255,255,255,0.1)' },
                }}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Continue'}
              </Button>
            </Box>
          )}

          {/* Step: PIN entry (returning user) */}
          {step === 'pin' && (
            <Box sx={{ animation: `${fadeInUp} 0.4s ease-out` }}>
              <Alert severity="info" sx={{ mb: 2, background: 'rgba(33,150,243,0.15)', color: '#fff', '& .MuiAlert-icon': { color: '#90CAF9' } }}>
                Welcome back! Enter your 4-digit PIN to sign in.
              </Alert>
              <Typography variant="body2" sx={{ mb: 1, color: 'rgba(255,255,255,0.8)' }}>
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
                sx={{
                  mb: 2,
                  textAlign: 'center',
                  fontSize: '1.5rem',
                  letterSpacing: '0.5rem',
                  color: '#fff',
                  '&:before': { borderBottomColor: 'rgba(255,255,255,0.3)' },
                  '&:hover:not(.Mui-disabled):before': { borderBottomColor: 'rgba(255,255,255,0.5)' },
                  '& input': { color: '#fff', textAlign: 'center' },
                }}
                inputProps={{ maxLength: 4, style: { textAlign: 'center' } }}
                endAdornment={
                  <MuiInputAdornment position="end">
                    <IconButton onClick={() => setShowPin(!showPin)} edge="end" sx={{ color: 'rgba(255,255,255,0.7)' }}>
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
                sx={{
                  background: 'rgba(255,255,255,0.25)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  '&:hover': { background: 'rgba(255,255,255,0.35)' },
                  '&:disabled': { background: 'rgba(255,255,255,0.1)' },
                }}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Sign In'}
              </Button>
              <Button
                fullWidth
                variant="text"
                sx={{ mt: 1, color: 'rgba(255,255,255,0.7)', '&:hover': { background: 'rgba(255,255,255,0.05)' } }}
                onClick={() => { setStep('phone'); setPin(''); setError(''); }}
              >
                Use a different phone number
              </Button>
              <Button
                fullWidth
                variant="text"
                sx={{ mt: 0.5, color: 'rgba(255,255,255,0.7)', '&:hover': { background: 'rgba(255,255,255,0.05)' } }}
                onClick={() => { setStep('otp'); setError(''); }}
              >
                Forgot PIN? Verify with OTP
              </Button>
            </Box>
          )}

          {/* Step: OTP entry */}
          {step === 'otp' && (
            <Box sx={{ animation: `${fadeInUp} 0.4s ease-out` }}>
              <Alert severity="info" sx={{ mb: 2, background: 'rgba(33,150,243,0.15)', color: '#fff', '& .MuiAlert-icon': { color: '#90CAF9' } }}>
                OTP sent to +91 {phone}. Enter the 6-digit code to verify your identity.
              </Alert>
              <TextField
                fullWidth
                label="Enter OTP"
                placeholder="6-digit code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                sx={{
                  mb: 2,
                  '& .MuiOutlinedInput-root': {
                    background: 'rgba(255,255,255,0.9)',
                  },
                }}
                inputProps={{ maxLength: 6 }}
              />
              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={handleVerifyOtp}
                disabled={loading || otp.length < 4}
                sx={{
                  background: 'rgba(255,255,255,0.25)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  '&:hover': { background: 'rgba(255,255,255,0.35)' },
                  '&:disabled': { background: 'rgba(255,255,255,0.1)' },
                }}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Verify OTP'}
              </Button>
              <Button
                fullWidth
                variant="text"
                sx={{ mt: 1, color: 'rgba(255,255,255,0.7)', '&:hover': { background: 'rgba(255,255,255,0.05)' } }}
                onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
              >
                Change phone number
              </Button>
              {isDevMode && (
                <Alert severity="info" sx={{ mt: 2, background: 'rgba(255,255,255,0.1)', color: '#fff', '& .MuiAlert-icon': { color: '#FFF176' } }}>
                  Dev mode: use OTP <strong>1234</strong>
                </Alert>
              )}
            </Box>
          )}

          {/* Step: Set PIN (after OTP verification) */}
          {step === 'setPin' && (
            <Box sx={{ animation: `${fadeInUp} 0.4s ease-out` }}>
              <Alert severity="success" sx={{ mb: 2, background: 'rgba(76,175,80,0.15)', color: '#fff', '& .MuiAlert-icon': { color: '#A5D6A7' } }}>
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
                sx={{
                  mb: 2,
                  textAlign: 'center',
                  fontSize: '1.5rem',
                  letterSpacing: '0.5rem',
                  color: '#fff',
                  '&:before': { borderBottomColor: 'rgba(255,255,255,0.3)' },
                  '&:hover:not(.Mui-disabled):before': { borderBottomColor: 'rgba(255,255,255,0.5)' },
                  '& input': { color: '#fff', textAlign: 'center' },
                }}
                inputProps={{ maxLength: 4, style: { textAlign: 'center' } }}
                endAdornment={
                  <MuiInputAdornment position="end">
                    <IconButton onClick={() => setShowPin(!showPin)} edge="end" sx={{ color: 'rgba(255,255,255,0.7)' }}>
                      {showPin ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </MuiInputAdornment>
                }
              />
              <Typography variant="caption" sx={{ display: 'block', mb: 2, color: 'rgba(255,255,255,0.6)' }}>
                You'll use this PIN with your phone number to sign in — no OTP needed.
              </Typography>
              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={handleSetPin}
                disabled={loading || pin.length !== 4}
                sx={{
                  background: 'rgba(255,255,255,0.25)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  '&:hover': { background: 'rgba(255,255,255,0.35)' },
                  '&:disabled': { background: 'rgba(255,255,255,0.1)' },
                }}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Set PIN & Sign In'}
              </Button>
            </Box>
          )}

          {/* Step: Verifying (loading state) */}
          {step === 'verifying' && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress sx={{ color: '#fff' }} />
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Footer */}
      <Typography
        variant="caption"
        sx={{
          position: 'absolute',
          bottom: 16,
          color: 'rgba(255,255,255,0.5)',
        }}
      >
        © {new Date().getFullYear()} Hospital Construction ERP
      </Typography>
    </Box>
  );
}
