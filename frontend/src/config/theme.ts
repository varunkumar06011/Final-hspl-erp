import { createTheme, type ThemeOptions } from '@mui/material/styles';

const sharedOverrides: ThemeOptions = {
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { overflowX: 'hidden', maxWidth: '100vw' },
        body: { overflowX: 'hidden', maxWidth: '100vw', overflowWrap: 'break-word' },
      },
    },
    MuiButton: {
      styleOverrides: { root: { textTransform: 'none', borderRadius: 8 } },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', overflow: 'hidden' },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        input: {
          '&::-webkit-outer-spin-button, &::-webkit-inner-spin-button': {
            '-webkit-appearance': 'none', margin: 0,
          },
          '&[type=number]': { '-moz-appearance': 'textfield' },
        },
      },
    },
    MuiDialogContent: { styleOverrides: { root: { paddingTop: '12px' } } },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          padding: '12px 16px', gap: 1,
          '& .MuiButton-root': { minWidth: { xs: 88, sm: 96 } },
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'break-word',
          minHeight: 'auto', paddingTop: 8, paddingBottom: 8,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: { root: { wordBreak: 'break-word', overflowWrap: 'break-word' } },
    },
    MuiTypography: {
      styleOverrides: { root: { overflowWrap: 'break-word' } },
    },
  },
};

export function createAppTheme(mode: 'light' | 'dark') {
  if (mode === 'dark') {
    return createTheme({
      palette: {
        mode: 'dark',
        primary: { main: '#82B1FF', light: '#C5E1F5', dark: '#448AFF', contrastText: '#000000' },
        secondary: { main: '#FF69B4', light: '#FFB6C1', dark: '#FF1493' },
        success: { main: '#66BB6A', light: '#81C784', dark: '#2E7D32' },
        error: { main: '#EF5350', light: '#E57373', dark: '#D32F2F' },
        warning: { main: '#FFCA28' },
        background: { default: '#121212', paper: '#1E1E1E' },
      },
      ...sharedOverrides,
    });
  }

  return createTheme({
    palette: {
      mode: 'light',
      primary: { main: '#82B1FF', light: '#C5E1F5', dark: '#448AFF', contrastText: '#FFFFFF' },
      secondary: { main: '#FF69B4', light: '#FFB6C1', dark: '#FF1493' },
      success: { main: '#4CAF50', light: '#81C784', dark: '#2E7D32' },
      error: { main: '#F44336', light: '#E57373', dark: '#D32F2F' },
      warning: { main: '#FFC107' },
      background: { default: '#E3F2FD', paper: '#FFFFFF' },
    },
    ...sharedOverrides,
  });
}

// Keep the old export for backward compatibility
export const theme = createAppTheme('light');
