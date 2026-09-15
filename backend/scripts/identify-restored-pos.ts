/**
 * READ-ONLY diagnostic script.
 *
 * Identifies Purchase Orders that were previously DELETED or REJECTED (per
 * AuditLog) but whose current status is NO LONGER DELETED/REJECTED — meaning
 * they were "restored" back into the active workflow.
 *
 * This script makes NO database changes. It only reads and reports.
 *
 * Identification logic:
 *   1. Find all AuditLog entries for entityType = 'PURCHASE_ORDER' with
 *      action = 'DELETE' or 'REJECT'.
 *   2. For each unique entityId (PO id), fetch the current PO record.
 *   3. If the PO was deleted (audit action DELETE) but current status != DELETED,
 *      it was restored.
 *   4. If the PO was rejected (audit action REJECT) but current status != REJECTED,
 *      it was restored.
 *   5. Cross-verify with the approval workflow steps to confirm.
 *   6. Report the full list with audit history for manual review.
 *
 * Usage: npx tsx scripts/identify-restored-pos.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface RestoredPO {
  poId: string;
  poNumber: string;
  currentStatus: string;
  auditAction: string; // 'DELETE' or 'REJECT'
  auditTimestamp: Date;
  auditUserId: string;
  auditUserName: string;
  auditNewValue: unknown;
  projectId: string;
  projectName: string;
  vendorName: string;
  createdAt: Date;
  updatedAt: Date;
  grandTotal: string;
  approvalWorkflowStatus: string | null;
  approvalSteps: { stepNumber: number; approverRole: string; status: string; decidedAt: Date | null; comments: string | null }[];
  allAuditEntries: { action: string; timestamp: Date; userName: string; newValue: unknown }[];
}

async function main() {
  console.log('='.repeat(80));
  console.log('READ-ONLY DIAGNOSTIC: Identifying restored POs (previously DELETED/REJECTED)');
  console.log('='.repeat(80));
  console.log();

  // Step 1: Find all DELETE/REJECT audit entries for PURCHASE_ORDER
  const deleteRejectAudits = await prisma.auditLog.findMany({
    where: {
      entityType: 'PURCHASE_ORDER',
      action: { in: ['DELETE', 'REJECT'] },
    },
    include: {
      user: { select: { id: true, name: true, role: true } },
    },
    orderBy: { timestamp: 'asc' },
  });

  console.log(`Found ${deleteRejectAudits.length} DELETE/REJECT audit entries for PURCHASE_ORDER entities.`);
  console.log();

  // Step 2: Group by entityId (PO id) to get unique POs that were deleted/rejected
  const poAuditMap = new Map<string, { action: string; timestamp: Date; userId: string; userName: string; newValue: unknown }[]>();

  for (const audit of deleteRejectAudits) {
    const poId = audit.entityId;
    if (!poAuditMap.has(poId)) {
      poAuditMap.set(poId, []);
    }
    poAuditMap.get(poId)!.push({
      action: audit.action,
      timestamp: audit.timestamp,
      userId: audit.userId,
      userName: audit.user?.name ?? 'Unknown',
      newValue: audit.newValue,
    });
  }

  console.log(`Unique POs with DELETE/REJECT audit history: ${poAuditMap.size}`);
  console.log();

  // Step 3: For each PO, check current status
  const restoredPOs: RestoredPO[] = [];

  for (const [poId, audits] of poAuditMap) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        project: { select: { id: true, name: true } },
        vendor: { select: { name: true } },
        approvalWorkflow: {
          include: {
            steps: {
              select: {
                stepNumber: true,
                approverRole: true,
                status: true,
                decidedAt: true,
                comments: true,
              },
              orderBy: { stepNumber: 'asc' },
            },
          },
        },
      },
    });

    if (!po) {
      console.log(`  [SKIP] PO ${poId} no longer exists in database (hard-deleted). Audits: ${audits.map(a => a.action).join(', ')}`);
      continue;
    }

    // Check if this PO was restored:
    // - If it has a DELETE audit but current status != DELETED → restored
    // - If it has a REJECT audit but current status != REJECTED → restored
    const hasDeleteAudit = audits.some(a => a.action === 'DELETE');
    const hasRejectAudit = audits.some(a => a.action === 'REJECT');

    const wasDeletedRestored = hasDeleteAudit && po.status !== 'DELETED';
    const wasRejectedRestored = hasRejectAudit && po.status !== 'REJECTED';

    if (!wasDeletedRestored && !wasRejectedRestored) {
      // PO is still in its deleted/rejected state — not restored, skip
      continue;
    }

    // This PO was restored! Collect full details.
    // Get ALL audit entries for this PO for complete history
    const allAudits = await prisma.auditLog.findMany({
      where: { entityType: 'PURCHASE_ORDER', entityId: poId },
      include: { user: { select: { name: true } } },
      orderBy: { timestamp: 'asc' },
    });

    // Determine the primary restore action (most recent DELETE or REJECT)
    const lastDeleteOrReject = audits
      .filter(a => a.action === 'DELETE' || a.action === 'REJECT')
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];

    restoredPOs.push({
      poId: po.id,
      poNumber: po.poNumber,
      currentStatus: po.status,
      auditAction: lastDeleteOrReject.action,
      auditTimestamp: lastDeleteOrReject.timestamp,
      auditUserId: lastDeleteOrReject.userId,
      auditUserName: lastDeleteOrReject.userName,
      auditNewValue: lastDeleteOrReject.newValue,
      projectId: po.projectId,
      projectName: po.project.name,
      vendorName: po.vendor.name,
      createdAt: po.createdAt,
      updatedAt: po.updatedAt,
      grandTotal: po.grandTotal.toString(),
      approvalWorkflowStatus: po.approvalWorkflow?.status ?? null,
      approvalSteps: po.approvalWorkflow?.steps.map(s => ({
        stepNumber: s.stepNumber,
        approverRole: s.approverRole,
        status: s.status,
        decidedAt: s.decidedAt,
        comments: s.comments,
      })) ?? [],
      allAuditEntries: allAudits.map(a => ({
        action: a.action,
        timestamp: a.timestamp,
        userName: a.user?.name ?? 'Unknown',
        newValue: a.newValue,
      })),
    });
  }

  // Step 4: Report
  console.log('='.repeat(80));
  console.log(`RESTORED POs FOUND: ${restoredPOs.length}`);
  console.log('='.repeat(80));
  console.log();

  if (restoredPOs.length === 0) {
    console.log('No restored POs found. All previously deleted/rejected POs remain in their deleted/rejected state.');
    console.log();
    console.log('If you still see duplicate/ambiguous POs, the issue may be:');
    console.log('  - POs created with duplicate poNumbers (check the @@unique constraint)');
    console.log('  - POs regenerated from a parent PO (check parentPoId / regenerationNumber)');
    console.log('  - POs that were edited-unapproved (status reset to PENDING_APPROVAL via edit-unapproved route)');
    return;
  }

  for (const po of restoredPOs) {
    console.log('-'.repeat(80));
    console.log(`PO Number:    ${po.poNumber}`);
    console.log(`PO ID:        ${po.poId}`);
    console.log(`Project:      ${po.projectName} (${po.projectId})`);
    console.log(`Vendor:       ${po.vendorName}`);
    console.log(`Grand Total:  ₹${po.grandTotal}`);
    console.log(`Created:      ${po.createdAt.toISOString()}`);
    console.log(`Updated:      ${po.updatedAt.toISOString()}`);
    console.log(`Current Status: ${po.currentStatus}`);
    console.log();
    console.log(`  Last DELETE/REJECT audit:`);
    console.log(`    Action:    ${po.auditAction}`);
    console.log(`    Timestamp: ${po.auditTimestamp.toISOString()}`);
    console.log(`    User:      ${po.auditUserName} (${po.auditUserId})`);
    console.log(`    NewValue:  ${JSON.stringify(po.auditNewValue)}`);
    console.log();
    console.log(`  Approval Workflow Status: ${po.approvalWorkflowStatus ?? 'N/A'}`);
    console.log(`  Approval Steps:`);
    for (const step of po.approvalSteps) {
      console.log(`    Step ${step.stepNumber}: ${step.approverRole} → ${step.status}${step.decidedAt ? ` (decided: ${step.decidedAt.toISOString()})` : ''}${step.comments ? ` — "${step.comments}"` : ''}`);
    }
    console.log();
    console.log(`  Full Audit History (${po.allAuditEntries.length} entries):`);
    for (const a of po.allAuditEntries) {
      console.log(`    ${a.timestamp.toISOString()} | ${a.action.padEnd(10)} | by ${a.userName} | ${JSON.stringify(a.newValue)}`);
    }
    console.log();

    // Determine if this PO appears in Action Required
    const appearsInActionRequired = !['APPROVED', 'REJECTED', 'CANCELLED', 'DELIVERED', 'PARTIALLY_DELIVERED', 'DELETED'].includes(po.currentStatus);
    console.log(`  → Appears in Action Required: ${appearsInActionRequired ? 'YES ⚠️' : 'No'}`);

    // Determine if this PO appears in active PO list
    const appearsInActiveList = po.currentStatus !== 'DELETED';
    console.log(`  → Appears in Active PO list:  ${appearsInActiveList ? 'YES ⚠️' : 'No'}`);

    // Recommendation
    const recommendation = po.auditAction === 'DELETE'
      ? `Set status back to DELETED (was deleted on ${po.auditTimestamp.toISOString()} by ${po.auditUserName})`
      : `Set status back to REJECTED (was rejected on ${po.auditTimestamp.toISOString()} by ${po.auditUserName})`;
    console.log(`  → Recommended action: ${recommendation}`);
    console.log();
  }

  // Summary table
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log();
  console.log('PO Number    | Current Status  | Last Audit Action | Audit Date           | In Action Required?');
  console.log('-'.repeat(80));
  for (const po of restoredPOs) {
    const inAction = !['APPROVED', 'REJECTED', 'CANCELLED', 'DELIVERED', 'PARTIALLY_DELIVERED', 'DELETED'].includes(po.currentStatus);
    console.log(`${po.poNumber.padEnd(13)}| ${po.currentStatus.padEnd(16)}| ${po.auditAction.padEnd(18)}| ${po.auditTimestamp.toISOString().slice(0, 19)}| ${inAction ? 'YES' : 'No'}`);
  }
  console.log();
  console.log(`Total restored POs: ${restoredPOs.length}`);
  console.log();
  console.log('To proceed with cleanup, review the list above and confirm which POs should be');
  console.log('reverted to their deleted/rejected status. This script is READ-ONLY — no changes made.');
}

main()
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
