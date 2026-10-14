-- Contra vouchers (money moved between our own bank / cash accounts) were posted with
-- the same bank/cash row types as payments and receipts (WITHDRAWAL / DEPOSIT / IN / OUT,
-- and REVERSAL_* when cancelled or edited). The admin dashboard counts WITHDRAWAL and OUT
-- as expenditure, so every bank -> cash contra showed up as money spent and the cash it
-- funded was then counted a second time when spent.
--
-- Data-only fix: re-tag the bank/cash rows of every contra as TRANSFER_IN / TRANSFER_OUT
-- (the direction of each row is kept, so balances and balanceAfter do not change).
-- A contra here is any voucher whose every ledger line is a ledger linked to a bank or
-- cash account (also a contra entered under the Payment / Receipt type). A contra into a
-- ledger with no account behind it is left alone: that money did leave the tracked
-- accounts, and the voucher should be corrected to the account's own ledger.

WITH transfer_vouchers AS (
  SELECT jv.id
  FROM "journal_vouchers" jv
  WHERE (
       EXISTS (SELECT 1 FROM "ledger_entries" le WHERE le."journalVoucherId" = jv.id)
       AND NOT EXISTS (
         SELECT 1
         FROM "ledger_entries" le
         JOIN "ledgers" l ON l.id = le."ledgerId"
         WHERE le."journalVoucherId" = jv.id
           AND (l."linkedEntityId" IS NULL OR l."linkedEntityType" IS NULL
                OR l."linkedEntityType" NOT IN ('BANK_ACCOUNT', 'CASH_ACCOUNT'))
       )
     )
)
UPDATE "bank_transactions" bt
SET "type" = CASE bt."type"
               WHEN 'DEPOSIT' THEN 'TRANSFER_IN'
               WHEN 'REVERSAL_IN' THEN 'TRANSFER_IN'
               WHEN 'WITHDRAWAL' THEN 'TRANSFER_OUT'
               WHEN 'REVERSAL_OUT' THEN 'TRANSFER_OUT'
             END,
    "referenceType" = 'TRANSFER'
WHERE bt."referenceId" IN (SELECT id FROM transfer_vouchers)
  AND bt."type" IN ('DEPOSIT', 'REVERSAL_IN', 'WITHDRAWAL', 'REVERSAL_OUT');

WITH transfer_vouchers AS (
  SELECT jv.id
  FROM "journal_vouchers" jv
  WHERE (
       EXISTS (SELECT 1 FROM "ledger_entries" le WHERE le."journalVoucherId" = jv.id)
       AND NOT EXISTS (
         SELECT 1
         FROM "ledger_entries" le
         JOIN "ledgers" l ON l.id = le."ledgerId"
         WHERE le."journalVoucherId" = jv.id
           AND (l."linkedEntityId" IS NULL OR l."linkedEntityType" IS NULL
                OR l."linkedEntityType" NOT IN ('BANK_ACCOUNT', 'CASH_ACCOUNT'))
       )
     )
)
UPDATE "cash_transactions" ct
SET "type" = CASE ct."type"
               WHEN 'IN' THEN 'TRANSFER_IN'
               WHEN 'REVERSAL_IN' THEN 'TRANSFER_IN'
               WHEN 'OUT' THEN 'TRANSFER_OUT'
               WHEN 'REVERSAL_OUT' THEN 'TRANSFER_OUT'
             END,
    "referenceType" = 'TRANSFER'
WHERE ct."referenceId" IN (SELECT id FROM transfer_vouchers)
  AND ct."type" IN ('IN', 'REVERSAL_IN', 'OUT', 'REVERSAL_OUT');
