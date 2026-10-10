/**
 * Guided "create" flows: what Miko offers on its start menu, who may start each
 * one, and the short script it follows (only the questions a record cannot be
 * saved without; everything else is read from a photo or left blank).
 *
 * A flow is only a conversation guide. The record is still created by the
 * flow's write tool (tools.ts) through the normal propose -> confirm path.
 */
import { Permission, SITE_BILL_LIMIT, hasPermission, isModuleSwitchedOff, type ModuleAccessMap } from '@hospital-erp/shared';

export interface FlowDef {
  id: string;
  /** Write tool that finishes the flow. */
  tool: string;
  /** Permission the endpoint behind `tool` demands. */
  permission: Permission;
  /** Module key in shared/access.ts; a switched-off module hides the flow. */
  module: string;
  /** What the reader should expect in a photo for this flow. */
  documentHint: string;
  /** Steps Miko follows, injected into the system prompt while the flow is active. */
  guide: string;
}

export const FLOWS: FlowDef[] = [
  {
    id: 'material_request',
    tool: 'create_mpr',
    permission: Permission.CREATE_MPR,
    module: 'mpr',
    documentHint: 'a handwritten or printed list of materials, an estimate or a quotation for goods',
    guide: `Material Request (create_mpr, requestType MATERIAL).
Must have: vendor, and items with quantity.
1. Vendor: ask "Which vendor?" unless known. Look it up with list_records vendors; one match -> use it; several -> ask_user with the matches as options; none -> say it will be added as a new vendor and use newVendor.
2. Items: ask "Which materials and how many?" (e.g. "Cement 50 bags, Sand 2 ton"). Rates are optional; never ask for them separately.
3. Propose. Do NOT ask for required-by date, priority, department, GST or addresses; fill them only if the user or the photo already gave them.`,
  },
  {
    id: 'service_request',
    tool: 'create_mpr',
    permission: Permission.CREATE_MPR,
    module: 'mpr',
    documentHint: 'a service / work estimate, AMC quote, labour or repair list',
    guide: `Service Request (create_mpr, requestType SERVICE).
Must have: vendor, and work lines with quantity (unit hrs / day / visit / job / lumpsum).
1. Vendor: same as material requests.
2. Work: ask "What work and how much?" (e.g. "AC servicing 4 visits at 1500"). Pick serviceCategory yourself from the words; never ask for it.
3. Propose. Ask nothing else.`,
  },
  {
    id: 'quotation',
    tool: 'create_quotation',
    permission: Permission.CREATE_QUOTATION,
    module: 'quotations',
    documentHint: "a vendor's quotation / estimate with rates",
    guide: `Quotation (create_quotation).
Must have: vendor, items with quantity and unit price.
1. Material request: list_records material_requests with status APPROVED (pageSize 8). If there are any, ask_user "Which material request is this quotation for?" with them as options (label "MPR number · vendor · total") plus the option "No material request". Skip this step when there are none.
2. Vendor: if the chosen MPR has a vendor and the user did not name another, use it; otherwise ask / look up as in material requests. A quotation needs an EXISTING vendor; if the vendor is new, propose create_vendor first.
3. Items and rates: when an MPR was chosen, get_record it and start from its items; ask only for the rates you do not have ("Rate for Cement 50 nos?" - ask for all missing rates in ONE question). GST: use what the photo shows, otherwise ask_user "GST %?" with options 0, 5, 12, 18, 28.
4. Propose.`,
  },
  {
    id: 'purchase_order',
    tool: 'create_purchase_order',
    permission: Permission.CREATE_PO,
    module: 'purchaseOrders',
    documentHint: 'a purchase order or a quotation',
    guide: `Purchase Order (create_purchase_order).
Note: finalizing a quotation already raises its PO automatically, so this flow is for the remaining cases.
1. Source: list_records quotations with status APPROVED and ask_user which one (label "Quotation no. · vendor · total"). For a NON_VENDOR supplier the PO comes from an APPROVED material request instead (mprId). If nothing is available, say so and stop.
2. Payment: ask_user "How will the vendor be paid?" with options "Full payment", "Advance", "After delivery". For Advance ask the advance amount. For Full payment the advance is the quotation total.
3. Propose. Do not ask for delivery date, budget head or terms.`,
  },
  {
    id: 'goods_receipt',
    tool: 'create_goods_receipt',
    permission: Permission.MANAGE_INVENTORY,
    module: 'goodsReceipts',
    documentHint: 'a delivery challan, way bill or vendor bill listing delivered goods',
    guide: `Goods Receipt (create_goods_receipt).
Must have: an APPROVED / PARTIALLY_DELIVERED purchase order and the delivered quantity per item.
1. PO: if a photo shows a PO number or vendor, search for it. Otherwise list_records purchase_orders with status APPROVED (and PARTIALLY_DELIVERED) and ask_user which PO (label "PO number · vendor · total"). One match -> use it without asking.
2. get_record the PO to get its items. Quantities: if a photo gives delivered quantities, use them (match materialName exactly to the PO item names). Otherwise ask_user "Was everything delivered as ordered?" with options "Yes, everything" and "No, some items are short"; for "short" ask which quantities arrived, in ONE question.
3. Propose (materialName must match the PO item names exactly).`,
  },
  {
    id: 'invoice',
    tool: 'create_invoice',
    permission: Permission.VERIFY_INVOICE,
    module: 'invoices',
    documentHint: "a vendor's tax invoice / bill",
    guide: `Vendor Invoice (create_invoice).
Must have: vendor, taxable amount, total (= amount + tax).
1. Vendor: from the photo or ask. It must be an EXISTING vendor; if new, propose create_vendor first.
2. PO: list_records purchase_orders for that vendor (status APPROVED, PARTIALLY_DELIVERED or DELIVERED). One -> use it; several -> ask_user which one, with the option "Not for a PO".
3. Amounts: from the photo (invoice number, taxable amount, GST, total, date). Without a photo ask "Invoice number, amount and GST?" in ONE question. If only a total and a GST % are known, compute: amount = total / (1 + gst/100), round to 2 decimals, tax = total - amount.
4. Propose.`,
  },
  {
    id: 'stock_entry',
    tool: 'create_stock_entry',
    permission: Permission.MANAGE_INVENTORY,
    module: 'inventory',
    documentHint: 'a shop bill, delivery challan or stock list for stock received without a PO',
    guide: `Stock Entry (create_stock_entry) for stock that arrived without a PO.
Must have: source, items with unit and quantity.
1. Source: ask_user "Where did this stock come from?" with options "Opening stock", "Cash purchase", "Owner free issue", "Transfer from another project", "Site return" - unless the words or photo make it obvious (a shop bill = Cash purchase).
2. Items: from the photo, or ask "Which items, how many, and the cost per unit?" in ONE question. Unit is required for every line (use Nos / Bags / Kg / ... as written).
3. Supplier / bill number: take them from the photo if present; never ask.
4. Propose.`,
  },
  {
    id: 'site_bill',
    tool: 'create_site_bill',
    permission: Permission.CREATE_MPR,
    module: 'siteBills',
    documentHint: `a small shop bill / receipt paid at site (up to ₹${SITE_BILL_LIMIT})`,
    guide: `Site Bill (create_site_bill): a small purchase already paid at site, up to ₹${SITE_BILL_LIMIT} in total. A photo or PDF of the bill is optional.
1. If there is no photo yet, you may offer to take one (ask_user with askPhoto true, with a "Skip" answer), but never insist; otherwise ask for the details by text.
2. From the photo or the user: shop name, bill date, items (name, qty, unit, rate). If the date is missing use today. If the total is above ₹${SITE_BILL_LIMIT}, say it is too large for a site bill and offer a Material Request instead.
3. Payment mode: ask_user "How was it paid?" with options Cash, UPI, Bank transfer, Cheque, unless the bill shows it.
4. Propose.`,
  },
  {
    id: 'vendor',
    tool: 'create_vendor',
    permission: Permission.CREATE_VENDOR,
    module: 'vendors',
    documentHint: "a visiting card, letterhead, GST certificate or bill showing the vendor's details",
    guide: `New Vendor (create_vendor).
Must have: name.
1. Name: from the photo or ask. Check list_records vendors first; if it already exists, say so and stop.
2. Fill phone, GST, PAN, address, contact person, email from the photo when present. Without a photo ask once: "Phone number? (optional)" with the option "Skip".
3. vendorType VENDOR unless the user says it is a one-time supplier. Propose.`,
  },
];

