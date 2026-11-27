// Payment voucher amount matching.
//
// A payment request may be marked PAID when the amount actually paid (or the
// linked PAYMENT voucher's total) is within ₹1 of the approved amount, either
// way. All comparisons are done in whole paise (integers) so floating-point
// noise such as 999.1 - 1000.1 never decides the outcome.

/** Largest allowed difference between the approved and the paid amount, in rupees. */
export const PAYMENT_MATCH_TOLERANCE = 1;

const TOLERANCE_PAISE = Math.round(PAYMENT_MATCH_TOLERANCE * 100);

/** Rupees → whole paise. Returns NaN for anything that is not a finite number. */
export function toPaise(amount: number | string): number {
  const n = typeof amount === 'string' ? Number(amount.replace(/,/g, '')) : Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/** True when `paid` is a valid positive amount within ±₹1 of `expected`. */
export function isWithinPaymentTolerance(expected: number | string, paid: number | string): boolean {
  const e = toPaise(expected);
  const p = toPaise(paid);
  if (!Number.isFinite(e) || !Number.isFinite(p) || p <= 0) return false;
  return Math.abs(p - e) <= TOLERANCE_PAISE;
}

/**
 * Split one actual paid total over several approved amounts: each keeps its own
 * approved amount, and the (at most ₹1) difference goes onto the largest one, so
 * the recorded amounts add up exactly to what was paid. Returns null when the
 * total is outside the tolerance or a share would not stay positive.
 */
export function splitPaidAmount(approved: Array<number | string>, paidTotal: number | string): number[] | null {
  if (approved.length === 0) return null;
  const parts = approved.map(toPaise);
  const total = toPaise(paidTotal);
  if (parts.some((p) => !Number.isFinite(p) || p <= 0) || !Number.isFinite(total)) return null;
  const sum = parts.reduce((s, p) => s + p, 0);
  if (total <= 0 || Math.abs(total - sum) > TOLERANCE_PAISE) return null;
  let largest = 0;
  parts.forEach((p, i) => { if (p > parts[largest]) largest = i; });
  parts[largest] += total - sum;
  if (parts[largest] <= 0) return null;
  return parts.map((p) => p / 100);
}
