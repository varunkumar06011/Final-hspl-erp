import { useState, useCallback, useEffect, useRef } from 'react';
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
  Checkbox,
  Link as MuiLink,
} from '@mui/material';
import { Business as ProjectIcon, SupportAgent, Visibility, VisibilityOff } from '@mui/icons-material';
import { useNavigate, Navigate, Link as RouterLink } from 'react-router-dom';
import { isConfigured, getFirebase, type FirebaseHandles } from '../config/firebase';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import loginBg from '../login screen.png';
import { useTranslation } from 'react-i18next';
import LanguageToggle from '../components/LanguageToggle';
import type { PublicProject } from '@hospital-erp/shared';

// ── Animations ──────────────────────────────────────────────
const fadeInUp = keyframes`
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0);    }
`;

type Step = 'project' | 'phone' | 'pin' | 'otp' | 'setPin' | 'verifying';
type AuthMode = 'signin' | 'signup';

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('91')) return `+${digits}`;
  if (raw.startsWith('+')) return raw.replace(/\s/g, '');
  return `+91${digits}`;
}

const LAST_PROJECT_KEY = 'lastProjectId';

function readLastProjectId(): string | null {
  try { return localStorage.getItem(LAST_PROJECT_KEY); } catch { return null; }
}

function saveLastProjectId(id: string) {
  try { localStorage.setItem(LAST_PROJECT_KEY, id); } catch { /* storage unavailable (iOS) */ }
}

