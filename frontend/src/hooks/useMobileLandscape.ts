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
  // Detect up to 1200px as "mobile-ish" so phones in landscape (which can
  // be 900-1000px wide) still qualify for auto-rotate detection.
  const isTabletWidth = useMediaQuery('(max-width: 1200px)');

  // "isMobile" = narrow screen OR a wider screen that's currently in landscape
  // (a phone rotated to landscape can be 900-1000px wide but is still a phone).
  const [isLandscape, setIsLandscape] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(orientation: landscape)').matches;
  });

  const isMobile = isMobileWidth || (isTabletWidth && isLandscape);

  const [manualOverride, setManualOverride] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia('(orientation: landscape)');
    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Auto-detect: mobile-ish width + landscape orientation
  const autoDetected = isMobile && isLandscape;

  // Manual override takes precedence; otherwise use auto-detection
  const excelView = manualOverride !== null ? manualOverride : autoDetected;

  const toggleExcelView = useCallback(() => {
    setManualOverride((prev) => {
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
