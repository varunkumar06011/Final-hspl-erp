/**
 * The assistant's tool registry — the ONLY things the AI can do.
 *
 * Read tools call existing GET endpoints, or the guarded data query
 * (/data-query: read-only, project-pinned, secrets stripped, enforced again by
 * the database role miko_reader).
 *
 * Write tools never execute on their own. A write tool validates the arguments,
 * resolves human labels (vendor name, PO number...) through the API, and returns
 * a *proposal* that the user must confirm in the UI; the confirmed action is
 * replayed through the app's own endpoint, so permissions, approval rules and
 * audit apply exactly as in the app. Create tools add records; action tools
 * (approve, reject, finalize, submit, pay, cancel, change payment type / budget
 * head) act on an existing one. Actions that move money or cancel also need the
 * user's login PIN on confirm (`needsPin`).
 *
 * There is deliberately no tool that deletes, edits line items or posts
 * vouchers. Adding one is a code change here, not something the model can talk
 * its way into.
 */
import { z, type ZodTypeAny } from 'zod';
import {
  createVendorSchema,
  createMPRSchema,
  createQuotationSchema,
  createPOSchema,
  createGoodsReceiptSchema,
  createInvoiceSchema,
  createStockEntrySchema,
  createSiteBillSchema,
  SITE_BILL_LIMIT,
} from '@hospital-erp/shared';
import { callApi, apiErrorMessage } from './internalApi';
import { REGISTRY } from '../search/registry';
import type { FunctionDeclaration } from './openai';
import { FLOW_IDS } from './flows';

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

// ─── JSON-schema helpers (upper-case type names; lower-cased for OpenAI in openai.ts) ───────────────
const S = (description: string) => ({ type: 'STRING', description });
const N = (description: string) => ({ type: 'NUMBER', description });
const E = (values: string[], description: string) => ({ type: 'STRING', enum: values, description });
const O = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'OBJECT',
  properties,
  required,
});
const A = (items: unknown, description: string) => ({ type: 'ARRAY', items, description });
const B = (description: string) => ({ type: 'BOOLEAN', description });

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
  gate_passes: { path: '/gate-passes', model: 'GatePass', columns: ['passNumber', 'purchaseOrder.poNumber', 'status', 'date'], clientFilter: true },
  goods_receipts: { path: '/goods-receipts', model: 'GoodsReceipt', columns: ['receiptNumber', 'purchaseOrder.poNumber', 'status', 'createdAt'], clientFilter: true },
  stock_entries: { path: '/stock-entries', model: 'StockEntry', columns: ['entryNumber', 'sourceType', 'supplierName', 'status', 'entryDate'], clientFilter: true },
  inventory_items: { path: '/inventory/items', model: 'InventoryItem', columns: ['name', 'sku', 'category', 'currentStock', 'unit'] },
  budget_heads: { path: '/budget-heads', model: 'BudgetHead', columns: ['slNo', 'particulars', 'allocatedAmount', 'status'] },
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
  /** create = adds a record; action = acts on an existing one (approve, pay...). */
  verb?: 'create' | 'action';
  declaration: FunctionDeclaration;
  /** Shared Zod request schema ({ body }). */
  schema: ZodTypeAny;
  /** App endpoint the confirmed action is POSTed to (under /api). */
  path: string | ((args: Record<string, any>) => string);
  /** Request body built from the stored arguments (default: the arguments as they are). */
  body?: (args: Record<string, any>) => Record<string, unknown>;
  /** Confirming needs the user's 4-digit login PIN (money moves or a record is cancelled). */
  needsPin?: boolean;
  /** Search-registry model of the created record, for the result link. */
  model: string;
  /** The endpoint requires an `acknowledged: true` flag — supplied on user confirm. */
  needsAck: boolean;
  /** Fields of the created record to build its label from, first present wins. */
  labelFields: string[];
  /** Resolve labels + compute totals for the confirmation card. Throws ToolError on bad references. */
  summarize(args: Record<string, any>, ctx: ToolContext): Promise<ActionSummary>;
  /**
   * The endpoint takes multipart/form-data with the document as `file` (the first attached
   * photo/PDF); a proposal without an attached document is refused.
   */
  fileField?: string;
  /** Attachment.entityType the attached photos are saved under after create (none = not attached). */
  attachAs?: string;
  /** Page of the created record, when the search registry's link is not the right one. */
  link?: (record: Record<string, unknown>) => string | null;
}

