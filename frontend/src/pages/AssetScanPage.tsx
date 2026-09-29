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
import { enumLabel } from '../utils/enumOptions';
import api from '../config/api';
import { QR_BASE_URL } from '../config/appConfig';
import TraceabilityChain, { TraceData } from '../components/TraceabilityChain';

import { useTranslation } from 'react-i18next';
const STATUS_COLORS: Record<string, 'success' | 'warning' | 'info' | 'error' | 'default'> = {
  ACTIVE: 'success',
  ISSUED: 'warning',
  UNDER_MAINTENANCE: 'info',
  RETIRED: 'error',
};

function fmtDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN');
}

function fmtMoney(value: unknown): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export default function AssetScanPage() {
  const { t: tr } = useTranslation('assetscan');
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
      .catch((err) => setError(err.response?.data?.error ?? tr('errLoad')))
      .finally(() => setLoading(false));
  }, [assetId]);

  const qrBaseUrl = QR_BASE_URL;

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
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>{tr('assetDetails')}</Typography>
            <Chip
              label={enumLabel(data.status)}
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
              <Typography color="text.secondary">{tr('assetId')}</Typography>
              <Typography fontWeight={600}>{String(data.assetId)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography color="text.secondary">{tr('name')}</Typography>
              <Typography fontWeight={600}>{String(data.name)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography color="text.secondary">{tr('category')}</Typography>
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
                    {tr('staffOnly')}
                  </Typography>
                </Box>
              </Alert>
              <Button
                variant="contained"
                fullWidth
                startIcon={<LoginIcon />}
                onClick={() => navigate(`/login?redirect=/scan/${assetId}`)}
              >
                {tr('loginToViewFull')}
              </Button>
            </>
          )}

          {authenticated && full && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="h6" gutterBottom>{tr('fullDetails')}</Typography>

              {/* Current state */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{tr('location')}</Typography>
                  <Typography>{String(full.location ?? '—')}</Typography>
                </Box>
                {!!full.issuedToDept && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography color="text.secondary">{tr('issuedToDept')}</Typography>
                    <Typography>{String(full.issuedToDept)}</Typography>
                  </Box>
                )}
                {!!full.issuedToPerson && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography color="text.secondary">{tr('issuedToPerson')}</Typography>
                    <Typography>{String(full.issuedToPerson)}</Typography>
                  </Box>
                )}
                {!!full.serialNumber && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography color="text.secondary">{tr('serialNumber')}</Typography>
                    <Typography>{String(full.serialNumber)}</Typography>
                  </Box>
                )}
                {!!full.udi && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography color="text.secondary">{tr('udi')}</Typography>
                    <Typography>{String(full.udi)}</Typography>
                  </Box>
                )}
                {!!full.gtin && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography color="text.secondary">{tr('gtin')}</Typography>
                    <Typography>{String(full.gtin)}</Typography>
                  </Box>
                )}
                {!!full.lastScannedAt && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography color="text.secondary">{tr('lastScanned')}</Typography>
                    <Typography>{new Date(String(full.lastScannedAt)).toLocaleString('en-IN')}</Typography>
                  </Box>
                )}
              </Box>

              {/* Warranty & AMC */}
              {(!!full.warrantyExpiry || !!full.amcExpiry || !!full.amcVendor) && (
                <>
                  <Typography variant="subtitle2" gutterBottom>{tr('warrantyAmc')}</Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">{tr('warrantyExpiry')}</Typography>
                      <Typography>{fmtDate(full.warrantyExpiry)}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">{tr('amcVendor')}</Typography>
                      <Typography>{String(full.amcVendor ?? '—')}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">{tr('amcExpiry')}</Typography>
                      <Typography>{fmtDate(full.amcExpiry)}</Typography>
                    </Box>
                  </Box>
                </>
              )}

              {/* Purchase chain */}
              {(!!full.vendorName || !!full.poNumber || !!full.invoiceNumber || !!full.receiptNumber || full.unitPrice || full.totalCost || full.receiptDate) && (
                <>
                  <Typography variant="subtitle2" gutterBottom>{tr('purchaseInformation')}</Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">{tr('vendor')}</Typography>
                      <Typography>{String(full.vendorName ?? '—')}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">{tr('poNumber')}</Typography>
                      <Typography>{String(full.poNumber ?? '—')}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">{tr('invoiceNumber')}</Typography>
                      <Typography>{String(full.invoiceNumber ?? '—')}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">{tr('receiptNumber')}</Typography>
                      <Typography>{String(full.receiptNumber ?? '—')}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">{tr('purchaseReceiptDate')}</Typography>
                      <Typography>{fmtDate(full.receiptDate)}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">{tr('unitPrice')}</Typography>
                      <Typography>{fmtMoney(full.unitPrice)}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">{tr('totalCostInclGst')}</Typography>
                      <Typography fontWeight={600}>{fmtMoney(full.totalCost)}</Typography>
                    </Box>
                  </Box>
                </>
              )}

              {/* Depreciation */}
              {(full.usefulLifeYears || full.depreciationMethod || full.salvageValue) && (
                <>
                  <Typography variant="subtitle2" gutterBottom>{tr('depreciation')}</Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">{tr('usefulLife')}</Typography>
                      <Typography>{full.usefulLifeYears ? tr('years', { n: full.usefulLifeYears }) : '—'}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">{tr('depreciationMethod')}</Typography>
                      <Typography>{String(full.depreciationMethod ?? '—').replace(/_/g, ' ')}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">{tr('salvageValue')}</Typography>
                      <Typography>{fmtMoney(full.salvageValue)}</Typography>
                    </Box>
                  </Box>
                </>
              )}

              {/* Movement history */}
              {Array.isArray(full.movements) && (full.movements as Record<string, unknown>[]).length > 0 ? (
                <>
                  <Typography variant="subtitle2" gutterBottom>{tr('movementHistory')}</Typography>
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

              {/* Full procurement traceability chain */}
              <Divider sx={{ my: 2 }} />
              <Typography variant="h6" gutterBottom>{tr('procurementTraceability')}</Typography>
              <TraceabilityChain trace={full as unknown as TraceData} hideNavigation />

            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
