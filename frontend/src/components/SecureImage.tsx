import { useEffect, useState } from 'react';
import { Box, type SxProps, type Theme } from '@mui/material';
import { fetchFileUrl } from '../utils/file';

interface SecureImageProps {
  route: string;
  id: string;
  alt: string;
  sx?: SxProps<Theme>;
}

/** Renders an <img> that fetches from an authenticated GET /:id/file endpoint. */
export function SecureImage({ route, id, alt, sx }: SecureImageProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    fetchFileUrl(route, id)
      .then((u) => {
        if (!active) {
          window.URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => setUrl(null));
    return () => {
      active = false;
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, [route, id]);

  if (!url) {
    return <Box sx={{ width: 60, height: 60, bgcolor: 'grey.200', borderRadius: 1, ...sx }} />;
  }
  return <Box component="img" src={url} alt={alt} sx={{ objectFit: 'cover', borderRadius: 1, ...sx }} />;
}
