import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Snackbar, Alert, Slide, type SlideProps } from '@mui/material';
import type { TransitionProps } from '@mui/material/transitions';

type ToastSeverity = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  message: string;
  severity: ToastSeverity;
}

interface ToastContextValue {
  toast: {
    success: (msg: string) => void;
    error: (msg: string) => void;
    warning: (msg: string) => void;
    info: (msg: string) => void;
  };
}

const ToastContext = createContext<ToastContextValue>({
  toast: {
    success: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
  },
});

export function useToast() {
  return useContext(ToastContext).toast;
}

function SlideUp(props: SlideProps) {
  return <Slide {...props} direction="up" />;
}

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback((message: string, severity: ToastSeverity) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, severity }]);
  }, []);

  const toastApi = {
    success: (msg: string) => add(msg, 'success'),
    error: (msg: string) => add(msg, 'error'),
    warning: (msg: string) => add(msg, 'warning'),
    info: (msg: string) => add(msg, 'info'),
  };

  return (
    <ToastContext.Provider value={{ toast: toastApi }}>
      {children}
      {toasts.map((t, idx) => (
        <Snackbar
          key={t.id}
          open
          autoHideDuration={4000}
          onClose={() => remove(t.id)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          TransitionComponent={SlideUp as React.ComponentType<TransitionProps>}
          sx={{ bottom: { xs: 16, sm: 24 + idx * 70 } }}
        >
          <Alert
            onClose={() => remove(t.id)}
            severity={t.severity}
            variant="filled"
            sx={{ width: '100%', boxShadow: 3 }}
          >
            {t.message}
          </Alert>
        </Snackbar>
      ))}
    </ToastContext.Provider>
  );
}
