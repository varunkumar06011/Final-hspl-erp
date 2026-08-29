import { prisma } from '../config/prisma';
import {
  APPROVER_ROLES,
  AuditAction,
  QuotationStatus,
  getRequiredApproverCount,
} from '@hospital-erp/shared';
import { generateSequenceNumber } from './sequence.service';
import * as approvalService from './approval.service';
import { notifyApprovers } from './push.service';
import { logAudit } from './audit.service';

export interface QuotationLineItem {
  materialName: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  gstRate?: number;
}

export interface CreateQuotationInput {
  projectId: string;
  vendorId: string;
  items: QuotationLineItem[];
  createdBy: string;
  quotationNumber?: string;
  workTaskId?: string;
  filePath?: string | null;
  fileName?: string | null;
  fileMimeType?: string | null;
}

const quotationInclude = {
  vendor: { select: { id: true, name: true, vendorCode: true } },
  items: true,
  createdByUser: { select: { id: true, name: true } },
  approvalWorkflow: {
    include: {
      steps: {
        orderBy: { stepNumber: 'asc' as const },
        include: { approverUser: { select: { id: true, name: true, role: true } } },
      },
    },
  },
};

export { quotationInclude };

async function generateQuotationNumber(projectId: string): Promise<string> {
  return generateSequenceNumber('quotation', 'quotationNumber', 'VGH-Q', 3, { projectId });
}

export { generateQuotationNumber };

/**
 * Core quotation creation logic — shared by the quotations endpoint and the
 * "generate quotation from work task" endpoint. Validates the vendor, auto-
 * registers any new vendor materials, computes totals, creates the quotation
 * with its line items, kicks off the approval workflow, logs an audit entry,
 * and notifies approvers via push.
 *
 * Returns the created quotation with the standard includes.
 */
export async function createQuotation(input: CreateQuotationInput) {
  const {
    projectId,
    vendorId,
    items,
    createdBy,
    quotationNumber: providedNumber,
    workTaskId,
    filePath = null,
    fileName = null,
    fileMimeType = null,
  } = input;

  // Validate vendor exists and belongs to project
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, projectId, deletedAt: null },
    include: { materials: true },
  });
  if (!vendor) {
    throw new Error('Vendor not found');
  }

  // Auto-register any materials from the quotation that aren't yet in vendor's materials
  const vendorMaterialNames = vendor.materials.map((m) => m.name.toLowerCase());
  const newMaterials = items
    .filter((item) => !vendorMaterialNames.includes(item.materialName.toLowerCase()))
    .map((item) => ({ name: item.materialName, unit: item.unit || null }));
  if (newMaterials.length > 0) {
    await prisma.vendorMaterial.createMany({
      data: newMaterials.map((m) => ({
        vendorId: vendor.id,
        name: m.name,
        unit: m.unit,
      })),
    });
    console.log(
      `[Quotation] Auto-registered ${newMaterials.length} new material(s) for vendor "${vendor.name}"`
    );
  }

  // Calculate totals — GST is auto-derived from per-item gstRate
  const itemsWithAmounts = items.map((item) => {
    const amount = item.quantity * item.unitPrice;
    const rate = Number(item.gstRate) || 0;
    return {
      materialName: item.materialName,
      quantity: item.quantity,
      unit: item.unit || null,
      unitPrice: item.unitPrice,
      amount,
      gstRate: rate,
    };
  });
  const totalAmount = itemsWithAmounts.reduce((sum, i) => sum + Number(i.amount), 0);
  const gstAmount = itemsWithAmounts.reduce(
    (sum, i) => sum + Number(i.amount) * Number(i.gstRate) / 100,
    0
  );
  const grandTotal = totalAmount + gstAmount;

  const quotationNumber = providedNumber ?? (await generateQuotationNumber(projectId));

  // Create quotation
  const quotation = await prisma.quotation.create({
    data: {
      projectId,
      vendorId,
      quotationNumber,
      status: QuotationStatus.SUBMITTED,
      totalAmount,
      gstAmount,
      grandTotal,
      filePath,
      fileName,
      fileMimeType,
      createdBy,
      items: { create: itemsWithAmounts },
    },
    include: quotationInclude,
  });

  // Initiate approval workflow
  const workflow = await approvalService.initiate({
    entityType: 'QUOTATION',
    entityId: quotation.id,
    projectId,
    minApprovers: getRequiredApproverCount(grandTotal),
    approvalPolicy: 'HEAD_GROUPS',
  });

  // Link the workflow and return the full record (with includes) in one call.
  const result = await prisma.quotation.update({
    where: { id: quotation.id },
    data: { approvalWorkflowId: workflow.id },
    include: quotationInclude,
  });

  await logAudit({
    userId: createdBy,
    action: AuditAction.CREATE,
    entityType: 'QUOTATION',
    entityId: quotation.id,
    projectId,
    newValue: { quotationNumber, vendorId, totalAmount, grandTotal, acknowledged: true },
  });

  // Notify all approvers via push notification
  notifyApprovers(projectId, [...APPROVER_ROLES], {
    approvalId: workflow.id,
    entityType: 'QUOTATION',
    entityId: quotation.id,
    title: 'New Approval Required',
    body: `Quotation ${quotationNumber} from ${quotation.vendor?.name ?? 'vendor'} — ₹${grandTotal}`,
    url: `/quotations?approval=${workflow.id}`,
  }).catch((err) => console.error('[Push] Quotation notification error:', err));

  // If raised from a work task, link the quotation back to it and advance
  // the work task from PLANNED to IN_PROGRESS.
  if (workTaskId) {
    await prisma.workTaskQuotation.create({
      data: { workTaskId, quotationId: quotation.id, createdBy },
    }).catch(() => {
      // The unique constraint may fire if already linked — safe to ignore.
    });
    const workTask = await prisma.workTask.findFirst({
      where: { id: workTaskId, projectId },
      select: { status: true },
    });
    const statusPatch = workTask?.status === 'PLANNED' ? { status: 'IN_PROGRESS' } : {};
    await prisma.workTask.update({
      where: { id: workTaskId },
      data: { linkedQuotationId: quotation.id, ...statusPatch },
    });
  }

  return result;
}
