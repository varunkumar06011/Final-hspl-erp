import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import {
  Image as ImageIcon,
  InsertDriveFile as FileIcon,
  PhoneAndroid as DeviceIcon,
  Search as SearchIcon,
  FolderOpen as LibraryIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { hasPermission, Permission, UserRole } from '@hospital-erp/shared';
import api from '../config/api';
import { useAuthStore } from '../stores/authStore';
import ResponsiveDialog from './ResponsiveDialog';

interface LibraryItem {
  key: string;
  fileName: string;
  mimeType: string | null;
  fileType: 'IMAGE' | 'DOCUMENT';
  fileRoute: string;
  category: string;
}

interface UploadSourceButtonProps {
  onFile: (file: File) => void;
  /** Allow picking several files from the device at once; `onFile` is called once per file. */
  multiple?: boolean;
  children: ReactNode;
  accept?: string;
  startIcon?: ReactNode;
  disabled?: boolean;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
}

/**
 * Upload button that asks where the file comes from: the device or the app's
 * document library. Either way the caller just receives a File. Users without
 * document access go straight to the device picker.
 */
export default function UploadSourceButton({
  onFile,
  multiple,
  children,
  accept,
  startIcon,
  disabled,
  size = 'medium',
  fullWidth,
}: UploadSourceButtonProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const canUseLibrary = !!user && hasPermission(user.role as UserRole, Permission.MANAGE_DOCUMENTS);
  const inputRef = useRef<HTMLInputElement>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState('');
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['/document-library', 'picker', debounced],
    queryFn: async () =>
      (await api.get('/document-library', { params: { page: 1, pageSize: 30, search: debounced || undefined } })).data,
    enabled: libraryOpen,
  });
  const items: LibraryItem[] = data?.data ?? [];

  const pickFromLibrary = async (item: LibraryItem) => {
    setError('');
    setLoadingKey(item.key);
    try {
      const blob = (await api.get(item.fileRoute, { responseType: 'blob' })).data as Blob;
      const type = item.mimeType || blob.type || 'application/octet-stream';
      onFile(new File([blob], item.fileName, { type }));
      setLibraryOpen(false);
    } catch {
      setError(t('shared.libraryLoadFailed'));
    } finally {
      setLoadingKey(null);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          (multiple ? files : files.slice(0, 1)).forEach((f) => onFile(f));
          e.target.value = '';
        }}
      />
      <Button
        variant="outlined"
        size={size}
        startIcon={startIcon}
        disabled={disabled}
        onClick={(e) => (canUseLibrary ? setAnchorEl(e.currentTarget) : inputRef.current?.click())}
        sx={fullWidth ? { flex: 1, minWidth: 0 } : undefined}
      >
        {children}
      </Button>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            inputRef.current?.click();
          }}
        >
          <DeviceIcon fontSize="small" sx={{ mr: 1 }} /> {t('shared.fromDevice')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            setError('');
            setSearch('');
            setLibraryOpen(true);
          }}
        >
          <LibraryIcon fontSize="small" sx={{ mr: 1 }} /> {t('shared.fromLibrary')}
        </MenuItem>
      </Menu>

      <ResponsiveDialog open={libraryOpen} onClose={() => setLibraryOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('shared.libraryTitle')}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}
          <TextField
            size="small"
            fullWidth
            autoFocus
            placeholder={t('shared.librarySearch')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ my: 1 }}
          />
          {isLoading ? (
            <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', my: 3 }} />
          ) : items.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              {t('shared.libraryEmpty')}
            </Typography>
          ) : (
            <List dense>
              {items.map((item) => (
                <ListItemButton key={item.key} disabled={loadingKey !== null} onClick={() => pickFromLibrary(item)}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {loadingKey === item.key ? (
                      <CircularProgress size={18} />
                    ) : item.fileType === 'IMAGE' ? (
                      <ImageIcon fontSize="small" />
                    ) : (
                      <FileIcon fontSize="small" />
                    )}
                  </ListItemIcon>
                  <ListItemText primary={item.fileName} primaryTypographyProps={{ sx: { wordBreak: 'break-all' } }} />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLibraryOpen(false)}>{t('shared.close')}</Button>
        </DialogActions>
      </ResponsiveDialog>
    </>
  );
}
