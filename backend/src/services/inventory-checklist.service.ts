import { GatePassStatus, GoodsReceiptStatus, MPRStatus, POStatus, QuotationStatus, VendorType } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';

/**
 * Final checklist before goods go into inventory. Every receipt is checked against the
 * whole chain it came from, automatically; posting to stock is refused until every box is
 * ticked (no override). It lives on the goods receipt, not as a module of its own.
 *
 *   request    the material request was approved (site bills: every bill; contract
 *              sub-POs: the contract PO was approved instead)
 *   quotation  vendor PO: raised from a finalized quotation of that request
 *   vendorPath vendor / non-vendor kept apart: a VENDOR PO comes from a quotation, a
 *              NON_VENDOR PO straight from its request (or from site bills)
 *   po         the PO was approved
 *   gatePass   the delivery's gate pass was approved (not just a receipt without one)
 *   proof      the gate pass has its photo proof
 *   inspection the receipt was inspected (accepted / rejected quantities recorded)
 *   items      every line is a catalog item (+ spec) and a line of the PO
 */

export type ChecklistKey = 'request' | 'quotation' | 'vendorPath' | 'po' | 'gatePass' | 'proof' | 'inspection' | 'items';
export type ChecklistState = 'OK' | 'MISSING' | 'NOT_NEEDED';

export interface ChecklistItem {
  key: ChecklistKey;
  state: ChecklistState;
  /** Document number the check looked at (MPR / quotation / PO / gate pass), when there is one. */
  ref?: string | null;
  /** Machine-readable reason when MISSING (the UI words it). */
  reason?: string;
}

export interface ReceiptChecklist {
  complete: boolean;
  items: ChecklistItem[];
}

const APPROVED_MPR: string[] = [MPRStatus.APPROVED, MPRStatus.QUOTATIONS_RECEIVED, MPRStatus.CLOSED];
const FINALIZED_QUOTATION: string[] = [QuotationStatus.APPROVED, QuotationStatus.CONVERTED_TO_PO];
const APPROVED_PO: string[] = [POStatus.APPROVED, POStatus.PARTIALLY_DELIVERED, POStatus.DELIVERED];
const APPROVED_GATE_PASS: string[] = [GatePassStatus.APPROVED, GatePassStatus.DELIVERED];

interface MprFacts {
  mprNumber: string;
  status: string;
  deletedAt: Date | null;
}

/** Everything the checklist looks at, loaded once. */
export interface ReceiptFacts {
  status: string;
  inspectedAt: Date | null;
  items: Array<{ itemId: string | null; poItemId: string | null }>;
  gatePass: { passNumber: string; status: string; photoProofPath: string | null; deletedAt: Date | null } | null;
  po: {
    poNumber: string;
    status: string;
    vendorType: string;
    isSiteBillBatch: boolean;
    contract: { poNumber: string; status: string } | null;
    quotation: { quotationNumber: string; status: string; deletedAt: Date | null; mprId: string | null } | null;
    mprId: string | null;
    mpr: MprFacts | null;
    siteBills: MprFacts[];
  };
}

const ok = (key: ChecklistKey, ref?: string | null): ChecklistItem => ({ key, state: 'OK', ref });
const missing = (key: ChecklistKey, reason: string, ref?: string | null): ChecklistItem => ({ key, state: 'MISSING', reason, ref });
const notNeeded = (key: ChecklistKey, reason: string): ChecklistItem => ({ key, state: 'NOT_NEEDED', reason });

