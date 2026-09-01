import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { theme } from './config/theme';
import AppShell from './components/AppShell';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorScreen from './components/ErrorScreen';
import OfflineBanner from './components/OfflineBanner';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import VendorsPage from './pages/VendorsPage';
import QuotationsPage from './pages/QuotationsPage';
import WorkCalendarPage from './pages/WorkCalendarPage';
import WorkListPage from './pages/WorkListPage';
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import InvoicesPage from './pages/InvoicesPage';
import PaymentsPage from './pages/PaymentsPage';
import GatePassesPage from './pages/GatePassesPage';
import GoodsReceiptsPage from './pages/GoodsReceiptsPage';
import GSTRecordsPage from './pages/GSTRecordsPage';
import BudgetHeadsPage from './pages/BudgetHeadsPage';
import BankAccountsPage from './pages/BankAccountsPage';
import CashAccountsPage from './pages/CashAccountsPage';
import OwnerAccountPage from './pages/OwnerAccountPage';
import FinanceDashboardPage from './pages/FinanceDashboardPage';
import FinanceReportsPage from './pages/FinanceReportsPage';
import LedgersPage from './pages/LedgersPage';
import VouchersPage from './pages/VouchersPage';
import AccountingReportsPage from './pages/AccountingReportsPage';
import InventoryPage from './pages/InventoryPage';
import AssetsPage from './pages/AssetsPage';
import AssetDetailPage from './pages/AssetDetailPage';
import AssetScanPage from './pages/AssetScanPage';
import PhotosPage from './pages/PhotosPage';
import IssuesPage from './pages/IssuesPage';
import InspectionsPage from './pages/InspectionsPage';
import DocumentsPage from './pages/DocumentsPage';
import ContractsPage from './pages/ContractsPage';
import LabourPage from './pages/LabourPage';
import AuditLogPage from './pages/AuditLogPage';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/UsersPage';
import ErrorBoundary from './components/ErrorBoundary';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

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
];

export default function App() {
  const online = useOnlineStatus();

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ErrorBoundary>
            <OfflineBanner />
            {!online ? (
              <ErrorScreen variant="offline" />
            ) : (
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                {/* Public route — asset QR scan, no auth required */}
                <Route path="/scan/:assetId" element={<AssetScanPage />} />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <AppShell>
                        <DashboardPage />
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
                          {route.element}
                        </AppShell>
                      </ProtectedRoute>
                    }
                  />
                ))}
                <Route path="/vendor" element={<ProtectedRoute><AppShell><Navigate to="/vendors" replace /></AppShell></ProtectedRoute>} />
                <Route path="*" element={<ErrorScreen variant="404" />} />
              </Routes>
            )}
          </ErrorBoundary>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
