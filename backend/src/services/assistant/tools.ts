/**
 * The assistant's tool registry — the ONLY things the AI can do.
 *
 * Read tools call existing GET endpoints. Write tools are CREATE-only: they
 * never execute on their own. A write tool validates the arguments against the
 * shared Zod schema, resolves human labels (vendor name, MPR number...) through
 * the API, and returns a *proposal* that the user must confirm in the UI.
 *
 * There is deliberately no tool for approve / reject / payment / delete /
 * cancel / update. Adding one is a code change here, not something the model
 * can talk its way into.
 */
import type { ZodTypeAny } from 'zod';
import {
  createVendorSchema,
  createMPRSchema,
  createQuotationSchema,
  createPOSchema,
  createGoodsReceiptSchema,
  createInvoiceSchema,
  createStockEntrySchema,
} from '@hospital-erp/shared';
import { callApi, apiErrorMessage } from './internalApi';
import { REGISTRY } from '../search/registry';
import type { FunctionDeclaration } from './gemini';

export interface ToolContext {
  /** The caller's own Authorization header, forwarded to every internal call. */
  auth: string;
}

/** An error the model should see and react to (ask the user, fix arguments). */
export class ToolError extends Error {}

export interface SummaryItem {
  name: string;
  qty?: string;
  unit?: string;
  rate?: string;
  amount?: string;
}
export interface ActionSummary {
  /** Label keys are translated by the frontend; values are data. */
  fields: { key: string; value: string }[];
  items?: SummaryItem[];
  totals?: { key: string; value: string }[];
}

export interface ListTable {
  entity: string;
  columns: string[];
  total: number;
  rows: { id: string; link: string | null; values: Record<string, unknown> }[];
}

// ─── JSON-schema helpers (Gemini function-declaration subset) ───────────────
const S = (description: string) => ({ type: 'STRING', description });
const N = (description: string) => ({ type: 'NUMBER', description });
const E = (values: string[], description: string) => ({ type: 'STRING', enum: values, description });
const O = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'OBJECT',
  properties,
  required,
});
const A = (items: unknown, description: string) => ({ type: 'ARRAY', items, description });

// ─── formatting ─────────────────────────────────────────────────────────────
const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = (n: number) => `₹${inr.format(Math.round(n * 100) / 100)}`;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const unwrap = (body: any) => (body && typeof body === 'object' && 'data' in body && !Array.isArray(body.data) ? body.data : body);

// ─── result slimming (keeps tool results small for the model) ───────────────
const DROP_KEYS = new Set([
  'projectId', 'createdBy', 'updatedAt', 'deletedAt', 'filePath', 'fileName', 'fileMimeType',
  'receiptFilePath', 'receiptFileName', 'receiptFileMimeType', 'approvalWorkflowId', 'project',
  'logoUrl', 'imagePath', 'passwordHash',
]);

