import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Skeleton,
  Alert,
  Stack,
  Divider,
  IconButton,
  Link,
} from '@mui/material';
import {
  Description as DocIcon,
  Close as CloseIcon,
  Receipt as ReceiptIcon,
  ShoppingCart as PoIcon,
  RequestQuote as QuoteIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import api from '../config/api';
import { formatCurrency } from '../utils/enumOptions';
import ResponsiveDialog from './ResponsiveDialog';

interface DocumentSummaryResponse {
  totalQuotations: number;
  totalPurchaseOrders: number;
  totalInvoices: number;
  totalInvoiceValue: number;
}

/**
 * Document Summary Card — shows total counts of Quotations, Purchase Orders,
 * and Invoices with total invoice value. Clicking the card opens a modal with
 * the same details (no page navigation).
 *
 * Read-only add-on. Reuses the existing /dashboard/document-summary endpoint.
 */
export default function DocumentSummaryCard({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['/dashboard', 'document-summary'],
    queryFn: async () => {
      const response = await api.get<DocumentSummaryResponse>('/dashboard/document-summary');
      return response.data;
    },
  });

  return (
    <>
      {compact ? (
        // Mobile / minimal card — same style as pending PO card
        <Card
          onClick={() => setOpen(true)}
          sx={{ cursor: 'pointer', transition: 'box-shadow 0.2s, border-color 0.2s', '&:hover': { boxShadow: 3, borderColor: 'primary.main' } }}
        >
          <CardContent>
            <Typography color="text.secondary" variant="body2" gutterBottom>Document Summary</Typography>
            {isLoading ? (
              <Skeleton variant="text" width={80} height={30} />
            ) : (
              <Typography variant="h6" color="success.main">
                {data?.totalInvoices ?? 0} Invoices
              </Typography>
            )}
            {isLoading ? (
              <Skeleton variant="text" width={120} height={24} />
            ) : (
              <Typography variant="body2" color="error.main" fontWeight={600}>
                {formatCurrency(data?.totalInvoiceValue ?? 0)}
              </Typography>
            )}
          </CardContent>
        </Card>
      ) : (
        // Desktop / full card
        <Card
          onClick={() => setOpen(true)}
          sx={{
            cursor: 'pointer',
            transition: 'box-shadow 0.2s, border-color 0.2s',
            '&:hover': { boxShadow: 3, borderColor: 'primary.main' },
            height: '100%',
          }}
        >
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
              <DocIcon color="primary" fontSize="small" />
              <Typography variant="subtitle1" fontWeight={600}>
                Document Summary
              </Typography>
            </Stack>

            {isError && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                Could not load document summary.
              </Alert>
            )}

            {/* Quotations + Purchase Orders row */}
            <Stack direction="row" spacing={3} sx={{ mb: 1.5 }}>
              <Box sx={{ flex: 1 }}>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <QuoteIcon fontSize="small" color="action" />
                  <Typography variant="caption" color="text.secondary">Quotations</Typography>
                </Stack>
                {isLoading ? (
                  <Skeleton variant="text" width={60} height={32} />
                ) : (
                  <Typography variant="h5" fontWeight={700} color="primary.main">
                    {data?.totalQuotations ?? 0}
                  </Typography>
                )}
              </Box>
              <Box sx={{ flex: 1 }}>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <PoIcon fontSize="small" color="action" />
                  <Typography variant="caption" color="text.secondary">Purchase Orders</Typography>
                </Stack>
                {isLoading ? (
                  <Skeleton variant="text" width={60} height={32} />
                ) : (
                  <Typography variant="h5" fontWeight={700} color="info.main">
                    {data?.totalPurchaseOrders ?? 0}
                  </Typography>
                )}
              </Box>
            </Stack>

            <Divider sx={{ my: 1 }} />

            {/* Invoices row */}
            <Stack direction="row" spacing={3} alignItems="center">
              <Box sx={{ flex: 1 }}>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <ReceiptIcon fontSize="small" color="action" />
                  <Typography variant="caption" color="text.secondary">Invoices</Typography>
                </Stack>
                {isLoading ? (
                  <Skeleton variant="text" width={60} height={32} />
                ) : (
                  <Typography variant="h5" fontWeight={700} color="success.main">
                    {data?.totalInvoices ?? 0}
                  </Typography>
                )}
              </Box>
              <Box sx={{ flex: 1, textAlign: 'right' }}>
                <Typography variant="caption" color="text.secondary">Total Invoice Value</Typography>
                {isLoading ? (
                  <Skeleton variant="text" width={120} height={28} />
                ) : (
                  <Typography variant="h6" fontWeight={700} color="error.main" sx={{ fontSize: { xs: '0.9rem', sm: '1.1rem' } }}>
                    {formatCurrency(data?.totalInvoiceValue ?? 0)}
                  </Typography>
                )}
              </Box>
            </Stack>

            <Box sx={{ mt: 1.5, textAlign: 'right' }}>
              <Link component="button" variant="body2" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
                View Details →
              </Link>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Detail Modal — no page navigation */}
      <ResponsiveDialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <DocIcon color="primary" />
            <Typography variant="h6" fontWeight={600}>Document Summary</Typography>
          </Stack>
          <IconButton onClick={() => setOpen(false)} size="small" aria-label="close">
            <CloseIcon />
          </IconButton>
        </Box>
        <Box sx={{ p: 3 }}>
          {/* Quotations */}
          <Box sx={{ mb: 3 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
              <QuoteIcon color="primary" fontSize="small" />
              <Typography variant="subtitle1" fontWeight={600}>Quotations</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">Total</Typography>
            <Typography variant="h4" fontWeight={700} color="primary.main">
              {isLoading ? <Skeleton variant="text" width={80} /> : data?.totalQuotations ?? 0}
            </Typography>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Purchase Orders */}
          <Box sx={{ mb: 3 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
              <PoIcon color="info" fontSize="small" />
              <Typography variant="subtitle1" fontWeight={600}>Purchase Orders</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">Total</Typography>
            <Typography variant="h4" fontWeight={700} color="info.main">
              {isLoading ? <Skeleton variant="text" width={80} /> : data?.totalPurchaseOrders ?? 0}
            </Typography>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Invoices */}
          <Box>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
              <ReceiptIcon color="success" fontSize="small" />
              <Typography variant="subtitle1" fontWeight={600}>Invoices</Typography>
            </Stack>
            <Stack direction="row" spacing={4} flexWrap="wrap" sx={{ mt: 1 }}>
              <Box>
                <Typography variant="body2" color="text.secondary">Total Invoices</Typography>
                <Typography variant="h4" fontWeight={700} color="success.main">
                  {isLoading ? <Skeleton variant="text" width={80} /> : data?.totalInvoices ?? 0}
                </Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">Total Value</Typography>
                <Typography variant="h5" fontWeight={700} color="error.main">
                  {isLoading ? <Skeleton variant="text" width={150} /> : formatCurrency(data?.totalInvoiceValue ?? 0)}
                </Typography>
              </Box>
            </Stack>
          </Box>
        </Box>
      </ResponsiveDialog>
    </>
  );
}
