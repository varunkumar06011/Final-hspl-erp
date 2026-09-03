import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRecentlyViewed, addRecentlyViewed, type RecentItem } from '../hooks/useRecentlyViewed';
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
  Divider,
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
  Dashboard as DashboardIcon,
  ArrowForward as ArrowIcon,
} from '@mui/icons-material';
import api from '../config/api';

interface SearchResult {
  id: string;
  label: string;
  sublabel?: string;
  path: string;
  type: string;
  icon: React.ReactNode;
  isPageShortcut?: boolean;
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

// Page shortcuts for quick navigation (shown when query matches a page name or when empty)
const PAGE_SHORTCUTS: { label: string; path: string; icon: React.ReactNode; keywords: string[] }[] = [
  { label: 'Dashboard', path: '/', icon: <DashboardIcon fontSize="small" />, keywords: ['dashboard', 'home'] },
  { label: 'Vendors', path: '/vendors', icon: <VendorIcon fontSize="small" />, keywords: ['vendor', 'vendors', 'supplier'] },
  { label: 'Purchase Orders', path: '/pos', icon: <POIcon fontSize="small" />, keywords: ['po', 'pos', 'purchase', 'order', 'orders'] },
  { label: 'Quotations', path: '/quotations', icon: <QuotationIcon fontSize="small" />, keywords: ['quotation', 'quote', 'quotes'] },
  { label: 'Invoices', path: '/invoices', icon: <InvoiceIcon fontSize="small" />, keywords: ['invoice', 'invoices', 'bill'] },
  { label: 'Payments', path: '/payments', icon: <PaymentIcon fontSize="small" />, keywords: ['payment', 'payments', 'pay'] },
  { label: 'Ledgers', path: '/ledgers', icon: <LedgerIcon fontSize="small" />, keywords: ['ledger', 'ledgers', 'chart', 'accounts'] },
  { label: 'Bank Accounts', path: '/bank-accounts', icon: <BankIcon fontSize="small" />, keywords: ['bank', 'banks'] },
  { label: 'Cash Accounts', path: '/cash-accounts', icon: <CashIcon fontSize="small" />, keywords: ['cash'] },
  { label: 'Budget Heads', path: '/budget-heads', icon: <BudgetIcon fontSize="small" />, keywords: ['budget', 'budgets'] },
  { label: 'Work Tasks', path: '/work', icon: <WorkIcon fontSize="small" />, keywords: ['work', 'task', 'tasks'] },
  { label: 'Issues', path: '/issues', icon: <IssueIcon fontSize="small" />, keywords: ['issue', 'issues', 'problem'] },
  { label: 'Assets', path: '/assets', icon: <AssetIcon fontSize="small" />, keywords: ['asset', 'assets', 'inventory'] },
  { label: 'Gate Passes', path: '/gate-passes', icon: <ArrowIcon fontSize="small" />, keywords: ['gate', 'pass', 'gatepass'] },
  { label: 'Vouchers', path: '/vouchers', icon: <LedgerIcon fontSize="small" />, keywords: ['voucher', 'vouchers', 'journal'] },
  { label: 'Finance Reports', path: '/finance-reports', icon: <LedgerIcon fontSize="small" />, keywords: ['report', 'reports', 'finance'] },
];

/** Highlight matching text within a string. */
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <Box component="mark" sx={{ bgcolor: 'warning.light', color: 'inherit', borderRadius: 0.5, px: 0.2 }}>
        {text.slice(idx, idx + q.length)}
      </Box>
      {text.slice(idx + q.length)}
    </>
  );
}

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
}

