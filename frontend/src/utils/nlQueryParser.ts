/**
 * Natural Language Query Parser
 *
 * Translates plain English queries like:
 *   "show me pending payments to Sree Vinayaka above 1 lakh"
 *   "unpaid invoices from last month"
 *   "open issues with high severity"
 *
 * into structured filter objects that map to URL search params
 * for the corresponding list page.
 */

export interface ParsedQuery {
  /** Route path to navigate to */
  path: string;
  /** URL search params to set */
  params: Record<string, string>;
  /** Human-readable summary of what was understood */
  summary: string;
  /** The entity type that was matched */
  entity: string;
}

const ENTITY_KEYWORDS: Record<string, { path: string; keywords: string[] }> = {
  po: {
    path: '/pos',
    keywords: ['po', 'pos', 'purchase order', 'purchase orders', 'purchase', 'orders', 'order'],
  },
  invoice: {
    path: '/invoices',
    keywords: ['invoice', 'invoices', 'bill', 'bills', 'gst', 'tax invoice'],
  },
  payment: {
    path: '/payments',
    keywords: ['payment', 'payments', 'expense', 'expenses', 'payment request', 'payout', 'payouts', 'salary', 'wages', 'labour', 'labor'],
  },
  vendor: {
    path: '/vendors',
    keywords: ['vendor', 'vendors', 'supplier', 'suppliers', 'contractor', 'contractors', 'agency', 'agencies'],
  },
  issue: {
    path: '/issues',
    keywords: ['issue', 'issues', 'problem', 'problems', 'complaint', 'complaints', 'defect', 'defects', 'snag', 'snags'],
  },
  ledger: {
    path: '/ledgers',
    keywords: ['ledger', 'ledgers', 'account', 'accounts', 'book', 'books', 'transaction', 'transactions', 'entry', 'entries', 'voucher', 'vouchers'],
  },
  work: {
    path: '/work',
    keywords: ['work', 'task', 'tasks', 'work task', 'work tasks', 'activity', 'activities', 'to-do', 'todo', 'job', 'jobs'],
  },
  quotation: {
    path: '/quotations',
    keywords: ['quotation', 'quotations', 'quote', 'quotes', 'estimate', 'estimates', 'rfq', 'tender', 'tenders'],
  },
  asset: {
    path: '/assets',
    keywords: ['asset', 'assets', 'equipment', 'equipments', 'machine', 'machines', 'tool', 'tools', 'device', 'devices'],
  },
  phase: {
    path: '/phases',
    keywords: ['phase', 'phases', 'stage', 'stages', 'milestone', 'milestones'],
  },
  budget: {
    path: '/budget',
    keywords: ['budget', 'budgets', 'head', 'heads', 'allocation', 'allocations'],
  },
  user: {
    path: '/users',
    keywords: ['user', 'users', 'member', 'members', 'staff', 'employee', 'employees', 'team'],
  },
  audit: {
    path: '/audit',
    keywords: ['audit', 'audits', 'log', 'logs', 'history', 'changes', 'activity log'],
  },
};

const STATUS_MAP: Record<string, Record<string, string>> = {
  po: {
    pending: 'PENDING_APPROVAL',
    'waiting for approval': 'PENDING_APPROVAL',
    'awaiting approval': 'PENDING_APPROVAL',
    'not approved': 'PENDING_APPROVAL',
    approved: 'APPROVED',
    delivered: 'DELIVERED',
    'partially delivered': 'PARTIALLY_DELIVERED',
    rejected: 'REJECTED',
    cancelled: 'CANCELLED',
    canceled: 'CANCELLED',
  },
  invoice: {
    pending: 'PENDING',
    'not verified': 'PENDING',
    'waiting for verification': 'PENDING',
    verified: 'VERIFIED',
    rejected: 'REJECTED',
    paid: 'PAID',
    unpaid: 'UNPAID',
    'not paid': 'UNPAID',
    'partially paid': 'PARTIALLY_PAID',
  },
  payment: {
    pending: 'PENDING',
    'waiting for approval': 'PENDING',
    'awaiting approval': 'PENDING',
    'not approved': 'PENDING',
    approved: 'APPROVED',
    paid: 'PAID',
    rejected: 'REJECTED',
    completed: 'PAID',
    done: 'PAID',
  },
  issue: {
    open: 'OPEN',
    closed: 'CLOSED',
    resolved: 'CLOSED',
    'in progress': 'IN_PROGRESS',
    'being worked on': 'IN_PROGRESS',
  },
  work: {
    scheduled: 'SCHEDULED',
    planned: 'PLANNED',
    'in progress': 'IN_PROGRESS',
    completed: 'COMPLETED',
    done: 'COMPLETED',
    pending: 'PENDING',
    cancelled: 'CANCELLED',
    canceled: 'CANCELLED',
  },
  quotation: {
    pending: 'SUBMITTED',
    approved: 'APPROVED',
    rejected: 'REJECTED',
    submitted: 'SUBMITTED',
    'under review': 'UNDER_REVIEW',
    reviewing: 'UNDER_REVIEW',
  },
};

