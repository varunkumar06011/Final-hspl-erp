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

// ── Amount to words (Indian system) ──
// e.g. 5250 → "Rupees Five Thousand Two Hundred Fifty Only"
//      10500.50 → "Rupees Ten Thousand Five Hundred and Fifty Paise Only"
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitsToWords(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ONES[n % 10] : '');
}

function threeDigitsToWords(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  let words = '';
  if (hundreds > 0) words += ONES[hundreds] + ' Hundred';
  if (rest > 0) words += (hundreds > 0 ? ' ' : '') + twoDigitsToWords(rest);
  return words;
}

export function amountToWords(amount: unknown): string {
  const num = Number(amount ?? 0);
  if (num === 0) return 'Rupees Zero Only';

  const isNegative = num < 0;
  const absNum = Math.abs(num);
  const integerPart = Math.floor(absNum);
  const decimalPart = Math.round((absNum - integerPart) * 100);

  // Indian numbering: ones, thousands, lakhs, crores
  const crores = Math.floor(integerPart / 10000000);
  const lakhs = Math.floor((integerPart % 10000000) / 100000);
  const thousands = Math.floor((integerPart % 100000) / 1000);
  const hundreds = integerPart % 1000;

  let words = '';
  if (crores > 0) words += threeDigitsToWords(crores) + ' Crore ';
  if (lakhs > 0) words += twoDigitsToWords(lakhs) + ' Lakh ';
  if (thousands > 0) words += twoDigitsToWords(thousands) + ' Thousand ';
  if (hundreds > 0) words += threeDigitsToWords(hundreds);

  words = words.trim();
  if (!words) words = 'Zero';

  let result = 'Rupees ' + words;
  if (decimalPart > 0) {
    result += ' and ' + twoDigitsToWords(decimalPart) + ' Paise';
  }
  result += ' Only';

  if (isNegative) result = 'Minus ' + result;
  return result;
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
