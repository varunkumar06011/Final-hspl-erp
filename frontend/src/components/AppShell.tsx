import { Box, AppBar, Toolbar, Typography, IconButton, Avatar, Chip, Menu, MenuItem, Drawer, List, ListItem, ListItemIcon, ListItemText } from '@mui/material';
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Dashboard as DashboardIcon,
  Business as VendorIcon,
  Receipt as ReceiptIcon,
  AccountBalance as PaymentIcon,
  LocalShipping as GatePassIcon,
  Inventory as InventoryIcon,
  Engineering as LabourIcon,
  Construction as PhaseIcon,
  CameraAlt as PhotoIcon,
  BugReport as IssueIcon,
  Verified as InspectionIcon,
  Description as DocumentIcon,
  Handshake as ContractIcon,
  History as AuditIcon,
  Logout as LogoutIcon,
  Notifications as NotificationsIcon,
  Menu as MenuIcon,
  ChevronLeft as ChevronLeftIcon,
} from '@mui/icons-material';
import { useAuthStore } from '../stores/authStore';
import { UserRole } from '@hospital-erp/shared';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: <DashboardIcon />, path: '/' },
  { label: 'Vendors', icon: <VendorIcon />, path: '/vendors' },
  { label: 'Quotations', icon: <ReceiptIcon />, path: '/quotations' },
  { label: 'Purchase Orders', icon: <ReceiptIcon />, path: '/pos' },
  { label: 'Invoices', icon: <ReceiptIcon />, path: '/invoices' },
  { label: 'Payments', icon: <PaymentIcon />, path: '/payments' },
  { label: 'Gate Passes', icon: <GatePassIcon />, path: '/gate-passes' },
  { label: 'Inventory', icon: <InventoryIcon />, path: '/inventory' },
  { label: 'Labour', icon: <LabourIcon />, path: '/labour' },
  { label: 'Phases', icon: <PhaseIcon />, path: '/phases' },
  { label: 'Activities', icon: <PhaseIcon />, path: '/activities' },
  { label: 'Site Photos', icon: <PhotoIcon />, path: '/photos' },
  { label: 'Issues', icon: <IssueIcon />, path: '/issues' },
  { label: 'Inspections', icon: <InspectionIcon />, path: '/inspections' },
  { label: 'Documents', icon: <DocumentIcon />, path: '/documents' },
  { label: 'Contracts', icon: <ContractIcon />, path: '/contracts' },
  { label: 'Audit Log', icon: <AuditIcon />, path: '/audit' },
];

const ROLE_COLORS: Record<UserRole, string> = {
  [UserRole.PROJECT_HEAD]: '#1565C0',
  [UserRole.HEAD_OF_CONSTRUCTION]: '#2E7D32',
  [UserRole.ADMIN]: '#ED6C02',
  [UserRole.ADMIN_2]: '#9C27B0',
};

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.PROJECT_HEAD]: 'Project Head',
  [UserRole.HEAD_OF_CONSTRUCTION]: 'Head of Construction',
  [UserRole.ADMIN]: 'Admin',
  [UserRole.ADMIN_2]: 'Admin 2',
};

const DRAWER_WIDTH = 260;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(() => {
    try {
      return localStorage.getItem('erp:sidebarOpen') !== 'false';
    } catch {
      return true;
    }
  });
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();

  const toggleDrawer = () => {
    // On mobile, toggle the temporary drawer
    if (window.innerWidth < 900) {
      setMobileDrawerOpen((prev) => !prev);
      return;
    }
    const next = !drawerOpen;
    setDrawerOpen(next);
    try {
      localStorage.setItem('erp:sidebarOpen', String(next));
    } catch {
      // ignore
    }
  };

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

  const drawerContent = (
    <Box sx={{ width: DRAWER_WIDTH, flexShrink: 0 }} role="navigation">
      <Toolbar />
      <Box sx={{ overflow: 'auto' }}>
        <List>
          {NAV_ITEMS.map((item) => (
            <ListItem
              key={item.path}
              button
              onClick={() => {
                navigate(item.path);
                setMobileDrawerOpen(false);
              }}
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
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minWidth: 0 }}>
      <AppBar
        position="fixed"
        sx={{
          zIndex: (theme) => theme.zIndex.drawer + 1,
          ml: { md: drawerOpen ? `${DRAWER_WIDTH}px` : 0 },
          width: { md: drawerOpen ? `calc(100% - ${DRAWER_WIDTH}px)` : '100%', xs: '100%' },
          transition: (theme) => theme.transitions.create(['width', 'margin'], {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
          }),
        }}
      >
        <Toolbar>
          <IconButton color="inherit" onClick={toggleDrawer} edge="start" sx={{ mr: 2 }}>
            {drawerOpen && window.innerWidth >= 900 ? <ChevronLeftIcon /> : <MenuIcon />}
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontSize: { xs: '1rem', sm: '1.25rem' }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                  display: { xs: 'none', sm: 'inline-flex' },
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

      {/* Mobile drawer (temporary overlay) */}
      <Drawer
        variant="temporary"
        open={mobileDrawerOpen}
        onClose={() => setMobileDrawerOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        {drawerContent}
      </Drawer>

      {/* Desktop drawer (permanent) */}
      {drawerOpen && (
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', md: 'block' },
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
            },
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 1.5, sm: 2, md: 3 },
          mt: 8,
          width: { md: drawerOpen ? `calc(100% - ${DRAWER_WIDTH}px)` : '100%', xs: '100%' },
          minWidth: 0,
          transition: (theme) => theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
          }),
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