const SEVERITY_MAP: Record<string, string> = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  critical: 'CRITICAL',
};

const PRIORITY_MAP: Record<string, string> = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  urgent: 'URGENT',
};

/** Convert number words to digits */
function parseAmount(words: string): number | null {
  const lower = words.toLowerCase().trim();
  // "1 lakh", "2 lakhs", "1.5 lakh"
  const lakhMatch = lower.match(/([\d,.]+)\s*lakhs?/);
  if (lakhMatch) return parseFloat(lakhMatch[1].replace(/,/g, '')) * 100000;
  // "1 crore", "2 crores"
  const croreMatch = lower.match(/([\d,.]+)\s*crores?/);
  if (croreMatch) return parseFloat(croreMatch[1].replace(/,/g, '')) * 10000000;
  // "50000", "50,000"
  const plainMatch = lower.match(/([\d,.]+)/);
  if (plainMatch) return parseFloat(plainMatch[1].replace(/,/g, ''));
  return null;
}

/** Extract vendor/supplier name from phrases like "to Sree Vinayaka" or "from ABC Corp" */
function extractVendorName(query: string): string | null {
  // "to <name>", "from <name>", "vendor <name>", "supplier <name>"
  const patterns = [
    /(?:to|from|vendor|supplier)\s+([a-z][a-z0-9\s&.]+?)(?:\s+(?:above|below|over|under|between|with|having|last|this|today|pending|approved|paid|unpaid|open|closed|high|low|medium|critical|urgent|$))/i,
    /(?:to|from|vendor|supplier)\s+([a-z][a-z0-9\s&.]+)/i,
  ];
  for (const p of patterns) {
    const m = query.match(p);
    if (m && m[1] && m[1].trim().length > 1) {
      return m[1].trim();
    }
  }
  return null;
}

