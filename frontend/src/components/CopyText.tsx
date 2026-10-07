import { Box, type SxProps, type Theme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useToast } from './ToastProvider';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path (older WebViews / blocked clipboard)
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Shows a document number (PO / quotation / request number); clicking it copies
 * the number to the clipboard. Clicks never bubble, so it works inside accordion
 * headers and table rows without toggling them.
 */
export default function CopyText({
  text,
  children,
  sx,
}: {
  text: string;
  children?: React.ReactNode;
  sx?: SxProps<Theme>;
}) {
  const { t } = useTranslation();
  const toast = useToast();

  const copy = async (event: React.SyntheticEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const ok = await copyToClipboard(text);
    if (ok) toast.success(t('copied', { text }));
    else toast.error(t('copyFailed'));
  };

  return (
    <Box
      component="span"
      role="button"
      tabIndex={0}
      title={t('clickToCopy')}
      onClick={copy}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') copy(e);
      }}
      onFocus={(e) => e.stopPropagation()}
      sx={{
        cursor: 'copy',
        fontWeight: 700,
        borderBottom: '1px dashed',
        borderColor: 'text.disabled',
        '&:hover': { color: 'primary.main', borderColor: 'primary.main' },
        ...sx,
      }}
    >
      {children ?? text}
    </Box>
  );
}
