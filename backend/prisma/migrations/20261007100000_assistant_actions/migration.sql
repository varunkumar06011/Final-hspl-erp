-- AI assistant action log (proposed -> confirmed -> executed create actions).
-- Additive only: one new table, no existing row or column is changed.

CREATE TABLE IF NOT EXISTS "assistant_actions" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultType" TEXT,
    "resultId" UUID,
    "resultLabel" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "assistant_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "assistant_actions_projectId_userId_status_idx" ON "assistant_actions"("projectId", "userId", "status");
CREATE INDEX IF NOT EXISTS "assistant_actions_userId_createdAt_idx" ON "assistant_actions"("userId", "createdAt");
