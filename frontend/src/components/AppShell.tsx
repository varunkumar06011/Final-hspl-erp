import { Box, AppBar, Toolbar, Typography, IconButton, Avatar, Chip, Menu, MenuItem, Drawer, List, ListItem, ListItemIcon, ListItemText, useTheme, useMediaQuery, Snackbar, Alert, CircularProgress, Badge } from '@mui/material';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  Business as VendorIcon,
  Event as WorkIcon,
  Receipt as ReceiptIcon,
  AccountBalance as PaymentIcon,
  Refresh as RefreshIcon,
  LocalShipping as GatePassIcon,
  Inventory as InventoryIcon,
  Engineering as LabourIcon,
  Devices as AssetsIcon,
  CameraAlt as PhotoIcon,
  BugReport as IssueIcon,
  Verified as InspectionIcon,
  Description as DocumentIcon,
  History as AuditIcon,
  Settings as SettingsIcon,
  People as PeopleIcon,
  Logout as LogoutIcon,
  Notifications as NotificationsIcon,
  Search as SearchIcon,
  AccountBalanceWallet as BudgetIcon,
  Savings as BankIcon,
  Savings as SavingsIcon,
  Payments as CashIcon,
  Person as OwnerIcon,
  Dashboard as FinanceDashboardIcon,
  Assessment as ReportsIcon,
  AccountTree as LedgersIcon,
  ArrowDownward as VouchersIcon,
  BarChart as AccountingReportsIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  AutoAwesome as AutoAwesomeIcon,
  SmartToy as AssistantIcon,
  ArrowBack as ArrowBackIcon,
  RequestQuote as PaymentReportIcon,
  ChatBubbleOutline as CommentsNavIcon,
  Forum as ChatNavIcon,
  History as ActivityNavIcon,
  Apartment as ProjectsIcon,
  ToggleOn as ModuleAccessIcon,
  AccountTree as CombinedRecordsIcon,
  ReceiptLong as SiteBillsIcon,
} from '@mui/icons-material';
import { useAuthStore } from '../stores/authStore';
import { APP_MODULES, UserRole, isAdminRole, moduleForPath, type UserResponse } from '@hospital-erp/shared';
import { canManageModuleAccess, canUseModule } from '../utils/moduleAccess';
import { useSessionProfile } from '../hooks/useSessionProfile';
import { onForegroundMessage, enableNotifications, isPushSupported, getPermissionState, PUSH_DEEP_LINK_KEY } from '../config/notifications';
import NotificationBell from './NotificationBell';
import api from '../config/api';
import { useIdleTimeout } from '../hooks/useIdleTimeout';
import { useChatRealtime } from '../hooks/useChatRealtime';
import { useColorMode } from '../config/ColorModeContext';
import GlobalSearch from './GlobalSearch';
import NLQueryBar from './NLQueryBar';
import AssistantDrawer from './AssistantDrawer';
import PresenceBar from './PresenceBar';
import RelatedRecordsMenu from './RelatedRecordsMenu';
import { useTrackPageView } from '../hooks/useTrackPageView';
import { useTranslation } from 'react-i18next';
import LanguageToggle from './LanguageToggle';
import ProjectSwitcher from './ProjectSwitcher';
import type { TFunction } from 'i18next';


