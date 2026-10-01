-- Multi-project support: every project gets a short unique code that prefixes its
-- document numbers (VGH-PO001, ABC-PO001, ...). Additive-only: one new column and
-- one unique index on "projects". No existing row, number, user or PIN is changed.

ALTER TABLE "projects" ADD COLUMN "code" TEXT;

-- The existing project (the one that owns the users/data; normally the only one)
-- keeps the legacy "VGH" prefix so every number already issued stays valid.
-- Any other pre-existing project gets a distinct placeholder (P2, P3, ...).
WITH ranked AS (
  SELECT p."id",
         ROW_NUMBER() OVER (
           ORDER BY (SELECT COUNT(*) FROM "users" u WHERE u."projectId" = p."id") DESC,
                    p."createdAt" ASC,
                    p."id" ASC
         ) AS rn
  FROM "projects" p
)
UPDATE "projects" AS p
SET "code" = CASE WHEN r.rn = 1 THEN 'VGH' ELSE 'P' || r.rn::text END
FROM ranked r
WHERE p."id" = r."id";

ALTER TABLE "projects" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");
