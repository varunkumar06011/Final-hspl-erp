ALTER TABLE "gate_passes" ALTER COLUMN "poId" DROP NOT NULL;
ALTER TABLE "gate_passes" ADD COLUMN "gatePassCategory" TEXT NOT NULL DEFAULT 'MATERIAL';
ALTER TABLE "gate_passes" ADD COLUMN "visitorPhone" TEXT;