const NAV_ITEMS = [
  { label: 'Dashboard', icon: <DashboardIcon />, path: '/', section: '' },
  { label: 'Chat', icon: <ChatNavIcon />, path: '/chat', section: '' },
  { label: 'Work Calendar', icon: <WorkIcon />, path: '/work-calendar', section: '' },
  // ── Procurement ──
  { label: 'Work', icon: <WorkIcon />, path: '/work', section: 'Procurement' },
  { label: 'Combined Records', icon: <CombinedRecordsIcon />, path: '/combined-records', section: 'Procurement' },
  { label: 'Material Requests', icon: <ReceiptIcon />, path: '/material-purchase-requests', section: 'Procurement' },
  { label: 'Site Bills', icon: <SiteBillsIcon />, path: '/site-bills', section: 'Procurement' },
  { label: 'Vendors', icon: <VendorIcon />, path: '/vendors', section: 'Procurement' },
  { label: 'Quotations', icon: <ReceiptIcon />, path: '/quotations', section: 'Procurement' },
  { label: 'Purchase Orders', icon: <ReceiptIcon />, path: '/pos', section: 'Procurement' },
  { label: 'Gate Passes', icon: <GatePassIcon />, path: '/gate-passes', section: 'Procurement' },
  { label: 'Goods Receipts', icon: <ReceiptIcon />, path: '/goods-receipts', section: 'Procurement' },
  { label: 'GST Records', icon: <ReceiptIcon />, path: '/gst-records', section: 'Procurement' },
  // ── Masters (Tally: Accounts Info) ──
  { label: 'Chart of Accounts', icon: <LedgersIcon />, path: '/ledgers', section: 'Masters' },
  { label: 'Bank Ledgers', icon: <BankIcon />, path: '/bank-accounts', section: 'Masters' },
  { label: 'Cash Ledgers', icon: <CashIcon />, path: '/cash-accounts', section: 'Masters' },
  { label: 'Budget Heads', icon: <BudgetIcon />, path: '/budget-heads', section: 'Masters' },
  { label: 'Owner Account', icon: <OwnerIcon />, path: '/owner-accounts', section: 'Masters' },
  // ── Voucher Entry (Tally: Accounting Vouchers) ──
  { label: 'Accounting Vouchers', icon: <VouchersIcon />, path: '/vouchers', section: 'Voucher Entry' },
  { label: 'Payments', icon: <PaymentIcon />, path: '/payments', section: 'Voucher Entry' },
  { label: 'Expenditure', icon: <VouchersIcon />, path: '/expenditure', section: 'Voucher Entry' },
  { label: 'Sales (Invoices)', icon: <ReceiptIcon />, path: '/invoices', section: 'Voucher Entry' },
  // ── Reports (Tally: Display) ──
  { label: 'Finance Dashboard', icon: <FinanceDashboardIcon />, path: '/finance-dashboard', section: 'Reports' },
  { label: 'Accounting Reports', icon: <AccountingReportsIcon />, path: '/accounting-reports', section: 'Reports' },
  { label: 'Finance Reports', icon: <ReportsIcon />, path: '/finance-reports', section: 'Reports' },
  { label: 'Payment Report', icon: <PaymentReportIcon />, path: '/payment-reports', section: 'Reports' },
  // ── Site Operations ──
  { label: 'Inventory', icon: <InventoryIcon />, path: '/inventory', section: 'Site Operations' },
  { label: 'Assets', icon: <AssetsIcon />, path: '/assets', section: 'Site Operations' },
  { label: 'Attendance', icon: <LabourIcon />, path: '/labour', section: 'Site Operations' },
  { label: 'Site Photos', icon: <PhotoIcon />, path: '/photos', section: 'Site Operations' },
  { label: 'Issues', icon: <IssueIcon />, path: '/issues', section: 'Site Operations' },
  { label: 'Inspections', icon: <InspectionIcon />, path: '/inspections', section: 'Site Operations' },
  { label: 'Documents', icon: <DocumentIcon />, path: '/documents', section: 'Site Operations' },
  // ── Admin ──
  { label: 'Comments', icon: <CommentsNavIcon />, path: '/comments', section: 'Admin' },
  { label: 'Activity Log', icon: <ActivityNavIcon />, path: '/activity-log', section: 'Admin' },
  { label: 'Audit Log', icon: <AuditIcon />, path: '/audit', section: 'Admin' },
  { label: 'Users', icon: <PeopleIcon />, path: '/users', section: 'Admin' },
  { label: 'Projects', icon: <ProjectsIcon />, path: '/projects', section: 'Admin' },
  { label: 'Settings', icon: <SettingsIcon />, path: '/settings', section: 'Admin' },
];

