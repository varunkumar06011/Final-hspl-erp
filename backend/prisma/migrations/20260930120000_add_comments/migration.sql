-- Generic comment threads on any record. Additive-only: new table, no changes to existing ones.
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "projectId" UUID,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "entityLabel" TEXT,
    "url" TEXT,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "comments_entityType_entityId_idx" ON "comments"("entityType", "entityId");
CREATE INDEX "comments_projectId_createdAt_idx" ON "comments"("projectId", "createdAt");
CREATE INDEX "comments_authorId_idx" ON "comments"("authorId");

ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
