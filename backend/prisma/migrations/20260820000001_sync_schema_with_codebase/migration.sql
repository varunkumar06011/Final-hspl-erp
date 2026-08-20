-- DropForeignKey
ALTER TABLE "gate_passes" DROP CONSTRAINT "gate_passes_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "gate_passes" DROP CONSTRAINT "gate_passes_poId_fkey";

-- DropForeignKey
ALTER TABLE "inspections" DROP CONSTRAINT "inspections_activityId_fkey";

-- DropForeignKey
ALTER TABLE "inspections" DROP CONSTRAINT "inspections_phaseId_fkey";

-- DropForeignKey
ALTER TABLE "issues" DROP CONSTRAINT "issues_activityId_fkey";

-- DropForeignKey
ALTER TABLE "issues" DROP CONSTRAINT "issues_phaseId_fkey";

-- DropForeignKey
ALTER TABLE "labour_attendance" DROP CONSTRAINT "labour_attendance_activityId_fkey";

-- DropForeignKey
ALTER TABLE "labour_attendance" DROP CONSTRAINT "labour_attendance_phaseId_fkey";

-- DropForeignKey
ALTER TABLE "labour_attendance" DROP CONSTRAINT "labour_attendance_projectId_fkey";

-- DropForeignKey
ALTER TABLE "labour_attendance" DROP CONSTRAINT "labour_attendance_supervisorId_fkey";

-- DropForeignKey
ALTER TABLE "payment_requests" DROP CONSTRAINT "payment_requests_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "payment_requests" DROP CONSTRAINT "payment_requests_vendorId_fkey";

-- DropForeignKey
ALTER TABLE "vendor_materials" DROP CONSTRAINT "vendor_materials_vendorId_fkey";

-- AlterTable
ALTER TABLE "documents" DROP COLUMN "entityId",
DROP COLUMN "entityType",
DROP COLUMN "fileType",
DROP COLUMN "status",
DROP COLUMN "version",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "resolveTo" TEXT[];

-- AlterTable
ALTER TABLE "gate_pass_items" DROP COLUMN "description",
ADD COLUMN     "materialName" TEXT NOT NULL,
ALTER COLUMN "unit" DROP NOT NULL;

-- AlterTable
ALTER TABLE "gate_passes" DROP COLUMN "carrierName",
DROP COLUMN "driverName",
DROP COLUMN "type",
DROP COLUMN "vehicleNumber",
ADD COLUMN     "otpApprovedAt" TIMESTAMP(3),
ADD COLUMN     "otpApprovedBy" UUID,
ADD COLUMN     "otpCode" TEXT,
ADD COLUMN     "otpRequestedFor" UUID,
ALTER COLUMN "poId" SET NOT NULL,
ALTER COLUMN "invoiceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "inspections" DROP COLUMN "activityId",
DROP COLUMN "phaseId",
ADD COLUMN     "createdBy" UUID NOT NULL,
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "name" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "issues" DROP COLUMN "activityId",
DROP COLUMN "assignedTo",
DROP COLUMN "dateResolved",
DROP COLUMN "phaseId",
DROP COLUMN "resolution",
DROP COLUMN "status",
ADD COLUMN     "addressTo" TEXT[];

-- AlterTable
ALTER TABLE "payment_requests" ADD COLUMN     "category" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "expenseDate" TIMESTAMP(3),
ADD COLUMN     "fileMimeType" TEXT,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "filePath" TEXT,
ADD COLUMN     "paymentCode" TEXT NOT NULL,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'INVOICE',
ALTER COLUMN "invoiceId" DROP NOT NULL,
ALTER COLUMN "vendorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "po_items" DROP COLUMN "description",
DROP COLUMN "rate",
ADD COLUMN     "materialName" TEXT NOT NULL,
ADD COLUMN     "unitPrice" DECIMAL(15,2) NOT NULL,
ALTER COLUMN "unit" DROP NOT NULL;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "hospitalAddress" TEXT,
ADD COLUMN     "officeAddress" TEXT;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "approvalWorkflowId" UUID,
ADD COLUMN     "grandTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "gstAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "quotation_items" DROP COLUMN "description",
DROP COLUMN "rate",
ADD COLUMN     "materialName" TEXT NOT NULL,
ADD COLUMN     "unitPrice" DECIMAL(15,2) NOT NULL,
ALTER COLUMN "unit" DROP NOT NULL;

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "approvalWorkflowId" UUID,
ADD COLUMN     "fileMimeType" TEXT,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "filePath" TEXT,
ADD COLUMN     "grandTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "gstAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "vendor_invoices" ADD COLUMN     "advanceOtherType" TEXT,
ADD COLUMN     "advancePaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "advanceType" TEXT,
ADD COLUMN     "approvalWorkflowId" UUID,
ADD COLUMN     "deliveryDate" TIMESTAMP(3),
ADD COLUMN     "fileMimeType" TEXT,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "filePath" TEXT,
ADD COLUMN     "invoiceCode" TEXT NOT NULL,
ADD COLUMN     "paymentStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "stockStatus" TEXT NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "vendor_materials" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "vendors" ALTER COLUMN "vendorCode" DROP DEFAULT;

-- DropTable
DROP TABLE "labour_attendance";

-- CreateTable
CREATE TABLE "staff" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "baseSalary" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_attendance" (
    "id" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "markedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_attendance_staffId_date_key" ON "staff_attendance"("staffId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_paymentCode_key" ON "payment_requests"("paymentCode");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_approvalWorkflowId_key" ON "purchase_orders"("approvalWorkflowId");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_approvalWorkflowId_key" ON "quotations"("approvalWorkflowId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_invoices_invoiceCode_key" ON "vendor_invoices"("invoiceCode");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_invoices_approvalWorkflowId_key" ON "vendor_invoices"("approvalWorkflowId");

-- AddForeignKey
ALTER TABLE "vendor_materials" ADD CONSTRAINT "vendor_materials_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_approvalWorkflowId_fkey" FOREIGN KEY ("approvalWorkflowId") REFERENCES "approval_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approvalWorkflowId_fkey" FOREIGN KEY ("approvalWorkflowId") REFERENCES "approval_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_approvalWorkflowId_fkey" FOREIGN KEY ("approvalWorkflowId") REFERENCES "approval_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "vendor_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "vendor_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_otpRequestedFor_fkey" FOREIGN KEY ("otpRequestedFor") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_otpApprovedBy_fkey" FOREIGN KEY ("otpApprovedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_markedBy_fkey" FOREIGN KEY ("markedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

