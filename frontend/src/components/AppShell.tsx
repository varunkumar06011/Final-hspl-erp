import { Box, AppBar, Toolbar, Typography, IconButton, Avatar, Chip, Menu, MenuItem, Drawer, List, ListItem, ListItemIcon, ListItemText, useTheme, useMediaQuery } from '@mui/material';
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  Business as VendorIcon,
  Receipt as ReceiptIcon,
  AccountBalance as PaymentIcon,
  LocalShipping as GatePassIcon,
  Inventory as InventoryIcon,
  Engineering as LabourIcon,
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
} from '@mui/icons-material';
import { useAuthStore } from '../stores/authStore';
import { hasPermission, Permission, UserRole } from '@hospital-erp/shared';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: <DashboardIcon />, path: '/' },
  { label: 'Vendors', icon: <VendorIcon />, path: '/vendors' },
  { label: 'Quotations', icon: <ReceiptIcon />, path: '/quotations' },
  { label: 'Purchase Orders', icon: <ReceiptIcon />, path: '/pos' },
  { label: 'Invoices', icon: <ReceiptIcon />, path: '/invoices' },
  { label: 'Payments', icon: <PaymentIcon />, path: '/payments' },
  { label: 'Gate Passes', icon: <GatePassIcon />, path: '/gate-passes' },
  { label: 'Inventory', icon: <InventoryIcon />, path: '/inventory' },
  { label: 'Attendance', icon: <LabourIcon />, path: '/labour' },
  { label: 'Site Photos', icon: <PhotoIcon />, path: '/photos' },
  { label: 'Issues', icon: <IssueIcon />, path: '/issues' },
  { label: 'Inspections', icon: <InspectionIcon />, path: '/inspections' },
  { label: 'Documents', icon: <DocumentIcon />, path: '/documents' },
  { label: 'Contracts', icon: <ContractIcon />, path: '/contracts' },
  { label: 'Audit Log', icon: <AuditIcon />, path: '/audit' },
  { label: 'Users', icon: <PeopleIcon />, path: '/users', permission: Permission.MANAGE_USERS },
  { label: 'Settings', icon: <SettingsIcon />, path: '/settings' },
];

const ROLE_COLORS: Record<UserRole, string> = {
  [UserRole.SUPERVISOR]: '#546E7A',
  [UserRole.PROJECT_HEAD]: '#1565C0',
  [UserRole.HEAD_OF_CONSTRUCTION]: '#2E7D32',
  [UserRole.ADMIN]: '#ED6C02',
  [UserRole.ADMIN_2]: '#9C27B0',
};

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.SUPERVISOR]: 'Supervisor',
  [UserRole.PROJECT_HEAD]: 'Project Head',
  [UserRole.HEAD_OF_CONSTRUCTION]: 'Head of Construction',
  [UserRole.ADMIN]: 'Admin 1',
  [UserRole.ADMIN_2]: 'Admin 2',
};

const DRAWER_WIDTH = 260;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

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
          {NAV_ITEMS.filter((item) => !item.permission || (user && hasPermission(user.role as UserRole, item.permission))).map((item) => (
            <ListItem
              key={item.path}
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
          ))}
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

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 1.5, sm: 2, md: 3 }, mt: 8, width: { xs: '100%', md: 'auto' } }}>
        {children}
      </Box>
    </Box>
  );
}