export function parseNaturalQuery(input: string): ParsedQuery | null {
  const query = input.toLowerCase().trim();
  if (!query) return null;

  // 1. Identify entity
  let matchedEntity: string | null = null;
  for (const [entity, config] of Object.entries(ENTITY_KEYWORDS)) {
    for (const kw of config.keywords) {
      if (query.includes(kw)) {
        matchedEntity = entity;
        break;
      }
    }
    if (matchedEntity) break;
  }

  if (!matchedEntity) return null;

  const entityConfig = ENTITY_KEYWORDS[matchedEntity];
  const params: Record<string, string> = {};
  const summaryParts: string[] = [];

  // 2. Extract status
  const statusMap = STATUS_MAP[matchedEntity] ?? {};
  for (const [keyword, value] of Object.entries(statusMap)) {
    if (query.includes(keyword)) {
      if (matchedEntity === 'invoice' && keyword === 'unpaid') {
        params.paymentStatus = 'UNPAID';
      } else if (matchedEntity === 'invoice' && keyword === 'paid') {
        params.paymentStatus = 'PAID';
      } else {
        params.status = value;
      }
      summaryParts.push(keyword);
      break;
    }
  }

  // 3. Extract severity (issues only)
  if (matchedEntity === 'issue') {
    for (const [keyword, value] of Object.entries(SEVERITY_MAP)) {
      if (query.includes(`${keyword} severity`) || query.includes(`severity ${keyword}`) || query.includes(`${keyword} priority`)) {
        params.severity = value;
        summaryParts.push(`${keyword} severity`);
        break;
      }
    }
  }

  // 4. Extract priority (work tasks)
  if (matchedEntity === 'work') {
    for (const [keyword, value] of Object.entries(PRIORITY_MAP)) {
      if (query.includes(`${keyword} priority`) || query.includes(`priority ${keyword}`)) {
        params.priority = value;
        summaryParts.push(`${keyword} priority`);
        break;
      }
    }
  }

  // 5. Extract vendor name → use as search term
  const vendorName = extractVendorName(query);
  if (vendorName) {
    params.search = vendorName;
    summaryParts.push(`matching "${vendorName}"`);
  }

  // 6. Extract amount threshold
  // "above 1 lakh", "over 50000", "below 2 lakhs", "between 10000 and 50000",
  // "more than 1 lakh", "exceeding 5 lakhs", "at least 50000", "max 2 lakhs"
  const aboveMatch = query.match(/(?:above|over|greater than|more than|exceeding|at least|min(?:imum)?(?:\s+of)?)\s+([\d,.]+\s*(?:lakhs?|crores?)?)/);
  const belowMatch = query.match(/(?:below|under|less than|lesser than|at most|max(?:imum)?(?:\s+of)?|up to|not exceeding)\s+([\d,.]+\s*(?:lakhs?|crores?)?)/);
  const betweenMatch = query.match(/between\s+([\d,.]+\s*(?:lakhs?|crores?)?)\s+and\s+([\d,.]+\s*(?:lakhs?|crores?)?)/);

  if (betweenMatch) {
    const min = parseAmount(betweenMatch[1]);
    const max = parseAmount(betweenMatch[2]);
    if (min !== null) params.minAmount = String(min);
    if (max !== null) params.maxAmount = String(max);
    summaryParts.push(`between ₹${min?.toLocaleString('en-IN')} and ₹${max?.toLocaleString('en-IN')}`);
  } else if (aboveMatch) {
    const amt = parseAmount(aboveMatch[1]);
    if (amt !== null) {
      params.minAmount = String(amt);
      summaryParts.push(`above ₹${amt.toLocaleString('en-IN')}`);
    }
  } else if (belowMatch) {
    const amt = parseAmount(belowMatch[1]);
    if (amt !== null) {
      params.maxAmount = String(amt);
      summaryParts.push(`below ₹${amt.toLocaleString('en-IN')}`);
    }
  }

  // 7. Date keywords
  if (query.includes('today') || query.includes("today's")) {
    params.dateFilter = 'today';
    summaryParts.push('from today');
  } else if (query.includes('this week') || query.includes('current week') || query.includes('thisweek')) {
    params.dateFilter = 'this_week';
    summaryParts.push('from this week');
  } else if (query.includes('this month') || query.includes('current month') || query.includes('thismonth')) {
    params.dateFilter = 'this_month';
    summaryParts.push('from this month');
  } else if (query.includes('last month') || query.includes('previous month') || query.includes('lastmonth')) {
    params.dateFilter = 'last_month';
    summaryParts.push('from last month');
  }

  // 8. If no search term extracted yet, try to find a quoted name or number
  if (!params.search) {
    const quotedMatch = input.match(/["']([^"']+)["']/);
    if (quotedMatch) {
      params.search = quotedMatch[1];
      summaryParts.push(`matching "${quotedMatch[1]}"`);
    }
  }

  // Build summary
  const entityLabel = matchedEntity.charAt(0).toUpperCase() + matchedEntity.slice(1);
  const summary = summaryParts.length > 0
    ? `${entityLabel}: ${summaryParts.join(', ')}`
    : `Showing all ${matchedEntity}s`;

  return {
    path: entityConfig.path,
    params,
    summary,
    entity: matchedEntity,
  };
}

/**
 * Get example queries for the UI.
 */
export const EXAMPLE_QUERIES = [
  'show pending payments above 1 lakh',
  'unpaid invoices from Sree Vinayaka',
  'open issues with high severity',
  'approved POs this month',
  'pending quotations below 50000',
  'work tasks with high priority this week',
  'vendors matching Sree',
  'paid payments last month',
  'waiting for approval POs over 2 lakhs',
  'resolved issues this week',
  'completed work tasks last month',
  'rejected invoices from last month',
  'big payments above 5 lakhs',
  'overdue tasks',
];
