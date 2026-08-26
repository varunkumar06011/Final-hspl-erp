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
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import InvoicesPage from './pages/InvoicesPage';
import PaymentsPage from './pages/PaymentsPage';
import GatePassesPage from './pages/GatePassesPage';
import GoodsReceiptsPage from './pages/GoodsReceiptsPage';
import GSTRecordsPage from './pages/GSTRecordsPage';
import InventoryPage from './pages/InventoryPage';
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
  { path: '/pos', element: <PurchaseOrdersPage /> },
  { path: '/invoices', element: <InvoicesPage /> },
  { path: '/payments', element: <PaymentsPage /> },
  { path: '/gate-passes', element: <GatePassesPage /> },
  { path: '/goods-receipts', element: <GoodsReceiptsPage /> },
  { path: '/gst-records', element: <GSTRecordsPage /> },
  { path: '/inventory', element: <InventoryPage /> },
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
