import { Suspense, lazy } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { hydrateDashboardCache, watchDashboardCache } from './utils/dashboardCache';
import { Box, CircularProgress } from '@mui/material';
import { Permission, UserRole } from '@hospital-erp/shared';
import { ColorModeProvider } from './config/ColorModeContext';
import { ToastProvider } from './components/ToastProvider';
import AppShell from './components/AppShell';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorScreen from './components/ErrorScreen';
import OfflineBanner from './components/OfflineBanner';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import ErrorBoundary from './components/ErrorBoundary';
import LoginPage from './pages/LoginPage';
import { isNative } from './config/appConfig';
import OpeningVideo from './components/OpeningVideo';

// Retry a failed lazy chunk once — a flaky mobile fetch or a mid-deploy
// window can drop a chunk request; retrying recovers instead of crashing
// into the error boundary.
function lazyWithRetry<T extends React.ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch {
      return factory();
    }
  });
}

// Pages are lazy-loaded so the boot bundle only contains the app shell +
// login. Previously all ~45 pages (and their heavy deps — jsPDF, charts,
// firebase/messaging) were in one 3.8MB chunk that had to download+parse
// before ANYTHING rendered — the cause of the slow/blank iOS Home Screen
// launches. Each page now streams on first navigation instead.
const DashboardPage = lazyWithRetry(() => import('./pages/DashboardPage'));
const VendorsPage = lazyWithRetry(() => import('./pages/VendorsPage'));
const QuotationsPage = lazyWithRetry(() => import('./pages/QuotationsPage'));
const WorkCalendarPage = lazyWithRetry(() => import('./pages/WorkCalendarPage'));
const WorkListPage = lazyWithRetry(() => import('./pages/WorkListPage'));
const PurchaseOrdersPage = lazyWithRetry(() => import('./pages/PurchaseOrdersPage'));
const InvoicesPage = lazyWithRetry(() => import('./pages/InvoicesPage'));
const PaymentsPage = lazyWithRetry(() => import('./pages/PaymentsPage'));
const GatePassesPage = lazyWithRetry(() => import('./pages/GatePassesPage'));
const GoodsReceiptsPage = lazyWithRetry(() => import('./pages/GoodsReceiptsPage'));
const GSTRecordsPage = lazyWithRetry(() => import('./pages/GSTRecordsPage'));
const BudgetHeadsPage = lazyWithRetry(() => import('./pages/BudgetHeadsPage'));
const BankAccountsPage = lazyWithRetry(() => import('./pages/BankAccountsPage'));
const CashAccountsPage = lazyWithRetry(() => import('./pages/CashAccountsPage'));
const OwnerAccountPage = lazyWithRetry(() => import('./pages/OwnerAccountPage'));
const FinanceDashboardPage = lazyWithRetry(() => import('./pages/FinanceDashboardPage'));
const FinanceReportsPage = lazyWithRetry(() => import('./pages/FinanceReportsPage'));
const LedgersPage = lazyWithRetry(() => import('./pages/LedgersPage'));
const VouchersPage = lazyWithRetry(() => import('./pages/VouchersPage'));
const AccountingReportsPage = lazyWithRetry(() => import('./pages/AccountingReportsPage'));
const PaymentReportPage = lazyWithRetry(() => import('./pages/PaymentReportPage'));
const InventoryPage = lazyWithRetry(() => import('./pages/InventoryPage'));
const AssetsPage = lazyWithRetry(() => import('./pages/AssetsPage'));
const AssetDetailPage = lazyWithRetry(() => import('./pages/AssetDetailPage'));
const AssetScanPage = lazyWithRetry(() => import('./pages/AssetScanPage'));
const PhotosPage = lazyWithRetry(() => import('./pages/PhotosPage'));
const IssuesPage = lazyWithRetry(() => import('./pages/IssuesPage'));
const InspectionsPage = lazyWithRetry(() => import('./pages/InspectionsPage'));
const DocumentsPage = lazyWithRetry(() => import('./pages/DocumentsPage'));
const ContractsPage = lazyWithRetry(() => import('./pages/ContractsPage'));
const LabourPage = lazyWithRetry(() => import('./pages/LabourPage'));
const AuditLogPage = lazyWithRetry(() => import('./pages/AuditLogPage'));
const SettingsPage = lazyWithRetry(() => import('./pages/SettingsPage'));
const UsersPage = lazyWithRetry(() => import('./pages/UsersPage'));
const InwardFundsPage = lazyWithRetry(() => import('./pages/InwardFundsPage'));
const ExpenditurePage = lazyWithRetry(() => import('./pages/ExpenditurePage'));
const MaterialPurchaseRequestsPage = lazyWithRetry(() => import('./pages/MaterialPurchaseRequestsPage'));
const TransactionRegisterPage = lazyWithRetry(() => import('./pages/TransactionRegisterPage'));

function PageLoader() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 10 }}>
      <CircularProgress />
    </Box>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Cache data for 30s before considering it stale. Without this every
      // navigation re-fetches even when the data hasn't changed.
      staleTime: 30_000,
      // Keep inactive queries in cache for 5 minutes so back-navigation is instant.
      gcTime: 5 * 60_000,
    },
  },
});

