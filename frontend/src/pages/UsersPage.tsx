import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRole, isAdminRole, getRoleLabel } from '@hospital-erp/shared';
import api, { extractErrorMessage } from '../config/api';
import { formatDate } from '../utils/enumOptions';
import ResponsiveTable from '../components/ResponsiveTable';

interface UserRow {
  id: string;
  phone: string;
  name: string;
  role: string; // Can be UserRole or dynamic admin role (ADMIN_3, ADMIN_4, ...)
  projectId: string | null;
  isActive: boolean;
  createdAt: string;
}

// Fixed role labels for the standard enum roles
const FIXED_ROLE_LABELS: Record<string, string> = {
  [UserRole.SUPERVISOR]: 'Supervisor',
  [UserRole.ACCOUNTANT]: 'Accountant',
  [UserRole.SITE_SUPERVISOR]: 'Site Supervisor',
  [UserRole.PROJECT_HEAD]: 'Project Head',
  [UserRole.HEAD_OF_CONSTRUCTION]: 'Head of Construction',
  [UserRole.ACCOUNTS_HEAD]: 'Accounts Head',
  [UserRole.ADMIN]: 'Admin 1',
  [UserRole.ADMIN_2]: 'Admin 2',
};

// All selectable roles in the dropdown (fixed enum values)
const SELECTABLE_ROLES = Object.values(UserRole);

