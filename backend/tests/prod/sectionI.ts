/** SECTION I — Scenario 50: Cross-Module Reconciliation */
import { record, api, prisma, money, ADMIN_ID, PH_ID, HOC_ID, PROJECT_ID,
  createVendor, createAndApproveQuotation, createAndApprovePO, approveGatePassDb, createInspectAndPostGRN } from './helpers';

export async function sectionI() {
  console.log('\n═══ SECTION I — Cross-Module Reconciliation ═══');

  // ── Scenario 50 — Complete financial and operational reconciliation ──
  console.log('\n── Scenario 50: Complete financial and operational reconciliation ──');
  try {
    // ── Step 1: Capture all "before" balances ──
    const head = await prisma.budgetHead.findFirst({
      where: { projectId: PROJECT_ID, deletedAt: null, allocatedAmount: { gte: 500000 } },
      orderBy: { allocatedAmount: 'desc' },
      select: { id: true, allocatedAmount: true, committedAmount: true, actualAmount: true, paidAmount: true },
    });
    if (!head) { record(50, 'Cross-module reconciliation', 'BLOCKED', 'No budget head'); return; }

    const bank = await prisma.bankAccount.findFirst({
      where: { projectId: PROJECT_ID, deletedAt: null },
      select: { id: true, currentBalance: true },
    });
    if (!bank) { record(50, 'Cross-module reconciliation', 'BLOCKED', 'No bank account'); return; }

    const allocatedBefore = money(head.allocatedAmount);
    const committedBefore = money(head.committedAmount);
    const actualBefore = money(head.actualAmount);
    const paidBefore = money(head.paidAmount);
    const bankBefore = money(bank.currentBalance);

    console.log(`    Before: allocated=${allocatedBefore} committed=${committedBefore} actual=${actualBefore} paid=${paidBefore} bank=${bankBefore}`);

    // ── Step 2: Full procurement flow ──
    const poValue = 25000;

    // 2a. Vendor
    const vendorId = await createVendor('Recon');
    if (!vendorId) { record(50, 'Cross-module reconciliation', 'FAIL', 'Vendor failed'); return; }

    // 2b. Quotation → Approve
    const itemName = `ReconItem-${Date.now()}`;
    const qId = await createAndApproveQuotation(vendorId, [
      { materialName: itemName, quantity: 5, unit: 'NOS', unitPrice: 5000 }
    ]);
    if (!qId) { record(50, 'Cross-module reconciliation', 'FAIL', 'Quotation failed'); return; }

    // 2c. PO → Approve (creates commitment)
    const poId = await createAndApprovePO(qId, head.id, vendorId);
    if (!poId) { record(50, 'Cross-module reconciliation', 'FAIL', 'PO failed'); return; }

    // Verify commitment increased
    const headAfterPO = await prisma.budgetHead.findUnique({ where: { id: head.id }, select: { committedAmount: true } });
    const committedAfterPO = money(headAfterPO!.committedAmount);
    if (committedAfterPO !== committedBefore + poValue) {
      record(50, 'Cross-module reconciliation', 'FAIL', `Commitment after PO wrong`, `Expected=${committedBefore + poValue} Got=${committedAfterPO}`, 'CRITICAL');
      return;
    }
    console.log(`    After PO: committed=${committedAfterPO} (expected ${committedBefore + poValue})`);

    // 2d. Gate pass → approve OTP
    const gpRes = await api('POST', '/gate-passes', {
      poId, otpRequestedFor: HOC_ID, vehicleType: 'OTHER',
      items: [{ materialName: itemName, quantity: 5, unit: 'NOS' }],
    }, PH_ID);
    if (gpRes.status !== 201) { record(50, 'Cross-module reconciliation', 'FAIL', 'GP failed'); return; }
    await approveGatePassDb(gpRes.body.id);

    // 2e. GRN → inspect → post (converts commitment to actual)
    const grnId = await createInspectAndPostGRN(gpRes.body.id, [
      { materialName: itemName, deliveredQty: 5, unit: 'NOS', acceptedQty: 5, rejectedQty: 0 }
    ]);
    if (!grnId) { record(50, 'Cross-module reconciliation', 'FAIL', 'GRN create/inspect/post failed'); return; }

    // Verify commitment released, actual increased
    const headAfterGRN = await prisma.budgetHead.findUnique({ where: { id: head.id }, select: { committedAmount: true, actualAmount: true } });
    const committedAfterGRN = money(headAfterGRN!.committedAmount);
    const actualAfterGRN = money(headAfterGRN!.actualAmount);
    if (committedAfterGRN !== committedBefore || actualAfterGRN !== actualBefore + poValue) {
      record(50, 'Cross-module reconciliation', 'FAIL', `Budget after GRN wrong`, `committed: ${committedAfterGRN} (expected ${committedBefore}) actual: ${actualAfterGRN} (expected ${actualBefore + poValue})`, 'CRITICAL');
      return;
    }
    console.log(`    After GRN: committed=${committedAfterGRN} actual=${actualAfterGRN} (expected actual ${actualBefore + poValue})`);

    // 2f. Invoice
    const invRes = await api('POST', '/invoices', {
      vendorId, poId,
      invoiceNumber: `INV-RECON-${Date.now()}`,
      amount: poValue, taxAmount: 0, totalAmount: poValue,
      acknowledged: true,
    }, PH_ID);
    if (invRes.status !== 201) { record(50, 'Cross-module reconciliation', 'FAIL', 'Invoice failed'); return; }
    const invId = invRes.body.id;

    // Verify invoice outstanding = poValue
    const invAfter = await prisma.vendorInvoice.findUnique({ where: { id: invId }, select: { outstandingAmount: true, totalAmount: true } });
    if (money(invAfter?.outstandingAmount) !== poValue) {
      record(50, 'Cross-module reconciliation', 'FAIL', `Invoice outstanding wrong`, `Expected=${poValue} Got=${money(invAfter?.outstandingAmount)}`, 'CRITICAL');
      return;
    }

    // 2g. Verify invoice → Payment request → approve → pay
    // Verify invoice (HEAD_GROUPS: PH + ADMIN)
    const v1 = await api('POST', `/invoices/${invId}/approve`, { comments: 'OK', acknowledged: true }, PH_ID);
    if (v1.status !== 200) { record(50, 'Cross-module reconciliation', 'FAIL', `Invoice verify step 1 failed: ${v1.status}`); return; }
    const v2 = await api('POST', `/invoices/${invId}/approve`, { comments: 'OK', acknowledged: true }, ADMIN_ID);
    if (v2.status !== 200) { record(50, 'Cross-module reconciliation', 'FAIL', `Invoice verify step 2 failed: ${v2.status}`); return; }

    // Create payment request
    const payRes = await api('POST', '/payments/invoice-payment', {
      invoiceId: invId, vendorId,
      requestNumber: `PR-RECON-${Date.now()}`, amount: poValue,
    }, PH_ID);
    if (payRes.status !== 201) { record(50, 'Cross-module reconciliation', 'FAIL', `Payment request failed: ${payRes.status}`); return; }
    const payId = payRes.body.id;

    // Approve payment (HEAD_GROUPS: PH + ADMIN)
    await api('POST', `/payments/${payId}/approve`, { comments: 'OK', acknowledged: true }, PH_ID);
    await api('POST', `/payments/${payId}/approve`, { comments: 'OK', acknowledged: true }, ADMIN_ID);

    // Execute payment
    const execRes = await api('POST', `/payments/${payId}/pay`, {
      amount: poValue, mode: 'BANK_TRANSFER', bankAccountId: bank.id,
    }, PH_ID);
    if (execRes.status !== 200 && execRes.status !== 201) { record(50, 'Cross-module reconciliation', 'FAIL', `Payment execute failed: ${execRes.status}`); return; }

    // ── Step 3: Verify all final values ──
    const headFinal = await prisma.budgetHead.findUnique({ where: { id: head.id }, select: { allocatedAmount: true, committedAmount: true, actualAmount: true, paidAmount: true } });
    const bankFinal = await prisma.bankAccount.findUnique({ where: { id: bank.id }, select: { currentBalance: true } });
    const invFinal = await prisma.vendorInvoice.findUnique({ where: { id: invId }, select: { outstandingAmount: true, paymentStatus: true } });

    const allocatedFinal = money(headFinal!.allocatedAmount);
    const committedFinal = money(headFinal!.committedAmount);
    const actualFinal = money(headFinal!.actualAmount);
    const paidFinal = money(headFinal!.paidAmount);
    const bankFinalVal = money(bankFinal!.currentBalance);
    const invOutstandingFinal = money(invFinal?.outstandingAmount);

    console.log(`    Final: allocated=${allocatedFinal} committed=${committedFinal} actual=${actualFinal} paid=${paidFinal} bank=${bankFinalVal} invOut=${invOutstandingFinal}`);

    // ── Reconciliation checks ──
    const checks = [
      // Budget: committed should return to before (PO committed, GRN released)
      { name: 'budget.committed', actual: committedFinal, expected: committedBefore, ok: committedFinal === committedBefore },
      // Budget: actual should increase by poValue
      { name: 'budget.actual', actual: actualFinal, expected: actualBefore + poValue, ok: actualFinal === actualBefore + poValue },
      // Budget: paid should increase by poValue
      { name: 'budget.paid', actual: paidFinal, expected: paidBefore + poValue, ok: paidFinal === paidBefore + poValue },
      // Budget: allocated should not change
      { name: 'budget.allocated', actual: allocatedFinal, expected: allocatedBefore, ok: allocatedFinal === allocatedBefore },
      // Bank: should decrease by poValue
      { name: 'bank.currentBalance', actual: bankFinalVal, expected: bankBefore - poValue, ok: bankFinalVal === bankBefore - poValue },
      // Invoice: outstanding should be 0
      { name: 'invoice.outstanding', actual: invOutstandingFinal, expected: 0, ok: invOutstandingFinal === 0 },
      // Invoice: payment status should be PAID
      { name: 'invoice.paymentStatus', actual: invFinal?.paymentStatus, expected: 'PAID', ok: invFinal?.paymentStatus === 'PAID' },
    ];

    const allOk = checks.every(c => c.ok);
    if (allOk) {
      record(50, 'Cross-module reconciliation', 'PASS',
        `All checks passed: committed=${committedFinal} actual=${actualFinal} paid=${paidFinal} bank=${bankFinalVal} invOut=${invOutstandingFinal}`);
    } else {
      const failed = checks.filter(c => !c.ok);
      record(50, 'Cross-module reconciliation', 'FAIL',
        `${failed.length} reconciliation check(s) failed`,
        failed.map(c => `${c.name}: got=${c.actual} expected=${c.expected}`).join('; '),
        'CRITICAL');
    }
  } catch (e: any) {
    record(50, 'Cross-module reconciliation', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }
}