export const FLOW_BY_ID: Record<string, FlowDef> = Object.fromEntries(FLOWS.map((f) => [f.id, f]));
export const FLOW_IDS = FLOWS.map((f) => f.id);

export interface FlowSubject {
  role: string;
  /** Effective permissions (own grants + module grants), as on req.user. */
  extraPermissions?: readonly string[] | null;
  /** The user's own grants only, as on req.user. */
  directPermissions?: readonly string[] | null;
  moduleAccess?: ModuleAccessMap | null;
}

/** Flows this user can finish: has the create permission and the module is not switched off for them (the API write-block rule). */
export function availableFlows(user: FlowSubject): FlowDef[] {
  return FLOWS.filter(
    (f) =>
      hasPermission(user.role, f.permission, user.extraPermissions) &&
      !isModuleSwitchedOff({ role: user.role, extraPermissions: user.directPermissions ?? user.extraPermissions, moduleAccess: user.moduleAccess }, f.module),
  );
}

/** System-prompt block for the active flow. */
export function flowPrompt(flowId: string | undefined): string {
  const flow = flowId ? FLOW_BY_ID[flowId] : undefined;
  if (!flow) {
    return `CURRENT TASK: none chosen yet. If the user wants to create something, work out which of these it is: ${FLOWS.map((f) => f.id).join(', ')}. If you cannot tell, call ask_user "What would you like to create?" with the options Material request, Service request, Quotation, Purchase order, Goods receipt, Invoice, Stock entry, Site bill, Vendor. Pass the flow you are following in every ask_user call.`;
  }
  return `CURRENT TASK (the user chose it from the menu): ${flow.guide}
Pass flow "${flow.id}" in every ask_user call. If the user clearly switches to something else, follow the new task and pass its flow id instead.`;
}