/** A question with tap-able answers shown to the user; ends the turn. */
export interface AskTool {
  kind: 'ask';
  declaration: FunctionDeclaration;
}

export type Tool = ReadTool | WriteTool | AskTool;

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
  {
    kind: 'read',
    declaration: {
      name: 'describe_data',
      description:
        'List the database tables this user may ask about (no arguments), or the columns and relations of one table (model). Call it before query_data when you are not sure of a table or column name.',
      parameters: O({ model: S('Table (model) name, e.g. PurchaseOrder, POItem, VendorInvoice, BudgetHead, InventoryItem, BankAccount.') }),
    },
    async run(args, ctx) {
      const res = await callApi(ctx.auth, 'GET', '/data-query/tables', { query: args.model ? { model: String(args.model) } : {} });
      if (!res.ok) throw new ToolError(apiErrorMessage(res));
      return { result: capped(res.body) };
    },
  },
  {
    kind: 'read',
    declaration: {
      name: 'query_data',
      description:
        'Answer data questions from ANY table the user may read (read-only; the current project only): lists with filters, totals (sum / average / min / max / count), and groups (e.g. spend per vendor). Use it for "how much", "how many", "which", "top", "compare", trends by period. Column names come from describe_data. Filters may go one hop through a related record ("vendor.name"). Prefer one well-aimed query over many.',
      parameters: O(
        {
          model: S('Table (model) name, e.g. PurchaseOrder.'),
          filters: A(
            O(
              {
                field: S('Column, or relation.column one hop away (e.g. status, grandTotal, vendor.name, budgetHead.particulars).'),
                op: E(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'in', 'notIn', 'isNull', 'notNull'], 'Comparison. Text eq/contains ignore case.'),
                value: S('Value (numbers as digits, dates YYYY-MM-DD, enums in CAPITALS as stored).'),
                values: A(S('One value.'), 'Values for in / notIn.'),
              },
              ['field', 'op'],
            ),
            'Conditions, all must hold.',
          ),
          period: O(
            {
              field: S('Date column, e.g. createdAt, date, invoiceDate.'),
              range: E(['today', 'yesterday', 'this_week', 'last_7_days', 'this_month', 'last_month', 'last_30_days', 'this_quarter', 'this_year', 'last_year'], 'Period by the Indian calendar.'),
            },
            ['field', 'range'],
          ),
          fields: A(S('Column or relation.column.'), 'Columns to return for lists (default: the main columns).'),
          include: A(S('Line list name, e.g. items.'), 'Child lines to return with each row (max 20 each).'),
          orderBy: O({ field: S('Column or relation.column.'), dir: E(['asc', 'desc'], 'Default desc.') }, ['field']),
          limit: N('Rows or groups to return (default 20, max 50).'),
          aggregate: O(
            {
              count: B('Count matching rows (default true when aggregating).'),
              sum: A(S('Number column.'), 'Columns to add up.'),
              avg: A(S('Number column.'), 'Columns to average.'),
              min: A(S('Number or date column.'), 'Columns to take the minimum of.'),
              max: A(S('Number or date column.'), 'Columns to take the maximum of.'),
            },
          ),
          groupBy: A(S("This table's own column, e.g. vendorId, status, budgetHeadId."), 'Group the totals by these columns (max 2). Groups by an id are named automatically (vendorIdLabel).'),
          includeDeleted: B('Include deleted records (default false).'),
        },
        ['model'],
      ),
    },
    async run(args, ctx) {
      const res = await callApi(ctx.auth, 'POST', '/data-query', { body: args });
      if (!res.ok) throw new ToolError(apiErrorMessage(res));
      const body = res.body ?? {};
      return { result: capped(body), table: queryTable(body) };
    },
  },
  {
    kind: 'read',
    declaration: {
      name: 'my_tasks',
      description:
        "What is waiting on this user right now (My Work): approvals, quotations to finalize, drafts to submit, goods to receive or inspect, records sent back to fix, and what they started that is still waiting on others. Use it for \"what do I need to do\", \"pending approvals\", a daily brief.",
      parameters: O({}),
    },
    async run(_args, ctx) {
      const res = await callApi(ctx.auth, 'GET', '/my-work');
      if (!res.ok) throw new ToolError(apiErrorMessage(res));
      const work = res.body ?? {};
      const items = (list: any[] = []) =>
        list.slice(0, 25).map((w) => ({
          kind: w.kind,
          id: w.id,
          number: w.number,
          party: w.party,
          amount: w.amount,
          summary: w.summary,
          why: w.why,
          status: w.status,
          action: w.action,
          waitingOn: w.waitingOn,
          waitingSince: w.waitingSince,
          flags: (w.flags ?? []).map((f: any) => (f.value != null ? `${f.code}:${f.value}` : f.code)),
        }));
      const needs = (work.needsAction ?? []) as any[];
      const table: ListTable = {
        entity: 'my_tasks',
        columns: ['number', 'kind', 'party', 'amount', 'action'],
        total: needs.length,
        rows: needs.slice(0, 25).map((w) => ({
          id: String(w.id),
          link: typeof w.path === 'string' ? w.path : null,
          values: { number: w.number, kind: w.kind, party: w.party, amount: w.amount, action: w.action },
        })),
      };
      return {
        table,
        result: capped({
          needsAction: items(work.needsAction),
          drafts: items(work.drafts),
          sentBack: items(work.sentBack),
          waitingOnOthers: items(work.waiting),
        }),
      };
    },
  },
];