/** Pure: the checklist for already-loaded facts. */
export function evaluateReceiptChecklist(f: ReceiptFacts): ReceiptChecklist {
  const { po } = f;
  const items: ChecklistItem[] = [];
  const isContractBill = !!po.contract;
  const isNonVendor = po.vendorType === VendorType.NON_VENDOR;
  const mpr = po.mpr;
  const liveQuotation = po.quotation && !po.quotation.deletedAt ? po.quotation : null;

  // request
  if (isContractBill) {
    items.push(APPROVED_PO.includes(po.contract!.status) ? ok('request', po.contract!.poNumber) : missing('request', 'CONTRACT_NOT_APPROVED', po.contract!.poNumber));
  } else if (po.isSiteBillBatch) {
    const bills = po.siteBills.filter((b) => !b.deletedAt);
    if (bills.length === 0) items.push(missing('request', 'NO_SITE_BILLS'));
    else {
      const bad = bills.find((b) => !APPROVED_MPR.includes(b.status));
      items.push(bad ? missing('request', 'SITE_BILL_NOT_APPROVED', bad.mprNumber) : ok('request', bills.map((b) => b.mprNumber).join(', ')));
    }
  } else if (!mpr || mpr.deletedAt) {
    items.push(missing('request', 'NO_REQUEST'));
  } else {
    items.push(APPROVED_MPR.includes(mpr.status) ? ok('request', mpr.mprNumber) : missing('request', 'REQUEST_NOT_APPROVED', mpr.mprNumber));
  }

  // quotation + vendorPath
  if (isContractBill) {
    items.push(notNeeded('quotation', 'CONTRACT'));
    items.push(notNeeded('vendorPath', 'CONTRACT'));
  } else if (isNonVendor) {
    items.push(notNeeded('quotation', 'NON_VENDOR'));
    // A non-vendor PO is raised straight from its request or from site bills.
    items.push(po.mprId || po.isSiteBillBatch || liveQuotation ? ok('vendorPath') : missing('vendorPath', 'NON_VENDOR_WITHOUT_REQUEST'));
  } else {
    if (!liveQuotation) items.push(missing('quotation', 'NO_QUOTATION'));
    else if (!FINALIZED_QUOTATION.includes(liveQuotation.status)) items.push(missing('quotation', 'QUOTATION_NOT_FINALIZED', liveQuotation.quotationNumber));
    else items.push(ok('quotation', liveQuotation.quotationNumber));
    if (po.isSiteBillBatch) items.push(missing('vendorPath', 'SITE_BILLS_ON_VENDOR'));
    else if (!liveQuotation) items.push(missing('vendorPath', 'VENDOR_WITHOUT_QUOTATION'));
    else if (mpr && liveQuotation.mprId && liveQuotation.mprId !== po.mprId && po.mprId) items.push(missing('vendorPath', 'QUOTATION_OF_OTHER_REQUEST'));
    else items.push(ok('vendorPath'));
  }

  // po
  items.push(APPROVED_PO.includes(po.status) ? ok('po', po.poNumber) : missing('po', 'PO_NOT_APPROVED', po.poNumber));

  // gate pass + proof
  const gp = f.gatePass && !f.gatePass.deletedAt ? f.gatePass : null;
  if (!gp) {
    items.push(missing('gatePass', 'NO_GATE_PASS'));
    items.push(missing('proof', 'NO_GATE_PASS'));
  } else {
    items.push(APPROVED_GATE_PASS.includes(gp.status) ? ok('gatePass', gp.passNumber) : missing('gatePass', 'GATE_PASS_NOT_APPROVED', gp.passNumber));
    items.push(gp.photoProofPath ? ok('proof', gp.passNumber) : missing('proof', 'NO_PHOTO', gp.passNumber));
  }

  // inspection
  const inspected = f.status === GoodsReceiptStatus.READY_TO_POST || f.status === GoodsReceiptStatus.POSTED;
  items.push(inspected && f.inspectedAt ? ok('inspection') : missing('inspection', 'NOT_INSPECTED'));

  // items
  if (f.items.length === 0) items.push(missing('items', 'NO_LINES'));
  else if (f.items.some((l) => !l.poItemId)) items.push(missing('items', 'LINE_NOT_ON_PO'));
  else if (f.items.some((l) => !l.itemId)) items.push(missing('items', 'LINE_NOT_IN_CATALOG'));
  else items.push(ok('items'));

  return { complete: items.every((i) => i.state !== 'MISSING'), items };
}

const mprFacts = { mprNumber: true, status: true, deletedAt: true } as const;

/** Loads a receipt's chain and evaluates its checklist; null when the receipt does not exist. */
export async function goodsReceiptChecklist(receiptId: string, projectId: string): Promise<ReceiptChecklist | null> {
  const r = await prisma.goodsReceipt.findFirst({
    where: { id: receiptId, projectId, deletedAt: null },
    select: {
      status: true,
      inspectedAt: true,
      items: { select: { itemId: true, poItemId: true } },
      gatePass: { select: { passNumber: true, status: true, photoProofPath: true, deletedAt: true } },
      purchaseOrder: {
        select: {
          id: true,
          poNumber: true,
          status: true,
          isSiteBillBatch: true,
          mprId: true,
          vendor: { select: { vendorType: true } },
          contractPo: { select: { poNumber: true, status: true } },
          quotation: { select: { quotationNumber: true, status: true, deletedAt: true, mprId: true, mpr: { select: mprFacts } } },
          mpr: { select: mprFacts },
        },
      },
    },
  });
  if (!r) return null;
  const po = r.purchaseOrder;
  const siteBills = po.isSiteBillBatch
    ? await prisma.materialPurchaseRequest.findMany({ where: { sitePoId: po.id, isSiteBill: true }, select: mprFacts })
    : [];
  return evaluateReceiptChecklist({
    status: r.status,
    inspectedAt: r.inspectedAt,
    items: r.items,
    gatePass: r.gatePass,
    po: {
      poNumber: po.poNumber,
      status: po.status,
      vendorType: po.vendor.vendorType,
      isSiteBillBatch: po.isSiteBillBatch,
      contract: po.contractPo,
      quotation: po.quotation,
      mprId: po.mprId ?? po.quotation?.mprId ?? null,
      // The request the goods were asked for: the PO's own, else the quotation's.
      mpr: po.mpr ?? po.quotation?.mpr ?? null,
      siteBills,
    },
  });
}
