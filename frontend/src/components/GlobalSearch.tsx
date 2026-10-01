import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
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
  LocalShipping as ReceiptIcon,
  MeetingRoom as GatePassIcon,
  ListAlt as RequestIcon,
  FactCheck as InspectionIcon,
  Folder as DocumentIcon,
  Groups as StaffIcon,
  PhotoCamera as PhotoIcon,
  Gavel as ContractIcon,
} from '@mui/icons-material';
import api from '../config/api';
import { enumLabel, formatCurrency, formatDate } from '../utils/enumOptions';
import { looseMatch } from '../utils/fuzzy';

import { useTranslation } from 'react-i18next';

interface Mark {
  start: number;
  end: number;
}

interface Snippet {
  label: string;
  labelKey: string;
  text: string;
  marks: Mark[];
  extra?: string;
}

interface Related {
  model: string;
  id: string;
  title: string;
}

/** One record returned by GET /search. */
interface Hit {
  key: string;
  model: string;
  typeLabel: string;
  id: string;
  title: string;
  titleMarks: Mark[];
  subtitle: string;
  path: string | null;
  status?: string;
  amount?: number;
  date?: string;
  matches: Snippet[];
  via?: Related;
  related: Related[];
}

interface SearchResponse {
  total: number;
  counts: Record<string, number>;
  results: Hit[];
}

interface Item {
  id: string;
  label: string;
  path: string | null;
  /** Model name for records, 'Page' for shortcuts, free text for legacy recents. */
  type: string;
  icon: React.ReactNode;
  isPageShortcut?: boolean;
}

const ICON_SMALL = { fontSize: 'small' } as const;
const ICONS: Record<string, React.ReactNode> = {
  Vendor: <VendorIcon {...ICON_SMALL} />,
  Quotation: <QuotationIcon {...ICON_SMALL} />,
  PurchaseOrder: <POIcon {...ICON_SMALL} />,
  VendorInvoice: <InvoiceIcon {...ICON_SMALL} />,
  PaymentRequest: <PaymentIcon {...ICON_SMALL} />,
  PaymentSheet: <PaymentIcon {...ICON_SMALL} />,
  JournalVoucher: <LedgerIcon {...ICON_SMALL} />,
  Ledger: <LedgerIcon {...ICON_SMALL} />,
  BankAccount: <BankIcon {...ICON_SMALL} />,
  CashAccount: <CashIcon {...ICON_SMALL} />,
  OwnerAccount: <OwnerIcon {...ICON_SMALL} />,
  BudgetHead: <BudgetIcon {...ICON_SMALL} />,
  BudgetRevision: <BudgetIcon {...ICON_SMALL} />,
  Contract: <ContractIcon {...ICON_SMALL} />,
  GoodsReceipt: <ReceiptIcon {...ICON_SMALL} />,
  GatePass: <GatePassIcon {...ICON_SMALL} />,
  MaterialPurchaseRequest: <RequestIcon {...ICON_SMALL} />,
  InventoryItem: <AssetIcon {...ICON_SMALL} />,
  Asset: <AssetIcon {...ICON_SMALL} />,
  WorkTask: <WorkIcon {...ICON_SMALL} />,
  Issue: <IssueIcon {...ICON_SMALL} />,
  Inspection: <InspectionIcon {...ICON_SMALL} />,
  Document: <DocumentIcon {...ICON_SMALL} />,
  Staff: <StaffIcon {...ICON_SMALL} />,
  SitePhoto: <PhotoIcon {...ICON_SMALL} />,
};
// Any record type the server adds later still gets a sensible icon.
const iconFor = (model: string): React.ReactNode => ICONS[model] ?? <SearchIcon {...ICON_SMALL} />;

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

const markSx = { bgcolor: 'warning.light', color: 'inherit', borderRadius: 0.5, px: 0.2 } as const;

