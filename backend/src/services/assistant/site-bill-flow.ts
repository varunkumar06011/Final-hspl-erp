/**
 * Site bills in Miko, without the back-and-forth:
 *  - a bill photo is turned straight into a site bill proposal from the document reading
 *    (no chat-model loop, so it is one read and done);
 *  - a bill above SITE_BILL_LIMIT cannot be a site bill, so the same lines become a
 *    material request proposal instead (one tap to save it as an MPR).
 * How it was paid is never asked: the bill's own mode if it shows one, otherwise cash.
 */
import { SITE_BILL_LIMIT, SiteBillPaymentMode } from '@hospital-erp/shared';
import { callApi } from './internalApi';
import type { DocumentReading } from './reader';

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export interface SiteBillArgs {
  shopName: string;
  billDate: string;
  paymentMode: string;
  description?: string;
  budgetHeadId?: string;
  items: { materialName: string; quantity: number; unit?: string; rate: number }[];
}

export function siteBillTotal(args: { items?: unknown }): number {
  const items = Array.isArray(args.items) ? (args.items as Array<{ quantity?: unknown; rate?: unknown }>) : [];
  return round2(items.reduce((s, i) => s + num(i.quantity) * num(i.rate), 0));
}

export const isOverSiteBillLimit = (args: { items?: unknown }) => siteBillTotal(args) > SITE_BILL_LIMIT;

/** Fills what the bot never asks for. */
export function withSiteBillDefaults<T extends Record<string, unknown>>(args: T): T {
  return { ...args, paymentMode: args.paymentMode || SiteBillPaymentMode.CASH };
}

/**
 * Site bill arguments read straight off a bill photo, or null when the reading is not
 * good enough (no amount at all, or barely legible) and the user has to be asked.
 * The lines always add up to the bill total (GST / transport rows not itemised become one
 * extra line; a discount is spread over the lines).
 */
export function siteBillFromReading(r: DocumentReading, today: string): SiteBillArgs | null {
  if (r.legibility < 0.3) return null;
  let items = r.lines
    .map((l) => {
      const quantity = l.quantity && l.quantity > 0 ? l.quantity : 1;
      const amount = l.amount ?? (l.rate != null ? l.rate * quantity : null);
      if (!amount || amount <= 0) return null;
      return { materialName: l.name.slice(0, 200), quantity, ...(l.unit ? { unit: l.unit.slice(0, 20) } : {}), rate: round2(amount / quantity) };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  const total = r.total && r.total > 0 ? r.total : null;
  if (!items.length) {
    if (!total) return null;
    items = [{ materialName: (r.notes ?? r.vendor.name ?? 'Site purchase').slice(0, 200), quantity: 1, rate: total }];
  } else if (total) {
    const sum = siteBillTotal({ items });
    if (total - sum > 1) {
      items.push({ materialName: 'Tax / other charges on the bill', quantity: 1, rate: round2(total - sum) });
    } else if (sum - total > 1) {
      const factor = total / sum;
      items = items.map((i) => ({ ...i, rate: round2(i.rate * factor) }));
    }
  }

  const date = r.documentDate && r.documentDate <= today ? r.documentDate : today;
  return {
    shopName: (r.vendor.name ?? groupName(items.map((i) => i.materialName))).slice(0, 200),
    billDate: date,
    paymentMode: r.paymentMode ?? SiteBillPaymentMode.CASH,
    ...(r.notes ? { description: r.notes.slice(0, 1000) } : {}),
    items,
  };
}

/** A short name for a bill with no shop name: the first item ("Cement and 2 more"). */
function groupName(names: string[]): string {
  if (!names.length) return 'Site purchase';
  return names.length === 1 ? names[0] : `${names[0]} and ${names.length - 1} more`;
}

/**
 * The material request a too-large site bill becomes. The shop is used as the vendor when
 * it already exists (exact name); a shop name read off the bill becomes a new one-time
 * (NON_VENDOR) supplier; a made-up group name is not turned into a vendor.
 */
export async function siteBillAsMprArgs(
  auth: string,
  bill: Record<string, unknown>,
  opts: { shopIsReal: boolean },
): Promise<Record<string, unknown>> {
  const shop = String(bill.shopName ?? '').trim();
  let vendor: Record<string, unknown> = {};
  if (shop) {
    const res = await callApi(auth, 'GET', '/vendors', { query: { search: shop, pageSize: 10, page: 1 } });
    const rows: Array<{ id: string; name: string }> = res.ok ? (Array.isArray(res.body?.data) ? res.body.data : Array.isArray(res.body) ? res.body : []) : [];
    const match = rows.find((v) => v.name?.trim().toLowerCase() === shop.toLowerCase());
    if (match) vendor = { vendorId: match.id };
    else if (opts.shopIsReal) vendor = { newVendor: { name: shop, vendorType: 'NON_VENDOR' } };
  }
  const total = siteBillTotal(bill);
  const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(total);
  const items = (Array.isArray(bill.items) ? bill.items : []).map((i: Record<string, unknown>) => ({
    materialName: String(i.materialName),
    quantity: num(i.quantity),
    ...(i.unit ? { unit: String(i.unit).slice(0, 20) } : {}),
    estimatedRate: num(i.rate),
  }));
  const why = `Bill${shop ? ` from ${shop}` : ''}${bill.billDate ? ` dated ${bill.billDate}` : ''} for ₹${inr}: above the ₹${SITE_BILL_LIMIT.toLocaleString('en-IN')} site-bill limit, so raised as a material request.`;
  return {
    requestType: 'MATERIAL',
    ...vendor,
    items,
    description: [bill.description, why].filter(Boolean).join(' ').slice(0, 2000),
  };
}
