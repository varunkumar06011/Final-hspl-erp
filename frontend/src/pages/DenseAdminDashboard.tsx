import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { keyframes } from '@emotion/react';
import {
  Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, LinearProgress, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, Typography, Skeleton,
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
  Savings as LoanIcon,
  TrendingDown as TrendDownIcon,
  TrendingUp as TrendUpIcon,
} from '@mui/icons-material';
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api from '../config/api';
import { formatCurrency, formatDate } from '../utils/enumOptions';

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
  transactions: Array<{ id: string; account: string; accountType: 'BANK' | 'CASH'; amount: number; description: string; date: string; budgetHead: { particulars: string } | null }>;
}
interface InwardDetailData {
  transactions: Array<{ id: string; account: string; accountType: 'BANK' | 'CASH'; amount: number; description: string; type: string; date: string }>;
}

// Dashboard-only timeline display requested by the business layout. This does
// not mutate Project master dates or affect scheduling/progress records elsewhere.
const DASHBOARD_TIMELINE = { startDate: '2026-09-03', endDate: '2027-10-09' };
const compactCard = { border: '1px solid', borderColor: 'divider', borderRadius: 2, boxShadow: '0 1px 3px rgba(15, 23, 42, .08)', minWidth: 0, overflow: 'hidden' };
const financialCardContent = { height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', py: 1.1, px: { xs: 1, sm: 1.4, md: 1.8 }, '&:last-child': { pb: 1.1 } };
const cellSx = { py: 0.35, px: 0.75, fontSize: '0.68rem', whiteSpace: 'nowrap' as const };
const sectionTitleSx = { fontSize: '0.76rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.45 };

// Siren pulse animation for the Action Required alert card.
const sirenPulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(211, 47, 47, .55); }
  70% { box-shadow: 0 0 0 10px rgba(211, 47, 47, 0); }
  100% { box-shadow: 0 0 0 0 rgba(211, 47, 47, 0); }
`;
const sirenIconPulse = keyframes`
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.18); opacity: .7; }
`;

function Section({ title, icon, children, sx = {} }: { title: string; icon?: ReactNode; children: ReactNode; sx?: object }) {
  return <Card sx={{ ...compactCard, height: '100%', ...sx }}><CardContent sx={{ p: 0.8, '&:last-child': { pb: 0.8 }, height: '100%' }}><Typography sx={sectionTitleSx}>{icon}{title}</Typography>{children}</CardContent></Card>;
}

function StatusChip({ value }: { value: string }) {
  const color = value === 'APPROVED' || value === 'PAID' || value === 'COMPLETED' ? 'success' : value === 'REJECTED' ? 'error' : 'warning';
  return <Chip label={value.replace(/_/g, ' ')} color={color} size="small" sx={{ height: 17, fontSize: '0.58rem', maxWidth: 100 }} />;
}

export default function DenseAdminDashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['/dashboard/admin-summary'],
    queryFn: async () => (await api.get('/dashboard/admin-summary')).data,
    refetchInterval: 30000,
  });
  const { data: trend } = useQuery<TrendData>({
    queryKey: ['/dashboard/admin-outflow-trend', 30],
    queryFn: async () => (await api.get('/dashboard/admin-outflow-trend', { params: { days: 30 } })).data,
    refetchInterval: 30000,
  });
  const [expenditureOpen, setExpenditureOpen] = useState(false);
  const [inwardOpen, setInwardOpen] = useState(false);
  const { data: expenditureDetails, isLoading: expenditureDetailsLoading } = useQuery<ExpenditureDetailData>({
    queryKey: ['/dashboard/outflow-by-range', 'all'],
    queryFn: async () => (await api.get('/dashboard/outflow-by-range', { params: { all: 'true', allTime: 'true' } })).data,
    enabled: expenditureOpen,
  });
  const { data: inwardDetails, isLoading: inwardDetailsLoading } = useQuery<InwardDetailData>({
    queryKey: ['/dashboard/admin-inflow-detail'],
    queryFn: async () => (await api.get('/dashboard/admin-inflow-detail', { params: { limit: 5000 } })).data,
    enabled: inwardOpen,
  });

  const timeline = useMemo(() => {
    const start = new Date(DASHBOARD_TIMELINE.startDate).getTime();
    const end = new Date(DASHBOARD_TIMELINE.endDate).getTime();
    const now = Date.now();
    return Math.min(100, Math.max(0, ((now - start) / Math.max(1, end - start)) * 100));
  }, [data?.projectTimeline]);
  const heads = (data?.budgetHeads ?? []).slice(0, 6);
  const budgetRemaining = data?.budgetTotals.totalRemaining ?? 0;
  const budgetPct = data?.budgetTotals.utilizationPct ?? 0;
  const loading = isLoading || !data;

  return (
    <Box sx={{ height: { xs: 'auto', md: 'calc(100vh - 74px)' }, minHeight: 0, overflow: { xs: 'visible', md: 'hidden' }, bgcolor: 'background.default', p: { xs: 0.75, md: 1.25 }, display: 'grid', gridTemplateRows: { xs: 'auto', md: '58px 80px 1fr 108px' }, gap: 0.9 }}>
      {/* Header: project identity + timeline */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.15fr 1.25fr' }, gap: 0.8, minHeight: 0 }}>
        <Card sx={{ ...compactCard }}><CardContent sx={{ py: 0.65, px: 1, '&:last-child': { pb: 0.65 } }}>
          <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, lineHeight: 1.15 }}>Project Dashboard</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>{data?.project?.name ?? 'Project'} <Chip label={data?.project?.status ?? 'Loading'} size="small" color="success" sx={{ ml: 0.5, height: 16, fontSize: '0.58rem' }} /></Typography>
        </CardContent></Card>
        <Card sx={{ ...compactCard }}><CardContent sx={{ py: 0.55, px: 1, '&:last-child': { pb: 0.55 } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography sx={{ fontSize: '0.7rem', fontWeight: 700 }}><CalendarIcon sx={{ fontSize: 13, verticalAlign: 'middle', mr: 0.3 }} />Project Timeline</Typography><Typography variant="caption" color="text.secondary">{formatDate(DASHBOARD_TIMELINE.startDate)} → {formatDate(DASHBOARD_TIMELINE.endDate)}</Typography></Stack>
          <LinearProgress variant="determinate" value={timeline ?? 0} sx={{ mt: 0.8, height: 7, borderRadius: 4 }} />
        </CardContent></Card>
      </Box>

      {/* Primary financial cards: Inward + Short Advance − Expenditure = Balance */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }, gap: { xs: 0.8, sm: 1, md: 1.25 }, minHeight: 0, alignItems: 'stretch' }}>
        <Card onClick={() => setInwardOpen(true)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setInwardOpen(true); }} role="button" tabIndex={0} sx={{ ...compactCard, height: '100%', borderLeft: '4px solid', borderColor: 'success.main', bgcolor: 'rgba(232, 250, 241, .72)', cursor: 'pointer', '&:hover': { boxShadow: 3 } }}><CardContent sx={financialCardContent}><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography sx={{ fontSize: { xs: '0.72rem', sm: '0.82rem' }, fontWeight: 700 }}>Inward Funds</Typography><TrendUpIcon color="success" sx={{ fontSize: { xs: 17, sm: 20 } }} /></Stack><Typography sx={{ mt: 0.45, fontSize: { xs: '1rem', sm: '1.3rem', md: '1.48rem' }, fontWeight: 800, color: 'success.dark', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{loading ? <Skeleton width={145} /> : formatCurrency(data!.pureBankInward)}</Typography><Typography variant="caption" color="text.secondary" sx={{ mt: 0.3, fontSize: { xs: '0.62rem', sm: '0.7rem' } }}>All funds received</Typography></CardContent></Card>
        <Card sx={{ ...compactCard, height: '100%', borderLeft: '4px solid', borderColor: 'warning.main', bgcolor: 'rgba(255, 251, 231, .82)' }}><CardContent sx={financialCardContent}><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography sx={{ fontSize: { xs: '0.72rem', sm: '0.82rem' }, fontWeight: 700 }}>Short Advance / Loan</Typography><LoanIcon color="warning" sx={{ fontSize: { xs: 17, sm: 20 } }} /></Stack><Typography sx={{ mt: 0.45, fontSize: { xs: '1rem', sm: '1.3rem', md: '1.48rem' }, fontWeight: 800, color: 'warning.dark', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{loading ? <Skeleton width={145} /> : formatCurrency(data!.shortAdvance)}</Typography><Typography variant="caption" color="text.secondary" sx={{ mt: 0.3, fontSize: { xs: '0.62rem', sm: '0.7rem' } }}>Cash loans received</Typography></CardContent></Card>
        <Card onClick={() => setExpenditureOpen(true)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setExpenditureOpen(true); }} role="button" tabIndex={0} sx={{ ...compactCard, height: '100%', borderLeft: '4px solid', borderColor: 'error.main', bgcolor: 'rgba(255, 241, 242, .78)', cursor: 'pointer', '&:hover': { boxShadow: 3 } }}><CardContent sx={{ ...financialCardContent, justifyContent: 'flex-start', gap: 0.35 }}><Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ minHeight: 22 }}><Typography sx={{ fontSize: { xs: '0.72rem', sm: '0.82rem' }, fontWeight: 700 }}>Expenditure</Typography><TrendDownIcon color="error" sx={{ fontSize: { xs: 17, sm: 20 }, flexShrink: 0 }} /></Stack><Typography sx={{ fontSize: { xs: '1rem', sm: '1.3rem', md: '1.48rem' }, fontWeight: 800, color: 'error.dark', lineHeight: 1.15, whiteSpace: 'nowrap', mt: 0.15 }}>{loading ? <Skeleton width={145} /> : formatCurrency(data!.totalExpenditure)}</Typography><Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.62rem', sm: '0.7rem' }, lineHeight: 1.1 }}>All posted spend</Typography><Box sx={{ mt: 0.35, pt: 0.4, borderTop: '1px solid', borderColor: 'rgba(211, 47, 47, .2)', width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.3 }}><Box sx={{ minWidth: 0 }}><Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.6rem', lineHeight: 1 }}>Bank</Typography><Typography variant="caption" color="primary.main" sx={{ display: 'block', fontWeight: 700, fontSize: { xs: '0.62rem', sm: '0.68rem' }, lineHeight: 1.15, whiteSpace: 'nowrap' }}>{formatCurrency(data?.bankExpenditure ?? 0)}</Typography></Box><Box sx={{ minWidth: 0 }}><Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.6rem', lineHeight: 1 }}>Cash</Typography><Typography variant="caption" color="warning.dark" sx={{ display: 'block', fontWeight: 700, fontSize: { xs: '0.62rem', sm: '0.68rem' }, lineHeight: 1.15, whiteSpace: 'nowrap' }}>{formatCurrency(data?.cashExpenditure ?? 0)}</Typography></Box></Box></CardContent></Card>
        <Card sx={{ ...compactCard, height: '100%', borderLeft: '4px solid', borderColor: 'primary.main', bgcolor: 'rgba(237, 245, 255, .82)' }}><CardContent sx={financialCardContent}><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography sx={{ fontSize: { xs: '0.72rem', sm: '0.82rem' }, fontWeight: 700 }}>Balance</Typography><AccountBalanceIcon color="primary" sx={{ fontSize: { xs: 17, sm: 20 } }} /></Stack><Typography sx={{ mt: 0.45, fontSize: { xs: '1rem', sm: '1.3rem', md: '1.48rem' }, fontWeight: 800, color: 'primary.dark', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{loading ? <Skeleton width={145} /> : formatCurrency(data!.balance)}</Typography><Typography variant="caption" color="text.secondary" sx={{ mt: 0.3, fontSize: { xs: '0.62rem', sm: '0.7rem' } }}>Inward + loans − spend</Typography></CardContent></Card>
      </Box>

      {/* Dense middle area */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.25fr 0.95fr 0.9fr' }, gap: 0.8, minHeight: 0, overflow: 'hidden' }}>
        <Box sx={{ display: 'grid', gridTemplateRows: { xs: 'auto auto', md: '130px 1fr' }, gap: 0.8, minHeight: 0 }}>
          <Section title="Project Budget Overview" icon={<MoneyIcon color="primary" sx={{ fontSize: 15 }} />}><Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}><Box sx={{ width: 76, height: 76, flexShrink: 0 }}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ value: Math.max(0, data?.budgetTotals.totalActual ?? 0), color: '#ef5350' }, { value: Math.max(0, budgetRemaining), color: '#66bb6a' }]} dataKey="value" innerRadius={22} outerRadius={34} paddingAngle={2}>{[0, 1].map((index) => <Cell key={index} fill={index === 0 ? '#ef5350' : '#66bb6a'} />)}</Pie></PieChart></ResponsiveContainer></Box><Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 0.35, flex: 1, minWidth: 0 }}><Metric label="Approved Budget" value={data?.budgetTotals.totalAllocated ?? 0} /><Metric label="Total Spent" value={data?.budgetTotals.totalActual ?? 0} color="error.main" /><Metric label="Remaining" value={budgetRemaining} color="success.main" /><Box><Typography variant="caption" color="text.secondary">Utilization</Typography><Typography sx={{ fontSize: '0.95rem', fontWeight: 800 }}>{budgetPct.toFixed(1)}%</Typography><LinearProgress variant="determinate" value={Math.min(100, budgetPct)} sx={{ height: 4, borderRadius: 3 }} /></Box></Box></Stack></Section>
          <Section title="Budget Heads" icon={<WalletIcon color="primary" sx={{ fontSize: 15 }} />}><Box sx={{ width: '100%', overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', '&::-webkit-scrollbar': { height: 6 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 3 } }}><Table size="small" sx={{ minWidth: 650 }}><TableHead><TableRow><TableCell sx={cellSx}>Budget Head</TableCell><TableCell align="right" sx={cellSx}>Approved</TableCell><TableCell align="right" sx={cellSx}>Actual</TableCell><TableCell align="right" sx={cellSx}>Remaining</TableCell><TableCell sx={cellSx}>% Used</TableCell><TableCell sx={cellSx}>Status</TableCell></TableRow></TableHead><TableBody>{heads.map((head) => <TableRow key={head.id} hover onClick={() => navigate('/budget-heads')} sx={{ cursor: 'pointer' }}><TableCell sx={cellSx} title={head.particulars}><Typography sx={{ fontSize: '0.67rem', maxWidth: 130 }} noWrap>{head.particulars}</Typography></TableCell><TableCell align="right" sx={cellSx}>{formatCurrency(head.allocated)}</TableCell><TableCell align="right" sx={cellSx}>{formatCurrency(head.actual)}</TableCell><TableCell align="right" sx={{ ...cellSx, color: head.available < 0 ? 'error.main' : undefined }}>{formatCurrency(head.available)}</TableCell><TableCell sx={{ ...cellSx, minWidth: 72 }}><Stack direction="row" spacing={0.4} alignItems="center"><LinearProgress variant="determinate" value={Math.min(100, head.utilizationPct)} sx={{ width: 38, height: 5 }} /><Typography sx={{ fontSize: '0.62rem' }}>{head.utilizationPct.toFixed(0)}%</Typography></Stack></TableCell><TableCell sx={cellSx}><StatusChip value={head.actual > 0 ? 'IN USE' : 'NOT STARTED'} /></TableCell></TableRow>)}</TableBody></Table></Box></Section>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: 0.8, minHeight: 0 }}>
          <Section title="Recent Transactions" icon={<PaymentsIcon color="primary" sx={{ fontSize: 15 }} />}><Stack spacing={0.25}>{(data?.recentTransactions ?? []).slice(0, 7).map((tx) => <Stack key={tx.id} direction="row" justifyContent="space-between" spacing={0.5}><Typography variant="caption" noWrap sx={{ maxWidth: '65%' }}>{tx.description || tx.account}</Typography><Typography variant="caption" fontWeight={700} color={tx.isInflow ? 'success.main' : 'error.main'}>{tx.isInflow ? '+' : '−'}{formatCurrency(tx.amount)}</Typography></Stack>)}</Stack></Section>
          <Section title="Bank & Cash" icon={<AccountBalanceIcon color="primary" sx={{ fontSize: 15 }} />}><Stack spacing={0.55}><Stack direction="row" justifyContent="space-between"><Typography variant="caption">Bank Balance</Typography><Typography variant="caption" fontWeight={800} color="primary.main">{formatCurrency(data?.bankBalance ?? 0)}</Typography></Stack><Stack direction="row" justifyContent="space-between"><Typography variant="caption">Cash Balance</Typography><Typography variant="caption" fontWeight={800} color="success.main">{formatCurrency(data?.cashBalance ?? 0)}</Typography></Stack></Stack></Section>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateRows: { xs: 'auto auto', md: '180px 1fr' }, gap: 0.8, minHeight: 0 }}>
          {/* Action Required — square siren-style alert */}
          <Card sx={{ ...compactCard, position: 'relative', bgcolor: 'rgba(255, 243, 244, .95)', borderColor: 'error.main', animation: `${sirenPulse} 1.8s infinite`, aspectRatio: { xs: 'auto', md: '1 / 1' }, maxHeight: { md: 180 }, display: 'flex', flexDirection: 'column' }}><CardContent sx={{ p: 1, '&:last-child': { pb: 1 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: 'error.dark', display: 'flex', alignItems: 'center', gap: 0.5 }}>Action Required</Typography>
              <SirenIcon sx={{ fontSize: 22, color: 'error.main', animation: `${sirenIconPulse} 1s infinite` }} />
            </Stack>
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.3, overflow: 'hidden' }}>
              {loading ? <Skeleton variant="rectangular" height={20} /> : (data?.actionItems ?? []).length === 0 ? (
                <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', py: 1 }}>No pending action</Typography>
              ) : (
                <>
                  <Typography sx={{ fontSize: '1.4rem', fontWeight: 900, color: 'error.main', lineHeight: 1, textAlign: 'center' }}>{data?.actionItems.length}</Typography>
                  <Typography variant="caption" color="error.dark" sx={{ textAlign: 'center', fontWeight: 700, mb: 0.3 }}>pending items</Typography>
                  {(data?.actionItems ?? []).slice(0, 3).map((item) => (
                    <Chip key={`${item.type}-${item.id}`} clickable onClick={() => navigate(item.path)} label={`${item.type === 'purchase-order' ? 'PO' : item.type === 'quotation' ? 'Quotation' : item.type === 'invoice' ? 'Invoice' : 'Payment'} ${item.code}`} color="error" variant="outlined" sx={{ height: 20, fontSize: '0.58rem', justifyContent: 'space-between' }} />
                  ))}
                </>
              )}
            </Box>
          </CardContent></Card>
          {/* Expenditure Trend — rectangle layout */}
          <Section title="Expenditure Trend" icon={<TrendDownIcon color="error" sx={{ fontSize: 15 }} />} sx={{ minHeight: 0 }}><Box sx={{ height: '100%', minHeight: 140, width: '100%' }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={(trend?.trend ?? []).map((point) => ({ ...point, date: new Date(point.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) }))} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}><XAxis dataKey="date" tick={{ fontSize: 8 }} /><YAxis hide /><Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} /><Area type="monotone" dataKey="amount" stroke="#e53935" fill="#ffcdd2" strokeWidth={2} /></AreaChart></ResponsiveContainer></Box></Section>
        </Box>
      </Box>

      {/* Lower compact area */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 0.8, minHeight: 0, minWidth: 0 }}>
        <CompactRecords title="Recent Quotations" icon={<ReceiptIcon color="primary" sx={{ fontSize: 14 }} />} rows={(data?.recentQuotations ?? []).slice(0, 3).map((r) => ({ code: r.quotationNumber, name: r.vendorName, amount: r.grandTotal, status: r.status, date: r.createdAt }))} onRow={(r) => navigate(`/quotations?id=${(data?.recentQuotations ?? []).find((x) => x.quotationNumber === r.code)?.id ?? ''}`)} />
        <CompactRecords title="Recent Purchase Orders" icon={<ReceiptIcon color="primary" sx={{ fontSize: 14 }} />} rows={(data?.recentPOs ?? []).slice(0, 3).map((r) => ({ code: r.poNumber, name: r.vendorName, amount: r.grandTotal, status: r.status, date: r.createdAt }))} onRow={() => navigate('/pos')} />
        <CompactRecords title="Recent Invoices" icon={<ReceiptIcon color="primary" sx={{ fontSize: 14 }} />} rows={(data?.recentInvoices ?? []).slice(0, 3).map((r) => ({ code: r.invoiceCode, name: r.vendorName, amount: r.totalAmount, status: r.verificationStatus, date: r.createdAt }))} onRow={() => navigate('/invoices')} />
      </Box>

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
              <Table size="small" sx={{ minWidth: 620 }}><TableHead><TableRow><TableCell sx={cellSx}>Date</TableCell><TableCell sx={cellSx}>Type</TableCell><TableCell sx={cellSx}>Bank Account</TableCell><TableCell sx={cellSx}>Description</TableCell><TableCell align="right" sx={cellSx}>Amount</TableCell></TableRow></TableHead><TableBody>{bankReceipts.map((transaction) => <TableRow key={transaction.id} hover><TableCell sx={cellSx}>{formatDate(transaction.date)}</TableCell><TableCell sx={cellSx}><Chip size="small" label={transaction.type === 'REVERSAL_OUT' ? 'Reversed Receipt' : 'Bank Receipt'} color={transaction.type === 'REVERSAL_OUT' ? 'error' : 'success'} sx={{ height: 18, fontSize: '0.6rem' }} /></TableCell><TableCell sx={cellSx}>{transaction.account}</TableCell><TableCell sx={{ ...cellSx, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }} title={transaction.description}>{transaction.description || '—'}</TableCell><TableCell align="right" sx={{ ...cellSx, fontWeight: 700, color: transaction.type === 'REVERSAL_OUT' ? 'error.main' : 'success.main' }}>{transaction.type === 'REVERSAL_OUT' ? '−' : '+'}{formatCurrency(Math.abs(transaction.amount))}</TableCell></TableRow>)}</TableBody></Table>
              {!bankReceipts.length && <Typography sx={{ p: 3, textAlign: 'center' }} color="text.secondary">No bank receipts found.</Typography>}
            </Box>;
          })()}
        </DialogContent>
        <DialogActions><Button onClick={() => setInwardOpen(false)}>Close</Button></DialogActions>
      </Dialog>

      <Dialog open={expenditureOpen} onClose={() => setExpenditureOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Box><Typography sx={{ fontWeight: 800 }}>Expenditure Details</Typography><Typography variant="caption" color="text.secondary">All posted Bank and Cash expenditure records</Typography></Box>
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
                <TableHead><TableRow><TableCell sx={cellSx}>Date</TableCell><TableCell sx={cellSx}>Source</TableCell><TableCell sx={cellSx}>Account</TableCell><TableCell sx={cellSx}>Description</TableCell><TableCell sx={cellSx}>Budget Head</TableCell><TableCell align="right" sx={cellSx}>Amount</TableCell></TableRow></TableHead>
                <TableBody>{(expenditureDetails?.transactions ?? []).map((transaction) => <TableRow key={`${transaction.accountType}-${transaction.id}`} hover><TableCell sx={cellSx}>{formatDate(transaction.date)}</TableCell><TableCell sx={cellSx}><Chip size="small" label={transaction.accountType === 'BANK' ? 'Bank' : 'Cash'} color={transaction.accountType === 'BANK' ? 'primary' : 'warning'} sx={{ height: 18, fontSize: '0.6rem' }} /></TableCell><TableCell sx={cellSx}>{transaction.account}</TableCell><TableCell sx={{ ...cellSx, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={transaction.description}>{transaction.description || '—'}</TableCell><TableCell sx={cellSx}>{transaction.budgetHead?.particulars ?? '—'}</TableCell><TableCell align="right" sx={{ ...cellSx, fontWeight: 700, color: 'error.main' }}>{formatCurrency(transaction.amount)}</TableCell></TableRow>)}</TableBody>
              </Table>
              {!expenditureDetails?.transactions.length && <Typography sx={{ p: 3, textAlign: 'center' }} color="text.secondary">No expenditure records found.</Typography>}
            </Box>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setExpenditureOpen(false)}>Close</Button></DialogActions>
      </Dialog>
    </Box>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color?: string }) { return <Box sx={{ minWidth: 0 }}><Typography variant="caption" color="text.secondary" noWrap>{label}</Typography><Typography sx={{ fontSize: '0.83rem', fontWeight: 800, color }} noWrap>{formatCurrency(value)}</Typography></Box>; }
function CompactRecords({ title, icon, rows, onRow }: { title: string; icon: ReactNode; rows: Array<{ code: string; name: string; amount: number; status: string; date: string }>; onRow: (row: { code: string }) => void }) { return <Section title={title} icon={icon}><Box sx={{ width: '100%', overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}><Table size="small" sx={{ minWidth: 360 }}><TableHead><TableRow><TableCell sx={cellSx}>No.</TableCell><TableCell sx={cellSx}>Vendor</TableCell><TableCell align="right" sx={cellSx}>Amount</TableCell><TableCell sx={cellSx}>Status</TableCell></TableRow></TableHead><TableBody>{rows.map((row) => <TableRow key={row.code} hover onClick={() => onRow(row)} sx={{ cursor: 'pointer' }}><TableCell sx={cellSx}>{row.code}</TableCell><TableCell sx={cellSx}><Typography variant="caption" noWrap>{row.name}</Typography></TableCell><TableCell align="right" sx={cellSx}>{formatCurrency(row.amount)}</TableCell><TableCell sx={cellSx}><StatusChip value={row.status} /></TableCell></TableRow>)}</TableBody></Table></Box></Section>; }
