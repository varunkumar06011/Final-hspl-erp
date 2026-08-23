import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#82B1FF', // Light blue
      light: '#C5E1F5',
      dark: '#448AFF',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#FF69B4', // Pink
      light: '#FFB6C1',
      dark: '#FF1493',
    },
    success: {
      main: '#4CAF50',
      light: '#81C784',
      dark: '#2E7D32',
    },
    error: {
      main: '#F44336',
      light: '#E57373',
      dark: '#D32F2F',
    },
    warning: {
      main: '#FFC107',
    },
    background: {
      default: '#E3F2FD', // Very light blue
      paper: '#FFFFFF',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h5: {
      fontWeight: 600,
    },
    h6: {
      fontWeight: 600,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: {
          overflowX: 'hidden',
          maxWidth: '100vw',
        },
        body: {
          overflowX: 'hidden',
          maxWidth: '100vw',
          overflowWrap: 'break-word',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 8,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          overflow: 'hidden',
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        input: {
          '&::-webkit-outer-spin-button, &::-webkit-inner-spin-button': {
            '-webkit-appearance': 'none',
            margin: 0,
          },
          '&[type=number]': {
            '-moz-appearance': 'textfield',
          },
        },
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: {
          paddingTop: '12px',
        },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          padding: '12px 16px',
          gap: 1,
          '& .MuiButton-root': {
            minWidth: { xs: 88, sm: 96 },
          },
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          whiteSpace: 'normal',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          minHeight: 'auto',
          paddingTop: 8,
          paddingBottom: 8,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
        },
      },
    },
    MuiTypography: {
      styleOverrides: {
        root: {
          overflowWrap: 'break-word',
        },
      },
    },
  },
});
