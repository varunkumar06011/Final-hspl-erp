import { useState, useEffect, useCallback } from 'react';
import { useTheme, useMediaQuery } from '@mui/material';

/**
 * Combined hook for mobile landscape detection + manual override.
 *
 * Returns:
 *   - excelView: boolean — whether the Excel-style table should show
 *   - isMobile: boolean — whether the viewport is mobile-width (< md)
 *   - toggleExcelView: () => void — manually toggle the Excel view on/off
 *
 * excelView is true when EITHER:
 *   - auto-detected: mobile width + landscape orientation, OR
 *   - manually toggled on by the user (persists per session)
 *
 * The manual toggle lets users on devices where auto-rotate detection
 * fails (or where landscape width exceeds the md breakpoint) still
 * access the Excel table view.
 */
export function useMobileLandscape(): {
  excelView: boolean;
  isMobile: boolean;
  toggleExcelView: () => void;
} {
  const theme = useTheme();
  const isMobileWidth = useMediaQuery(theme.breakpoints.down('md'));
  // Also detect slightly wider screens (up to 1100px) as "mobile-ish" so
  // phones in landscape that exceed the md breakpoint still qualify.
  const isTabletWidth = useMediaQuery(theme.breakpoints.down('lg'));

  const isMobile = isMobileWidth || (isTabletWidth && typeof window !== 'undefined' && window.matchMedia('(orientation: landscape)').matches);

  const [isLandscape, setIsLandscape] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(orientation: landscape)').matches;
  });

  const [manualOverride, setManualOverride] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia('(orientation: landscape)');
    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Auto-detect: mobile width (or tablet in landscape) + landscape orientation
  const autoDetected = isMobile && isLandscape;

  // Manual override takes precedence; otherwise use auto-detection
  const excelView = manualOverride !== null ? manualOverride : autoDetected;

  const toggleExcelView = useCallback(() => {
    setManualOverride((prev) => {
      // If auto-detected is currently active and user toggles, turn it OFF
      // If auto-detected is inactive and user toggles, turn it ON
      const current = prev !== null ? prev : autoDetected;
      return !current;
    });
  }, [autoDetected]);

  return { excelView, isMobile, toggleExcelView };
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