// ── Admin-only navigation (ADMIN + ADMIN_2) ──────────────────────────
// Simplified grouping with plain-language labels, used for admin roles and
// the Accountant (see navItemsFor). Same routes as NAV_ITEMS, reorganized into
// clearer sections. Which entries show is decided by module access
// (shared/access.ts), not by fields here.
const ADMIN_NAV_ITEMS = [
  { label: 'Dashboard', icon: <DashboardIcon />, path: '/', section: '' },
  { label: 'Chat', icon: <ChatNavIcon />, path: '/chat', section: '' },
  { label: 'Work', icon: <WorkIcon />, path: '/work', section: '' },
  // ── Accounting (FIRST — client wants accounting first) ──
  { label: 'Inward Funds', icon: <SavingsIcon />, path: '/inward-funds', section: 'Accounting' },
  { label: 'Expenditure', icon: <VouchersIcon />, path: '/expenditure', section: 'Accounting' },
  { label: 'Bank & Cash', icon: <BankIcon />, path: '/bank-accounts', section: 'Accounting' },
  { label: 'Payments', icon: <PaymentIcon />, path: '/payments', section: 'Accounting' },
  { label: 'Vouchers', icon: <VouchersIcon />, path: '/vouchers', section: 'Accounting' },
  { label: 'GST Records', icon: <ReceiptIcon />, path: '/gst-records', section: 'Accounting' },
  { label: 'Chart of Accounts', icon: <LedgersIcon />, path: '/ledgers', section: 'Accounting' },
  // ── Budget ──
  { label: 'Budget Heads', icon: <BudgetIcon />, path: '/budget-heads', section: 'Budget' },
  { label: 'Owner Account', icon: <OwnerIcon />, path: '/owner-accounts', section: 'Budget' },
  // ── Procurement ──
  { label: 'Combined Records', icon: <CombinedRecordsIcon />, path: '/combined-records', section: 'Procurement' },
  { label: 'Material Requests', icon: <ReceiptIcon />, path: '/material-purchase-requests', section: 'Procurement' },
  { label: 'Site Bills', icon: <SiteBillsIcon />, path: '/site-bills', section: 'Procurement' },
  { label: 'Vendors', icon: <VendorIcon />, path: '/vendors', section: 'Procurement' },
  { label: 'Quotations', icon: <ReceiptIcon />, path: '/quotations', section: 'Procurement' },
  { label: 'Purchase Orders', icon: <ReceiptIcon />, path: '/pos', section: 'Procurement' },
  { label: 'Gate Passes', icon: <GatePassIcon />, path: '/gate-passes', section: 'Procurement' },
  { label: 'Goods Receipts', icon: <ReceiptIcon />, path: '/goods-receipts', section: 'Procurement' },
  { label: 'Invoices', icon: <ReceiptIcon />, path: '/invoices', section: 'Procurement' },
  // ── Project ──
  { label: 'Work Calendar', icon: <WorkIcon />, path: '/work-calendar', section: 'Project' },
  { label: 'Work', icon: <WorkIcon />, path: '/work', section: 'Project' },
  { label: 'Issues', icon: <IssueIcon />, path: '/issues', section: 'Project' },
  { label: 'Site Photos', icon: <PhotoIcon />, path: '/photos', section: 'Project' },
  { label: 'Documents', icon: <DocumentIcon />, path: '/documents', section: 'Project' },
  // ── Reports ──
  { label: 'Transaction Register', icon: <ReportsIcon />, path: '/transaction-register', section: 'Reports' },
  { label: 'Finance Dashboard', icon: <FinanceDashboardIcon />, path: '/finance-dashboard', section: 'Reports' },
  { label: 'Accounting Reports', icon: <AccountingReportsIcon />, path: '/accounting-reports', section: 'Reports' },
  { label: 'Finance Reports', icon: <ReportsIcon />, path: '/finance-reports', section: 'Reports' },
  { label: 'Payment Report', icon: <PaymentReportIcon />, path: '/payment-reports', section: 'Reports' },
  // ── Admin ──
  { label: 'Comments', icon: <CommentsNavIcon />, path: '/comments', section: 'Admin' },
  { label: 'Activity Log', icon: <ActivityNavIcon />, path: '/activity-log', section: 'Admin' },
  { label: 'Audit Log', icon: <AuditIcon />, path: '/audit', section: 'Admin' },
  { label: 'Users', icon: <PeopleIcon />, path: '/users', section: 'Admin' },
  { label: 'Projects', icon: <ProjectsIcon />, path: '/projects', section: 'Admin' },
  { label: 'Settings', icon: <SettingsIcon />, path: '/settings', section: 'Admin' },
];

