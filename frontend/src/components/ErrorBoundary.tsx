import { Component, ReactNode } from 'react';
import { Box, Typography, Button } from '@mui/material';
import i18n from '../i18n';

interface Props {
  children: ReactNode;
  /** When this value changes (e.g. the route), a caught error is cleared. */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Errors caused by a page chunk that failed to load, loaded empty, or belongs
 * to an old deploy. React.lazy caches that failure forever, so re-rendering
 * cannot fix it: only a full reload (fresh index.html + chunks) does.
 */
export function isStaleModuleError(error: Error | null): boolean {
  const msg = error?.message ?? '';
  return (
    /reading 'default'/i.test(msg) ||
    /dynamically imported module|Importing a module script failed|Loading chunk|Loading CSS chunk|module loaded empty|failed to load/i.test(msg) ||
    error?.name === 'ChunkLoadError'
  );
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReset = () => {
    if (isStaleModuleError(this.state.error)) {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const stale = isStaleModuleError(this.state.error);
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 2 }}>
          <Typography variant="h5" color="error">{i18n.t('misc:error.somethingWrong')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400, textAlign: 'center' }}>
            {stale
              ? i18n.t('misc:error.updateAvailable')
              : this.state.error?.message ?? i18n.t('misc:error.unexpectedRender')}
          </Typography>
          <Button variant="outlined" onClick={this.handleReset}>
            {stale ? i18n.t('misc:error.reload') : i18n.t('misc:error.tryAgain')}
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}