export default function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Page shortcuts filtered by query (shown at top when matched)
  const matchedPages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PAGE_SHORTCUTS.slice(0, 6); // show first 6 when empty
    return PAGE_SHORTCUTS.filter(
      (p) => p.label.toLowerCase().includes(q) || p.keywords.some((k) => k.includes(q) || q.includes(k)),
    );
  }, [query]);

  // Build the flat list of all selectable items (page shortcuts + search results)
  const allItems: SearchResult[] = useMemo(() => {
    const pages: SearchResult[] = matchedPages.map((p) => ({
      id: `page-${p.path}`,
      label: p.label,
      path: p.path,
      type: 'Page',
      icon: p.icon,
      isPageShortcut: true,
    }));
    return [...pages, ...results];
  }, [matchedPages, results]);

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
              icon: src.icon,
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
      setSelectedIndex(0);
    }
  }, [open]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [allItems.length]);

  // Auto-scroll to selected item
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleSelect = (result: SearchResult) => {
    // Track in recently viewed (skip page shortcuts)
    if (!result.isPageShortcut) {
      addRecentlyViewed({
        id: result.id,
        label: result.label,
        path: result.path,
        type: result.type,
      });
    }
    navigate(result.path);
    onClose();
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (allItems[selectedIndex]) {
        handleSelect(allItems[selectedIndex]);
      }
    }
  };

  // Group search results by type (exclude page shortcuts — they're shown separately)
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.type] ??= []).push(r);
    return acc;
  }, {});

  const showSearchResults = query.trim().length >= 2;
  const hasPageMatches = matchedPages.length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { position: 'fixed', top: 80, m: 0, width: '100%', maxWidth: 560 } }}
    >
      <DialogContent sx={{ p: 0 }} onKeyDown={handleKeyDown}>
        <TextField
          autoFocus
          fullWidth
          placeholder="Search anything, or type a page name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                {loading ? <CircularProgress size={18} /> : <SearchIcon fontSize="small" />}
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                <Chip size="small" label="Esc" sx={{ fontSize: '0.65rem', height: 18 }} />
              </InputAdornment>
            ),
          }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 0 } }}
        />

        <Box ref={listRef} sx={{ maxHeight: 420, overflowY: 'auto' }}>
          {/* Page shortcuts (quick navigation) */}
          {hasPageMatches && (
            <Box>
              <Typography variant="overline" color="text.secondary" sx={{ px: 2, pt: 1, display: 'block' }}>
                {query.trim() ? 'Pages' : 'Quick Navigation'}
              </Typography>
              <List dense sx={{ pt: 0 }}>
                {matchedPages.map((p) => {
                  const flatIdx = allItems.findIndex((a) => a.id === `page-${p.path}`);
                  const isSelected = flatIdx === selectedIndex;
                  return (
                    <ListItemButton
                      key={p.path}
                      data-idx={flatIdx}
                      selected={isSelected}
                      onClick={() => handleSelect({ id: `page-${p.path}`, label: p.label, path: p.path, type: 'Page', icon: p.icon })}
                      sx={{ py: 0.5 }}
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>{p.icon}</ListItemIcon>
                      <ListItemText
                        primary={highlightMatch(p.label, query)}
                        primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                      />
                      {query.trim() && <ArrowIcon fontSize="small" color="action" sx={{ opacity: 0.5 }} />}
                    </ListItemButton>
                  );
                })}
              </List>
            </Box>
          )}

          {/* Search results from API */}
          {showSearchResults && (
            <>
              {results.length > 0 && hasPageMatches && <Divider sx={{ my: 0.5 }} />}
              {results.length === 0 && !loading && !hasPageMatches ? (
                <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
                  No results for "{query}"
                </Typography>
              ) : results.length > 0 ? (
                <>
                  <Typography variant="overline" color="text.secondary" sx={{ px: 2, display: 'block' }}>
                    Results {results.length > 0 && `(${results.length})`}
                  </Typography>
                  <List dense sx={{ pt: 0 }}>
                    {Object.entries(grouped).map(([type, items]) => (
                      <Box key={type}>
                        <Typography variant="caption" color="text.secondary" sx={{ px: 2, pt: 0.5, display: 'block', fontWeight: 600 }}>
                          {type}
                        </Typography>
                        {items.map((r) => {
                          const flatIdx = allItems.findIndex((a) => a.id === r.id && a.type === r.type);
                          const isSelected = flatIdx === selectedIndex;
                          return (
                            <ListItemButton
                              key={`${r.type}-${r.id}`}
                              data-idx={flatIdx}
                              selected={isSelected}
                              onClick={() => handleSelect(r)}
                              sx={{ py: 0.5 }}
                            >
                              <ListItemIcon sx={{ minWidth: 36 }}>{r.icon}</ListItemIcon>
                              <ListItemText
                                primary={highlightMatch(r.label, query)}
                                secondary={r.sublabel}
                                primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                                secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                              />
                            </ListItemButton>
                          );
                        })}
                      </Box>
                    ))}
                  </List>
                </>
              ) : null}
            </>
          )}

          {/* Recently viewed (shown when no query) */}
          {!showSearchResults && !hasPageMatches && (() => {
            const recent = getRecentlyViewed();
            return recent.length > 0 ? (
              <Box>
                <Typography variant="overline" color="text.secondary" sx={{ px: 2, pt: 1, display: 'block' }}>
                  Recently Viewed
                </Typography>
                <List dense sx={{ pt: 0 }}>
                  {recent.map((r: RecentItem) => (
                    <ListItemButton
                      key={`${r.type}-${r.id}`}
                      onClick={() => handleSelect({ id: r.id, label: r.label, path: r.path, type: r.type, icon: <SearchIcon fontSize="small" /> })}
                      sx={{ py: 0.5 }}
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        {SOURCES.find((s) => s.type === r.type)?.icon ?? <SearchIcon fontSize="small" />}
                      </ListItemIcon>
                      <ListItemText
                        primary={r.label}
                        secondary={r.type}
                        primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                        secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                      />
                    </ListItemButton>
                  ))}
                </List>
                <Box sx={{ p: 2, textAlign: 'center' }}>
                  <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {['vendors', 'POs', 'invoices', 'ledgers', 'payments', 'banks'].map((t) => (
                      <Chip key={t} size="small" label={t} variant="outlined" onClick={() => setQuery(t)} sx={{ cursor: 'pointer' }} />
                    ))}
                  </Box>
                </Box>
              </Box>
            ) : (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Type to search across all modules
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {['vendors', 'POs', 'invoices', 'ledgers', 'payments', 'banks'].map((t) => (
                    <Chip key={t} size="small" label={t} variant="outlined" onClick={() => setQuery(t)} sx={{ cursor: 'pointer' }} />
                  ))}
                </Box>
              </Box>
            );
          })()}

          {/* Footer hint */}
          {allItems.length > 0 && (
            <Box sx={{ px: 2, py: 1, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 2, justifyContent: 'center' }}>
              <Typography variant="caption" color="text.secondary">
                ↑↓ navigate · Enter select · Esc close
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
