import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { theme } from './config/theme';
import AppShell from './components/AppShell';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import VendorsPage from './pages/VendorsPage';
import QuotationsPage from './pages/QuotationsPage';
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import InvoicesPage from './pages/InvoicesPage';
import PaymentsPage from './pages/PaymentsPage';
import GatePassesPage from './pages/GatePassesPage';
import InventoryPage from './pages/InventoryPage';
import PhasesPage from './pages/PhasesPage';
import ActivitiesPage from './pages/ActivitiesPage';
import PhotosPage from './pages/PhotosPage';
import IssuesPage from './pages/IssuesPage';
import InspectionsPage from './pages/InspectionsPage';
import DocumentsPage from './pages/DocumentsPage';
import ContractsPage from './pages/ContractsPage';
import LabourPage from './pages/LabourPage';
import AuditLogPage from './pages/AuditLogPage';
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
  { path: '/inventory', element: <InventoryPage /> },
  { path: '/labour', element: <LabourPage /> },
  { path: '/phases', element: <PhasesPage /> },
  { path: '/activities', element: <ActivitiesPage /> },
  { path: '/photos', element: <PhotosPage /> },
  { path: '/issues', element: <IssuesPage /> },
  { path: '/inspections', element: <InspectionsPage /> },
  { path: '/documents', element: <DocumentsPage /> },
  { path: '/contracts', element: <ContractsPage /> },
  { path: '/audit', element: <AuditLogPage /> },
];

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ErrorBoundary>
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
          </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
