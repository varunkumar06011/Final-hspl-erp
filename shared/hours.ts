/**
 * Hour-based lines (JCB, crane, labour...). The quantity is typed as H.MM:
 * 9.15 means 9 hours 15 minutes, not 9.15 decimal hours. Billing must use the
 * real time: 9h15m = 9.25 hours.
 */
export function isHourUnit(unit?: string | null): boolean {
  const u = (unit ?? '').trim().toLowerCase();
  return u === 'hrs' || u === 'hr' || u === 'hour' || u === 'hours';
}

/** True when the fractional part of an H.MM value is a valid minute count (00-59). */
export function isValidHoursMinutes(value: number): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  const minutes = Math.round((value - Math.floor(value)) * 100);
  return minutes < 60;
}

/**
 * Quantity to multiply by the rate. For hour units, H.MM -> H + MM/60
 * (9.15 -> 9.25). A fraction of 60 or more cannot be minutes, so it is kept
 * as plain decimal hours (9.75 stays 9.75). Other units are unchanged.
 */
export function billableQuantity(quantity: number | string | null | undefined, unit?: string | null): number {
  const q = Number(quantity);
  if (!Number.isFinite(q)) return 0;
  if (!isHourUnit(unit) || q < 0) return q;
  const whole = Math.floor(q);
  const minutes = Math.round((q - whole) * 100);
  if (minutes === 0 || minutes >= 60) return q;
  return whole + minutes / 60;
}

/** Line amount before GST: billable quantity x rate, rounded to paise. */
export function lineBaseAmount(
  quantity: number | string | null | undefined,
  rate: number | string | null | undefined,
  unit?: string | null,
): number {
  return Math.round(billableQuantity(quantity, unit) * Number(rate || 0) * 100) / 100;
}

/** Shows 9.25 hours back as "9h 15m" (hour units only). */
export function formatHoursMinutes(quantity: number | string | null | undefined): string {
  const q = Number(quantity);
  if (!Number.isFinite(q)) return '';
  const whole = Math.floor(q);
  const minutes = Math.round((q - whole) * 100);
  return minutes > 0 && minutes < 60 ? `${whole}h ${minutes}m` : `${q}h`;
}
