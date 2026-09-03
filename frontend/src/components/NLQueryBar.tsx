import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  TextField,
  InputAdornment,
  IconButton,
  Paper,
  Typography,
  Chip,
  Fade,
} from '@mui/material';
import {
  AutoAwesome as AutoAwesomeIcon,
  Send as SendIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { parseNaturalQuery, EXAMPLE_QUERIES, type ParsedQuery } from '../utils/nlQueryParser';

interface NLQueryBarProps {
  open: boolean;
  onClose: () => void;
}

export default function NLQueryBar({ open, onClose }: NLQueryBarProps) {
  const [query, setQuery] = useState('');
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setQuery('');
      setParsed(null);
      setError('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleParse = (text: string) => {
    setQuery(text);
    if (!text.trim()) {
      setParsed(null);
      setError('');
      return;
    }
    const result = parseNaturalQuery(text);
    if (result) {
      setParsed(result);
      setError('');
    } else {
      setParsed(null);
      setError('Could not understand. Try mentioning a type: PO, invoice, payment, vendor, issue, work task…');
    }
  };

  const handleSubmit = () => {
    if (!parsed) return;
    const searchParams = new URLSearchParams();
    Object.entries(parsed.params).forEach(([key, value]) => {
      searchParams.set(key, value);
    });
    navigate(`${parsed.path}?${searchParams.toString()}`);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && parsed) {
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <Fade in={open}>
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 2000,
          bgcolor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          pt: { xs: '15vh', sm: '20vh' },
        }}
        onClick={onClose}
      >
        <Paper
          elevation={24}
          sx={{
            width: '100%',
            maxWidth: 680,
            mx: 2,
            borderRadius: 3,
            overflow: 'hidden',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 2, pb: 1 }}>
            <AutoAwesomeIcon color="primary" />
            <Typography variant="h6" fontWeight={600} sx={{ fontSize: '1.1rem' }}>
              Ask ERP
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
              Natural Language Query
            </Typography>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          {/* Input */}
          <Box sx={{ px: 2, pb: 1 }}>
            <TextField
              inputRef={inputRef}
              fullWidth
              placeholder="e.g. show me pending payments to Sree Vinayaka above 1 lakh"
              value={query}
              onChange={(e) => handleParse(e.target.value)}
              onKeyDown={handleKeyDown}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <AutoAwesomeIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
                endAdornment: parsed ? (
                  <InputAdornment position="end">
                    <IconButton size="small" color="primary" onClick={handleSubmit} title="Go">
                      <SendIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  fontSize: '1rem',
                },
              }}
            />
          </Box>

          {/* Parsed result preview */}
          {parsed && (
            <Box sx={{ px: 2, pb: 1 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  flexWrap: 'wrap',
                  p: 1.5,
                  borderRadius: 1.5,
                  bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(76,175,80,0.15)' : 'rgba(76,175,80,0.1)',
                }}
              >
                <Typography variant="body2" fontWeight={600} color="success.main">
                  Understood:
                </Typography>
                <Typography variant="body2" color="text.primary">
                  {parsed.summary}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                {Object.entries(parsed.params).map(([key, value]) => (
                  <Chip
                    key={key}
                    size="small"
                    label={`${key}: ${value}`}
                    variant="outlined"
                    color="primary"
                    sx={{ fontSize: '0.7rem' }}
                  />
                ))}
                <Chip
                  size="small"
                  label={`→ ${parsed.path}`}
                  color="secondary"
                  sx={{ fontSize: '0.7rem' }}
                />
              </Box>
            </Box>
          )}

          {/* Error */}
          {error && (
            <Box sx={{ px: 2, pb: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                {error}
              </Typography>
            </Box>
          )}

          {/* Example queries */}
          {!query && (
            <Box sx={{ p: 2, pt: 1 }}>
              <Typography variant="overline" color="text.secondary">
                Try these examples:
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.5 }}>
                {EXAMPLE_QUERIES.slice(0, 5).map((ex) => (
                  <Chip
                    key={ex}
                    label={ex}
                    variant="outlined"
                    onClick={() => handleParse(ex)}
                    sx={{
                      justifyContent: 'flex-start',
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.hover' },
                      height: 'auto',
                      py: 0.5,
                      '& .MuiChip-label': { whiteSpace: 'normal', fontSize: '0.8rem' },
                    }}
                  />
                ))}
              </Box>
            </Box>
          )}
        </Paper>
      </Box>
    </Fade>
  );
}