export default function LoginPage() {
  const { t } = useTranslation();
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
  // Projects offered on the login page. null = still loading. If the list cannot be
  // fetched we fall back to [] and sign in to the user's default project, as before.
  const [projects, setProjects] = useState<PublicProject[] | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  // Legal consent — must be ticked before any sign-in/sign-up action.
  const [agreed, setAgreed] = useState(false);
  const { setUser, setToken, isAuthenticated } = useAuthStore();
  const navigate = useNavigate();

  // Refs for scrolling inputs above the on-screen keyboard on mobile
  const pinInputRef = useRef<HTMLDivElement>(null);
  const otpInputRef = useRef<HTMLDivElement>(null);

  // When the step switches to pin/setPin/otp, scroll the input into view so
  // it isn't covered by the mobile on-screen keyboard. Uses
  // scrollIntoView({ block: 'center' }) which works even when the visual
  // viewport has been shrunk by the keyboard.
  useEffect(() => {
    if (step === 'pin' || step === 'setPin') {
      const t = setTimeout(() => {
        pinInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      return () => clearTimeout(t);
    }
    if (step === 'otp') {
      const t = setTimeout(() => {
        otpInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [step]);

  // Keep the active input visible when the mobile keyboard opens/closes.
  // window.innerHeight shrinks on older browsers; visualViewport covers
  // modern ones. We re-scroll the relevant input into view.
  useEffect(() => {
    const handler = () => {
      if (step === 'pin' || step === 'setPin') {
        pinInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (step === 'otp') {
        otpInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    if (typeof window !== 'undefined' && (window as any).visualViewport) {
      (window as any).visualViewport.addEventListener('resize', handler);
      return () => (window as any).visualViewport.removeEventListener('resize', handler);
    }
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [step]);

  // Which projects can be entered (public endpoint, no auth needed). With a single
  // project there is nothing to choose; with several, the user picks first.
  useEffect(() => {
    let cancelled = false;
    api.get('/projects/public')
      .then((res) => {
        if (cancelled) return;
        const list: PublicProject[] = res.data?.data ?? [];
        setProjects(list);
        if (list.length === 1) {
          setSelectedProjectId(list[0].id);
        } else if (list.length > 1) {
          setStep('project');
        }
      })
      .catch(() => {
        // Could not load the list — carry on without a project choice.
        if (!cancelled) setProjects([]);
      });
    return () => { cancelled = true; };
  }, []);

  // Fetch the chosen project's logo (public endpoint, no auth needed)
  useEffect(() => {
    if (projects === null) return;
    if (projects.length > 1 && !selectedProjectId) {
      setLogoUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    api.get('/settings/logo', {
      responseType: 'blob',
      params: selectedProjectId ? { projectId: selectedProjectId } : undefined,
    })
      .then((res) => {
        if (cancelled) return;
        const rawMime = res.headers['content-type'];
        const mime = typeof rawMime === 'string' ? rawMime : 'image/png';
        objectUrl = URL.createObjectURL(new Blob([res.data], { type: mime }));
        setLogoUrl(objectUrl);
      })
      .catch(() => {
        // No logo uploaded — fallback to favicon
        if (!cancelled) setLogoUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projects, selectedProjectId]);

  const selectedProject = projects?.find((p) => p.id === selectedProjectId) ?? null;

  const chooseProject = useCallback((id: string) => {
    setSelectedProjectId(id);
    saveLastProjectId(id);
    setError('');
    setStep('phone');
  }, []);

  const setupRecaptcha = useCallback((fb: FirebaseHandles) => {
    // Reuse the existing verifier — creating a second RecaptchaVerifier on
    // the same container throws "reCAPTCHA has already been rendered".
    if (!(window as any).recaptchaVerifier) {
      (window as any).recaptchaVerifier = new fb.RecaptchaVerifier(
        fb.auth,
        'recaptcha-container',
        { size: 'invisible' }
      );
    }
    return (window as any).recaptchaVerifier;
  }, []);

  const resetRecaptcha = useCallback(() => {
    if ((window as any).recaptchaVerifier) {
      try {
        (window as any).recaptchaVerifier.clear();
      } catch {
        // ignore
      }
      (window as any).recaptchaVerifier = null;
    }
    const container = document.getElementById('recaptcha-container');
    if (container) container.innerHTML = '';
  }, []);

  // Step 2b: Send OTP via Firebase
  const sendOtp = useCallback(async () => {
    setLoading(true);
    try {
      const fb = await getFirebase();
      if (!fb) {
        // Dev mode — skip OTP, go straight to setPin
        setStep('setPin');
        return;
      }
      const appVerifier = setupRecaptcha(fb);
      const result = await fb.signInWithPhoneNumber(fb.auth, formatPhone(phone), appVerifier);
      setConfirmationResult(result);
      setStep('otp');
    } catch (err: unknown) {
      resetRecaptcha();
      setError(extractErrorMessage(err));
      setStep('phone');
    } finally {
      setLoading(false);
    }
  }, [phone, setupRecaptcha, resetRecaptcha]);

  // Step 1: Check if phone has a PIN set
  const handleCheckPhone = useCallback(async () => {
    if (!agreed) {
      setError(t('login.agreeRequired'));
      return;
    }
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
  }, [phone, mode, sendOtp, agreed, t]);

  // Step 2a: Login with PIN
  const handlePinLogin = useCallback(async () => {
    if (!agreed) {
      setError(t('login.agreeRequired'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      const formattedPhone = formatPhone(phone);
      const response = await api.post('/auth/pin-login', { phone: formattedPhone, pin, agreedToTerms: agreed, projectId: selectedProjectId ?? undefined });
      setToken(response.data.token);
      setUser(response.data.user);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [phone, pin, agreed, selectedProjectId, setToken, setUser, navigate, t]);

  // Step 2c: Verify OTP
  const handleVerifyOtp = useCallback(async () => {
    setError('');
    setLoading(true);
    setStep('verifying');
    try {
      const formattedPhone = formatPhone(phone);

      // Dev mode fallback
      if (!isConfigured || otp === '1234') {
        if (otp === '1234') {
          if (mode === 'signup') {
            // Dev signup: create user via register endpoint (won't have real Firebase token,
            // so use dev-login which creates/returns the user)
            try {
              await api.post('/auth/dev-login', { phone: formattedPhone, name: name.trim() || undefined, projectId: selectedProjectId ?? undefined });
            } catch {
              // If dev-login fails (user doesn't exist), we can't create in dev mode without Firebase
              // Just proceed to setPin — set-pin endpoint will create the PIN if user exists
            }
          } else {
            await api.post('/auth/dev-login', { phone: formattedPhone, name: name.trim() || undefined, projectId: selectedProjectId ?? undefined });
          }
          setStep('setPin');
          return;
        }
      }

      if (!confirmationResult) {
        throw new Error(t('login.noConfirmation'));
      }
      const userCredential = await confirmationResult.confirm(otp);
      const idToken = await userCredential.user.getIdToken();

      // Verify or register with backend
      const response = mode === 'signup'
        ? await api.post('/auth/register', { idToken, name: name.trim(), agreedToTerms: agreed, projectId: selectedProjectId ?? undefined })
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
  }, [confirmationResult, otp, phone, name, mode, agreed, selectedProjectId, setUser, t]);

  // Step 3: Set PIN (after OTP verification)
  const handleSetPin = useCallback(async () => {
    if (!agreed) {
      setError(t('login.agreeRequired'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      const formattedPhone = formatPhone(phone);
      const response = await api.post('/auth/set-pin', { phone: formattedPhone, pin, agreedToTerms: agreed, projectId: selectedProjectId ?? undefined });
      setToken(response.data.token);
      setUser(response.data.user);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [phone, pin, agreed, selectedProjectId, setToken, setUser, navigate, t]);

  if (isAuthenticated()) {
    return <Navigate to="/" replace />;
  }

  const isDevMode = !isConfigured;

  const fadeAnim = `${fadeInUp} 0.6s ease-out`;
  const stepFadeAnim = `${fadeInUp} 0.4s ease-out`;

  // Apple-style shared input/button styles
  const glassInputSx = {
    mb: { xs: 2, sm: 3 },
    '& .MuiOutlinedInput-root': {
      borderRadius: '14px',
      background: 'rgba(255, 255, 255, 0.95)',
      color: '#0a1929',
      minHeight: { xs: 56, sm: 72 },
      fontSize: { xs: '1rem', sm: '1.25rem' },
      '& fieldset': { borderColor: 'rgba(0, 0, 0, 0.15)' },
      '&:hover fieldset': { borderColor: 'rgba(21, 101, 192, 0.4)' },
      '&.Mui-focused fieldset': { borderColor: '#1565C0', borderWidth: 2 },
      '& input': { color: '#0a1929', py: { xs: 1.5, sm: 2 } },
      '& input::placeholder': { color: 'rgba(10, 25, 41, 0.4)' },
    },
    '& .MuiInputLabel-root': { color: 'rgba(10, 25, 41, 0.6)', fontSize: { xs: '0.95rem', sm: '1.1rem' } },
    '& .MuiInputLabel-root.Mui-focused': { color: '#1565C0' },
    '& .MuiInputAdornment-root': { color: 'rgba(10, 25, 41, 0.5)' },
  } as const;

  const glassButtonSx = {
    borderRadius: '14px',
    textTransform: 'none',
    fontWeight: 600,
    fontSize: { xs: '1.05rem', sm: '1.25rem' },
    py: { xs: 1.5, sm: 2 },
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

  // Static label rendered above inputs — a floating MUI label overlaps the
  // fieldset border and shows a line through the text on mobile
  const fieldLabelSx = {
    display: 'block',
    mb: 0.75,
    color: 'rgba(10, 25, 41, 0.6)',
    fontSize: '0.85rem',
    fontWeight: 600,
  } as const;

  const glassPinInputSx = {
    mb: { xs: 2, sm: 3 },
    textAlign: 'center',
    fontSize: { xs: '1.75rem', sm: '2.5rem' },
    letterSpacing: { xs: '0.5rem', sm: '1rem' },
    color: '#0a1929',
    background: 'rgba(255, 255, 255, 0.9)',
    borderRadius: '14px',
    px: 2,
    py: { xs: 1.5, sm: 2 },
    '&:before': { display: 'none' },
    '&:after': { borderBottomColor: '#1565C0' },
    '& input': { color: '#0a1929', textAlign: 'center', fontSize: { xs: '1.75rem', sm: '2.5rem' } },
    '& input::placeholder': { color: 'rgba(10, 25, 41, 0.35)' },
  } as const;

  // Consent checkbox — shown on every step that can lead to a session being
  // issued (phone → OTP, PIN sign-in, set-PIN). RouterLink works in both the
  // web BrowserRouter and the native HashRouter.
  const consentCheckbox = (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
      <Checkbox
        checked={agreed}
        onChange={(e) => setAgreed(e.target.checked)}
        sx={{
          p: 0.5,
          mr: 1,
          mt: -0.25,
          color: 'rgba(10, 25, 41, 0.5)',
          '&.Mui-checked': { color: '#1565C0' },
        }}
      />
      <Typography variant="body2" sx={{ color: 'rgba(10, 25, 41, 0.7)', lineHeight: 1.5 }}>
        {t('login.iAgreeTo')}{' '}
        <MuiLink component={RouterLink} to="/terms" underline="always" sx={{ color: '#1565C0', fontWeight: 600 }}>
          {t('login.terms')}
        </MuiLink>{' '}
        {t('login.and')}{' '}
        <MuiLink component={RouterLink} to="/privacy-policy" underline="always" sx={{ color: '#1565C0', fontWeight: 600 }}>
          {t('login.privacy')}
        </MuiLink>
      </Typography>
    </Box>
  );

  return (
    <Box
      sx={{
        minHeight: { xs: '100dvh', md: '100vh' },
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        alignItems: 'center',
        justifyContent: { xs: 'flex-start', md: 'flex-end' },
        // Dark navy fallback
        backgroundColor: '#0a1929',
        // Premium dark gradient — deep navy to blue (over the background image)
        // Mobile: uniform dark overlay so the centered card stays readable while the full image shows
        // Desktop: lighter on the left so the image/face stays clear; darker on the right behind the card
        backgroundImage: {
          xs: `linear-gradient(180deg, rgba(10, 25, 41, 0.75) 0%, rgba(10, 25, 41, 0.82) 100%), url(${loginBg})`,
          md: `linear-gradient(90deg, rgba(10, 25, 41, 0.25) 0%, rgba(10, 25, 41, 0.45) 45%, rgba(10, 25, 41, 0.82) 70%, rgba(10, 25, 41, 0.92) 100%), url(${loginBg})`,
        },
        backgroundSize: 'cover',
        backgroundPosition: { xs: 'center', md: 'left center' },
        backgroundRepeat: 'no-repeat',
        px: { xs: 1.5, sm: 2 },
        py: { xs: 2, md: 2 },
        pr: { md: 6 },
        position: 'relative',
        overflowX: 'hidden',
        // On phones the card can exceed the viewport — allow vertical scroll
        // instead of clipping (the old overflow:hidden cut off the Continue button)
        overflowY: { xs: 'auto', md: 'hidden' },
      }}
    >
      {/* Language toggle — top right, above the card */}
      <Box sx={{ position: 'absolute', top: 12, right: 12, zIndex: 2 }}>
        <LanguageToggle onDark />
      </Box>

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
          maxWidth: { xs: '100%', sm: 560 },
          width: '100%',
          // Column layout on mobile: auto margins centre the card when it fits
          // and let it top-align + scroll when it overflows the viewport
          my: { xs: 'auto', md: 0 },
          mx: { xs: 0, sm: 2 },
          // Frosted glass — 70% opaque so blobs tint through subtly
          background: 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(30px) saturate(150%)',
          WebkitBackdropFilter: 'blur(30px) saturate(150%)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          borderRadius: { xs: '20px', sm: '24px' },
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.5)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <CardContent sx={{ p: { xs: 2.5, sm: 6 }, '&:last-child': { pb: { xs: 2.5, sm: 6 } } }}>
          {/* Logo + title */}
          <Box sx={{ textAlign: 'center', mb: { xs: 3, sm: 5 }, animation: fadeAnim }}>
            <Box
              component="img"
              src={logoUrl || '/logo.png'}
              alt="Logo"
              sx={{
                width: { xs: 72, sm: 112 },
                height: { xs: 72, sm: 112 },
                borderRadius: '22px',
                mb: { xs: 1.5, sm: 3 },
                objectFit: 'contain',
              }}
            />
            <Typography variant="h4" align="center" gutterBottom fontWeight={700} sx={{ color: '#0a1929', letterSpacing: '-0.5px', fontSize: { xs: '1.45rem', sm: '2rem' } }}>
              {t('app.title')}
            </Typography>
            <Typography variant="h6" align="center" sx={{ color: 'rgba(10, 25, 41, 0.6)', fontWeight: 400, fontSize: { xs: '0.95rem', sm: '1.25rem' } }}>
              {t('login.subtitle')}
            </Typography>
          </Box>

          {/* While the project list loads */}
          {projects === null && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 3 }}>
              <CircularProgress size={22} />
              <Typography variant="body2" sx={{ color: 'rgba(10, 25, 41, 0.6)' }}>{t('login.loadingProjects')}</Typography>
            </Box>
          )}

          {/* Step: choose which project to sign in to (first step when there are several) */}
          {step === 'project' && projects && (
            <Box sx={{ animation: stepFadeAnim }}>
              <Typography sx={{ fontWeight: 700, color: '#0a1929', fontSize: { xs: '1.1rem', sm: '1.35rem' }, mb: 0.5 }}>
                {t('login.chooseProject')}
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(10, 25, 41, 0.6)', mb: 2 }}>
                {t('login.chooseProjectHint')}
              </Typography>
              <Box sx={{ display: 'grid', gap: 1.5 }}>
                {projects.map((p) => {
                  const isLast = readLastProjectId() === p.id;
                  return (
                    <Button
                      key={p.id}
                      fullWidth
                      variant={isLast ? 'contained' : 'outlined'}
                      onClick={() => chooseProject(p.id)}
                      startIcon={<ProjectIcon />}
                      sx={{
                        ...(isLast ? glassButtonSx : {}),
                        justifyContent: 'flex-start',
                        textTransform: 'none',
                        borderRadius: '14px',
                        py: { xs: 1.5, sm: 2 },
                        fontWeight: 600,
                        fontSize: { xs: '1rem', sm: '1.15rem' },
                        ...(!isLast && { color: '#0a1929', borderColor: 'rgba(10, 25, 41, 0.25)', background: 'rgba(255,255,255,0.7)' }),
                      }}
                    >
                      {p.name}
                    </Button>
                  );
                })}
              </Box>
            </Box>
          )}

          {/* Chosen project — only shown when there is a choice to change */}
          {step !== 'project' && selectedProject && projects && projects.length > 1 && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                mb: 2,
                px: 1.5,
                py: 1,
                borderRadius: 2,
                background: 'rgba(21, 101, 192, 0.1)',
              }}
            >
              <Typography variant="body2" sx={{ color: '#0a1929', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t('login.signingInTo')} <strong>{selectedProject.name}</strong>
              </Typography>
              <Button
                size="small"
                sx={{ ...glassTextButtonSx, flexShrink: 0, color: '#1565C0', fontWeight: 600 }}
                onClick={() => { setStep('project'); setPin(''); setOtp(''); setError(''); }}
              >
                {t('login.changeProject')}
              </Button>
            </Box>
          )}

          {/* Sign In / Sign Up toggle — Apple segmented control style */}
          {step !== 'project' && projects !== null && (
          <Box
            sx={{
              display: 'flex',
              p: 0.5,
              mb: { xs: 3, sm: 5 },
              borderRadius: 3,
              background: 'rgba(10, 25, 41, 0.08)',
            }}
          >
            <Box
              onClick={() => { setMode('signin'); setStep('phone'); setPin(''); setOtp(''); setError(''); }}
              sx={{
                flex: 1,
                textAlign: 'center',
                py: { xs: 1.25, sm: 2 },
                borderRadius: 2,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: { xs: '1rem', sm: '1.15rem' },
                transition: 'all 0.2s',
                color: mode === 'signin' ? '#0a1929' : 'rgba(10, 25, 41, 0.5)',
                background: mode === 'signin' ? '#fff' : 'transparent',
                boxShadow: mode === 'signin' ? '0 2px 8px rgba(0, 0, 0, 0.15)' : 'none',
              }}
            >
              {t('login.signIn')}
            </Box>
            <Box
              onClick={() => { setMode('signup'); setStep('phone'); setPin(''); setOtp(''); setError(''); }}
              sx={{
                flex: 1,
                textAlign: 'center',
                py: { xs: 1.25, sm: 2 },
                borderRadius: 2,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: { xs: '1rem', sm: '1.15rem' },
                transition: 'all 0.2s',
                color: mode === 'signup' ? '#0a1929' : 'rgba(10, 25, 41, 0.5)',
                background: mode === 'signup' ? '#fff' : 'transparent',
                boxShadow: mode === 'signup' ? '0 2px 8px rgba(0, 0, 0, 0.15)' : 'none',
              }}
            >
              {t('login.signUp')}
            </Box>
          </Box>
          )}

          <div id="recaptcha-container" />

          {error && (
            <Alert severity="error" sx={glassAlertSx} onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          {/* Step: Phone entry */}
          {step === 'phone' && projects !== null && (
            <Box sx={{ animation: stepFadeAnim }}>
              {mode === 'signup' && (
                <>
                  <Typography sx={fieldLabelSx}>{t('login.fullName')}</Typography>
                  <TextField
                    fullWidth
                    placeholder={t('login.fullNamePlaceholder')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    sx={glassInputSx}
                    required
                  />
                </>
              )}
              <Typography sx={fieldLabelSx}>{t('login.phoneNumber')}</Typography>
              <TextField
                fullWidth
                placeholder="9876543210"
                value={phone}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                  setPhone(digits);
                }}
                inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', maxLength: 10 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start" sx={{ mr: 0 }}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          py: { xs: 1.5, sm: 2 },
                          pl: 0.5,
                          pr: 2,
                          mr: 0.5,
                          color: '#0a1929',
                          fontWeight: 600,
                          fontSize: { xs: '1.1rem', sm: '1.35rem' },
                          borderRight: '1px solid rgba(10, 25, 41, 0.15)',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                      >
                        +91
                      </Box>
                    </InputAdornment>
                  ),
                }}
                sx={[
                  glassInputSx,
                  {
                    '& .MuiOutlinedInput-root': {
                      paddingLeft: 0,
                      minHeight: { xs: 56, sm: 72 },
                      '& input': {
                        color: '#0a1929',
                        fontSize: { xs: '1.15rem', sm: '1.4rem' },
                        letterSpacing: '0.02em',
                        paddingTop: { xs: 1.5, sm: 2 },
                        paddingBottom: { xs: 1.5, sm: 2 },
                      },
                    },
                  },
                ]}
              />
              <Typography variant="caption" sx={{ display: 'block', mt: -1.5, mb: 2, color: 'rgba(10, 25, 41, 0.5)', fontSize: '0.72rem' }}>
                {t('login.phoneHint')}
              </Typography>
              {consentCheckbox}
              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={handleCheckPhone}
                disabled={loading || !agreed || phone.length !== 10 || (mode === 'signup' && !name.trim())}
                sx={glassButtonSx}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : t('login.continue')}
              </Button>
            </Box>
          )}

          {/* Step: PIN entry (returning user) */}
          {step === 'pin' && (
            <Box sx={{ animation: stepFadeAnim }}>
              <Alert severity="info" sx={glassAlertSx}>
                {t('login.welcomeBack')}
              </Alert>
              <Typography variant="body2" sx={{ mb: 1, color: 'rgba(10, 25, 41, 0.7)' }}>
                {t('login.phoneLabel')} <strong>+91 {phone}</strong>
              </Typography>
              <Box ref={pinInputRef}>
              <Input
                fullWidth
                autoFocus
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setPin(digits);
                }}
                placeholder={t('login.pinPlaceholder')}
                sx={glassPinInputSx}
                inputProps={{ maxLength: 4, inputMode: 'numeric', style: { textAlign: 'center' } }}
                endAdornment={
                  <MuiInputAdornment position="end">
                    <IconButton onClick={() => setShowPin(!showPin)} edge="end" sx={{ color: 'rgba(10, 25, 41, 0.5)' }}>
                      {showPin ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </MuiInputAdornment>
                }
              />
              </Box>
              {consentCheckbox}
              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={handlePinLogin}
                disabled={loading || !agreed || pin.length !== 4}
                sx={glassButtonSx}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : t('login.signIn')}
              </Button>
              <Button
                fullWidth
                variant="text"
                sx={{ mt: 1, ...glassTextButtonSx }}
                onClick={() => { setStep('phone'); setPin(''); setError(''); }}
              >
                {t('login.differentPhone')}
              </Button>
              <Button
                fullWidth
                variant="text"
                sx={{ mt: 0.5, ...glassTextButtonSx }}
                onClick={() => { setStep('otp'); setError(''); }}
              >
                {t('login.forgotPin')}
              </Button>
            </Box>
          )}

          {/* Step: OTP entry */}
          {step === 'otp' && (
            <Box sx={{ animation: stepFadeAnim }}>
              <Alert severity="info" sx={glassAlertSx}>
                {t('login.otpSent', { phone })}
              </Alert>
              <Box ref={otpInputRef}>
              <Typography sx={fieldLabelSx}>{t('login.enterOtp')}</Typography>
              <TextField
                fullWidth
                placeholder={t('login.otpPlaceholder')}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                sx={glassInputSx}
                inputProps={{ maxLength: 6, inputMode: 'numeric' }}
              />
              </Box>
              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={handleVerifyOtp}
                disabled={loading || otp.length < 4}
                sx={glassButtonSx}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : t('login.verifyOtp')}
              </Button>
              <Button
                fullWidth
                variant="text"
                sx={{ mt: 1, ...glassTextButtonSx }}
                onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
              >
                {t('login.changePhone')}
              </Button>
              {isDevMode && (
                <Alert severity="info" sx={{ ...glassAlertSx, mb: 0, mt: 2 }}>
                  {t('login.devMode')} <strong>1234</strong>
                </Alert>
              )}
            </Box>
          )}

          {/* Step: Set PIN (after OTP verification) */}
          {step === 'setPin' && (
            <Box sx={{ animation: stepFadeAnim }}>
              <Alert severity="success" sx={glassAlertSx}>
                {t('login.identityVerified')}
              </Alert>
              <Box ref={pinInputRef}>
              <Input
                fullWidth
                autoFocus
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setPin(digits);
                }}
                placeholder={t('login.choosePin')}
                sx={glassPinInputSx}
                inputProps={{ maxLength: 4, inputMode: 'numeric', style: { textAlign: 'center' } }}
                endAdornment={
                  <MuiInputAdornment position="end">
                    <IconButton onClick={() => setShowPin(!showPin)} edge="end" sx={{ color: 'rgba(10, 25, 41, 0.5)' }}>
                      {showPin ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </MuiInputAdornment>
                }
              />
              </Box>
              <Typography variant="caption" sx={{ display: 'block', mb: 2, color: 'rgba(10, 25, 41, 0.5)' }}>
                {t('login.pinHint')}
              </Typography>
              {consentCheckbox}
              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={handleSetPin}
                disabled={loading || !agreed || pin.length !== 4}
                sx={glassButtonSx}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : t('login.setPinSignIn')}
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

      {/* Footer legal links — in normal flow on mobile (absolute overlay would
          cover the card's bottom buttons); pinned to the bottom on desktop */}
      <Box
        sx={{
          position: { xs: 'static', md: 'absolute' },
          bottom: { md: 16 },
          left: 0,
          right: 0,
          width: { xs: '100%', md: 'auto' },
          mt: { xs: 2, md: 0 },
          pb: { xs: 'calc(4px + env(safe-area-inset-bottom))', md: 0 },
          textAlign: 'center',
          zIndex: 1,
          flexShrink: 0,
        }}
      >
        <Box sx={{ mb: 1.5 }}>
          <MuiLink
            component={RouterLink}
            to="/support"
            underline="none"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.75,
              px: 2,
              py: 0.75,
              borderRadius: '999px',
              border: '1px solid rgba(255,255,255,0.35)',
              backgroundColor: 'rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.92)',
              fontSize: '0.8125rem',
              fontWeight: 600,
              backdropFilter: 'blur(6px)',
              transition: 'background-color 0.2s',
              '&:hover': { backgroundColor: 'rgba(255,255,255,0.22)' },
            }}
          >
            <SupportAgent sx={{ fontSize: 16 }} />
            {t('login.needHelp')}
          </MuiLink>
        </Box>
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.65)' }}>
          <MuiLink component={RouterLink} to="/terms" underline="hover" sx={{ color: 'rgba(255,255,255,0.85)' }}>
            {t('login.terms')}
          </MuiLink>
          {' · '}
          <MuiLink component={RouterLink} to="/privacy-policy" underline="hover" sx={{ color: 'rgba(255,255,255,0.85)' }}>
            {t('login.privacy')}
          </MuiLink>
        </Typography>
      </Box>
    </Box>
  );
}

