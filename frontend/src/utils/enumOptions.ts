export function enumToOptions(e: Record<string, string>): { value: string; label: string }[] {
  return Object.values(e).map((v) => ({
    value: v,
    label: v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  }));
}

export function formatCurrency(amount: unknown): string {
  const num = Number(amount ?? 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatDate(date: unknown): string {
  if (!date) return '—';
  return new Date(String(date)).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export const STATUS_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
  BLACKLISTED: 'error',
  DRAFT: 'default',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  APPROVED: 'success',
  REJECTED: 'error',
  CONVERTED_TO_PO: 'success',
  PENDING: 'warning',
  PENDING_APPROVAL: 'warning',
  DELIVERED: 'success',
  PARTIALLY_DELIVERED: 'info',
  CANCELLED: 'error',
  VERIFIED: 'success',
  PAID: 'success',
  PARTIALLY_PAID: 'info',
  NOT_STARTED: 'default',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  DELAYED: 'error',
  ON_HOLD: 'warning',
  OPEN: 'error',
  RESOLVED: 'success',
  CLOSED: 'default',
  SCHEDULED: 'info',
  DEFECTS_FOUND: 'warning',
  CORRECTIVE_ACTION: 'warning',
  RE_INSPECTION: 'warning',
  PASSED: 'success',
  FAILED: 'error',
  INWARD: 'info',
  OUTWARD: 'secondary',
  BEFORE: 'default',
  DURING: 'info',
  AFTER: 'success',
  TERMINATED: 'error',
  ARCHIVED: 'default',
  SUPERSEDED: 'warning',
  LOW: 'default',
  MEDIUM: 'warning',
  HIGH: 'error',
  CRITICAL: 'error',
};
