import { useState, useEffect } from 'react';
import { useTheme, useMediaQuery } from '@mui/material';

/**
 * Returns true only when the viewport is BOTH:
 *   - mobile-narrow (below the `md` breakpoint, i.e. < 900px), AND
 *   - in landscape orientation.
 *
 * On desktop (wide screens) this is always false — desktop landscape keeps
 * the normal desktop UI. On mobile portrait this is false — the existing
 * card-based UI is kept. Only mobile + landscape triggers the Excel-style
 * horizontal table view.
 */
export function useMobileLandscape(): boolean {
  const theme = useTheme();
  const isMobileWidth = useMediaQuery(theme.breakpoints.down('md'));

  const [isLandscape, setIsLandscape] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(orientation: landscape)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia('(orientation: landscape)');
    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobileWidth && isLandscape;
}

/**
 * Returns true only when the viewport is mobile-narrow (< md) AND in
 * PORTRAIT orientation. Use this to show the "rotate for better view" hint.
 */
export function useMobilePortrait(): boolean {
  const theme = useTheme();
  const isMobileWidth = useMediaQuery(theme.breakpoints.down('md'));

  const [isPortrait, setIsPortrait] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(orientation: portrait)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia('(orientation: portrait)');
    const handler = (e: MediaQueryListEvent) => setIsPortrait(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobileWidth && isPortrait;
}
