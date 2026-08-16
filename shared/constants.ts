// ═══════════════════════════════════════════════════════════
// Constants — pagination defaults, approval config, etc.
// ═══════════════════════════════════════════════════════════

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;

export const APPROVAL_CONFIG = {
  MIN_APPROVERS: 2,
  MAX_APPROVERS: 4,
} as const;

export const STORAGE = {
  BUCKETS: {
    DOCUMENTS: 'documents',
    PHOTOS: 'photos',
    DRAWINGS: 'drawings',
  },
  MAX_FILE_SIZE_MB: 50,
} as const;

export const BUDGET_ALERT_THRESHOLD = 0.9; // 90% of budget triggers alert
