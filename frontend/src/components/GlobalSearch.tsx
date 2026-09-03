import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  TextField,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Typography,
  Box,
  CircularProgress,
  InputAdornment,
  Chip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Business as VendorIcon,
  Engineering as WorkIcon,
  BugReport as IssueIcon,
  Devices as AssetIcon,
  Receipt as POIcon,
  RequestQuote as QuotationIcon,
  Description as InvoiceIcon,
  Payments as PaymentIcon,
  AccountBalance as BankIcon,
  Payments as CashIcon,
  AccountBalanceWallet as LedgerIcon,
  Savings as BudgetIcon,
  Person as OwnerIcon,
} from '@mui/icons-material';
import api from '../config/api';

interface SearchResult {
  id: string;
  label: string;
  sublabel?: string;
  path: string;
  type: string;
}

interface SearchSource {
  type: string;
  endpoint: string;
  icon: React.ReactNode;
  path: (id: string) => string;
  label: (row: Record<string, unknown>) => string;
  sublabel?: (row: Record<string, unknown>) => string;
}

const SOURCES: SearchSource[] = [
  {
    type: 'Vendor',
    endpoint: '/vendors',
    icon: <VendorIcon fontSize="small" />,
    path: (id) => `/vendors?id=${id}`,
    label: (r) => String(r.name ?? ''),
    sublabel: (r) => String(r.vendorCode ?? ''),
  },
  {
    type: 'Purchase Order',
    endpoint: '/purchase-orders',
    icon: <POIcon fontSize="small" />,
    path: (id) => `/pos?id=${id}`,
    label: (r) => String(r.poNumber ?? ''),
    sublabel: (r) => String((r.vendor as { name?: string } | null)?.name ?? ''),
  },
  {
    type: 'Quotation',
    endpoint: '/quotations',
    icon: <QuotationIcon fontSize="small" />,
    path: (id) => `/quotations?id=${id}`,
    label: (r) => String(r.quotationNumber ?? ''),
    sublabel: (r) => String((r.vendor as { name?: string } | null)?.name ?? ''),
  },
  {
    type: 'Invoice',
    endpoint: '/invoices',
    icon: <InvoiceIcon fontSize="small" />,
    path: (id) => `/invoices?id=${id}`,
    label: (r) => String(r.invoiceCode ?? r.invoiceNumber ?? ''),
    sublabel: (r) => String((r.vendor as { name?: string } | null)?.name ?? ''),
  },
  {
    type: 'Payment Request',
    endpoint: '/payments',
    icon: <PaymentIcon fontSize="small" />,
    path: (id) => `/payments?id=${id}`,
    label: (r) => String(r.paymentCode ?? r.requestNumber ?? ''),
    sublabel: (r) => String((r.vendor as { name?: string } | null)?.name ?? r.description ?? ''),
  },
  {
    type: 'Ledger',
    endpoint: '/ledgers',
    icon: <LedgerIcon fontSize="small" />,
    path: (id) => `/ledgers?id=${id}`,
    label: (r) => String(r.name ?? ''),
    sublabel: (r) => String(r.group ?? ''),
  },
  {
    type: 'Bank Account',
    endpoint: '/bank-accounts',
    icon: <BankIcon fontSize="small" />,
    path: (id) => `/bank-accounts?id=${id}`,
    label: (r) => String(r.accountName ?? ''),
    sublabel: (r) => [r.bankName, r.accountNumber].filter(Boolean).map(String).join(' · '),
  },
  {
    type: 'Cash Account',
    endpoint: '/cash-accounts',
    icon: <CashIcon fontSize="small" />,
    path: (id) => `/cash-accounts?id=${id}`,
    label: (r) => String(r.name ?? ''),
  },
  {
    type: 'Budget Head',
    endpoint: '/budget-heads',
    icon: <BudgetIcon fontSize="small" />,
    path: (id) => `/budget-heads?id=${id}`,
    label: (r) => String(r.particulars ?? ''),
  },
  {
    type: 'Owner Account',
    endpoint: '/owner-accounts',
    icon: <OwnerIcon fontSize="small" />,
    path: (id) => `/owner-accounts?id=${id}`,
    label: (r) => String(r.ownerName ?? ''),
  },
  {
    type: 'Work Task',
    endpoint: '/work-tasks',
    icon: <WorkIcon fontSize="small" />,
    path: (id) => `/work?id=${id}`,
    label: (r) => String(r.title ?? ''),
    sublabel: (r) => String(r.status ?? ''),
  },
  {
    type: 'Issue',
    endpoint: '/issues',
    icon: <IssueIcon fontSize="small" />,
    path: (id) => `/issues?id=${id}`,
    label: (r) => String(r.title ?? ''),
    sublabel: (r) => String(r.severity ?? ''),
  },
  {
    type: 'Asset / Inventory',
    endpoint: '/inventory/items',
    icon: <AssetIcon fontSize="small" />,
    path: (id) => `/assets/${id}`,
    label: (r) => String(r.name ?? ''),
    sublabel: (r) => [r.sku, r.category].filter(Boolean).map(String).join(' · '),
  },
];

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
}

export default function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    try {
      const responses = await Promise.all(
        SOURCES.map(async (src) => {
          try {
            const res = await api.get(src.endpoint, {
              params: { search: q, page: 1, pageSize: 5 },
            });
            const rows: Record<string, unknown>[] = res.data?.data ?? [];
            return rows.map((row) => ({
              id: String(row.id),
              label: src.label(row),
              sublabel: src.sublabel?.(row),
              path: src.path(String(row.id)),
              type: src.type,
            }));
          } catch {
            return [];
          }
        }),
      );
      setResults(responses.flat());
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setLoading(false);
    }
  }, [open]);

  const handleSelect = (result: SearchResult) => {
    navigate(result.path);
    onClose();
  };

  // Group results by type
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.type] ??= []).push(r);
    return acc;
  }, {});

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { position: 'fixed', top: 80, m: 0, width: '100%', maxWidth: 560 } }}>
      <DialogContent sx={{ p: 0 }}>
        <TextField
          autoFocus
          fullWidth
          placeholder="Search vendors, POs, invoices, ledgers, payments, banks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                {loading ? <CircularProgress size={18} /> : <SearchIcon fontSize="small" />}
              </InputAdornment>
            ),
          }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 0 } }}
        />
        {query.trim().length >= 2 && (
          <Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
            {results.length === 0 && !loading ? (
              <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
                No results for "{query}"
              </Typography>
            ) : (
              <List dense>
                {Object.entries(grouped).map(([type, items]) => (
                  <Box key={type}>
                    <Typography variant="overline" color="text.secondary" sx={{ px: 2, display: 'block' }}>
                      {type}
                    </Typography>
                    {items.map((r) => (
                      <ListItemButton key={`${r.type}-${r.id}`} onClick={() => handleSelect(r)}>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          {SOURCES.find((s) => s.type === r.type)?.icon}
                        </ListItemIcon>
                        <ListItemText
                          primary={r.label}
                          secondary={r.sublabel}
                          primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                          secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                        />
                      </ListItemButton>
                    ))}
                  </Box>
                ))}
              </List>
            )}
          </Box>
        )}
        {query.trim().length < 2 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 2, textAlign: 'center' }}>
            Type at least 2 characters to search · <Chip size="small" label="Esc to close" />
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
}
