import { useMemo, useRef, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary,
  Box, Chip, CircularProgress, MenuItem, Stack, TablePagination,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography, Paper,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon, Search as SearchIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import InputAdornment from '@mui/material/InputAdornment';
import api from '../config/api';
import ResponsiveTable from '../components/ResponsiveTable';
import VendorHistoryDialog from '../components/VendorHistoryDialog';
import { formatCurrency, formatIndianNumber, formatDate, enumLabel } from '../utils/enumOptions';
import { dateLocale } from '../i18n';

import { useTranslation } from 'react-i18next';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const TYPE_OPTIONS = [
  { value: 'quotation', label: 'Quotations' },
  { value: 'po', label: 'Purchase Orders' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'request', label: 'Payment Requests' },
  { value: 'payment', label: 'Payments' },
  { value: 'sheet', label: 'Payment Sheets' },
  { value: 'settlement', label: 'Bill Settlements' },
  { value: 'receipt', label: 'Goods Receipts' },
  { value: 'vendor', label: 'Vendor Onboarding' },
];

const STATUS_CHIP_COLOR: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
  Paid: 'success', 'Partially Paid': 'warning', 'Not Paid': 'error', Active: 'info',
};

interface RegisterVendor {
  vendorId: string;
  name: string;
  vendorCode: string | null;
  vendorStatus: string | null;
  txnCount: number;
  quotationAmount: number;
  poAmount: number;
  invoiceAmount: number;
  paidAmount: number;
  payableAmount: number;
  outstandingAmount: number;
  budgetHeads: string[];
  status: string;
  lastActivityDate: string;
  counts: Record<string, number>;
}

interface RegisterMonth {
  month: number;
  name: string;
  year: number;
  summary: {
    vendorCount: number; quotationAmount: number; poAmount: number; invoiceAmount: number;
    paidAmount: number; payableAmount: number; outstandingAmount: number; expenditureAmount: number;
    counts: { quotations: number; pos: number; invoices: number; payments: number; requests: number; sheets: number; receipts: number; settlements: number };
  };
  vendorTotal: number;
  vendorPage: number;
  vendorPageSize: number;
  vendors: RegisterVendor[];
}

interface RegisterResponse {
  year: number;
  month: number | null;
  months: RegisterMonth[];
  grandSummary: RegisterMonth['summary'] | null;
}

const currentIST = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

