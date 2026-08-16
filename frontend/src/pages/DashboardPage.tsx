import { Box, Card, CardContent, Typography, Skeleton, Alert, Chip } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import api from '../config/api';
import { formatCurrency } from '../utils/enumOptions';

export default function DashboardPage() {
  const { data: summary, isLoading, isError } = useQuery({
    queryKey: ['/dashboard/summary'],
    queryFn: async () => {
      const response = await api.get('/dashboard/summary');
      return response.data;
    },
  });

  const { data: auditData } = useQuery({
    queryKey: ['/audit', 'recent'],
    queryFn: async () => {
      const response = await api.get('/audit', { params: { pageSize: 5 } });
      return response.data;
    },
  });

  return (
    <Box>
      <Typography variant="h5" gutterBottom fontWeight={600}>
        Dashboard
      </Typography>

      {summary?.project && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Project: <strong>{summary.project.name}</strong>
            <Chip label={summary.project.status} size="small" sx={{ ml: 1 }} />
          </Typography>
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2, mb: 3 }}>
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2" gutterBottom>Total Budget</Typography>
            {isLoading ? <Skeleton variant="text" width={120} height={40} /> : <Typography variant="h5">{formatCurrency(summary?.totalBudget ?? 0)}</Typography>}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2" gutterBottom>Committed (POs)</Typography>
            {isLoading ? <Skeleton variant="text" width={120} height={40} /> : <Typography variant="h5">{formatCurrency(summary?.committed ?? 0)}</Typography>}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2" gutterBottom>Paid</Typography>
            {isLoading ? <Skeleton variant="text" width={120} height={40} /> : <Typography variant="h5">{formatCurrency(summary?.paid ?? 0)}</Typography>}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary" variant="body2" gutterBottom>Remaining</Typography>
            {isLoading ? <Skeleton variant="text" width={120} height={40} /> : <Typography variant="h5">{formatCurrency(summary?.remaining ?? 0)}</Typography>}
          </CardContent>
        </Card>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 2, mb: 3 }}>
        <Card><CardContent><Typography color="text.secondary" variant="body2" gutterBottom>Pending Payments</Typography>{isLoading ? <Skeleton variant="text" width={60} height={30} /> : <Typography variant="h4" color="warning.main">{summary?.pendingPayments ?? 0}</Typography>}</CardContent></Card>
        <Card><CardContent><Typography color="text.secondary" variant="body2" gutterBottom>Open Issues</Typography>{isLoading ? <Skeleton variant="text" width={60} height={30} /> : <Typography variant="h4" color="error.main">{summary?.openIssues ?? 0}</Typography>}</CardContent></Card>
        <Card><CardContent><Typography color="text.secondary" variant="body2" gutterBottom>Low Stock Items</Typography>{isLoading ? <Skeleton variant="text" width={60} height={30} /> : <Typography variant="h4" color="error.main">{summary?.lowStockItems ?? 0}</Typography>}</CardContent></Card>
        <Card><CardContent><Typography color="text.secondary" variant="body2" gutterBottom>Active Phases</Typography>{isLoading ? <Skeleton variant="text" width={60} height={30} /> : <Typography variant="h4" color="info.main">{summary?.activePhases ?? 0}</Typography>}</CardContent></Card>
      </Box>

      {isError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Dashboard data will appear once the backend API is connected and seeded.
        </Alert>
      )}

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Recent Activity
          </Typography>
          {isLoading ? (
            [1, 2, 3].map((i) => <Skeleton key={i} variant="text" height={30} />)
          ) : auditData?.data?.length > 0 ? (
            auditData.data.map((log: any) => (
              <Box key={log.id} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="body2">
                  <strong>{log.user?.name}</strong> — {log.action} on {log.entityType}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(log.createdAt).toLocaleString()}
                </Typography>
              </Box>
            ))
          ) : (
            <Typography color="text.secondary">No activity yet. Data will appear here as you use the system.</Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
