import { GlobalStyles, useTheme } from '@mui/material';

// Admin dashboard palette as CSS variables so one set of `sx` styles works in
// both colour modes (dialogs render in portals, hence variables on :root).
export const AP = {
  bg: 'var(--d-bg)',
  card: 'var(--d-card)',
  border: 'var(--d-border)',
  text: 'var(--d-text)',
  dim: 'var(--d-dim)',
  teal: 'var(--d-teal)',
  red: 'var(--d-red)',
  violet: 'var(--d-violet)',
  blue: 'var(--d-blue)',
  amber: 'var(--d-amber)',
  tip: 'var(--d-tip)',
};

const OVERLAYS = ['04', '05', '06', '08', '12', '15', '20', '30'];
const overlayVars = (rgb: string) =>
  Object.fromEntries(OVERLAYS.map((n) => [`--d-ov-${n}`, `rgba(${rgb},0.${n})`]));

const DARK = {
  '--d-bg': '#000000', '--d-card': '#0c0c0c', '--d-border': 'rgba(255,255,255,0.12)',
  '--d-text': '#f0f0f0', '--d-dim': '#9a9a9a',
  '--d-teal': '#2fd9a4', '--d-red': '#ff5c7a', '--d-violet': '#8b7cf6', '--d-blue': '#4f9cf9', '--d-amber': '#f7b955',
  '--d-tip': '#1a1a1a', '--d-invert': 'invert(.7)',
  ...overlayVars('255,255,255'),
};

const LIGHT = {
  '--d-bg': '#f4f7fb', '--d-card': '#ffffff', '--d-border': 'rgba(15,23,42,0.12)',
  '--d-text': '#1a2230', '--d-dim': '#5b6678',
  '--d-teal': '#0b8f6a', '--d-red': '#d3264a', '--d-violet': '#6a58d6', '--d-blue': '#1f6fd6', '--d-amber': '#b26a00',
  '--d-tip': '#ffffff', '--d-invert': 'invert(.35)',
  ...overlayVars('15,23,42'),
};

export function AdminPaletteVars() {
  const mode = useTheme().palette.mode;
  return <GlobalStyles styles={{ ':root': mode === 'dark' ? DARK : LIGHT }} />;
}
