import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { keyframes } from '@emotion/react';
import {
  Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, LinearProgress, Snackbar, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, TextField, Typography, Skeleton,
} from '@mui/material';
import {
  AccountBalance as AccountBalanceIcon,
  AccountBalanceWallet as WalletIcon,
  Close as CloseIcon,
  AttachMoney as MoneyIcon,
  CalendarMonth as CalendarIcon,
  NotificationsActive as SirenIcon,
  Payments as PaymentsIcon,
  ReceiptLong as ReceiptIcon,
  TrendingDown as TrendDownIcon,
  TrendingUp as TrendUpIcon,
  Work as WorkIcon,
} from '@mui/icons-material';
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api from '../config/api';
import { formatCurrency, formatDate } from '../utils/enumOptions';
import { useAuthStore } from '../stores/authStore';
import RateTrackerWidget from '../components/RateTrackerWidget';
import { VoucherPreviewDialog, usePrefetchVoucher } from '../components/VoucherPrint';

interface DashboardData {
  project: { name: string; status: string } | null;
  pureBankInward: number;
  shortAdvance: number;
  totalInwardFunds: number;
  totalExpenditure: number;
  bankExpenditure: number;
  cashExpenditure: number;
  balance: number;
  bankBalance: number;
  cashBalance: number;
  budgetHeads: Array<{ id: string; particulars: string; allocated: number; actual: number; available: number; utilizationPct: number }>;
  budgetTotals: { totalAllocated: number; totalActual: number; totalCommitted: number; totalRemaining: number; utilizationPct: number };
  pendingPayments: number;
  pendingQuotations: number;
  pendingPOs: number;
  pendingInvoices: number;
  actionItems: Array<{ id: string; type: string; code: string; status: string; createdAt: string; path: string }>;
  recentTransactions: Array<{ id: string; account: string; accountType: 'BANK' | 'CASH'; type: string; isInflow: boolean; amount: number; description: string; date: string }>;
  recentQuotations: Array<{ id: string; quotationNumber: string; vendorName: string; grandTotal: number; status: string; createdAt: string }>;
  recentPOs: Array<{ id: string; poNumber: string; vendorName: string; grandTotal: number; status: string; createdAt: string }>;
  recentInvoices: Array<{ id: string; invoiceCode: string; vendorName: string; totalAmount: number; verificationStatus: string; createdAt: string }>;
  phases: Array<{ id: string; name: string; status: string; progressPercent: number }>;
  projectTimeline: { startDate: string; endDate: string | null } | null;
}

interface TrendData { trend: Array<{ date: string; amount: number }>; total: number }
interface ExpenditureDetailData {
  totalAmount: number;
  totalCount: number;
  transactions: Array<{ id: string; account: string; accountType: 'BANK' | 'CASH'; amount: number; description: string; date: string; voucherId?: string | null; budgetHead: { particulars: string } | null }>;
}
interface InwardDetailData {
  transactions: Array<{ id: string; account: string; accountType: 'BANK' | 'CASH'; amount: number; description: string; type: string; date: string }>;
}
interface ShortAdvanceDetailData {
  totalAmount: number;
  totalCount: number;
  transactions: Array<{ id: string; account: string; amount: number; description: string; type: string; ledger: string; voucherId?: string | null; date: string }>;
}

// Dashboard-only timeline display requested by the business layout. This does
// not mutate Project master dates or affect scheduling/progress records elsewhere.
const DASHBOARD_TIMELINE = { startDate: '2026-09-03', endDate: '2027-10-09' };

// ── Dark reference palette (dashboard page only — other screens untouched) ──
const D = {
  bg: '#0d1524',
  card: '#141f31',
  cardBorder: 'rgba(148, 163, 184, 0.12)',
  text: '#e8edf7',
  textDim: '#8b98ad',
  teal: '#2fd9a4',
  red: '#ff5c7a',
  violet: '#8b7cf6',
  blue: '#4f9cf9',
  amber: '#f7b955',
};

// Numeric font — resolves to SF Pro on iOS/macOS/iPadOS (via -apple-system),
// falls back to the app font elsewhere. Applied to numeric displays only.
const NUM_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Roboto, "Helvetica Neue", Arial, sans-serif';

const darkCard = {
  bgcolor: D.card,
  border: '1px solid',
  borderColor: D.cardBorder,
  borderRadius: 2.5,
  boxShadow: 'none',
  minWidth: 0,
  overflow: 'hidden',
} as const;

const cellSx = { py: 0.35, px: 0.8, fontSize: '0.7rem', whiteSpace: 'nowrap' as const, color: D.text };
const sectionTitleSx = { fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.6, mb: 0.6, color: D.text };

// Siren pulse animation for the Action Required alert card.
const sirenPulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(255, 92, 122, .5); }
  70% { box-shadow: 0 0 0 10px rgba(255, 92, 122, 0); }
  100% { box-shadow: 0 0 0 0 rgba(255, 92, 122, 0); }