export default function UsersPage() {
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [editingPhone, setEditingPhone] = useState<Record<string, string>>({});
  const [createAdminOpen, setCreateAdminOpen] = useState(false);
  const [nextAdminRole, setNextAdminRole] = useState<string | null>(null);
  const [nextAdminLabel, setNextAdminLabel] = useState<string>('');
  const [loadingNextAdmin, setLoadingNextAdmin] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['/auth/users'],
    queryFn: async () => {
      const response = await api.get('/auth/users', { params: { pageSize: 100 } });
      return response.data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: { name?: string; phone?: string; role?: string; isActive?: boolean } }) => {
      const response = await api.patch(`/auth/users/${id}`, updates);
      return response.data;
    },
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['/auth/users'] });
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const savePhoneMutation = useMutation({
    mutationFn: async ({ id, phone }: { id: string; phone: string }) => {
      const response = await api.patch(`/auth/users/${id}`, { phone });
      return response.data;
    },
    onSuccess: () => {
      setError('');
      setSuccessMsg('Phone number updated.');
      setTimeout(() => setSuccessMsg(''), 3000);
      setEditingPhone({});
      queryClient.invalidateQueries({ queryKey: ['/auth/users'] });
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  // Fetch the next available dynamic admin role from the backend
  const fetchNextAdminRole = async () => {
    setLoadingNextAdmin(true);
    try {
      const response = await api.get('/auth/next-admin-role');
      setNextAdminRole(response.data.role);
      setNextAdminLabel(response.data.label);
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setLoadingNextAdmin(false);
    }
  };

  const handleOpenCreateAdmin = () => {
    setCreateAdminOpen(true);
    fetchNextAdminRole();
  };

  // Assign the next available admin role to a selected user
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const assignAdminMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const response = await api.patch(`/auth/users/${userId}`, { role });
      return response.data;
    },
    onSuccess: () => {
      setError('');
      setSuccessMsg(`User promoted to ${nextAdminLabel} successfully.`);
      setTimeout(() => setSuccessMsg(''), 4000);
      setCreateAdminOpen(false);
      setSelectedUserId('');
      setNextAdminRole(null);
      queryClient.invalidateQueries({ queryKey: ['/auth/users'] });
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const users: UserRow[] = data?.data ?? [];
  const nonAdminUsers = users.filter((u) => !isAdminRole(u.role));

  // Get label for any role (fixed or dynamic)
  const getRoleDisplayLabel = (role: string): string => {
    return FIXED_ROLE_LABELS[role] || getRoleLabel(role);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>Users</Typography>
        <Button variant="contained" color="primary" size="small" onClick={handleOpenCreateAdmin}>
          Create New Admin
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        New signups start as Supervisors. Use "Create New Admin" to assign the next available admin role (Admin 3, Admin 4, ...). Dynamic admins have the same permissions as Admin 1 and Admin 2.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}
      <Card>
        <ResponsiveTable>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Phone</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Active</TableCell>
                <TableCell>Joined</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><CircularProgress size={30} /></TableCell></TableRow>
              ) : users.length === 0 ? (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}>No users found</TableCell></TableRow>
              ) : users.map((user) => {
                const isEditing = editingPhone[user.id] !== undefined;
                const isDynamicAdmin = isAdminRole(user.role) && !(user.role in FIXED_ROLE_LABELS);
                return (
                <TableRow key={user.id} hover>
                  <TableCell data-label="Name">{user.name}</TableCell>
                  <TableCell data-label="Phone">
                    {isEditing ? (
                      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                        <TextField
                          size="small"
                          value={editingPhone[user.id]}
                          onChange={(e) => setEditingPhone({ ...editingPhone, [user.id]: e.target.value })}
                          sx={{ width: { xs: '100%', sm: 160 }, minWidth: { xs: 120, sm: 160 } }}
                          disabled={savePhoneMutation.isPending}
                        />
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => savePhoneMutation.mutate({ id: user.id, phone: editingPhone[user.id] })}
                          disabled={savePhoneMutation.isPending || editingPhone[user.id].length < 10}
                        >
                          {savePhoneMutation.isPending ? <CircularProgress size={16} /> : 'Save'}
                        </Button>
                        <Button size="small" onClick={() => { const c = { ...editingPhone }; delete c[user.id]; setEditingPhone(c); }}>Cancel</Button>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                        <Typography variant="body2">{user.phone}</Typography>
                        <Button size="small" onClick={() => setEditingPhone({ ...editingPhone, [user.id]: user.phone })}>Edit</Button>
                      </Box>
                    )}
                  </TableCell>
                  <TableCell data-label="Role">
                    {isDynamicAdmin ? (
                      // Dynamic admin roles show as a chip, not in the dropdown
                      <Chip size="small" label={getRoleDisplayLabel(user.role)} color="primary" variant="outlined" />
                    ) : (
                      <TextField
                        select
                        size="small"
                        value={user.role}
                        onChange={(e) => updateMutation.mutate({ id: user.id, updates: { role: e.target.value } })}
                        disabled={updateMutation.isPending}
                        sx={{ minWidth: 210 }}
                      >
                        {SELECTABLE_ROLES.map((role) => (
                          <MenuItem key={role} value={role}>{FIXED_ROLE_LABELS[role]}</MenuItem>
                        ))}
                      </TextField>
                    )}
                  </TableCell>
                  <TableCell data-label="Active">
                    <FormControlLabel
                      control={
                        <Switch
                          checked={user.isActive}
                          onChange={(e) => updateMutation.mutate({ id: user.id, updates: { isActive: e.target.checked } })}
                          disabled={updateMutation.isPending}
                        />
                      }
                      label={<Chip size="small" label={user.isActive ? 'Active' : 'Inactive'} color={user.isActive ? 'success' : 'default'} />}
                    />
                  </TableCell>
                  <TableCell data-label="Joined">{formatDate(user.createdAt)}</TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        </ResponsiveTable>
      </Card>

      {/* Create New Admin Dialog */}
      <Dialog open={createAdminOpen} onClose={() => setCreateAdminOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create New Admin</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1 }}>
            {loadingNextAdmin ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
                <CircularProgress size={20} />
                <Typography variant="body2">Computing next available admin role...</Typography>
              </Box>
            ) : nextAdminRole ? (
              <>
                <Alert severity="info" sx={{ mb: 2 }}>
                  The next available admin role is <strong>{nextAdminLabel}</strong> ({nextAdminRole}).
                  This role will have the same permissions as Admin 1 and Admin 2.
                </Alert>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Select a user to promote to {nextAdminLabel}:</Typography>
                <TextField
                  select
                  fullWidth
                  size="small"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  label="Select user"
                >
                  {nonAdminUsers.length === 0 ? (
                    <MenuItem disabled value="">No non-admin users available</MenuItem>
                  ) : (
                    nonAdminUsers.map((user) => (
                      <MenuItem key={user.id} value={user.id}>
                        {user.name} ({user.phone}) — {getRoleDisplayLabel(user.role)}
                      </MenuItem>
                    ))
                  )}
                </TextField>
              </>
            ) : (
              <Typography variant="body2" color="error">Failed to compute next admin role. Please try again.</Typography>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateAdminOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!selectedUserId || !nextAdminRole || assignAdminMutation.isPending}
            onClick={() => {
              if (selectedUserId && nextAdminRole) {
                assignAdminMutation.mutate({ userId: selectedUserId, role: nextAdminRole });
              }
            }}
          >
            {assignAdminMutation.isPending ? <CircularProgress size={18} /> : `Assign ${nextAdminLabel || 'Admin'}`}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
