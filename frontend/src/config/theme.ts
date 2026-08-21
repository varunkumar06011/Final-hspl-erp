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
    MuiDialog: {
      styleOverrides: {
        paper: {
          '@media (max-width: 599.95px)': {
            margin: 8,
            width: 'calc(100% - 16px)',
            maxWidth: 'calc(100% - 16px) !important',
          },
        },
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: {
          '@media (max-width: 599.95px)': {
            padding: 12,
          },
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: {
          '@media (max-width: 599.95px)': {
            padding: '12px 16px',
            fontSize: '1.1rem',
          },
        },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          '@media (max-width: 599.95px)': {
            padding: '8px 12px',
            '& .MuiButton-root': {
              minWidth: 'auto',
            },
          },
        },
      },
    },
    MuiTablePagination: {
      styleOverrides: {
        toolbar: {
          '@media (max-width: 599.95px)': {
            flexWrap: 'wrap',
            gap: 0.5,
            paddingLeft: 8,
            paddingRight: 8,
          },
        },
        select: {
          '@media (max-width: 599.95px)': {
            marginRight: 0,
          },
        },
        displayedRows: {
          '@media (max-width: 599.95px)': {
            display: 'none',
          },
        },
      },
    },
  },
});
