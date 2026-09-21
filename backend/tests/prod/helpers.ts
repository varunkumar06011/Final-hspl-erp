/**
 * FINAL PRODUCTION READINESS TEST — Manual E2E Testing Script
 * Tests all 50 scenarios from the production testing mission.
 * Uses dev-token auth (development mode only).
 * Verifies database state after every action.
 */
import { prisma } from '../../src/config/prisma';

// ─── Test Users ───
const ADMIN_ID = 'df62f7a2-325f-441e-89f3-11f4da29d9dc';      // Kaushal Sir — ADMIN
const ADMIN2_ID = '71df71be-e7b7-4899-98c3-67684e348b7f';     // Vinod Sir — ADMIN_2
const HOC_ID = 'f417ce05-8e9c-4940-b1e6-36036c82143c';        // Ashok Sir — HEAD_OF_CONSTRUCTION
const PH_ID = '35a8ce08-8e4a-4942-8874-966ba354ccb5';         // Akhil — PROJECT_HEAD
const PROJECT_ID = '78996889-e6d1-4f54-aa5e-8f62f5027394';

const BASE = 'http://localhost:4000/api';

// ─── Results Tracking ───
interface TestResult {
  scenario: number;
  name: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_TESTED';
  details: string;
  discrepancy?: string;
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  dbEvidence?: string;
}

const results: TestResult[] = [];

function record(s: number, name: string, status: TestResult['status'], details: string, discrepancy?: string, severity?: TestResult['severity'], dbEvidence?: string) {
  results.push({ scenario: s, name, status, details, discrepancy, severity, dbEvidence });
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : status === 'BLOCKED' ? '⊘' : '—';
  console.log(`  [S${s}] ${icon} ${status} — ${name}: ${details}`);
  if (discrepancy) console.log(`         DISCREPANCY: ${discrepancy}`);
}

