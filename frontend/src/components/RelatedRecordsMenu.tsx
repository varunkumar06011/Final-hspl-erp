import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Button, Chip, CircularProgress, ListSubheader, Menu, MenuItem, Typography } from '@mui/material';
import { AccountTree as RelatedIcon, ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import api from '../config/api';
import { enumLabel } from '../utils/enumOptions';
import { useActiveRecordStore } from '../stores/activeRecordStore';

interface RelatedItem {
  id: string;
  label: string;
  status: string | null;
  path: string;
  own: boolean;
}
interface RelatedGroup {
  type: string;
  items: RelatedItem[];
}

/**
 * Top-of-page dropdown listing everything linked to the record the user has
 * opened (MPR, quotations, PO, gate passes, receipts, invoices, payments).
 * Each entry opens that record on its own page. Renders nothing until a
 * record is selected.
 */
export default function RelatedRecordsMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const record = useActiveRecordStore((s) => s.record);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['/related-records', record?.type, record?.id],
    queryFn: async () => {
      const res = await api.get('/related-records', { params: { entityType: record!.type, entityId: record!.id } });
      return res.data.data as RelatedGroup[];
    },
    enabled: !!record,
    staleTime: 30_000,
  });

  if (!record) return null;

  const count = (data ?? []).reduce((n, g) => n + g.items.filter((i) => !i.own).length, 0);

  const open = (path: string) => {
    setAnchorEl(null);
    navigate(path);
  };

  return (
    <Box sx={{ mb: 2 }}>
      <Button
        size="small"
        variant="outlined"
        startIcon={<RelatedIcon />}
        endIcon={isLoading ? <CircularProgress size={14} /> : <ExpandMoreIcon />}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{ textTransform: 'none' }}
      >
        {t('related.button', { label: record.label || t('related.current') })}
        {data && count > 0 && <Chip size="small" label={count} color="primary" sx={{ ml: 1, height: 20 }} />}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        slotProps={{ paper: { sx: { minWidth: 280, maxHeight: '70vh' } } }}
      >
        {isLoading && <MenuItem disabled>{t('related.loading')}</MenuItem>}
        {isError && <MenuItem disabled>{t('related.failed')}</MenuItem>}
        {data && count === 0 && <MenuItem disabled>{t('related.none')}</MenuItem>}
        {data &&
          count > 0 &&
          data.flatMap((group) => [
            <ListSubheader key={`h-${group.type}`} sx={{ lineHeight: '32px' }}>
              {t(`related.types.${group.type}`, group.type)}
            </ListSubheader>,
            ...group.items.map((item) => (
              <MenuItem key={`${group.type}-${item.id}`} onClick={() => open(item.path)} selected={item.own} sx={{ gap: 1.5 }}>
                <Typography variant="body2" fontWeight={item.own ? 700 : 500} sx={{ flexGrow: 1 }}>
                  {item.label}
                </Typography>
                {item.status && <Chip size="small" variant="outlined" label={enumLabel(item.status)} />}
              </MenuItem>
            )),
          ])}
      </Menu>
    </Box>
  );
}
