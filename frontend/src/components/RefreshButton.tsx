import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';

const COOLDOWN_SECONDS = 10;

interface RefreshButtonProps {
  /** Called when the user clicks refresh (ignored while cooling down). */
  onClick: () => void;
  size?: 'small' | 'medium' | 'large';
}

/**
 * Manual refresh icon button with a fixed 10-second cooldown.
 * While cooling down the button is disabled (not clickable) and a
 * live countdown is shown next to it so users can see exactly when
 * they can refresh again.
 */
export default function RefreshButton({ onClick, size = 'small' }: RefreshButtonProps) {
  const [remaining, setRemaining] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const startCooldown = useCallback(() => {
    setRemaining(COOLDOWN_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleClick = useCallback(() => {
    if (remaining > 0) return;
    onClick();
    startCooldown();
  }, [onClick, remaining, startCooldown]);

  const coolingDown = remaining > 0;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Tooltip title={coolingDown ? `Refresh available in ${remaining}s` : 'Refresh'}>
        <span>
          <IconButton
            onClick={handleClick}
            size={size}
            disabled={coolingDown}
            sx={coolingDown ? { opacity: 0.5 } : undefined}
          >
            <RefreshIcon />
          </IconButton>
        </span>
      </Tooltip>
      {coolingDown && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ minWidth: 18, lineHeight: 1, fontWeight: 500 }}
        >
          {remaining}s
        </Typography>
      )}
    </Box>
  );
}