/** A table for the chat UI from a data-query answer (rows or groups). */
function queryTable(body: any): ListTable | undefined {
  const model = String(body?.model ?? '');
  if (Array.isArray(body?.groups)) {
    const rows = body.groups as Record<string, any>[];
    const flat = rows.map((g) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(g)) {
        if (v && typeof v === 'object') for (const [ik, iv] of Object.entries(v)) out[ik === '_all' ? k : `${k}.${ik}`] = iv;
        else out[k] = v;
      }
      return out;
    });
    const columns = [...new Set(flat.flatMap((r) => Object.keys(r)))]
      .filter((c) => !(c.endsWith('Id') && flat.some((r) => r[`${c}Label`] != null)))
      .slice(0, 8);
    return { entity: model, columns, total: rows.length, rows: flat.map((values, i) => ({ id: String(i), link: null, values })) };
  }
  if (!Array.isArray(body?.rows)) return undefined;
  const rows = body.rows as Record<string, any>[];
  const flat = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (Array.isArray(v)) out[k] = v.length;
      else if (v && typeof v === 'object') for (const [ik, iv] of Object.entries(v)) { if (ik !== 'id') out[`${k}.${ik}`] = iv; }
      else out[k] = v;
    }
    return out;
  });
  const columns = [...new Set(flat.flatMap((r) => Object.keys(r)))].filter((c) => c !== 'id' && !/Id$/.test(c)).slice(0, 7);
  const reg = REGISTRY[model];
  return {
    entity: model,
    columns,
    total: Number(body.total ?? rows.length),
    rows: flat.map((values, i) => {
      let link: string | null = null;
      try {
        link = reg?.path && rows[i].id ? reg.path(String(rows[i].id), rows[i]) : null;
      } catch {
        link = null;
      }
      return { id: String(rows[i].id ?? i), link, values };
    }),
  };
}

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
    attachAs: 'VENDOR',
    model: 'Vendor',
    needsAck: false,
    labelFields: ['name'],
    declaration: {
      name: 'create_vendor',
      description:
        'Propose creating a new vendor/supplier: when the user asked for one, or a quotation / invoice / PO needs a vendor that does not exist yet (check list_records vendors first). The user must confirm before it is saved.',
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
    attachAs: 'MATERIAL_PURCHASE_REQUEST',
    model: 'MaterialPurchaseRequest',
    needsAck: false,
    labelFields: ['mprNumber'],
    declaration: {
      name: 'create_mpr',
      description:
        'Propose a Material Purchase Request (requestType MATERIAL) or a Service Request (requestType SERVICE) for a vendor. It is saved as a DRAFT; the user submits it for approval in the app. Needs the vendor (existing vendorId; if no vendor matches, newVendor, which is created together with the request) and at least one item with a quantity. For SERVICE, each item is a service/work line (materialName = what work, e.g. "AC servicing", quantity = hours/days/visits/jobs, unit from the service units).',
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
    attachAs: 'QUOTATION',
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
    attachAs: 'PURCHASE_ORDER',
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
    attachAs: 'GOODS_RECEIPT',
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
          gatePassId: S('Approved gate pass uuid of this delivery. Mandatory; the gate pass must already have its photo.'),
          items: A(
            O({ materialName: S('Material name exactly as on the PO.'), deliveredQty: N('Quantity delivered.'), unit: S('Unit.') }, ['materialName', 'deliveredQty']),
            'Delivered items.',
          ),
        },
        ['poId', 'gatePassId', 'items'],
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
    attachAs: 'VENDOR_INVOICE',
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
    attachAs: 'STOCK_ENTRY',
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

  // ── Site bill ──
  {
    kind: 'write',
    schema: createSiteBillSchema,
    path: '/site-bills',
    model: 'MaterialPurchaseRequest',
    needsAck: false,
    labelFields: ['mprNumber'],
    fileField: 'file',
    attachAs: 'MATERIAL_PURCHASE_REQUEST',
    link: () => '/site-bills',
    declaration: {
      name: 'create_site_bill',
      description: `Propose recording a small bill already paid at site (total up to ₹${SITE_BILL_LIMIT}). A photo or PDF of the bill is optional (e.g. an auto fare has no bill); if one is attached in this conversation it is saved with the bill. Several site bills are later combined into one reimbursement PO in the app. A bill above ₹${SITE_BILL_LIMIT} is turned into a material request automatically; still call this tool for it. Never ask how it was paid.`,
      parameters: O(
        {
          shopName: S('Shop / seller name from the bill. If the user gives none, use a short group name for what was bought (e.g. "Electrical" for MCB and cables, "Local transport (auto)" for an auto fare).'),
          billDate: S('Bill date, YYYY-MM-DD.'),
          description: S('What it was bought for (optional).'),
          budgetHeadId: S('Budget head uuid (optional). Only when the user names one; find it with list_records on budget_heads. Never ask for it.'),
          items: A(
            O({ materialName: S('Item name in English.'), quantity: N('Quantity.'), unit: S('Unit as on the bill.'), rate: N('Rate per unit in rupees, GST included as charged.') }, ['materialName', 'quantity', 'rate']),
            'Bill lines.',
          ),
        },
        ['shopName', 'billDate', 'items'],
      ),
    },
    async summarize(a, ctx) {
      let total = 0;
      const items = (a.items as any[]).map((i) => {
        const amount = num(i.quantity) * num(i.rate);
        total += amount;
        return { name: i.materialName, qty: String(i.quantity), unit: i.unit, rate: money(num(i.rate)), amount: money(amount) };
      });
      if (total > SITE_BILL_LIMIT) {
        throw new ToolError(`The bill total ${money(total)} is above the site-bill limit of ${money(SITE_BILL_LIMIT)}. Save it as a material request instead.`);
      }
      const head = a.budgetHeadId ? await lookup(ctx, '/budget-heads', String(a.budgetHeadId), 'Budget head') : null;
      return {
        fields: [field('shop', a.shopName), field('date', a.billDate), ...maybe('budgetHead', head?.particulars), ...maybe('description', a.description)],
        items,
        totals: [field('total', money(total))],
      };
    },
  },
];

