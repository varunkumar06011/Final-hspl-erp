-- Allow multiple goods receipts per gate pass (partial deliveries)
-- Drop the unique constraint on goods_receipts.gate_pass_id

DROP INDEX IF EXISTS "goods_receipts_gate_pass_id_key";
