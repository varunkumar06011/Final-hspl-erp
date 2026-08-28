-- Finance Module Phase 6: Budget Revisions (edit approval + history)
CREATE TABLE "budget_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "budgetHeadId" UUID NOT NULL,
    "oldSlNo" INTEGER,
    "oldParticulars" TEXT,
    "oldAllocated" DECIMAL(15,2),
    "oldStatus" TEXT,
    "newSlNo" INTEGER,
    "newParticulars" TEXT,
    "newAllocated" DECIMAL(15,2),
    "newStatus" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedBy" UUID NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewComments" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_revisions_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "budget_revisions"
  ADD CONSTRAINT "budget_revisions_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "budget_revisions"
  ADD CONSTRAINT "budget_revisions_budgetHeadId_fkey"
  FOREIGN KEY ("budgetHeadId") REFERENCES "budget_heads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "budget_revisions"
  ADD CONSTRAINT "budget_revisions_requestedBy_fkey"
  FOREIGN KEY ("requestedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "budget_revisions"
  ADD CONSTRAINT "budget_revisions_reviewedBy_fkey"
  FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "budget_revisions_projectId_idx" ON "budget_revisions"("projectId");
CREATE INDEX "budget_revisions_budgetHeadId_idx" ON "budget_revisions"("budgetHeadId");
CREATE INDEX "budget_revisions_status_idx" ON "budget_revisions"("status");
