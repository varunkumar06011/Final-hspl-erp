import { Card, CardContent, Typography, Box, Alert } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import api from '../config/api';
import { formatCurrency } from '../utils/enumOptions';
import { useColorMode } from '../config/ColorModeContext';

export default function CashFlowForecast() {
  const { mode } = useColorMode();
  const chartTextColor = mode === 'dark' ? '#aaa' : '#666';
  const chartGridColor = mode === 'dark' ? '#333' : '#e0e0e0';

  const { data, isLoading } = useQuery({
    queryKey: ['/dashboard/cash-flow-forecast'],
    queryFn: async () => {
      const response = await api.get('/dashboard/cash-flow-forecast');
      return response.data;
    },
  });

  // Sample every 3rd day for the chart to keep it readable
  const chartData = (data?.projection ?? [])
    .filter((_: unknown, i: number) => i % 3 === 0)
    .map((d: { date: string; balance: number }) => ({
      date: new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      balance: d.balance,
    }));

  const minBalance = data?.minBalance ?? 0;
  const isNegative = minBalance < 0;

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          <Box>
            <Typography variant="h6">Cash Flow Forecast</Typography>
            <Typography variant="body2" color="text.secondary">
              Projected bank balance over the next 90 days
            </Typography>
          </Box>
          {!isLoading && data && (
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary">Current Balance</Typography>
              <Typography variant="h6" color="primary.main">{formatCurrency(data.currentBalance)}</Typography>
            </Box>
          )}
        </Box>

        {!isLoading && data && isNegative && (
          <Alert severity="error" sx={{ mb: 2 }}>
            <strong>Warning:</strong> Projected to run out of cash on{' '}
            {new Date(data.minBalanceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}.
            Minimum balance: {formatCurrency(data.minBalance)}
          </Alert>
        )}

        {!isLoading && data && !isNegative && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Cash position looks healthy. Minimum projected balance: {formatCurrency(data.minBalance)} on{' '}
            {new Date(data.minBalanceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}.
          </Alert>
        )}

        {isLoading ? (
          <Box sx={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography color="text.secondary">Loading forecast…</Typography>
          </Box>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="cashGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2196F3" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#2196F3" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
              <XAxis dataKey="date" tick={{ fill: chartTextColor, fontSize: 11 }} interval={2} />
              <YAxis
                tick={{ fill: chartTextColor, fontSize: 11 }}
                tickFormatter={(v) => `₹${Math.abs(Number(v) / 1000).toFixed(0)}k`}
              />
              <RechartsTooltip
                formatter={(value) => [formatCurrency(Number(value)), 'Balance']}
                contentStyle={{ background: mode === 'dark' ? '#1E1E1E' : '#fff', border: '1px solid #ccc', borderRadius: 8, fontSize: 13 }}
                labelStyle={{ color: chartTextColor }}
              />
              <ReferenceLine y={0} stroke="#F44336" strokeDasharray="5 5" label={{ value: 'Zero', fill: '#F44336', fontSize: 10 }} />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="#2196F3"
                strokeWidth={2}
                fill="url(#cashGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {!isLoading && data && (
          <Box sx={{ display: 'flex', gap: 3, mt: 2, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="caption" color="text.secondary">Pending Payments</Typography>
              <Typography variant="body2" fontWeight={600} color="error.main">
                {formatCurrency(data.totalPendingPayments)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Pending Invoices</Typography>
              <Typography variant="body2" fontWeight={600} color="warning.main">
                {formatCurrency(data.totalPendingInvoices)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Min Projected Balance</Typography>
              <Typography variant="body2" fontWeight={600} color={isNegative ? 'error.main' : 'success.main'}>
                {formatCurrency(data.minBalance)}
              </Typography>
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
