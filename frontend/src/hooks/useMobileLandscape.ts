import { useState, useEffect, useCallback, useRef } from 'react';
import { useTheme, useMediaQuery } from '@mui/material';

/**
 * Combined hook for mobile landscape detection + manual table-view toggle.
 *
 * Returns:
 *   - isLandscape:  boolean — viewport is landscape (innerWidth > innerHeight)
 *   - isPortrait:   boolean — viewport is portrait  (innerHeight >= innerWidth)
 *   - isMobile:     boolean — viewport is mobile-width (< md)
 *   - excelView:    boolean — whether the Excel-style table should show
 *   - wantsTable:   boolean — whether user explicitly requested table view
 *   - showRotateHint: boolean — show "rotate your phone" instruction
 *   - toggleExcelView: () => void — toggle the table view on/off
 *
 * Uses window.resize + innerWidth > innerHeight as the primary trigger
 * (more reliable than orientationchange across mobile browsers).
 *
 * Flow:
 *   Portrait → Card UI (existing layout)
 *   Tap "Table View" while portrait → show "Rotate your phone" instruction
 *   Rotate to landscape → Excel table appears automatically
 *   Rotate back to portrait → Card UI returns automatically (wantsTable resets)
 */
export function useMobileLandscape(): {
  excelView: boolean;
  isMobile: boolean;
  isLandscape: boolean;
  isPortrait: boolean;
  wantsTable: boolean;
  showRotateHint: boolean;
  toggleExcelView: () => void;
} {
  const theme = useTheme();
  const isMobileWidth = useMediaQuery(theme.breakpoints.down('md'));

  const [isLandscape, setIsLandscape] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false
  );

  const [isPortrait, setIsPortrait] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerHeight >= window.innerWidth : false
  );

  // Whether the user explicitly tapped "Table View"
  const [wantsTable, setWantsTable] = useState(false);

  // Track previous orientation to detect landscape→portrait transition
  const wasLandscape = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const check = () => {
      const landscape = window.innerWidth > window.innerHeight;
      const portrait = window.innerHeight >= window.innerWidth;
      setIsLandscape(landscape);
      setIsPortrait(portrait);

      // If we were in landscape and are now in portrait, and the user had
      // requested table view, reset the preference — rotating back to
      // portrait means they want the card UI again.
      if (wasLandscape.current && portrait && wantsTable) {
        setWantsTable(false);
      }
      wasLandscape.current = landscape;
    };

    check(); // initial check
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);

    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, [wantsTable]);

  // "isMobile" = narrow screen (< md) OR a wider screen in landscape
  // (a phone rotated to landscape can be 900-1000px wide but is still a phone)
  const isMobile = isMobileWidth || (isLandscape && window.innerWidth < 1200);

  // excelView = user wants table AND we're in landscape
  // Auto-detect: also show table when mobile + landscape (no tap needed)
  const excelView = isLandscape && (wantsTable || isMobile);

  // showRotateHint = user tapped Table View but is still in portrait
  const showRotateHint = wantsTable && isPortrait && isMobile;

  const toggleExcelView = useCallback(() => {
    setWantsTable((prev) => !prev);
  }, []);

  return { excelView, isMobile, isLandscape, isPortrait, wantsTable, showRotateHint, toggleExcelView };
}

/**
 * Returns true only when the viewport is mobile-narrow (< md) AND in
 * PORTRAIT orientation. Use this to show the "rotate for better view" hint.
 */
export function useMobilePortrait(): boolean {
  const theme = useTheme();
  const isMobileWidth = useMediaQuery(theme.breakpoints.down('md'));

  const [isPortrait, setIsPortrait] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerHeight >= window.innerWidth : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const check = () => setIsPortrait(window.innerHeight >= window.innerWidth);
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);

    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  return isMobileWidth && isPortrait;
}