`;
const sirenIconPulse = keyframes`
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.18); opacity: .7; }
`;

function Section({ title, icon, children, sx = {}, action }: { title: string; icon?: ReactNode; children: ReactNode; sx?: object; action?: ReactNode }) {
  return (
    <Card sx={{ ...darkCard, height: '100%', ...sx }}>
      <CardContent sx={{ p: 1.4, '&:last-child': { pb: 1.4 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={sectionTitleSx}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{icon}{title}</span>
          {action}
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// Mini sparkline — the reference's colored strip under each KPI value.
function Sparkline({ points, color }: { points: { v: number }[]; color: string }) {
  if (points.length < 2) return null;
  return (
    <Box sx={{ height: 34, mt: 0.8, mx: -0.4 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Area type="monotone" dataKey="v" stroke={color} fill={color} fillOpacity={0.18} strokeWidth={1.8} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}

// Amount font scales down for long values so the full figure is always
// readable — never truncated with an ellipsis.
function kpiFont(formatted: string) {
  const len = formatted.length;
  if (len > 17) return { xs: '0.68rem', sm: '0.85rem' };
  if (len > 15) return { xs: '0.78rem', sm: '0.95rem' };
  if (len > 12) return { xs: '0.95rem', sm: '1.15rem' };
  return { xs: '1.15rem', sm: '1.4rem' };
}

function KpiCard({ title, value, subtitle, color, delta, spark, onClick }: {
  title: string; value: number; subtitle: string; color: string;
  delta?: { pct: number; up: boolean } | null;
  spark?: { v: number }[];
  onClick?: () => void;
}) {
  const formatted = formatCurrency(value);
  return (
    <Card
      onClick={onClick}
      onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick(); }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      sx={{ ...darkCard, cursor: onClick ? 'pointer' : 'default', '&:hover': onClick ? { borderColor: 'rgba(148,163,184,.3)' } : undefined, transition: 'border-color .2s' }}
    >
      <CardContent sx={{ p: 1.4, '&:last-child': { pb: 1.4 }, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.5} sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: D.textDim, letterSpacing: '0.02em' }} noWrap>{title}</Typography>
          {delta && (
            <Chip
              size="small"
              icon={delta.up ? <TrendUpIcon sx={{ fontSize: '12px !important' }} /> : <TrendDownIcon sx={{ fontSize: '12px !important' }} />}
              label={`${delta.pct.toFixed(1)}%`}
              sx={{
                height: 19, fontSize: '0.62rem', fontWeight: 700, flexShrink: 0, fontFamily: NUM_FONT,
                color: delta.up ? D.teal : D.red,
                bgcolor: delta.up ? 'rgba(47,217,164,.12)' : 'rgba(255,92,122,.12)',
                '& .MuiChip-icon': { color: 'inherit' },
              }}
            />
          )}
        </Stack>
        <Typography title={formatted} sx={{ mt: 0.5, fontSize: kpiFont(formatted), fontWeight: 800, color: D.text, lineHeight: 1.15, whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: NUM_FONT }}>
          {formatted}
        </Typography>
        <Typography sx={{ fontSize: '0.66rem', color: D.textDim, mt: 0.25 }}>{subtitle}</Typography>
        {spark && <Sparkline points={spark} color={color} />}
      </CardContent>
    </Card>
  );
}

export default function DenseAdminDashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['/dashboard', 'admin-summary'],
    queryFn: async () => (await api.get('/dashboard/admin-summary')).data,
    // Poll frequently so approvals made on another device/section clear the
    // "Action Required" card quickly, and always refetch when the app window
    // regains focus (e.g. switching back from the POS/quotations section).
    refetchInterval: 10000,
    refetchOnWindowFocus: 'always',
  });
  const { data: trend } = useQuery<TrendData>({
    queryKey: ['/dashboard', 'admin-outflow-trend', 30],
    queryFn: async () => (await api.get('/dashboard/admin-outflow-trend', { params: { days: 30 } })).data,
    refetchInterval: 30000,
  });
  const [expenditureOpen, setExpenditureOpen] = useState(false);
  const [inwardOpen, setInwardOpen] = useState(false);
  const [shortAdvanceOpen, setShortAdvanceOpen] = useState(false);
  const [voucherPreviewId, setVoucherPreviewId] = useState<string | null>(null);
  const [noVoucherHint, setNoVoucherHint] = useState(false);
  const prefetchVoucher = usePrefetchVoucher();
  const [expDateStart, setExpDateStart] = useState('');
  const [expDateEnd, setExpDateEnd] = useState('');
  const { data: expenditureDetails, isLoading: expenditureDetailsLoading } = useQuery<ExpenditureDetailData>({
    queryKey: ['/dashboard', 'outflow-by-range', expDateStart, expDateEnd],
    queryFn: async () => (await api.get('/dashboard/outflow-by-range', {
      params: {
        all: 'true',
        allTime: (!expDateStart && !expDateEnd) ? 'true' : 'false',
        startDate: expDateStart || undefined,
        endDate: expDateEnd || undefined,
      },
    })).data,
    enabled: expenditureOpen,
  });
  const { data: inwardDetails, isLoading: inwardDetailsLoading } = useQuery<InwardDetailData>({
    queryKey: ['/dashboard', 'admin-inflow-detail'],
    queryFn: async () => (await api.get('/dashboard/admin-inflow-detail', { params: { limit: 5000 } })).data,
    enabled: inwardOpen,
  });
  const { data: shortAdvanceDetails, isLoading: shortAdvanceDetailsLoading } = useQuery<ShortAdvanceDetailData>({
    queryKey: ['/dashboard', 'admin-short-advance-detail'],
    queryFn: async () => (await api.get('/dashboard/admin-short-advance-detail', { params: { limit: 5000 } })).data,
    enabled: shortAdvanceOpen,
  });

  // ── Work Calendar: fetch this month's tasks for the dashboard card ──
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const { data: workTasksData } = useQuery<{ data: Array<{ id: string; title: string; status: string; scheduledDate: string; deadlineDate: string | null }> }>({
    queryKey: ['/work-tasks', 'calendar', 'dashboard', monthStart.toISOString(), monthEnd.toISOString()],
    queryFn: async () => {
      const res = await api.get('/work-tasks/calendar', {
        params: { startDate: monthStart.toISOString().slice(0, 10), endDate: monthEnd.toISOString().slice(0, 10) },
      });
      return res.data;
    },
    refetchInterval: 30000,
  });
  const workTasks = workTasksData?.data ?? [];
  const pendingWorkTasks = workTasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED');
  const todayStr = new Date().toISOString().slice(0, 10);
  const todaysTasks = workTasks.filter((t) => t.scheduledDate?.slice(0, 10) === todayStr);

  const timeline = useMemo(() => {
    const start = new Date(DASHBOARD_TIMELINE.startDate).getTime();
    const end = new Date(DASHBOARD_TIMELINE.endDate).getTime();
    const now = Date.now();
    return Math.min(100, Math.max(0, ((now - start) / Math.max(1, end - start)) * 100));
  }, [data?.projectTimeline]);
  const heads = (data?.budgetHeads ?? []).slice(0, 6);
  const budgetRemaining = data?.budgetTotals?.totalRemaining ?? 0;
  const budgetPct = data?.budgetTotals?.utilizationPct ?? 0;
  const budgetSpent = data?.budgetTotals?.totalActual ?? 0;
  const budgetTotal = data?.budgetTotals?.totalAllocated ?? 0;
  const loading = isLoading || !data;

  // Real sparkline/delta data — expenditure from the 30d trend series
  // (week-over-week %), inward from the recent inflow transactions.
  const expenditureSpark = useMemo(() => (trend?.trend ?? []).map((p) => ({ v: p.amount })), [trend]);
  const expenditureDelta = useMemo(() => {
    const points = trend?.trend ?? [];
    if (points.length < 14) return null;
    const last7 = points.slice(-7).reduce((s, p) => s + p.amount, 0);
    const prev7 = points.slice(-14, -7).reduce((s, p) => s + p.amount, 0);
    if (prev7 <= 0) return null;
    const pct = ((last7 - prev7) / prev7) * 100;
    return { pct: Math.abs(pct), up: pct >= 0 };
  }, [trend]);
  const inwardSpark = useMemo(() =>
    (data?.recentTransactions ?? [])
      .filter((t) => t.isInflow)
      .slice()
      .reverse()
      .map((t) => ({ v: t.amount })),
    [data]);

  return (
    <Box sx={{ minHeight: { xs: 'auto', md: 'calc(100vh - 74px)' }, bgcolor: D.bg, color: D.text, mx: { xs: -1.5, sm: -2, md: -3 }, px: { xs: 1.2, sm: 2, md: 2.5 }, py: { xs: 1.2, md: 2 }, overflowX: 'clip' }}>
      {/* ── Greeting + timeline ── */}
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1} sx={{ mb: 1.4 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, lineHeight: 1.2 }}>
            Welcome Back, {user?.name ?? 'Admin'} 👋
          </Typography>
          <Typography sx={{ fontSize: '0.74rem', color: D.textDim }}>
            {data?.project?.name ?? 'Project'} · Here's what's happening in your business.
          </Typography>
        </Box>
        <Card sx={{ ...darkCard, flex: { xs: 'none', sm: '0 1 380px' }, width: { xs: '100%', sm: 'auto' } }}>
          <CardContent sx={{ py: 0.7, px: 1.1, '&:last-child': { pb: 0.7 } }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: D.text }}><CalendarIcon sx={{ fontSize: 13, verticalAlign: 'middle', mr: 0.3, color: D.blue }} />Project Timeline</Typography>
              <Typography variant="caption" sx={{ color: D.textDim }}>{formatDate(DASHBOARD_TIMELINE.startDate)} → {formatDate(DASHBOARD_TIMELINE.endDate)}</Typography>
            </Stack>
            <LinearProgress variant="determinate" value={timeline ?? 0} sx={{ mt: 0.6, height: 6, borderRadius: 4, bgcolor: 'rgba(148,163,184,.15)', '& .MuiLinearProgress-bar': { bgcolor: D.blue } }} />
          </CardContent>
        </Card>
      </Stack>

      {/* ── KPI cards — 2×2 on mobile, 4-across on desktop, sparklines under values ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }, gap: { xs: 1, md: 1.2 }, mb: 1.4 }}>
        <KpiCard title="Inward Funds" value={data?.pureBankInward ?? 0} subtitle="All funds received" color={D.teal} spark={inwardSpark} onClick={() => setInwardOpen(true)} />
        <KpiCard title="Total Expenditure" value={data?.totalExpenditure ?? 0} subtitle="All posted spend" color={D.red} delta={expenditureDelta} spark={expenditureSpark} onClick={() => setExpenditureOpen(true)} />
        <KpiCard title="Short Advance / Loan" value={data?.shortAdvance ?? 0} subtitle="Cash loans received" color={D.violet} onClick={() => setShortAdvanceOpen(true)} />
        <KpiCard title="Balance" value={data?.balance ?? 0} subtitle="Inward + loans − spend" color={D.blue} />
      </Box>

      {/* ── Overview row: donut + action + work + spend range ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', lg: 'minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)' }, gap: { xs: 1, md: 1.2 }, mb: 1.4 }}>
        {/* Business/Budget overview donut */}
        <Section title="Budget Overview" icon={<MoneyIcon sx={{ fontSize: 15, color: D.blue }} />}
          action={<Chip size="small" label="Live" sx={{ height: 18, fontSize: '0.58rem', color: D.teal, bgcolor: 'rgba(47,217,164,.12)' }} />}>
          {loading ? <Skeleton variant="circular" width={90} height={90} sx={{ mx: 'auto', bgcolor: 'rgba(148,163,184,.12)' }} /> : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.2, sm: 2 }, minWidth: 0 }}>
              <Box sx={{ position: 'relative', width: { xs: 96, sm: 112 }, height: { xs: 96, sm: 112 }, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={[{ v: Math.max(0, budgetSpent) }, { v: Math.max(0, budgetRemaining) }]} dataKey="v" innerRadius="62%" outerRadius="88%" startAngle={90} endAngle={-270} paddingAngle={2} stroke="none">
                      <Cell fill={D.red} /><Cell fill={D.violet} />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, color: D.text, lineHeight: 1, fontFamily: NUM_FONT }}>{budgetPct.toFixed(0)}%</Typography>
                  <Typography sx={{ fontSize: '0.55rem', color: D.textDim }}>Utilized</Typography>
                </Box>
              </Box>
              <Stack spacing={0.7} sx={{ flex: 1, minWidth: 0 }}>
                {[
                  { label: 'Approved', value: budgetTotal, color: D.blue },
                  { label: 'Spent', value: budgetSpent, color: D.red },
                  { label: 'Remaining', value: budgetRemaining, color: D.teal },
                ].map((r) => (
                  <Stack key={r.label} direction="row" alignItems="center" spacing={0.7} sx={{ minWidth: 0 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: r.color, flexShrink: 0 }} />
                    <Typography sx={{ fontSize: '0.68rem', color: D.textDim, flex: 1 }} noWrap>{r.label}</Typography>
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: D.text, fontFamily: NUM_FONT }}>{formatCurrency(r.value)}</Typography>
                  </Stack>
                ))}
                <LinearProgress variant="determinate" value={Math.min(100, budgetPct)} sx={{ mt: 0.3, height: 5, borderRadius: 3, bgcolor: 'rgba(148,163,184,.15)', '& .MuiLinearProgress-bar': { bgcolor: D.red } }} />
              </Stack>
            </Box>
          )}
        </Section>

        {/* Action Required — siren alert card */}
        <Card sx={{ ...darkCard, borderColor: 'rgba(255,92,122,.4)', bgcolor: 'rgba(255,92,122,.07)', animation: `${sirenPulse} 1.8s infinite`, display: 'flex', flexDirection: 'column' }}>
          <CardContent sx={{ p: 1.2, '&:last-child': { pb: 1.2 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.4 }}>
              <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: D.red, display: 'flex', alignItems: 'center', gap: 0.5 }}>Action Required</Typography>
              <SirenIcon sx={{ fontSize: 20, color: D.red, animation: `${sirenIconPulse} 1s infinite` }} />
            </Stack>
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.3, overflow: 'auto', '&::-webkit-scrollbar': { width: 4 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(148,163,184,.3)', borderRadius: 2 } }}>
              {loading ? <Skeleton variant="rectangular" height={20} sx={{ bgcolor: 'rgba(148,163,184,.12)' }} /> : (data?.actionItems ?? []).length === 0 ? (
                <Typography variant="caption" sx={{ textAlign: 'center', py: 1, color: D.textDim }}>No pending action</Typography>
              ) : (
                <>
                  <Typography sx={{ fontSize: '1.35rem', fontWeight: 900, color: D.red, lineHeight: 1, textAlign: 'center', fontFamily: NUM_FONT }}>{data?.actionItems?.length}</Typography>
                  <Typography variant="caption" sx={{ textAlign: 'center', fontWeight: 700, mb: 0.3, color: D.red }}>pending items</Typography>
                  {(data?.actionItems ?? []).map((item) => (
                    <Chip key={`${item.type}-${item.id}`} clickable onClick={() => navigate(item.path)} label={`${item.type === 'purchase-order' ? 'PO' : item.type === 'quotation' ? 'Quotation' : item.type === 'invoice' ? 'Invoice' : 'Payment'} ${item.code}`} variant="outlined" sx={{ height: 20, fontSize: '0.58rem', justifyContent: 'space-between', color: D.red, borderColor: 'rgba(255,92,122,.4)' }} />
                  ))}
                </>
              )}
            </Box>
          </CardContent>
        </Card>

        {/* Work Calendar */}
        <Card onClick={() => navigate('/work-calendar')} sx={{ ...darkCard, cursor: 'pointer', '&:hover': { borderColor: 'rgba(148,163,184,.3)' }, transition: 'border-color .2s', display: 'flex', flexDirection: 'column' }}>
          <CardContent sx={{ p: 1.2, '&:last-child': { pb: 1.2 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: D.blue, display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.4 }}><WorkIcon sx={{ fontSize: 15 }} />Work Calendar</Typography>
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.4 }}>
              <Typography sx={{ fontSize: '1.35rem', fontWeight: 900, color: D.blue, lineHeight: 1, textAlign: 'center', fontFamily: NUM_FONT }}>{todaysTasks.length}</Typography>
              <Typography variant="caption" sx={{ textAlign: 'center', fontWeight: 700, color: D.blue }}>tasks today</Typography>
              <Stack direction="row" spacing={0.5} justifyContent="center">
                <Chip label={`${pendingWorkTasks.length} pending`} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.55rem', color: pendingWorkTasks.length > 0 ? D.amber : D.teal, borderColor: 'rgba(148,163,184,.3)' }} />
                <Chip label={`${workTasks.length} total`} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.55rem', color: D.textDim, borderColor: 'rgba(148,163,184,.3)' }} />
              </Stack>
            </Box>
          </CardContent>
        </Card>

        {/* Expenditure date range */}
        <Section title="Spend Range" icon={<CalendarIcon sx={{ fontSize: 15, color: D.violet }} />}>
          <Stack spacing={0.7} sx={{ height: '100%', justifyContent: 'center' }}>
            <TextField type="date" size="small" label="From" value={expDateStart} onChange={(e) => setExpDateStart(e.target.value)} InputLabelProps={{ shrink: true }}
              sx={{ '& .MuiInputBase-input': { fontSize: '0.72rem', py: 0.5, color: D.text }, '& .MuiInputLabel-root': { color: D.textDim }, '& .MuiOutlinedInput-notchedOutline': { borderColor: D.cardBorder }, '& .MuiInputBase-root': { bgcolor: 'rgba(148,163,184,.06)' }, '& input::-webkit-calendar-picker-indicator': { filter: 'invert(.7)' } }} />
            <TextField type="date" size="small" label="To" value={expDateEnd} onChange={(e) => setExpDateEnd(e.target.value)} InputLabelProps={{ shrink: true }}
              sx={{ '& .MuiInputBase-input': { fontSize: '0.72rem', py: 0.5, color: D.text }, '& .MuiInputLabel-root': { color: D.textDim }, '& .MuiOutlinedInput-notchedOutline': { borderColor: D.cardBorder }, '& .MuiInputBase-root': { bgcolor: 'rgba(148,163,184,.06)' }, '& input::-webkit-calendar-picker-indicator': { filter: 'invert(.7)' } }} />
            <Stack direction="row" spacing={0.5}>
              <Button size="small" variant="contained" onClick={() => setExpenditureOpen(true)} sx={{ fontSize: '0.64rem', py: 0.3, flex: 1, bgcolor: D.violet, '&:hover': { bgcolor: '#7a6ae8' } }}>View Spend</Button>
              {(expDateStart || expDateEnd) && <Button size="small" onClick={() => { setExpDateStart(''); setExpDateEnd(''); }} sx={{ fontSize: '0.64rem', py: 0.3, color: D.textDim }}>Clear</Button>}
            </Stack>
          </Stack>
        </Section>
      </Box>

      {/* ── Middle: activity feed + expenditure trend ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(0, 1.4fr)' }, gap: { xs: 1, md: 1.2 }, mb: 1.4 }}>
        <Section title="Recent Transactions" icon={<PaymentsIcon sx={{ fontSize: 15, color: D.teal }} />}
          action={<Typography component="span" onClick={() => setExpenditureOpen(true)} sx={{ fontSize: '0.66rem', color: D.blue, cursor: 'pointer', fontWeight: 600 }}>View All</Typography>}>
          <Box sx={{ maxHeight: 260, overflowY: 'auto', pr: 0.4, '&::-webkit-scrollbar': { width: 5 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(148,163,184,.3)', borderRadius: 3 } }}>
            <Stack spacing={0.9}>
              {(data?.recentTransactions ?? []).map((tx) => (
                <Stack key={tx.id} direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                  <Box sx={{ width: 30, height: 30, borderRadius: 1.6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: tx.isInflow ? 'rgba(47,217,164,.12)' : 'rgba(255,92,122,.12)' }}>
                    {tx.isInflow ? <TrendUpIcon sx={{ fontSize: 15, color: D.teal }} /> : <TrendDownIcon sx={{ fontSize: 15, color: D.red }} />}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: D.text }} noWrap>{tx.description || tx.account}</Typography>
                    <Typography sx={{ fontSize: '0.6rem', color: D.textDim }} noWrap>{tx.account} · {timeAgo(tx.date)}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: tx.isInflow ? D.teal : D.red, flexShrink: 0, fontFamily: NUM_FONT }}>{tx.isInflow ? '+' : '−'}{formatCurrency(tx.amount)}</Typography>
                </Stack>
              ))}
              {!loading && (data?.recentTransactions ?? []).length === 0 && <Typography sx={{ fontSize: '0.7rem', color: D.textDim, textAlign: 'center', py: 2 }}>No transactions yet.</Typography>}
            </Stack>
          </Box>
        </Section>

        <Section title="Expenditure Trend" icon={<TrendDownIcon sx={{ fontSize: 15, color: D.red }} />}
          action={<Typography component="span" sx={{ fontSize: '0.66rem', color: D.textDim }}>Last 30 days</Typography>}>
          <Box sx={{ height: { xs: 190, md: 230 }, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={(trend?.trend ?? []).map((point) => ({ ...point, date: new Date(point.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) }))} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="expTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={D.red} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={D.red} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 8.5, fill: D.textDim }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} contentStyle={{ background: D.card, border: `1px solid ${D.cardBorder}`, borderRadius: 8, fontSize: 11 }} labelStyle={{ color: D.textDim }} itemStyle={{ color: D.text }} />
                <Area type="monotone" dataKey="amount" stroke={D.red} fill="url(#expTrendFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        </Section>
      </Box>

      {/* ── Budget heads table + Bank & Cash ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 2fr) minmax(0, 1fr)' }, gap: { xs: 1, md: 1.2 }, mb: 1.4 }}>
        <Section title="Budget Heads" icon={<WalletIcon sx={{ fontSize: 15, color: D.amber }} />}
          action={<Typography component="span" onClick={() => navigate('/budget-heads')} sx={{ fontSize: '0.66rem', color: D.blue, cursor: 'pointer', fontWeight: 600 }}>View All</Typography>}>
          <Box sx={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', '&::-webkit-scrollbar': { height: 5 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(148,163,184,.3)', borderRadius: 3 } }}>
            <Table size="small" sx={{ minWidth: 560 }}>
              <TableHead>
                <TableRow>
                  {['Budget Head', 'Approved', 'Actual', 'Remaining', '% Used'].map((h, i) => (
                    <TableCell key={h} align={i === 0 ? 'left' : 'right'} sx={{ ...cellSx, color: D.textDim, fontWeight: 700, borderBottom: `1px solid ${D.cardBorder}`, fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {heads.map((head) => (
                  <TableRow key={head.id} hover onClick={() => navigate('/budget-heads')} sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'rgba(148,163,184,.06)' }, '& td': { borderBottom: `1px solid ${D.cardBorder}` } }}>
                    <TableCell sx={cellSx} title={head.particulars}><Typography sx={{ fontSize: '0.68rem', maxWidth: 150, color: D.text }} noWrap>{head.particulars}</Typography></TableCell>
                    <TableCell align="right" sx={{ ...cellSx, fontFamily: NUM_FONT }}>{formatCurrency(head.allocated)}</TableCell>
                    <TableCell align="right" sx={{ ...cellSx, fontFamily: NUM_FONT }}>{formatCurrency(head.actual)}</TableCell>
                    <TableCell align="right" sx={{ ...cellSx, fontFamily: NUM_FONT, color: head.available < 0 ? D.red : D.text }}>{formatCurrency(head.available)}</TableCell>
                    <TableCell align="right" sx={{ ...cellSx, minWidth: 80 }}>
                      <Chip size="small" label={`${head.utilizationPct.toFixed(0)}%`} sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, color: head.utilizationPct >= 90 ? D.red : head.utilizationPct >= 70 ? D.amber : D.teal, bgcolor: head.utilizationPct >= 90 ? 'rgba(255,92,122,.12)' : head.utilizationPct >= 70 ? 'rgba(247,185,85,.12)' : 'rgba(47,217,164,.12)' }} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Section>

        <Section title="Bank & Cash" icon={<AccountBalanceIcon sx={{ fontSize: 15, color: D.blue }} />}>
          <Stack spacing={1} sx={{ flex: 1, justifyContent: 'center' }}>
            {[
              { label: 'Bank Balance', value: data?.bankBalance ?? 0, color: D.blue },
              { label: 'Cash Balance', value: data?.cashBalance ?? 0, color: D.teal },
            ].map((r) => (
              <Stack key={r.label} direction="row" alignItems="center" spacing={1} sx={{ p: 1, borderRadius: 1.6, bgcolor: 'rgba(148,163,184,.05)', border: `1px solid ${D.cardBorder}` }}>
                <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: r.color, flexShrink: 0 }} />
                <Typography sx={{ fontSize: '0.7rem', color: D.textDim, flex: 1 }}>{r.label}</Typography>
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, color: D.text, fontFamily: NUM_FONT }}>{formatCurrency(r.value)}</Typography>
              </Stack>
            ))}
            <Stack direction="row" justifyContent="space-between" sx={{ px: 0.3 }}>
              <Typography sx={{ fontSize: '0.62rem', color: D.textDim }}>Total Liquid</Typography>
              <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: D.blue, fontFamily: NUM_FONT }}>{formatCurrency((data?.bankBalance ?? 0) + (data?.cashBalance ?? 0))}</Typography>
            </Stack>
          </Stack>
        </Section>
      </Box>

      {/* ── Recent records + rate tracker ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', lg: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 2fr)' }, gap: { xs: 1, md: 1.2 }, minWidth: 0 }}>
        <CompactRecordsDark title="Recent Quotations" rows={(data?.recentQuotations ?? []).slice(0, 3)} codeKey="quotationNumber" onAll={() => navigate('/quotations')} onRow={(r) => navigate(`/quotations?id=${r.id}`)} />
        <CompactRecordsDark title="Recent POs" rows={(data?.recentPOs ?? []).slice(0, 3)} codeKey="poNumber" onAll={() => navigate('/pos')} onRow={() => navigate('/pos')} />
        <CompactRecordsDark title="Recent Invoices" rows={(data?.recentInvoices ?? []).slice(0, 3)} codeKey="invoiceCode" onAll={() => navigate('/invoices')} onRow={() => navigate('/invoices')} />
        <Box sx={{ minHeight: 170, minWidth: 0, overflow: 'hidden' }}><RateTrackerWidget /></Box>
      </Box>

      {/* ── Detail dialogs (unchanged behavior) ── */}
      <Dialog open={inwardOpen} onClose={() => setInwardOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Box><Typography sx={{ fontWeight: 800 }}>Inward Funds Details</Typography><Typography variant="caption" color="text.secondary">Bank receipts only</Typography></Box>
          <Button aria-label="Close inward funds details" onClick={() => setInwardOpen(false)} sx={{ minWidth: 36, p: 0.5 }}><CloseIcon fontSize="small" /></Button>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {inwardDetailsLoading ? <Box sx={{ py: 6, textAlign: 'center' }}><Skeleton variant="rectangular" height={32} sx={{ mx: 2 }} /></Box> : (() => {
            const bankReceipts = (inwardDetails?.transactions ?? []).filter((transaction) => transaction.accountType === 'BANK' && ['DEPOSIT', 'MANUAL_DEPOSIT', 'REVERSAL_OUT'].includes(transaction.type));
            return <Box sx={{ overflowX: 'auto' }}>
              <Stack direction="row" spacing={2} sx={{ px: 2, py: 1, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider' }}><Typography variant="caption" fontWeight={700}>Net Inward: {formatCurrency(data?.pureBankInward ?? 0)}</Typography><Typography variant="caption" color="text.secondary">Records: {bankReceipts.length}</Typography></Stack>
              <Table size="small" sx={{ minWidth: 620 }}><TableHead><TableRow><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Date</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Type</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Bank Account</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Description</TableCell><TableCell align="right" sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Amount</TableCell></TableRow></TableHead><TableBody>{bankReceipts.map((transaction) => <TableRow key={transaction.id} hover><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>{formatDate(transaction.date)}</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}><Chip size="small" label={transaction.type === 'REVERSAL_OUT' ? 'Reversed Receipt' : 'Bank Receipt'} color={transaction.type === 'REVERSAL_OUT' ? 'error' : 'success'} sx={{ height: 18, fontSize: '0.6rem' }} /></TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>{transaction.account}</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }} title={transaction.description}>{transaction.description || '—'}</TableCell><TableCell align="right" sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap', fontWeight: 700, color: transaction.type === 'REVERSAL_OUT' ? 'error.main' : 'success.main' }}>{transaction.type === 'REVERSAL_OUT' ? '−' : '+'}{formatCurrency(Math.abs(transaction.amount))}</TableCell></TableRow>)}</TableBody></Table>
              {!bankReceipts.length && <Typography sx={{ p: 3, textAlign: 'center' }} color="text.secondary">No bank receipts found.</Typography>}
            </Box>;
          })()}
        </DialogContent>
        <DialogActions><Button onClick={() => setInwardOpen(false)}>Close</Button></DialogActions>
      </Dialog>

      <Dialog open={expenditureOpen} onClose={() => setExpenditureOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Box><Typography sx={{ fontWeight: 800 }}>Expenditure Details</Typography><Typography variant="caption" color="text.secondary">{expDateStart || expDateEnd ? `${expDateStart ? formatDate(expDateStart) : 'Start'} → ${expDateEnd ? formatDate(expDateEnd) : 'End'}` : 'All posted Bank and Cash expenditure records'}</Typography></Box>
          <Button aria-label="Close expenditure details" onClick={() => setExpenditureOpen(false)} sx={{ minWidth: 36, p: 0.5 }}><CloseIcon fontSize="small" /></Button>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {expenditureDetailsLoading ? <Box sx={{ py: 6, textAlign: 'center' }}><Skeleton variant="rectangular" height={32} sx={{ mx: 2 }} /></Box> : (
            <Box sx={{ overflowX: 'auto' }}>
              <Stack direction="row" spacing={2} sx={{ px: 2, py: 1, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" fontWeight={700}>Total: {formatCurrency(expenditureDetails?.totalAmount ?? 0)}</Typography>
                <Typography variant="caption" color="text.secondary">Records: {expenditureDetails?.totalCount ?? 0}</Typography>
              </Stack>
              <Table size="small" sx={{ minWidth: 650 }}>
                <TableHead><TableRow><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Date</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Source</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Account</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Description</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Budget Head</TableCell><TableCell align="right" sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Amount</TableCell></TableRow></TableHead>
                <TableBody>{(expenditureDetails?.transactions ?? []).map((transaction) => <TableRow key={`${transaction.accountType}-${transaction.id}`} hover onClick={() => transaction.voucherId ? setVoucherPreviewId(transaction.voucherId) : setNoVoucherHint(true)} onMouseEnter={() => prefetchVoucher(transaction.voucherId)} onTouchStart={() => prefetchVoucher(transaction.voucherId)} sx={{ cursor: 'pointer' }} title={transaction.voucherId ? 'Tap to view voucher' : 'No voucher linked'}><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}><Stack direction="row" alignItems="center" spacing={0.5}>{transaction.voucherId && <ReceiptIcon sx={{ fontSize: 13, color: 'primary.main' }} />}<span>{formatDate(transaction.date)}</span></Stack></TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}><Chip size="small" label={transaction.accountType === 'BANK' ? 'Bank' : 'Cash'} color={transaction.accountType === 'BANK' ? 'primary' : 'warning'} sx={{ height: 18, fontSize: '0.6rem' }} /></TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>{transaction.account}</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={transaction.description}>{transaction.description || '—'}</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>{transaction.budgetHead?.particulars ?? '—'}</TableCell><TableCell align="right" sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap', fontWeight: 700, color: 'error.main' }}>{formatCurrency(transaction.amount)}</TableCell></TableRow>)}</TableBody>
              </Table>
              {!expenditureDetails?.transactions.length && <Typography sx={{ p: 3, textAlign: 'center' }} color="text.secondary">No expenditure records found.</Typography>}
            </Box>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setExpenditureOpen(false)}>Close</Button></DialogActions>
      </Dialog>

      <Dialog open={shortAdvanceOpen} onClose={() => setShortAdvanceOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Box><Typography sx={{ fontWeight: 800 }}>Short Advance / Loan Details</Typography><Typography variant="caption" color="text.secondary">Cash loan receipts only</Typography></Box>
          <Button aria-label="Close short advance details" onClick={() => setShortAdvanceOpen(false)} sx={{ minWidth: 36, p: 0.5 }}><CloseIcon fontSize="small" /></Button>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {shortAdvanceDetailsLoading ? <Box sx={{ py: 6, textAlign: 'center' }}><Skeleton variant="rectangular" height={32} sx={{ mx: 2 }} /></Box> : (
            <Box sx={{ overflowX: 'auto' }}>
              <Stack direction="row" spacing={2} sx={{ px: 2, py: 1, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" fontWeight={700}>Net Short Advance: {formatCurrency(shortAdvanceDetails?.totalAmount ?? 0)}</Typography>
                <Typography variant="caption" color="text.secondary">Records: {shortAdvanceDetails?.totalCount ?? 0}</Typography>
              </Stack>
              <Table size="small" sx={{ minWidth: 620 }}>
                <TableHead><TableRow><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Date</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Type</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Cash Account</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Loan Ledger</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Description</TableCell><TableCell align="right" sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Amount</TableCell></TableRow></TableHead>
                <TableBody>{(shortAdvanceDetails?.transactions ?? []).map((tx) => <TableRow key={tx.id} hover onClick={() => tx.voucherId ? setVoucherPreviewId(tx.voucherId) : setNoVoucherHint(true)} onMouseEnter={() => prefetchVoucher(tx.voucherId)} onTouchStart={() => prefetchVoucher(tx.voucherId)} sx={{ cursor: 'pointer' }} title={tx.voucherId ? 'Tap to view voucher' : 'No voucher linked'}><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}><Stack direction="row" alignItems="center" spacing={0.5}>{tx.voucherId && <ReceiptIcon sx={{ fontSize: 13, color: 'primary.main' }} />}<span>{formatDate(tx.date)}</span></Stack></TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}><Chip size="small" label={tx.type === 'REVERSAL_OUT' ? 'Reversed Loan' : 'Loan Receipt'} color={tx.type === 'REVERSAL_OUT' ? 'error' : 'warning'} sx={{ height: 18, fontSize: '0.6rem' }} /></TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>{tx.account}</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>{tx.ledger}</TableCell><TableCell sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={tx.description}>{tx.description || '—'}</TableCell><TableCell align="right" sx={{ py: 0.35, px: 0.8, fontSize: '0.68rem', whiteSpace: 'nowrap', fontWeight: 700, color: tx.type === 'REVERSAL_OUT' ? 'error.main' : 'warning.dark' }}>{tx.type === 'REVERSAL_OUT' ? '−' : '+'}{formatCurrency(Math.abs(tx.amount))}</TableCell></TableRow>)}</TableBody>
              </Table>
              {!shortAdvanceDetails?.transactions.length && <Typography sx={{ p: 3, textAlign: 'center' }} color="text.secondary">No cash loan receipts found.</Typography>}
            </Box>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setShortAdvanceOpen(false)}>Close</Button></DialogActions>
      </Dialog>

      {/* Related voucher — landscape sheet, horizontally scrollable on mobile */}
      <VoucherPreviewDialog voucherId={voucherPreviewId} onClose={() => setVoucherPreviewId(null)} />
      <Snackbar
        open={noVoucherHint}
        autoHideDuration={2500}
        onClose={() => setNoVoucherHint(false)}
        message="No voucher is linked to this payment"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
}

// Compact dark record card — Recent Quotations / POs / Invoices.
function CompactRecordsDark({ title, rows, codeKey, onAll, onRow }: {
  title: string;
  rows: Array<Record<string, any>>;
  codeKey: string;
  onAll: () => void;
  onRow: (row: any) => void;
}) {
  const amountKey = codeKey === 'invoiceCode' ? 'totalAmount' : 'grandTotal';
  return (
    <Card sx={{ ...darkCard, height: '100%' }}>
      <CardContent sx={{ p: 1.4, '&:last-child': { pb: 1.4 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.8 }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: D.text }}>{title}</Typography>
          <Typography component="span" onClick={onAll} sx={{ fontSize: '0.64rem', color: D.blue, cursor: 'pointer', fontWeight: 600 }}>View All</Typography>
        </Stack>
        <Stack spacing={0.8}>
          {rows.map((row) => (
            <Stack key={row.id} direction="row" alignItems="center" spacing={0.9} onClick={() => onRow(row)} sx={{ cursor: 'pointer', minWidth: 0 }}>
              <Box sx={{ width: 28, height: 28, borderRadius: 1.4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(79,156,249,.12)' }}>
                <ReceiptIcon sx={{ fontSize: 14, color: D.blue }} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: D.text }} noWrap>{row[codeKey]}</Typography>
                <Typography sx={{ fontSize: '0.6rem', color: D.textDim }} noWrap>{row.vendorName}</Typography>
              </Box>
              <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: D.text, flexShrink: 0, fontFamily: NUM_FONT }}>{formatCurrency(Number(row[amountKey] ?? 0))}</Typography>
            </Stack>
          ))}
          {rows.length === 0 && <Typography sx={{ fontSize: '0.68rem', color: D.textDim, textAlign: 'center', py: 1.5 }}>No records</Typography>}
        </Stack>
      </CardContent>
    </Card>
  );
}
