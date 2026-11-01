-- Digital signatures: each user can save one signature; an approval snapshots it.
-- Additive only.
ALTER TABLE "approval_steps" ADD COLUMN "digitallySigned" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "user_signatures" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "imageData" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_signatures_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_signatures_userId_key" ON "user_signatures"("userId");
ALTER TABLE "user_signatures" ADD CONSTRAINT "user_signatures_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "approval_signatures" (
    "id" UUID NOT NULL,
    "stepId" UUID NOT NULL,
    "imageData" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approval_signatures_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "approval_signatures_stepId_key" ON "approval_signatures"("stepId");
ALTER TABLE "approval_signatures" ADD CONSTRAINT "approval_signatures_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "approval_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
