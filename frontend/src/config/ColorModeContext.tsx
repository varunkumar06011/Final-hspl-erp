import { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { isAdminRole } from '@hospital-erp/shared';
import { createAppTheme } from '../config/theme';
import { useAuthStore } from '../stores/authStore';

type Mode = 'light' | 'dark';

interface ColorModeContextValue {
  mode: Mode;
  toggle: () => void;
}

const ColorModeContext = createContext<ColorModeContextValue>({
  mode: 'light',
  toggle: () => {},
});

export function useColorMode() {
  return useContext(ColorModeContext);
}

const STORAGE_KEY = 'hspl-color-mode';

function getInitialMode(): Mode {
  if (typeof window === 'undefined') return 'light';
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch { /* storage unavailable (e.g. iOS standalone blocked storage) */ }
  if (stored === 'light' || stored === 'dark') return stored;
  // Respect system preference on first visit
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [userMode, setMode] = useState<Mode>(getInitialMode);
  const user = useAuthStore((s) => s.user);
  // Admin panel is always the dark navy theme (dashboard + all sections).
  // Other roles keep the light/dark preference toggle.
  const mode: Mode = user && isAdminRole(user.role) ? 'dark' : userMode;

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ mode, toggle }), [mode, toggle]);

  const theme = useMemo(() => createAppTheme(mode), [mode]);

  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}