// ─── action tools (act on an existing record; proposal + confirm) ───────────
interface RecordKind {
  path: string;
  what: string;
  model: string;
  label: (r: any) => string;
  amount?: (r: any) => unknown;
}
const RECORDS: Record<string, RecordKind> = {
  mpr: { path: '/material-purchase-requests', what: 'Material request', model: 'MaterialPurchaseRequest', label: (r) => r.mprNumber, amount: (r) => r.estimatedTotal },
  quotation: { path: '/quotations', what: 'Quotation', model: 'Quotation', label: (r) => r.quotationNumber, amount: (r) => r.grandTotal },
  po: { path: '/purchase-orders', what: 'Purchase order', model: 'PurchaseOrder', label: (r) => r.poNumber, amount: (r) => r.grandTotal },
  invoice: { path: '/invoices', what: 'Invoice', model: 'VendorInvoice', label: (r) => r.invoiceCode ?? r.invoiceNumber, amount: (r) => r.totalAmount },
  payment: { path: '/payments', what: 'Payment request', model: 'PaymentRequest', label: (r) => r.paymentCode ?? r.requestNumber, amount: (r) => r.amount },
  gatePass: { path: '/gate-passes', what: 'Gate pass', model: 'GatePass', label: (r) => r.passNumber },
  stockEntry: { path: '/stock-entries', what: 'Stock entry', model: 'StockEntry', label: (r) => r.entryNumber },
};

