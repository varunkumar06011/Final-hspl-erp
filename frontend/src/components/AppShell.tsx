import { Box, AppBar, Toolbar, Typography, IconButton, Avatar, Chip, Menu, MenuItem, Drawer, List, ListItem, ListItemIcon, ListItemText, useTheme, useMediaQuery, Snackbar, Alert } from '@mui/material';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  Business as VendorIcon,
  Event as WorkIcon,
  Receipt as ReceiptIcon,
  AccountBalance as PaymentIcon,
  LocalShipping as GatePassIcon,
  Inventory as InventoryIcon,
  Engineering as LabourIcon,
  Devices as AssetsIcon,
  CameraAlt as PhotoIcon,
  BugReport as IssueIcon,
  Verified as InspectionIcon,
  Description as DocumentIcon,
  Handshake as ContractIcon,
  History as AuditIcon,
  Settings as SettingsIcon,
  People as PeopleIcon,
  Logout as LogoutIcon,
  Notifications as NotificationsIcon,
  AccountBalanceWallet as BudgetIcon,
  Savings as BankIcon,
  Payments as CashIcon,
  Person as OwnerIcon,
  ReceiptLong as JVIcon,
  Dashboard as FinanceDashboardIcon,
  Assessment as ReportsIcon,
} from '@mui/icons-material';
import { useAuthStore } from '../stores/authStore';
import { hasPermission, Permission, UserRole } from '@hospital-erp/shared';
import { onForegroundMessage, enableNotifications, isPushSupported, getPermissionState } from '../config/notifications';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: <DashboardIcon />, path: '/', section: '' },
  // ── Procurement ──
  { label: 'Vendors', icon: <VendorIcon />, path: '/vendors', permission: Permission.VIEW_FINANCIALS, section: 'Procurement' },
  { label: 'Work', icon: <WorkIcon />, path: '/work', permission: Permission.MANAGE_WORK_TASKS, section: 'Procurement' },
  { label: 'Work Calendar', icon: <WorkIcon />, path: '/work-calendar', permission: Permission.MANAGE_WORK_TASKS, section: 'Procurement' },
  { label: 'Quotations', icon: <ReceiptIcon />, path: '/quotations', permission: Permission.VIEW_FINANCIALS, section: 'Procurement' },
  { label: 'Purchase Orders', icon: <ReceiptIcon />, path: '/pos', permission: Permission.VIEW_FINANCIALS, section: 'Procurement' },
  { label: 'Gate Passes', icon: <GatePassIcon />, path: '/gate-passes', permission: Permission.VIEW_GATE_PASSES, section: 'Procurement' },
  { label: 'Goods Receipts', icon: <ReceiptIcon />, path: '/goods-receipts', permission: Permission.MANAGE_INVENTORY, section: 'Procurement' },
  { label: 'GST Records', icon: <ReceiptIcon />, path: '/gst-records', permission: Permission.VIEW_FINANCIALS, section: 'Procurement' },
  { label: 'Invoices', icon: <ReceiptIcon />, path: '/invoices', permission: Permission.VIEW_FINANCIALS, section: 'Procurement' },
  { label: 'Payments', icon: <PaymentIcon />, path: '/payments', permission: Permission.VIEW_FINANCIALS, section: 'Procurement' },
  // ── Finance ──
  { label: 'Finance Dashboard', icon: <FinanceDashboardIcon />, path: '/finance-dashboard', permission: Permission.VIEW_FINANCIALS, section: 'Finance' },
  { label: 'Finance Reports', icon: <ReportsIcon />, path: '/finance-reports', permission: Permission.VIEW_FINANCIALS, section: 'Finance' },
  { label: 'Budget Heads', icon: <BudgetIcon />, path: '/budget-heads', permission: Permission.VIEW_FINANCIALS, section: 'Finance' },
  { label: 'Bank Accounts', icon: <BankIcon />, path: '/bank-accounts', permission: Permission.VIEW_FINANCIALS, section: 'Finance' },
  { label: 'Cash Accounts', icon: <CashIcon />, path: '/cash-accounts', permission: Permission.VIEW_FINANCIALS, section: 'Finance' },
  { label: 'Owner Account', icon: <OwnerIcon />, path: '/owner-accounts', permission: Permission.VIEW_FINANCIALS, section: 'Finance' },
  { label: 'Journal Vouchers', icon: <JVIcon />, path: '/journal-vouchers', permission: Permission.VIEW_FINANCIALS, section: 'Finance' },
  // ── Site Operations ──
  { label: 'Inventory', icon: <InventoryIcon />, path: '/inventory', permission: Permission.MANAGE_INVENTORY, section: 'Site Operations' },
  { label: 'Assets', icon: <AssetsIcon />, path: '/assets', permission: Permission.MANAGE_INVENTORY, section: 'Site Operations' },
  { label: 'Attendance', icon: <LabourIcon />, path: '/labour', permission: Permission.MANAGE_LABOUR, section: 'Site Operations' },
  { label: 'Site Photos', icon: <PhotoIcon />, path: '/photos', permission: Permission.UPLOAD_PHOTOS, section: 'Site Operations' },
  { label: 'Issues', icon: <IssueIcon />, path: '/issues', permission: Permission.MANAGE_ISSUES, section: 'Site Operations' },
  { label: 'Inspections', icon: <InspectionIcon />, path: '/inspections', permission: Permission.MANAGE_INSPECTIONS, section: 'Site Operations' },
  { label: 'Documents', icon: <DocumentIcon />, path: '/documents', permission: Permission.MANAGE_DOCUMENTS, section: 'Site Operations' },
  { label: 'Contracts', icon: <ContractIcon />, path: '/contracts', permission: Permission.MANAGE_CONTRACTS, section: 'Site Operations' },
  // ── Admin ──
  { label: 'Audit Log', icon: <AuditIcon />, path: '/audit', permission: Permission.VIEW_AUDIT_LOG, section: 'Admin' },
  { label: 'Users', icon: <PeopleIcon />, path: '/users', permission: Permission.MANAGE_USERS, section: 'Admin' },
  { label: 'Settings', icon: <SettingsIcon />, path: '/settings', section: 'Admin' },
];