// Restore the last dashboard snapshot so relaunches render instantly instead
// of skeletoning while the (possibly sleeping) backend responds. Entries are
// seeded as stale → they refetch in the background and swap in fresh data.
hydrateDashboardCache(queryClient);
watchDashboardCache(queryClient);

const ROUTES = [
  { path: '/vendors', element: <VendorsPage /> },
  { path: '/quotations', element: <QuotationsPage /> },
  { path: '/work', element: <WorkListPage /> },
  { path: '/work-calendar', element: <WorkCalendarPage /> },
  { path: '/pos', element: <PurchaseOrdersPage /> },
  { path: '/invoices', element: <InvoicesPage /> },
  { path: '/payments', element: <PaymentsPage /> },
  { path: '/gate-passes', element: <GatePassesPage /> },
  { path: '/goods-receipts', element: <GoodsReceiptsPage /> },
  { path: '/gst-records', element: <GSTRecordsPage /> },
  { path: '/budget-heads', element: <BudgetHeadsPage /> },
  { path: '/bank-accounts', element: <BankAccountsPage /> },
  { path: '/cash-accounts', element: <CashAccountsPage /> },
  { path: '/owner-accounts', element: <OwnerAccountPage /> },
  { path: '/finance-dashboard', element: <FinanceDashboardPage /> },
  { path: '/finance-reports', element: <FinanceReportsPage /> },
  { path: '/ledgers', element: <LedgersPage /> },
  { path: '/vouchers', element: <VouchersPage /> },
  { path: '/accounting-reports', element: <AccountingReportsPage /> },
  { path: '/payment-reports', element: <PaymentReportPage /> },
  { path: '/inventory', element: <InventoryPage /> },
  { path: '/assets', element: <AssetsPage /> },
  { path: '/assets/:itemId', element: <AssetDetailPage /> },
  { path: '/labour', element: <LabourPage /> },
  { path: '/photos', element: <PhotosPage /> },
  { path: '/issues', element: <IssuesPage /> },
  { path: '/inspections', element: <InspectionsPage /> },
  { path: '/documents', element: <DocumentsPage /> },
  { path: '/contracts', element: <ContractsPage /> },
  { path: '/audit', element: <AuditLogPage /> },
  { path: '/users', element: <UsersPage /> },
  { path: '/settings', element: <SettingsPage /> },
  // ── Admin-only pages (additive — visible to all roles with permission, used by admin dashboard) ──
  { path: '/inward-funds', element: <InwardFundsPage /> },
  { path: '/expenditure', element: <ExpenditurePage /> },
  { path: '/material-purchase-requests', element: <MaterialPurchaseRequestsPage /> },
];

// Inside the native shell the app is served from a bundled origin — there is
// no server to resolve deep paths, so a page like /payments would 404 if the
// webview ever reloaded. Hash routing keeps every route under '/' locally.
const Router = isNative ? HashRouter : BrowserRouter;

export default function App() {
  const online = useOnlineStatus();

  return (
    <ColorModeProvider>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <Router>
            <ErrorBoundary>
              <OfflineBanner />
              {!online ? (
                <ErrorScreen variant="offline" />
              ) : (
                <>
                  {/* Opening video overlay — plays once per app session after
                      login while the app renders/queries underneath it. */}
                  <OpeningVideo />
                  <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  {/* Public route — asset QR scan, no auth required */}
                  <Route path="/scan/:assetId" element={<Suspense fallback={<PageLoader />}><AssetScanPage /></Suspense>} />
                  <Route
                    path="/"
                    element={
                      <ProtectedRoute permission={Permission.VIEW_DASHBOARD}>
                        <AppShell>
                          <Suspense fallback={<PageLoader />}>
                            <DashboardPage />
                          </Suspense>
                        </AppShell>
                      </ProtectedRoute>
                    }
                  />
                  {ROUTES.map((route) => (
                    <Route
                      key={route.path}
                      path={route.path}
                      element={
                        <ProtectedRoute>
                          <AppShell>
                            <Suspense fallback={<PageLoader />}>
                              {route.element}
                            </Suspense>
                          </AppShell>
                        </ProtectedRoute>
                      }
                    />
                  ))}
                  {/* Transaction Register — Accountant + all Admin roles only (backend also enforces) */}
                  <Route
                    path="/transaction-register"
                    element={
                      <ProtectedRoute roles={[UserRole.ACCOUNTANT, UserRole.ADMIN]}>
                        <AppShell>
                          <Suspense fallback={<PageLoader />}>
                            <TransactionRegisterPage />
                          </Suspense>
                        </AppShell>
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/vendor" element={<ProtectedRoute><AppShell><Navigate to="/vendors" replace /></AppShell></ProtectedRoute>} />
                  <Route path="*" element={<ErrorScreen variant="404" />} />
                  </Routes>
                </>
              )}
            </ErrorBoundary>
          </Router>
        </QueryClientProvider>
      </ToastProvider>
    </ColorModeProvider>
  );
}
