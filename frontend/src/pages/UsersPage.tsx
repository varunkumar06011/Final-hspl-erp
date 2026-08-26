import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
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
import { UserRole } from '@hospital-erp/shared';
import api, { extractErrorMessage } from '../config/api';
import { formatDate } from '../utils/enumOptions';
import ResponsiveTable from '../components/ResponsiveTable';

interface UserRow {
  id: string;
  phone: string;
  name: string;
  role: UserRole;
  projectId: string | null;
  isActive: boolean;
  createdAt: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.SUPERVISOR]: 'Supervisor',
  [UserRole.ACCOUNTANT]: 'Accountant',
  [UserRole.SITE_SUPERVISOR]: 'Site Supervisor',
  [UserRole.PROJECT_HEAD]: 'Project Head',
  [UserRole.HEAD_OF_CONSTRUCTION]: 'Head of Construction',
  [UserRole.ADMIN]: 'Admin 1',
  [UserRole.ADMIN_2]: 'Admin 2',
};

export default function UsersPage() {
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [editingPhone, setEditingPhone] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['/auth/users'],
    queryFn: async () => {
      const response = await api.get('/auth/users', { params: { pageSize: 100 } });
      return response.data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: { name?: string; phone?: string; role?: UserRole; isActive?: boolean } }) => {
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

  const users: UserRow[] = data?.data ?? [];

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2, fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>Users</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        New signups start as Supervisors. Head approval roles are limited to one active user; Accountant and Site Supervisor roles can be assigned as needed.
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
                return (
                <TableRow key={user.id} hover>
                  <TableCell data-label="Name">{user.name}</TableCell>
                  <TableCell data-label="Phone">
                    {isEditing ? (
                      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                        <TextField
                          size="small"
                          value={editingPhone[user.id]}
                          onChange={(e) => setEditingPhone({ ...editingPhone, [user.id]: e.target.value })}
                          sx={{ width: 160 }}
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
                    <TextField
                      select
                      size="small"
                      value={user.role}
                      onChange={(e) => updateMutation.mutate({ id: user.id, updates: { role: e.target.value as UserRole } })}
                      disabled={updateMutation.isPending}
                      sx={{ minWidth: 210 }}
                    >
                      {Object.values(UserRole).map((role) => (
                        <MenuItem key={role} value={role}>{ROLE_LABELS[role]}</MenuItem>
                      ))}
                    </TextField>
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
    </Box>
  );
}
