-- Payment requests no longer go through approval: a request is ready to record
-- as soon as it is raised. Requests still waiting for approval become APPROVED
-- (ready to record) and their open approval workflows are closed so they stop
-- appearing as approvals anywhere. Data-only; idempotent; nothing is deleted.
UPDATE "approval_workflows" w
SET "status" = 'APPROVED', "updatedAt" = NOW()
WHERE w."entityType" = 'PAYMENT_REQUEST'
  AND w."status" IN ('CREATED', 'VERIFICATION', 'APPROVAL_1', 'APPROVAL_2');

UPDATE "payment_requests"
SET "status" = 'APPROVED', "updatedAt" = NOW()
WHERE "status" = 'PENDING' AND "deletedAt" IS NULL;
