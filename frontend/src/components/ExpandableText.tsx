import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Box, Typography, type TypographyProps } from '@mui/material';
import { useTranslation } from 'react-i18next';

interface Props {
  text: string | null | undefined;
  /** Lines shown before "See more" appears. */
  lines?: number;
  variant?: TypographyProps['variant'];
  color?: TypographyProps['color'];
  sx?: TypographyProps['sx'];
}

/**
 * A description shown in full when short, clamped to `lines` with a
 * "See more / See less" toggle when longer. Safe inside clickable rows and
 * accordion headers: the toggle never triggers the row's own click.
 */
export default function ExpandableText({ text, lines = 2, variant = 'body2', color = 'text.primary', sx }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const value = (text ?? '').trim();

  // Measure while clamped: the text overflows when its full height exceeds the clamped box.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    setOverflows(el.scrollHeight - el.clientHeight > 1);
  }, [value, lines, open]);

  if (!value) return null;

  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setOpen((o) => !o);
  };

  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        ref={ref}
        variant={variant}
        color={color}
        sx={{
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          ...(open ? {} : { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
          ...sx,
        }}
      >
        {value}
      </Typography>
      {(overflows || open) && (
        <Box
          component="button"
          type="button"
          onClick={toggle}
          sx={{ background: 'none', border: 0, p: 0, mt: 0.25, cursor: 'pointer', color: 'primary.main', font: 'inherit', fontSize: '0.75rem', fontWeight: 600 }}
        >
          {open ? t('common.seeLess') : t('common.seeMore')}
        </Box>
      )}
    </Box>
  );
}