export default function TransactionRegisterPage() {
  const { t: tr } = useTranslation('txregister');
  const now = currentIST();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | ''>(''); // '' = all months
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [type, setType] = useState('');
  const [budgetHeadId, setBudgetHeadId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [pages, setPages] = useState<Record<number, number>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [historyVendor, setHistoryVendor] = useState<{ id: string; month?: number; year?: number } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: budgetHeads } = useQuery<{ id: string; particulars: string }[]>({
    queryKey: ['/budget-heads', 'all'],
    queryFn: async () => (await api.get('/budget-heads', { params: { pageSize: 200 } })).data?.data ?? [],
  });

  const params = {
    year,
    ...(month !== '' ? { month } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(type ? { type } : {}),
    ...(budgetHeadId ? { budgetHeadId } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    vendorPageSize: 100, // fetch up to 100 vendors/month; per-month paging slices client-side
    vendorPage: 1,
  };

  const { data, isLoading } = useQuery<RegisterResponse>({
    queryKey: ['/transaction-register', params],
    queryFn: async () => (await api.get('/transaction-register', { params })).data,
  });

  const onSearch = (v: string) => {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(v.trim()), 350);
  };

  const toggleMonth = (m: number) => setExpanded((e) => ({ ...e, [m]: !(e[m] ?? false) }));
  const isExpanded = (m: RegisterMonth) => expanded[m.month] ?? (m.month === now.getMonth() + 1 && m.year === now.getFullYear());

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, []);

  const money = (v: number) => formatCurrency(v);
  const hasFilters = !!(debouncedSearch || type || budgetHeadId || statusFilter || month !== '');

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2, md: 3 } }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>{tr('title')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {tr('intro')}
      </Typography>

      {/* ── Filters ── */}
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ flexWrap: 'wrap' }} useFlexGap>
          <TextField
            size="small" label={tr('search')} value={search}
            onChange={(e) => onSearch(e.target.value)}
            sx={{ minWidth: { xs: '100%', sm: 240 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          />
          <TextField select size="small" label={tr('year')} value={year} onChange={(e) => setYear(Number(e.target.value))} sx={{ minWidth: 100 }}>
            {years.map((y) => <MenuItem key={y} value={y}>{y}</MenuItem>)}
          </TextField>
          <TextField select size="small" label={tr('month')} value={month} onChange={(e) => setMonth(e.target.value === '' ? '' : Number(e.target.value))} sx={{ minWidth: 130 }}>
            <MenuItem value="">{tr('allMonths')}</MenuItem>
            {MONTH_NAMES.map((_n, i) => <MenuItem key={i} value={i + 1}>{new Date(2000, i, 1).toLocaleString(dateLocale(), { month: 'long' })}</MenuItem>)}
          </TextField>
          <TextField select size="small" label={tr('type')} value={type} onChange={(e) => setType(e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="">{tr('allTypes')}</MenuItem>
            {TYPE_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{tr(`type_${o.value}`)}</MenuItem>)}
          </TextField>
          <TextField select size="small" label={tr('budgetHead')} value={budgetHeadId} onChange={(e) => setBudgetHeadId(e.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="">{tr('allHeads')}</MenuItem>
            {(budgetHeads ?? []).map((b) => <MenuItem key={b.id} value={b.id}>{b.particulars}</MenuItem>)}
          </TextField>
          <TextField select size="small" label={tr('docStatus')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 140 }}>
            <MenuItem value="">{tr('anyStatus')}</MenuItem>
            {['PENDING', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'PARTIALLY_PAID', 'PARTIALLY_DELIVERED', 'DELIVERED', 'SETTLED'].map((st) => (
              <MenuItem key={st} value={st}>{enumLabel(st)}</MenuItem>
            ))}
          </TextField>
        </Stack>
      </Paper>

      {/* ── Grand summary across the selected scope ── */}
      {data?.grandSummary && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Chip color="primary" label={tr('sumVendors', { n: data.grandSummary.vendorCount })} />
          <Chip variant="outlined" label={tr('sumQuotations', { v: money(data.grandSummary.quotationAmount), c: data.grandSummary.counts.quotations })} />
          <Chip variant="outlined" label={tr('sumPos', { v: money(data.grandSummary.poAmount), c: data.grandSummary.counts.pos })} />
          <Chip variant="outlined" label={tr('sumInvoiced', { v: money(data.grandSummary.invoiceAmount), c: data.grandSummary.counts.invoices })} />
          <Chip variant="outlined" color="success" label={tr('sumPaid', { v: money(data.grandSummary.paidAmount) })} />
          <Chip variant="outlined" color="error" label={tr('sumOutstanding', { v: money(data.grandSummary.outstandingAmount) })} />
        </Stack>
      )}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : !data || data.months.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {hasFilters ? tr('noMatch') : tr('noYear', { y: year })}
          </Typography>
        </Paper>
      ) : (
        data.months.map((m) => (
          <Accordion
            key={m.month}
            expanded={isExpanded(m)}
            onChange={() => toggleMonth(m.month)}
            disableGutters
            sx={{ mb: 1.5, border: '1px solid', borderColor: 'divider', '&:before': { display: 'none' } }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: { xs: 1.5, sm: 2 } }}>
              <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%', flexWrap: 'wrap', rowGap: 0.5 }}>
                <Typography fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {m.name} {m.year}
                </Typography>
                <Chip size="small" color="primary" variant="outlined" label={tr('mVendors', { count: m.summary.vendorCount })} />
                <Box sx={{ flexGrow: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  Paid {formatIndianNumber(m.summary.paidAmount)} · Outstanding {formatIndianNumber(m.summary.outstandingAmount)}
                </Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ px: { xs: 1.5, sm: 2 }, pt: 0 }}>
              {/* Month summary strip */}
              <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 0.75 }}>
                <Chip size="small" variant="outlined" label={tr('mQuotations', { v: money(m.summary.quotationAmount), c: m.summary.counts.quotations })} />
                <Chip size="small" variant="outlined" label={tr('mPos', { v: money(m.summary.poAmount), c: m.summary.counts.pos })} />
                <Chip size="small" variant="outlined" label={tr('mInvoiced', { v: money(m.summary.invoiceAmount), c: m.summary.counts.invoices })} />
                <Chip size="small" variant="outlined" color="success" label={tr('mPaid', { v: money(m.summary.paidAmount), c: m.summary.counts.payments + m.summary.counts.sheets })} />
                <Chip size="small" variant="outlined" color="error" label={tr('mOutstanding', { v: money(m.summary.outstandingAmount) })} />
                {m.summary.payableAmount > 0 && <Chip size="small" variant="outlined" color="warning" label={tr('mSheetPayable', { v: money(m.summary.payableAmount) })} />}
              </Stack>

              {/* Vendor rows → cards on mobile */}
              <ResponsiveTable>
                <TableContainer sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'grey.50' }}>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('vendor')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('status')}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('quotations')}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('poPayable')}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('invoiced')}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('paid')}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('outstanding')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('budgetHeads')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('lastActivity')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {m.vendors.slice((pages[m.month] ?? 0) * 25, (pages[m.month] ?? 0) * 25 + 25).map((v) => (
                        <TableRow
                          key={v.vendorId}
                          hover
                          onClick={() => setHistoryVendor({ id: v.vendorId, month: m.month, year: m.year })}
                          sx={{ cursor: 'pointer' }}
                        >
                          <TableCell data-label={tr('vendor')}>
                            <Typography fontWeight={600} variant="body2">{v.name}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {v.vendorCode ?? '—'} · {v.txnCount} txn{v.txnCount === 1 ? '' : 's'}
                            </Typography>
                          </TableCell>
                          <TableCell data-label={tr('status')}>
                            <Chip size="small" label={v.status === 'Partially Paid' ? tr('vs_partiallyPaid') : v.status === 'Not Paid' ? tr('vs_notPaid') : v.status === 'Active' ? tr('vs_active') : v.status === 'Paid' ? tr('paid') : v.status} color={STATUS_CHIP_COLOR[v.status] ?? 'default'} />
                          </TableCell>
                          <TableCell data-label={tr('quotations')} align="right">{v.quotationAmount ? formatIndianNumber(v.quotationAmount) : '₹0'}</TableCell>
                          <TableCell data-label={tr('poPayable')} align="right">{v.poAmount ? formatIndianNumber(v.poAmount) : '₹0'}</TableCell>
                          <TableCell data-label={tr('invoiced')} align="right">{v.invoiceAmount ? formatIndianNumber(v.invoiceAmount) : '₹0'}</TableCell>
                          <TableCell data-label={tr('paid')} align="right" sx={{ color: v.paidAmount ? 'success.main' : 'text.disabled' }}>{v.paidAmount ? formatIndianNumber(v.paidAmount) : 'Not Paid'}</TableCell>
                          <TableCell data-label={tr('outstanding')} align="right" sx={{ color: v.outstandingAmount ? 'error.main' : 'text.disabled', fontWeight: 600 }}>{formatIndianNumber(v.outstandingAmount)}</TableCell>
                          <TableCell data-label={tr('budgetHeads')}>
                            {v.budgetHeads.length === 0 ? tr('notAssigned') : v.budgetHeads.map((h) => (
                              <Chip key={h} size="small" variant="outlined" label={h} sx={{ mr: 0.5, mb: 0.5 }} />
                            ))}
                          </TableCell>
                          <TableCell data-label={tr('lastActivity')}>{formatDate(v.lastActivityDate)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </ResponsiveTable>

              {m.vendors.length > 25 && (
                <TablePagination
                  component="div"
                  count={m.vendors.length}
                  page={pages[m.month] ?? 0}
                  onPageChange={(_, p) => setPages((s) => ({ ...s, [m.month]: p }))}
                  rowsPerPage={25}
                  rowsPerPageOptions={[25]}
                />
              )}
            </AccordionDetails>
          </Accordion>
        ))
      )}

      {/* Vendor 360° — loads lazily on click */}
      <VendorHistoryDialog
        vendorId={historyVendor?.id ?? null}
        open={!!historyVendor}
        onClose={() => setHistoryVendor(null)}
        focusMonth={historyVendor?.month}
        focusYear={historyVendor?.year}
      />
    </Box>
  );
}
