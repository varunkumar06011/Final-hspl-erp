import { useState, ReactNode } from 'react';
import {
  Box,
  IconButton,
  TextField,
  InputAdornment,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Search as SearchIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  RestartAlt as ResetZoomIcon,
} from '@mui/icons-material';

interface LandscapeExcelTableProps {
  /** The <TableContainer>...</TableContainer> content to render inside. */
  children: ReactNode;
  /** Controlled search value (optional). */
  search?: string;
  /** Search change handler (optional). */
  onSearchChange?: (v: string) => void;
  /** Placeholder for the search field. */
  searchPlaceholder?: string;
}

/**
 * Mobile-landscape Excel-style table wrapper.
 *
 * Provides:
 *  - Zoom in / zoom out / reset controls (applied via table font-size).
 *  - An optional search field that wires into the parent's existing search state.
 *  - A horizontally scrollable container with a sticky header row.
 *
 * The parent is responsible for rendering the actual <TableContainer> with a
 * normal <Table> (no ResponsiveTable wrapper) — this component just frames it.
 * The "rotate" prompt is shown by PortraitRotateHint in portrait mode, not here.
 */
export default function LandscapeExcelTable({
  children,
  search,
  onSearchChange,
  searchPlaceholder = 'Search...',
}: LandscapeExcelTableProps) {
  const [zoom, setZoom] = useState(1);

  const zoomIn = () => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(2)));
  const resetZoom = () => setZoom(1);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        // Constrain to the viewport so the table scrolls internally, not the page.
        // 56px = mobile AppBar, 48px = page header, 52px = TablePagination, 16px = padding.
        height: 'calc(100vh - 56px - 48px - 52px - 16px)',
        minHeight: 160,
      }}
    >
      {/* Toolbar — stays at top of this container (not sticky, just normal flow) */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
          flexShrink: 0,
          backgroundColor: 'background.paper',
          py: 0.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        {onSearchChange && (
          <TextField
            size="small"
            placeholder={searchPlaceholder}
            value={search ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ flex: 1, minWidth: 120 }}
          />
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          <Tooltip title="Zoom out">
            <IconButton size="small" onClick={zoomOut} disabled={zoom <= 0.6}>
              <ZoomOutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography variant="caption" sx={{ minWidth: 32, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </Typography>
          <Tooltip title="Zoom in">
            <IconButton size="small" onClick={zoomIn} disabled={zoom >= 1.6}>
              <ZoomInIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Reset zoom">
            <IconButton size="small" onClick={resetZoom}>
              <ResetZoomIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Scroll area — both horizontal and vertical scroll, header sticks within here */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          minHeight: 0,
          // Override nested TableContainer's own overflow so only this
          // container handles scrolling (prevents double scrollbars + ensures
          // the sticky header works relative to this scroll container).
          '& .MuiTableContainer-root': {
            overflow: 'visible',
          },
          // Apply zoom via font-size on the table; the table inherits it.
          '& .MuiTable-root': {
            fontSize: `${zoom}rem`,
            '& .MuiTableHead-root .MuiTableRow-root': {
              position: 'sticky',
              top: 0,
              zIndex: 1,
              backgroundColor: 'background.paper',
              '& .MuiTableCell-root': {
                backgroundColor: 'background.paper',
                borderBottom: '2px solid',
                borderColor: 'divider',
                whiteSpace: 'nowrap',
                fontWeight: 700,
                py: 0.75,
                px: 1.25,
              },
            },
            '& .MuiTableBody-root .MuiTableCell-root': {
              whiteSpace: 'nowrap',
              px: 1.25,
              py: 0.5,
              // Allow long text columns to truncate with ellipsis instead of
              // blowing out the column width.
              '&.truncate-cell': {
                maxWidth: 160,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            },
          },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
