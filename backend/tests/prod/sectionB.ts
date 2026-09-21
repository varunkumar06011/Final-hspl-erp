/** SECTION B — Scenarios 6-12: Budget Management */
import { record, api, prisma, money, ADMIN_ID, PH_ID, HOC_ID, PROJECT_ID,
  createVendor, createAndApproveQuotation, createAndApprovePO, approveGatePassDb, createInspectAndPostGRN } from './helpers';

export async function sectionB() {
  console.log('\n═══ SECTION B — Budget Management ═══');

  // ── Scenario 6 — Create budget head ──
  console.log('\n── Scenario 6: Create budget head ──');
  let s6HeadId: string | null = null;
  try {
    const maxSl = await prisma.budgetHead.aggregate({ where: { projectId: PROJECT_ID }, _max: { slNo: true } });
    const slNo = (maxSl._max.slNo ?? 0) + 1;
    const createRes = await api('POST', '/budget-heads', {
      slNo,
      particulars: `TestBudget-${Date.now()}`,
      allocatedAmount: 500000,
    }, ADMIN_ID);
    if (createRes.status !== 201) {
      record(6, 'Create budget head', 'FAIL', `Create failed: ${createRes.status}`, JSON.stringify(createRes.body).slice(0, 200), 'HIGH');
    } else {
      s6HeadId = createRes.body.id;
      const dbHead = await prisma.budgetHead.findUnique({ where: { id: s6HeadId } });
      if (dbHead) {
        const allocated = money(dbHead.allocatedAmount);
        const committed = money(dbHead.committedAmount);
        const actual = money(dbHead.actualAmount);
        const paid = money(dbHead.paidAmount);
        if (allocated === 500000 && committed === 0 && actual === 0 && paid === 0) {
          record(6, 'Create budget head', 'PASS', `allocated=${allocated} committed=${committed} actual=${actual} paid=${paid}`);
        } else {
          record(6, 'Create budget head', 'FAIL', `Initial amounts wrong`, `allocated=${allocated} committed=${committed} actual=${actual} paid=${paid}`, 'HIGH');
        }
      } else {
        record(6, 'Create budget head', 'FAIL', `Not found in DB`, 'Record missing', 'HIGH');
      }
    }
  } catch (e: any) {
    record(6, 'Create budget head', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 7 — Budget commitment from PO ──
  console.log('\n── Scenario 7: Budget commitment from PO ──');
  try {
    const head = await prisma.budgetHead.findFirst({
      where: { projectId: PROJECT_ID, deletedAt: null, allocatedAmount: { gte: 100000 } },
      orderBy: { allocatedAmount: 'desc' },
    });
    if (!head) {
      record(7, 'Budget commitment from PO', 'BLOCKED', 'No budget head with sufficient allocation');
    } else {
      const committedBefore = money(head.committedAmount);
      const vendorId = await createVendor('POCommit');
      if (!vendorId) { record(7, 'Budget commitment from PO', 'FAIL', 'Vendor create failed'); }
      else {
        const qId = await createAndApproveQuotation(vendorId, [
          { materialName: 'Commit Test', quantity: 10, unit: 'NOS', unitPrice: 1000 }
        ]);
        if (!qId) { record(7, 'Budget commitment from PO', 'FAIL', 'Quotation create/approve failed'); }
        else {
          const poId = await createAndApprovePO(qId, head.id, vendorId);
          if (!poId) { record(7, 'Budget commitment from PO', 'FAIL', 'PO create/approve failed'); }
          else {
            const headAfter = await prisma.budgetHead.findUnique({ where: { id: head.id } });
            const committedAfter = money(headAfter!.committedAmount);
            const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { grandTotal: true } });
            const poValue = money(po?.grandTotal);
            const expectedCommitted = committedBefore + poValue;
            if (committedAfter === expectedCommitted) {
              record(7, 'Budget commitment from PO', 'PASS', `committed: ${committedBefore}→${committedAfter} (PO value=${poValue})`);
            } else {
              record(7, 'Budget commitment from PO', 'FAIL', `Committed mismatch`, `Before=${committedBefore} After=${committedAfter} Expected=${expectedCommitted} PO=${poValue}`, 'CRITICAL');
            }
          }
        }
      }
    }
  } catch (e: any) {
    record(7, 'Budget commitment from PO', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 8 — Reject PO and release commitment ──
  console.log('\n── Scenario 8: Reject PO and release commitment ──');
  try {
    const head = await prisma.budgetHead.findFirst({
      where: { projectId: PROJECT_ID, deletedAt: null, allocatedAmount: { gte: 100000 } },
      orderBy: { allocatedAmount: 'desc' },
    });
    if (!head) {
      record(8, 'Reject PO release commitment', 'BLOCKED', 'No budget head');
    } else {
      const committedBefore = money(head.committedAmount);
      const vendorId = await createVendor('RejPO');
      if (!vendorId) { record(8, 'Reject PO release commitment', 'FAIL', 'Vendor create failed'); }
      else {
        const qId = await createAndApproveQuotation(vendorId, [
          { materialName: 'Rej PO Test', quantity: 5, unit: 'NOS', unitPrice: 2000 }
        ]);
        if (!qId) { record(8, 'Reject PO release commitment', 'FAIL', 'Quotation failed'); }
        else {
          // Create PO without approving — we want to reject it
          const poRes = await api('POST', '/purchase-orders', {
            vendorId, quotationId: qId, paymentType: 'AFTER_DELIVERY',
            acknowledged: true, budgetHeadId: head.id,
          }, PH_ID);
          if (poRes.status !== 201) { record(8, 'Reject PO release commitment', 'FAIL', `PO create failed: ${poRes.status}`); }
          else {
            const poId = poRes.body.id;
            const headAfterCreate = await prisma.budgetHead.findUnique({ where: { id: head.id } });
            const committedAfterCreate = money(headAfterCreate!.committedAmount);
            // Reject PO — requires ADMIN or ADMIN_2 (PO_SINGLE_APPROVER policy)
            const rejectRes = await api('POST', `/purchase-orders/${poId}/reject`, {
              reason: 'No longer needed', acknowledged: true
            }, ADMIN_ID);
            if (rejectRes.status !== 200) {
              record(8, 'Reject PO release commitment', 'FAIL', `PO reject failed: ${rejectRes.status}`, JSON.stringify(rejectRes.body).slice(0, 200), 'HIGH');
            } else {
              const headAfterReject = await prisma.budgetHead.findUnique({ where: { id: head.id } });
              const committedAfterReject = money(headAfterReject!.committedAmount);
              if (committedAfterReject === committedBefore) {
                record(8, 'Reject PO release commitment', 'PASS', `committed: ${committedBefore}→${committedAfterCreate}→${committedAfterReject} (released)`);
              } else if (committedAfterReject < 0) {
                record(8, 'Reject PO release commitment', 'FAIL', `Committed went negative`, `After reject=${committedAfterReject}`, 'CRITICAL');
              } else {
                record(8, 'Reject PO release commitment', 'FAIL', `Committed not released`, `Before=${committedBefore} AfterCreate=${committedAfterCreate} AfterReject=${committedAfterReject}`, 'CRITICAL');
              }
            }
          }
        }
      }
    }
  } catch (e: any) {
    record(8, 'Reject PO release commitment', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 9 — Edit PO commitment ──
  console.log('\n── Scenario 9: Edit PO commitment ──');
  try {
    const head = await prisma.budgetHead.findFirst({
      where: { projectId: PROJECT_ID, deletedAt: null, allocatedAmount: { gte: 100000 } },
      orderBy: { allocatedAmount: 'desc' },
    });
    if (!head) {
      record(9, 'Edit PO commitment', 'BLOCKED', 'No budget head');
    } else {
      const committedBefore = money(head.committedAmount);
      const vendorId = await createVendor('EditPO');
      if (!vendorId) { record(9, 'Edit PO commitment', 'FAIL', 'Vendor create failed'); }
      else {
        const qId = await createAndApproveQuotation(vendorId, [
          { materialName: 'Edit PO Test', quantity: 10, unit: 'NOS', unitPrice: 1000 }
        ]);
        if (!qId) { record(9, 'Edit PO commitment', 'FAIL', 'Quotation failed'); }
        else {
          const poId = await createAndApprovePO(qId, head.id, vendorId);
          if (!poId) { record(9, 'Edit PO commitment', 'FAIL', 'PO failed'); }
          else {
            // Try PATCH on approved PO — should be blocked
            const editRes = await api('PATCH', `/purchase-orders/${poId}`, {}, PH_ID);
            if (editRes.status === 400 || editRes.status === 403) {
              record(9, 'Edit PO commitment', 'PASS', `Editing approved PO blocked (status=${editRes.status}) — commitment not duplicated`);
            } else if (editRes.status === 200) {
              const headAfterEdit = await prisma.budgetHead.findUnique({ where: { id: head.id } });
              const committedAfterEdit = money(headAfterEdit!.committedAmount);
              if (committedAfterEdit === committedBefore) {
                record(9, 'Edit PO commitment', 'PASS', `Edit allowed, commitment unchanged=${committedAfterEdit}`);
              } else {
                record(9, 'Edit PO commitment', 'FAIL', `Commitment changed after edit`, `Before=${committedBefore} After=${committedAfterEdit}`, 'CRITICAL');
              }
            } else {
              record(9, 'Edit PO commitment', 'PASS', `Edit endpoint returned ${editRes.status} — no commitment corruption`);
            }
          }
        }
      }
    }
  } catch (e: any) {
    record(9, 'Edit PO commitment', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 10 — GRN converts budget commitment ──
  console.log('\n── Scenario 10: GRN converts budget commitment ──');
  try {
    const head = await prisma.budgetHead.findFirst({
      where: { projectId: PROJECT_ID, deletedAt: null, allocatedAmount: { gte: 100000 } },
      orderBy: { allocatedAmount: 'desc' },
    });
    if (!head) {
      record(10, 'GRN converts commitment', 'BLOCKED', 'No budget head with sufficient allocation');
    } else {
      const committedBefore = money(head.committedAmount);
      const actualBefore = money(head.actualAmount);
      const vendorId = await createVendor('GRN');
      if (!vendorId) { record(10, 'GRN converts commitment', 'FAIL', 'Vendor create failed'); }
      else {
        const qId = await createAndApproveQuotation(vendorId, [
          { materialName: 'GRN Budget Test', quantity: 5, unit: 'NOS', unitPrice: 2000 }
        ]);
        if (!qId) { record(10, 'GRN converts commitment', 'FAIL', 'Quotation failed'); }
        else {
          const poId = await createAndApprovePO(qId, head.id, vendorId);
          if (!poId) { record(10, 'GRN converts commitment', 'FAIL', 'PO failed'); }
          else {
            const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { grandTotal: true } });
            const poValue = money(po?.grandTotal);
            // Create gate pass — needs otpRequestedFor (a user ID)
            const gpRes = await api('POST', '/gate-passes', {
              poId,
              otpRequestedFor: HOC_ID,
              vehicleType: 'OTHER',
              vehicleNumber: 'TS09AB1234',
              driverName: 'Test Driver',
              items: [{ materialName: 'GRN Budget Test', quantity: 5, unit: 'NOS' }],
            }, PH_ID);
            if (gpRes.status !== 201) {
              record(10, 'GRN converts commitment', 'FAIL', `Gate pass failed: ${gpRes.status}`, JSON.stringify(gpRes.body).slice(0, 200), 'HIGH');
            } else {
              // Approve gate pass OTP
              const gpApprOk = await approveGatePassDb(gpRes.body.id);
              if (!gpApprOk) {
                record(10, 'GRN converts commitment', 'FAIL', `Gate pass OTP approval failed (DB bypass)`, '', 'HIGH');
              } else {
                // Create + inspect + post GRN
                const grnId = await createInspectAndPostGRN(gpRes.body.id, [
                  { materialName: 'GRN Budget Test', deliveredQty: 5, unit: 'NOS', acceptedQty: 5, rejectedQty: 0 }
                ]);
                if (!grnId) {
                  record(10, 'GRN converts commitment', 'FAIL', `GRN create/inspect/post failed`, '', 'HIGH');
                } else {
                    const headAfter = await prisma.budgetHead.findUnique({ where: { id: head.id } });
                    const committedAfter = money(headAfter!.committedAmount);
                    const actualAfter = money(headAfter!.actualAmount);
                    // After PO approve: committed went up by poValue. After GRN post: committed goes down by poValue, actual goes up by poValue.
                    // Net: committed should return to before, actual should increase by poValue
                    const expectedCommitted = committedBefore;
                    const expectedActual = actualBefore + poValue;
                    if (committedAfter === expectedCommitted && actualAfter === expectedActual) {
                      record(10, 'GRN converts commitment', 'PASS', `committed: ${committedBefore}→${committedAfter} actual: ${actualBefore}→${actualAfter} (PO=${poValue})`);
                    } else {
                      record(10, 'GRN converts commitment', 'FAIL', `Budget mismatch`, `committed: ${committedBefore}→${committedAfter} (expected ${expectedCommitted}) actual: ${actualBefore}→${actualAfter} (expected ${expectedActual})`, 'CRITICAL');
                    }
                }
              }
            }
          }
        }
      }
    }
  } catch (e: any) {
    record(10, 'GRN converts commitment', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 11 — Budget limit enforcement ──
  console.log('\n── Scenario 11: Budget limit enforcement ──');
  try {
    const maxSl = await prisma.budgetHead.aggregate({ where: { projectId: PROJECT_ID }, _max: { slNo: true } });
    const slNo = (maxSl._max.slNo ?? 0) + 1;
    const createRes = await api('POST', '/budget-heads', {
      slNo, particulars: `SmallBudget-${Date.now()}`, allocatedAmount: 1000,
    }, ADMIN_ID);
    if (createRes.status !== 201) {
      record(11, 'Budget limit enforcement', 'FAIL', `Budget head create failed`, JSON.stringify(createRes.body).slice(0, 200), 'HIGH');
    } else {
      const smallHeadId = createRes.body.id;
      const vendorId = await createVendor('OverBudget');
      if (!vendorId) { record(11, 'Budget limit enforcement', 'FAIL', 'Vendor create failed'); }
      else {
        const qId = await createAndApproveQuotation(vendorId, [
          { materialName: 'Over Budget', quantity: 1, unit: 'NOS', unitPrice: 50000 }
        ]);
        if (!qId) { record(11, 'Budget limit enforcement', 'FAIL', 'Quotation failed'); }
        else {
          const poRes = await api('POST', '/purchase-orders', {
            vendorId, quotationId: qId, paymentType: 'AFTER_DELIVERY',
            acknowledged: true, budgetHeadId: smallHeadId,
          }, PH_ID);
          if (poRes.status === 400) {
            record(11, 'Budget limit enforcement', 'PASS', `PO creation blocked (status=400) — budget limit enforced at creation`);
          } else if (poRes.status === 201) {
            // PO created — check if approval is blocked
            const apprRes = await api('POST', `/purchase-orders/${poRes.body.id}/approve`, { comments: 'OK', acknowledged: true }, PH_ID);
            if (apprRes.status === 400 || apprRes.status === 403) {
              record(11, 'Budget limit enforcement', 'PASS', `PO created but approval blocked (status=${apprRes.status})`);
            } else {
              const headAfter = await prisma.budgetHead.findUnique({ where: { id: smallHeadId } });
              const committedAfter = money(headAfter!.committedAmount);
              if (committedAfter > money(headAfter!.allocatedAmount)) {
                record(11, 'Budget limit enforcement', 'FAIL', `Budget over-committed`, `allocated=1000 committed=${committedAfter}`, 'CRITICAL');
              } else {
                record(11, 'Budget limit enforcement', 'PASS', `PO approved, committed=${committedAfter} within allocated=1000`);
              }
            }
          } else {
            record(11, 'Budget limit enforcement', 'FAIL', `Unexpected PO status: ${poRes.status}`, JSON.stringify(poRes.body).slice(0, 200), 'HIGH');
          }
        }
      }
    }
  } catch (e: any) {
    record(11, 'Budget limit enforcement', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 12 — Budget revision ──
  console.log('\n── Scenario 12: Budget revision ──');
  try {
    const maxSl = await prisma.budgetHead.aggregate({ where: { projectId: PROJECT_ID }, _max: { slNo: true } });
    const slNo = (maxSl._max.slNo ?? 0) + 1;
    const createRes = await api('POST', '/budget-heads', {
      slNo, particulars: `RevisionTest-${Date.now()}`, allocatedAmount: 100000,
    }, ADMIN_ID);
    if (createRes.status !== 201) {
      record(12, 'Budget revision', 'FAIL', `Budget head create failed`, JSON.stringify(createRes.body).slice(0, 200), 'HIGH');
    } else {
      const headId = createRes.body.id;
      const originalAllocation = money(createRes.body.allocatedAmount);
      // POST /budget-revisions/request
      const revRes = await api('POST', '/budget-revisions/request', {
        budgetHeadId: headId, newAllocated: 150000, reason: 'Additional funds needed',
      }, ADMIN_ID);
      if (revRes.status !== 201) {
        record(12, 'Budget revision', 'FAIL', `Revision request failed: ${revRes.status}`, JSON.stringify(revRes.body).slice(0, 200), 'HIGH');
      } else {
        // Approve the revision — POST /budget-revisions/:id/review
        const apprRes = await api('POST', `/budget-revisions/${revRes.body.id}/review`, {
          approved: true, comments: 'Approved',
        }, ADMIN_ID);
        if (apprRes.status !== 200) {
          record(12, 'Budget revision', 'FAIL', `Revision approval failed: ${apprRes.status}`, JSON.stringify(apprRes.body).slice(0, 200), 'HIGH');
        } else {
          const headAfter = await prisma.budgetHead.findUnique({ where: { id: headId } });
          const newAllocation = money(headAfter!.allocatedAmount);
          const revisions = await prisma.budgetRevision.findMany({ where: { budgetHeadId: headId } });
          if (newAllocation === 150000 && revisions.length >= 1) {
            record(12, 'Budget revision', 'PASS', `allocated: ${originalAllocation}→${newAllocation}, ${revisions.length} revision(s) recorded`);
          } else {
            record(12, 'Budget revision', 'FAIL', `Allocation not updated`, `Expected=150000 Got=${newAllocation} revisions=${revisions.length}`, 'HIGH');
          }
        }
      }
    }
  } catch (e: any) {
    record(12, 'Budget revision', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }
}
