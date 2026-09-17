// Shared tax helpers.
//
// Item amounts are stored PRE-TAX in the backend (amount = qty × unitPrice,
// GST applied on top). UI surfaces display the tax-INCLUSIVE amount derived
// via these helpers, so displayed values always stay consistent with the
// stored amounts and the grand total — no separate/duplicated math.

export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 1 + rate/100 — e.g. 18 → 1.18, 0/undefined → 1 */
export const gstMult = (rate: unknown): number => 1 + num(rate) / 100;

/** Tax-inclusive amount for a stored pre-tax amount. */
export const toIncGst = (preTax: unknown, rate: unknown): number =>
  num(preTax) * gstMult(rate);

/** Pre-tax (taxable) amount for a tax-inclusive amount. */
export const toPreTax = (incGst: unknown, rate: unknown): number =>
  num(incGst) / gstMult(rate);

/** Tax portion inside a tax-inclusive amount (inc − preTax). */
export const gstOnInc = (incGst: unknown, rate: unknown): number =>
  num(incGst) - toPreTax(incGst, rate);

/** Tax amount for a stored pre-tax amount (preTax × rate%). */
export const gstOnPreTax = (preTax: unknown, rate: unknown): number =>
  num(preTax) * num(rate) / 100;

export const round2 = (n: number): number => Math.round(n * 100) / 100;
