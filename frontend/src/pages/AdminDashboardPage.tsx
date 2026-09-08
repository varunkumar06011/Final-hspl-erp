import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Skeleton,
  Chip,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  IconButton,
  Button,
  Alert,
  Divider,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  useTheme,
  useMediaQuery,
  Stack,
} from '@mui/material';
import {
  ArrowForward as ArrowForwardIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  AccountBalance as AccountBalanceIcon,
  Payments as PaymentsIcon,
  PendingActions as PendingActionsIcon,
  Receipt as ReceiptIcon,
  AccountBalanceWallet as WalletIcon,
  Check as CheckIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import { formatCurrency, formatDate } from '../utils/enumOptions';
import { AnimatedNumber } from '../components/AnimatedNumber';
import RateTrackerWidget from '../components/RateTrackerWidget';
import DocumentSummaryCard from '../components/DocumentSummaryCard';
import PendingItemsDialog from '../components/PendingItemsDialog';
import { useAuthStore } from '../stores/authStore';

// ── Types ────────────────────────────────────────────────────────────

interface AdminSummary {
  project: { name: string; status: string } | null;
  // Accounting-first summary
  totalInwardFunds: number;
  totalExpenditure: number;
  balance: number;
  // Bank & cash
  bankBalance: number;
  cashBalance: number;
  totalLiquidity: number;
  // Budget heads
  budgetHeads: Array<{
    id: string;
    slNo: number;
    particulars: string;
    allocated: number;
    committed: number;
    actual: number;
    paid: number;
    available: number;
    utilizationPct: number;
  }>;
  budgetTotals: { totalAllocated: number; totalActual: number; totalCommitted: number };
  // Today's outflow (Amount Used Today)
  todayOutflow: {
    amount: number;
    count: number;
    transactions: Array<{
      id: string;
      account: string;
      accountType: 'BANK' | 'CASH';
      amount: number;
      description: string;
      time: string;
      budgetHead?: { id: string; particulars: string } | null;
    }>;
  };
  // Pending approvals
  pendingPayments: number;
  pendingQuotations: number;
  pendingPOs: number;
  pendingInvoices: number;
  // Recent activity
  recentTransactions: Array<{
    id: string;
    account: string;
    accountType: 'BANK' | 'CASH';
    type: string;
    isInflow: boolean;
    amount: number;
    description: string;
    date: string;
  }>;
  recentQuotations: Array<{
    id: string;
    quotationNumber: string;
    vendorName: string;
    grandTotal: number;
    status: string;
    createdAt: string;
  }>;
  // Recent POs (additive — same pattern as recentQuotations)
  recentPOs: Array<{
    id: string;
    poNumber: string;
    vendorName: string;
    grandTotal: number;
    status: string;
    createdAt: string;
  }>;
  // Recent invoices (additive — same pattern as recentQuotations)
  recentInvoices: Array<{
    id: string;
    invoiceCode: string;
    vendorName: string;
    totalAmount: number;
    verificationStatus: string;
    createdAt: string;
  }>;
  // Procurement totals (additive — simple counts)
  procurement: {
    totalQuotations: number;
    totalPurchaseOrders: number;
    totalInvoices: number;
    pendingQuotations: number;
    pendingPOs: number;
    pendingInvoices: number;
  };
  // Project phases (additive — surfaces existing Phase.progressPercent)
  phases: Array<{
    id: string;
    name: string;
    status: string;
    progressPercent: number;
    plannedStart: string | null;
    plannedEnd: string | null;
  }>;
  // Project timeline (additive — startDate/endDate for progress bar)
  projectTimeline: {
    startDate: string;
    endDate: string | null;
    totalBudget: number;
  } | null;
}

type PendingType = 'payments' | 'quotations' | 'pos' | 'invoices';

// ── Scrollable table container with swipe hint ───────────────────────
// Provides a single, isolated horizontal-scroll container for tables.
// The dashboard itself never scrolls horizontally — only this container.
// A subtle "swipe →" hint appears when the table overflows and disappears
// once the user interacts with the scroll.
function ScrollableTableContainer({ children }: { children: ReactNode }) {
  const [showHint, setShowHint] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => {
      const el = scrollRef.current;
      if (el && el.scrollWidth > el.clientWidth + 2) {
        setShowHint(true);
      } else {
        setShowHint(false);
      }
    };
    const timer = setTimeout(check, 100);
    window.addEventListener('resize', check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', check);
    };
  }, []);

  return (
    <Box sx={{ position: 'relative', width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      <Box
        ref={scrollRef}
        onScroll={() => showHint && setShowHint(false)}
        sx={{
          width: '100%',
          maxWidth: '100%',
          overflowX: 'auto',
          overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-x',
          '&::-webkit-scrollbar': { height: 6 },
          '&::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
          '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 3 },
        }}
      >
        {children}
      </Box>
      {showHint && (
        <Typography
          variant="caption"
          sx={{
            position: 'absolute',
            right: 8,
            bottom: 4,
            color: 'text.disabled',
            fontSize: '0.65rem',
            pointerEvents: 'none',
            bgcolor: 'background.paper',
            px: 0.75,
            py: 0.15,
            borderRadius: 1,
            boxShadow: 1,
            opacity: 0.8,
          }}
        >
          swipe →
        </Typography>
      )}
    </Box>
  );
}

// ── Component ────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [pendingDialog, setPendingDialog] = useState<PendingType | null>(null);
  const [expenditureDialogOpen, setExpenditureDialogOpen] = useState(false);
  const [inwardDialogOpen, setInwardDialogOpen] = useState(false);
  const [procurementDialog, setProcurementDialog] = useState<'quotations' | 'pos' | 'invoices' | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ type: 'quotations' | 'pos' | 'invoices'; id: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionError, setActionError] = useState('');

  // ── Date range for Amount Used Today card ──
  // Defaults to today. User can pick any start/end date.
  // When the range changes, the outflow-by-range endpoint is called
  // and the card shows the total expenditure for that range.
  const todayStr = new Date().toISOString().split('T')[0];
  const [outflowStartDate, setOutflowStartDate] = useState(todayStr);
  const [outflowEndDate, setOutflowEndDate] = useState(todayStr);

  // ── Single data query — all admin dashboard data in one call ──
  const { data: adminData, isLoading } = useQuery<AdminSummary>({
    queryKey: ['/dashboard/admin-summary'],
    queryFn: async () => {
      const response = await api.get('/dashboard/admin-summary');
      return response.data;
    },
    refetchInterval: 30000,
  });

  // ── Outflow by date range query ──
  // Fetches total expenditure for the selected date range.
  // When the user changes the date range, this query refetches
  // and the Amount Used Today card updates with the new total.
  // No hardcoded values — all data is live from the database.
  const isTodayRange = outflowStartDate === todayStr && outflowEndDate === todayStr;
  const { data: outflowRangeData, isLoading: outflowRangeLoading } = useQuery({
    queryKey: ['/dashboard/outflow-by-range', outflowStartDate, outflowEndDate],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (!isTodayRange) {
        params.startDate = outflowStartDate;
        params.endDate = outflowEndDate;
      }
      const response = await api.get('/dashboard/outflow-by-range', { params });
      return response.data as {
        totalAmount: number;
        totalCount: number;
        transactions: Array<{
          id: string;
          account: string;
          accountType: 'BANK' | 'CASH';
          amount: number;
          description: string;
          date: string;
          budgetHead?: { id: string; particulars: string } | null;
        }>;
      };
    },
    refetchInterval: 30000,
  });

  // ── Expenditure detail query — fetches ALL outflow transactions ──
  // Triggered when the user clicks the Total Expenditure card.
  // Uses the outflow-by-range endpoint with a wide date range to get
  // every posted bank + cash outflow transaction for the project.
  const { data: expenditureDetail, isLoading: expenditureDetailLoading } = useQuery({
    queryKey: ['/dashboard/outflow-by-range', 'expenditure-detail'],
    queryFn: async () => {
      const response = await api.get('/dashboard/outflow-by-range', {
        params: { startDate: '2000-01-01', endDate: todayStr, limit: 5000 },
      });
      return response.data as {
        totalAmount: number;
        totalCount: number;
        transactions: Array<{
          id: string;
          account: string;
          accountType: 'BANK' | 'CASH';
          amount: number;
          description: string;
          date: string;
          budgetHead?: { id: string; particulars: string } | null;
        }>;
      };
    },
    enabled: expenditureDialogOpen,
  });

  // ── Inward funds detail query (lazy — only fetches when dialog opens) ──
  // Fetches all posted bank + cash inflow transactions for the project.
  const { data: inwardDetail, isLoading: inwardDetailLoading } = useQuery({
    queryKey: ['/dashboard/admin-inflow-detail'],
    queryFn: async () => {
      const response = await api.get('/dashboard/admin-inflow-detail', { params: { limit: 5000 } });
      return response.data as {
        totalAmount: number;
        totalCount: number;
        transactions: Array<{
          id: string;
          account: string;
          accountType: 'BANK' | 'CASH';
          amount: number;
          description: string;
          type: string;
          date: string;
        }>;
      };
    },
    enabled: inwardDialogOpen,
  });

  // ── Procurement detail queries (lazy — only fetches when dialog opens) ──
  const { data: quotationDetail, isLoading: quotationDetailLoading } = useQuery({
    queryKey: ['/quotations', 'procurement-detail'],
    queryFn: async () => {
      const response = await api.get('/quotations', { params: { pageSize: 100 } });
      return response.data as {
        data: Array<{ id: string; quotationNumber: string; vendor?: { name: string }; grandTotal: number; status: string; createdAt: string }>;
        pagination: { total: number };
      };
    },
    enabled: procurementDialog === 'quotations',
  });

  const { data: poDetail, isLoading: poDetailLoading } = useQuery({
    queryKey: ['/purchase-orders', 'procurement-detail'],
    queryFn: async () => {
      const response = await api.get('/purchase-orders', { params: { pageSize: 100 } });
      return response.data as {
        data: Array<{ id: string; poNumber: string; vendor?: { name: string }; grandTotal: number; status: string; createdAt: string }>;
        pagination: { total: number };
      };
    },
    enabled: procurementDialog === 'pos',
  });

  const { data: invoiceDetail, isLoading: invoiceDetailLoading } = useQuery({
    queryKey: ['/invoices', 'procurement-detail'],
    queryFn: async () => {
      const response = await api.get('/invoices', { params: { pageSize: 100 } });
      return response.data as {
        data: Array<{ id: string; invoiceCode: string; vendor?: { name: string }; totalAmount: number; verificationStatus: string; createdAt: string }>;
        pagination: { total: number };
      };
    },
    enabled: procurementDialog === 'invoices',
  });

  // ── Approve / Reject mutations for procurement items ──
  // Uses the SAME backend endpoints as the regular approval pages:
  //   POST /quotations/:id/approve,      /purchase-orders/:id/approve, /invoices/:id/approve
  //   POST /quotations/:id/reject,       /purchase-orders/:id/reject,  /invoices/:id/reject
  // The backend validates the user's role, finds the pending approval step,
  // runs the approval service, updates status, commits budget (POs), and
  // sends push notifications — identical to the regular page flow.
  const apiPath = (type: 'quotations' | 'pos' | 'invoices') =>
    type === 'quotations' ? '/quotations' : type === 'pos' ? '/purchase-orders' : '/invoices';
  const queryKey = (type: 'quotations' | 'pos' | 'invoices') =>
    [apiPath(type), 'procurement-detail'] as const;

  const handleApprove = async (type: 'quotations' | 'pos' | 'invoices', id: string) => {
    try {
      setActionError('');
      await api.post(`${apiPath(type)}/${id}/approve`, { comments: '', acknowledged: true });
      queryClient.invalidateQueries({ queryKey: queryKey(type) });
      queryClient.invalidateQueries({ queryKey: ['/dashboard/admin-summary'] });
    } catch (err: unknown) {
      setActionError(extractErrorMessage(err));
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectTarget) return;
    try {
      setActionError('');
      await api.post(`${apiPath(rejectTarget.type)}/${rejectTarget.id}/reject`, { reason: rejectReason || 'Rejected', acknowledged: true });
      queryClient.invalidateQueries({ queryKey: queryKey(rejectTarget.type) });
      queryClient.invalidateQueries({ queryKey: ['/dashboard/admin-summary'] });
      setRejectTarget(null);
      setRejectReason('');
    } catch (err: unknown) {
      setActionError(extractErrorMessage(err));
    }
  };

  // ── Expenditure trend query — daily outflow for the last 30 days ──
  const { data: trendData, isLoading: trendLoading } = useQuery({
    queryKey: ['/dashboard/admin-outflow-trend', 30],
    queryFn: async () => {
      const response = await api.get('/dashboard/admin-outflow-trend', { params: { days: 30 } });
      return response.data as {
        trend: Array<{ date: string; amount: number }>;
        total: number;
        days: number;
      };
    },
    refetchInterval: 30000,
  });

  // ── Values from the single query ──
  const totalInward = adminData?.totalInwardFunds ?? 0;
  const totalExpenditure = adminData?.totalExpenditure ?? 0;
  const balance = adminData?.balance ?? 0;

  const budgetHeads = adminData?.budgetHeads ?? [];
  const topBudgetHeads = [...budgetHeads]
    .sort((a, b) => b.allocated - a.allocated)
    .slice(0, 6);

  const recentQuotations = adminData?.recentQuotations ?? [];
  const recentTransactions = adminData?.recentTransactions ?? [];

  // ── Amount Used Today / Date Range values ──
  // When range is "today", use the data from admin-summary (already fetched).
  // When range is custom, use the outflow-by-range endpoint data.
  const outflowAmount = isTodayRange
    ? (adminData?.todayOutflow?.amount ?? 0)
    : (outflowRangeData?.totalAmount ?? 0);
  const outflowCount = isTodayRange
    ? (adminData?.todayOutflow?.count ?? 0)
    : (outflowRangeData?.totalCount ?? 0);
  const outflowTransactions = isTodayRange
    ? (adminData?.todayOutflow?.transactions ?? [])
    : (outflowRangeData?.transactions ?? []);
  const outflowLoading = isTodayRange ? isLoading : outflowRangeLoading;

  // ── Handlers ──
  const handleInwardClick = () => setInwardDialogOpen(true);
  const handleExpenditureClick = () => setExpenditureDialogOpen(true);
  const handleBudgetHeadClick = () => navigate('/budget-heads');

  return (
    <Box sx={{ overflowX: 'hidden', minWidth: 0, width: '100%' }}>
      {/* Header */}
      <Typography variant="h5" gutterBottom fontWeight={600} sx={{ fontSize: { xs: '1.15rem', sm: '1.4rem' } }}>
        Admin Dashboard
      </Typography>

      {adminData?.project && (
        <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary" component="span">
            Project: <strong>{adminData.project.name}</strong>
          </Typography>
          <Chip label={adminData.project.status} size="small" />
        </Box>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          A. Accounting-first summary: Inward − Expenditure = Balance
          Compact cards — minimal padding, consistent height, responsive.
      ═══════════════════════════════════════════════════════════════ */}
      <Box
        sx={{
          mb: { xs: 2, sm: 3 },
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr 1fr', sm: '1fr auto 1fr auto 1fr' },
          gap: { xs: 1, sm: 1 },
          alignItems: 'stretch',
        }}
      >
        {/* Total Inward Funds */}
        <Card
          onClick={handleInwardClick}
          sx={{
            cursor: 'pointer',
            transition: 'all 0.2s',
            borderLeft: '3px solid',
            borderColor: 'success.main',
            '&:hover': { boxShadow: 3 },
          }}
        >
          <CardContent sx={{ py: 1, px: 1.5, '&:last-child': { pb: 1 } }}>
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.25 }}>
              <TrendingUpIcon color="success" sx={{ fontSize: 15 }} />
              <Typography color="text.secondary" variant="caption" fontWeight={600} sx={{ fontSize: { xs: '0.65rem', sm: '0.7rem' } }} noWrap>
                Inward Funds
              </Typography>
            </Stack>
            {isLoading ? (
              <Skeleton variant="text" width={100} height={24} />
            ) : (
              <Typography fontWeight={700} color="success.dark" sx={{ lineHeight: 1.2, fontSize: { xs: '0.85rem', sm: '1rem', md: '1.1rem' }, wordBreak: 'break-all' }}>
                <AnimatedNumber value={totalInward} format={(n) => formatCurrency(n)} />
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', display: { xs: 'none', sm: 'block' } }}>
              All funds received
            </Typography>
          </CardContent>
        </Card>

        {/* Minus sign */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', px: 0.25 }}>
          <Typography sx={{ color: 'text.disabled', fontWeight: 300, display: { xs: 'none', sm: 'block' }, fontSize: '1.1rem' }}>−</Typography>
        </Box>

        {/* Total Expenditure */}
        <Card
          onClick={handleExpenditureClick}
          sx={{
            cursor: 'pointer',
            transition: 'all 0.2s',
            borderLeft: '3px solid',
            borderColor: 'error.main',
            '&:hover': { boxShadow: 3 },
          }}
        >
          <CardContent sx={{ py: 1, px: 1.5, '&:last-child': { pb: 1 } }}>
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.25 }}>
              <TrendingDownIcon color="error" sx={{ fontSize: 15 }} />
              <Typography color="text.secondary" variant="caption" fontWeight={600} sx={{ fontSize: { xs: '0.65rem', sm: '0.7rem' } }} noWrap>
                Expenditure
              </Typography>
            </Stack>
            {isLoading ? (
              <Skeleton variant="text" width={100} height={24} />
            ) : (
              <Typography fontWeight={700} color="error.dark" sx={{ lineHeight: 1.2, fontSize: { xs: '0.85rem', sm: '1rem', md: '1.1rem' }, wordBreak: 'break-all' }}>
                <AnimatedNumber value={totalExpenditure} format={(n) => formatCurrency(n)} delay={150} />
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', display: { xs: 'none', sm: 'block' } }}>
              All posted spend
            </Typography>
          </CardContent>
        </Card>

        {/* Equals sign */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', px: 0.25 }}>
          <Typography sx={{ color: 'text.disabled', fontWeight: 300, display: { xs: 'none', sm: 'block' }, fontSize: '1.1rem' }}>=</Typography>
        </Box>

        {/* Balance */}
        <Card
          sx={{
            borderLeft: '3px solid',
            borderColor: balance >= 0 ? 'primary.main' : 'error.main',
            bgcolor: balance >= 0 ? 'primary.50' : 'error.50',
          }}
        >
          <CardContent sx={{ py: 1, px: 1.5, '&:last-child': { pb: 1 } }}>
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.25 }}>
              <AccountBalanceIcon color={balance >= 0 ? 'primary' : 'error'} sx={{ fontSize: 15 }} />
              <Typography color="text.secondary" variant="caption" fontWeight={600} sx={{ fontSize: { xs: '0.65rem', sm: '0.7rem' } }} noWrap>
                Balance
              </Typography>
            </Stack>
            {isLoading ? (
              <Skeleton variant="text" width={100} height={24} />
            ) : (
              <Typography fontWeight={700} color={balance >= 0 ? 'primary.dark' : 'error.dark'} sx={{ lineHeight: 1.2, fontSize: { xs: '0.85rem', sm: '1rem', md: '1.1rem' }, wordBreak: 'break-all' }}>
                <AnimatedNumber value={balance} format={(n) => formatCurrency(n)} delay={300} />
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', display: { xs: 'none', sm: 'block' } }}>
              Inward − expenditure
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* ═══════════════════════════════════════════════════════════════
          Expenditure Trend — compact chart, side-by-side with Budget Overview
      ═══════════════════════════════════════════════════════════════ */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: 2,
          mb: { xs: 2, sm: 3 },
        }}
      >
        {/* Budget overview — pie chart showing Approved, Expenditure, Remaining.
            Uses totalExpenditure (all posted spend) for the expenditure value,
            consistent with the top summary card. */}
        <Box sx={{ minWidth: 0 }}>
          {adminData?.budgetTotals && (() => {
            const bt = adminData.budgetTotals;
            const expenditure = totalExpenditure;
            const remaining = bt.totalAllocated - expenditure;
            const pieData = [
              { name: 'Expenditure', value: expenditure, color: '#f44336' },
              { name: 'Remaining', value: Math.max(0, remaining), color: '#4caf50' },
            ].filter((d) => d.value > 0);
            return (
              <Card sx={{ overflow: 'hidden', width: '100%', maxWidth: '100%', height: '100%' }}>
                <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>Budget Overview</Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
                    <Box sx={{ width: 140, height: 140, flexShrink: 0 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={38}
                            outerRadius={60}
                            paddingAngle={2}
                          >
                            {pieData.map((entry, idx) => (
                              <Cell key={idx} fill={entry.color} />
                            ))}
                          </Pie>
                          <RechartsTooltip
                            formatter={(value: unknown) => formatCurrency(Number(value))}
                            contentStyle={{ fontSize: 11 }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </Box>
                    <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#1976d2', flexShrink: 0 }} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="caption" color="text.secondary">Approved</Typography>
                          <Typography variant="body2" fontWeight={700}>{formatCurrency(bt.totalAllocated)}</Typography>
                        </Box>
                      </Stack>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#f44336', flexShrink: 0 }} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="caption" color="text.secondary">Expenditure</Typography>
                          <Typography variant="body2" fontWeight={700} color="error.main">{formatCurrency(expenditure)}</Typography>
                        </Box>
                      </Stack>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#4caf50', flexShrink: 0 }} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="caption" color="text.secondary">Remaining</Typography>
                          <Typography variant="body2" fontWeight={700} color={remaining < 0 ? 'error.main' : 'success.main'}>{formatCurrency(remaining)}</Typography>
                        </Box>
                      </Stack>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            );
          })()}
        </Box>

        {/* Expenditure Trend chart — compact */}
        <Box sx={{ minWidth: 0 }}>
          <Card sx={{ overflow: 'hidden', width: '100%', maxWidth: '100%', height: '100%' }}>
            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                <Typography variant="subtitle2" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <TrendingDownIcon color="error" sx={{ fontSize: 16 }} />
                  Expenditure Trend
                </Typography>
                {!trendLoading && trendData && (
                  <Typography variant="caption" color="text.secondary">
                    30d: {formatCurrency(trendData.total)}
                  </Typography>
                )}
              </Stack>
              {trendLoading ? (
                <Skeleton variant="rectangular" height={100} />
              ) : (trendData?.trend ?? []).length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center', fontSize: '0.8rem' }}>
                  No expenditure data
                </Typography>
              ) : (
                <Box sx={{ width: '100%', height: 110 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={(trendData?.trend ?? []).map((d) => ({
                      date: new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
                      amount: d.amount,
                    }))}>
                      <defs>
                        <linearGradient id="expenditureGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f44336" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#f44336" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" minTickGap={30} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} width={32} />
                      <RechartsTooltip
                        formatter={(value: unknown) => [formatCurrency(Number(value)), 'Expenditure']}
                        labelStyle={{ fontSize: 11 }}
                        contentStyle={{ fontSize: 11 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="amount"
                        stroke="#f44336"
                        strokeWidth={1.5}
                        fill="url(#expenditureGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </Box>
              )}
            </CardContent>
          </Card>
        </Box>
      </Box>

      {/* ═══════════════════════════════════════════════════════════════
          B. Budget Heads (left) + Amount Used Today (right)
      ═══════════════════════════════════════════════════════════════ */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 280px', lg: '1fr 300px' },
          gap: 2,
          mb: { xs: 2, sm: 3 },
        }}
      >
        {/* ── Budget Heads table ── */}
        <Box sx={{ minWidth: 0 }}>
      <Typography variant="subtitle1" gutterBottom fontWeight={600} sx={{ mb: 1.5 }}>
        Budget Heads
      </Typography>
      <Card sx={{ mb: { xs: 2, lg: 0 }, overflow: 'hidden', width: '100%', maxWidth: '100%' }}>
        {/* Scrollable table container — scrolls horizontally within the card,
            never breaks the dashboard width. First column is sticky. */}
        <ScrollableTableContainer>
            <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 730 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell sx={{ fontWeight: 600, width: 150, position: 'sticky', left: 0, bgcolor: 'action.hover', zIndex: 2, borderRight: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>Head</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, width: 130, overflow: 'hidden' }}>Approved</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, width: 120, overflow: 'hidden' }}>Actual</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, width: 120, overflow: 'hidden' }}>Remaining</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 160, overflow: 'hidden' }}>% Used</TableCell>
                  <TableCell align="right" sx={{ width: 50 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Skeleton variant="rectangular" height={40} />
                    </TableCell>
                  </TableRow>
                ) : topBudgetHeads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      <Typography color="text.secondary" sx={{ py: 2 }}>No budget heads found</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  topBudgetHeads.map((head) => {
                    const remaining = head.allocated - head.actual;
                    const utilPct = Math.min(head.utilizationPct, 100);
                    const barColor =
                      head.utilizationPct >= 90 ? 'error' :
                      head.utilizationPct >= 70 ? 'warning' :
                      'success';
                    return (
                      <TableRow
                        key={head.id}
                        hover
                        onClick={() => handleBudgetHeadClick()}
                        sx={{ cursor: 'pointer' }}
                      >
                        <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1, borderRight: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
                          <Typography variant="body2" fontWeight={500} noWrap>{head.particulars}</Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ overflow: 'hidden' }}>
                          <Typography variant="body2" noWrap>{formatCurrency(head.allocated)}</Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ overflow: 'hidden' }}>
                          <Typography variant="body2" noWrap>{formatCurrency(head.actual)}</Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ overflow: 'hidden' }}>
                          <Typography variant="body2" noWrap color={remaining < 0 ? 'error.main' : 'text.primary'}>
                            {formatCurrency(remaining)}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ overflow: 'hidden' }}>
                          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                            <LinearProgress
                              variant="determinate"
                              value={utilPct}
                              color={barColor as 'success' | 'warning' | 'error'}
                              sx={{ flex: 1, height: 6, borderRadius: 3, minWidth: 40 }}
                            />
                            <Typography variant="caption" sx={{ minWidth: 32, fontWeight: 600, fontSize: '0.7rem', flexShrink: 0 }}>
                              {head.utilizationPct.toFixed(0)}%
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell align="right">
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleBudgetHeadClick(); }}>
                            <ArrowForwardIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
        </ScrollableTableContainer>
        {budgetHeads.length > 6 && (
          <Box sx={{ p: 1, textAlign: 'right' }}>
            <Button
              size="small"
              onClick={() => navigate('/budget-heads')}
              sx={{ textTransform: 'none' }}
            >
              View all {budgetHeads.length} heads →
            </Button>
          </Box>
        )}
      </Card>
        </Box>

        {/* ── Amount Used (beside budget heads) — with date range picker ── */}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" gutterBottom fontWeight={600} sx={{ mb: 1.5 }}>
            {isTodayRange ? 'Amount Used Today' : 'Amount Used (Range)'}
          </Typography>
          <Card sx={{ borderLeft: '3px solid', borderColor: 'error.main', overflow: 'hidden', width: '100%', maxWidth: '100%' }}>
            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 }, overflow: 'hidden' }}>
              {/* Date range picker */}
              <Stack direction="row" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
                <TextField
                  type="date"
                  size="small"
                  label="From"
                  value={outflowStartDate}
                  onChange={(e) => setOutflowStartDate(e.target.value)}
                  sx={{ flex: 1, minWidth: 0, '& .MuiInputBase-input': { py: 0.75, fontSize: '0.8rem' }, '& .MuiInputLabel-root': { fontSize: '0.75rem' } }}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  type="date"
                  size="small"
                  label="To"
                  value={outflowEndDate}
                  onChange={(e) => setOutflowEndDate(e.target.value)}
                  sx={{ flex: 1, minWidth: 0, '& .MuiInputBase-input': { py: 0.75, fontSize: '0.8rem' }, '& .MuiInputLabel-root': { fontSize: '0.75rem' } }}
                  InputLabelProps={{ shrink: true }}
                />
              </Stack>

              {/* Quick range buttons */}
              <Stack direction="row" spacing={0.5} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label="Today"
                  color={isTodayRange ? 'primary' : 'default'}
                  variant={isTodayRange ? 'filled' : 'outlined'}
                  onClick={() => { setOutflowStartDate(todayStr); setOutflowEndDate(todayStr); }}
                  sx={{ height: 20, fontSize: '0.65rem' }}
                />
                <Chip
                  size="small"
                  label="7D"
                  color={false ? 'primary' : 'default'}
                  variant="outlined"
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() - 6);
                    setOutflowStartDate(d.toISOString().split('T')[0]);
                    setOutflowEndDate(todayStr);
                  }}
                  sx={{ height: 20, fontSize: '0.65rem' }}
                />
                <Chip
                  size="small"
                  label="30D"
                  color={false ? 'primary' : 'default'}
                  variant="outlined"
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() - 29);
                    setOutflowStartDate(d.toISOString().split('T')[0]);
                    setOutflowEndDate(todayStr);
                  }}
                  sx={{ height: 20, fontSize: '0.65rem' }}
                />
                <Chip
                  size="small"
                  label="Reset"
                  variant="outlined"
                  onClick={() => { setOutflowStartDate(todayStr); setOutflowEndDate(todayStr); }}
                  sx={{ height: 20, fontSize: '0.65rem' }}
                />
              </Stack>

              {/* Total amount for the selected range */}
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={500}>
                  {isTodayRange
                    ? formatDate(todayStr)
                    : `${formatDate(outflowStartDate)} — ${formatDate(outflowEndDate)}`}
                </Typography>
                {!outflowLoading && (
                  <Chip
                    size="small"
                    color={outflowCount ? 'error' : 'default'}
                    label={`${outflowCount} txn${outflowCount === 1 ? '' : 's'}`}
                    sx={{ height: 20, fontSize: '0.7rem' }}
                  />
                )}
              </Stack>

              {outflowLoading ? (
                <Skeleton variant="text" width={140} height={32} />
              ) : (
                <Typography variant="h5" fontWeight={700} color={outflowAmount ? 'error.main' : 'text.secondary'} sx={{ lineHeight: 1.2 }}>
                  <AnimatedNumber value={outflowAmount} format={(n) => formatCurrency(n)} />
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontSize: '0.65rem' }}>
                {isTodayRange ? 'Total money out today' : 'Total money out in range'}
              </Typography>

              {!outflowLoading && outflowCount === 0 && (
                <Alert severity="info" sx={{ py: 0.25, px: 1, fontSize: '0.75rem', '& .MuiAlert-message': { py: 0.25 } }}>
                  No money spent in this {isTodayRange ? 'today' : 'period'}.
                </Alert>
              )}

              {!outflowLoading && outflowTransactions.length > 0 && (
                <Box sx={{ maxHeight: 200, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', width: '100%' }}>
                  <Divider sx={{ mb: 0.75 }} />
                  <Stack spacing={0.75}>
                    {outflowTransactions.slice(0, 10).map((t) => (
                      <Box
                        key={t.id}
                        sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, width: '100%', maxWidth: '100%', overflow: 'hidden' }}
                      >
                        <Box sx={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
                            <Chip size="small" label={t.accountType} variant="outlined" sx={{ height: 16, fontSize: '0.6rem', flexShrink: 0 }} />
                            <Typography variant="caption" fontWeight={600} noWrap sx={{ minWidth: 0 }}>{t.account}</Typography>
                          </Stack>
                          {t.budgetHead && (
                            <Typography variant="caption" color="primary.main" component="div" noWrap sx={{ fontSize: '0.65rem', fontWeight: 600 }}>
                              {t.budgetHead.particulars}
                            </Typography>
                          )}
                          <Typography variant="caption" color="text.secondary" component="div" noWrap sx={{ fontSize: '0.7rem', maxWidth: '100%' }}>
                            {t.description || '—'}
                          </Typography>
                          {!isTodayRange && (
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>
                              {formatDate('time' in t ? (t as { time: string }).time : (t as { date: string }).date)}
                            </Typography>
                          )}
                        </Box>
                        <Typography variant="caption" fontWeight={700} color="error.main" sx={{ whiteSpace: 'nowrap', fontSize: '0.75rem', flexShrink: 0 }}>
                          {formatCurrency(t.amount)}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              )}
            </CardContent>
          </Card>
        </Box>
      </Box>

      {/* ═══════════════════════════════════════════════════════════════
          C. Grouped secondary content
      ═══════════════════════════════════════════════════════════════ */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: 2,
          mb: { xs: 2, sm: 3 },
        }}
      >
        {/* ── Pending Approvals ── */}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <PendingActionsIcon color="warning" fontSize="small" />
            Pending Approvals
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
            <Card
              onClick={() => setPendingDialog('payments')}
              sx={{ cursor: 'pointer', '&:hover': { boxShadow: 3 } }}
            >
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="body2" color="text.secondary">Payments</Typography>
                {isLoading ? <Skeleton width={40} /> : (
                  <Typography variant="h5" color="warning.main" fontWeight={700}>
                    {adminData?.pendingPayments ?? 0}
                  </Typography>
                )}
              </CardContent>
            </Card>
            <Card
              onClick={() => setPendingDialog('quotations')}
              sx={{ cursor: 'pointer', '&:hover': { boxShadow: 3 } }}
            >
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="body2" color="text.secondary">Quotations</Typography>
                {isLoading ? <Skeleton width={40} /> : (
                  <Typography variant="h5" color="warning.main" fontWeight={700}>
                    {adminData?.pendingQuotations ?? 0}
                  </Typography>
                )}
              </CardContent>
            </Card>
            <Card
              onClick={() => setPendingDialog('pos')}
              sx={{ cursor: 'pointer', '&:hover': { boxShadow: 3 } }}
            >
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="body2" color="text.secondary">Purchase Orders</Typography>
                {isLoading ? <Skeleton width={40} /> : (
                  <Typography variant="h5" color="warning.main" fontWeight={700}>
                    {adminData?.pendingPOs ?? 0}
                  </Typography>
                )}
              </CardContent>
            </Card>
            <Card
              onClick={() => setPendingDialog('invoices')}
              sx={{ cursor: 'pointer', '&:hover': { boxShadow: 3 } }}
            >
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="body2" color="text.secondary">Invoices</Typography>
                {isLoading ? <Skeleton width={40} /> : (
                  <Typography variant="h5" color="warning.main" fontWeight={700}>
                    {adminData?.pendingInvoices ?? 0}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Box>
        </Box>

        {/* ── Bank & Cash ── */}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <WalletIcon color="primary" fontSize="small" />
            Bank &amp; Cash
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <Card
              onClick={() => navigate('/bank-accounts')}
              sx={{ cursor: 'pointer', '&:hover': { boxShadow: 3 } }}
            >
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="body2" color="text.secondary">Bank Balance</Typography>
                {isLoading ? <Skeleton width={100} /> : (
                  <Typography variant="h6" fontWeight={700} color="primary.dark">
                    {formatCurrency(adminData?.bankBalance ?? 0)}
                  </Typography>
                )}
              </CardContent>
            </Card>
            <Card
              onClick={() => navigate('/cash-accounts')}
              sx={{ cursor: 'pointer', '&:hover': { boxShadow: 3 } }}
            >
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="body2" color="text.secondary">Cash Balance</Typography>
                {isLoading ? <Skeleton width={100} /> : (
                  <Typography variant="h6" fontWeight={700} color="success.dark">
                    {formatCurrency(adminData?.cashBalance ?? 0)}
                  </Typography>
                )}
              </CardContent>
            </Card>
            <Card sx={{ gridColumn: 'span 2' }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="body2" color="text.secondary">Total Liquidity</Typography>
                {isLoading ? <Skeleton width={120} /> : (
                  <Typography variant="h5" fontWeight={700}>
                    {formatCurrency(adminData?.totalLiquidity ?? 0)}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Box>
        </Box>
      </Box>

      {/* ═══════════════════════════════════════════════════════════════
          D. Project Progress (additive — surfaces existing Phase.progressPercent)
          E. Procurement Status (additive — simple counts)
      ═══════════════════════════════════════════════════════════════ */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: 2,
          mb: { xs: 2, sm: 3 },
        }}
      >
        {/* ── Project Progress — surfaces existing Phase.progressPercent (read-only) ── */}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <TrendingUpIcon color="primary" fontSize="small" />
            Project Progress
          </Typography>
          <Card sx={{ overflow: 'hidden', width: '100%', maxWidth: '100%' }}>
            <ScrollableTableContainer>
              <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 480 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 600, width: 180, position: 'sticky', left: 0, bgcolor: 'action.hover', zIndex: 2, borderRight: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>Phase</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 130, overflow: 'hidden' }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 170, overflow: 'hidden' }}>Progress</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={3}><Skeleton variant="rectangular" height={36} /></TableCell></TableRow>
                  ) : (adminData?.phases ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} align="center">
                        <Typography color="text.secondary" sx={{ py: 2 }}>No phases tracked yet</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    (adminData?.phases ?? []).map((p) => {
                      const pct = Math.min(100, Math.max(0, p.progressPercent));
                      const barColor = pct >= 100 ? 'success' : pct >= 50 ? 'primary' : 'warning';
                      return (
                        <TableRow key={p.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate('/work')}>
                          <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1, borderRight: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
                            <Typography variant="body2" fontWeight={500} noWrap>{p.name}</Typography>
                          </TableCell>
                          <TableCell sx={{ overflow: 'hidden' }}>
                            <Chip label={p.status.replace(/_/g, ' ')} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                          </TableCell>
                          <TableCell sx={{ overflow: 'hidden' }}>
                            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                              <LinearProgress variant="determinate" value={pct} color={barColor as 'success' | 'primary' | 'warning'} sx={{ flex: 1, height: 6, borderRadius: 3, minWidth: 40 }} />
                              <Typography variant="caption" fontWeight={700} sx={{ minWidth: 32, fontSize: '0.7rem', flexShrink: 0 }}>{pct.toFixed(0)}%</Typography>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </ScrollableTableContainer>
          </Card>
        </Box>

        {/* ── Procurement Status — simple counts (additive) ── */}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <ReceiptIcon color="primary" fontSize="small" />
            Procurement Status
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr 1fr' }, gap: 1.5 }}>
            <Card onClick={() => setProcurementDialog('quotations')} sx={{ cursor: 'pointer', '&:hover': { boxShadow: 3 } }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary">Quotations</Typography>
                {isLoading ? <Skeleton width={40} /> : (
                  <>
                    <Typography variant="h6" fontWeight={700}>{adminData?.procurement?.totalQuotations ?? 0}</Typography>
                    <Typography variant="caption" color="warning.main" sx={{ fontSize: '0.65rem' }}>
                      {adminData?.procurement?.pendingQuotations ?? 0} pending
                    </Typography>
                  </>
                )}
              </CardContent>
            </Card>
            <Card onClick={() => setProcurementDialog('pos')} sx={{ cursor: 'pointer', '&:hover': { boxShadow: 3 } }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary">Purchase Orders</Typography>
                {isLoading ? <Skeleton width={40} /> : (
                  <>
                    <Typography variant="h6" fontWeight={700}>{adminData?.procurement?.totalPurchaseOrders ?? 0}</Typography>
                    <Typography variant="caption" color="warning.main" sx={{ fontSize: '0.65rem' }}>
                      {adminData?.procurement?.pendingPOs ?? 0} pending
                    </Typography>
                  </>
                )}
              </CardContent>
            </Card>
            <Card onClick={() => setProcurementDialog('invoices')} sx={{ cursor: 'pointer', '&:hover': { boxShadow: 3 } }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary">Invoices</Typography>
                {isLoading ? <Skeleton width={40} /> : (
                  <>
                    <Typography variant="h6" fontWeight={700}>{adminData?.procurement?.totalInvoices ?? 0}</Typography>
                    <Typography variant="caption" color="warning.main" sx={{ fontSize: '0.65rem' }}>
                      {adminData?.procurement?.pendingInvoices ?? 0} pending
                    </Typography>
                  </>
                )}
              </CardContent>
            </Card>
          </Box>
        </Box>
      </Box>

      {/* ── Recent Transactions ── */}
      <Typography variant="subtitle1" gutterBottom fontWeight={600} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <PaymentsIcon color="action" fontSize="small" />
        Recent Transactions
      </Typography>
      <Card sx={{ mb: { xs: 2, sm: 3 }, overflow: 'hidden', width: '100%', maxWidth: '100%' }}>
        <ScrollableTableContainer>
            <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 730 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell sx={{ fontWeight: 600, width: 160, position: 'sticky', left: 0, bgcolor: 'action.hover', zIndex: 2, borderRight: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>Account</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 240, overflow: 'hidden' }}>Description</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, width: 120, overflow: 'hidden' }}>Amount</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 100, overflow: 'hidden' }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 110, overflow: 'hidden' }}>Date</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5}><Skeleton variant="rectangular" height={36} /></TableCell>
                  </TableRow>
                ) : recentTransactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      <Typography color="text.secondary" sx={{ py: 2 }}>No recent transactions</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  recentTransactions.map((t) => (
                    <TableRow
                      key={t.id}
                      hover
                      onClick={() => navigate(t.accountType === 'BANK' ? '/bank-accounts' : '/cash-accounts')}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1, borderRight: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                          <Chip
                            label={t.accountType}
                            size="small"
                            color={t.isInflow ? 'success' : 'error'}
                            variant="outlined"
                            sx={{ height: 18, fontSize: '0.65rem', flexShrink: 0 }}
                          />
                          <Typography variant="body2" fontWeight={500} noWrap>{t.account}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ overflow: 'hidden' }}>
                        <Typography variant="body2" noWrap>{t.description || t.type.replace(/_/g, ' ').toLowerCase()}</Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ overflow: 'hidden' }}>
                        <Typography variant="body2" fontWeight={600} noWrap color={t.isInflow ? 'success.main' : 'error.main'}>
                          {t.isInflow ? '+' : '−'}{formatCurrency(t.amount)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ overflow: 'hidden' }}>
                        <Chip label={t.isInflow ? 'Inflow' : 'Outflow'} size="small" color={t.isInflow ? 'success' : 'error'} variant="outlined" />
                      </TableCell>
                      <TableCell sx={{ overflow: 'hidden' }}>
                        <Typography variant="caption" color="text.secondary" noWrap>{formatDate(t.date)}</Typography>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
        </ScrollableTableContainer>
      </Card>

      {/* ── Document Summary ── */}
      <Box sx={{ mb: 3 }}>
        <DocumentSummaryCard compact={isMobile} />
      </Box>

      {/* ── Material Rate Tracker (admin only) ── */}
      <Box sx={{ mb: 3 }}>
        <RateTrackerWidget />
      </Box>

      {/* ── Recent Quotations ── */}
      <Typography variant="subtitle1" gutterBottom fontWeight={600} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <ReceiptIcon color="action" fontSize="small" />
        Recent Quotations
      </Typography>
      <Card sx={{ mb: { xs: 2, sm: 3 }, overflow: 'hidden', width: '100%', maxWidth: '100%' }}>
        <ScrollableTableContainer>
            <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 550 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell sx={{ fontWeight: 600, width: 130, position: 'sticky', left: 0, bgcolor: 'action.hover', zIndex: 2, borderRight: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>Number</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 180, overflow: 'hidden' }}>Vendor</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, width: 120, overflow: 'hidden' }}>Total</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 120, overflow: 'hidden' }}>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4}><Skeleton variant="rectangular" height={36} /></TableCell>
                  </TableRow>
                ) : recentQuotations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center">
                      <Typography color="text.secondary" sx={{ py: 2 }}>No recent quotations</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  recentQuotations.slice(0, 5).map((q) => (
                    <TableRow
                      key={q.id}
                      hover
                      onClick={() => navigate('/quotations')}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1, borderRight: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
                        <Typography variant="body2" fontWeight={500} noWrap>{q.quotationNumber}</Typography>
                      </TableCell>
                      <TableCell sx={{ overflow: 'hidden' }}>
                        <Typography variant="body2" noWrap>{q.vendorName}</Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ overflow: 'hidden' }}>
                        <Typography variant="body2" fontWeight={600} noWrap>{formatCurrency(q.grandTotal)}</Typography>
                      </TableCell>
                      <TableCell sx={{ overflow: 'hidden' }}>
                        <Chip label={q.status.replace(/_/g, ' ')} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
        </ScrollableTableContainer>
      </Card>

      {/* ── Recent Purchase Orders (additive — same pattern as recentQuotations) ── */}
      <Typography variant="subtitle1" gutterBottom fontWeight={600} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <ReceiptIcon color="action" fontSize="small" />
        Recent Purchase Orders
      </Typography>
      <Card sx={{ mb: { xs: 2, sm: 3 }, overflow: 'hidden', width: '100%', maxWidth: '100%' }}>
        <ScrollableTableContainer>
            <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 550 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell sx={{ fontWeight: 600, width: 130, position: 'sticky', left: 0, bgcolor: 'action.hover', zIndex: 2, borderRight: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>PO Number</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 180, overflow: 'hidden' }}>Vendor</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, width: 120, overflow: 'hidden' }}>Total</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 120, overflow: 'hidden' }}>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4}><Skeleton variant="rectangular" height={36} /></TableCell>
                  </TableRow>
                ) : (adminData?.recentPOs ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center">
                      <Typography color="text.secondary" sx={{ py: 2 }}>No recent purchase orders</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  (adminData?.recentPOs ?? []).slice(0, 5).map((p) => (
                    <TableRow
                      key={p.id}
                      hover
                      onClick={() => navigate('/pos')}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1, borderRight: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
                        <Typography variant="body2" fontWeight={500} noWrap>{p.poNumber}</Typography>
                      </TableCell>
                      <TableCell sx={{ overflow: 'hidden' }}>
                        <Typography variant="body2" noWrap>{p.vendorName}</Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ overflow: 'hidden' }}>
                        <Typography variant="body2" fontWeight={600} noWrap>{formatCurrency(p.grandTotal)}</Typography>
                      </TableCell>
                      <TableCell sx={{ overflow: 'hidden' }}>
                        <Chip label={p.status.replace(/_/g, ' ')} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
        </ScrollableTableContainer>
      </Card>

      {/* ── Recent Invoices (additive — same pattern as recentQuotations) ── */}
      <Typography variant="subtitle1" gutterBottom fontWeight={600} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <ReceiptIcon color="action" fontSize="small" />
        Recent Invoices
      </Typography>
      <Card sx={{ mb: { xs: 2, sm: 3 }, overflow: 'hidden', width: '100%', maxWidth: '100%' }}>
        <ScrollableTableContainer>
            <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 550 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell sx={{ fontWeight: 600, width: 130, position: 'sticky', left: 0, bgcolor: 'action.hover', zIndex: 2, borderRight: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>Invoice Code</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 180, overflow: 'hidden' }}>Vendor</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, width: 120, overflow: 'hidden' }}>Total</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 120, overflow: 'hidden' }}>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4}><Skeleton variant="rectangular" height={36} /></TableCell>
                  </TableRow>
                ) : (adminData?.recentInvoices ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center">
                      <Typography color="text.secondary" sx={{ py: 2 }}>No recent invoices</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  (adminData?.recentInvoices ?? []).slice(0, 5).map((i) => (
                    <TableRow
                      key={i.id}
                      hover
                      onClick={() => navigate('/invoices')}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1, borderRight: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
                        <Typography variant="body2" fontWeight={500} noWrap>{i.invoiceCode}</Typography>
                      </TableCell>
                      <TableCell sx={{ overflow: 'hidden' }}>
                        <Typography variant="body2" noWrap>{i.vendorName}</Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ overflow: 'hidden' }}>
                        <Typography variant="body2" fontWeight={600} noWrap>{formatCurrency(i.totalAmount)}</Typography>
                      </TableCell>
                      <TableCell sx={{ overflow: 'hidden' }}>
                        <Chip label={i.verificationStatus.replace(/_/g, ' ')} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
        </ScrollableTableContainer>
      </Card>

      {/* Inward funds detail dialog — shows individual inflow transactions */}
      <Dialog
        open={inwardDialogOpen}
        onClose={() => setInwardDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <TrendingUpIcon color="success" />
            <Typography variant="h6" component="span" fontWeight={600}>Inward Funds Details</Typography>
          </Stack>
          {!inwardDetailLoading && inwardDetail && (
            <Stack direction="row" spacing={2} alignItems="center">
              <Chip label={`${inwardDetail.totalCount} transactions`} size="small" color="default" />
              <Typography variant="h6" fontWeight={700} color="success.main">
                {formatCurrency(inwardDetail.totalAmount)}
              </Typography>
            </Stack>
          )}
        </DialogTitle>
        <DialogContent dividers>
          {inwardDetailLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><Skeleton variant="rectangular" height={200} /></Box>
          ) : (inwardDetail?.transactions ?? []).length === 0 ? (
            <Alert severity="info">No inward fund transactions found.</Alert>
          ) : (
            <ScrollableTableContainer>
              <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 600 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 600, width: 100, position: 'sticky', left: 0, bgcolor: 'action.hover', zIndex: 2, borderRight: '1px solid', borderColor: 'divider' }}>Date</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 70 }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 150 }}>Account</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 220 }}>Description</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, width: 120 }}>Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(inwardDetail?.transactions ?? []).map((t) => (
                    <TableRow key={t.id} hover>
                      <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1, borderRight: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="caption" noWrap>{formatDate(t.date)}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={t.accountType} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" noWrap>{t.account}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" noWrap>{t.description || '—'}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" fontWeight={700} color="success.main" noWrap>+{formatCurrency(t.amount)}</Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollableTableContainer>
          )}
        </DialogContent>
      </Dialog>

      {/* Expenditure detail dialog — shows individual outflow transactions */}
      <Dialog
        open={expenditureDialogOpen}
        onClose={() => setExpenditureDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <TrendingDownIcon color="error" />
            <Typography variant="h6" component="span" fontWeight={600}>Expenditure Details</Typography>
          </Stack>
          {!expenditureDetailLoading && expenditureDetail && (
            <Stack direction="row" spacing={2} alignItems="center">
              <Chip label={`${expenditureDetail.totalCount} transactions`} size="small" color="default" />
              <Typography variant="h6" fontWeight={700} color="error.main">
                {formatCurrency(expenditureDetail.totalAmount)}
              </Typography>
            </Stack>
          )}
        </DialogTitle>
        <DialogContent dividers>
          {expenditureDetailLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><Skeleton variant="rectangular" height={200} /></Box>
          ) : (expenditureDetail?.transactions ?? []).length === 0 ? (
            <Alert severity="info">No expenditure transactions found.</Alert>
          ) : (
            <ScrollableTableContainer>
              <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 630 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 600, width: 100, position: 'sticky', left: 0, bgcolor: 'action.hover', zIndex: 2, borderRight: '1px solid', borderColor: 'divider' }}>Date</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 70 }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 180 }}>Budget Head</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 220 }}>Description</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, width: 120 }}>Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(expenditureDetail?.transactions ?? []).map((t) => (
                    <TableRow key={t.id} hover>
                      <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1, borderRight: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="caption" noWrap>{formatDate(t.date)}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={t.accountType} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                      </TableCell>
                      <TableCell>
                        {t.budgetHead ? (
                          <Chip label={t.budgetHead.particulars} size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: '0.65rem', maxWidth: 160 }} />
                        ) : (
                          <Typography variant="body2" color="text.secondary" noWrap>—</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" noWrap>{t.description || '—'}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" fontWeight={700} color="error.main" noWrap>{formatCurrency(t.amount)}</Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollableTableContainer>
          )}
        </DialogContent>
      </Dialog>

      {/* Quotations detail dialog */}
      <Dialog
        open={procurementDialog === 'quotations'}
        onClose={() => setProcurementDialog(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <ReceiptIcon color="primary" />
            <Typography variant="h6" component="span" fontWeight={600}>Quotations</Typography>
          </Stack>
          {!quotationDetailLoading && quotationDetail && (
            <Chip label={`${quotationDetail.pagination.total} total`} size="small" color="default" />
          )}
        </DialogTitle>
        <DialogContent dividers>
          {actionError && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setActionError('')}>{actionError}</Alert>}
          {quotationDetailLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><Skeleton variant="rectangular" height={200} /></Box>
          ) : (quotationDetail?.data ?? []).length === 0 ? (
            <Alert severity="info">No quotations found.</Alert>
          ) : (
            <ScrollableTableContainer>
              <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 650 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 600, width: 120 }}>Number</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 140 }}>Vendor</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, width: 110 }}>Amount</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 110 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 90 }}>Date</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 80 }}>Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(quotationDetail?.data ?? []).map((q) => (
                    <TableRow key={q.id} hover>
                      <TableCell><Typography variant="body2" noWrap>{q.quotationNumber}</Typography></TableCell>
                      <TableCell><Typography variant="body2" noWrap>{q.vendor?.name ?? '—'}</Typography></TableCell>
                      <TableCell align="right"><Typography variant="body2" fontWeight={700} noWrap>{formatCurrency(q.grandTotal)}</Typography></TableCell>
                      <TableCell><Chip label={q.status} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} /></TableCell>
                      <TableCell><Typography variant="caption" noWrap>{formatDate(q.createdAt)}</Typography></TableCell>
                      <TableCell>
                        {(q.status === 'SUBMITTED' || q.status === 'UNDER_REVIEW') ? (
                          <Stack direction="row" spacing={0.5}>
                            <IconButton size="small" title="Approve" onClick={() => handleApprove('quotations', q.id)}><CheckIcon fontSize="small" color="success" /></IconButton>
                            <IconButton size="small" title="Reject" onClick={() => { setRejectTarget({ type: 'quotations', id: q.id }); setRejectReason(''); }}><CloseIcon fontSize="small" color="error" /></IconButton>
                          </Stack>
                        ) : <Typography variant="caption" color="text.secondary">—</Typography>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollableTableContainer>
          )}
        </DialogContent>
      </Dialog>

      {/* Purchase Orders detail dialog */}
      <Dialog
        open={procurementDialog === 'pos'}
        onClose={() => setProcurementDialog(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <ReceiptIcon color="primary" />
            <Typography variant="h6" component="span" fontWeight={600}>Purchase Orders</Typography>
          </Stack>
          {!poDetailLoading && poDetail && (
            <Chip label={`${poDetail.pagination.total} total`} size="small" color="default" />
          )}
        </DialogTitle>
        <DialogContent dividers>
          {actionError && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setActionError('')}>{actionError}</Alert>}
          {poDetailLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><Skeleton variant="rectangular" height={200} /></Box>
          ) : (poDetail?.data ?? []).length === 0 ? (
            <Alert severity="info">No purchase orders found.</Alert>
          ) : (
            <ScrollableTableContainer>
              <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 650 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 600, width: 120 }}>Number</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 140 }}>Vendor</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, width: 110 }}>Amount</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 110 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 90 }}>Date</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 80 }}>Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(poDetail?.data ?? []).map((p) => (
                    <TableRow key={p.id} hover>
                      <TableCell><Typography variant="body2" noWrap>{p.poNumber}</Typography></TableCell>
                      <TableCell><Typography variant="body2" noWrap>{p.vendor?.name ?? '—'}</Typography></TableCell>
                      <TableCell align="right"><Typography variant="body2" fontWeight={700} noWrap>{formatCurrency(p.grandTotal)}</Typography></TableCell>
                      <TableCell><Chip label={p.status} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} /></TableCell>
                      <TableCell><Typography variant="caption" noWrap>{formatDate(p.createdAt)}</Typography></TableCell>
                      <TableCell>
                        {p.status === 'PENDING_APPROVAL' ? (
                          <Stack direction="row" spacing={0.5}>
                            <IconButton size="small" title="Approve" onClick={() => handleApprove('pos', p.id)}><CheckIcon fontSize="small" color="success" /></IconButton>
                            <IconButton size="small" title="Reject" onClick={() => { setRejectTarget({ type: 'pos', id: p.id }); setRejectReason(''); }}><CloseIcon fontSize="small" color="error" /></IconButton>
                          </Stack>
                        ) : <Typography variant="caption" color="text.secondary">—</Typography>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollableTableContainer>
          )}
        </DialogContent>
      </Dialog>

      {/* Invoices detail dialog */}
      <Dialog
        open={procurementDialog === 'invoices'}
        onClose={() => setProcurementDialog(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <ReceiptIcon color="primary" />
            <Typography variant="h6" component="span" fontWeight={600}>Invoices</Typography>
          </Stack>
          {!invoiceDetailLoading && invoiceDetail && (
            <Chip label={`${invoiceDetail.pagination.total} total`} size="small" color="default" />
          )}
        </DialogTitle>
        <DialogContent dividers>
          {actionError && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setActionError('')}>{actionError}</Alert>}
          {invoiceDetailLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><Skeleton variant="rectangular" height={200} /></Box>
          ) : (invoiceDetail?.data ?? []).length === 0 ? (
            <Alert severity="info">No invoices found.</Alert>
          ) : (
            <ScrollableTableContainer>
              <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 650 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 600, width: 120 }}>Code</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 140 }}>Vendor</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, width: 110 }}>Amount</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 120 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 90 }}>Date</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: 80 }}>Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(invoiceDetail?.data ?? []).map((i) => (
                    <TableRow key={i.id} hover>
                      <TableCell><Typography variant="body2" noWrap>{i.invoiceCode}</Typography></TableCell>
                      <TableCell><Typography variant="body2" noWrap>{i.vendor?.name ?? '—'}</Typography></TableCell>
                      <TableCell align="right"><Typography variant="body2" fontWeight={700} noWrap>{formatCurrency(i.totalAmount)}</Typography></TableCell>
                      <TableCell><Chip label={i.verificationStatus} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} /></TableCell>
                      <TableCell><Typography variant="caption" noWrap>{formatDate(i.createdAt)}</Typography></TableCell>
                      <TableCell>
                        {i.verificationStatus === 'PENDING' ? (
                          <Stack direction="row" spacing={0.5}>
                            <IconButton size="small" title="Approve" onClick={() => handleApprove('invoices', i.id)}><CheckIcon fontSize="small" color="success" /></IconButton>
                            <IconButton size="small" title="Reject" onClick={() => { setRejectTarget({ type: 'invoices', id: i.id }); setRejectReason(''); }}><CloseIcon fontSize="small" color="error" /></IconButton>
                          </Stack>
                        ) : <Typography variant="caption" color="text.secondary">—</Typography>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollableTableContainer>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject reason dialog */}
      <Dialog open={!!rejectTarget} onClose={() => { setRejectTarget(null); setRejectReason(''); }} maxWidth="xs" fullWidth>
        <DialogTitle>Reject &mdash; Reason</DialogTitle>
        <DialogContent>
          {actionError && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setActionError('')}>{actionError}</Alert>}
          <TextField
            autoFocus
            fullWidth
            multiline
            rows={3}
            label="Reason for rejection"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Enter reason..."
            size="small"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setRejectTarget(null); setRejectReason(''); setActionError(''); }}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleRejectSubmit}>Reject</Button>
        </DialogActions>
      </Dialog>

      {/* Pending items dialog */}
      {pendingDialog && (
        <PendingItemsDialog
          open={!!pendingDialog}
          entityType={pendingDialog}
          user={user}
          onClose={() => setPendingDialog(null)}
        />
      )}
    </Box>
  );
}
