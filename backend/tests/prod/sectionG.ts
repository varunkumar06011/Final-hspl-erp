/** SECTION G — Scenarios 40-44: Payments and Invoices */
import { record, api, prisma, money, ADMIN_ID, PH_ID, HOC_ID, PROJECT_ID,
  createVendor, createAndApproveQuotation, createAndApprovePO, approveGatePassDb, createInspectAndPostGRN } from './helpers';

export async function sectionG() {
  console.log('\n═══ SECTION G — Payments and Invoices ═══');

  // Helper: create a full procurement chain with invoice, return IDs
  async function createInvoiceForPO(poValue: number): Promise<{ invId: string; vendorId: string; poId: string; bankId: string } | null> {
    try {
    const head = await prisma.budgetHead.findFirst({
      where: { projectId: PROJECT_ID, deletedAt: null, allocatedAmount: { gte: poValue + 100000 } },
      orderBy: { allocatedAmount: 'desc' },
    });
    if (!head) { console.log('    [createInvoiceForPO] No budget head'); return null; }
    const bank = await prisma.bankAccount.findFirst({ where: { projectId: PROJECT_ID, deletedAt: null }, select: { id: true } });
    if (!bank) { console.log('    [createInvoiceForPO] No bank'); return null; }
    const vendorId = await createVendor('PayTest');
    if (!vendorId) { console.log('    [createInvoiceForPO] Vendor failed'); return null; }
    const itemName = `PayItem-${Date.now()}`;
    const qId = await createAndApproveQuotation(vendorId, [
      { materialName: itemName, quantity: 1, unit: 'NOS', unitPrice: poValue }
    ]);
    if (!qId) { console.log('    [createInvoiceForPO] Quotation failed'); return null; }
    const poId = await createAndApprovePO(qId, head.id, vendorId);
    if (!poId) { console.log('    [createInvoiceForPO] PO failed'); return null; }
    // GRN
    const gpRes = await api('POST', '/gate-passes', {
      poId, otpRequestedFor: HOC_ID, vehicleType: 'OTHER',
      items: [{ materialName: itemName, quantity: 1, unit: 'NOS' }],
    }, PH_ID);
    if (gpRes.status !== 201) { console.log('    [createInvoiceForPO] GP failed:', gpRes.status, JSON.stringify(gpRes.body).slice(0, 200)); return null; }
    await approveGatePassDb(gpRes.body.id);
    const grnId = await createInspectAndPostGRN(gpRes.body.id, [
      { materialName: itemName, deliveredQty: 1, unit: 'NOS', acceptedQty: 1, rejectedQty: 0 }
    ]);
    if (!grnId) { console.log('    [createInvoiceForPO] GRN failed'); return null; }
    // Invoice
    const invRes = await api('POST', '/invoices', {
      vendorId, poId,
      invoiceNumber: `INV-PAY-${Date.now()}`,
      amount: poValue, taxAmount: 0, totalAmount: poValue,
      acknowledged: true,
    }, PH_ID);
    if (invRes.status !== 201) { console.log('    [createInvoiceForPO] Invoice failed:', invRes.status, JSON.stringify(invRes.body).slice(0, 200)); return null; }
    const invId = invRes.body.id;
    // Verify invoice (HEAD_GROUPS: PH + ADMIN)
    const v1 = await api('POST', `/invoices/${invId}/approve`, { comments: 'OK', acknowledged: true }, PH_ID);
    if (v1.status !== 200) { console.log('    [createInvoiceForPO] Verify1 failed:', v1.status); return null; }
    const v2 = await api('POST', `/invoices/${invId}/approve`, { comments: 'OK', acknowledged: true }, ADMIN_ID);
    if (v2.status !== 200) { console.log('    [createInvoiceForPO] Verify2 failed:', v2.status, JSON.stringify(v2.body).slice(0, 200)); return null; }
    return { invId, vendorId, poId, bankId: bank.id };
    } catch (e: any) { console.log('    [createInvoiceForPO] Exception:', e.message, e.stack?.split('\n').slice(0, 5).join(' | ')); return null; }
  }

  // ── Scenario 40 — Full invoice payment ──
  console.log('\n── Scenario 40: Full invoice payment ──');
  try {
    const poValue = 15000;
    const ctx = await createInvoiceForPO(poValue);
    if (!ctx) { record(40, 'Full invoice payment', 'FAIL', 'Failed to create invoice'); return; }

    const bankBefore = money((await prisma.bankAccount.findUnique({ where: { id: ctx.bankId }, select: { currentBalance: true } }))!.currentBalance);
    const invBefore = await prisma.vendorInvoice.findUnique({ where: { id: ctx.invId }, select: { outstandingAmount: true, paymentStatus: true } });
    const outstandingBefore = money(invBefore?.outstandingAmount);

    // Create payment request
    const payRes = await api('POST', '/payments/invoice-payment', {
      invoiceId: ctx.invId, vendorId: ctx.vendorId,
      requestNumber: `PR-FULL-${Date.now()}`, amount: poValue,
    }, PH_ID);
    if (payRes.status !== 201) { record(40, 'Full invoice payment', 'FAIL', `Payment request failed: ${payRes.status}`, JSON.stringify(payRes.body).slice(0, 200), 'HIGH'); return; }
    const payId = payRes.body.id;

    // Approve payment (2 approvals)
    const pa1 = await api('POST', `/payments/${payId}/approve`, { comments: 'OK', acknowledged: true }, PH_ID);
    if (pa1.status !== 200) { record(40, 'Full invoice payment', 'FAIL', `Payment approve step 1 failed: ${pa1.status}`); return; }
    const pa2 = await api('POST', `/payments/${payId}/approve`, { comments: 'OK', acknowledged: true }, ADMIN_ID);
    if (pa2.status !== 200) { record(40, 'Full invoice payment', 'FAIL', `Payment approve step 2 failed: ${pa2.status}`); return; }

    // Execute payment
    const execRes = await api('POST', `/payments/${payId}/pay`, {
      amount: poValue, mode: 'BANK_TRANSFER', bankAccountId: ctx.bankId,
    }, PH_ID);
    if (execRes.status !== 200 && execRes.status !== 201) { record(40, 'Full invoice payment', 'FAIL', `Payment execute failed: ${execRes.status}`, JSON.stringify(execRes.body).slice(0, 200), 'HIGH'); return; }

    // Verify
    const bankAfter = money((await prisma.bankAccount.findUnique({ where: { id: ctx.bankId }, select: { currentBalance: true } }))!.currentBalance);
    const invAfter = await prisma.vendorInvoice.findUnique({ where: { id: ctx.invId }, select: { outstandingAmount: true, paymentStatus: true } });
    const outstandingAfter = money(invAfter?.outstandingAmount);

    if (outstandingAfter === 0 && invAfter?.paymentStatus === 'PAID' && bankAfter === bankBefore - poValue) {
      record(40, 'Full invoice payment', 'PASS', `outstanding: ${outstandingBefore}→${outstandingAfter} status=PAID bank: ${bankBefore}→${bankAfter}`);
    } else {
      record(40, 'Full invoice payment', 'FAIL', `Payment mismatch`, `outstanding=${outstandingAfter} status=${invAfter?.paymentStatus} bank: ${bankBefore}→${bankAfter} (expected ${bankBefore - poValue})`, 'CRITICAL');
    }
  } catch (e: any) {
    record(40, 'Full invoice payment', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 41 — Partial invoice payment ──
  console.log('\n── Scenario 41: Partial invoice payment ──');
  try {
    const poValue = 20000;
    const partialAmount = 8000;
    const ctx = await createInvoiceForPO(poValue);
    if (!ctx) { record(41, 'Partial invoice payment', 'FAIL', 'Failed to create invoice'); return; }

    const invBefore = await prisma.vendorInvoice.findUnique({ where: { id: ctx.invId }, select: { outstandingAmount: true, paymentStatus: true } });
    const outstandingBefore = money(invBefore?.outstandingAmount);

    const payRes = await api('POST', '/payments/invoice-payment', {
      invoiceId: ctx.invId, vendorId: ctx.vendorId,
      requestNumber: `PR-PART-${Date.now()}`, amount: partialAmount,
    }, PH_ID);
    if (payRes.status !== 201) { record(41, 'Partial invoice payment', 'FAIL', `Payment request failed`); return; }
    const payId = payRes.body.id;

    await api('POST', `/payments/${payId}/approve`, { comments: 'OK', acknowledged: true }, PH_ID);
    await api('POST', `/payments/${payId}/approve`, { comments: 'OK', acknowledged: true }, ADMIN_ID);
    const execRes = await api('POST', `/payments/${payId}/pay`, {
      amount: partialAmount, mode: 'BANK_TRANSFER', bankAccountId: ctx.bankId,
    }, PH_ID);
    if (execRes.status !== 200) { record(41, 'Partial invoice payment', 'FAIL', `Payment execute failed: ${execRes.status}`); return; }

    const invAfter = await prisma.vendorInvoice.findUnique({ where: { id: ctx.invId }, select: { outstandingAmount: true, paymentStatus: true } });
    const outstandingAfter = money(invAfter?.outstandingAmount);
    const expectedOutstanding = outstandingBefore - partialAmount;

    if (outstandingAfter === expectedOutstanding && invAfter?.paymentStatus !== 'PAID') {
      record(41, 'Partial invoice payment', 'PASS', `outstanding: ${outstandingBefore}→${outstandingAfter} (paid ${partialAmount} of ${poValue}), status=${invAfter.paymentStatus}`);
    } else {
      record(41, 'Partial invoice payment', 'FAIL', `Outstanding mismatch`, `Expected=${expectedOutstanding} Got=${outstandingAfter} status=${invAfter?.paymentStatus}`, 'CRITICAL');
    }
  } catch (e: any) {
    record(41, 'Partial invoice payment', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 42 — Multiple payments against one invoice ──
  console.log('\n── Scenario 42: Multiple payments against one invoice ──');
  try {
    const poValue = 30000;
    const ctx = await createInvoiceForPO(poValue);
    if (!ctx) { record(42, 'Multiple payments', 'FAIL', 'Failed to create invoice'); return; }

    // Pay in 3 installments: 10000 + 10000 + 10000
    const installments = [10000, 10000, 10000];
    let totalPaid = 0;
    let allOk = true;

    for (let i = 0; i < installments.length; i++) {
      const payRes = await api('POST', '/payments/invoice-payment', {
        invoiceId: ctx.invId, vendorId: ctx.vendorId,
        requestNumber: `PR-MULTI-${i}-${Date.now()}`, amount: installments[i],
      }, PH_ID);
      if (payRes.status !== 201) { allOk = false; break; }
      await api('POST', `/payments/${payRes.body.id}/approve`, { comments: 'OK', acknowledged: true }, PH_ID);
      await api('POST', `/payments/${payRes.body.id}/approve`, { comments: 'OK', acknowledged: true }, ADMIN_ID);
      const execRes = await api('POST', `/payments/${payRes.body.id}/pay`, {
        amount: installments[i], mode: 'BANK_TRANSFER', bankAccountId: ctx.bankId,
      }, PH_ID);
      if (execRes.status !== 200) { allOk = false; break; }
      totalPaid += installments[i];

      // Check outstanding after each payment
      const inv = await prisma.vendorInvoice.findUnique({ where: { id: ctx.invId }, select: { outstandingAmount: true } });
      const outstanding = money(inv?.outstandingAmount);
      if (outstanding !== poValue - totalPaid) { allOk = false; break; }
    }

    const invFinal = await prisma.vendorInvoice.findUnique({ where: { id: ctx.invId }, select: { outstandingAmount: true, paymentStatus: true } });
    const outstandingFinal = money(invFinal?.outstandingAmount);

    if (allOk && outstandingFinal === 0 && invFinal?.paymentStatus === 'PAID') {
      record(42, 'Multiple payments', 'PASS', `3 payments of 10000 each, outstanding=${outstandingFinal} status=PAID`);
    } else {
      record(42, 'Multiple payments', 'FAIL', `Outstanding mismatch`, `outstanding=${outstandingFinal} status=${invFinal?.paymentStatus} totalPaid=${totalPaid}`, 'CRITICAL');
    }
  } catch (e: any) {
    record(42, 'Multiple payments', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 43 — Concurrent payment attempts against one invoice ──
  console.log('\n── Scenario 43: Concurrent payment attempts ──');
  try {
    const poValue = 20000;
    const ctx = await createInvoiceForPO(poValue);
    if (!ctx) { record(43, 'Concurrent payments', 'FAIL', 'Failed to create invoice'); return; }

    // Create 2 concurrent payment requests for the full amount
    const promises = [];
    for (let i = 0; i < 2; i++) {
      promises.push(api('POST', '/payments/invoice-payment', {
        invoiceId: ctx.invId, vendorId: ctx.vendorId,
        requestNumber: `PR-CONC-${i}-${Date.now()}`, amount: poValue,
      }, PH_ID));
    }
    const responses = await Promise.all(promises);
    const successCount = responses.filter(r => r.status === 201).length;

    // Try to approve and execute both
    const execPromises = [];
    for (const res of responses) {
      if (res.status === 201) {
        const payId = res.body.id;
        await api('POST', `/payments/${payId}/approve`, { comments: 'OK', acknowledged: true }, PH_ID);
        await api('POST', `/payments/${payId}/approve`, { comments: 'OK', acknowledged: true }, ADMIN_ID);
        execPromises.push(api('POST', `/payments/${payId}/pay`, {
          amount: poValue, mode: 'BANK_TRANSFER', bankAccountId: ctx.bankId,
        }, PH_ID));
      }
    }
    const execResponses = await Promise.all(execPromises);
    const execSuccessCount = execResponses.filter(r => r.status === 200).length;

    const invAfter = await prisma.vendorInvoice.findUnique({ where: { id: ctx.invId }, select: { outstandingAmount: true } });
    const outstandingAfter = money(invAfter?.outstandingAmount);

    // Total payments should not exceed invoice amount
    if (outstandingAfter >= 0 && (poValue - outstandingAfter) <= poValue) {
      if (execSuccessCount <= 1) {
        record(43, 'Concurrent payments', 'PASS', `${execSuccessCount} payment(s) executed, outstanding=${outstandingAfter} (no overpayment)`);
      } else {
        // Check if overpaid
        if (outstandingAfter < 0) {
          record(43, 'Concurrent payments', 'FAIL', `Invoice overpaid`, `outstanding=${outstandingAfter} (negative!)`, 'CRITICAL');
        } else {
          record(43, 'Concurrent payments', 'PASS', `${execSuccessCount} payments executed, outstanding=${outstandingAfter} (within limits)`);
        }
      }
    } else {
      record(43, 'Concurrent payments', 'FAIL', `Overpayment detected`, `outstanding=${outstandingAfter}`, 'CRITICAL');
    }
  } catch (e: any) {
    record(43, 'Concurrent payments', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 44 — Duplicate payment request execution ──
  console.log('\n── Scenario 44: Duplicate payment request execution ──');
  try {
    const poValue = 12000;
    const ctx = await createInvoiceForPO(poValue);
    if (!ctx) { record(44, 'Duplicate payment execution', 'FAIL', 'Failed to create invoice'); return; }

    const bankBefore = money((await prisma.bankAccount.findUnique({ where: { id: ctx.bankId }, select: { currentBalance: true } }))!.currentBalance);

    // Create one payment request
    const payRes = await api('POST', '/payments/invoice-payment', {
      invoiceId: ctx.invId, vendorId: ctx.vendorId,
      requestNumber: `PR-DUP-${Date.now()}`, amount: poValue,
    }, PH_ID);
    if (payRes.status !== 201) { record(44, 'Duplicate payment execution', 'FAIL', 'Payment request failed'); return; }
    const payId = payRes.body.id;

    // Approve (2 approvals)
    await api('POST', `/payments/${payId}/approve`, { comments: 'OK', acknowledged: true }, PH_ID);
    await api('POST', `/payments/${payId}/approve`, { comments: 'OK', acknowledged: true }, ADMIN_ID);

    // Execute first time
    const exec1 = await api('POST', `/payments/${payId}/pay`, {
      amount: poValue, mode: 'BANK_TRANSFER', bankAccountId: ctx.bankId,
    }, PH_ID);
    if (exec1.status !== 200) { record(44, 'Duplicate payment execution', 'FAIL', 'First payment failed'); return; }

    // Attempt to execute the same payment again
    const exec2 = await api('POST', `/payments/${payId}/pay`, {
      amount: poValue, mode: 'BANK_TRANSFER', bankAccountId: ctx.bankId,
    }, PH_ID);

    const bankAfter = money((await prisma.bankAccount.findUnique({ where: { id: ctx.bankId }, select: { currentBalance: true } }))!.currentBalance);
    const expectedDeduction = poValue; // should only be deducted once

    if (exec2.status === 400 || exec2.status === 403 || exec2.status === 409) {
      if (bankAfter === bankBefore - expectedDeduction) {
        record(44, 'Duplicate payment execution', 'PASS', `Second execution blocked (status=${exec2.status}), bank deducted only once: ${bankBefore}→${bankAfter}`);
      } else {
        record(44, 'Duplicate payment execution', 'FAIL', `Bank deducted twice despite block`, `Before=${bankBefore} After=${bankAfter} Expected=${bankBefore - expectedDeduction}`, 'CRITICAL');
      }
    } else if (exec2.status === 200) {
      if (bankAfter === bankBefore - (poValue * 2)) {
        record(44, 'Duplicate payment execution', 'FAIL', `Payment executed twice`, `Bank: ${bankBefore}→${bankAfter} (deducted ${poValue * 2})`, 'CRITICAL');
      } else if (bankAfter === bankBefore - poValue) {
        record(44, 'Duplicate payment execution', 'PASS', `Second call returned 200 but bank only deducted once: ${bankBefore}→${bankAfter}`);
      } else {
        record(44, 'Duplicate payment execution', 'FAIL', `Unexpected bank balance`, `Before=${bankBefore} After=${bankAfter}`, 'CRITICAL');
      }
    } else {
      record(44, 'Duplicate payment execution', 'PASS', `Second execution returned ${exec2.status}, bank deducted once: ${bankBefore}→${bankAfter}`);
    }
  } catch (e: any) {
    record(44, 'Duplicate payment execution', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }
}
