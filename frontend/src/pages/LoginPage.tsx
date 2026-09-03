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
import { Visibility, VisibilityOff, LocalHospital } from '@mui/icons-material';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { useNavigate, Navigate } from 'react-router-dom';
import { auth, isConfigured } from '../config/firebase';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';

// ── Animations ──────────────────────────────────────────────
const blobMove1 = keyframes`
  0%, 100% { transform: translate(0, 0) scale(1); }
  33%      { transform: translate(40px, -30px) scale(1.1); }
  66%      { transform: translate(-20px, 20px) scale(0.95); }
`;

const blobMove2 = keyframes`
  0%, 100% { transform: translate(0, 0) scale(1); }
  33%      { transform: translate(-30px, 40px) scale(1.05); }
  66%      { transform: translate(25px, -15px) scale(1.1); }
`;

const blobMove3 = keyframes`
  0%, 100% { transform: translate(0, 0) scale(1); }
  50%      { transform: translate(20px, 30px) scale(1.15); }
`;

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

  const fadeAnim = `${fadeInUp} 0.6s ease-out`;
  const stepFadeAnim = `${fadeInUp} 0.4s ease-out`;
  const blob1Anim = `${blobMove1} 12s ease-in-out infinite`;
  const blob2Anim = `${blobMove2} 14s ease-in-out infinite`;
  const blob3Anim = `${blobMove3} 10s ease-in-out infinite`;
  const blob4Anim = `${blobMove1} 16s ease-in-out infinite`;

  // Apple-style shared input/button styles
  const glassInputSx = {
    mb: 2,
    '& .MuiOutlinedInput-root': {
      borderRadius: '12px',
      background: 'rgba(255, 255, 255, 0.95)',
      color: '#1a1a2e',
      '& fieldset': { borderColor: 'rgba(0, 0, 0, 0.15)' },
      '&:hover fieldset': { borderColor: 'rgba(123, 104, 238, 0.4)' },
      '&.Mui-focused fieldset': { borderColor: 'rgba(123, 104, 238, 0.7)', borderWidth: 2 },
      '& input': { color: '#1a1a2e' },
      '& input::placeholder': { color: 'rgba(26, 26, 46, 0.4)' },
    },
    '& .MuiInputLabel-root': { color: 'rgba(26, 26, 46, 0.6)' },
    '& .MuiInputLabel-root.Mui-focused': { color: '#7B68EE' },
    '& .MuiInputAdornment-root': { color: 'rgba(26, 26, 46, 0.5)' },
  } as const;

  const glassButtonSx = {
    borderRadius: '12px',
    textTransform: 'none',
    fontWeight: 600,
    fontSize: '1rem',
    py: 1.2,
    background: 'linear-gradient(135deg, #FF6B6B, #7B68EE)',
    boxShadow: '0 4px 16px rgba(123, 104, 238, 0.35)',
    '&:hover': {
      background: 'linear-gradient(135deg, #FF5757, #6B5EEE)',
      boxShadow: '0 6px 20px rgba(123, 104, 238, 0.45)',
    },
    '&:disabled': {
      background: 'rgba(0, 0, 0, 0.15)',
      boxShadow: 'none',
    },
  } as const;

  const glassTextButtonSx = {
    textTransform: 'none',
    color: 'rgba(26, 26, 46, 0.6)',
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
    color: '#1a1a2e',
    background: 'rgba(255, 255, 255, 0.9)',
    borderRadius: '12px',
    px: 2,
    py: 1,
    '&:before': { display: 'none' },
    '&:after': { borderBottomColor: 'rgba(123, 104, 238, 0.7)' },
    '& input': { color: '#1a1a2e', textAlign: 'center' },
    '& input::placeholder': { color: 'rgba(26, 26, 46, 0.35)' },
  } as const;

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Deep base color
        background: '#1a1a2e',
        p: 2,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Vibrant animated color blobs — Apple Sonoma style */}
      <Box
        sx={{
          position: 'absolute',
          top: '-10%',
          left: '-5%',
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: 'radial-gradient(circle, #FF6B6B 0%, #FF6B6B00 70%)',
          filter: 'blur(60px)',
          animation: blob1Anim,
          opacity: 0.8,
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: '30%',
          right: '-10%',
          width: 450,
          height: 450,
          borderRadius: '50%',
          background: 'radial-gradient(circle, #7B68EE 0%, #7B68EE00 70%)',
          filter: 'blur(60px)',
          animation: blob2Anim,
          opacity: 0.8,
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          bottom: '-15%',
          left: '20%',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, #FFA07A 0%, #FFA07A00 70%)',
          filter: 'blur(60px)',
          animation: blob3Anim,
          opacity: 0.7,
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: '10%',
          left: '40%',
          width: 350,
          height: 350,
          borderRadius: '50%',
          background: 'radial-gradient(circle, #00CED1 0%, #00CED100 70%)',
          filter: 'blur(50px)',
          animation: blob4Anim,
          animationDelay: '2s',
          opacity: 0.6,
        }}
      />

      {/* Apple-style glassmorphism login card */}
      <Card
        sx={{
          maxWidth: 420,
          width: '100%',
          // Frosted glass — more opaque for readability
          background: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          borderTop: '1px solid rgba(255, 255, 255, 0.9)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          borderRadius: '28px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.6)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <CardContent sx={{ p: 4 }}>
          {/* Logo + title */}
          <Box sx={{ textAlign: 'center', mb: 3, animation: fadeAnim }}>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 56,
                height: 56,
                borderRadius: '16px',
                background: 'linear-gradient(135deg, #FF6B6B, #7B68EE)',
                mb: 2,
                boxShadow: '0 4px 16px rgba(123, 104, 238, 0.4)',
              }}
            >
              <LocalHospital sx={{ fontSize: 32, color: '#fff' }} />
            </Box>
            <Typography variant="h5" align="center" gutterBottom fontWeight={700} sx={{ color: '#1a1a2e', letterSpacing: '-0.5px' }}>
              Hospital Construction ERP
            </Typography>
            <Typography variant="body2" align="center" sx={{ color: 'rgba(26, 26, 46, 0.6)' }}>
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
              background: 'rgba(0, 0, 0, 0.08)',
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
                color: mode === 'signin' ? '#1a1a2e' : 'rgba(26, 26, 46, 0.5)',
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
                color: mode === 'signup' ? '#1a1a2e' : 'rgba(26, 26, 46, 0.5)',
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
              <Typography variant="body2" sx={{ mb: 1, color: 'rgba(26, 26, 46, 0.7)' }}>
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
                    <IconButton onClick={() => setShowPin(!showPin)} edge="end" sx={{ color: 'rgba(26, 26, 46, 0.5)' }}>
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
                    <IconButton onClick={() => setShowPin(!showPin)} edge="end" sx={{ color: 'rgba(26, 26, 46, 0.5)' }}>
                      {showPin ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </MuiInputAdornment>
                }
              />
              <Typography variant="caption" sx={{ display: 'block', mb: 2, color: 'rgba(26, 26, 46, 0.5)' }}>
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
