import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  CircularProgress,
  Alert,
  Divider,
} from '@mui/material';
import { Lock as LockIcon, Login as LoginIcon } from '@mui/icons-material';
import { QRCodeSVG } from 'qrcode.react';
import api from '../config/api';

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'info' | 'error' | 'default'> = {
  ACTIVE: 'success',
  ISSUED: 'warning',
  UNDER_MAINTENANCE: 'info',
  RETIRED: 'error',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  ISSUED: 'Issued',
  UNDER_MAINTENANCE: 'Under Maintenance',
  RETIRED: 'Retired',
};

export default function AssetScanPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!assetId) return;
    setLoading(true);
    api.get(`/assets/scan/${assetId}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error ?? 'Failed to load asset'))
      .finally(() => setLoading(false));
  }, [assetId]);

  const qrBaseUrl = import.meta.env.VITE_QR_BASE_URL || import.meta.env.VITE_API_URL?.replace('/api', '') || window.location.origin;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', p: 3 }}>
        <Card sx={{ maxWidth: 400, width: '100%' }}>
          <CardContent sx={{ textAlign: 'center' }}>
            <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
            <Typography variant="body2" color="text.secondary">
              Asset ID: {assetId}
            </Typography>
          </CardContent>
        </Card>
      </Box>
    );
  }

  if (!data) return null;

  const authenticated = data.authenticated as boolean;
  const full = data.full as Record<string, unknown> | undefined;

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', minHeight: '100vh', p: 2, bgcolor: 'background.default' }}>
      <Card sx={{ maxWidth: 600, width: '100%' }}>
        <CardContent>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h5" fontWeight={600}>Asset Details</Typography>
            <Chip
              label={STATUS_LABELS[String(data.status)] ?? String(data.status)}
              color={STATUS_COLORS[String(data.status)] ?? 'default'}
              size="small"
            />
          </Box>

          {/* QR Code */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
            <QRCodeSVG
              value={`${qrBaseUrl}/scan/${String(data.assetId)}`}
              size={160}
              level="M"
              includeMargin
            />
          </Box>

          {/* Public fields */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography color="text.secondary">Asset ID</Typography>
              <Typography fontWeight={600}>{String(data.assetId)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography color="text.secondary">Name</Typography>
              <Typography fontWeight={600}>{String(data.name)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography color="text.secondary">Category</Typography>
              <Typography>{String(data.category ?? '—')}</Typography>
            </Box>
          </Box>

          {!authenticated && (
            <>
              <Divider sx={{ my: 2 }} />
              <Alert severity="info" sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LockIcon fontSize="small" />
                  <Typography variant="body2">
                    Location, issued-to, purchase details, and full history are visible to authenticated staff only.
                  </Typography>
                </Box>
              </Alert>
              <Button
                variant="contained"
                fullWidth
                startIcon={<LoginIcon />}
                onClick={() => navigate(`/login?redirect=/scan/${assetId}`)}
              >
                Login to View Full Details
              </Button>
            </>
          )}

          {authenticated && full && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="h6" gutterBottom>Full Details</Typography>

              {/* Current state */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">Location</Typography>
                  <Typography>{String(full.location ?? '—')}</Typography>
                </Box>
                {!!full.issuedToDept && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography color="text.secondary">Issued To (Dept)</Typography>
                    <Typography>{String(full.issuedToDept)}</Typography>
                  </Box>
                )}
                {!!full.issuedToPerson && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography color="text.secondary">Issued To (Person)</Typography>
                    <Typography>{String(full.issuedToPerson)}</Typography>
                  </Box>
                )}
                {!!full.serialNumber && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography color="text.secondary">Serial Number</Typography>
                    <Typography>{String(full.serialNumber)}</Typography>
                  </Box>
                )}
                {!!full.lastScannedAt && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography color="text.secondary">Last Scanned</Typography>
                    <Typography>{new Date(String(full.lastScannedAt)).toLocaleString('en-IN')}</Typography>
                  </Box>
                )}
              </Box>

              {/* Purchase chain */}
              {!!full.vendorName && (
                <>
                  <Typography variant="subtitle2" gutterBottom>Purchase Information</Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">Vendor</Typography>
                      <Typography>{String(full.vendorName)} ({String(full.vendorCode ?? '')})</Typography>
                    </Box>
                    {!!full.poNumber && (
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography color="text.secondary">PO Number</Typography>
                        <Typography>{String(full.poNumber)}</Typography>
                      </Box>
                    )}
                    {!!full.invoiceNumber && (
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography color="text.secondary">Invoice Number</Typography>
                        <Typography>{String(full.invoiceNumber)}</Typography>
                      </Box>
                    )}
                    {!!full.unitPrice && (
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography color="text.secondary">Unit Price</Typography>
                        <Typography>₹{Number(full.unitPrice).toLocaleString('en-IN')}</Typography>
                      </Box>
                    )}
                    {!!full.totalCost && (
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography color="text.secondary">Total Cost (incl. GST)</Typography>
                        <Typography fontWeight={600}>₹{Number(full.totalCost).toLocaleString('en-IN')}</Typography>
                      </Box>
                    )}
                  </Box>
                </>
              )}

              {/* Movement history */}
              {Array.isArray(full.movements) && (full.movements as Record<string, unknown>[]).length > 0 ? (
                <>
                  <Typography variant="subtitle2" gutterBottom>Movement History</Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 2 }}>
                    {(full.movements as Record<string, unknown>[]).slice(0, 10).map((m, i) => (
                      <Typography key={i} variant="body2" color="text.secondary">
                        {new Date(String(m.timestamp)).toLocaleString('en-IN')} — {String(m.type).replace(/_/g, ' ')}
                        {m.fromLocation && m.toLocation ? `: ${String(m.fromLocation)} → ${String(m.toLocation)}` : ''}
                        {m.notes ? ` (${String(m.notes)})` : ''}
                      </Typography>
                    ))}
                  </Box>
                </>
              ) : null}

              <Button variant="outlined" fullWidth onClick={() => navigate('/inventory')}>
                Go to Inventory
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
