import { Component, ReactNode } from 'react';
import { Box, Typography, Button } from '@mui/material';
import i18n from '../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
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

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 2 }}>
          <Typography variant="h5" color="error">{i18n.t('misc:error.somethingWrong')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400, textAlign: 'center' }}>
            {this.state.error?.message ?? i18n.t('misc:error.unexpectedRender')}
          </Typography>
          <Button variant="outlined" onClick={this.handleReset}>
            {i18n.t('misc:error.tryAgain')}
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}
