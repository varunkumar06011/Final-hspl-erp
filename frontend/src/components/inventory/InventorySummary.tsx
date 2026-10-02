import { Box, Card, Chip, Grid, LinearProgress, Stack, Typography, Alert } from '@mui/material';
import {
  AccountBalanceWallet as ValueIcon,
  Inventory2 as ItemsIcon,
  Warning as WarningIcon,
  Layers as LayersIcon,
  Category as CategoryIcon,
  Hotel as IdleIcon,
  CallReceived as ReceivedIcon,
  CallMade as IssuedIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatIndianNumber } from '../../utils/enumOptions';

export interface InventorySummaryData {
  totalValue: number;
  consumableValue: number;
  assetValue: number;
  itemCount: number;
  consumableCount: number;
  assetUnits: number;
  lowStockCount: number;
  outOfStockCount: number;
  lowStockItems: { id: string; name: string; unit: string; stock: number; min: number }[];
  valueByCategory: { category: string; value: number; items: number }[];
  topItems: { id: string; name: string; unit: string; stock: number; value: number }[];
  last30Days: { inValue: number; outValue: number; returnValue: number; inCount: number; outCount: number };
  consumptionByBudgetHead: { id: string; name: string; value: number }[];
  consumptionByPhase: { id: string; name: string; value: number }[];
  deadStock: { count: number; value: number };
  pending: { receiptsToProcess: number; entriesToApprove: number; gatePassesAwaiting: number; posAwaitingDelivery: number };
}

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

