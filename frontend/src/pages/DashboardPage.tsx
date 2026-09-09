import { useState } from 'react';
import { Box, Card, CardContent, Typography, Skeleton, Alert, Chip, useMediaQuery, useTheme } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { UserRole } from '@hospital-erp/shared';
import api from '../config/api';
import { formatCurrency } from '../utils/enumOptions';
import { AnimatedNumber } from '../components/AnimatedNumber';
import MoneyFlowSankey from '../components/MoneyFlowSankey';
import GanttChart from '../components/GanttChart';
import PendingItemsDialog from '../components/PendingItemsDialog';
import AmountUsedTodayWidget from '../components/AmountUsedTodayWidget';
import DocumentSummaryCard from '../components/DocumentSummaryCard';
import FinanceSummaryCard from '../components/FinanceSummaryCard';
import { useAuthStore } from '../stores/authStore';
import AdminDashboardPage from './AdminDashboardPage';

type PendingType = 'payments' | 'quotations' | 'pos' | 'invoices';

export default function DashboardPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const user = useAuthStore((s) => s.user);

  // ── Role-based dashboard branch ──
  // ADMIN, ADMIN_2, and ACCOUNTANT see the dedicated Admin dashboard
  // (which includes the Expenditure card and other finance summaries).
  // PROJECT_HEAD and other allowed roles see the existing dashboard.
  // This branch is driven solely by the logged-in user's role from authStore,
  // not by user ID, phone number, or any hardcoded allowlist. Any user
  // assigned ADMIN, ADMIN_2, or ACCOUNTANT will automatically see the admin dashboard.
  const isAdmin = user?.role === UserRole.ADMIN || user?.role === UserRole.ADMIN_2 || user?.role === UserRole.ACCOUNTANT;
  if (isAdmin) {
    return <AdminDashboardPage />;
  }

  // ── Existing dashboard for all non-admin roles (unchanged) ──

  const { data: summary, isLoading, isError } = useQuery({
    queryKey: ['/dashboard/summary'],
    queryFn: async () => {
      const response = await api.get('/dashboard/summary');
      return response.data;
    },
  });

  const [pendingDialog, setPendingDialog] = useState<PendingType | null>(null);

  // Amount Used Today widget — visible to admin + accountant roles only.
  // Note: admins never reach this code path (they get AdminDashboardPage above).
  // This conditional only affects ACCOUNTANT and other non-admin roles.
  const canSeeTodaySpend =
    user?.role === UserRole.ACCOUNTANT;

  return (
    <Box>
      <Typography variant="h5" gutterBottom fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
        Dashboard
      </Typography>

      {summary?.project && (
        <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary" component="span">
            Project: <strong>{summary.project.name}</strong>
          </Typography>
          <Chip label={summary.project.status} size="small" />
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2, mb: 3 }}>
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2" gutterBottom>Budget Heads</Typography>
            {isLoading ? <Skeleton variant="text" width={120} height={40} /> : <Typography variant="h5"><AnimatedNumber value={summary?.totalBudget ?? 0} format={(n) => formatCurrency(n)} /></Typography>}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2" gutterBottom>Committed (POs)</Typography>
            {isLoading ? <Skeleton variant="text" width={120} height={40} /> : <Typography variant="h5"><AnimatedNumber value={summary?.committed ?? 0} format={(n) => formatCurrency(n)} delay={150} /></Typography>}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2" gutterBottom>Paid</Typography>
            {isLoading ? <Skeleton variant="text" width={120} height={40} /> : <Typography variant="h5"><AnimatedNumber value={summary?.paid ?? 0} format={(n) => formatCurrency(n)} delay={300} /></Typography>}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2" gutterBottom>Remaining</Typography>
            {isLoading ? <Skeleton variant="text" width={120} height={40} /> : <Typography variant="h5"><AnimatedNumber value={summary?.remaining ?? 0} format={(n) => formatCurrency(n)} delay={450} /></Typography>}
          </CardContent>
        </Card>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 2, mb: 3 }}>
        {/* Pending Payments — clickable to open pending payments dialog */}
        <Card
          onClick={() => setPendingDialog('payments')}
          sx={{ cursor: 'pointer', transition: 'box-shadow 0.2s, border-color 0.2s', '&:hover': { boxShadow: 3, borderColor: 'primary.main' } }}
        >
          <CardContent>
            <Typography color="text.secondary" variant="body2" gutterBottom>Pending Payments</Typography>
            {isLoading ? <Skeleton variant="text" width={60} height={30} /> : <Typography variant="h4" color="warning.main"><AnimatedNumber value={summary?.pendingPayments ?? 0} delay={600} /></Typography>}
          </CardContent>
        </Card>

        {/* Pending Quotations — clickable to open pending quotations dialog */}
        <Card
          onClick={() => setPendingDialog('quotations')}
          sx={{ cursor: 'pointer', transition: 'box-shadow 0.2s, border-color 0.2s', '&:hover': { boxShadow: 3, borderColor: 'primary.main' } }}
        >
          <CardContent>
            <Typography color="text.secondary" variant="body2" gutterBottom>Pending Quotations</Typography>
            {isLoading ? <Skeleton variant="text" width={60} height={30} /> : <Typography variant="h4" color="warning.main"><AnimatedNumber value={summary?.pendingQuotations ?? 0} delay={800} /></Typography>}
          </CardContent>
        </Card>

        {/* Pending Quotation Value — not clickable (it's a value, not a count) */}
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2" gutterBottom>Pending Quotation Value</Typography>
            {isLoading ? <Skeleton variant="text" width={120} height={30} /> : <Typography variant="h6" color="warning.main"><AnimatedNumber value={summary?.pendingQuotationValue ?? 0} format={(n) => formatCurrency(n)} delay={900} /></Typography>}
          </CardContent>
        </Card>

        {/* Pending POs — clickable to open pending POs dialog */}
        <Card
          onClick={() => setPendingDialog('pos')}
          sx={{ cursor: 'pointer', transition: 'box-shadow 0.2s, border-color 0.2s', '&:hover': { boxShadow: 3, borderColor: 'primary.main' } }}
        >
          <CardContent>
            <Typography color="text.secondary" variant="body2" gutterBottom>Pending POs</Typography>
            {isLoading ? <Skeleton variant="text" width={60} height={30} /> : <Typography variant="h4" color="warning.main"><AnimatedNumber value={summary?.pendingPOs ?? 0} delay={1000} /></Typography>}
          </CardContent>
        </Card>

        {/* Pending Invoices — clickable to open pending invoices dialog */}
        <Card
          onClick={() => setPendingDialog('invoices')}
          sx={{ cursor: 'pointer', transition: 'box-shadow 0.2s, border-color 0.2s', '&:hover': { boxShadow: 3, borderColor: 'primary.main' } }}
        >
          <CardContent>
            <Typography color="text.secondary" variant="body2" gutterBottom>Pending Invoices</Typography>
            {isLoading ? <Skeleton variant="text" width={60} height={30} /> : <Typography variant="h4" color="warning.main"><AnimatedNumber value={summary?.pendingInvoices ?? 0} delay={1100} /></Typography>}
          </CardContent>
        </Card>
      </Box>

      {/* Finance Dashboard + Document Summary — side by side on desktop,
          compact small cards on mobile (like pending PO card style). */}
      <Box
        sx={{
          mb: 3,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr' },
          gap: 2,
        }}
      >
        <FinanceSummaryCard compact={isMobile} />
        <DocumentSummaryCard compact={isMobile} />
      </Box>

      {/* Amount Used Today — accountant only on this dashboard.
          (Admins see it in AdminDashboardPage instead.) */}
      {canSeeTodaySpend && (
        <Box sx={{ mb: 3 }}>
          <AmountUsedTodayWidget />
        </Box>
      )}

      {/* Money Flow Sankey */}
      {!isLoading && summary && (
        <Box sx={{ mb: 3 }}>
          <MoneyFlowSankey
            totalBudget={summary.totalBudget ?? 0}
            committed={summary.committed ?? 0}
            paid={summary.paid ?? 0}
          />
        </Box>
      )}

      {/* Project Timeline (Gantt) */}
      <Box sx={{ mb: 3 }}>
        <GanttChart />
      </Box>

      {isError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Dashboard data will appear once the backend API is connected and seeded.
        </Alert>
      )}

      {/* Pending items quick-action dialog — opens when a pending card is clicked */}
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