interface NavItem {
  label: string;
  icon: React.ReactElement;
  path: string;
  section: string;
}

const MODULE_ACCESS_ITEM: NavItem = { label: 'Module Access', icon: <ModuleAccessIcon />, path: '/module-access', section: 'Admin' };

const ICON_BY_PATH = new Map<string, React.ReactElement>(
  [...ADMIN_NAV_ITEMS, ...NAV_ITEMS].map((item) => [item.path, item.icon]),
);

/**
 * Sidebar for the signed-in user. Admin roles and the Accountant keep the
 * simplified ADMIN_NAV_ITEMS layout, everyone else NAV_ITEMS. Each entry shows
 * when its module is on for the user (role default, or what Admin 1 / Admin 2
 * set on the Module Access page); a module switched on that the layout lacks is
 * added to its section.
 */
function navItemsFor(user: UserResponse | null): NavItem[] {
  if (!user) return [];
  const layout: NavItem[] =
    isAdminRole(user.role) || user.role === UserRole.ACCOUNTANT ? ADMIN_NAV_ITEMS : NAV_ITEMS;
  const items = layout.filter((item) => {
    const module = moduleForPath(item.path);
    return !module || canUseModule(user, module.key);
  });

  for (const module of APP_MODULES) {
    if (!module.path || items.some((i) => i.path === module.path) || !canUseModule(user, module.key)) continue;
    const section = module.section === 'General' ? '' : module.section;
    const item: NavItem = { label: module.label, icon: ICON_BY_PATH.get(module.path) ?? <ReceiptIcon />, path: module.path, section };
    const lastOfSection = items.map((i) => i.section).lastIndexOf(section);
    const firstAdmin = items.findIndex((i) => i.section === 'Admin');
    const at = lastOfSection >= 0 ? lastOfSection + 1 : firstAdmin >= 0 ? firstAdmin : items.length;
    items.splice(at, 0, item);
  }

  if (canManageModuleAccess(user)) {
    const usersAt = items.findIndex((i) => i.path === '/users');
    items.splice(usersAt >= 0 ? usersAt + 1 : items.length, 0, MODULE_ACCESS_ITEM);
  }
  return items;
}

const ROLE_COLORS: Record<string, string> = {
  [UserRole.SUPERVISOR]: '#546E7A',
  [UserRole.ACCOUNTANT]: '#00897B',
  [UserRole.SITE_SUPERVISOR]: '#6D4C41',
  [UserRole.PROJECT_HEAD]: '#1565C0',
  [UserRole.HEAD_OF_CONSTRUCTION]: '#2E7D32',
  [UserRole.ACCOUNTS_HEAD]: '#00695C',
  [UserRole.ADMIN]: '#ED6C02',
  [UserRole.ADMIN_2]: '#9C27B0',
};

function getRoleColor(role: string): string {
  if (ROLE_COLORS[role]) return ROLE_COLORS[role];
  // Dynamic admin roles (ADMIN_3, ADMIN_4, ...) get the same color as ADMIN
  if (isAdminRole(role)) return ROLE_COLORS[UserRole.ADMIN];
  return '#546E7A';
}

const TRANSLATED_ROLES: string[] = [
  UserRole.SUPERVISOR,
  UserRole.ACCOUNTANT,
  UserRole.SITE_SUPERVISOR,
  UserRole.PROJECT_HEAD,
  UserRole.HEAD_OF_CONSTRUCTION,
  UserRole.ACCOUNTS_HEAD,
  UserRole.ADMIN,
  UserRole.ADMIN_2,
];

