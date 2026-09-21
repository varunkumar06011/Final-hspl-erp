/** SECTION A — Scenarios 1-5: Auth, CRUD, Approval workflows */
import { record, api, prisma, PH_ID, HOC_ID, PROJECT_ID, createVendor, createAndApproveQuotation } from './helpers';

export async function sectionA() {
  console.log('\n═══ SECTION A — Authentication and Basic System Operations ═══');

  // ── Scenario 1 — Login and dashboard ──
  console.log('\n── Scenario 1: Login and dashboard ──');
  try {
    const me = await api('GET', '/auth/me', undefined, PH_ID);
    if (me.status === 200 && me.body.role === 'PROJECT_HEAD' && me.body.projectId === PROJECT_ID) {
      const dash = await api('GET', '/dashboard/summary', undefined, PH_ID);
      if (dash.status === 200 && dash.body.project) {
        record(1, 'Login and dashboard', 'PASS', `User=${me.body.name} role=${me.body.role} dashboard OK`);
      } else {
        record(1, 'Login and dashboard', 'FAIL', `Dashboard failed: ${dash.status}`, `Dashboard returned ${dash.status}`, 'HIGH');
      }
    } else {
      record(1, 'Login and dashboard', 'FAIL', `Auth failed: ${me.status}`, `Unexpected status ${me.status}`, 'CRITICAL');
    }
  } catch (e: any) {
    record(1, 'Login and dashboard', 'FAIL', `Exception: ${e.message}`, e.message, 'CRITICAL');
  }

  // ── Scenario 2 — Create and view a normal operational record ──
  console.log('\n── Scenario 2: Create and view a normal operational record ──');
  try {
    const phaseName = `TestPhase-${Date.now()}`;
    const createRes = await api('POST', '/phases', { name: phaseName }, PH_ID);
    if (createRes.status !== 201) {
      record(2, 'Create and view record', 'FAIL', `Create failed: ${createRes.status}`, JSON.stringify(createRes.body).slice(0, 200), 'HIGH');
    } else {
      const phaseId = createRes.body.id;
      const getRes = await api('GET', `/phases`, undefined, PH_ID);
      const found = getRes.body.data?.find((p: any) => p.id === phaseId);
      if (found && found.name === phaseName) {
        record(2, 'Create and view record', 'PASS', `Phase created and retrieved, name matches`);
      } else {
        record(2, 'Create and view record', 'FAIL', `Record not found after create`, 'Data disappeared after reload', 'HIGH');
      }
    }
  } catch (e: any) {
    record(2, 'Create and view record', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 3 — Edit an existing record ──
  console.log('\n── Scenario 3: Edit an existing record ──');
  try {
    const phaseName = `EditTest-${Date.now()}`;
    const createRes = await api('POST', '/phases', { name: phaseName }, PH_ID);
    if (createRes.status !== 201) {
      record(3, 'Edit existing record', 'FAIL', `Create failed: ${createRes.status}`, JSON.stringify(createRes.body).slice(0, 200), 'HIGH');
    } else {
      const phaseId = createRes.body.id;
      const newName = `Edited-${Date.now()}`;
      const newProgress = 50;
      const editRes = await api('PATCH', `/phases/${phaseId}`, { name: newName, progressPercent: newProgress }, PH_ID);
      if (editRes.status !== 200) {
        record(3, 'Edit existing record', 'FAIL', `Edit failed: ${editRes.status}`, JSON.stringify(editRes.body).slice(0, 200), 'HIGH');
      } else {
        const dbPhase = await prisma.phase.findUnique({ where: { id: phaseId } });
        if (dbPhase && dbPhase.name === newName && Number(dbPhase.progressPercent) === newProgress) {
          record(3, 'Edit existing record', 'PASS', `Phase edited, DB confirms new name and progress`);
        } else {
          record(3, 'Edit existing record', 'FAIL', `DB mismatch after edit`, `DB: name=${dbPhase?.name} progress=${dbPhase?.progressPercent}`, 'HIGH');
        }
      }
    }
  } catch (e: any) {
    record(3, 'Edit existing record', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 4 — Approval workflow happy path ──
  console.log('\n── Scenario 4: Approval workflow happy path ──');
  try {
    const vendorId = await createVendor('ApprVendor');
    if (!vendorId) {
      record(4, 'Approval happy path', 'FAIL', `Vendor create failed`);
    } else {
      const qId = await createAndApproveQuotation(vendorId, [
        { materialName: 'Test Material', quantity: 1, unit: 'NOS', unitPrice: 1000 }
      ]);
      if (!qId) {
        record(4, 'Approval happy path', 'FAIL', `Quotation create/approve failed`);
      } else {
        const dbQ = await prisma.quotation.findUnique({ where: { id: qId }, include: { approvalWorkflow: { include: { steps: true } } } });
        const steps = dbQ?.approvalWorkflow?.steps ?? [];
        if (dbQ && dbQ.status === 'APPROVED' && steps.length >= 2) {
          record(4, 'Approval happy path', 'PASS', `Quotation APPROVED with ${steps.length} approval steps recorded`);
        } else {
          record(4, 'Approval happy path', 'FAIL', `DB status=${dbQ?.status} steps=${steps.length}`, 'Expected APPROVED with 2+ steps', 'HIGH');
        }
      }
    }
  } catch (e: any) {
    record(4, 'Approval happy path', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 5 — Approval workflow rejection path ──
  console.log('\n── Scenario 5: Approval workflow rejection path ──');
  try {
    const vendorId = await createVendor('RejVendor');
    if (!vendorId) {
      record(5, 'Approval rejection path', 'FAIL', `Vendor create failed`);
    } else {
      const qRes = await api('POST', '/quotations', {
        vendorId,
        items: [{ materialName: 'Rejection Test', quantity: 1, unit: 'NOS', unitPrice: 500 }],
        acknowledged: true,
      }, PH_ID);
      if (qRes.status !== 201) {
        record(5, 'Approval rejection path', 'FAIL', `Quotation create failed: ${qRes.status}`, JSON.stringify(qRes.body).slice(0, 200), 'HIGH');
      } else {
        const qId = qRes.body.id;
        // Reject step 1 (PROJECT_HEAD)
        const reject1 = await api('POST', `/quotations/${qId}/reject`, { reason: 'Pricing too high', acknowledged: true }, PH_ID);
        if (reject1.status !== 200) {
          record(5, 'Approval rejection path', 'FAIL', `Reject step 1 failed: ${reject1.status}`, JSON.stringify(reject1.body).slice(0, 200), 'HIGH');
        } else {
          // Reject step 2 (HEAD_OF_CONSTRUCTION) — need 2 rejections since minApprovers=2
          const reject2 = await api('POST', `/quotations/${qId}/reject`, { reason: 'Agreed, too expensive', acknowledged: true }, HOC_ID);
          if (reject2.status !== 200) {
            record(5, 'Approval rejection path', 'FAIL', `Reject step 2 failed: ${reject2.status}`, JSON.stringify(reject2.body).slice(0, 200), 'HIGH');
          } else {
            const dbQ = await prisma.quotation.findUnique({ where: { id: qId } });
            const poCount = await prisma.purchaseOrder.count({ where: { quotationId: qId } });
            if (dbQ && dbQ.status === 'REJECTED' && poCount === 0) {
              record(5, 'Approval rejection path', 'PASS', `Quotation rejected (2 rejections), no PO created`);
            } else {
              record(5, 'Approval rejection path', 'FAIL', `DB status=${dbQ?.status} POs=${poCount}`, 'Expected REJECTED with 0 POs', 'HIGH');
            }
          }
        }
      }
    }
  } catch (e: any) {
    record(5, 'Approval rejection path', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }
}
