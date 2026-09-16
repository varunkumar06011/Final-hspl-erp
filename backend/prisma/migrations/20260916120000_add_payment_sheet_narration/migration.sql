-- PaymentSheetNarration: one free-text day-level note per payment sheet.
-- Separate table so a narration can exist even on days with no entries.
CREATE TABLE "payment_sheet_narrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "narration" TEXT NOT NULL DEFAULT '',
    "updatedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_sheet_narrations_pkey" PRIMARY KEY ("id")
);

-- One narration per project per day
CREATE UNIQUE INDEX "payment_sheet_narrations_projectId_date_key" ON "payment_sheet_narrations"("projectId", "date");

-- Foreign keys
ALTER TABLE "payment_sheet_narrations"
  ADD CONSTRAINT "payment_sheet_narrations_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_sheet_narrations"
  ADD CONSTRAINT "payment_sheet_narrations_updatedBy_fkey"
  FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