function slim(value: any, depth: number, maxDepth: number): any {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => slim(v, depth + 1, maxDepth));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === null || v === undefined || DROP_KEYS.has(k)) continue;
    if (typeof v === 'object') {
      if (depth >= maxDepth) continue;
      out[k] = slim(v, depth + 1, maxDepth);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const MAX_RESULT_CHARS = 14_000;
function capped(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (text.length <= MAX_RESULT_CHARS) return value;
  return { truncated: true, note: 'Result was too large and was cut. Narrow the filters.', preview: text.slice(0, MAX_RESULT_CHARS) };
}

function pick(obj: any, path: string): unknown {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

// ─── readable entities ──────────────────────────────────────────────────────
interface EntityDef {
  path: string;
  model: string; // key into search REGISTRY (deep-link target)
  columns: string[];
  /** Endpoint ignores filters; apply status/search here instead. */
  clientFilter?: boolean;
}

const ENTITIES: Record<string, EntityDef> = {
  vendors: { path: '/vendors', model: 'Vendor', columns: ['vendorCode', 'name', 'vendorType', 'status', 'phone'] },
  material_requests: { path: '/material-purchase-requests', model: 'MaterialPurchaseRequest', columns: ['mprNumber', 'vendor.name', 'status', 'estimatedTotal', 'date'] },
  quotations: { path: '/quotations', model: 'Quotation', columns: ['quotationNumber', 'vendor.name', 'status', 'grandTotal', 'createdAt'] },
  purchase_orders: { path: '/purchase-orders', model: 'PurchaseOrder', columns: ['poNumber', 'vendor.name', 'status', 'grandTotal', 'createdAt'] },
  invoices: { path: '/invoices', model: 'VendorInvoice', columns: ['invoiceCode', 'invoiceNumber', 'vendor.name', 'verificationStatus', 'totalAmount', 'date'] },
  goods_receipts: { path: '/goods-receipts', model: 'GoodsReceipt', columns: ['receiptNumber', 'purchaseOrder.poNumber', 'status', 'createdAt'], clientFilter: true },
  stock_entries: { path: '/stock-entries', model: 'StockEntry', columns: ['entryNumber', 'sourceType', 'supplierName', 'status', 'entryDate'], clientFilter: true },
  inventory_items: { path: '/inventory/items', model: 'InventoryItem', columns: ['name', 'sku', 'category', 'currentStock', 'unit'] },
  payments: { path: '/payments', model: 'PaymentRequest', columns: ['paymentCode', 'vendor.name', 'status', 'amount', 'createdAt'] },
};
const ENTITY_NAMES = Object.keys(ENTITIES);

function linkFor(def: EntityDef, row: any): string | null {
  const reg = REGISTRY[def.model];
  try {
    return reg?.path ? reg.path(String(row.id), row) : null;
  } catch {
    return null;
  }
}

function extractRows(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

// ─── tool types ─────────────────────────────────────────────────────────────
export interface ReadTool {
  kind: 'read';
  declaration: FunctionDeclaration;
  run(args: Record<string, any>, ctx: ToolContext): Promise<{ result: unknown; table?: ListTable }>;
}

export interface WriteTool {
  kind: 'write';
  declaration: FunctionDeclaration;
  /** Shared Zod request schema ({ body }). */
  schema: ZodTypeAny;
  /** App endpoint the confirmed action is POSTed to (under /api). */
  path: string;
  /** Search-registry model of the created record, for the result link. */
  model: string;
  /** The endpoint requires an `acknowledged: true` flag — supplied on user confirm. */
  needsAck: boolean;
  /** Fields of the created record to build its label from, first present wins. */
  labelFields: string[];
  /** Resolve labels + compute totals for the confirmation card. Throws ToolError on bad references. */
  summarize(args: Record<string, any>, ctx: ToolContext): Promise<ActionSummary>;
}

export type Tool = ReadTool | WriteTool;

// ─── lookups used to build confirmation cards ───────────────────────────────
async function lookup(ctx: ToolContext, path: string, id: string, what: string): Promise<any> {
  const res = await callApi(ctx.auth, 'GET', `${path}/${id}`);
  if (!res.ok) {
    throw new ToolError(
      res.status === 404 || res.status === 400
        ? `${what} with id ${id} was not found. Search for it with list_records and use the exact id.`
        : `Could not look up ${what}: ${apiErrorMessage(res)}`,
    );
  }
  return unwrap(res.body);
}

async function vendorLabel(ctx: ToolContext, id: string): Promise<string> {
  const v = await lookup(ctx, '/vendors', id, 'Vendor');
  return [v.name, v.vendorCode ? `(${v.vendorCode})` : ''].filter(Boolean).join(' ');
}

const field = (key: string, value: unknown) => ({ key, value: String(value) });
const maybe = (key: string, value: unknown) => (value === undefined || value === null || value === '' ? [] : [field(key, value)]);

// ─── read tools ─────────────────────────────────────────────────────────────
const readTools: ReadTool[] = [
  {
    kind: 'read',
    declaration: {
      name: 'list_records',
      description:
        'List records of one type for the current project (read-only). Use it to find ids (vendors, MPRs, quotations, POs) before creating anything, and to answer questions such as "show unapproved POs". Returns up to pageSize rows plus the total count.',
      parameters: O(
        {
          entity: E(ENTITY_NAMES, 'Which records to list.'),
          search: S('Free-text search: names, numbers (e.g. VGH-PO001), vendor name.'),
          status: S(
            'Status filter. PO: DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, PARTIALLY_DELIVERED, DELIVERED, CANCELLED. Quotation: DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, CONVERTED_TO_PO. MPR: DRAFT, SUBMITTED, APPROVED, REJECTED, QUOTATIONS_RECEIVED, CLOSED, CANCELLED. Goods receipt: PENDING_INSPECTION, READY_TO_POST, POSTED, REJECTED. Stock entry: PENDING_APPROVAL, POSTED, REJECTED. Vendor: ACTIVE, INACTIVE, BLACKLISTED. Payment: PENDING, APPROVED, ...',
          ),
          verificationStatus: E(['PENDING', 'VERIFIED', 'REJECTED'], 'Invoices only: verification status.'),
          vendorId: S('Filter to one vendor (uuid).'),
          vendorType: E(['VENDOR', 'NON_VENDOR'], 'Vendors only.'),
          requestType: E(['MATERIAL', 'SERVICE'], 'Material requests only.'),
          minAmount: N('Minimum amount in rupees (POs, invoices, payments).'),
          maxAmount: N('Maximum amount in rupees (POs, invoices, payments).'),
          dateFilter: E(['today', 'this_week', 'this_month', 'last_month'], 'Created within this period (POs, invoices, payments).'),
          pageSize: N('Rows to return (default 15, max 25).'),
        },
        ['entity'],
      ),
    },
    async run(args, ctx) {
      const def = ENTITIES[String(args.entity)];
      if (!def) throw new ToolError(`Unknown entity. Use one of: ${ENTITY_NAMES.join(', ')}`);
      const pageSize = Math.min(Math.max(Math.floor(num(args.pageSize)) || 15, 1), 25);

      const query: Record<string, unknown> = { pageSize, page: 1 };
      const filterKeys = ['search', 'status', 'verificationStatus', 'vendorId', 'vendorType', 'requestType', 'minAmount', 'maxAmount', 'dateFilter'];
      if (!def.clientFilter) for (const k of filterKeys) if (args[k] !== undefined) query[k] = args[k];

      const res = await callApi(ctx.auth, 'GET', def.path, { query });
      if (!res.ok) throw new ToolError(apiErrorMessage(res));

      let rows = extractRows(res.body);
      let total = num(res.body?.pagination?.total) || rows.length;
      if (def.clientFilter) {
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        if (args.search) {
          const needle = String(args.search).toLowerCase();
          rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(needle));
        }
        total = rows.length;
        rows = rows.slice(0, pageSize);
      }

      const table: ListTable = {
        entity: String(args.entity),
        columns: def.columns,
        total,
        rows: rows.map((r) => ({
          id: String(r.id),
          link: linkFor(def, r),
          values: Object.fromEntries(def.columns.map((c) => [c, pick(r, c) ?? null])),
        })),
      };
      return {
        table,
        result: capped({ total, returned: rows.length, rows: rows.map((r) => slim(r, 0, 2)) }),
      };
    },
  },
  {
    kind: 'read',
    declaration: {
      name: 'get_record',
      description: 'Get the full details of one record (items, amounts, approval steps) by its id. Read-only.',
      parameters: O({ entity: E(ENTITY_NAMES, 'Record type.'), id: S('The record uuid.') }, ['entity', 'id']),
    },
    async run(args, ctx) {
      const def = ENTITIES[String(args.entity)];
      if (!def) throw new ToolError(`Unknown entity. Use one of: ${ENTITY_NAMES.join(', ')}`);
      const res = await callApi(ctx.auth, 'GET', `${def.path}/${encodeURIComponent(String(args.id))}`);
      if (!res.ok) throw new ToolError(apiErrorMessage(res));
      return { result: capped(slim(unwrap(res.body), 0, 3)) };
    },
  },
  {
    kind: 'read',
    declaration: {
      name: 'search_records',
      description:
        'Typo-tolerant search across every record type in the project (vendors, POs, invoices, materials on line items, comments...). Use it when you do not know which type a thing is.',
      parameters: O({ query: S('What to look for.') }, ['query']),
    },
    async run(args, ctx) {
      const res = await callApi(ctx.auth, 'GET', '/search', { query: { q: args.query, limit: 15, perType: 5 } });
      if (!res.ok) throw new ToolError(apiErrorMessage(res));
      return { result: capped(slim(res.body, 0, 3)) };
    },
  },
];

// ─── write tools (create-only, proposal + confirm) ──────────────────────────
// Unit codes the MPR / service-request form offers (QTY_UNIT_OPTIONS + SERVICE_UNIT_OPTIONS in the frontend).
const UNIT_CODES = ['nos', 'hrs', 'sqft', 'rft', 'kg', 'ton', 'ltr', 'set', 'day', 'visit', 'job', 'lumpsum'];
const lineItemMaterial = (extra: Record<string, unknown>) =>
  O(
    {
      materialName: S('Material name in English, e.g. Cement 53 Grade. Translate Telugu names.'),
      quantity: N('Quantity.'),
      unit: E(UNIT_CODES, 'Unit code. Materials: nos (pieces, bags, bundles), kg, ton, ltr, sqft, rft, set. Services: hrs, day, visit, job, lumpsum. Put the pack in the name if useful, e.g. "Cement 53 Grade (bags)" with unit nos.'),
      ...extra,
    },
    ['materialName', 'quantity'],
  );

const writeTools: WriteTool[] = [
  // ── Vendor ──
  {
    kind: 'write',
    schema: createVendorSchema,
    path: '/vendors',
    model: 'Vendor',
    needsAck: false,
    labelFields: ['name'],
    declaration: {
      name: 'create_vendor',
      description:
        'Propose creating a new vendor/supplier. Only call after the user has agreed to create it (never auto-create when a name is not found — ask first). The user must confirm before it is saved.',
      parameters: O(
        {
          name: S('Vendor / company name.'),
          vendorType: E(['VENDOR', 'NON_VENDOR'], 'VENDOR = regular supplier (goes through quotation -> PO). NON_VENDOR = one-time supplier (transport, small local purchases).'),
          phone: S('Phone number.'),
          contactPersonName: S('Contact person.'),
          contactPersonPhone: S('Contact person phone.'),
          gstNumber: S('GSTIN.'),
          panNumber: S('PAN.'),
          category: S('Category, e.g. MATERIAL_SUPPLIER, LABOUR_SUPPLIER, ELECTRICAL_CONTRACTOR, SERVICE_PROVIDER. Default OTHER.'),
          address: S('Address.'),
          email: S('Email.'),
          description: S('Notes about the vendor.'),
        },
        ['name'],
      ),
    },
    async summarize(a) {
      return {
        fields: [
          field('name', a.name),
          field('vendorType', a.vendorType ?? 'VENDOR'),
          ...maybe('phone', a.phone),
          ...maybe('contactPerson', a.contactPersonName),
          ...maybe('gstNumber', a.gstNumber),
          ...maybe('panNumber', a.panNumber),
          ...maybe('category', a.category),
          ...maybe('address', a.address),
        ],
      };
    },
  },

  // ── Material purchase request ──
  {
    kind: 'write',
    schema: createMPRSchema,
    path: '/material-purchase-requests',
    model: 'MaterialPurchaseRequest',
    needsAck: false,
    labelFields: ['mprNumber'],
    declaration: {
      name: 'create_mpr',
      description:
        'Propose a Material Purchase Request (requestType MATERIAL) or a Service Request (requestType SERVICE) for a vendor. It is saved as a DRAFT; the user submits it for approval in the app. Needs the vendor (existing vendorId, or newVendor only if the user agreed to create one) and at least one item with a quantity. For SERVICE, each item is a service/work line (materialName = what work, e.g. "AC servicing", quantity = hours/days/visits/jobs, unit from the service units).',
      parameters: O(
        {
          requestType: E(['MATERIAL', 'SERVICE'], 'Default MATERIAL.'),
          vendorId: S('Existing vendor uuid (from list_records vendors).'),
          newVendor: O({ name: S('Vendor name.'), phone: S('Phone.'), vendorType: E(['VENDOR', 'NON_VENDOR'], 'Default VENDOR.') }, ['name']),
          items: A(
            lineItemMaterial({
              estimatedRate: N('Estimated rate per unit in rupees (excl. GST).'),
              specification: S('Grade / size / brand.'),
              remarks: S('Remarks.'),
            }),
            'Materials requested.',
          ),
          estimatedGstRate: N('GST % applied on the estimate (e.g. 18).'),
          requiredBy: S('Required-by date, YYYY-MM-DD.'),
          priority: E(['Normal', 'Urgent', 'Critical'], 'Priority.'),
          department: S('Department.'),
          description: S('Purpose / description.'),
          deliveryAddress: S('Delivery address.'),
          contactPerson: S('Site contact person.'),
          contactNumber: S('Site contact number.'),
          serviceCategory: E(['AMC / Annual Maintenance Contract', 'Repair & Maintenance', 'Installation & Commissioning', 'Consultancy / Professional Services', 'Manpower / Labour Supply', 'Transportation / Logistics', 'Housekeeping Services', 'Security Services', 'IT / Software Services', 'Other'], 'SERVICE requests only: pick the closest category.'),
          servicePeriodStart: S('SERVICE requests only: service start date, YYYY-MM-DD.'),
          servicePeriodEnd: S('SERVICE requests only: service end date, YYYY-MM-DD.'),
          technicalRequirements: S('Technical requirements.'),
        },
        ['items'],
      ),
    },
    async summarize(a, ctx) {
      const vendor = a.vendorId
        ? await vendorLabel(ctx, a.vendorId)
        : a.newVendor?.name
          ? `${a.newVendor.name} (new vendor)`
          : null;
      const items = (a.items as any[]).map((i) => {
        const amount = num(i.quantity) * num(i.estimatedRate);
        return { name: i.materialName, qty: String(i.quantity), unit: i.unit, rate: i.estimatedRate != null ? money(num(i.estimatedRate)) : undefined, amount: money(amount) };
      });
      const subtotal = (a.items as any[]).reduce((s, i) => s + num(i.quantity) * num(i.estimatedRate), 0);
      const gstRate = num(a.estimatedGstRate);
      const gst = (subtotal * gstRate) / 100;
      return {
        fields: [
          field('requestType', a.requestType ?? 'MATERIAL'),
          ...maybe('vendor', vendor),
          ...maybe('serviceCategory', a.serviceCategory),
          ...maybe('servicePeriod', a.servicePeriodStart || a.servicePeriodEnd ? `${a.servicePeriodStart ?? '…'} → ${a.servicePeriodEnd ?? '…'}` : null),
          ...maybe('requiredBy', a.requiredBy),
          ...maybe('priority', a.priority),
          ...maybe('department', a.department),
          ...maybe('description', a.description),
          ...maybe('technicalRequirements', a.technicalRequirements),
          ...maybe('deliveryAddress', a.deliveryAddress),
          ...maybe('contactPerson', a.contactPerson),
          ...maybe('contactNumber', a.contactNumber),
        ],
        items,
        totals: [field('subtotal', money(subtotal)), ...(gstRate ? [field('gst', `${gstRate}% · ${money(gst)}`)] : []), field('total', money(subtotal + gst))],
      };
    },
  },

  // ── Quotation ──
  {
    kind: 'write',
    schema: createQuotationSchema,
    path: '/quotations',
    model: 'Quotation',
    needsAck: true,
    labelFields: ['quotationNumber'],
    declaration: {
      name: 'create_quotation',
      description:
        'Propose recording a vendor quotation (rates quoted by a vendor). If it answers a Material Purchase Request, pass mprId — that MPR must be APPROVED. Needs vendorId and the priced items.',
      parameters: O(
        {
          vendorId: S('Vendor uuid.'),
          mprId: S('Material request uuid this quotation answers (optional).'),
          items: A(
            lineItemMaterial({
              unitPrice: N('Quoted rate per unit in rupees (excl. GST).'),
              gstRate: N('GST % on this line (e.g. 18). 0 if none/unknown.'),
            }),
            'Quoted line items.',
          ),
          notes: S('Notes.'),
        },
        ['vendorId', 'items'],
      ),
    },
    async summarize(a, ctx) {
      const vendor = await vendorLabel(ctx, a.vendorId);
      let mprLabel: string | undefined;
      if (a.mprId) {
        const mpr = await lookup(ctx, '/material-purchase-requests', a.mprId, 'Material request');
        if (!['APPROVED', 'QUOTATIONS_RECEIVED'].includes(mpr.status)) {
          throw new ToolError(`Material request ${mpr.mprNumber} is ${mpr.status}; a quotation can only be raised against an APPROVED request. Tell the user.`);
        }
        mprLabel = mpr.mprNumber;
      }
      let subtotal = 0;
      let gst = 0;
      const items = (a.items as any[]).map((i) => {
        const base = num(i.quantity) * num(i.unitPrice);
        subtotal += base;
        gst += (base * num(i.gstRate)) / 100;
        return { name: i.materialName, qty: String(i.quantity), unit: i.unit, rate: money(num(i.unitPrice)), amount: money(base) };
      });
      return {
        fields: [field('vendor', vendor), ...maybe('mpr', mprLabel), ...maybe('notes', a.notes)],
        items,
        totals: [field('subtotal', money(subtotal)), field('gst', money(gst)), field('total', money(subtotal + gst))],
      };
    },
  },

  // ── Purchase order ──
  {
    kind: 'write',
    schema: createPOSchema,
    path: '/purchase-orders',
    model: 'PurchaseOrder',
    needsAck: true,
    labelFields: ['poNumber'],
    declaration: {
      name: 'create_purchase_order',
      description:
        'Propose a Purchase Order. For a regular VENDOR it is raised from a quotation (quotationId); for a NON_VENDOR supplier from an approved MPR (mprId). The PO then goes through the normal approval flow in the app.',
      parameters: O(
        {
          vendorId: S('Vendor uuid.'),
          quotationId: S('Quotation uuid (regular vendors).'),
          mprId: S('Material request uuid (non-vendor suppliers).'),
          paymentType: E(['ADVANCE', 'AFTER_DELIVERY', 'FULL_PAYMENT'], 'When the vendor is paid.'),
          advanceAmount: N('Advance in rupees. Required for ADVANCE / FULL_PAYMENT; omit for AFTER_DELIVERY.'),
          paymentTerms: S('Payment terms text.'),
          deliveryDate: S('Expected delivery date, YYYY-MM-DD.'),
          budgetHeadId: S('Budget head uuid (optional).'),
          notes: S('Notes.'),
        },
        ['vendorId', 'paymentType'],
      ),
    },
    async summarize(a, ctx) {
      const vendor = await vendorLabel(ctx, a.vendorId);
      const fields = [field('vendor', vendor)];
      const totals: { key: string; value: string }[] = [];
      let items: SummaryItem[] | undefined;
      if (a.quotationId) {
        const q = await lookup(ctx, '/quotations', a.quotationId, 'Quotation');
        fields.push(field('quotation', q.quotationNumber));
        if (q.grandTotal != null) totals.push(field('total', money(num(q.grandTotal))));
        if (Array.isArray(q.items)) {
          items = q.items.map((i: any) => ({ name: i.materialName, qty: String(num(i.quantity)), unit: i.unit ?? undefined, rate: money(num(i.unitPrice)) }));
        }
      }
      if (a.mprId) {
        const m = await lookup(ctx, '/material-purchase-requests', a.mprId, 'Material request');
        fields.push(field('mpr', m.mprNumber));
      }
      fields.push(field('paymentType', a.paymentType), ...maybe('advance', a.advanceAmount != null ? money(num(a.advanceAmount)) : undefined), ...maybe('deliveryDate', a.deliveryDate), ...maybe('paymentTerms', a.paymentTerms), ...maybe('notes', a.notes));
      return { fields, items, totals };
    },
  },

  // ── Goods receipt ──
  {
    kind: 'write',
    schema: createGoodsReceiptSchema,
    path: '/goods-receipts',
    model: 'GoodsReceipt',
    needsAck: false,
    labelFields: ['receiptNumber'],
    declaration: {
      name: 'create_goods_receipt',
      description:
        'Propose recording goods received against an APPROVED (or partially delivered) purchase order. It starts as pending inspection; accept/reject quantities are decided later in the app.',
      parameters: O(
        {
          poId: S('Purchase order uuid.'),
          gatePassId: S('Approved gate pass uuid (optional).'),
          items: A(
            O({ materialName: S('Material name exactly as on the PO.'), deliveredQty: N('Quantity delivered.'), unit: S('Unit.') }, ['materialName', 'deliveredQty']),
            'Delivered items.',
          ),
        },
        ['poId', 'items'],
      ),
    },
    async summarize(a, ctx) {
      const po = await lookup(ctx, '/purchase-orders', a.poId, 'Purchase order');
      if (!['APPROVED', 'PARTIALLY_DELIVERED'].includes(po.status)) {
        throw new ToolError(`PO ${po.poNumber} is ${po.status}; goods can only be received against an APPROVED purchase order. Tell the user.`);
      }
      return {
        fields: [field('po', po.poNumber), ...maybe('vendor', po.vendor?.name)],
        items: (a.items as any[]).map((i) => ({ name: i.materialName, qty: String(i.deliveredQty), unit: i.unit })),
      };
    },
  },

  // ── Invoice ──
  {
    kind: 'write',
    schema: createInvoiceSchema,
    path: '/invoices',
    model: 'VendorInvoice',
    needsAck: true,
    labelFields: ['invoiceCode', 'invoiceNumber'],
    declaration: {
      name: 'create_invoice',
      description:
        "Propose recording a vendor's invoice/bill. totalAmount must equal amount + taxAmount. Link it to a PO (poId) when the invoice is for a purchase order; the PO must be APPROVED or delivered.",
      parameters: O(
        {
          vendorId: S('Vendor uuid.'),
          poId: S('Purchase order uuid (optional).'),
          invoiceNumber: S("The vendor's own invoice number."),
          amount: N('Taxable amount in rupees (before tax).'),
          taxAmount: N('GST / tax amount in rupees. 0 if none.'),
          totalAmount: N('Invoice total = amount + taxAmount.'),
          advancePaid: N('Advance already paid against this invoice, if any.'),
          deliveryDate: S('Delivery date, YYYY-MM-DD.'),
        },
        ['vendorId', 'amount', 'totalAmount'],
      ),
    },
    async summarize(a, ctx) {
      const vendor = await vendorLabel(ctx, a.vendorId);
      let poLabel: string | undefined;
      if (a.poId) poLabel = (await lookup(ctx, '/purchase-orders', a.poId, 'Purchase order')).poNumber;
      return {
        fields: [field('vendor', vendor), ...maybe('po', poLabel), ...maybe('invoiceNumber', a.invoiceNumber), ...maybe('deliveryDate', a.deliveryDate), ...maybe('advance', a.advancePaid != null && num(a.advancePaid) > 0 ? money(num(a.advancePaid)) : undefined)],
        totals: [field('amount', money(num(a.amount))), field('tax', money(num(a.taxAmount))), field('total', money(num(a.totalAmount)))],
      };
    },
  },

  // ── Stock entry ──
  {
    kind: 'write',
    schema: createStockEntrySchema,
    path: '/stock-entries',
    model: 'StockEntry',
    needsAck: false,
    labelFields: ['entryNumber'],
    declaration: {
      name: 'create_stock_entry',
      description:
        'Propose a direct stock entry (stock that arrives without a PO: opening stock, cash purchase, owner free issue, transfer from another project, site return). It then waits for approval in the app.',
      parameters: O(
        {
          sourceType: E(['OPENING_STOCK', 'CASH_PURCHASE', 'OWNER_FREE_ISSUE', 'PROJECT_TRANSFER', 'SITE_RETURN'], 'Where the stock came from.'),
          entryDate: S('Date, YYYY-MM-DD (default today).'),
          supplierName: S('Shop / owner / other project it came from.'),
          referenceNo: S('Bill / challan / transfer number.'),
          notes: S('Notes.'),
          items: A(
            O(
              {
                materialName: S('Material name in English.'),
                unit: S('Unit (required): Bags, Nos, Kg...'),
                quantity: N('Quantity.'),
                unitCost: N('Cost per unit in rupees (0 if free issue/unknown).'),
                itemType: E(['CONSUMABLE', 'ASSET'], 'ASSET = tracked equipment (whole-number qty). Default CONSUMABLE.'),
                category: S('Category.'),
              },
              ['materialName', 'unit', 'quantity'],
            ),
            'Stock lines.',
          ),
        },
        ['sourceType', 'items'],
      ),
    },
    async summarize(a) {
      let total = 0;
      const items = (a.items as any[]).map((i) => {
        const amount = num(i.quantity) * num(i.unitCost);
        total += amount;
        return { name: i.materialName, qty: String(i.quantity), unit: i.unit, rate: money(num(i.unitCost)), amount: money(amount) };
      });
      return {
        fields: [field('sourceType', a.sourceType), ...maybe('supplier', a.supplierName), ...maybe('reference', a.referenceNo), ...maybe('date', a.entryDate), ...maybe('notes', a.notes)],
        items,
        totals: [field('total', money(total))],
      };
    },
  },
];

export const TOOLS: Tool[] = [...readTools, ...writeTools];
export const TOOLS_BY_NAME: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.declaration.name, t]));
export const DECLARATIONS: FunctionDeclaration[] = TOOLS.map((t) => t.declaration);

/** Name shown for a created record, from the API response. */
export function labelOfCreated(tool: WriteTool, body: any): string {
  const rec = unwrap(body) ?? {};
  for (const f of tool.labelFields) if (rec[f]) return String(rec[f]);
  return tool.model;
}

export function createdRecordLink(tool: WriteTool, body: any): string | null {
  const rec = unwrap(body) ?? {};
  const reg = REGISTRY[tool.model];
  try {
    return rec.id && reg?.path ? reg.path(String(rec.id), rec) : null;
  } catch {
    return null;
  }
}