const ack = { acknowledged: true };
const reasonParam = S('Reason, in the user\'s words (translated to English when they spoke Telugu).');
const commentsParam = S('Comments for the record (optional).');

interface ActionSpec {
  name: string;
  description: string;
  record: keyof typeof RECORDS;
  endpoint: string;
  /** Statuses the record must be in; anything else is refused before a card is shown. */
  statuses?: string[];
  /** Extra parameters besides `id`. */
  params?: Record<string, unknown>;
  required?: string[];
  schema?: Record<string, ZodTypeAny>;
  body: (a: Record<string, any>) => Record<string, unknown>;
  needsPin?: boolean;
  extraFields?: (a: Record<string, any>, record: any, ctx: ToolContext) => Promise<{ key: string; value: string }[]>;
}

function actionTool(spec: ActionSpec): WriteTool {
  const kind = RECORDS[spec.record];
  return {
    kind: 'write',
    verb: 'action',
    schema: z.object({ body: z.object({ id: z.string().uuid(), ...(spec.schema ?? {}) }).passthrough() }),
    path: (a) => `${kind.path}/${a.id}/${spec.endpoint}`,
    body: spec.body,
    needsPin: spec.needsPin,
    model: kind.model,
    needsAck: false,
    labelFields: [],
    declaration: {
      name: spec.name,
      description: `${spec.description} The user sees a card and must confirm${spec.needsPin ? ' with their login PIN' : ''}; nothing happens before that.`,
      parameters: O({ id: S(`${kind.what} uuid (find it with list_records, query_data or my_tasks).`), ...(spec.params ?? {}) }, ['id', ...(spec.required ?? [])]),
    },
    async summarize(a, ctx) {
      const r = await lookup(ctx, kind.path, a.id, kind.what);
      if (spec.statuses && !spec.statuses.includes(r.status)) {
        throw new ToolError(`${kind.what} ${kind.label(r)} is ${r.status}; this can only be done when it is ${spec.statuses.join(' or ')}. Tell the user.`);
      }
      const amount = kind.amount?.(r);
      const fields = [
        field('record', `${kind.what} ${kind.label(r) ?? ''}`.trim()),
        ...maybe('vendor', r.vendor?.name),
        ...maybe('status', r.status),
        ...maybe('description', typeof r.description === 'string' ? r.description.slice(0, 200) : undefined),
        ...(spec.extraFields ? await spec.extraFields(a, r, ctx) : []),
        ...maybe('reason', a.reason),
        ...maybe('comments', a.comments),
      ];
      return { fields, totals: amount != null && amount !== '' ? [field('total', money(num(amount)))] : [] };
    },
  };
}