function getRoleLabelLocal(role: string, t: TFunction): string {
  if (TRANSLATED_ROLES.includes(role)) return t(`roles.${role}`);
  // Dynamic admin roles (ADMIN_3, ADMIN_4, ...) → "Admin 3", "Admin 4", etc.
  if (isAdminRole(role)) {
    const num = role.split('_')[1];
    return t('roles.adminN', { num });
  }
  return role;
}

const DRAWER_WIDTH = 260;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [nlQueryOpen, setNlQueryOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const { t } = useTranslation();
  const { t: tAssistant } = useTranslation('assistant');
  // The AI assistant is hidden unless the server has it switched on and configured.
  const { data: assistantStatus } = useQuery<{ enabled: boolean }>({
    queryKey: ['assistant-status'],
    queryFn: async () => (await api.get('/assistant/status')).data,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const { mode, toggle: toggleColorMode } = useColorMode();
  useTrackPageView();
  // Auto-logout disabled — user stays logged in until manual logout.
  useIdleTimeout();

  // Pull-to-refresh (mobile) + manual refresh (desktop). Refetches the data
  // in place instead of reloading the whole app — the page stays put and
  // fresh numbers swap in. If any refetch fails (stale tab, broken session
  // state) it falls back to a full reload, which also pulls the latest build.
  // Skipped while offline, where a reload would only show a browser error page.
  const queryClient = useQueryClient();
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const handleManualRefresh = useCallback(() => {
    setManualRefreshing(true);
    queryClient
      .invalidateQueries(undefined, { throwOnError: true })
      .catch(() => {
        if (navigator.onLine) window.location.reload();
      })
      .finally(() => setManualRefreshing(false));
  }, [queryClient]);

  // Cmd+K / Ctrl+K opens global search, Cmd+J / Ctrl+J opens NL query
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setNlQueryOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const [fgNotification, setFgNotification] = useState<{ open: boolean; title: string; body: string; url?: string }>({
    open: false,
    title: '',
    body: '',
  });
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  // Role / module access changes made by an admin apply without signing in again.
  useSessionProfile();
  const chatOn = canUseModule(user, 'chat');
  const assistantOn = !!assistantStatus?.enabled && canUseModule(user, 'assistant');

  // Chat: live updates app-wide, plus the unread count shown next to "Chat" in the sidebar.
  useChatRealtime();
  const { data: unreadChat = 0 } = useQuery<number>({
    queryKey: ['chat', 'unread'],
    queryFn: async () => (await api.get('/chat/unread-count')).data?.count ?? 0,
    enabled: !!user && chatOn,
    refetchInterval: 60000,
  });

  // Unread comments / mentions / replies, shown next to "Comments" in the sidebar.
  const { data: unreadComments = 0 } = useQuery<number>({
    queryKey: ['/comments/unread-count'],
    queryFn: async () => (await api.get('/comments/unread-count')).data?.count ?? 0,
    enabled: !!user,
    refetchInterval: 30000,
  });
  // Opening the Comments page counts as reading them.
  useEffect(() => {
    if (location.pathname !== '/comments' || unreadComments === 0) return;
    api.patch('/comments/mark-read').then(() => {
      queryClient.setQueryData(['/comments/unread-count'], 0);
      queryClient.invalidateQueries({ queryKey: ['/notifications/app'] });
    }).catch(() => {});
  }, [location.pathname, unreadComments, queryClient]);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // Listen for foreground push messages (when the tab is open)
  // Only show popups for notifications sent within the last 2 minutes
  // to prevent old queued messages from appearing as popups
  useEffect(() => {
    const unsubscribe = onForegroundMessage((payload) => {
      const sentAt = Number(payload.data?.timestamp || 0);
      const ageMs = Date.now() - sentAt;
      if (sentAt > 0 && ageMs > 2 * 60 * 1000) {
        return;
      }
      const title = payload.notification?.title || payload.data?.title || t('common.newNotification');
      const body = payload.notification?.body || payload.data?.body || '';
      const url = payload.data?.url;
      setFgNotification({ open: true, title, body, url });
    });
    return unsubscribe;
  }, [t]);

  // Auto-enable notifications on login — request permission and register FCM token
  // Runs once when the user is authenticated. If permission is denied, do nothing.
  useEffect(() => {
    let cancelled = false;
    async function autoEnable() {
      if (!user) return;
      const supported = await isPushSupported();
      if (!supported) return;

      const permission = getPermissionState();
      // If already granted, just ensure the token is registered
      // If default (not asked), request permission automatically
      // If denied, respect the user's choice
      if (permission === 'denied') return;

      const result = await enableNotifications();
      if (!cancelled && result.success) {
        console.log('[Notifications] Auto-enabled on login');
      }
    }
    autoEnable();
    return () => { cancelled = true; };
  }, [user]);

  // Consume a pending notification deep link — a push tapped while the app
  // was closed stores its target before the router (and possibly the login
  // flow) is ready. Once the user is authenticated, navigate to it.
  useEffect(() => {
    if (!user) return;
    try {
      const pending = sessionStorage.getItem(PUSH_DEEP_LINK_KEY);
      if (pending && pending.startsWith('/')) {
        sessionStorage.removeItem(PUSH_DEEP_LINK_KEY);
        navigate(pending);
      }
    } catch { /* storage unavailable */ }
  }, [user, navigate]);

  // Prefetch the dashboard summary the moment the shell mounts — the request
  // overlaps the lazy dashboard chunk download instead of starting after it.
  useEffect(() => {
    if (!user) return;
    const admin = isAdminRole(user.role ?? '') || user.role === UserRole.ACCOUNTANT;
    const path = admin ? '/dashboard/admin-summary' : '/dashboard/summary';
    void queryClient.prefetchQuery({
      queryKey: ['/dashboard', admin ? 'admin-summary' : 'summary'],
      queryFn: async () => (await api.get(path)).data,
      staleTime: 30_000,
    });
  }, [queryClient, user]);

  // Update favicon to the project logo when it changes
  useEffect(() => {
    let objectUrl: string | null = null;
    async function updateFavicon() {
      try {
        const { data: settings } = await api.get('/settings');
        if (!settings.logoUrl) return;
        const response = await api.get('/settings/logo', { responseType: 'blob', params: { projectId: settings.id } });
        const rawMime = response.headers['content-type'];
        const mime = typeof rawMime === 'string' ? rawMime : 'image/png';
        objectUrl = URL.createObjectURL(new Blob([response.data], { type: mime }));
        const url = objectUrl;

        // Update all favicon and apple-touch-icon links with the custom logo
        const icons = document.querySelectorAll("link[rel~='icon']") as NodeListOf<HTMLLinkElement>;
        const appleIcons = document.querySelectorAll("link[rel='apple-touch-icon']") as NodeListOf<HTMLLinkElement>;

        icons.forEach((icon) => {
          icon.href = url;
          icon.type = mime;
        });
        appleIcons.forEach((appleIcon) => {
          appleIcon.href = url;
        });
      } catch {
        // Favicon update is best-effort; keep the default on failure
      }
    }
    updateFavicon();
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  const handleFgNotificationClick = useCallback(() => {
    if (fgNotification.url) {
      navigate(fgNotification.url);
    }
    setFgNotification({ open: false, title: '', body: '', url: undefined });
  }, [fgNotification.url, navigate]);

  const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    if (isMobile) setMobileOpen(false);
  };

  const drawer = (
    <>
      <Toolbar />
      <Box sx={{ overflow: 'auto' }}>
        <List>
          {navItemsFor(user)
            .map((item, idx, arr) => {
            const prevItem = idx > 0 ? arr[idx - 1] : null;
            const showSectionHeader = item.section !== '' && (!prevItem || prevItem.section !== item.section);
            return (
              <Box key={`${item.path}-${idx}`}>
                {showSectionHeader && (
                  <Typography
                    variant="overline"
                    sx={{
                      display: 'block',
                      px: 2.5,
                      pt: 2,
                      pb: 0.5,
                      color: 'text.secondary',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                    }}
                  >
                    {t(`sections.${item.section}`, item.section)}
                  </Typography>
                )}
                <ListItem
                  button
                  onClick={() => handleNavigate(item.path)}
                  selected={location.pathname === item.path}
                  sx={{
                    '&.Mui-selected': {
                      // Navy-tinted selection in dark mode, light-blue in light.
                      bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(79,156,249,.16)' : 'primary.light',
                      borderRight: '4px solid',
                      borderColor: 'primary.main',
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                  <ListItemText primary={t(`nav.${item.label}`, item.label)}primaryTypographyProps={{ fontSize: 14 }} />
                  {item.path === '/chat' && unreadChat > 0 && (
                    <Chip label={unreadChat > 99 ? '99+' : unreadChat} size="small" color="error" sx={{ height: 20, fontWeight: 700 }} />
                  )}
                  {item.path === '/comments' && unreadComments > 0 && (
                    <Chip label={unreadComments > 99 ? '99+' : unreadComments} size="small" color="error" sx={{ height: 20, fontWeight: 700 }} />
                  )}
                </ListItem>
              </Box>
            );
          })}
        </List>
      </Box>
    </>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar
        position="fixed"
        // Admins get a pure-black navbar matching the dark dashboard theme;
        // other roles keep the standard primary bar.
        color={isAdminRole(user?.role ?? '') ? 'default' : 'primary'}
        enableColorOnDark
        sx={{
          zIndex: (theme) => theme.zIndex.drawer + 1,
          ...(isAdminRole(user?.role ?? '') && { bgcolor: '#000', backgroundImage: 'none' }),
        }}
      >
        <Toolbar
          sx={{
            px: { xs: 1, sm: 3 },
            // Tighter icon buttons on phones so the avatar stays inside the bar
            // instead of being pushed off the right edge.
            '& .MuiIconButton-root': { p: { xs: 0.5, sm: 1 }, flexShrink: 0 },
          }}
        >
          {isMobile && (
            <IconButton
              color="inherit"
              edge="start"
              onClick={() => setMobileOpen(!mobileOpen)}
              sx={{ mr: 1 }}
            >
              <MenuIcon />
            </IconButton>
          )}
          <Typography
            variant="h6"
            component="div"
            sx={{ flexGrow: 1, minWidth: 0, fontSize: { xs: '1rem', sm: '1.25rem' }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: { xs: 'none', sm: 'block' } }}
          >
            {t('app.title')}
          </Typography>
          {/* On phones the app title is dropped so the project chip gets the room. */}
          <Box sx={{ flexGrow: 1, display: { xs: 'block', sm: 'none' } }} />
          <ProjectSwitcher />
          <Box sx={{ mr: { xs: 0.5, sm: 1 }, flexShrink: 0 }}>
            <LanguageToggle onDark />
          </Box>
          <IconButton color="inherit" onClick={() => setNlQueryOpen(true)} title={t('shell.askErp')} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
            <AutoAwesomeIcon />
          </IconButton>
          {assistantOn && (
            <IconButton color="inherit" onClick={() => setAssistantOpen(true)} title={tAssistant('open')} aria-label={tAssistant('open')}>
              <AssistantIcon />
            </IconButton>
          )}
          {chatOn && (
            <IconButton color="inherit" onClick={() => navigate('/chat')} title={t('nav.Chat', 'Chat')} aria-label={t('nav.Chat', 'Chat')}>
              <Badge color="error" badgeContent={unreadChat} max={99} invisible={unreadChat === 0}>
                <ChatNavIcon />
              </Badge>
            </IconButton>
          )}
          {!isAdminRole(user?.role ?? '') && (
            <IconButton color="inherit" onClick={toggleColorMode} title={mode === 'dark' ? t('shell.switchToLight') : t('shell.switchToDark')}>
              {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          )}
          <IconButton color="inherit" onClick={handleManualRefresh} title={t('common.refresh')} disabled={manualRefreshing}>
            {manualRefreshing ? <CircularProgress size={20} color="inherit" /> : <RefreshIcon />}
          </IconButton>
          <IconButton color="inherit" onClick={() => setSearchOpen(true)} title={t('common.search')}>
            <SearchIcon />
          </IconButton>
          <Box sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
            <NotificationBell />
          </Box>
          {user && (
            <>
              <Chip
                label={getRoleLabelLocal(user.role, t)}
                size="small"
                sx={{
                  mr: 1,
                  bgcolor: getRoleColor(user.role),
                  color: 'white',
                  fontWeight: 600,
                  display: { xs: 'none', sm: 'flex' },
                }}
              />
              <IconButton onClick={handleMenu} color="inherit">
                <Avatar sx={{ bgcolor: 'secondary.main', width: 32, height: 32 }}>
                  {user.name.charAt(0)}
                </Avatar>
              </IconButton>
              <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose}>
                <MenuItem disabled>
                  <Typography variant="body2">{user.name}</Typography>
                </MenuItem>
                <MenuItem disabled>
                  <Typography variant="body2" color="text.secondary">{user.phone}</Typography>
                </MenuItem>
                <MenuItem onClick={handleLogout}>
                  <LogoutIcon fontSize="small" sx={{ mr: 1 }} /> {t('common.logout')}
                </MenuItem>
              </Menu>
            </>
          )}
        </Toolbar>
      </AppBar>

      {/* Mobile drawer (temporary) */}
      {isMobile ? (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
          }}
        >
          {drawer}
        </Drawer>
      ) : (
        /* Desktop drawer (permanent) */
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
          }}
        >
          {drawer}
        </Drawer>
      )}

      {/* Pull-to-refresh disabled by request — drag-down must not reload or
          reset page state; only the header Refresh button (or app relaunch)
          reloads. overscroll-behavior-y in index.css also suppresses the
          native browser/PWA pull-refresh gesture. */}
      <Box component="main" sx={{ flexGrow: 1, p: { xs: 1.5, sm: 2, md: 3 }, mt: 'calc(64px + env(safe-area-inset-top))', pb: 'max(12px, env(safe-area-inset-bottom))', pl: 'max(12px, env(safe-area-inset-left))', pr: 'max(12px, env(safe-area-inset-right))', width: { xs: '100%', md: 'auto' }, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
        {/* Mobile back button — iPhones have no hardware back gesture.
            React Router sets location.key='default' on the first entry only,
            which reliably detects in-app history (unlike window.history.length,
            which also counts external sites and makes navigate(-1) flaky on iOS). */}
        {isMobile && location.pathname !== '/' && !location.pathname.startsWith('/chat') && (
          <IconButton
            onClick={() => {
              if (location.key !== 'default') {
                navigate(-1);
              } else {
                navigate('/');
              }
            }}
            sx={{
              mb: 1,
              p: 1,
              minWidth: 44,
              minHeight: 44,
              touchAction: 'manipulation',
            }}
            aria-label={t('common.back')}
          >
            <ArrowBackIcon />
          </IconButton>
        )}
        {/* Related records of the record opened on this page */}
        <RelatedRecordsMenu />
        {children}
      </Box>

      {/* Foreground push notification snackbar */}
      <Snackbar
        open={fgNotification.open}
        autoHideDuration={10000}
        onClose={() => setFgNotification({ open: false, title: '', body: '', url: undefined })}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ mt: 'calc(64px + env(safe-area-inset-top))' }}
      >
        <Alert
          severity="info"
          icon={<NotificationsIcon />}
          onClick={handleFgNotificationClick}
          sx={{ cursor: fgNotification.url ? 'pointer' : 'default', alignItems: 'flex-start' }}
        >
          <Typography variant="subtitle2">{fgNotification.title}</Typography>
          <Typography variant="body2">{fgNotification.body}</Typography>
          {fgNotification.url && <Typography variant="caption" color="primary">{t('common.tapToView')}</Typography>}
        </Alert>
      </Snackbar>

      {/* Global search — Cmd+K / Ctrl+K */}
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Natural Language Query — Ctrl+J */}
      <NLQueryBar open={nlQueryOpen} onClose={() => setNlQueryOpen(false)} />

      {/* AI assistant — reads records and prepares creates for confirmation */}
      {assistantOn && <AssistantDrawer open={assistantOpen} onClose={() => setAssistantOpen(false)} />}

      {/* Real-time presence — shows other users viewing the same page */}
      <PresenceBar />
    </Box>
  );
}
