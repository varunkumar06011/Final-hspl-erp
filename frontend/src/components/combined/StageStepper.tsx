import { Box, Tooltip, Typography } from '@mui/material';
import {
  CheckCircle as DoneIcon,
  RadioButtonChecked as CurrentIcon,
  RadioButtonUnchecked as TodoIcon,
  RemoveCircleOutline as SkippedIcon,
  Cancel as RejectedIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

export type StepKey = 'REQUEST' | 'QUOTATION' | 'PO' | 'DELIVERY' | 'INVOICE' | 'PAYMENT';
export type StepState = 'done' | 'current' | 'todo' | 'skipped' | 'rejected';
export interface Step {
  key: StepKey;
  state: StepState;
}

const COLOR: Record<StepState, string> = {
  done: 'success.main',
  current: 'warning.main',
  todo: 'text.disabled',
  skipped: 'text.disabled',
  rejected: 'error.main',
};

function StepIcon({ state, size }: { state: StepState; size: number }) {
  const sx = { fontSize: size, color: COLOR[state] };
  if (state === 'done') return <DoneIcon sx={sx} />;
  if (state === 'current') return <CurrentIcon sx={sx} />;
  if (state === 'rejected') return <RejectedIcon sx={sx} />;
  if (state === 'skipped') return <SkippedIcon sx={sx} />;
  return <TodoIcon sx={sx} />;
}

/**
 * The six stages of a purchase (request → quotations → PO → delivery → invoice →
 * payment) as a row of dots joined by a line. `compact` hides the labels (list rows).
 * Clicking a stage calls `onSelect` (the detail view scrolls to that section).
 */
export default function StageStepper({
  steps,
  compact = false,
  onSelect,
}: {
  steps: Step[];
  compact?: boolean;
  onSelect?: (key: StepKey) => void;
}) {
  const { t } = useTranslation('combined');
  const size = compact ? 18 : 26;
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', width: '100%' }}>
      {steps.map((step, i) => (
        <Box key={step.key} sx={{ display: 'flex', alignItems: 'flex-start', flex: i === steps.length - 1 ? '0 0 auto' : 1, minWidth: 0 }}>
          <Tooltip title={`${t(`step.${step.key}`)}: ${t(`state.${step.state}`)}`}>
            <Box
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onClick={onSelect ? () => onSelect(step.key) : undefined}
              onKeyDown={onSelect ? (e) => { if (e.key === 'Enter') onSelect(step.key); } : undefined}
              sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: onSelect ? 'pointer' : 'default', width: compact ? 'auto' : 64 }}
            >
              <StepIcon state={step.state} size={size} />
              {!compact && (
                <Typography
                  variant="caption"
                  sx={{
                    mt: 0.25, textAlign: 'center', lineHeight: 1.15, fontSize: { xs: '0.62rem', sm: '0.72rem' },
                    fontWeight: step.state === 'current' ? 700 : 500,
                    color: step.state === 'todo' || step.state === 'skipped' ? 'text.disabled' : 'text.primary',
                  }}
                >
                  {t(`step.${step.key}`)}
                </Typography>
              )}
            </Box>
          </Tooltip>
          {i < steps.length - 1 && (
            <Box
              sx={{
                flex: 1, height: 2, mt: `${size / 2 - 1}px`, mx: compact ? 0.25 : -1, minWidth: 6,
                bgcolor: step.state === 'done' || step.state === 'skipped' ? 'success.light' : 'divider',
              }}
            />
          )}
        </Box>
      ))}
    </Box>
  );
}
