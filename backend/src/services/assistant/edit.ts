/**
 * Editing a proposal on its confirmation card, before it is saved.
 *
 * Only a short allowlist of plain fields (and the lines' plain columns) can be
 * changed per tool: ids, linked records, attached photos and acknowledgements
 * are never editable. The edited arguments go through the same shared Zod
 * schema and card summary as the original proposal, so an edit can never save
 * anything the normal form would refuse.
 */
import { ToolError } from './tools';

export type FieldKind = 'text' | 'number' | 'date' | string[];

interface EditSpec {
  fields: Record<string, FieldKind>;
  /** Plain columns of each line in `items`. */
  items?: Record<string, FieldKind>;
}

const MAX_ITEMS = 100;

export const EDITABLE: Record<string, EditSpec> = {
  create_vendor: {
    fields: {
      name: 'text',
      vendorType: ['VENDOR', 'NON_VENDOR'],
      phone: 'text',
      contactPersonName: 'text',
      gstNumber: 'text',
      panNumber: 'text',
      address: 'text',
      email: 'text',
    },
  },
  create_mpr: {
    fields: {
      description: 'text',
      requiredBy: 'date',
      priority: ['Normal', 'Urgent', 'Critical'],
      department: 'text',
      deliveryAddress: 'text',
      contactPerson: 'text',
      contactNumber: 'text',
      estimatedGstRate: 'number',
    },
    items: { materialName: 'text', quantity: 'number', unit: 'text', estimatedRate: 'number' },
  },
  create_quotation: {
    fields: { notes: 'text' },
    items: { materialName: 'text', quantity: 'number', unit: 'text', unitPrice: 'number', gstRate: 'number' },
  },
  create_purchase_order: {
    fields: {
      paymentType: ['ADVANCE', 'AFTER_DELIVERY', 'FULL_PAYMENT'],
      advanceAmount: 'number',
      deliveryDate: 'date',
      paymentTerms: 'text',
      notes: 'text',
    },
  },
  create_goods_receipt: {
    fields: {},
    items: { materialName: 'text', deliveredQty: 'number', unit: 'text' },
  },
  create_invoice: {
    fields: { invoiceNumber: 'text', amount: 'number', taxAmount: 'number', totalAmount: 'number', deliveryDate: 'date' },
  },
  create_stock_entry: {
    fields: {
      sourceType: ['OPENING_STOCK', 'CASH_PURCHASE', 'OWNER_FREE_ISSUE', 'PROJECT_TRANSFER', 'SITE_RETURN'],
      supplierName: 'text',
      referenceNo: 'text',
      entryDate: 'date',
      notes: 'text',
    },
    items: { materialName: 'text', unit: 'text', quantity: 'number', unitCost: 'number' },
  },
  create_site_bill: {
    fields: { shopName: 'text', billDate: 'date', paymentMode: ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE'], description: 'text' },
    items: { materialName: 'text', quantity: 'number', unit: 'text', rate: 'number' },
  },
};

/** One editable input as the client renders it. */
export interface EditField {
  key: string;
  kind: 'text' | 'number' | 'date' | 'select';
  options?: string[];
  value: string;
}

export interface EditState {
  fields: EditField[];
  items?: { columns: Omit<EditField, 'value'>[]; rows: Record<string, string>[] };
}

const kindOf = (k: FieldKind): EditField['kind'] => (Array.isArray(k) ? 'select' : k);
const asText = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** What the card shows in its edit form for these stored arguments. */
export function editState(tool: string, args: Record<string, unknown>): EditState | null {
  const spec = EDITABLE[tool];
  if (!spec) return null;
  const state: EditState = {
    fields: Object.entries(spec.fields).map(([key, k]) => ({
      key,
      kind: kindOf(k),
      ...(Array.isArray(k) ? { options: k } : {}),
      value: asText(args[key]),
    })),
  };
  if (spec.items && Array.isArray(args.items)) {
    state.items = {
      columns: Object.entries(spec.items).map(([key, k]) => ({ key, kind: kindOf(k), ...(Array.isArray(k) ? { options: k } : {}) })),
      rows: (args.items as Record<string, unknown>[]).map((row) => Object.fromEntries(Object.keys(spec.items!).map((c) => [c, asText(row?.[c])]))),
    };
  }
  return state;
}

export interface EditPatch {
  fields?: Record<string, string | number | null>;
  /** Every line after the edit: `src` is the index of the line it came from (null = a new line). */
  items?: { src: number | null; values: Record<string, string | number | null> }[];
}

function coerce(key: string, kind: FieldKind, raw: string | number | null | undefined): unknown {
  const text = raw === null || raw === undefined ? '' : String(raw).trim();
  if (text === '') return undefined; // cleared: the schema decides whether that is allowed
  if (Array.isArray(kind)) {
    if (!kind.includes(text)) throw new ToolError(`${key}: pick one of ${kind.join(', ')}`);
    return text;
  }
  if (kind === 'number') {
    const n = Number(text.replace(/,/g, ''));
    if (!Number.isFinite(n)) throw new ToolError(`${key}: "${text}" is not a number`);
    return n;
  }
  if (kind === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) throw new ToolError(`${key}: use a date like 2026-10-21`);
    return text;
  }
  return text.slice(0, 500);
}

/** The stored arguments with the patch applied. Throws ToolError for anything not allowed. */
export function applyEdit(tool: string, args: Record<string, unknown>, patch: EditPatch): Record<string, unknown> {
  const spec = EDITABLE[tool];
  if (!spec) throw new ToolError('This record cannot be edited here.');
  const next: Record<string, unknown> = { ...args };

  for (const [key, raw] of Object.entries(patch.fields ?? {})) {
    const kind = spec.fields[key];
    if (kind === undefined) throw new ToolError(`${key} cannot be edited here.`);
    const value = coerce(key, kind, raw);
    if (value === undefined) delete next[key];
    else next[key] = value;
  }

  if (patch.items) {
    if (!spec.items || !Array.isArray(args.items)) throw new ToolError('This record has no lines to edit.');
    if (patch.items.length < 1 || patch.items.length > MAX_ITEMS) throw new ToolError('Keep between 1 and 100 lines.');
    const original = args.items as Record<string, unknown>[];
    next.items = patch.items.map((line) => {
      const base = line.src !== null && original[line.src] ? { ...original[line.src] } : {};
      for (const [col, kind] of Object.entries(spec.items!)) {
        if (!(col in line.values)) continue;
        const value = coerce(col, kind, line.values[col]);
        if (value === undefined) delete base[col];
        else base[col] = value;
      }
      return base;
    });
  }

  // An invoice's total follows the amount and tax unless the total itself was typed.
  if (tool === 'create_invoice' && patch.fields && ('amount' in patch.fields || 'taxAmount' in patch.fields) && !('totalAmount' in patch.fields)) {
    next.totalAmount = Math.round((Number(next.amount ?? 0) + Number(next.taxAmount ?? 0)) * 100) / 100;
  }
  return next;
}