/** Render `text` with the server-supplied highlight ranges (these already account for typos). */
function Marked({ text, marks }: { text: string; marks: Mark[] }) {
  if (marks.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let pos = 0;
  marks.forEach((m, i) => {
    if (m.start > pos) parts.push(text.slice(pos, m.start));
    parts.push(
      <Box component="mark" key={i} sx={markSx}>
        {text.slice(m.start, m.end)}
      </Box>,
    );
    pos = m.end;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}

/** Highlight a typed query inside a short label (page shortcuts), typo-free substring only. */
function highlightMatch(text: string, query: string): React.ReactNode {
  const q = query.trim().toLowerCase();
  const idx = q ? text.toLowerCase().indexOf(q) : -1;
  if (idx === -1) return text;
  return <Marked text={text} marks={[{ start: idx, end: idx + q.length }]} />;
}

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
}

export default function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const { t } = useTranslation('widgets');
  const navigate = useNavigate();
  const tl = (l: string) => t(`page_${l.replace(/[^A-Za-z]/g, '')}`, l);
  const tt = (ty: string, fallback = ty) => t(`type_${ty.replace(/[^A-Za-z]/g, '')}`, { defaultValue: fallback });
  const fl = (s: Snippet) => t(`gsField_${s.labelKey}`, { defaultValue: s.label });
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Page shortcuts filtered by query (shown at top when matched; tolerant of typos)
  const matchedPages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PAGE_SHORTCUTS.slice(0, 6); // show first 6 when empty
    return PAGE_SHORTCUTS.filter(
      (p) =>
        looseMatch(p.label, q) ||
        looseMatch(tl(p.label), q) ||
        p.keywords.some((k) => k.includes(q) || q.includes(k) || looseMatch(k, q)),
    );
  }, [query, t]);

  // Records grouped by type, groups ordered by their best hit — the same order
  // is used for rendering and for ↑/↓ navigation.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byModel = new Map<string, Hit[]>();
    for (const hit of response?.results ?? []) {
      if (!byModel.has(hit.model)) {
        byModel.set(hit.model, []);
        order.push(hit.model);
      }
      byModel.get(hit.model)!.push(hit);
    }
    return order.map((model) => ({ model, items: byModel.get(model)! }));
  }, [response]);

  const allItems: Item[] = useMemo(() => {
    const pages: Item[] = matchedPages.map((p) => ({
      id: `page-${p.path}`,
      label: tl(p.label),
      path: p.path,
      type: 'Page',
      icon: p.icon,
      isPageShortcut: true,
    }));
    const records: Item[] = groups.flatMap((g) =>
      g.items.map((h) => ({ id: h.key, label: h.title, path: h.path, type: h.model, icon: iconFor(h.model) })),
    );
    return [...pages, ...records];
  }, [matchedPages, groups, t]);

  const doSearch = useCallback(async (q: string) => {
    abortRef.current?.abort();
    if (q.trim().length < 2) {
      setResponse(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await api.get<SearchResponse>('/search', {
        params: { q, limit: 40, perType: 6 },
        signal: controller.signal,
      });
      setResponse(res.data);
    } catch (err) {
      if (axios.isCancel(err)) return;
      setResponse(null);
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      abortRef.current?.abort();
      setResponse(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => doSearch(query), 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      setQuery('');
      setResponse(null);
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

  const handleSelect = (item: Item) => {
    if (!item.path) return; // record type with no page to open yet
    // Track in recently viewed (skip page shortcuts)
    if (!item.isPageShortcut) {
      addRecentlyViewed({ id: item.id, label: item.label, path: item.path, type: item.type });
    }
    navigate(item.path);
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

  const hitCount = response?.results.length ?? 0;
  const showSearchResults = query.trim().length >= 2;
  const hasPageMatches = matchedPages.length > 0;
  const idxOf = (id: string) => allItems.findIndex((a) => a.id === id);

  const hitLine = (h: Hit) =>
    [h.subtitle, ...h.related.map((r) => r.title), h.status ? enumLabel(h.status) : '', h.amount ? formatCurrency(h.amount) : '', h.date ? formatDate(h.date) : '']
      .filter(Boolean)
      .join(' · ');

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
          placeholder={t('gsPlaceholder')}
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
                <Chip size="small" label={t('gsEsc')} sx={{ fontSize: '0.65rem', height: 18 }} />
              </InputAdornment>
            ),
          }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 0 } }}
        />

        <Box ref={listRef} sx={{ maxHeight: 460, overflowY: 'auto' }}>
          {/* Page shortcuts (quick navigation) */}
          {hasPageMatches && (
            <Box>
              <Typography variant="overline" color="text.secondary" sx={{ px: 2, pt: 1, display: 'block' }}>
                {query.trim() ? t('gsPages') : t('gsQuick')}
              </Typography>
              <List dense sx={{ pt: 0 }}>
                {matchedPages.map((p) => {
                  const flatIdx = idxOf(`page-${p.path}`);
                  return (
                    <ListItemButton
                      key={p.path}
                      data-idx={flatIdx}
                      selected={flatIdx === selectedIndex}
                      onClick={() => handleSelect(allItems[flatIdx])}
                      sx={{ py: 0.5 }}
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>{p.icon}</ListItemIcon>
                      <ListItemText
                        primary={highlightMatch(tl(p.label), query)}
                        primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                      />
                      {query.trim() && <ArrowIcon fontSize="small" color="action" sx={{ opacity: 0.5 }} />}
                    </ListItemButton>
                  );
                })}
              </List>
            </Box>
          )}

          {/* Search results from the server index */}
          {showSearchResults && (
            <>
              {hitCount > 0 && hasPageMatches && <Divider sx={{ my: 0.5 }} />}
              {hitCount === 0 && !loading && !hasPageMatches ? (
                <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
                  {t('gsNoResults', { q: query })}
                </Typography>
              ) : hitCount > 0 ? (
                <>
                  <Typography variant="overline" color="text.secondary" sx={{ px: 2, display: 'block' }}>
                    {t('gsResults', { n: `(${response?.total ?? hitCount})` })}
                  </Typography>
                  <List dense sx={{ pt: 0 }}>
                    {groups.map(({ model, items }) => {
                      const more = (response?.counts[model] ?? items.length) - items.length;
                      return (
                        <Box key={model}>
                          <Typography variant="caption" color="text.secondary" sx={{ px: 2, pt: 0.5, display: 'block', fontWeight: 600 }}>
                            {tt(model, items[0].typeLabel)}
                          </Typography>
                          {items.map((h) => {
                            const flatIdx = idxOf(h.key);
                            const line = hitLine(h);
                            return (
                              <ListItemButton
                                key={h.key}
                                data-idx={flatIdx}
                                selected={flatIdx === selectedIndex}
                                onClick={() => handleSelect(allItems[flatIdx])}
                                disabled={!h.path}
                                sx={{ py: 0.5, alignItems: 'flex-start' }}
                              >
                                <ListItemIcon sx={{ minWidth: 36, mt: 0.5 }}>{iconFor(h.model)}</ListItemIcon>
                                <ListItemText
                                  primary={<Marked text={h.title} marks={h.titleMarks} />}
                                  primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                                  secondaryTypographyProps={{ component: 'div' }}
                                  secondary={
                                    <>
                                      {line && (
                                        <Typography variant="caption" color="text.secondary" noWrap component="div">
                                          {line}
                                        </Typography>
                                      )}
                                      {h.matches.map((m, i) => (
                                        <Typography key={i} variant="caption" color="text.primary" noWrap component="div">
                                          <Box component="span" sx={{ color: 'text.secondary' }}>
                                            {fl(m)}:{' '}
                                          </Box>
                                          <Marked text={m.text} marks={m.marks} />
                                          {m.extra && (
                                            <Box component="span" sx={{ color: 'text.secondary' }}>
                                              {' '}
                                              · {m.extra}
                                            </Box>
                                          )}
                                        </Typography>
                                      ))}
                                      {h.via && (
                                        <Typography variant="caption" color="text.secondary" noWrap component="div" sx={{ fontStyle: 'italic' }}>
                                          {t('gsVia', { type: tt(h.via.model), title: h.via.title })}
                                        </Typography>
                                      )}
                                    </>
                                  }
                                />
                              </ListItemButton>
                            );
                          })}
                          {more > 0 && (
                            <Typography variant="caption" color="text.secondary" sx={{ px: 2, pb: 0.5, display: 'block' }}>
                              {t('gsMore', { n: more })}
                            </Typography>
                          )}
                        </Box>
                      );
                    })}
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
                  {t('gsRecent')}
                </Typography>
                <List dense sx={{ pt: 0 }}>
                  {recent.map((r: RecentItem) => (
                    <ListItemButton
                      key={`${r.type}-${r.id}`}
                      onClick={() => handleSelect({ id: r.id, label: r.label, path: r.path, type: r.type, icon: iconFor(r.type) })}
                      sx={{ py: 0.5 }}
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>{iconFor(r.type)}</ListItemIcon>
                      <ListItemText
                        primary={r.label}
                        secondary={tt(r.type)}
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
                  {t('gsHint')}
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
                {t('gsFooter')}
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
