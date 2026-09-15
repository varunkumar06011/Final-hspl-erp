import { useState } from 'react';
import { Typography, Link, Box } from '@mui/material';

interface TruncatedTextProps {
  text: string;
  /** Number of words to show before truncating. Default: 3 */
  wordLimit?: number;
  variant?: 'caption' | 'body2' | 'body1' | 'inherit';
  color?: string;
  maxWidth?: number | string;
}

/**
 * Truncates text to `wordLimit` words and shows a "read more" link. Clicking
 * the link expands to show the full text with a "read less" link to collapse.
 *
 * Example: "Cement bags for foundation work phase 2" → "Cement bags for … read more"
 * After click → "Cement bags for foundation work phase 2 read less"
 */
export default function TruncatedText({
  text,
  wordLimit = 3,
  variant = 'caption',
  color,
  maxWidth,
}: TruncatedTextProps) {
  const [expanded, setExpanded] = useState(false);

  if (!text || !text.trim()) {
    return <Typography variant={variant} color="text.secondary">—</Typography>;
  }

  const words = text.trim().split(/\s+/);
  const needsTruncation = words.length > wordLimit;

  if (!needsTruncation || expanded) {
    return (
      <Box sx={{ maxWidth }}>
        <Typography
          variant={variant}
          color={color}
          sx={{ display: 'inline', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {text}
        </Typography>
        {needsTruncation && expanded && (
          <Link
            component="button"
            type="button"
            onClick={() => setExpanded(false)}
            sx={{ ml: 0.5, fontSize: 'inherit', verticalAlign: 'baseline' }}
          >
            read less
          </Link>
        )}
      </Box>
    );
  }

  const preview = words.slice(0, wordLimit).join(' ');

  return (
    <Box sx={{ maxWidth }}>
      <Typography
        variant={variant}
        color={color}
        sx={{ display: 'inline', overflowWrap: 'anywhere' }}
      >
        {preview}…
      </Typography>
      <Link
        component="button"
        type="button"
        onClick={() => setExpanded(true)}
        sx={{ ml: 0.5, fontSize: 'inherit', verticalAlign: 'baseline' }}
      >
        read more
      </Link>
    </Box>
  );
}
