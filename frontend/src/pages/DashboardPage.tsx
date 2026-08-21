import { Box, Card, CardContent, Typography, Skeleton, Alert, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import api from '../config/api';
import { formatCurrency, formatDate } from '../utils/enumOptions';

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
      <Typography variant="h5" gutterBottom fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
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
        <Card><CardContent><Typography color="text.secondary" variant="body2" gutterBottom>Pending Quotations</Typography>{isLoading ? <Skeleton variant="text" width={60} height={30} /> : <Typography variant="h4" color="warning.main">{summary?.pendingQuotations ?? 0}</Typography>}</CardContent></Card>
        <Card><CardContent><Typography color="text.secondary" variant="body2" gutterBottom>Pending Quotation Value</Typography>{isLoading ? <Skeleton variant="text" width={120} height={30} /> : <Typography variant="h6" color="warning.main">{formatCurrency(summary?.pendingQuotationValue ?? 0)}</Typography>}</CardContent></Card>
        <Card><CardContent><Typography color="text.secondary" variant="body2" gutterBottom>Pending POs</Typography>{isLoading ? <Skeleton variant="text" width={60} height={30} /> : <Typography variant="h4" color="warning.main">{summary?.pendingPOs ?? 0}</Typography>}</CardContent></Card>
        <Card><CardContent><Typography color="text.secondary" variant="body2" gutterBottom>Pending Invoices</Typography>{isLoading ? <Skeleton variant="text" width={60} height={30} /> : <Typography variant="h4" color="warning.main">{summary?.pendingInvoices ?? 0}</Typography>}</CardContent></Card>
        <Card><CardContent><Typography color="text.secondary" variant="body2" gutterBottom>Pending Payments</Typography>{isLoading ? <Skeleton variant="text" width={60} height={30} /> : <Typography variant="h4" color="warning.main">{summary?.pendingPaymentRequests ?? 0}</Typography>}</CardContent></Card>
        <Card><CardContent><Typography color="text.secondary" variant="body2" gutterBottom>Total Expenses (Paid)</Typography>{isLoading ? <Skeleton variant="text" width={120} height={30} /> : <Typography variant="h6" color="info.main">{formatCurrency(summary?.totalExpenseAmount ?? 0)}</Typography>}</CardContent></Card>
      </Box>

      {/* Recent Quotations */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Recent Quotations</Typography>
          {isLoading ? (
            [1, 2, 3].map((i) => <Skeleton key={i} variant="text" height={30} />)
          ) : summary?.recentQuotations?.length > 0 ? (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Quotation No</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Grand Total</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Created By</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.recentQuotations.map((q: any) => (
                    <TableRow key={q.id} hover>
                      <TableCell>{q.quotationNumber}</TableCell>
                      <TableCell>{q.vendorCode} - {q.vendorName}</TableCell>
                      <TableCell>{formatCurrency(q.grandTotal)}</TableCell>
                      <TableCell>{q.createdBy}</TableCell>
                      <TableCell><Chip label={q.status.replace(/_/g, ' ')} size="small" /></TableCell>
                      <TableCell>{formatDate(q.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Typography color="text.secondary">No quotations yet.</Typography>
          )}
        </CardContent>
      </Card>

      {/* Recent POs */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Recent Purchase Orders</Typography>
          {isLoading ? (
            [1, 2, 3].map((i) => <Skeleton key={i} variant="text" height={30} />)
          ) : summary?.recentPOs?.length > 0 ? (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>PO No</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Grand Total</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Created By</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.recentPOs.map((p: any) => (
                    <TableRow key={p.id} hover>
                      <TableCell>{p.poNumber}</TableCell>
                      <TableCell>{p.vendorCode} - {p.vendorName}</TableCell>
                      <TableCell>{formatCurrency(p.grandTotal)}</TableCell>
                      <TableCell>{p.createdBy}</TableCell>
                      <TableCell><Chip label={p.status.replace(/_/g, ' ')} size="small" /></TableCell>
                      <TableCell>{formatDate(p.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Typography color="text.secondary">No purchase orders yet.</Typography>
          )}
        </CardContent>
      </Card>

      {/* Recent Invoices */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Recent Invoices</Typography>
          {isLoading ? (
            [1, 2, 3].map((i) => <Skeleton key={i} variant="text" height={30} />)
          ) : summary?.recentInvoices?.length > 0 ? (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Invoice Code</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Verification</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Payment</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Stock</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Created By</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.recentInvoices.map((i: any) => (
                    <TableRow key={i.id} hover>
                      <TableCell>{i.invoiceCode}</TableCell>
                      <TableCell>{i.vendorCode} - {i.vendorName}</TableCell>
                      <TableCell>{formatCurrency(i.totalAmount)}</TableCell>
                      <TableCell><Chip label={i.verificationStatus.replace(/_/g, ' ')} size="small" /></TableCell>
                      <TableCell><Chip label={i.paymentStatus} size="small" color={i.paymentStatus === 'PAID' ? 'success' : 'default'} /></TableCell>
                      <TableCell><Chip label={i.stockStatus} size="small" color={i.stockStatus === 'RECEIVED' ? 'success' : 'warning'} /></TableCell>
                      <TableCell>{i.createdBy}</TableCell>
                      <TableCell>{formatDate(i.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Typography color="text.secondary">No invoices yet.</Typography>
          )}
        </CardContent>
      </Card>

      {/* Recent Payments */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Recent Payments & Expenses</Typography>
          {isLoading ? (
            [1, 2, 3].map((i) => <Skeleton key={i} variant="text" height={30} />)
          ) : summary?.recentPayments?.length > 0 ? (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Code</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Description / Invoice</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Paid</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Created By</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.recentPayments.map((p: any) => (
                    <TableRow key={p.id} hover>
                      <TableCell>{p.paymentCode}</TableCell>
                      <TableCell><Chip label={p.type} size="small" variant="outlined" /></TableCell>
                      <TableCell>{p.type === 'EXPENSE' ? `${p.description ?? '—'} (${p.category ?? '—'})` : p.invoiceCode ?? '—'}</TableCell>
                      <TableCell>{formatCurrency(p.amount)}</TableCell>
                      <TableCell><Chip label={p.status} size="small" /></TableCell>
                      <TableCell>{p.isPaid ? <Chip label="Paid" size="small" color="success" /> : '—'}</TableCell>
                      <TableCell>{p.createdBy}</TableCell>
                      <TableCell>{formatDate(p.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Typography color="text.secondary">No payments yet.</Typography>
          )}
        </CardContent>
      </Card>

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