// ─── HTTP Helper ───
async function api(method: string, path: string, body?: any, userId: string = PH_ID): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer dev-token:${userId}`,
    'Content-Type': 'application/json',
  };
  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

// ─── Decimal helper ───
function num(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  if (v && typeof v.toString === 'function') return parseFloat(v.toString());
  return 0;
}

function money(v: any): number {
  return Math.round(num(v) * 100) / 100;
}

// ─── Shared helpers ───
async function createVendor(namePrefix: string): Promise<string | null> {
  const res = await api('POST', '/vendors', {
    name: `${namePrefix}-${Date.now()}`,
    code: `VGH-${Math.floor(Math.random() * 9000) + 1000}`,
    category: 'GENERAL',
    phone: `+919999${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`,
  }, PH_ID);
  return res.status === 201 ? res.body.id : null;
}

async function createAndApproveQuotation(vendorId: string, items: any[]): Promise<string | null> {
  const qRes = await api('POST', '/quotations', {
    vendorId,
    items,
    acknowledged: true,
  }, PH_ID);
  if (qRes.status !== 201) return null;
  const qId = qRes.body.id;
  // HEAD_GROUPS policy: need 1 from {PROJECT_HEAD, HOC} + 1 from {ADMIN, ADMIN_2}
  // Approve step 1 (PROJECT_HEAD — first group)
  const a1 = await api('POST', `/quotations/${qId}/approve`, { comments: 'OK', acknowledged: true }, PH_ID);
  if (a1.status !== 200) return null;
  // Approve step 2 (ADMIN — second group)
  const a2 = await api('POST', `/quotations/${qId}/approve`, { comments: 'OK', acknowledged: true }, ADMIN_ID);
  if (a2.status !== 200) return null;
  return qId;
}

async function createAndApprovePO(qId: string, budgetHeadId: string, vendorId: string, paymentType: string = 'AFTER_DELIVERY'): Promise<string | null> {
  const poRes = await api('POST', '/purchase-orders', {
    vendorId,
    quotationId: qId,
    paymentType,
    acknowledged: true,
    budgetHeadId,
  }, PH_ID);
  if (poRes.status !== 201) return null;
  const poId = poRes.body.id;
  // PO approval: only ADMIN/ADMIN_2 can approve, 1 approval needed (PO_SINGLE_APPROVER)
  const a1 = await api('POST', `/purchase-orders/${poId}/approve`, { comments: 'OK', acknowledged: true }, ADMIN_ID);
  if (a1.status !== 200) return null;
  return poId;
}

// Export for chunked sections
export { results, record, api, num, money, prisma,
  ADMIN_ID, ADMIN2_ID, HOC_ID, PH_ID, PROJECT_ID,
  createVendor, createAndApproveQuotation, createAndApprovePO,
  verifyInvoice, createAndPayInvoice, approveGatePassDb,
  createInspectAndPostGRN,
  TestResult };

// Full GRN flow: create → inspect → post
// items: [{ materialName, deliveredQty, unit, acceptedQty, rejectedQty }]
async function createInspectAndPostGRN(
  gatePassId: string,
  items: { materialName: string; deliveredQty: number; unit: string; acceptedQty: number; rejectedQty: number }[]
): Promise<string | null> {
  // 1. Create GRN with delivered items
  const createRes = await api('POST', '/goods-receipts', {
    gatePassId,
    items: items.map(i => ({ materialName: i.materialName, deliveredQty: i.deliveredQty, unit: i.unit })),
  }, PH_ID);
  if (createRes.status !== 201) return null;
  const grnId = createRes.body.id;
  const grnItems = createRes.body.items;

  // 2. Inspect GRN — match by materialName to get item IDs
  const inspectItems = items.map(i => {
    const grnItem = grnItems.find((g: any) => g.materialName === i.materialName);
    return {
      id: grnItem.id,
      acceptedQty: i.acceptedQty,
      rejectedQty: i.rejectedQty,
      itemType: 'CONSUMABLE',
    };
  });
  const inspRes = await api('POST', `/goods-receipts/${grnId}/inspect`, { items: inspectItems }, HOC_ID);
  if (inspRes.status !== 200 && inspRes.status !== 201) return null;

  // 3. Post GRN (must be a different user than creator and inspector)
  const postRes = await api('POST', `/goods-receipts/${grnId}/post`, {}, ADMIN_ID);
  if (postRes.status !== 200) return null;

  return grnId;
}

// Directly approve a gate pass in the DB (bypasses Firebase OTP — for testing only)
async function approveGatePassDb(gatePassId: string, approverUserId: string = HOC_ID): Promise<boolean> {
  try {
    await prisma.gatePass.update({
      where: { id: gatePassId },
      data: {
        status: 'APPROVED',
        otpApprovedBy: approverUserId,
        otpApprovedAt: new Date(),
      },
    });
    return true;
  } catch {
    return false;
  }
}

// Verify an invoice (HEAD_GROUPS: 1 from {PH, HOC} + 1 from {ADMIN, ADMIN_2})
async function verifyInvoice(invId: string): Promise<boolean> {
  const a1 = await api('POST', `/invoices/${invId}/approve`, { comments: 'OK', acknowledged: true }, PH_ID);
  if (a1.status !== 200) return false;
  const a2 = await api('POST', `/invoices/${invId}/approve`, { comments: 'OK', acknowledged: true }, ADMIN_ID);
  return a2.status === 200;
}

// Full payment flow: verify invoice → create payment request → approve → pay
async function createAndPayInvoice(invId: string, vendorId: string, amount: number, bankAccountId: string): Promise<boolean> {
  // 1. Verify invoice
  const verified = await verifyInvoice(invId);
  if (!verified) return false;
  // 2. Create payment request
  const payRes = await api('POST', '/payments/invoice-payment', {
    invoiceId: invId, vendorId,
    requestNumber: `PR-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    amount,
  }, PH_ID);
  if (payRes.status !== 201) return false;
  const payId = payRes.body.id;
  // 3. Approve payment (HEAD_GROUPS: PH + ADMIN)
  const a1 = await api('POST', `/payments/${payId}/approve`, { comments: 'OK', acknowledged: true }, PH_ID);
  if (a1.status !== 200) return false;
  const a2 = await api('POST', `/payments/${payId}/approve`, { comments: 'OK', acknowledged: true }, ADMIN_ID);
  if (a2.status !== 200) return false;
  // 4. Execute payment
  const execRes = await api('POST', `/payments/${payId}/pay`, {
    amount, mode: 'BANK_TRANSFER', bankAccountId,
  }, PH_ID);
  return execRes.status === 200;
}
