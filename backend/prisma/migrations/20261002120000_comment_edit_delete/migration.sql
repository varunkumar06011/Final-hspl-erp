-- Comment edit/delete tracking. Additive-only: nullable columns on comments.
ALTER TABLE "comments" ADD COLUMN "editedAt" TIMESTAMP(3);
ALTER TABLE "comments" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "comments" ADD COLUMN "deletedById" UUID;
ALTER TABLE "comments" ADD COLUMN "deletedByName" TEXT;
