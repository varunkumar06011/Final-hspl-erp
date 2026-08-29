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
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatIndianNumber(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';

  const rawValue = String(value).replace(/,/g, '');
  const [integerPart, decimalPart] = rawValue.split('.');
  const sign = integerPart.startsWith('-') ? '-' : '';
  const unsignedInteger = integerPart.replace(/^-/, '') || '0';
  const formattedInteger = unsignedInteger.length > 3
    ? `${unsignedInteger.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${unsignedInteger.slice(-3)}`
    : unsignedInteger;

  return `${sign}${formattedInteger}${decimalPart !== undefined ? `.${decimalPart}` : ''}`;
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
  PENDING_INSPECTION: 'warning',
  READY_TO_POST: 'info',
  POSTED: 'success',
  UNBILLED: 'default',
  MATERIAL: 'default',
  VISITOR: 'info',
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
  PLANNED: 'default',
  DONE: 'success',
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