const ROLE_COLORS: Record<UserRole, string> = {
  [UserRole.SUPERVISOR]: '#546E7A',
  [UserRole.ACCOUNTANT]: '#00897B',
  [UserRole.SITE_SUPERVISOR]: '#6D4C41',
  [UserRole.PROJECT_HEAD]: '#1565C0',
  [UserRole.HEAD_OF_CONSTRUCTION]: '#2E7D32',
  [UserRole.ADMIN]: '#ED6C02',
  [UserRole.ADMIN_2]: '#9C27B0',
};

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.SUPERVISOR]: 'Supervisor',
  [UserRole.ACCOUNTANT]: 'Accountant',
  [UserRole.SITE_SUPERVISOR]: 'Site Supervisor',
  [UserRole.PROJECT_HEAD]: 'Project Head',
  [UserRole.HEAD_OF_CONSTRUCTION]: 'Head of Construction',
  [UserRole.ADMIN]: 'Admin 1',
  [UserRole.ADMIN_2]: 'Admin 2',
};

const DRAWER_WIDTH = 260;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [fgNotification, setFgNotification] = useState<{ open: boolean; title: string; body: string; url?: string }>({
    open: false,
    title: '',
    body: '',
  });
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
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
      const title = payload.notification?.title || payload.data?.title || 'New Notification';
      const body = payload.notification?.body || payload.data?.body || '';
      const url = payload.data?.url;
      setFgNotification({ open: true, title, body, url });
    });
    return unsubscribe;
  }, []);

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
          {NAV_ITEMS.filter((item) => !item.permission || (user && hasPermission(user.role as UserRole, item.permission))).map((item, idx, arr) => {
            const prevItem = idx > 0 ? arr[idx - 1] : null;
            const showSectionHeader = item.section !== '' && (!prevItem || prevItem.section !== item.section);
            return (
              <Box key={item.path}>
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
                    {item.section}
                  </Typography>
                )}
                <ListItem
                  button
                  onClick={() => handleNavigate(item.path)}
                  selected={location.pathname === item.path}
                  sx={{
                    '&.Mui-selected': {
                      bgcolor: 'primary.light',
                      borderRight: '4px solid',
                      borderColor: 'primary.main',
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                  <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14 }} />
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
        sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
      >
        <Toolbar>
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
            sx={{ flexGrow: 1, fontSize: { xs: '1rem', sm: '1.25rem' } }}
          >
            Hospital Construction ERP
          </Typography>
          <IconButton color="inherit" size="large" sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
            <NotificationsIcon />
          </IconButton>
          {user && (
            <>
              <Chip
                label={ROLE_LABELS[user.role as UserRole]}
                size="small"
                sx={{
                  mr: 1,
                  bgcolor: ROLE_COLORS[user.role as UserRole],
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
                  <LogoutIcon fontSize="small" sx={{ mr: 1 }} /> Logout
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

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 1.5, sm: 2, md: 3 }, mt: 8, width: { xs: '100%', md: 'auto' }, minWidth: 0, overflow: 'hidden' }}>
        {children}
      </Box>

      {/* Foreground push notification snackbar */}
      <Snackbar
        open={fgNotification.open}
        autoHideDuration={10000}
        onClose={() => setFgNotification({ open: false, title: '', body: '', url: undefined })}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ mt: 8 }}
      >
        <Alert
          severity="info"
          icon={<NotificationsIcon />}
          onClick={handleFgNotificationClick}
          sx={{ cursor: fgNotification.url ? 'pointer' : 'default', alignItems: 'flex-start' }}
        >
          <Typography variant="subtitle2">{fgNotification.title}</Typography>
          <Typography variant="body2">{fgNotification.body}</Typography>
          {fgNotification.url && <Typography variant="caption" color="primary">Tap to view →</Typography>}
        </Alert>
      </Snackbar>
    </Box>
  );
}
