-- Proof numbers, file fingerprints and duplicate flags (additive; new tables only).
CREATE TABLE IF NOT EXISTS "proof_numbers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "baseType" TEXT NOT NULL,
  "baseId" UUID,
  "baseNumber" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "issuedBy" UUID NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" TIMESTAMP(3),
  "usedFingerprintId" UUID,
  "usedOnType" TEXT,
  "usedOnId" UUID,
  "reuseCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "proof_numbers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "proof_numbers_projectId_number_key" ON "proof_numbers"("projectId", "number");
CREATE INDEX IF NOT EXISTS "proof_numbers_projectId_baseType_baseId_idx" ON "proof_numbers"("projectId", "baseType", "baseId");
CREATE INDEX IF NOT EXISTS "proof_numbers_projectId_usedAt_idx" ON "proof_numbers"("projectId", "usedAt");

CREATE TABLE IF NOT EXISTS "file_fingerprints" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "sha256" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "fileName" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "mimeType" TEXT,
  "bucket" TEXT,
  "uploadedBy" UUID,
  "proofNumber" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "file_fingerprints_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "file_fingerprints_projectId_sha256_idx" ON "file_fingerprints"("projectId", "sha256");
CREATE INDEX IF NOT EXISTS "file_fingerprints_filePath_idx" ON "file_fingerprints"("filePath");

CREATE TABLE IF NOT EXISTS "duplicate_flags" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "reason" TEXT NOT NULL,
  "uploadedBy" UUID,
  "fingerprintId" UUID,
  "matchedFingerprintId" UUID,
  "entityType" TEXT,
  "entityId" UUID,
  "matchedEntityType" TEXT,
  "matchedEntityId" UUID,
  "vendorName" TEXT,
  "amount" DECIMAL(15,2),
  "proofNumber" TEXT,
  "reviewedBy" UUID,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "duplicate_flags_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "duplicate_flags_projectId_status_createdAt_idx" ON "duplicate_flags"("projectId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "duplicate_flags_entityType_entityId_idx" ON "duplicate_flags"("entityType", "entityId");
