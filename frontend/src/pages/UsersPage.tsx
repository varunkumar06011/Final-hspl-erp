import { useState } from 'react';
import {
  Alert,
  Box,
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
  [UserRole.PROJECT_HEAD]: 'Project Head',
  [UserRole.HEAD_OF_CONSTRUCTION]: 'Head of Construction',
  [UserRole.ADMIN]: 'Admin 1',
  [UserRole.ADMIN_2]: 'Admin 2',
};

export default function UsersPage() {
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['/auth/users'],
    queryFn: async () => {
      const response = await api.get('/auth/users', { params: { pageSize: 100 } });
      return response.data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: { role?: UserRole; isActive?: boolean } }) => {
      const response = await api.patch(`/auth/users/${id}`, updates);
      return response.data;
    },
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['/auth/users'] });
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const users: UserRow[] = data?.data ?? [];

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>Users</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        New signups start as Supervisors. Assign each privileged role to only one active user.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      <Card>
        <TableContainer>
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
              ) : users.map((user) => (
                <TableRow key={user.id} hover>
                  <TableCell>{user.name}</TableCell>
                  <TableCell>{user.phone}</TableCell>
                  <TableCell>
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
                  <TableCell>
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
                  <TableCell>{formatDate(user.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  );
}