const actionTools: WriteTool[] = [
  actionTool({
    name: 'submit_mpr',
    description: 'Submit a DRAFT material / service request for approval.',
    record: 'mpr',
    endpoint: 'submit',
    statuses: ['DRAFT', 'REJECTED'],
    body: () => ({}),
  }),
  actionTool({
    name: 'approve_mpr',
    description: 'Approve a material / service request that is waiting on this user (status SUBMITTED).',
    record: 'mpr',
    endpoint: 'approve',
    statuses: ['SUBMITTED'],
    params: { comments: commentsParam },
    body: (a) => ({ comments: a.comments, ...ack }),
  }),
  actionTool({
    name: 'reject_mpr',
    description: 'Reject a material / service request (status SUBMITTED). Needs a reason.',
    record: 'mpr',
    endpoint: 'reject',
    statuses: ['SUBMITTED'],
    params: { reason: reasonParam },
    required: ['reason'],
    schema: { reason: z.string().trim().min(1).max(500) },
    body: (a) => ({ reason: a.reason, comments: a.reason, ...ack }),
  }),
  actionTool({
    name: 'cancel_mpr',
    description: 'Cancel a material / service request that is no longer needed.',
    record: 'mpr',
    endpoint: 'cancel',
    params: { reason: reasonParam },
    body: (a) => ({ reason: a.reason }),
    needsPin: true,
  }),
  actionTool({
    name: 'finalize_quotation',
    description: 'Finalize (select) a quotation that is waiting to be finalized (status SUBMITTED): it becomes approved and its purchase order is raised automatically.',
    record: 'quotation',
    endpoint: 'finalize',
    statuses: ['SUBMITTED', 'UNDER_REVIEW'],
    params: { comments: commentsParam },
    body: (a) => ({ comments: a.comments }),
  }),
  actionTool({
    name: 'reject_quotation',
    description: 'Close a waiting quotation as not selected. Needs a reason.',
    record: 'quotation',
    endpoint: 'reject',
    statuses: ['SUBMITTED', 'UNDER_REVIEW', 'DRAFT'],
    params: { reason: reasonParam },
    required: ['reason'],
    schema: { reason: z.string().trim().min(1).max(500) },
    body: (a) => ({ reason: a.reason, ...ack }),
  }),
  actionTool({
    name: 'approve_po',
    description: 'Approve a purchase order waiting on this user (status PENDING_APPROVAL). If approving pushes its budget head over the allocation, a reason is required in comments.',
    record: 'po',
    endpoint: 'approve',
    statuses: ['PENDING_APPROVAL'],
    params: { comments: S('Comments; required as the override reason when the budget head would be exceeded.') },
    body: (a) => ({ comments: a.comments, ...ack }),
    extraFields: async (_a, r) => [...maybe('paymentType', r.paymentType), ...maybe('budgetHead', r.budgetHead?.particulars)],
  }),
  actionTool({
    name: 'reject_po',
    description: 'Reject a purchase order (status PENDING_APPROVAL). Needs a reason.',
    record: 'po',
    endpoint: 'reject',
    statuses: ['PENDING_APPROVAL'],
    params: { reason: reasonParam },
    required: ['reason'],
    schema: { reason: z.string().trim().min(1).max(500) },
    body: (a) => ({ reason: a.reason, comments: a.reason, ...ack }),
  }),
  actionTool({
    name: 'change_po_payment_type',
    description: 'Change how a purchase order is paid (ADVANCE / AFTER_DELIVERY / FULL_PAYMENT). Allowed while pending and after approval; never sends it back for approval.',
    record: 'po',
    endpoint: 'change-payment-type',
    params: {
      paymentType: E(['ADVANCE', 'AFTER_DELIVERY', 'FULL_PAYMENT'], 'New payment type.'),
      advanceAmount: N('Advance in rupees (ADVANCE / FULL_PAYMENT).'),
      reason: reasonParam,
    },
    required: ['paymentType'],
    schema: { paymentType: z.enum(['ADVANCE', 'AFTER_DELIVERY', 'FULL_PAYMENT']), advanceAmount: z.number().nonnegative().optional() },
    body: (a) => ({ paymentType: a.paymentType, advanceAmount: a.advanceAmount, reason: a.reason }),
    extraFields: async (a) => [field('paymentType', a.paymentType), ...maybe('advance', a.advanceAmount != null ? money(num(a.advanceAmount)) : undefined)],
  }),
  actionTool({
    name: 'change_po_budget_head',
    description: 'Set or change the budget head of a purchase order (find the head with list_records budget_heads). Never sends it back for approval.',
    record: 'po',
    endpoint: 'change-budget-head',
    params: { budgetHeadId: S('Budget head uuid.'), reason: reasonParam },
    required: ['budgetHeadId'],
    schema: { budgetHeadId: z.string().uuid() },
    body: (a) => ({ budgetHeadId: a.budgetHeadId, reason: a.reason }),
    extraFields: async (a, _r, ctx) => [field('budgetHead', (await lookup(ctx, '/budget-heads', a.budgetHeadId, 'Budget head')).particulars)],
  }),
  actionTool({
    name: 'approve_invoice',
    description: 'Approve (verify) a vendor invoice waiting on this user.',
    record: 'invoice',
    endpoint: 'approve',
    params: { comments: commentsParam },
    body: (a) => ({ comments: a.comments, ...ack }),
  }),
  actionTool({
    name: 'reject_invoice',
    description: 'Reject a vendor invoice. Needs a reason.',
    record: 'invoice',
    endpoint: 'reject',
    params: { reason: reasonParam },
    required: ['reason'],
    schema: { reason: z.string().trim().min(1).max(500) },
    body: (a) => ({ reason: a.reason, comments: a.reason, ...ack }),
  }),
  actionTool({
    name: 'approve_payment',
    description: 'Approve a payment request waiting on this user (status PENDING).',
    record: 'payment',
    endpoint: 'approve',
    statuses: ['PENDING', 'PENDING_APPROVAL'],
    params: { comments: commentsParam },
    body: (a) => ({ comments: a.comments, ...ack }),
    needsPin: true,
  }),
  actionTool({
    name: 'reject_payment',
    description: 'Reject a payment request. Needs a reason.',
    record: 'payment',
    endpoint: 'reject',
    params: { reason: reasonParam },
    required: ['reason'],
    schema: { reason: z.string().trim().min(1).max(500) },
    body: (a) => ({ reason: a.reason, comments: a.reason, ...ack }),
  }),
  actionTool({
    name: 'record_payment',
    description:
      'Record that an APPROVED payment request was paid, from a bank account or a cash account (find them with query_data on BankAccount / CashAccount). The amount must equal the request amount.',
    record: 'payment',
    endpoint: 'pay',
    statuses: ['APPROVED'],
    params: {
      amount: N('Amount paid in rupees (the full request amount).'),
      mode: E(['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'DD'], 'How it was paid (NEFT / RTGS / IMPS = BANK_TRANSFER).'),
      reference: S('UTR / cheque / transaction reference.'),
      bankAccountId: S('Bank account uuid it was paid from.'),
      cashAccountId: S('Cash account uuid it was paid from (cash payments).'),
    },
    required: ['amount', 'mode'],
    schema: {
      amount: z.number().positive(),
      mode: z.enum(['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'DD']),
      reference: z.string().max(100).optional(),
      bankAccountId: z.string().uuid().optional(),
      cashAccountId: z.string().uuid().optional(),
    },
    body: (a) => ({ amount: a.amount, mode: a.mode, reference: a.reference, bankAccountId: a.bankAccountId, cashAccountId: a.cashAccountId }),
    needsPin: true,
    extraFields: async (a, r) => {
      if (!a.bankAccountId && !a.cashAccountId) throw new ToolError('Ask which bank or cash account it was paid from (query_data on BankAccount / CashAccount).');
      if (num(a.amount) !== num(r.amount)) throw new ToolError(`The payment request is for ${money(num(r.amount))}; the amount paid must be the same.`);
      return [field('mode', a.mode), ...maybe('reference', a.reference), field('amountPaid', money(num(a.amount)))];
    },
  }),
  actionTool({
    name: 'approve_gate_pass',
    description: 'Approve a gate pass (goods at the gate).',
    record: 'gatePass',
    endpoint: 'approve',
    body: () => ({}),
  }),
  actionTool({
    name: 'approve_stock_entry',
    description: 'Approve a direct stock entry (status PENDING_APPROVAL); its stock is then posted.',
    record: 'stockEntry',
    endpoint: 'approve',
    statuses: ['PENDING_APPROVAL'],
    body: () => ({}),
  }),
  actionTool({
    name: 'reject_stock_entry',
    description: 'Reject a direct stock entry (status PENDING_APPROVAL). Needs a reason.',
    record: 'stockEntry',
    endpoint: 'reject',
    statuses: ['PENDING_APPROVAL'],
    params: { reason: reasonParam },
    required: ['reason'],
    schema: { reason: z.string().trim().min(1).max(500) },
    body: (a) => ({ reason: a.reason }),
  }),
];

// ─── ask tool (quick-reply question) ────────────────────────────────────────
export const MAX_ASK_OPTIONS = 10;
const askTool: AskTool = {
  kind: 'ask',
  declaration: {
    name: 'ask_user',
    description:
      'Ask the user ONE short question and show answer buttons they can tap. Use it whenever the answer is a choice: which flow, which vendor / PO / quotation / material request, payment type, GST %, yes / no, skip. The turn ends here and the app shows the question, so do not repeat it in text. Free-text questions (quantities, names) can also go here with no options.',
    parameters: O(
      {
        question: S('The question, short, in the user\'s language.'),
        options: A(
          O({ label: S('Button text, short (e.g. "VGH-PO012 · ABC Traders · ₹50,000", "Yes", "Skip"). Tapping it sends this text as the reply.') }, ['label']),
          `Answer buttons, at most ${MAX_ASK_OPTIONS}. Empty for a free-text answer.`,
        ),
        flow: E(FLOW_IDS, 'The create flow this question belongs to.'),
        askPhoto: B('Show a "Take photo" button (e.g. to scan a bill, challan or quotation).'),
      },
      ['question'],
    ),
  },
};

export const TOOLS: Tool[] = [...readTools, ...writeTools, ...actionTools, askTool];
/** Action tools (act on an existing record), by name. */
export const ACTION_TOOL_NAMES: string[] = actionTools.map((t) => t.declaration.name);
export const TOOLS_BY_NAME: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.declaration.name, t]));
export const DECLARATIONS: FunctionDeclaration[] = TOOLS.map((t) => t.declaration);

/** Name shown for a created record, from the API response. */
export function labelOfCreated(tool: WriteTool, body: any, summary?: ActionSummary): string {
  // An action acts on a record whose name is already on its card ("Purchase order VGH-PO012").
  if (tool.verb === 'action') return summary?.fields.find((f) => f.key === 'record')?.value ?? tool.model;
  const rec = unwrap(body) ?? {};
  for (const f of tool.labelFields) if (rec[f]) return String(rec[f]);
  return tool.model;
}

export function createdRecordLink(tool: WriteTool, body: any, args?: Record<string, any>): string | null {
  const rec = unwrap(body) ?? {};
  const reg = REGISTRY[tool.model];
  try {
    if (tool.verb === 'action') return args?.id && reg?.path ? reg.path(String(args.id), rec) : null;
    if (tool.link) return tool.link(rec);
    return rec.id && reg?.path ? reg.path(String(rec.id), rec) : null;
  } catch {
    return null;
  }
}