function StatCard({
  icon,
  label,
  value,
  sub,
  color = 'primary.main',
  emphasize,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
  emphasize?: boolean;
}) {
  return (
    <Card sx={{ p: 2, height: '100%', ...(emphasize ? { borderColor: color, borderWidth: 1, borderStyle: 'solid' } : {}) }}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Box sx={{ color, mt: 0.5 }}>{icon}</Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">{label}</Typography>
          <Typography variant="h6" sx={{ color, fontWeight: 600, lineHeight: 1.25, wordBreak: 'break-word' }}>{value}</Typography>
          {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
        </Box>
      </Stack>
    </Card>
  );
}

function BarList({ rows, total }: { rows: { key: string; label: string; value: number; sub?: string }[]; total: number }) {
  const { t } = useTranslation('inventory');
  if (rows.length === 0) return <Typography variant="body2" color="text.secondary">{t('noData')}</Typography>;
  return (
    <Stack spacing={1.25}>
      {rows.map((r) => (
        <Box key={r.key}>
          <Stack direction="row" justifyContent="space-between" spacing={1}>
            <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>{r.label}{r.sub ? ` · ${r.sub}` : ''}</Typography>
            <Typography variant="body2" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>{inr(r.value)}</Typography>
          </Stack>
          <LinearProgress variant="determinate" value={total > 0 ? Math.min(100, (r.value / total) * 100) : 0} sx={{ height: 5, borderRadius: 3 }} />
        </Box>
      ))}
    </Stack>
  );
}

export default function InventorySummary({ data }: { data: InventorySummaryData }) {
  const { t } = useTranslation('inventory');
  const navigate = useNavigate();
  const p = data.pending;
  const hasPending = p.receiptsToProcess + p.entriesToApprove + p.gatePassesAwaiting + p.posAwaitingDelivery > 0;
  const flow = data.last30Days;

  return (
    <Box sx={{ mb: 2 }}>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={6} md={4}>
          <StatCard
            emphasize
            icon={<ValueIcon />}
            label={t('totalStockValue')}
            value={inr(data.totalValue)}
            sub={`${t('consumableValue')}: ${inr(data.consumableValue)} · ${t('assetValue')}: ${inr(data.assetValue)}`}
          />
        </Grid>
        <Grid item xs={6} sm={3} md={2}>
          <StatCard icon={<ItemsIcon />} label={t('totalItems')} value={formatIndianNumber(data.itemCount)} />
        </Grid>
        <Grid item xs={6} sm={3} md={2}>
          <StatCard
            icon={<WarningIcon />}
            color={data.lowStockCount + data.outOfStockCount > 0 ? 'error.main' : 'text.secondary'}
            label={t('lowStock')}
            value={data.lowStockCount}
            sub={`${t('outOfStock')}: ${data.outOfStockCount}`}
          />
        </Grid>
        <Grid item xs={6} sm={3} md={2}>
          <StatCard icon={<LayersIcon />} color="secondary.main" label={t('assets')} value={formatIndianNumber(data.assetUnits)} />
        </Grid>
        <Grid item xs={6} sm={3} md={2}>
          <StatCard icon={<CategoryIcon />} color="success.main" label={t('consumables')} value={formatIndianNumber(data.consumableCount)} />
        </Grid>
        <Grid item xs={6} sm={4}>
          <StatCard icon={<ReceivedIcon />} color="success.main" label={t('receivedLast30')} value={inr(flow.inValue)} sub={`${t('returnedLast30')}: ${inr(flow.returnValue)}`} />
        </Grid>
        <Grid item xs={6} sm={4}>
          <StatCard icon={<IssuedIcon />} color="warning.main" label={t('issuedLast30')} value={inr(flow.outValue)} />
        </Grid>
        <Grid item xs={12} sm={4}>
          <StatCard
            icon={<IdleIcon />}
            color={data.deadStock.count > 0 ? 'warning.main' : 'text.secondary'}
            label={t('idleStock')}
            value={inr(data.deadStock.value)}
            sub={t('idleStockHint', { count: data.deadStock.count })}
          />
        </Grid>
      </Grid>

      {hasPending && (
        <Alert severity="info" sx={{ mb: 2, alignItems: 'center' }} icon={false}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('needsAttention')}</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {p.posAwaitingDelivery > 0 && (
              <Chip size="small" clickable label={t('posAwaitingDelivery', { count: p.posAwaitingDelivery })} onClick={() => navigate('/goods-receipts')} />
            )}
            {p.gatePassesAwaiting > 0 && (
              <Chip size="small" clickable color="warning" label={t('gatePassesAwaiting', { count: p.gatePassesAwaiting })} onClick={() => navigate('/goods-receipts')} />
            )}
            {p.receiptsToProcess > 0 && (
              <Chip size="small" clickable color="warning" label={t('receiptsToProcess', { count: p.receiptsToProcess })} onClick={() => navigate('/goods-receipts')} />
            )}
            {p.entriesToApprove > 0 && <Chip size="small" color="warning" label={t('entriesToApprove', { count: p.entriesToApprove })} />}
          </Stack>
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={6} lg={3}>
          <Card sx={{ p: 2, height: '100%' }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>{t('valueByCategory')}</Typography>
            <BarList
              total={data.consumableValue}
              rows={data.valueByCategory.map((c) => ({ key: c.category, label: c.category, value: c.value }))}
            />
          </Card>
        </Grid>
        <Grid item xs={12} md={6} lg={3}>
          <Card sx={{ p: 2, height: '100%' }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>{t('topItems')}</Typography>
            <BarList
              total={data.topItems[0]?.value ?? 0}
              rows={data.topItems.map((i) => ({ key: i.id, label: i.name, value: i.value, sub: `${formatIndianNumber(i.stock)} ${i.unit}` }))}
            />
          </Card>
        </Grid>
        <Grid item xs={12} md={6} lg={3}>
          <Card sx={{ p: 2, height: '100%' }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>{t('issuedByBudgetHead')}</Typography>
            <BarList
              total={flow.outValue}
              rows={data.consumptionByBudgetHead.map((h) => ({ key: h.id, label: h.name, value: h.value }))}
            />
          </Card>
        </Grid>
        <Grid item xs={12} md={6} lg={3}>
          <Card sx={{ p: 2, height: '100%' }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>{t('issuedByPhase')}</Typography>
            <BarList
              total={flow.outValue}
              rows={data.consumptionByPhase.map((h) => ({ key: h.id, label: h.name, value: h.value }))}
            />
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
